-- ============================================================================
-- 20260907120300_deals_external_ref_index_full
-- ----------------------------------------------------------------------------
-- Correção de `20260907120000_odonto_crm_estrutura`.
--
-- O índice `deals_org_external_ref_uq` nasceu PARCIAL
-- (`WHERE external_ref IS NOT NULL`). Índice único parcial NÃO é inferível por
-- `INSERT ... ON CONFLICT (org_id, external_ref)` — e é exatamente assim que o
-- PostgREST monta o upsert do importador. O resultado seria um erro
-- "no unique or exclusion constraint matching the ON CONFLICT specification"
-- na primeira importação, com o dono na frente da tela.
--
-- O predicado era desnecessário: no PostgreSQL, NULL não colide com NULL em
-- índice único. Um índice CHEIO sobre (org_id, external_ref) continua
-- permitindo quantos deals sem `external_ref` existirem — que é todo deal
-- criado à mão pela tela do funil.
--
-- Nada de dado muda; só a definição do índice.
-- ============================================================================

SET search_path TO whatsapp_hub, public;

DROP INDEX IF EXISTS whatsapp_hub.deals_org_external_ref_uq;

CREATE UNIQUE INDEX IF NOT EXISTS deals_org_external_ref_uq
  ON whatsapp_hub.deals (org_id, external_ref);
