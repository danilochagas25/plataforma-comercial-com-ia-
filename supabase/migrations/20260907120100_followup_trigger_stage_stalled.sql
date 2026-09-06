-- ============================================================================
-- 20260907120100_followup_trigger_stage_stalled
-- ----------------------------------------------------------------------------
-- Novo gatilho de régua: `stage_stalled` — "parado na etapa há N dias".
--
-- Os três gatilhos que existiam (`no_reply`, `inactivity`, `no_purchase`)
-- olham conversa e compra. NENHUM olha o funil. O caso de uso do CRM odonto é
-- exatamente o que faltava: o orçamento entrou em "Orçamento apresentado" e
-- ficou lá.
--
-- ⚠️ POR QUE ESTA MIGRAÇÃO É SEPARADA DAS OUTRAS DUAS:
-- `ALTER TYPE ... ADD VALUE` pode rodar dentro de transação (PG 12+), mas o
-- valor novo NÃO pode ser USADO na mesma transação. O seed que insere as
-- regras com `trigger_condition = 'stage_stalled'` é a migração seguinte.
--
-- ⚠️ O MOTOR AINDA NÃO ENTENDE ESTE GATILHO. A Edge Function `check-follow-ups`
-- (cron 15min) só implementa `no_reply`, `inactivity` e `no_purchase`. Por isso
-- as regras nascem DESATIVADAS (`is_active = false`) — e a função só lê regras
-- ativas, então nada dispara. Ativar antes de implementar o motor não envia
-- mensagem errada: simplesmente não envia nada útil.
--
-- APROVAÇÃO: Danilo, 06/09/2026 (régua até 7 dias: D+1, D+3, D+7).
-- REVERSÃO: `ALTER TYPE ... ADD VALUE` é IRREVERSÍVEL em PostgreSQL. Ver
--   MEMORIA.md, tabela "Mudanças no banco", para o procedimento completo.
-- ============================================================================

SET search_path TO whatsapp_hub, public;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'whatsapp_hub'
       AND t.typname = 'follow_up_trigger'
       AND e.enumlabel = 'stage_stalled'
  ) THEN
    ALTER TYPE whatsapp_hub.follow_up_trigger ADD VALUE 'stage_stalled';
  END IF;
END;
$$;
