-- ============================================================================
-- 20260906230000_inbox_media_bucket
-- ----------------------------------------------------------------------------
-- Guarda de mídia de paciente (foto, áudio, vídeo, documento) recebida e
-- enviada pelo WhatsApp — canal Meta Cloud API direto.
--
-- Contexto: a Meta entrega só o `media_id`; a URL do GET /{media_id} é de uso
-- único, expira em ~5min e exige `Authorization: Bearer`. Para o operador ver
-- a foto e o Whisper transcrever o áudio, o arquivo precisa ser rehospedado.
--
-- DECISÃO DO DONO (Danilo, 05-06/09/2026 — MEMORIA.md, pendências #21/#23/#36):
--   · mídia de paciente fica na NOSSA base (Supabase Storage)
--   · bucket PRIVADO — nunca o `whatsapp-hub-agent-media`, que é public=true
--   · visível para administrador e recepção (perfis 'admin' e 'operator')
--   · retenção de 12 MESES com expurgo automático
--
-- CAMINHO DO OBJETO: <org_id>/<conversation_id>/<message_id>.<ext>
--   O 1º segmento é o org_id porque é ele que as policies conferem
--   (storage.foldername(name))[1] = current_org_id() — mesmo padrão dos
--   buckets `whatsapp-hub-knowledge` e `whatsapp-hub-avatars`.
--   O nome do arquivo é o UUID da mensagem (não o wamid): é único, estável,
--   não tem '=' nem '.' do wamid, e existe também na mídia que o operador
--   envia (que não tem wamid no momento do insert).
--
-- messages.media_url guarda a REFERÊNCIA, não uma URL:
--   'whatsapp-hub-inbox-media/<org_id>/<conversation_id>/<message_id>.<ext>'
--   O front detecta que não começa com http(s) e pede uma signed URL.
--
-- LIMITES: 25MB por arquivo (mesmo teto do envio pelo operador) e uma lista
--   explícita de MIME. Documento com MIME fora da lista é gravado como
--   application/octet-stream, preservando a extensão — nada de mídia de
--   paciente é descartado por causa de um Content-Type exótico.
-- ============================================================================

SET search_path TO whatsapp_hub, public;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'whatsapp-hub-inbox-media',
  'whatsapp-hub-inbox-media',
  false,                    -- PRIVADO: dado de paciente não vive em URL aberta
  25 * 1024 * 1024,
  ARRAY[
    -- imagem (inclui sticker)
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    -- áudio (a nota de voz do WhatsApp chega como audio/ogg; codecs=opus)
    'audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg',
    'audio/opus', 'audio/wav', 'audio/webm',
    -- vídeo
    'video/mp4', 'video/3gpp', 'video/quicktime', 'video/webm',
    -- documento
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip',
    'text/plain', 'text/csv',
    -- coringa para binário de tipo desconhecido (nada se perde)
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS wh_inbox_media_org_read ON storage.objects;

-- LEITURA: administrador e recepção, só dentro da própria organização.
-- Sem policy de INSERT/UPDATE/DELETE para `authenticated`: quem escreve e
-- apaga é a service role (Edge Functions), que não passa por RLS.
CREATE POLICY wh_inbox_media_org_read
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'whatsapp-hub-inbox-media'
    AND whatsapp_hub.current_user_role() IN ('admin', 'operator')
    AND (storage.foldername(name))[1] = whatsapp_hub.current_org_id()::text
  );

-- ----------------------------------------------------------------------------
-- Expurgo automático aos 12 meses
-- ----------------------------------------------------------------------------
-- Roda todo dia às 03:20 UTC (00:20 em Itabuna) — janela morta, longe dos
-- crons de disparo. A Edge Function `purge-inbox-media` apaga o OBJETO do
-- Storage e zera messages.media_url. A MENSAGEM não é apagada: o histórico do
-- atendimento continua legível, só a mídia expira.
DO $$
BEGIN
  PERFORM cron.unschedule('wh-purge-inbox-media');
EXCEPTION WHEN OTHERS THEN NULL;
END
$$;

SELECT cron.schedule(
  'wh-purge-inbox-media',
  '20 3 * * *',
  $cron$SELECT whatsapp_hub._cron_invoke_edge('purge-inbox-media')$cron$
);
