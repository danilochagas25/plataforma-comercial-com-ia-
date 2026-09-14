-- ============================================================================
-- Avaliação dos atendimentos pela IA
-- ============================================================================
-- Cada linha é UM ATENDIMENTO: uma operadora, numa conversa, num dia (fuso da
-- clínica, America/Bahia). A Edge Function `avaliar-atendimentos` lê as
-- mensagens desse dia, calcula os números objetivos (tempo de resposta, quem
-- ficou sem resposta) e pede à IA a avaliação qualitativa pela régua do
-- BASE-CONHECIMENTO-ODONTO.md — tom (seção 8), dinheiro (2), objeções (6),
-- agendamento (9) e as proibições do CFO (7).
--
-- Quem escreve: SÓ a service role (a função). Não há policy de escrita.
-- Quem lê: admin vê a organização toda; operadora vê SÓ as próprias avaliações
-- (decisão do Danilo, 14/09/2026 — o feedback serve para ela aprender).
--
-- `ate_mensagem_at` é a última mensagem considerada. Se a conversa andar
-- depois de uma avaliação feita no meio do dia, a função reavalia; se não
-- andou, pula. Por isso o cron da manhã e o botão manual convivem sem gerar
-- duplicata nem gastar IA à toa.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub, public;

CREATE TABLE IF NOT EXISTS whatsapp_hub.atendimento_avaliacoes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES whatsapp_hub.organizations(id) ON DELETE CASCADE,
  conversation_id  uuid NOT NULL REFERENCES whatsapp_hub.conversations(id) ON DELETE CASCADE,
  operador_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dia              date NOT NULL,

  -- 'avaliado'     → a IA avaliou;
  -- 'insuficiente' → conversa curta demais para julgar (sem chamada de IA);
  -- 'erro'         → a IA falhou; a próxima rodada tenta de novo.
  status           text NOT NULL CHECK (status IN ('avaliado', 'insuficiente', 'erro')),

  nota_geral       numeric(3,1) CHECK (nota_geral IS NULL OR nota_geral BETWEEN 0 AND 10),
  -- { acolhimento|entendimento|dinheiro|conducao|clareza:
  --     { nota: 0-10 | null (não se aplicou), justificativa, trecho } }
  criterios        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- [{ regra, trecho }] — violações do CFO / vocabulário da rede.
  alertas          jsonb NOT NULL DEFAULT '[]'::jsonb,
  pontos_fortes    text[] NOT NULL DEFAULT '{}',
  a_melhorar       text[] NOT NULL DEFAULT '{}',
  resumo           text,
  -- Números calculados sem IA: mensagens, tempos de resposta, espera no fim do dia.
  metricas         jsonb NOT NULL DEFAULT '{}'::jsonb,

  ate_mensagem_at  timestamptz NOT NULL,
  modelo           text,
  erro             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (conversation_id, operador_id, dia)
);

CREATE INDEX IF NOT EXISTS atendimento_avaliacoes_org_dia_idx
  ON whatsapp_hub.atendimento_avaliacoes (org_id, dia DESC);
CREATE INDEX IF NOT EXISTS atendimento_avaliacoes_operador_dia_idx
  ON whatsapp_hub.atendimento_avaliacoes (operador_id, dia DESC);

DROP TRIGGER IF EXISTS trg_atendimento_avaliacoes_updated_at ON whatsapp_hub.atendimento_avaliacoes;
CREATE TRIGGER trg_atendimento_avaliacoes_updated_at
  BEFORE UPDATE ON whatsapp_hub.atendimento_avaliacoes
  FOR EACH ROW EXECUTE FUNCTION whatsapp_hub.set_updated_at();

ALTER TABLE whatsapp_hub.atendimento_avaliacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS atendimento_avaliacoes_select ON whatsapp_hub.atendimento_avaliacoes;
CREATE POLICY atendimento_avaliacoes_select ON whatsapp_hub.atendimento_avaliacoes
  FOR SELECT TO authenticated
  USING (
    org_id = whatsapp_hub.current_org_id()
    AND whatsapp_hub.current_org_active()
    AND (
      whatsapp_hub.current_user_role() = 'admin'
      OR operador_id = auth.uid()
    )
  );

GRANT SELECT ON whatsapp_hub.atendimento_avaliacoes TO authenticated;
GRANT ALL ON whatsapp_hub.atendimento_avaliacoes TO service_role;

COMMENT ON TABLE whatsapp_hub.atendimento_avaliacoes IS
  'Avaliação da IA por atendimento (operadora × conversa × dia). Escrita só pela Edge Function avaliar-atendimentos.';

-- Agenda ----------------------------------------------------------------------
-- 06:00, 06:10 e 06:20 em Itabuna (09:xx UTC). Sem corpo, a função avalia o dia
-- ANTERIOR inteiro — o relatório já está pronto quando a clínica abre. Três
-- passadas porque cada chamada processa um lote; as seguintes só pegam o que
-- sobrou (e não fazem nada se não sobrou).
DO $$
BEGIN
  PERFORM cron.unschedule('wh-avaliar-atendimentos');
EXCEPTION WHEN OTHERS THEN NULL;
END
$$;

SELECT cron.schedule(
  'wh-avaliar-atendimentos',
  '0,10,20 9 * * *',
  $cron$SELECT whatsapp_hub._cron_invoke_edge('avaliar-atendimentos')$cron$
);
