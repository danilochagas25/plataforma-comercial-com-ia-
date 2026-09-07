import { Bot, Inbox, Instagram, Lock, MessageCircle, Pause, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/Avatar';
import type { WhatsappProvider } from '@/hooks/useWhatsappProvider';
import type { ConversationChannel, ConversationWithContact } from '@/types/inbox';

// Badge de canal/provedor: WhatsApp Meta (oficial), UAZAPI (não oficial, sem
// janela de 24h) ou Instagram.
function channelBadge(channel: ConversationChannel | undefined, provider: WhatsappProvider) {
  if (channel === 'instagram') {
    return { Icon: Instagram, label: 'Instagram', color: 'text-[#C82461]', chip: 'bg-[rgba(225,48,108,0.14)] text-[#C82461]' };
  }
  if (provider === 'uazapi') {
    return { Icon: MessageCircle, label: 'UAZAPI', color: 'text-[var(--accent-secondary)]', chip: 'bg-[rgba(45,212,191,0.14)] text-[var(--accent-secondary)]' };
  }
  return { Icon: MessageCircle, label: 'WhatsApp Meta', color: 'text-[var(--color-success)]', chip: 'bg-[rgba(37,211,102,0.14)] text-[var(--color-success)]' };
}

interface ConversationListProps {
  conversations: ConversationWithContact[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  // IA desligada no canal (configurações) → badge vira "Humano".
  aiEnabledForChannel?: (channel: string | null) => boolean;
  // Nome do operador atribuído (badge no lugar de "Humano").
  operatorName?: (userId: string | null) => string | null;
  // Conversa atribuída a outro operador → item escurecido e sem clique.
  isLocked?: (conv: ConversationWithContact) => boolean;
  // Provedor da conversa (WhatsApp Meta × UAZAPI × Instagram) p/ o badge.
  providerOf?: (conv: ConversationWithContact) => WhatsappProvider;
}

function statusBadge(
  c: ConversationWithContact,
  aiEnabled: boolean,
  assignedName: string | null,
) {
  if (c.status === 'closed') {
    return { Icon: Inbox, label: 'Fechada', color: 'text-[var(--color-text-secondary)]' };
  }
  // Atribuída → nome do operador no lugar do genérico "Humano".
  if (assignedName) {
    return { Icon: User, label: assignedName, color: 'text-[var(--color-success)]' };
  }
  if (c.status === 'ai_active' && aiEnabled) {
    return { Icon: Bot, label: 'IA', color: 'text-[var(--accent-primary)]' };
  }
  // Conversa de humano sem operador dono → "Não atribuído" (cinza).
  return { Icon: User, label: 'Não atribuído', color: 'text-[var(--color-text-secondary)]' };
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function ConversationList({
  conversations,
  loading,
  selectedId,
  onSelect,
  aiEnabledForChannel,
  operatorName,
  isLocked,
  providerOf,
}: ConversationListProps) {
  if (loading) {
    return (
      <div className="p-6 text-center text-label">Carregando...</div>
    );
  }
  if (conversations.length === 0) {
    return (
      <div className="p-6 text-center">
        <div className="text-label mb-2">Nenhuma conversa ainda</div>
        <div className="text-xs text-[var(--color-text-label)] max-w-[240px] mx-auto">
          As conversas aparecem aqui assim que um paciente mandar a primeira
          mensagem no WhatsApp da clínica.
        </div>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-[var(--color-border-soft)]">
      {conversations.map((c) => {
        const locked = isLocked?.(c) ?? false;
        const assignedName = operatorName?.(c.assigned_to) ?? null;
        const aiEnabled = aiEnabledForChannel?.(c.channel ?? null) ?? true;
        const badge = statusBadge(c, aiEnabled, assignedName);
        const Icon = badge.Icon;
        const chan = channelBadge(c.channel, providerOf?.(c) ?? (c.channel === 'instagram' ? 'instagram' : 'meta'));
        const ChanIcon = chan.Icon;
        const isActive = c.id === selectedId;
        const contact = c.contact;
        const displayName = contact?.name?.trim() || contact?.phone || '-';
        return (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => { if (!locked) onSelect(c.id); }}
              title={locked ? `Conversa atribuída a ${assignedName ?? 'outro operador'}` : undefined}
              className={cn(
                'w-full text-left px-4 py-3.5 transition-colors',
                locked ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[var(--color-bg-subtle)]',
                isActive && !locked && 'bg-[var(--color-bg-subtle)] border-l-[3px] border-[var(--accent-primary)]',
                (!isActive || locked) && 'border-l-[3px] border-transparent',
              )}
            >
              <div className="flex items-start gap-3">
                <div className="relative shrink-0">
                  <Avatar src={contact?.profile_pic_url} name={displayName} size="md" />
                  <span
                    title={chan.label}
                    className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-bg-surface)] ring-1 ring-[var(--color-border-card)]"
                  >
                    <ChanIcon className={cn('h-2.5 w-2.5', chan.color)} />
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className={cn(
                      'truncate text-[13.5px] text-[var(--color-text-primary)]',
                      isActive ? 'font-semibold' : 'font-medium',
                    )}>
                      {displayName}
                    </div>
                    <div className="text-[10px] text-[var(--color-text-secondary)] shrink-0 inline-flex items-center gap-1">
                      {locked && <Lock className="h-3 w-3" />}
                      {formatTimestamp(c.last_message_at)}
                    </div>
                  </div>
                  <div className="mt-1 truncate text-[12.5px] leading-snug text-[var(--color-text-secondary)]">
                    {locked ? <span className="italic opacity-70">Conversa em atendimento</span> : (c.lastMessagePreview ?? <span className="opacity-40">-</span>)}
                  </div>
                  {/* Fontes reduzidas + nowrap para os badges não quebrarem em 2
                      linhas na coluna estreita; o rótulo do operador trunca. */}
                  <div className="flex items-center gap-1.5 mt-1.5 min-w-0">
                    <span className={cn('inline-flex min-w-0 items-center gap-1 text-[9px] uppercase tracking-wide font-semibold', badge.color)}>
                      <Icon className="h-3 w-3 shrink-0" />
                      <span className="truncate">{badge.label}</span>
                    </span>
                    {/* Badge do provedor/canal: WhatsApp Meta · UAZAPI · Instagram */}
                    <span className={cn('inline-flex shrink-0 items-center whitespace-nowrap rounded-[5px] px-1.5 py-0.5 text-[9px] font-bold', chan.chip)}>
                      {chan.label}
                    </span>
                    {/* "IA pausada" só faz sentido quando a IA está LIGADA para o
                        canal. Com a IA desativada, ai_paused=true é só efeito do
                        roteamento pra humano — não mostramos o selo. */}
                    {c.ai_paused && aiEnabled && (
                      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[9px] uppercase tracking-wide font-semibold text-[var(--color-warning)]">
                        <Pause className="h-2.5 w-2.5 shrink-0" /> IA pausada
                      </span>
                    )}
                    {c.unread_count > 0 && (
                      <span className="ml-auto shrink-0 rounded-full bg-[var(--color-brand-red)] px-2 py-0.5 text-[10px] font-bold text-white">
                        {c.unread_count}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
