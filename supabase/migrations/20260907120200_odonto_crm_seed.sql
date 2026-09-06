-- ============================================================================
-- 20260907120200_odonto_crm_seed
-- ----------------------------------------------------------------------------
-- Dado de configuração do CRM odonto: funil, campos do orçamento, catálogo de
-- procedimentos e a régua D+1/D+3/D+7 (DESATIVADA).
--
-- Tudo aqui é IDEMPOTENTE: rodar de novo não duplica nem sobrescreve o que o
-- dono tiver ajustado pela tela.
--
-- DECISÕES DO DONO (Danilo, 06/09/2026 — MEMORIA.md):
--   · funil "Odonto — Orçamentos" com 5 etapas, vira o funil PADRÃO
--   · os 2 funis do seed do template ("Vendas" e "Pós-venda") são DESATIVADOS,
--     nunca excluídos — não têm nenhum deal, mas o histórico fica
--   · régua até 7 dias: D+1, D+3, D+7; depois disso o orçamento encerra como
--     não aprovado (quem encerra é a importação diária, não a régua)
--   · as regras nascem DESATIVADAS e SEM TEMPLATE: o texto que vai para o
--     paciente é responsabilidade do dono (publicidade odontológica / CFO)
--
-- NOMENCLATURA OBRIGATÓRIA (ODONTO.md §4): quem paga preço com desconto é
-- FILIADO do Cartão de TODOS — nunca "sócio".
-- ============================================================================

SET search_path TO whatsapp_hub, public;

DO $$
DECLARE
  v_org        uuid;
  v_pipeline   uuid;
  v_stage_ap   uuid;
BEGIN
  FOR v_org IN SELECT id FROM whatsapp_hub.organizations LOOP

    -- ------------------------------------------------------------------------
    -- 1. FUNIL "Odonto — Orçamentos"
    -- ------------------------------------------------------------------------
    SELECT id INTO v_pipeline
      FROM whatsapp_hub.pipelines
     WHERE org_id = v_org AND name = 'Odonto — Orçamentos';

    IF v_pipeline IS NULL THEN
      INSERT INTO whatsapp_hub.pipelines (org_id, name, kind, position, is_default, is_active)
      VALUES (v_org, 'Odonto — Orçamentos', 'comercial', 0, true, true)
      RETURNING id INTO v_pipeline;
    END IF;

    -- As 5 etapas. `probability` alimenta o forecast (Σ valor × probability) e
    -- é ponto de partida — recalibrar com 60 dias de histórico real.
    INSERT INTO whatsapp_hub.stages (org_id, pipeline_id, name, position, is_won, is_lost, probability)
    SELECT v_org, v_pipeline, s.name, s.pos, s.won, s.lost, s.prob
      FROM (VALUES
        ('Orçamento apresentado', 0, false, false,  20),
        ('Em negociação',         1, false, false,  45),
        ('Aguardando decisão',    2, false, false,  70),
        ('Aprovado',              3, true,  false, 100),
        ('Não aprovado',          4, false, true,    0)
      ) AS s(name, pos, won, lost, prob)
     WHERE NOT EXISTS (
       SELECT 1 FROM whatsapp_hub.stages x
        WHERE x.pipeline_id = v_pipeline AND x.name = s.name
     );

    SELECT id INTO v_stage_ap
      FROM whatsapp_hub.stages
     WHERE pipeline_id = v_pipeline AND name = 'Orçamento apresentado';

    -- Odonto passa a ser o funil padrão; os demais deixam de ser.
    UPDATE whatsapp_hub.pipelines
       SET is_default = (id = v_pipeline)
     WHERE org_id = v_org;

    -- ------------------------------------------------------------------------
    -- 2. FUNIS DO SEED DO TEMPLATE — DESATIVAR (não excluir)
    -- ------------------------------------------------------------------------
    UPDATE whatsapp_hub.pipelines
       SET is_active = false
     WHERE org_id = v_org
       AND name IN ('Vendas', 'Pós-venda')
       AND id <> v_pipeline;

    -- ------------------------------------------------------------------------
    -- 3. CAMPOS DO ORÇAMENTO
    -- ------------------------------------------------------------------------
    -- Só o que o relatório *Controle de Efetivação* realmente traz. Nada é
    -- inventado. `paciente_nome` existe porque o CONTATO é o telefone (a
    -- conversa do WhatsApp) e o telefone pode atender a família inteira —
    -- 4 telefones do arquivo real atendem mais de um paciente.
    INSERT INTO whatsapp_hub.custom_fields (org_id, key, label, field_type, options, required, position)
    SELECT v_org, f.key, f.label, f.ftype, f.opts, false, f.pos
      FROM (VALUES
        ('paciente_nome',         'Paciente',                      'text',   NULL::jsonb, 1),
        ('dt_orcamento',          'Data do orçamento',             'date',   NULL::jsonb, 2),
        ('tratamento',            'Tratamento(s)',                 'text',   NULL::jsonb, 3),
        ('especialidade',         'Especialidade',                 'select',
           '["Clínica Geral","Prótese","Implantodontia","Ortodontia","Endodontia","Periodontia","Cirurgia","Odontopediatria","Estética"]'::jsonb, 4),
        ('dentista',              'Dentista (prestador)',          'text',   NULL::jsonb, 5),
        ('tabela_preco',          'Tabela de preço',               'select',
           '["Filiado (Cartão de TODOS)","Particular","Life Premium"]'::jsonb, 6),
        ('participacao_convenio', 'Participação do convênio (R$)', 'number', NULL::jsonb, 7),
        ('dt_agenda',             'Data da agenda',                'date',   NULL::jsonb, 8),
        ('origem_import',         'Origem da importação',          'text',   NULL::jsonb, 9)
      ) AS f(key, label, ftype, opts, pos)
     WHERE NOT EXISTS (
       SELECT 1 FROM whatsapp_hub.custom_fields x
        WHERE x.org_id = v_org AND x.key = f.key
     );

    -- ------------------------------------------------------------------------
    -- 4. CATÁLOGO DE PROCEDIMENTOS
    -- ------------------------------------------------------------------------
    -- Os 4 que existem no arquivo real (81 tratamentos):
    -- Clínica Geral 65 · Prótese 13 · Ortodontia 2 · Implantodontia 1.
    INSERT INTO whatsapp_hub.products (org_id, name, product_type, quantity, description)
    SELECT v_org, p.name, p.ptype, NULL, 'Procedimento do relatório Controle de Efetivação (WebDental).'
      FROM (VALUES
        ('Clínica Geral',  'clinica_geral'),
        ('Prótese',        'protese'),
        ('Ortodontia',     'orto'),
        ('Implantodontia', 'implante')
      ) AS p(name, ptype)
     WHERE NOT EXISTS (
       SELECT 1 FROM whatsapp_hub.products x
        WHERE x.org_id = v_org AND x.name = p.name
     );

    -- ------------------------------------------------------------------------
    -- 5. RÉGUA D+1 / D+3 / D+7 — estrutura pronta, DESLIGADA
    -- ------------------------------------------------------------------------
    -- `template_id` NULL de propósito: o texto que vai ao paciente é do dono
    -- (publicidade odontológica). `is_active = false` porque o motor
    -- (check-follow-ups) ainda não implementa `stage_stalled`.
    IF v_stage_ap IS NOT NULL THEN
      INSERT INTO whatsapp_hub.follow_up_rules
        (org_id, campaign_id, trigger_condition, delay_hours, template_id,
         sequence_order, is_active, provider, message_text, params)
      SELECT v_org, NULL, 'stage_stalled', r.hours, NULL, r.ord, false, 'meta', NULL,
             jsonb_build_object(
               'pipeline_id', v_pipeline,
               'stage_id',    v_stage_ap,
               'days',        r.days,
               'source',      'odonto'
             )
        FROM (VALUES (1, 24, 1), (2, 72, 3), (3, 168, 7)) AS r(ord, hours, days)
       WHERE NOT EXISTS (
         SELECT 1 FROM whatsapp_hub.follow_up_rules x
          WHERE x.org_id = v_org
            AND x.trigger_condition = 'stage_stalled'
            AND x.params ->> 'stage_id' = v_stage_ap::text
            AND (x.params ->> 'days')::int = r.days
       );
    END IF;

  END LOOP;
END;
$$;
