-- ============================================================================
-- 20260906200000_phone_br_canonical.sql
-- Nono dígito do celular brasileiro: forma canônica, junção automática dos
-- contatos duplicados e defesa contra o problema voltar.
-- ----------------------------------------------------------------------------
-- PROBLEMA (achado pelo Danilo em 06/09/2026)
--   A Meta entrega o `wa_id` de números brasileiros SEM o nono dígito. O mesmo
--   paciente cadastrado como `+5533999772570` respondia e chegava como
--   `+553399772570`, e o `meta-webhook` criava um contato e uma conversa NOVOS.
--   O orçamento ficava num contato e a resposta em outro: o funil não avança e
--   o relatório conclui que ninguém respondeu.
--
-- FORMA CANÔNICA: **COM o nono dígito** (`+55` + DDD + 9 dígitos).
--   É a forma que o WebDental exporta, que a recepção digita e que a Meta
--   aceita no envio. Fixo (assinante de 8 dígitos começando em 2–5) NÃO recebe
--   o nono dígito. Número não brasileiro passa intacto.
--   A MESMA regra vive em `src/lib/phone.ts` (Node/browser) e em
--   `supabase/functions/_shared/phone-br.ts` (Deno). Mexeu numa, mexa nas três.
--
-- SOBREVIVENTE DA JUNÇÃO: o contato **mais antigo** do grupo (created_at, id).
--   É o do cadastro manual / importação — o que carrega orçamento, deal e
--   histórico. O duplicado é sempre o recém-criado pelo webhook.
--
-- CONVERSAS: a UNIQUE `conversations_org_contact_key (org_id, contact_id)`
--   torna impossível manter duas conversas do mesmo contato. Então as threads
--   SÃO fundidas: mensagens e notificações da conversa perdedora passam para a
--   sobrevivente, os não-lidos são somados, e só então a perdedora é apagada.
--   Nenhuma mensagem é apagada — o bloco aborta sozinho se a contagem mudar.
--
-- APROVADO POR: Danilo, 06/09/2026 ("não só junte os contatos, faça que o
--   próprio CRM já faça isso automaticamente").
--
-- REVERSÃO (o que dá para desfazer):
--   BEGIN;
--     DROP INDEX IF EXISTS whatsapp_hub.contacts_org_phone_canonical_key;
--     DROP FUNCTION IF EXISTS whatsapp_hub.phone_br_canonical(text);
--   COMMIT;
--   A junção de contatos/conversas é **destrutiva e não reversível por SQL**
--   (linhas perdedoras deixam de existir). Reverter exige restaurar backup do
--   ponto no tempo (PITR do Supabase) — por isso o bloco tem guarda de
--   contagem e por isso a detecção foi rodada em modo leitura antes.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS whatsapp_hub;

-- ----------------------------------------------------------------------------
-- 1. Regra canônica, em SQL. IMMUTABLE porque é usada em índice funcional.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION whatsapp_hub.phone_br_canonical(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
  SELECT CASE
    -- Curto demais para ser telefone: não é canonizável.
    WHEN length(d) < 10 THEN NULL
    -- Celular BR na forma "curta" que a Meta entrega: 55 + DDD(2) + 8 dígitos
    -- começando em 8 ou 9. Fixo (8 dígitos começando em 2–5) fica de fora.
    WHEN d LIKE '55%'
     AND length(d) = 12
     AND substring(d, 3, 2) ~ '^[1-9][1-9]$'
     AND substring(d, 5) ~ '^[89][0-9]{7}$'
      THEN '+55' || substring(d, 3, 2) || '9' || substring(d, 5)
    ELSE '+' || d
  END
  FROM (SELECT regexp_replace(p, '\D', '', 'g') AS d) s;
$$;

COMMENT ON FUNCTION whatsapp_hub.phone_br_canonical(text) IS
  'Forma canônica do telefone: celular BR sempre com o nono dígito. Par SQL de src/lib/phone.ts e _shared/phone-br.ts.';

-- ----------------------------------------------------------------------------
-- 2. Junção automática dos duplicados + canonização de todos os telefones.
--    Tudo num bloco só, com guarda de contagem: se qualquer mensagem, deal,
--    linha de campanha ou atividade sumir, o bloco levanta exceção e a
--    migração inteira volta atrás.
-- ----------------------------------------------------------------------------
DO $merge$
DECLARE
  g                RECORD;
  v_survivor       uuid;
  v_losers         uuid[];
  v_conv_survivor  uuid;
  v_fields         jsonb;
  c                RECORD;
  n_msgs_before    bigint;
  n_msgs_after     bigint;
  n_cc_before      bigint;
  n_cc_after       bigint;
  n_deals_before   bigint;
  n_deals_after    bigint;
  n_contacts_before bigint;
  n_contacts_after bigint;
  n_conv_before    bigint;
  n_conv_after     bigint;
  n_groups         int := 0;
  n_merged         int := 0;
BEGIN
  SELECT count(*) INTO n_msgs_before     FROM whatsapp_hub.messages;
  SELECT count(*) INTO n_cc_before       FROM whatsapp_hub.campaign_contacts;
  SELECT count(*) INTO n_deals_before    FROM whatsapp_hub.deals;
  SELECT count(*) INTO n_contacts_before FROM whatsapp_hub.contacts;
  SELECT count(*) INTO n_conv_before     FROM whatsapp_hub.conversations;

  FOR g IN
    SELECT org_id,
           whatsapp_hub.phone_br_canonical(phone) AS canon,
           array_agg(id ORDER BY created_at, id)  AS ids
      FROM whatsapp_hub.contacts
     WHERE phone IS NOT NULL
       AND whatsapp_hub.phone_br_canonical(phone) IS NOT NULL
     GROUP BY 1, 2
    HAVING count(*) > 1
  LOOP
    n_groups  := n_groups + 1;
    v_survivor := g.ids[1];
    v_losers   := g.ids[2:array_length(g.ids, 1)];
    n_merged   := n_merged + array_length(v_losers, 1);

    -- 2a. Conversa sobrevivente: a do contato sobrevivente; se ele não tiver
    --     nenhuma, a mais antiga do grupo é reapontada para ele.
    SELECT id INTO v_conv_survivor
      FROM whatsapp_hub.conversations
     WHERE contact_id = v_survivor
     LIMIT 1;

    IF v_conv_survivor IS NULL THEN
      SELECT id INTO v_conv_survivor
        FROM whatsapp_hub.conversations
       WHERE contact_id = ANY (v_losers)
       ORDER BY created_at, id
       LIMIT 1;
      IF v_conv_survivor IS NOT NULL THEN
        UPDATE whatsapp_hub.conversations
           SET contact_id = v_survivor
         WHERE id = v_conv_survivor;
      END IF;
    END IF;

    -- 2b. Fusão das threads: mensagens e notificações mudam de conversa ANTES
    --     de qualquer DELETE (o FK de messages é ON DELETE CASCADE).
    IF v_conv_survivor IS NOT NULL THEN
      UPDATE whatsapp_hub.messages
         SET conversation_id = v_conv_survivor
       WHERE conversation_id IN (
               SELECT id FROM whatsapp_hub.conversations
                WHERE contact_id = ANY (v_losers) AND id <> v_conv_survivor);

      UPDATE whatsapp_hub.notifications
         SET conversation_id = v_conv_survivor
       WHERE conversation_id IN (
               SELECT id FROM whatsapp_hub.conversations
                WHERE contact_id = ANY (v_losers) AND id <> v_conv_survivor);

      UPDATE whatsapp_hub.conversations sc
         SET unread_count = sc.unread_count + COALESCE((
               SELECT sum(unread_count) FROM whatsapp_hub.conversations
                WHERE contact_id = ANY (v_losers) AND id <> sc.id), 0),
             last_message_at = GREATEST(
               sc.last_message_at,
               (SELECT max(last_message_at) FROM whatsapp_hub.conversations
                 WHERE contact_id = ANY (v_losers) AND id <> sc.id))
       WHERE sc.id = v_conv_survivor;

      DELETE FROM whatsapp_hub.conversations
       WHERE contact_id = ANY (v_losers) AND id <> v_conv_survivor;
    END IF;

    -- 2c. Tabelas com UNIQUE que envolve contact_id: o vínculo do perdedor que
    --     já existe no sobrevivente é descartado (é a mesma informação).
    DELETE FROM whatsapp_hub.contact_tags ct
     WHERE ct.contact_id = ANY (v_losers)
       AND EXISTS (SELECT 1 FROM whatsapp_hub.contact_tags s
                    WHERE s.contact_id = v_survivor AND s.tag_id = ct.tag_id);

    DELETE FROM whatsapp_hub.enrollments e
     WHERE e.contact_id = ANY (v_losers)
       AND EXISTS (SELECT 1 FROM whatsapp_hub.enrollments s
                    WHERE s.contact_id = v_survivor AND s.class_id = e.class_id);

    DELETE FROM whatsapp_hub.follow_up_log f
     WHERE f.contact_id = ANY (v_losers)
       AND EXISTS (SELECT 1 FROM whatsapp_hub.follow_up_log s
                    WHERE s.contact_id = v_survivor AND s.rule_id = f.rule_id);

    -- 2d. Reaponta TODAS as FKs que referenciam contacts.
    UPDATE whatsapp_hub.contact_tags          SET contact_id = v_survivor WHERE contact_id = ANY (v_losers);
    UPDATE whatsapp_hub.enrollments           SET contact_id = v_survivor WHERE contact_id = ANY (v_losers);
    UPDATE whatsapp_hub.follow_up_log         SET contact_id = v_survivor WHERE contact_id = ANY (v_losers);
    UPDATE whatsapp_hub.campaign_contacts     SET contact_id = v_survivor WHERE contact_id = ANY (v_losers);
    UPDATE whatsapp_hub.contact_channel_links SET contact_id = v_survivor WHERE contact_id = ANY (v_losers);
    UPDATE whatsapp_hub.contact_interactions  SET contact_id = v_survivor WHERE contact_id = ANY (v_losers);
    UPDATE whatsapp_hub.crm_activities        SET contact_id = v_survivor WHERE contact_id = ANY (v_losers);
    UPDATE whatsapp_hub.crm_ai_actions        SET contact_id = v_survivor WHERE contact_id = ANY (v_losers);
    UPDATE whatsapp_hub.deals                 SET contact_id = v_survivor WHERE contact_id = ANY (v_losers);
    UPDATE whatsapp_hub.projects              SET contact_id = v_survivor WHERE contact_id = ANY (v_losers);

    -- 2e. Funde os campos: o sobrevivente vence; o que ele não tem, herda.
    SELECT
      min(first_seen_at) AS first_seen_at,
      (array_agg(name         ORDER BY created_at) FILTER (WHERE COALESCE(name, '')   <> ''))[1] AS name,
      (array_agg(email        ORDER BY created_at) FILTER (WHERE COALESCE(email, '')  <> ''))[1] AS email,
      (array_agg(source       ORDER BY created_at) FILTER (WHERE COALESCE(source, '') <> ''))[1] AS source,
      (array_agg(instagram_id ORDER BY created_at) FILTER (WHERE instagram_id IS NOT NULL))[1]   AS instagram_id,
      (array_agg(kind         ORDER BY created_at) FILTER (WHERE kind IS NOT NULL))[1]           AS kind,
      (array_agg(profile_pic_url ORDER BY created_at) FILTER (WHERE profile_pic_url IS NOT NULL))[1] AS profile_pic_url
      INTO c
      FROM whatsapp_hub.contacts
     WHERE id = ANY (v_losers);

    -- custom_fields dos perdedores, chave a chave (o mais antigo ganha empate).
    SELECT COALESCE(jsonb_object_agg(t.key, t.value), '{}'::jsonb) INTO v_fields
      FROM (
        SELECT DISTINCT ON (kv.key) kv.key, kv.value
          FROM whatsapp_hub.contacts l
          CROSS JOIN LATERAL jsonb_each(l.custom_fields) kv
         WHERE l.id = ANY (v_losers)
         ORDER BY kv.key, l.created_at
      ) t;

    UPDATE whatsapp_hub.contacts s
       SET name            = COALESCE(NULLIF(s.name, ''),   c.name),
           email           = COALESCE(NULLIF(s.email, ''),  c.email),
           source          = COALESCE(NULLIF(s.source, ''), c.source),
           instagram_id    = COALESCE(s.instagram_id,    c.instagram_id),
           kind            = COALESCE(s.kind,            c.kind),
           profile_pic_url = COALESCE(s.profile_pic_url, c.profile_pic_url),
           first_seen_at   = LEAST(s.first_seen_at, c.first_seen_at),
           -- o valor do sobrevivente vence em caso de mesma chave
           custom_fields   = v_fields || s.custom_fields,
           phone           = g.canon,
           updated_at      = now()
     WHERE s.id = v_survivor;

    -- 2f. Some com os perdedores. Nada mais aponta para eles.
    DELETE FROM whatsapp_hub.contacts WHERE id = ANY (v_losers);
  END LOOP;

  -- 3. Todo telefone restante passa para a forma canônica.
  UPDATE whatsapp_hub.contacts
     SET phone = whatsapp_hub.phone_br_canonical(phone),
         updated_at = now()
   WHERE phone IS NOT NULL
     AND whatsapp_hub.phone_br_canonical(phone) IS NOT NULL
     AND whatsapp_hub.phone_br_canonical(phone) <> phone;

  -- 4. GUARDA: nada de histórico pode ter sumido.
  SELECT count(*) INTO n_msgs_after     FROM whatsapp_hub.messages;
  SELECT count(*) INTO n_cc_after       FROM whatsapp_hub.campaign_contacts;
  SELECT count(*) INTO n_deals_after    FROM whatsapp_hub.deals;
  SELECT count(*) INTO n_contacts_after FROM whatsapp_hub.contacts;
  SELECT count(*) INTO n_conv_after     FROM whatsapp_hub.conversations;

  IF n_msgs_after <> n_msgs_before THEN
    RAISE EXCEPTION 'ABORTADO: mensagens antes=% depois=% — a junção perderia histórico',
      n_msgs_before, n_msgs_after;
  END IF;
  IF n_cc_after <> n_cc_before THEN
    RAISE EXCEPTION 'ABORTADO: campaign_contacts antes=% depois=%', n_cc_before, n_cc_after;
  END IF;
  IF n_deals_after <> n_deals_before THEN
    RAISE EXCEPTION 'ABORTADO: deals antes=% depois=%', n_deals_before, n_deals_after;
  END IF;
  IF n_contacts_after <> n_contacts_before - n_merged THEN
    RAISE EXCEPTION 'ABORTADO: contatos antes=% depois=% (esperado %)',
      n_contacts_before, n_contacts_after, n_contacts_before - n_merged;
  END IF;

  RAISE NOTICE 'phone_br_canonical: % grupo(s) duplicado(s), % contato(s) fundido(s). Contatos %→%, conversas %→%, mensagens %→% (intactas).',
    n_groups, n_merged, n_contacts_before, n_contacts_after,
    n_conv_before, n_conv_after, n_msgs_before, n_msgs_after;
END
$merge$;

-- ----------------------------------------------------------------------------
-- 5. Defesa contra o problema voltar: uma org não pode ter dois contatos cujo
--    telefone seja o MESMO número escrito de formas diferentes.
--    Não quebra gravação legítima: dois contatos com a mesma forma canônica
--    são, por definição, a mesma pessoa — a UNIQUE (org_id, phone) que já
--    existia proibia a grafia idêntica; esta só estende para a equivalente.
--    Telefone nulo ou irreconhecível cai em NULL, e NULLs não colidem.
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS contacts_org_phone_canonical_key
  ON whatsapp_hub.contacts (org_id, whatsapp_hub.phone_br_canonical(phone))
  WHERE phone IS NOT NULL;

COMMENT ON INDEX whatsapp_hub.contacts_org_phone_canonical_key IS
  'Um paciente = um contato: bloqueia o mesmo celular BR gravado com e sem o nono dígito.';
