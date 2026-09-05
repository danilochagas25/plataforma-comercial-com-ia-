-- ============================================================================
-- 20260905120000_meta_cloud_channel.sql
-- ----------------------------------------------------------------------------
-- CRM Odonto · Clínica Amor Saúde Itabuna
--
-- Habilita o provedor 'meta' em whatsapp_hub.channels: conversa DIRETO com a
-- WhatsApp Cloud API da Meta (graph.facebook.com), sem intermediário.
--
-- Decisão do Danilo em 05/09/2026 (ver MEMORIA.md). Revoga a regra anterior
-- de "canal zernio apenas" (ODONTO.md §7, pendência #10).
--
-- O QUE MUDA
--   - channels.provider passa a aceitar 'meta' (além de 'zernio' e 'uazapi')
--   - 3 colunas novas, todas NULL para canais existentes:
--       meta_waba_id          → id da conta WhatsApp Business (WABA)
--       meta_phone_number_id  → id do número na Meta (destino do envio)
--       meta_token_encrypted  → token de acesso, cifrado AES-GCM (CRYPTO_KEY)
--   - CHECK de forma: canal 'meta' exige meta_phone_number_id
--   - UNIQUE: o mesmo número não pode ser cadastrado duas vezes na org
--
-- O QUE NÃO MUDA
--   - Nenhuma linha existente é alterada (channels está VAZIA hoje)
--   - Nenhuma policy RLS é tocada; a tabela segue com RLS habilitado
--   - zernio e uazapi continuam funcionando exatamente como antes
--
-- SEGREDOS
--   O token entra cifrado (mesmo formato do uazapi_token_encrypted).
--   App Secret e Verify Token do webhook NÃO ficam aqui: vão no cofre por org
--   (public.org_settings), chaves 'meta_app_secret' e 'meta_webhook_verify_token'.
--   Nenhum segredo é escrito neste arquivo.
--
-- REVERSÃO
--   BEGIN;
--     DELETE FROM whatsapp_hub.channels WHERE provider = 'meta';
--     ALTER TABLE whatsapp_hub.channels DROP CONSTRAINT IF EXISTS channels_meta_number_unique;
--     ALTER TABLE whatsapp_hub.channels DROP CONSTRAINT IF EXISTS channels_provider_shape;
--     ALTER TABLE whatsapp_hub.channels ADD CONSTRAINT channels_provider_shape CHECK (
--       (provider = 'zernio' AND zernio_account_id IS NOT NULL)
--       OR (provider = 'uazapi' AND uazapi_server_url IS NOT NULL));
--     ALTER TABLE whatsapp_hub.channels DROP CONSTRAINT IF EXISTS channels_provider_check;
--     ALTER TABLE whatsapp_hub.channels ADD CONSTRAINT channels_provider_check
--       CHECK (provider IN ('zernio','uazapi'));
--     DROP INDEX IF EXISTS whatsapp_hub.idx_channels_meta_phone;
--     ALTER TABLE whatsapp_hub.channels
--       DROP COLUMN IF EXISTS meta_waba_id,
--       DROP COLUMN IF EXISTS meta_phone_number_id,
--       DROP COLUMN IF EXISTS meta_token_encrypted;
--   COMMIT;
-- ============================================================================

SET search_path TO whatsapp_hub;

-- ----------------------------------------------------------------------------
-- 1. Colunas do canal Meta (todas nullable — canais zernio/uazapi ficam NULL)
-- ----------------------------------------------------------------------------
ALTER TABLE whatsapp_hub.channels
  ADD COLUMN IF NOT EXISTS meta_waba_id         TEXT,
  ADD COLUMN IF NOT EXISTS meta_phone_number_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_token_encrypted TEXT;

COMMENT ON COLUMN whatsapp_hub.channels.meta_waba_id IS
  'Meta Cloud API: id da WhatsApp Business Account (WABA) dona do número.';
COMMENT ON COLUMN whatsapp_hub.channels.meta_phone_number_id IS
  'Meta Cloud API: Phone Number ID. É o id usado no POST /{id}/messages e o '
  'campo que casa o webhook inbound com este canal (metadata.phone_number_id).';
COMMENT ON COLUMN whatsapp_hub.channels.meta_token_encrypted IS
  'Meta Cloud API: access token do System User, cifrado AES-256-GCM '
  '("iv:tag:cipher", env CRYPTO_KEY). Nunca em texto puro, nunca em .env.';

-- ----------------------------------------------------------------------------
-- 2. provider aceita 'meta'
--    O CHECK inline vira constraint nomeada para poder ser substituída.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  con_name TEXT;
BEGIN
  -- Remove o CHECK de provider seja qual for o nome gerado pelo Postgres.
  FOR con_name IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'whatsapp_hub'
       AND t.relname = 'channels'
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) ILIKE '%provider%'
       AND pg_get_constraintdef(c.oid) ILIKE '%zernio%'
       AND pg_get_constraintdef(c.oid) NOT ILIKE '%zernio_account_id%'
  LOOP
    EXECUTE format('ALTER TABLE whatsapp_hub.channels DROP CONSTRAINT %I', con_name);
  END LOOP;
END $$;

ALTER TABLE whatsapp_hub.channels
  ADD CONSTRAINT channels_provider_check
  CHECK (provider IN ('zernio', 'uazapi', 'meta'));

-- ----------------------------------------------------------------------------
-- 3. Forma do canal: 'meta' exige o Phone Number ID
-- ----------------------------------------------------------------------------
ALTER TABLE whatsapp_hub.channels
  DROP CONSTRAINT IF EXISTS channels_provider_shape;

ALTER TABLE whatsapp_hub.channels
  ADD CONSTRAINT channels_provider_shape CHECK (
    (provider = 'zernio' AND zernio_account_id IS NOT NULL)
    OR
    (provider = 'uazapi' AND uazapi_server_url IS NOT NULL)
    OR
    (provider = 'meta'   AND meta_phone_number_id IS NOT NULL)
  );

-- ----------------------------------------------------------------------------
-- 4. Unicidade e índice
--    O webhook inbound da Meta resolve o canal por metadata.phone_number_id,
--    então esse lookup precisa ser indexado e não pode ser ambíguo.
-- ----------------------------------------------------------------------------
ALTER TABLE whatsapp_hub.channels
  DROP CONSTRAINT IF EXISTS channels_meta_number_unique;

ALTER TABLE whatsapp_hub.channels
  ADD CONSTRAINT channels_meta_number_unique
  UNIQUE (org_id, provider, meta_phone_number_id);

CREATE INDEX IF NOT EXISTS idx_channels_meta_phone
  ON whatsapp_hub.channels (meta_phone_number_id)
  WHERE meta_phone_number_id IS NOT NULL;
