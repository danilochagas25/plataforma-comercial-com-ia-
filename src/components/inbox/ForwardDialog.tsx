import { useMemo, useState } from 'react';
import { Forward, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/button';
import type { ConversationWithContact } from '@/types/inbox';
import type { ThreadMessage } from '@/hooks/useMessages';

interface ForwardDialogProps {
  message: ThreadMessage;
  conversations: ConversationWithContact[];
  /** Conversa de onde a mensagem saiu — não faz sentido reenviar para ela. */
  currentConversationId: string | null;
  onCancel: () => void;
  onConfirm: (targetConversationIds: string[]) => Promise<void>;
}

export function ForwardDialog({
  message,
  conversations,
  currentConversationId,
  onCancel,
  onConfirm,
}: ForwardDialogProps) {
  const [busca, setBusca] = useState('');
  const [escolhidas, setEscolhidas] = useState<Set<string>>(new Set());
  const [enviando, setEnviando] = useState(false);

  const alvos = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return conversations
      .filter((c) => c.id !== currentConversationId && !c.archived)
      .filter((c) => {
        if (!q) return true;
        const nome = (c.contact?.name ?? '').toLowerCase();
        const fone = (c.contact?.phone ?? '').toLowerCase();
        return nome.includes(q) || fone.includes(q);
      });
  }, [conversations, currentConversationId, busca]);

  const alternar = (id: string) => {
    setEscolhidas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const confirmar = async () => {
    if (escolhidas.size === 0) return;
    setEnviando(true);
    try {
      await onConfirm([...escolhidas]);
    } finally {
      setEnviando(false);
    }
  };

  const preview = message.content?.trim() || `[${message.content_type}]`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-[var(--color-border-card)] bg-[var(--color-bg-surface)] shadow-2xl">
        <div className="flex items-center gap-2 border-b border-[var(--color-border-divider)] px-4 py-3">
          <Forward className="h-4 w-4 text-[var(--accent-primary)]" />
          <span className="font-semibold text-[var(--color-text-primary)]">Encaminhar mensagem</span>
          <button
            type="button"
            aria-label="Fechar"
            onClick={onCancel}
            className="ml-auto rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-[var(--color-border-divider)] bg-[var(--color-bg-subtle)] px-4 py-2.5">
          <div className="line-clamp-3 break-words text-[12.5px] text-[var(--color-text-secondary)]">
            {preview}
          </div>
        </div>

        <div className="border-b border-[var(--color-border-divider)] px-4 py-2.5">
          <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border-card)] px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-secondary)]" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar paciente..."
              className="w-full bg-transparent text-[13px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {alvos.length === 0 ? (
            <div className="p-6 text-center text-[13px] text-[var(--color-text-secondary)]">
              Nenhuma outra conversa encontrada.
            </div>
          ) : (
            <ul className="divide-y divide-[var(--color-border-divider)]">
              {alvos.map((c) => {
                const nome = c.contact?.name?.trim() || c.contact?.phone || '-';
                const marcada = escolhidas.has(c.id);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => alternar(c.id)}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                        marcada ? 'bg-[var(--color-accent-bg)]' : 'hover:bg-[var(--color-bg-subtle)]',
                      )}
                    >
                      <Avatar src={c.contact?.profile_pic_url} name={nome} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-text-primary)]">
                        {nome}
                      </span>
                      <span
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                          marcada
                            ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-white'
                            : 'border-[var(--color-border-card)]',
                        )}
                      >
                        {marcada && '✓'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-[var(--color-border-divider)] px-4 py-3">
          <span className="text-[12px] text-[var(--color-text-secondary)]">
            {escolhidas.size === 0
              ? 'Escolha para quem enviar'
              : `${escolhidas.size} ${escolhidas.size === 1 ? 'conversa' : 'conversas'}`}
          </span>
          <Button variant="ghost" onClick={onCancel} className="ml-auto" disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={escolhidas.size === 0 || enviando}>
            {enviando ? 'Enviando...' : 'Encaminhar'}
          </Button>
        </div>
      </div>
    </div>
  );
}
