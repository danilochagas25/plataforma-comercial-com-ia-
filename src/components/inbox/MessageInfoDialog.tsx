import { Info, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ThreadMessage } from '@/hooks/useMessages';

// "Dados" do WhatsApp: quando saiu, se entregou, se leram.
//
// A Cloud API não entrega o horário exato de cada etapa por mensagem — só o
// último status alcançado. Então mostramos o que existe de verdade e dizemos
// o que não temos, em vez de inventar um horário de leitura.
interface MessageInfoDialogProps {
  message: ThreadMessage;
  senderLabel: string;
  onClose: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  sent: 'Enviada',
  delivered: 'Entregue no aparelho',
  read: 'Lida pelo paciente',
  failed: 'Não entregue',
};

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function MessageInfoDialog({ message, senderLabel, onClose }: MessageInfoDialogProps) {
  const isInbound = message.direction === 'inbound';
  const status = message.meta_status ? STATUS_LABEL[message.meta_status] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm overflow-hidden rounded-xl border border-[var(--color-border-card)] bg-[var(--color-bg-surface)] shadow-2xl">
        <div className="flex items-center gap-2 border-b border-[var(--color-border-divider)] px-4 py-3">
          <Info className="h-4 w-4 text-[var(--accent-primary)]" />
          <span className="font-semibold text-[var(--color-text-primary)]">Dados da mensagem</span>
          <button
            type="button"
            aria-label="Fechar"
            onClick={onClose}
            className="ml-auto rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <dl className="divide-y divide-[var(--color-border-divider)] text-[13px]">
          <Linha rotulo={isInbound ? 'Recebida em' : 'Enviada em'} valor={dataHora(message.created_at)} />
          <Linha rotulo="Autor" valor={senderLabel} />
          {!isInbound && (
            <Linha
              rotulo="Situação"
              valor={status ?? 'Sem confirmação da Meta'}
              alerta={message.meta_status === 'failed'}
            />
          )}
          {message.error_reason && <Linha rotulo="Motivo da falha" valor={message.error_reason} alerta />}
          {message.reaction && <Linha rotulo="Reação da clínica" valor={message.reaction} />}
          {message.contact_reaction && <Linha rotulo="Reação do paciente" valor={message.contact_reaction} />}
          {message.forwarded && <Linha rotulo="Origem" valor="Encaminhada de outra conversa" />}
          <Linha
            rotulo="Identificador na Meta"
            valor={message.zernio_message_id ?? 'não chegou a ser enviada'}
            mono
          />
        </dl>

        {!isInbound && (
          <p className="border-t border-[var(--color-border-divider)] px-4 py-3 text-[11.5px] leading-snug text-[var(--color-text-muted)]">
            A Meta informa apenas a última situação alcançada — não o horário de
            cada etapa. Por isso não mostramos "entregue às" e "lida às"
            separadamente.
          </p>
        )}

        <div className="flex justify-end border-t border-[var(--color-border-divider)] px-4 py-3">
          <Button onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </div>
  );
}

function Linha({
  rotulo,
  valor,
  alerta,
  mono,
}: {
  rotulo: string;
  valor: string;
  alerta?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-3 px-4 py-2.5">
      <dt className="w-36 shrink-0 text-[var(--color-text-secondary)]">{rotulo}</dt>
      <dd
        className={[
          'min-w-0 flex-1 break-words',
          alerta ? 'text-[var(--color-error)]' : 'text-[var(--color-text-primary)]',
          mono ? 'font-mono text-[11px]' : '',
        ].join(' ')}
      >
        {valor}
      </dd>
    </div>
  );
}
