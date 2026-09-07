import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { LayoutDashboard, RefreshCw, SlidersHorizontal, X } from 'lucide-react';
import { useSalesDashboard } from '@/hooks/useSalesDashboard';
import { useOdontoConversion } from '@/hooks/useOdontoConversion';
import { useDashboardPrefs } from '@/hooks/useDashboardPrefs';
import { operatorLabel, useOperators } from '@/hooks/useOperators';
import {
  PERIOD_PRESETS,
  WIDGETS,
  brl,
  periodRange,
  type PeriodKey,
  type WidgetKey,
} from '@/lib/dashboard';
import { DurationWidget, RankingWidget } from '@/components/dashboard/widgets';
import {
  ConversaoWidget,
  EspecialidadeWidget,
  OrcamentoKpiWidget,
  ParadosWidget,
} from '@/components/dashboard/OdontoWidgets';
import { LoadErrorBanner } from '@/components/LoadErrorBanner';
import { CredentialsBanner } from '@/components/CredentialsBanner';
import { cn } from '@/lib/utils';
import { VOCAB } from '@/config/vocab';

// -----------------------------------------------------------------------------
// Painel da odontologia (07/09/2026).
//
// O painel que veio do template do curso falava de infoproduto — "previsão de
// caixa", "quem mais fechou", origem de tráfego por UTM — e não respondia
// nenhuma pergunta de clínica. Foi substituído pelas quatro perguntas do dono:
// quanto foi orçado, quanto fechou, quanto está parado e o quanto isso está
// longe da meta da franqueadora.
//
// O período é medido pela **Dt Orçamento**, não pela data de criação do
// registro: a base veio de importação e todos os registros nasceram no mesmo
// minuto.
// -----------------------------------------------------------------------------

function isPeriodKey(v: string | null): v is PeriodKey {
  return v === 'all' || v === 'today' || v === 'yesterday' || v === 'this_week' || v === 'last_week' || v === '1d' || v === '7d' || v === '15d' || v === '30d' || v === '60d' || v === '90d' || v === 'this_month' || v === 'last_month' || v === 'custom';
}

export default function DashboardPage() {
  const [params, setParams] = useSearchParams();
  // Default "Tudo": a base importada tem orçamento de maio ainda em aberto, e
  // uma janela de 30 dias esconderia parte do que está parado.
  const periodKey: PeriodKey = isPeriodKey(params.get('period')) ? (params.get('period') as PeriodKey) : 'all';
  const customFrom = params.get('from') ?? '';
  const customTo = params.get('to') ?? '';
  const [customizeOpen, setCustomizeOpen] = useState(false);

  const range = useMemo(
    () => periodRange(periodKey, customFrom, customTo),
    [periodKey, customFrom, customTo],
  );

  const { metrics, loading, error, reload } = useSalesDashboard(range);
  const odonto = useOdontoConversion(range);
  const { visibleMap, toggle } = useDashboardPrefs();
  const { operators } = useOperators();
  const [refreshing, setRefreshing] = useState(false);

  // Recarrega orçamentos e métricas de atendimento no período atual.
  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.all([reload(), odonto.reload()]);
    } finally {
      setRefreshing(false);
    }
  };

  const ownerName = (id: string | null) => {
    if (!id) return 'Não atribuído';
    const op = operators.find((o) => o.user_id === id);
    return op ? operatorLabel(op) : 'Membro da equipe';
  };

  const setPeriod = (key: PeriodKey) => {
    const next = new URLSearchParams(params);
    next.set('period', key);
    if (key !== 'custom') {
      next.delete('from');
      next.delete('to');
    }
    setParams(next, { replace: true });
  };

  const setCustom = (which: 'from' | 'to', value: string) => {
    const next = new URLSearchParams(params);
    next.set('period', 'custom');
    next.set(which, value);
    setParams(next, { replace: true });
  };

  const handleToggle = async (key: WidgetKey) => {
    const id = await toggle(key);
    if (id) toast.success('Preferência salva.', { description: `dashboard_preferences: ${id}` });
  };

  const show = (key: WidgetKey) => visibleMap[key] !== false;

  const c = odonto.data;
  const carregando = loading || odonto.loading;

  // Fatias do valor orçado — respondem "quanto do que orcei virou tratamento".
  const fatiaAprovado = c.orcado.value > 0 ? (c.aprovado.value / c.orcado.value) * 100 : null;
  const fatiaParado = c.orcado.value > 0 ? (c.parado.value / c.orcado.value) * 100 : null;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <CredentialsBanner />
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl glass-card flex items-center justify-center">
            <LayoutDashboard className="h-5 w-5 text-[var(--accent-primary)]" />
          </div>
          <div>
            <div className="text-label">Seção</div>
            <h1 className="text-2xl font-bold text-display">{VOCAB.dashboard}</h1>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Quanto foi orçado, quanto fechou e quanto está parado
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refreshAll()}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-lg border border-[rgba(97,193,208,0.45)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-60"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            Atualizar
          </button>
          <button
            type="button"
            onClick={() => setCustomizeOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-[rgba(97,193,208,0.45)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Escolher o que ver
          </button>
        </div>
      </div>

      {/* Filtro de período (global) — base: Data do orçamento */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-[rgba(97,193,208,0.30)] p-1 bg-[#FAFDFD]">
          {PERIOD_PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-semibold',
                periodKey === p.key
                  ? 'bg-[var(--accent-primary)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
              )}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => setPeriod('custom')}
            className={cn(
              'rounded-md px-3 py-1 text-xs font-semibold',
              periodKey === 'custom'
                ? 'bg-[var(--accent-primary)] text-white'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
            )}
          >
            Personalizado
          </button>
        </div>
        {periodKey === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustom('from', e.target.value)}
              className="rounded-lg border border-[rgba(97,193,208,0.45)] bg-[#F7FBFC] px-2 py-1 text-xs text-[var(--color-text-primary)]"
            />
            <span className="text-xs text-[var(--color-text-secondary)]">até</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustom('to', e.target.value)}
              className="rounded-lg border border-[rgba(97,193,208,0.45)] bg-[#F7FBFC] px-2 py-1 text-xs text-[var(--color-text-primary)]"
            />
          </div>
        )}
        <span className="text-xs text-[var(--color-text-secondary)]">
          Período contado pela <strong className="font-semibold">data do orçamento</strong>
        </span>
      </div>

      {error && <LoadErrorBanner message={error} onRetry={() => void reload()} />}
      {odonto.error && <LoadErrorBanner message={odonto.error} onRetry={() => void odonto.reload()} />}

      {/* Painel de personalização */}
      {customizeOpen && (
        <div className="glass-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-label">Widgets exibidos</div>
            <button onClick={() => setCustomizeOpen(false)} aria-label="Fechar" className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {WIDGETS.map((w) => (
              <label key={w.key} className="flex items-center gap-2 rounded-lg border border-[rgba(97,193,208,0.30)] bg-[#FAFDFD] px-3 py-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={show(w.key)}
                  onChange={() => void handleToggle(w.key)}
                  className="accent-[var(--accent-primary)] h-4 w-4"
                />
                <span className="text-sm text-[var(--color-text-primary)]">{w.label}</span>
                <span className="ml-auto text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]">{w.group}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {carregando ? (
        <div className="glass-card p-10 text-center text-label opacity-60">Carregando orçamentos...</div>
      ) : c.semFunil ? (
        <div className="glass-card p-10 text-center text-sm text-[var(--color-text-secondary)]">
          O funil <strong>Odonto — Orçamentos</strong> ainda não existe neste banco. Importe os orçamentos do WebDental
          para o painel começar a contar.
        </div>
      ) : (
        <>
        {/* Fileira 1 — Orçado · Aprovado · Parado */}
        {show('odonto_resumo') && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <OrcamentoKpiWidget
              title="Orçado no período"
              bloco={c.orcado}
              cor="var(--accent-primary)"
              ajuda="Tudo que foi orçado no período, aprovado ou não. Cada orçamento é um tratamento."
            />
            <OrcamentoKpiWidget
              title="Aprovado"
              bloco={c.aprovado}
              cor="var(--color-success)"
              fatia={fatiaAprovado}
              ajuda="Orçamentos que o paciente aceitou — a etapa Aprovado do funil."
            />
            <OrcamentoKpiWidget
              title="Parado"
              bloco={c.parado}
              cor="var(--color-warning)"
              fatia={fatiaParado}
              ajuda="Nem aprovado, nem descartado. É o dinheiro que ainda dá para recuperar."
            />
          </div>
        )}

        {/* Fileira 2 — as duas conversões, cada uma contra a meta */}
        {show('odonto_conversao') && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ConversaoWidget
              title="Conversão em valor"
              subtitle="Do dinheiro orçado, quanto virou tratamento"
              ajuda="Valor aprovado dividido pelo valor orçado no período."
              valor={c.conversaoValor}
              meta={c.metaGeral}
              detalhe={`${brl(c.aprovado.value)} aprovados de ${brl(c.orcado.value)} orçados`}
            />
            <ConversaoWidget
              title="Conversão em tratamentos"
              subtitle="Dos orçamentos apresentados, quantos fecharam"
              ajuda="Nº de tratamentos aprovados dividido pelo nº de tratamentos orçados. Se ficar acima da conversão em valor, o que não fecha é o caro."
              valor={c.conversaoTratamentos}
              meta={c.metaGeral}
              detalhe={`${c.aprovado.count.toLocaleString('pt-BR')} aprovados de ${c.orcado.count.toLocaleString('pt-BR')} orçados`}
            />
          </div>
        )}

        {/* Fileira 3 — conversão por especialidade + tempo parado */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {show('odonto_especialidade') && (
            <div className="xl:col-span-2">
              <EspecialidadeWidget linhas={c.especialidades} />
            </div>
          )}
          {show('odonto_parados') && (
            <ParadosWidget paradoMais7={c.paradoMais7} parado={c.parado} faixas={c.faixasParado} />
          )}
        </div>

        {/* Atendimento — passa a fazer sentido quando a recuperação começar */}
        {(show('ranking_vendedores') || show('tempo_primeira_resposta')) && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {show('ranking_vendedores') && (
              <div className="md:col-span-2">
                <RankingWidget ranking={metrics.ranking} ownerName={ownerName} />
              </div>
            )}
            {show('tempo_primeira_resposta') && (
              <DurationWidget
                title="Tempo até a 1ª resposta"
                subtitle="Da primeira mensagem do paciente até alguém do time responder"
                avgMs={metrics.firstResponse.avgMs}
                byOwner={metrics.firstResponse.byOwner}
                ownerName={ownerName}
              />
            )}
          </div>
        )}
        </>
      )}
    </div>
  );
}
