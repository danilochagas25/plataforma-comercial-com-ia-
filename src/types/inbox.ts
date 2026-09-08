export type ConversationStatus = 'ai_active' | 'human_active' | 'closed';
export type ConversationChannel = 'whatsapp' | 'instagram';
export type MessageDirection = 'inbound' | 'outbound';
// 'owner' = mensagem que o dono do número enviou direto pelo WhatsApp do
// celular (fora do CRM), capturada pelo webhook UAZAPI. Renderiza como "WhatsApp".
export type SenderType = 'contact' | 'ai' | 'operator' | 'system' | 'owner';
export type ContentType = 'text' | 'image' | 'audio' | 'video' | 'document' | 'template' | 'note';
export type MetaMessageStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface Conversation {
  id: string;
  contact_id: string;
  status: ConversationStatus;
  assigned_to: string | null;
  assigned_at: string | null;
  ai_paused: boolean;
  channel: ConversationChannel;
  // Negócio (deal) em foco nesta conversa. Independente de assigned_to/owner_id.
  active_deal_id: string | null;
  last_message_at: string | null;
  unread_count: number;
  pinned_note: string | null;
  archived: boolean;
  // Fixada no topo da lista. Vale para a instância inteira, não por atendente:
  // a recepção trabalha no mesmo número e o caso quente é o mesmo para todos.
  pinned: boolean;
  // Silenciada ATÉ esta data (null = com som). Data em vez de booleano porque
  // silenciar para sempre é como um paciente some sem ninguém notar.
  muted_until: string | null;
  // "Limpar conversa": esconde o que veio antes desta data. As mensagens
  // continuam no banco — registro de atendimento não se apaga.
  cleared_at: string | null;
  // Conta Zernio que recebeu a conversa (multi-conta no Zernio).
  zernio_account_id: string | null;
  // Provedor: 'zernio' (WhatsApp Meta oficial / Instagram) × 'uazapi'
  // (integração direta, sem janela de 24h). Último inbound decide.
  provider: 'zernio' | 'uazapi';
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  direction: MessageDirection;
  sender_type: SenderType;
  sender_id: string | null;
  content_type: ContentType;
  content: string | null;
  media_url: string | null;
  zernio_message_id: string | null;
  // Status de entrega relayado pelo Zernio (coluna meta_status mantida).
  meta_status: MetaMessageStatus | null;
  // Motivo da falha de entrega (webhook 1:1 ou sync de broadcast).
  error_reason: string | null;
  is_private_note: boolean;
  created_at: string;

  // --- Recursos de conversa equivalentes aos do WhatsApp -------------------
  // Mensagem que esta responde citando. A citada continua no lugar dela na
  // thread; aqui só guardamos o vínculo.
  reply_to_id: string | null;
  // Reação da CLÍNICA e reação do PACIENTE na mesma mensagem — independentes,
  // cada lado troca a sua sem apagar a do outro. Emoji, ou null.
  reaction: string | null;
  contact_reaction: string | null;
  // Encaminhada de outra conversa (selo "Encaminhada" + caminho de volta).
  forwarded: boolean;
  forwarded_from_id: string | null;
  // Apagada NO CRM. A Meta não permite apagar mensagem já entregue: o paciente
  // continua vendo. A tela precisa dizer isso, senão a atendente acha que o
  // paciente deixou de ver.
  deleted_at: string | null;
  deleted_by: string | null;
  // Favoritada (a estrela) e fixada no topo da conversa.
  starred: boolean;
  pinned: boolean;
}

export interface ConversationWithContact extends Conversation {
  contact: {
    id: string;
    // Nullable: contatos Instagram não têm telefone.
    phone: string | null;
    name: string | null;
    email: string | null;
    // Foto do lead (via UAZAPI). Null para leads Zernio → fallback iniciais.
    profile_pic_url: string | null;
    // Contato bloqueado no CRM (não recebe disparo nem resposta da IA).
    blocked_at?: string | null;
    custom_fields: Record<string, unknown>;
  } | null;
  lastMessagePreview: string | null;
  // IDs das tags do contato — usados pelo filtro de Tags do inbox (Módulo 7).
  tagIds: string[];
  // Timestamp da última mensagem do CONTATO (inbound) — deriva a janela de 24h
  // da Meta sem coluna dedicada.
  lastInboundAt: string | null;
  // Contato tem algum deal como Cliente (filtro Lead/Cliente do inbox).
  isCliente: boolean;
}
