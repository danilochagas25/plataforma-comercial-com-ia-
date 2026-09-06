-- ============================================================================
-- 20260907120000_odonto_crm_estrutura
-- ----------------------------------------------------------------------------
-- Estrutura do CRM de odontologia (Clínica Amor Saúde Itabuna).
-- Esta migração NÃO cria dado de negócio — só as peças que faltavam no schema.
-- O funil, os campos, o catálogo e a régua entram na migração de seed
-- (`20260907120200_odonto_crm_seed`), depois do ALTER TYPE do enum.
--
-- MOTIVAÇÃO (MEMORIA.md 05-06/09/2026 · ODONTO.md §5 e §6):
--
--  1. 🔴 NÃO EXISTE RELÓGIO DE ESTAGNAÇÃO. O caso de uso central do projeto é
--     "orçamento parado na etapa há N dias" e isso não era mensurável:
--       · `deals` não tinha `stage_entered_at`
--       · `crm_activities` tem o tipo `stage_change` no enum, mas NENHUM
--         trigger gravava a linha
--       · `funnel_automations` dispara na ENTRADA da etapa, não na permanência
--       · `updated_at` muda a cada edição, então não serve de relógio
--     Sem esta migração a régua D+1/D+3/D+7 é impossível.
--
--  2. `products.product_type` estava travado numa taxonomia de INFOPRODUTO
--     ('curso','mentoria',...). Não há tipo para procedimento odontológico.
--     ⚠️ `products_quantity_chk` acopla `quantity` a `product_type='fisico'`:
--     trocar só o primeiro CHECK deixaria TODO procedimento proibido de ter
--     quantidade. Os dois são reescritos juntos, de propósito.
--
--  3. `custom_fields` só tem `label` (texto livre, em português, editável pelo
--     usuário). A importação diária precisa endereçar o campo por uma chave
--     ESTÁVEL que sobreviva a um rename de label — daí `custom_fields.key`.
--
--  4. `pipelines` não tem como ser desativado — só renomear ou EXCLUIR. O dono
--     autorizou DESATIVAR os funis do seed ("Vendas" e "Pós-venda"), não
--     apagar. Daí `pipelines.is_active`.
--
--  5. Idempotência da importação diária: sem uma chave externa, reimportar o
--     mesmo relatório duplicaria os 64 orçamentos. `deals.external_ref` +
--     índice único por org é a trava no BANCO — não só no código do importador.
--
-- APROVAÇÃO: Danilo, 06/09/2026 (fecha as pendências #1 e #2 do ODONTO.md §10).
-- REVERSÃO: ver MEMORIA.md, tabela "Mudanças no banco".
-- ============================================================================

SET search_path TO whatsapp_hub, public;

-- ----------------------------------------------------------------------------
-- 1. RELÓGIO DE ETAPA — deals.stage_entered_at
-- ----------------------------------------------------------------------------
-- Nasce nulo, é preenchido com created_at para o que já existe (hoje: 0 deals)
-- e só então vira NOT NULL DEFAULT now(). Ordem importa: fazer NOT NULL antes
-- do backfill quebraria numa base com deals.
ALTER TABLE whatsapp_hub.deals ADD COLUMN IF NOT EXISTS stage_entered_at timestamptz;

UPDATE whatsapp_hub.deals
   SET stage_entered_at = created_at
 WHERE stage_entered_at IS NULL;

ALTER TABLE whatsapp_hub.deals ALTER COLUMN stage_entered_at SET DEFAULT now();
ALTER TABLE whatsapp_hub.deals ALTER COLUMN stage_entered_at SET NOT NULL;

COMMENT ON COLUMN whatsapp_hub.deals.stage_entered_at IS
  'Quando o deal entrou na etapa ATUAL. É o relógio de "parado há N dias". '
  'Na importação do WebDental recebe a Dt Orçamento, NUNCA a data do import.';

-- BEFORE UPDATE: carimba a entrada na etapa nova.
-- A guarda `NEW.stage_entered_at IS NOT DISTINCT FROM OLD.stage_entered_at`
-- existe para a importação: quando o UPDATE informa explicitamente outra data
-- (a Dt Orçamento, por exemplo), o trigger respeita o valor informado em vez
-- de sobrescrever com now(). Sem essa guarda, todo orçamento antigo entraria
-- como se tivesse nascido hoje e a régua dispararia errado.
CREATE OR REPLACE FUNCTION whatsapp_hub.deals_stage_clock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id
     AND NEW.stage_entered_at IS NOT DISTINCT FROM OLD.stage_entered_at THEN
    NEW.stage_entered_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deals_stage_clock_bu ON whatsapp_hub.deals;
CREATE TRIGGER deals_stage_clock_bu
  BEFORE UPDATE ON whatsapp_hub.deals
  FOR EACH ROW
  EXECUTE FUNCTION whatsapp_hub.deals_stage_clock();

-- AFTER INSERT/UPDATE: grava a linha de histórico em crm_activities.
-- SECURITY DEFINER porque o mesmo trigger precisa valer para o app (admin ou
-- recepção logados) e para as Edge Functions. Não há vazamento entre orgs: o
-- org_id gravado é o do PRÓPRIO deal (NEW.org_id), nunca o da sessão.
-- `done = true` porque é registro histórico, não tarefa pendente — assim não
-- aparece no badge de "próxima ação" do card.
CREATE OR REPLACE FUNCTION whatsapp_hub.deals_stage_change_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_from text;
  v_to   text;
BEGIN
  IF NEW.stage_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT s.name INTO v_to FROM whatsapp_hub.stages s WHERE s.id = NEW.stage_id;

  IF TG_OP = 'UPDATE' AND OLD.stage_id IS NOT NULL THEN
    SELECT s.name INTO v_from FROM whatsapp_hub.stages s WHERE s.id = OLD.stage_id;
  END IF;

  INSERT INTO whatsapp_hub.crm_activities
    (org_id, deal_id, contact_id, type, title, done, done_at)
  VALUES
    (NEW.org_id, NEW.id, NEW.contact_id, 'stage_change',
     COALESCE(v_from, '(criado)') || ' → ' || COALESCE(v_to, '(sem etapa)'),
     true, now());

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS deals_stage_change_activity_aiu ON whatsapp_hub.deals;
CREATE TRIGGER deals_stage_change_activity_aiu
  AFTER INSERT OR UPDATE OF stage_id ON whatsapp_hub.deals
  FOR EACH ROW
  EXECUTE FUNCTION whatsapp_hub.deals_stage_change_activity();

-- Índice do relógio: "quem está parado nesta etapa desde antes de X".
CREATE INDEX IF NOT EXISTS idx_deals_stage_clock
  ON whatsapp_hub.deals (stage_id, stage_entered_at)
  WHERE archived_at IS NULL;

-- ----------------------------------------------------------------------------
-- 2. CATÁLOGO DE PROCEDIMENTOS — troca da taxonomia de infoproduto
-- ----------------------------------------------------------------------------
-- Hoje a tabela está VAZIA (0 linhas), então a troca do CHECK não invalida
-- nenhum registro. Se um dia houver linha antiga, este ALTER falha alto — que
-- é o comportamento desejado (nada de dado silenciosamente fora da regra).
ALTER TABLE whatsapp_hub.products DROP CONSTRAINT IF EXISTS products_type_chk;
ALTER TABLE whatsapp_hub.products ADD CONSTRAINT products_type_chk
  CHECK (product_type = ANY (ARRAY[
    'clinica_geral', 'protese', 'implante', 'orto', 'endo',
    'perio', 'cirurgia', 'odontopediatria', 'estetica'
  ]::text[]));

ALTER TABLE whatsapp_hub.products ALTER COLUMN product_type SET DEFAULT 'clinica_geral';

-- ⚠️ Sem reescrever ESTE check, nenhum procedimento aceitaria quantidade:
-- o antigo exigia product_type='fisico', que deixou de existir.
ALTER TABLE whatsapp_hub.products DROP CONSTRAINT IF EXISTS products_quantity_chk;
ALTER TABLE whatsapp_hub.products ADD CONSTRAINT products_quantity_chk
  CHECK (quantity IS NULL OR quantity >= 0);

COMMENT ON COLUMN whatsapp_hub.products.product_type IS
  'Especialidade odontológica do procedimento. A franqueadora cobra leitura '
  'por especialidade (orto 35%, implante 10%, prótese 10%, clínica geral 85%).';

-- ----------------------------------------------------------------------------
-- 3. CHAVE ESTÁVEL DOS CAMPOS PERSONALIZADOS
-- ----------------------------------------------------------------------------
-- `label` é o nome em português mostrado na tela e o usuário pode renomear.
-- `key` é o identificador de máquina, usado pela importação diária.
ALTER TABLE whatsapp_hub.custom_fields ADD COLUMN IF NOT EXISTS key text;

CREATE UNIQUE INDEX IF NOT EXISTS custom_fields_org_key_uq
  ON whatsapp_hub.custom_fields (org_id, key)
  WHERE key IS NOT NULL;

COMMENT ON COLUMN whatsapp_hub.custom_fields.key IS
  'Chave estável (snake_case) usada por integrações. NULL em campo criado à '
  'mão pela tela, que continua sendo identificado só pelo label.';

-- Busca de deal por valor de campo (usada na conciliação da importação).
CREATE INDEX IF NOT EXISTS idx_custom_field_values_field_value
  ON whatsapp_hub.custom_field_values (custom_field_id, value);

-- ----------------------------------------------------------------------------
-- 4. FUNIL DESATIVÁVEL (o dono autorizou desativar, não excluir)
-- ----------------------------------------------------------------------------
ALTER TABLE whatsapp_hub.pipelines
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN whatsapp_hub.pipelines.is_active IS
  'Funil desativado some dos seletores da interface mas NÃO é excluído — os '
  'deals e o histórico continuam íntegros.';

-- ----------------------------------------------------------------------------
-- 5. IDEMPOTÊNCIA DA IMPORTAÇÃO — deals.external_ref
-- ----------------------------------------------------------------------------
-- Chave determinística do orçamento no relatório de origem. Formato usado pelo
-- importador do WebDental:
--   'webdental:<telefone canônico>:<slug do paciente>:<AAAA-MM-DD>'
-- O paciente entra na chave porque 4 telefones do arquivo real atendem MAIS DE
-- UM paciente (família) — um deles atende 3 pessoas. Sem o nome, os orçamentos
-- da mesma casa colidiriam num só.
ALTER TABLE whatsapp_hub.deals ADD COLUMN IF NOT EXISTS external_ref text;

CREATE UNIQUE INDEX IF NOT EXISTS deals_org_external_ref_uq
  ON whatsapp_hub.deals (org_id, external_ref)
  WHERE external_ref IS NOT NULL;

COMMENT ON COLUMN whatsapp_hub.deals.external_ref IS
  'Identidade do registro no sistema de origem. Trava de idempotência: '
  'reimportar o mesmo relatório atualiza, nunca duplica.';
