-- ============================================================================
-- Acertos de dado em conversas — 06/10/2026 (frente configuração, bifurcação)
-- Pedido do Danilo: "faça todas correções". NÃO APLICADO pelo agente: a trava
-- de permissões do Claude Code bloqueou a gravação. Rodar à mão no SQL Editor
-- do Supabase (projeto feptvmsjzreovfynrlql) ou liberar o agente.
--
-- ORDEM: 1º a migration supabase/migrations/20261006120000_reabrir_conversa_fechada.sql
--        2º o bloco A   3º o bloco B
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A. Conversas abertas de quem não usa o CRM → Larah e Millena (alternando)
--    9 conversas: 4 da Nathaly, 4 da Andressa, 1 sem dona.
--    Dona ANTES (para reverter):
--      andressamcbf ........ 8b80b4f1 · c1ae9941 · 4647d6cb · 5934ffe7
--      nathalypereiraburgues 1f2fd73e · 0cfb4951 · 1c245c7d · fa08aabd
--      (sem dona) .......... b085d4bf
-- ---------------------------------------------------------------------------
with alvo as (
  select c.id, row_number() over (order by c.last_message_at desc, c.id) rn
  from whatsapp_hub.conversations c
  where c.id in ('8b80b4f1-406b-4b6f-a30e-b463931ad598','c1ae9941-03de-4b2b-a63d-2b049fe73a6c',
                 '1f2fd73e-5a89-49d1-809d-c5e94f542d10','4647d6cb-19b2-4f2c-83ff-a5a6760d6c1a',
                 '0cfb4951-6102-423a-b5c0-3b8286be63dc','5934ffe7-b704-4b6e-b086-139d08fb48b2',
                 '1c245c7d-a604-4710-a437-effc87fba0ed','fa08aabd-6d95-4a8f-968e-851a24d91509',
                 'b085d4bf-cd12-4c20-9387-9fe145d3f474')
    and c.status::text <> 'closed'),
dest as (select (select id from auth.users where email='mangabeiralarah@gmail.com') larah,
                (select id from auth.users where email='adm.millena@outlook.com') millena)
update whatsapp_hub.conversations c
   set assigned_to = case when a.rn % 2 = 1 then d.larah else d.millena end,
       assigned_at = '2026-10-06 15:00:00+00'          -- carimbo que isola estas linhas
  from alvo a, dest d
 where c.id = a.id;
-- Esperado: 9 linhas (5 Larah, 4 Millena).
-- REVERTER A:
--   update whatsapp_hub.conversations set assigned_to=(select id from auth.users where email='andressamcbf@gmail.com')
--    where assigned_at='2026-10-06 15:00:00+00' and left(id::text,8) in ('8b80b4f1','c1ae9941','4647d6cb','5934ffe7');
--   update whatsapp_hub.conversations set assigned_to=(select id from auth.users where email='nathalypereiraburgues@gmail.com')
--    where assigned_at='2026-10-06 15:00:00+00' and left(id::text,8) in ('1f2fd73e','0cfb4951','1c245c7d','fa08aabd');
--   update whatsapp_hub.conversations set assigned_to=null, assigned_at=null where id='b085d4bf-cd12-4c20-9387-9fe145d3f474';

-- ---------------------------------------------------------------------------
-- B. Reabrir as conversas FECHADAS em que o paciente falou por último
--    20 de 27. Ficaram de fora 7 em que a última fala é só despedida
--    ("Obrigada", "Obg", "Ok", "Já não tenho interesse", "Eu q agradeço").
--    Reabre no humano, com a IA pausada, mantendo a dona (Millena 18, Larah 2).
-- ---------------------------------------------------------------------------
update whatsapp_hub.conversations
   set status = 'human_active', ai_paused = true, closed_at = null
 where status::text = 'closed'
   and id in ('b7bb9b0f-a004-4fe1-a7a5-c5af8ccceda3','d65e837d-f7c7-4daf-bb96-3ad0645085eb',
              '0fa60d1d-79e4-4e79-8e16-0550ccd6aa00','ea8238d1-60fc-4c4b-9ac9-be9689b699a8',
              '9d13a4c5-d78c-40a5-9c5f-694b5f96b6e9','85f435bb-0aeb-4ba7-abf5-09247f31f112',
              '9ca5ccea-80ae-4d54-af8c-5d49111ef745','62ae68dc-935f-46c8-8232-08789f5ff523',
              'cbfb02da-012c-46f5-9553-42d95a572634','c2944871-aec6-46e5-96fd-d9e318ceaa47',
              'a73fd282-2311-49c1-bf00-f144664553a8','4bc999a7-8576-45a2-8351-952e97e082bd',
              '4c12527d-591b-409c-b08c-cbbc34138158','4074cd5d-f23c-4568-82aa-190be6496f67',
              '68b0c58b-2eac-4986-8cc5-8983dbba18f8','554e36f5-3180-4392-b168-a02e9c0cfefa',
              'b4228c1b-989b-405e-8778-db44dd5c15f8','06837ae8-ed37-4808-9438-49be6dd5e5d2',
              '453e4f8b-876b-4529-82dd-bb677719f1b5','313d586b-a249-4c5e-bd6c-d0f98ac8675f');
-- Esperado: 20 linhas.
-- REVERTER B (fecha de novo as mesmas; a data original de fechamento não volta):
--   update whatsapp_hub.conversations set status='closed', closed_at=now() where id in (<os mesmos 20 ids>);
