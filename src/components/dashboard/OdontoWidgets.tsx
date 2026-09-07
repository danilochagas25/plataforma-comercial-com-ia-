import { HelpCircle } from 'lucide-react';
import { WidgetCard } from '@/components/dashboard/widgets';
import { brl, brl2, formatPct } from '@/lib/dashboard';
import type { ConversaoBloco, EspecialidadeLinha, FaixaParado } from '@/hooks/useOdontoConversion';

// -----------------------------------------------------------------------------
// Widgets de conversão de orçamentos da odontologia.
//
// Só lógica e dados: a aparência reaproveita o `WidgetCard`, o `.glass-card` e
// os tokens de cor que a frente de design já definiu em `globals.css`. Nenhuma
// cor escrita à mão — tudo por `var(--color-...)`.
// -----------------------------------------------------------------------------

const TOKEN = {
  orcado: 'var(--accent-primary)',
  aprovado: 'var(--color-success)',
  parado: 'var(--color-warning)',
  abaixo: 'var(--color-error)',
} as const;

function Ajuda({ texto }: { texto: string }) {
  return (
    <span className="group relative mr-auto flex items-center">
      <HelpCircle className="h-3.5 w-3.5 cursor-help text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]" />
      <span className="pointer-events-none absolute left-0 top-full z-20 mt-1.5 w-64 rounded-lg border border-[var(--color-border-strong)] bg-[var(--surface)] px-3 py-2 text-xs font-normal normal-case tracking-normal text-[var(--color-text-primary)] opacity-0 shadow-[0_4px_14px_rgba(23,40,43,0.08)] transition-opacity group-hover:opacity-100">
        {texto}
      </span>
    </span>
  );
}

const tratamentos = (n: number) => `${n.toLocaleString('pt-BR')} tratamento${n === 1 ? '' : 's'}`;

// --- Fileira 1: Orçado · Aprovado · Parado ----------------------------------
export function OrcamentoKpiWidget({
  title,
  bloco,
  cor,
  ajuda,
  fatia,
}: {
  title: string;
  bloco: ConversaoBloco;
  cor: string;
  ajuda: string;
  /** % que este bloco representa do valor orçado (omitido no próprio "Orçado"). */
  fatia?: number | null;
}) {
  const ticket = bloco.count > 0 ? bloco.value / bloco.count : null;
  return (
    <WidgetCard
      title={title}
      titleBadge={<Ajuda texto={ajuda} />}
      titleExtra={
        <span
          className="rounded-full px-2.5 py-0.5 text-sm font-bold"
          style={{ color: cor, background: 'var(--color-bg-subtle)' }}
        >
          {bloco.count.toLocaleString('pt-BR')}
        </span>
      }
    >
      <div className="text-stat" style={{ color: cor }}>
        {brl(bloco.value)}
      </div>
      <div className="mt-1 text-sm text-[var(--color-text-secondary)]">
        {tratamentos(bloco.count)}
        {fatia != null && ` · ${formatPct(fatia)} do valor orçado`}
      </div>
      <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
        {ticket != null ? `Média por tratamento: ${brl2(ticket)}` : 'Sem orçamento no período.'}
      </div>
    </WidgetCard>
  );
}

// --- Barra de conversão contra a meta ---------------------------------------
// A meta aparece como um traço na régua: o dono vê de relance se a barra
// alcançou o traço, sem precisar comparar dois números.
function BarraMeta({ valor, meta, cor }: { valor: number | null; meta: number | null; cor: string }) {
  const largura = valor == null ? 0 : Math.min(100, Math.max(0, valor));
  return (
    <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-bg-subtle)]">
      <div className="h-full rounded-full transition-[width]" style={{ width: `${largura}%`, background: cor }} />
      {meta != null && (
        <span
          className="absolute top-0 h-full w-[2px] bg-[var(--color-text-primary)] opacity-70"
          style={{ left: `calc(${Math.min(100, Math.max(0, meta))}% - 1px)` }}
          aria-hidden
        />
      )}
    </div>
  );
}

// --- Fileira 2: conversão em valor / em tratamentos -------------------------
export function ConversaoWidget({
  title,
  subtitle,
  ajuda,
  valor,
  meta,
  detalhe,
}: {
  title: string;
  subtitle: string;
  ajuda: string;
  valor: number | null;
  meta: number;
  detalhe: string;
}) {
  const abaixo = valor != null && valor < meta;
  const cor = valor == null ? TOKEN.orcado : abaixo ? TOKEN.abaixo : TOKEN.aprovado;
  const faltam = valor == null ? null : meta - valor;
  return (
    <WidgetCard
      title={title}
      subtitle={subtitle}
      titleBadge={<Ajuda texto={ajuda} />}
      titleExtra={
        <span className="rounded-full border border-[var(--color-border-strong)] px-2.5 py-0.5 text-xs font-bold text-[var(--color-text-secondary)]">
          Meta {meta}%
        </span>
      }
    >
      <div className="flex items-baseline gap-3">
        <div className="text-stat" style={{ color: cor }}>
          {formatPct(valor)}
        </div>
        {faltam != null && (
          <span className="text-sm font-semibold" style={{ color: cor }}>
            {faltam > 0
              ? `${formatPct(faltam)} abaixo da meta`
              : faltam === 0
                ? 'na meta'
                : `${formatPct(-faltam)} acima da meta`}
          </span>
        )}
      </div>
      <div className="mt-3">
        <BarraMeta valor={valor} meta={meta} cor={cor} />
      </div>
      <div className="mt-2 text-xs text-[var(--color-text-secondary)]">{detalhe}</div>
    </WidgetCard>
  );
}

// --- Fileira 3: conversão por especialidade ---------------------------------
export function EspecialidadeWidget({ linhas }: { linhas: EspecialidadeLinha[] }) {
  const abaixo = linhas.filter((l) => l.meta != null && l.conversao != null && l.conversao < l.meta);
  return (
    <WidgetCard
      title="Conversão por especialidade"
      subtitle="Aprovados ÷ orçados no período, contra a meta da franqueadora"
      titleExtra={
        abaixo.length > 0 ? (
          <span
            className="rounded-full px-2.5 py-0.5 text-xs font-bold"
            style={{ color: TOKEN.abaixo, background: 'var(--color-error-bg)' }}
          >
            {abaixo.length} abaixo da meta
          </span>
        ) : undefined
      }
    >
      {linhas.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-xs text-[var(--color-text-secondary)] opacity-60">
          Sem orçamentos no período.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border-divider)] text-left">
                <th className="pb-2 pr-3 text-label font-bold">Especialidade</th>
                <th className="pb-2 pr-3 text-right text-label font-bold">Orçado</th>
                <th className="pb-2 pr-3 text-right text-label font-bold">Aprovado</th>
                <th className="pb-2 pr-3 text-label font-bold">Conversão</th>
                <th className="pb-2 text-right text-label font-bold">Meta</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const fora = l.meta != null && l.conversao != null && l.conversao < l.meta;
                const cor = l.conversao == null ? TOKEN.orcado : fora ? TOKEN.abaixo : TOKEN.aprovado;
                return (
                  <tr key={l.tipo} className="border-b border-[var(--color-border-divider)] last:border-0">
                    <td className="py-2.5 pr-3">
                      <div className="font-semibold text-[var(--color-text-primary)]">{l.label}</div>
                      <div className="text-xs text-[var(--color-text-secondary)]">
                        {tratamentos(l.orcado.count)} · {brl(l.orcado.value)}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-right text-[var(--color-text-secondary)]">
                      {l.orcado.count.toLocaleString('pt-BR')}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-[var(--color-text-secondary)]">
                      {l.aprovado.count.toLocaleString('pt-BR')}
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="w-14 shrink-0 text-right font-bold tabular-nums" style={{ color: cor }}>
                          {formatPct(l.conversao)}
                        </span>
                        <span className="min-w-[80px] flex-1">
                          <BarraMeta valor={l.conversao} meta={l.meta} cor={cor} />
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 text-right">
                      {l.meta == null ? (
                        <span className="text-xs text-[var(--color-text-secondary)]">—</span>
                      ) : (
                        <span
                          className="rounded-full px-2 py-0.5 text-xs font-bold"
                          style={{
                            color: fora ? TOKEN.abaixo : TOKEN.aprovado,
                            background: fora ? 'var(--color-error-bg)' : 'var(--color-success-bg)',
                          }}
                        >
                          {l.meta}%
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
        O traço na régua é a meta. Vermelho = abaixo dela. A especialidade vem do procedimento do orçamento, não do texto
        digitado.
      </p>
    </WidgetCard>
  );
}

// --- Há quanto tempo estão parados ------------------------------------------
export function ParadosWidget({
  paradoMais7,
  parado,
  faixas,
}: {
  paradoMais7: ConversaoBloco;
  parado: ConversaoBloco;
  faixas: FaixaParado[];
}) {
  const fatia = parado.value > 0 ? (paradoMais7.value / parado.value) * 100 : null;
  const maior = Math.max(1, ...faixas.map((f) => f.value));
  return (
    <WidgetCard
      title="Há quanto tempo estão parados"
      subtitle="Contado a partir da data do orçamento"
      titleExtra={
        <span
          className="rounded-full px-2.5 py-0.5 text-sm font-bold"
          style={{ color: TOKEN.parado, background: 'var(--color-warning-bg)' }}
        >
          {paradoMais7.count.toLocaleString('pt-BR')}
        </span>
      }
    >
      <div className="text-stat" style={{ color: TOKEN.parado }}>
        {brl(paradoMais7.value)}
      </div>
      <div className="mt-1 text-sm text-[var(--color-text-secondary)]">
        parados há mais de 7 dias
        {fatia != null && ` · ${formatPct(fatia)} de tudo que está parado`}
      </div>
      <div className="mt-4 space-y-2">
        {faixas.map((f) => (
          <div key={f.label}>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--color-text-secondary)]">{f.label}</span>
              <span className="font-semibold text-[var(--color-text-primary)]">
                {f.count.toLocaleString('pt-BR')} · {brl(f.value)}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-bg-subtle)]">
              <div
                className="h-full rounded-full"
                style={{ width: `${(f.value / maior) * 100}%`, background: TOKEN.parado }}
              />
            </div>
          </div>
        ))}
      </div>
    </WidgetCard>
  );
}
