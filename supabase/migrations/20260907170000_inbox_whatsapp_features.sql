-- ============================================================================
-- Inbox: os recursos de conversa que o WhatsApp tem e o CRM não tinha.
--
-- Responder citando · reagir com emoji · encaminhar · apagar · fixar conversa
-- no topo · silenciar. (Buscar dentro da conversa não entra aqui: as mensagens
-- já vêm carregadas no cliente, filtrar no banco seria uma ida de rede a mais
-- para nada.)
--
-- Idempotente de propósito — o Lovable não aplica migration sozinho e este
-- arquivo pode ser rodado à mão mais de uma vez.
--
-- RLS: `messages_write` e `conversations_write` já são policies `ALL` para
-- admin/operator, então UPDATE nas colunas novas está coberto. Nada a criar.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS whatsapp_hub;
SET search_path TO whatsapp_hub;

-- ---------------------------------------------------------------------------
-- conversations: fixar e silenciar
-- ---------------------------------------------------------------------------

-- Fixar é da INSTÂNCIA, não de cada atendente: a recepção trabalha no mesmo
-- número, e "o caso quente do dia" precisa estar no topo para todo mundo.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false;

-- Silenciar tem VALIDADE em vez de ser um booleano: silenciar para sempre é
-- como um paciente some sem ninguém perceber. O 'infinito' fica representado
-- por uma data muito distante, escolhida por quem chama.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ;

-- Só as fixadas entram no índice — são poucas, e a lista as consulta em toda
-- ordenação.
CREATE INDEX IF NOT EXISTS idx_conversations_pinned
  ON conversations (org_id, last_message_at DESC)
  WHERE pinned;

-- ---------------------------------------------------------------------------
-- messages: citar, reagir, encaminhar, apagar
-- ---------------------------------------------------------------------------

-- Citação. ON DELETE SET NULL: apagar a mensagem original não pode derrubar a
-- resposta junto — o histórico do atendimento é registro de saúde.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_reply_to
  ON messages (reply_to_id)
  WHERE reply_to_id IS NOT NULL;

-- Duas colunas de reação porque são dois lados independentes: a clínica pode
-- reagir 👍 e o paciente ❤️ na MESMA mensagem, e cada um pode trocar a sua sem
-- apagar a do outro. Uma coluna só perderia uma das duas.
--   reaction         = a reação que a clínica enviou
--   contact_reaction = a que o paciente enviou (chega pelo webhook)
-- Emoji, ou NULL quando removida. O WhatsApp permite uma por pessoa.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS reaction TEXT;
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS contact_reaction TEXT;

-- Marca visual "Encaminhada", igual à do WhatsApp. Guardamos também de onde
-- veio, para a atendente conseguir voltar à conversa de origem.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS forwarded BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS forwarded_from_id UUID REFERENCES messages(id) ON DELETE SET NULL;

-- Apagar é LÓGICO, nunca DELETE.
--
-- Duas razões, e a segunda é a que importa:
--   1. a Cloud API da Meta não tem endpoint para apagar mensagem já entregue —
--      o que sai daqui NÃO some do celular do paciente;
--   2. conversa de clínica é registro de atendimento. Sumir com a linha do
--      banco apaga prova de que algo foi combinado.
-- A tela precisa deixar claro que some só do CRM; caso contrário a atendente
-- acredita que o paciente deixou de ver.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN messages.deleted_at IS
  'Apagada NO CRM. A Meta não permite apagar mensagem já entregue: o paciente continua vendo.';
COMMENT ON COLUMN conversations.muted_until IS
  'Silenciada até esta data. NULL = com som. Não afeta o recebimento, só o alerta.';

-- ---------------------------------------------------------------------------
-- Parte 2 — o resto dos dois menus do WhatsApp Desktop
-- ---------------------------------------------------------------------------

-- Favoritar mensagem (a estrela).
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS starred BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_messages_starred
  ON messages (org_id, created_at DESC)
  WHERE starred;

-- Fixar mensagem DENTRO da conversa — outra coisa que fixar a conversa na
-- lista. No WhatsApp as duas ações existem e têm nomes iguais; aqui também.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_messages_pinned
  ON messages (conversation_id)
  WHERE pinned;

-- Bloquear contato. Guardamos QUEM e QUANDO: bloquear paciente de clínica é
-- decisão que alguém precisa conseguir justificar depois.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS blocked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- "Limpar conversa" marca A PARTIR DE QUANDO a thread aparece, em vez de
-- apagar linhas. O WhatsApp pessoal pode destruir histórico; um registro de
-- atendimento não pode. A recepção vê a conversa limpa; o histórico continua
-- íntegro para auditoria.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ;

COMMENT ON COLUMN conversations.cleared_at IS
  'Mensagens anteriores a esta data ficam ocultas na tela. As linhas continuam no banco: registro de atendimento não se apaga.';
COMMENT ON COLUMN contacts.blocked_at IS
  'Contato bloqueado no CRM: não recebe disparo nem resposta da IA. O bloqueio na Meta é separado.';
