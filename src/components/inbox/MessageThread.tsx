import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Bot, Check, CheckCheck, Clock, FileText, Smartphone, StickyNote, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/app/providers/AuthProvider';
import { createSignedMediaUrl, parseStorageRef } from '@/lib/inbox-media';
import type { Message } from '@/types/inbox';
import type { ThreadMessage } from '@/hooks/useMessages';

// URLs de mídia inbound apontam para a API do Zernio e exigem Bearer — o
// browser não tem a key, então passam pelo proxy autenticado /api/zernio-media
// (valida a sessão via `t`). URLs de upload-direct do operador são públicas e
// seguem diretas.
function resolveMediaUrl(url: string, accessToken: string | null): string {
  if (!accessToken) return url;
  if (!/^https:\/\/zernio\.com\/api\/v1\//i.test(url)) return url;
  return `/api/zernio-media?url=${encodeURIComponent(url)}&t=${encodeURIComponent(accessToken)}`;
}

// Resolve `media_url` para algo que a tag <img>/<audio>/<video> consiga abrir.
//
// Canal Meta: a foto e o áudio do paciente ficam num bucket PRIVADO da nossa
// base (whatsapp-hub-inbox-media, retenção de 12 meses). media_url guarda a
// REFERÊNCIA '<bucket>/<org>/<conversa>/<mensagem>.<ext>', não uma URL — e
// bucket privado não abre sem assinatura. Quem assina é o próprio usuário
// logado; a policy `wh_inbox_media_org_read` só libera admin e recepção,
// dentro da própria organização.
//
// Estados: 'loading' (assinando), string (pronta) ou null (a mídia expirou no
// expurgo dos 12 meses, ou o perfil não tem acesso) → o balão cai no
// placeholder, sem quebrar a tela.
function useResolvedMedia(rawUrl: string, accessToken: string | null) {
  const isStorage = parseStorageRef(rawUrl) !== null;
  const [signed, setSigned] = useState<string | null>(null);
  const [signing, setSigning] = useState(isStorage);

  useEffect(() => {
    const ref = parseStorageRef(rawUrl);
    if (!ref) {
      setSigned(null);
      setSigning(false);
      return;
    }
    let alive = true;
    setSigning(true);
    createSignedMediaUrl(ref)
      .then((url) => {
        if (!alive) return;
        setSigned(url);
        setSigning(false);
      })
      .catch(() => {
        if (!alive) return;
        setSigned(null);
        setSigning(false);
      });
    return () => {
      alive = false;
    };
  }, [rawUrl]);

  if (isStorage) return { url: signed, loading: signing };
  const isHttp = /^https?:\/\//i.test(rawUrl);
  return { url: isHttp ? resolveMediaUrl(rawUrl, accessToken) : null, loading: false };
}

interface MessageThreadProps {
  messages: ThreadMessage[];
  loading: boolean;
  onRetry?: (tempId: string) => void;
  onDismiss?: (tempId: string) => void;
}

function StatusTicks({ status }: { status: Message['meta_status'] }) {
  if (!status) return null;
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-[var(--color-error)] text-[10px]">
        <AlertCircle className="h-3 w-3" />
        não entregue
      </span>
    );
  }
  if (status === 'read') return <CheckCheck className="h-3 w-3 text-[var(--accent-primary)]" />;
  if (status === 'delivered') return <CheckCheck className="h-3 w-3 opacity-60" />;
  return <Check className="h-3 w-3 opacity-60" />;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Chave do dia local (não UTC) — usada para decidir onde inserir o separador.
function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatDayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (dayKey(iso) === dayKey(today.toISOString())) return 'Hoje';
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return 'Ontem';

  const sameYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

function DateSeparator({ iso }: { iso: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="h-px flex-1 bg-[var(--color-bg-subtle)]" />
      <span className="rounded-full border border-[var(--color-border-card)] bg-[var(--color-bg-primary)] px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
        {formatDayLabel(iso)}
      </span>
      <div className="h-px flex-1 bg-[var(--color-bg-subtle)]" />
    </div>
  );
}

function SenderIcon({ sender }: { sender: Message['sender_type'] }) {
  if (sender === 'ai') return <Bot className="h-3.5 w-3.5" />;
  if (sender === 'owner') return <Smartphone className="h-3.5 w-3.5" />;
  if (sender === 'operator') return <User className="h-3.5 w-3.5" />;
  return null;
}

const MEDIA_LABEL: Record<string, string> = {
  image: 'Imagem',
  audio: 'Áudio',
  video: 'Vídeo',
  document: 'Documento',
};

const MEDIA_RECEIVED: Record<string, string> = {
  image: 'Imagem recebida',
  audio: 'Áudio recebido',
  video: 'Vídeo recebido',
  document: 'Documento recebido',
};

// Renderiza mídia de duas origens: URL http(s) (modelo Zernio/UAZAPI) e o
// bucket privado da nossa base (canal Meta direto), este último por URL
// assinada. O placeholder abaixo cobre o que sobra: linha antiga sem mídia,
// arquivo já expurgado aos 12 meses, ou perfil sem acesso ao bucket.
function MediaContent({ message }: { message: Message }) {
  const { session } = useAuth();
  const rawUrl = message.media_url ?? '';
  const { url, loading } = useResolvedMedia(rawUrl, session?.access_token ?? null);
  const label = MEDIA_LABEL[message.content_type] ?? 'Mídia';
  const caption = message.content?.trim();

  if (loading) {
    return (
      <div className="flex items-center gap-2 italic opacity-70">
        <Clock className="h-3 w-3 animate-pulse" />
        Carregando {label.toLowerCase()}…
      </div>
    );
  }

  if (url) {
    if (message.content_type === 'image') {
      return (
        <div className="space-y-1">
          <img src={url} alt={caption || label} className="max-h-64 rounded-lg" loading="lazy" />
          {caption && <div className="whitespace-pre-wrap break-words">{caption}</div>}
        </div>
      );
    }
    if (message.content_type === 'audio') {
      return (
        <div className="space-y-1">
          <audio controls src={url} className="max-w-full" />
          {/* Áudio de paciente vira texto pelo transcribe-audio (Whisper); o
              content transcrito aparece embaixo do player. */}
          {caption && <div className="whitespace-pre-wrap break-words">{caption}</div>}
        </div>
      );
    }
    if (message.content_type === 'video') {
      return (
        <div className="space-y-1">
          <video controls src={url} className="max-h-64 rounded-lg" />
          {caption && <div className="whitespace-pre-wrap break-words">{caption}</div>}
        </div>
      );
    }
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="underline break-all">
        {caption || `Abrir ${label.toLowerCase()}`}
      </a>
    );
  }

  const received = MEDIA_RECEIVED[message.content_type] ?? 'Mídia recebida';
  return (
    <div className="italic opacity-80">
      {received}
      {caption ? `: ${caption}` : ' (arquivo indisponível).'}
    </div>
  );
}

function FailedActions({
  tempId,
  onRetry,
  onDismiss,
  inverse,
}: {
  tempId: string;
  onRetry?: (tempId: string) => void;
  onDismiss?: (tempId: string) => void;
  inverse?: boolean;
}) {
  // inverse=true → dentro do balão azul (texto claro); senão card claro.
  const base = inverse ? 'text-white/90' : 'text-[var(--color-error)]';
  return (
    <div className={cn('mt-1 flex items-center gap-2 text-[10px]', base)}>
      <span className="font-semibold">Não enviou.</span>
      <button type="button" onClick={() => onRetry?.(tempId)} className="underline hover:opacity-80">
        Reenviar
      </button>
      <button type="button" onClick={() => onDismiss?.(tempId)} className="underline opacity-70 hover:opacity-100">
        Descartar
      </button>
    </div>
  );
}

export function MessageThread({ messages, loading, onRetry, onDismiss }: MessageThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll to newest message. Setting block to 'end' and using a ref
    // target below the last bubble avoids fighting with user scroll-up.
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-label">Carregando mensagens...</div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-label">Nenhuma mensagem nesta conversa.</div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--color-bg-primary)] p-6 space-y-3.5">
      {messages.map((m, i) => {
        const showDate = i === 0 || dayKey(m.created_at) !== dayKey(messages[i - 1].created_at);
        const separator = showDate ? <DateSeparator iso={m.created_at} /> : null;
        const isNote = m.is_private_note;
        const isInbound = m.direction === 'inbound';
        // Anima só o que é novo: balão otimista em envio ou linha recém-criada
        // (< 4s). Mensagens antigas montam sem animação → carregamento limpo.
        // A key é estável (`_key`) para a troca otimista→real não re-animar.
        const isFresh =
          m._state === 'pending' || Date.now() - new Date(m.created_at).getTime() < 4000;

        if (isNote) {
          // Internal note — no bubble alignment; full-width yellow-tinted card.
          return (
            <div key={m._key ?? m.id}>
              {separator}
            <div
              className={cn(
                'mx-auto max-w-[85%] rounded-lg border border-[rgba(154,74,7,0.28)] bg-[var(--color-warning-bg)] p-3',
                m._state === 'pending' && 'opacity-70',
                isFresh && 'message-in',
              )}
            >
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-[var(--color-warning)] mb-1">
                <StickyNote className="h-3 w-3" />
                Nota privada entre operadores
                <span className="ml-auto opacity-70 inline-flex items-center gap-1">
                  {m._state === 'pending' && <Clock className="h-3 w-3 animate-pulse" />}
                  {formatTime(m.created_at)}
                </span>
              </div>
              <div className="text-sm text-[var(--color-text-primary)] whitespace-pre-wrap break-words">
                {m.content}
              </div>
              {m._state === 'failed' && m._tempId && (
                <FailedActions tempId={m._tempId} onRetry={onRetry} onDismiss={onDismiss} />
              )}
            </div>
            </div>
          );
        }

        return (
          <div key={m._key ?? m.id}>
            {separator}
          <div
            className={cn('flex', isInbound ? 'justify-start' : 'justify-end', isFresh && 'message-in')}
          >
            <div
              className={cn(
                'max-w-[70%] rounded-[15px] px-4 py-3 text-[13.5px] leading-relaxed transition-opacity',
                isInbound
                  ? 'rounded-bl-[4px] border border-[var(--color-border-card)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)]'
                  : 'rounded-br-[4px] bg-[var(--accent-primary)] text-white',
                m._state === 'pending' && 'opacity-70',
                (m._state === 'failed' || m.meta_status === 'failed') &&
                  'ring-1 ring-[var(--color-error)]',
              )}
            >
              {!isInbound && m.sender_type !== 'contact' && (
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide opacity-70 mb-1">
                  <SenderIcon sender={m.sender_type} />
                  {m.sender_type === 'ai' ? 'IA' : m.sender_type === 'owner' ? 'WhatsApp' : 'Operador'}
                </div>
              )}
              {m.content_type === 'text' || m.content_type === 'note' ? (
                <div className="whitespace-pre-wrap break-words">{m.content}</div>
              ) : m.content_type === 'template' ? (
                // Template é texto renderizado (body com variáveis já substituídas),
                // não mídia — exibe o conteúdo com um rótulo discreto de template.
                <div className="space-y-1">
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide opacity-70">
                    <FileText className="h-3 w-3" />
                    Template
                  </div>
                  <div className="whitespace-pre-wrap break-words">{m.content}</div>
                </div>
              ) : (
                <MediaContent message={m} />
              )}
              {!isInbound && m.meta_status === 'failed' && m.error_reason && (
                <div className="mt-1.5 rounded-md bg-[var(--color-error-bg)] px-2 py-1.5 text-[11px] leading-snug text-[var(--color-error)]">
                  <span className="font-semibold">Motivo: </span>
                  {m.error_reason}
                </div>
              )}
              <div
                className={cn(
                  'flex items-center gap-1 text-[10px] mt-1 opacity-70',
                  isInbound ? 'justify-start' : 'justify-end',
                )}
              >
                <span>{formatTime(m.created_at)}</span>
                {!isInbound && m._state === 'pending' && (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3 animate-pulse" /> enviando
                  </span>
                )}
                {!isInbound && m._state !== 'pending' && m._state !== 'failed' && (
                  <StatusTicks status={m.meta_status} />
                )}
              </div>
              {m._state === 'failed' && m._tempId && (
                <FailedActions tempId={m._tempId} onRetry={onRetry} onDismiss={onDismiss} inverse />
              )}
            </div>
          </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
