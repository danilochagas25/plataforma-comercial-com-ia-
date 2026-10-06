-- ============================================================================
-- Conversa fechada reabre quando o paciente escreve  (pedido do Danilo, 06/10/2026)
-- ----------------------------------------------------------------------------
-- O QUE RESOLVE (pendência #55, aberta desde 14/09)
-- Quando o paciente respondia numa conversa já encerrada, nada acontecia: a
-- conversa continuava no balde "Fechadas", a IA não respondia
-- (process-ai-message devolve "conversation closed") e a atendente não via a
-- mensagem na fila dela. Medido em 06/10: 17 respostas a disparo de setembro
-- ficaram sem atendimento por isso, e havia 27 conversas fechadas com o
-- paciente falando por último.
--
-- A REGRA
--   · Mensagem RECEBIDA do paciente (não nota interna) em conversa 'closed'
--     reabre a conversa direto no humano: status 'human_active', IA pausada,
--     closed_at limpo.
--   · Vai para o humano, não para a IA: quem volta a escrever depois de um
--     atendimento encerrado já passou pela triagem.
--   · A dona continua a mesma. Só troca se a conversa estiver sem dona ou com
--     dona que não atende paciente (app_users.atende_inbox = false): aí vale a
--     mesma regra de 16/09 — quem atende e recebeu menos conversas hoje.
--   · Aviso à dona: se a IA estava ligada, o flip ai_paused false→true já
--     dispara o aviso de handoff (_on_handoff_notify). Se a IA já estava
--     pausada, esse gatilho não dispara, então o aviso é gravado aqui.
--
-- ORDEM DOS GATILHOS
-- O nome "on_inbound_0_reabrir" vem antes de "on_inbound_message" na ordem
-- alfabética: a conversa já está reaberta e com a IA pausada quando o
-- process-ai-message é chamado, então a IA não responde por cima.
--
-- NÃO MEXE em conversa aberta, em mensagem enviada, nem em campanhas.
--
-- ----------------------------------------------------------------------------
-- COMO REVERTER (escrito antes de aplicar)
--   DROP TRIGGER IF EXISTS on_inbound_0_reabrir ON whatsapp_hub.messages;
--   DROP FUNCTION IF EXISTS whatsapp_hub._reabrir_ao_receber();
--   -- conversas já reabertas continuam abertas; fechar de novo é pela tela.
-- ============================================================================

SET search_path TO whatsapp_hub;

CREATE OR REPLACE FUNCTION whatsapp_hub._reabrir_ao_receber()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'whatsapp_hub', 'public', 'pg_temp'
AS $$
DECLARE
  v_conv     record;
  v_destino  uuid;
  v_atende   boolean;
  v_hoje     timestamptz;
  v_nome     text;
  v_fone     text;
BEGIN
  IF NEW.direction <> 'inbound'
     OR NEW.sender_type <> 'contact'
     OR COALESCE(NEW.is_private_note, false) = true
  THEN
    RETURN NEW;
  END IF;

  SELECT c.id, c.org_id, c.contact_id, c.assigned_to, c.ai_paused
    INTO v_conv
    FROM whatsapp_hub.conversations c
   WHERE c.id = NEW.conversation_id
     AND c.status = 'closed'
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_destino := v_conv.assigned_to;

  IF v_destino IS NOT NULL THEN
    SELECT au.atende_inbox INTO v_atende
      FROM whatsapp_hub.app_users au
     WHERE au.user_id = v_destino
       AND (v_conv.org_id IS NULL OR au.org_id = v_conv.org_id)
     LIMIT 1;
  END IF;

  IF v_destino IS NULL OR NOT COALESCE(v_atende, false) THEN
    v_hoje := date_trunc('day', now() AT TIME ZONE 'America/Bahia') AT TIME ZONE 'America/Bahia';
    SELECT au.user_id INTO v_destino
      FROM whatsapp_hub.app_users au
     WHERE au.atende_inbox
       AND (v_conv.org_id IS NULL OR au.org_id = v_conv.org_id)
     ORDER BY
       (SELECT count(*) FROM whatsapp_hub.conversations c
         WHERE c.assigned_to = au.user_id AND c.assigned_at >= v_hoje) ASC,
       (SELECT max(c.assigned_at) FROM whatsapp_hub.conversations c
         WHERE c.assigned_to = au.user_id) ASC NULLS FIRST,
       au.user_id
     LIMIT 1;
    -- Ninguém marcado para atender: mantém a dona que estava (não bloqueia).
    v_destino := COALESCE(v_destino, v_conv.assigned_to);
  END IF;

  UPDATE whatsapp_hub.conversations c
     SET status      = 'human_active',
         ai_paused   = true,
         closed_at   = NULL,
         assigned_to = v_destino,
         assigned_at = CASE WHEN v_destino IS DISTINCT FROM c.assigned_to THEN now() ELSE c.assigned_at END
   WHERE c.id = v_conv.id;

  -- IA já estava pausada: o gatilho de handoff não dispara, avisa aqui.
  IF COALESCE(v_conv.ai_paused, false) = true AND v_destino IS NOT NULL THEN
    SELECT ct.name, ct.phone INTO v_nome, v_fone
      FROM whatsapp_hub.contacts ct
     WHERE ct.id = v_conv.contact_id;

    INSERT INTO whatsapp_hub.notifications (
      org_id, user_id, type, conversation_id, message_id, title, body
    )
    VALUES (
      v_conv.org_id, v_destino, 'handoff'::whatsapp_hub.notification_type,
      v_conv.id, NEW.id,
      'Paciente voltou a escrever: ' || COALESCE(NULLIF(v_nome, ''), v_fone, 'contato'),
      'A conversa estava fechada e foi reaberta porque o paciente mandou mensagem.'
    );
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION whatsapp_hub._reabrir_ao_receber() IS
  'Conversa fechada reabre no humano quando o paciente escreve; mantém a dona, ou passa para quem atende se estava sem dona.';

DROP TRIGGER IF EXISTS on_inbound_0_reabrir ON whatsapp_hub.messages;
CREATE TRIGGER on_inbound_0_reabrir
  AFTER INSERT ON whatsapp_hub.messages
  FOR EACH ROW EXECUTE FUNCTION whatsapp_hub._reabrir_ao_receber();
