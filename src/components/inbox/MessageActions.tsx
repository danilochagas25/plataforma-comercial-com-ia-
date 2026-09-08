import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Copy,
  Download,
  Forward,
  Info,
  Pin,
  PinOff,
  Reply,
  Smile,
  Star,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ThreadMessage } from '@/hooks/useMessages';

// As seis do WhatsApp, na mesma ordem — a recepção reconhece sem ler.
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export interface MessageActionHandlers {
  onReply?: (m: ThreadMessage) => void;
  onReact?: (m: ThreadMessage, emoji: string) => void;
  onToggleStar?: (m: ThreadMessage) => void;
  onTogglePin?: (m: ThreadMessage) => void;
  onForward?: (m: ThreadMessage) => void;
  onShowInfo?: (m: ThreadMessage) => void;
  onDelete?: (m: ThreadMessage) => void;
}

interface MessageActionsProps extends MessageActionHandlers {
  message: ThreadMessage;
  /** Balão do lado direito (nosso) → menu abre para a esquerda. */
  outbound: boolean;
  /** URL já resolvida da mídia, quando houver — habilita "Salvar". */
  mediaHref?: string | null;
}

export function MessageActions({
  message,
  outbound,
  mediaHref,
  onReply,
  onReact,
  onToggleStar,
  onTogglePin,
  onForward,
  onShowInfo,
  onDelete,
}: MessageActionsProps) {
  const [open, setOpen] = useState(false);
  // Menu longo perto do rodapé abriria para fora da tela; medimos e viramos
  // para cima quando não cabe embaixo.
  const [dropUp, setDropUp] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setDropUp(window.innerHeight - rect.bottom < 340);
  }, [open]);

  // Balão otimista ainda não tem id no banco: nada aqui funcionaria.
  if (message._state === 'pending' || message._state === 'failed') return null;
  if (message.deleted_at) return null;

  const copy = async () => {
    const text = message.content ?? '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Navegador sem permissão de área de transferência (http, ou o usuário
      // negou). Silencioso de propósito: nada quebrou, só não copiou.
    }
  };

  const hasText = Boolean(message.content?.trim());

  return (
    <div ref={wrapRef} className={cn('absolute top-1 z-20', outbound ? 'left-1' : 'right-1')}>
      <button
        type="button"
        aria-label="Ações da mensagem"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded-full transition-opacity',
          outbound
            ? 'bg-[rgba(255,255,255,0.22)] text-white hover:bg-[rgba(255,255,255,0.34)]'
            : 'bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
          'opacity-100 md:opacity-0 md:group-hover/bubble:opacity-100',
          open && 'md:opacity-100',
        )}
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            'absolute z-30 w-60 overflow-hidden rounded-xl border border-[var(--color-border-card)] bg-[var(--color-bg-surface)] shadow-xl',
            outbound ? 'left-0' : 'right-0',
            dropUp ? 'bottom-8' : 'top-8',
          )}
        >
          {onReact && (
            <div className="flex items-center gap-0.5 border-b border-[var(--color-border-divider)] px-2 py-2">
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`Reagir com ${emoji}`}
                  onClick={() => {
                    setOpen(false);
                    // Clicar na reação que já está lá REMOVE, como no WhatsApp.
                    onReact(message, message.reaction === emoji ? '' : emoji);
                  }}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full text-[17px] leading-none transition-transform hover:scale-125',
                    message.reaction === emoji && 'bg-[var(--color-accent-bg)]',
                  )}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          <div className="py-1">
            {onReply && <Item icon={Reply} label="Responder" onClick={() => { setOpen(false); onReply(message); }} />}
            {onReact && (
              <Item
                icon={Smile}
                label={message.reaction ? 'Remover reação' : 'Reagir'}
                disabled={!message.reaction}
                onClick={() => { setOpen(false); onReact(message, ''); }}
              />
            )}
            {onToggleStar && (
              <Item
                icon={Star}
                label={message.starred ? 'Desfavoritar' : 'Favoritar'}
                onClick={() => { setOpen(false); onToggleStar(message); }}
              />
            )}
            {onTogglePin && (
              <Item
                icon={message.pinned ? PinOff : Pin}
                label={message.pinned ? 'Desafixar' : 'Fixar'}
                onClick={() => { setOpen(false); onTogglePin(message); }}
              />
            )}
            {onForward && hasText && (
              <Item icon={Forward} label="Encaminhar" onClick={() => { setOpen(false); onForward(message); }} />
            )}
            <Item
              icon={Copy}
              label={copied ? 'Copiado!' : 'Copiar'}
              disabled={!hasText}
              onClick={() => { void copy(); }}
            />
            {onShowInfo && (
              <Item icon={Info} label="Dados" onClick={() => { setOpen(false); onShowInfo(message); }} />
            )}
            {mediaHref && (
              <a
                role="menuitem"
                href={mediaHref}
                download
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]"
              >
                <Download className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-secondary)]" />
                Salvar arquivo
              </a>
            )}
          </div>

          {onDelete && (
            <div className="border-t border-[var(--color-border-divider)] py-1">
              <Item
                icon={Trash2}
                label="Apagar"
                danger
                onClick={() => { setOpen(false); onDelete(message); }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Item({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: typeof Reply;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px]',
        disabled
          ? 'cursor-default text-[var(--color-text-muted)] opacity-50'
          : danger
            ? 'text-[var(--color-error)] hover:bg-[var(--color-error-bg)]'
            : 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]',
      )}
    >
      <Icon className={cn('h-3.5 w-3.5 shrink-0', !danger && 'text-[var(--color-text-secondary)]')} />
      {label}
    </button>
  );
}
