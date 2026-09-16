-- ============================================================================
-- Conversa nasce com dona  (decisão do Danilo, 16/09/2026)
-- ----------------------------------------------------------------------------
-- O QUE RESOLVE
-- Regra dos 100%: nenhuma conversa pode ficar sem atendente. Hoje a conversa
-- nasce sem dona por três caminhos (disparo, paciente que escreve primeiro,
-- follow-up) e o rodízio antigo (_on_handoff_autoassign) nunca roda: exige
-- atribuição automática ligada, fila montada e atendente "online" — e nada no
-- sistema grava presença. Em 15/09 as 268 sem dona foram passadas à mão para a
-- Millena; no dia seguinte já havia 3 novas sem dona.
--
-- A REGRA
--   · Vale no nascimento da conversa (INSERT), qualquer que seja o caminho.
--   · Se já vem com dona (ex.: número com atendente fixa), respeita.
--   · Se o número tem atendente fixa (channels.assigned_member), vai para ela.
--   · Senão, vai para quem está marcada como "atende paciente"
--     (app_users.atende_inbox) e RECEBEU MENOS CONVERSAS HOJE (fuso de
--     Itabuna). Na prática alterna entre elas, e a carteira antiga não pesa:
--     as 310 da Millena não fazem todo o novo cair na Larah.
--   · Ninguém marcado → nasce sem dona (não bloqueia a entrada da mensagem).
--
-- Quem atende hoje (Danilo, 16/09): Millena (coordenadora, admin) e Larah
-- (operadora). Nathaly e Andressa ficam de fora. O cargo de ninguém muda.
--
-- CONVIVE COM a migration 20260909180000_transferencia_conversa_parada.sql
-- (da outra sessão, ainda não aplicada): usa a MESMA coluna atende_inbox, com
-- ADD COLUMN IF NOT EXISTS. Atenção ao aplicar aquela: o passo 4 dela marca
-- quatro atendentes — precisa ser reduzido a Millena e Larah.
--
-- ----------------------------------------------------------------------------
-- COMO REVERTER (escrito antes de aplicar)
--   DROP TRIGGER IF EXISTS trg_responsavel_ao_nascer ON whatsapp_hub.conversations;
--   DROP FUNCTION IF EXISTS whatsapp_hub._responsavel_ao_nascer();
--   -- a coluna atende_inbox pode ficar (a outra migration também a usa);
--   -- conversas já atribuídas por esta regra continuam com a dona.
-- ============================================================================

SET search_path TO whatsapp_hub;

-- 1. Quem recebe paciente ------------------------------------------------------
-- Não dá para deduzir por `role`: Millena é admin e atende; o e-mail
-- institucional da unidade também é admin e NÃO atende.
ALTER TABLE whatsapp_hub.app_users
  ADD COLUMN IF NOT EXISTS atende_inbox boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN whatsapp_hub.app_users.atende_inbox IS
  'Recebe conversa nova e transferência automática. Marcar só quem atende paciente.';

-- 2. A regra -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION whatsapp_hub._responsavel_ao_nascer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'whatsapp_hub', 'pg_temp'
AS $$
DECLARE
  v_hoje    timestamptz;
  v_destino uuid;
BEGIN
  IF NEW.assigned_to IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Número com atendente fixa.
  IF NEW.channel_id IS NOT NULL THEN
    SELECT ch.assigned_member INTO v_destino
      FROM whatsapp_hub.channels ch
     WHERE ch.id = NEW.channel_id;
  END IF;

  IF v_destino IS NULL THEN
    -- Disparo cria dezenas de conversas em sequência, às vezes em chamadas
    -- paralelas: a trava faz uma esperar a outra, senão as duas contam o mesmo
    -- placar e mandam para a mesma atendente.
    PERFORM pg_advisory_xact_lock(hashtext('whatsapp_hub.responsavel_ao_nascer'));

    v_hoje := date_trunc('day', now() AT TIME ZONE 'America/Bahia') AT TIME ZONE 'America/Bahia';

    SELECT au.user_id INTO v_destino
      FROM whatsapp_hub.app_users au
     WHERE au.atende_inbox
       AND (NEW.org_id IS NULL OR au.org_id = NEW.org_id)
     ORDER BY
       (SELECT count(*) FROM whatsapp_hub.conversations c
         WHERE c.assigned_to = au.user_id AND c.assigned_at >= v_hoje) ASC,
       (SELECT max(c.assigned_at) FROM whatsapp_hub.conversations c
         WHERE c.assigned_to = au.user_id) ASC NULLS FIRST,
       au.user_id
     LIMIT 1;
  END IF;

  IF v_destino IS NOT NULL THEN
    NEW.assigned_to := v_destino;
    NEW.assigned_at := now();
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION whatsapp_hub._responsavel_ao_nascer() IS
  'Conversa nasce com dona: atendente fixa do número ou, senão, quem marcada em atende_inbox recebeu menos conversas hoje.';

-- O nome começa com "trg_r" de propósito: triggers do mesmo evento rodam em
-- ordem alfabética, e esta precisa vir DEPOIS de trg_org_from_parent, que
-- preenche o org_id.
DROP TRIGGER IF EXISTS trg_responsavel_ao_nascer ON whatsapp_hub.conversations;
CREATE TRIGGER trg_responsavel_ao_nascer
  BEFORE INSERT ON whatsapp_hub.conversations
  FOR EACH ROW EXECUTE FUNCTION whatsapp_hub._responsavel_ao_nascer();

-- 3. Quem atende hoje ----------------------------------------------------------
UPDATE whatsapp_hub.app_users au
   SET atende_inbox = (u.email IN ('adm.millena@outlook.com', 'mangabeiralarah@gmail.com'))
  FROM auth.users u
 WHERE u.id = au.user_id;
