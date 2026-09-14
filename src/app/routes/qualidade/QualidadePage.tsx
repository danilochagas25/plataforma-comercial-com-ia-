import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  Loader2,
  MessageCircleWarning,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAppUser } from '@/app/providers/AppUserProvider';
import { operatorLabel, useOperators } from '@/hooks/useOperators';
import {
  CRITERIOS,
  CRITERIO_ROTULO,
  REGRA_ROTULO,
  useAvaliacoes,
  type Avaliacao,
  type Criterio,
} from '@/hooks/useAvaliacoes';

// Qualidade — a IA avalia cada atendimento (operadora × conversa × dia) pela
// régua do BASE-CONHECIMENTO-ODONTO.md. Quem decide o que cada pessoa vê é a
// RLS: admin vê a equipe, operadora vê só os próprios atendimentos.

type Periodo = 'ontem' | '7' | '30';

function diaLocal(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function intervalo(p: Periodo): { de: string; ate: string } {
  if (p === 'ontem') return { de: diaLocal(-1), ate: diaLocal(-1) };
  if (p === '7') return { de: diaLocal(-6), ate: diaLocal(0) };
  return { de: diaLocal(-29), ate: diaLocal(0) };
}

function media(ns: Array<number | null | undefined>): number | null {
  const v = ns.filter((n): n is number => typeof n === 'number');
  return v.length ? v.reduce((s, n) => s + n, 0) / v.length : null;
}

function mediana(ns: Array<number | null | undefined>): number | null {
  const v = ns.filter((n): n is number => typeof n === 'number').sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function fmtNota(n: number | null): string {
  return n === null ? '—' : n.toFixed(1).replace('.', ',');
}

function fmtMin(n: number | null): string {
  if (n === null) return '—';
  if (n < 1) return 'menos de 1 min';
  if (n < 60) return `${Math.round(n)} min`;
  const h = Math.floor(n / 60);
  const m = Math.round(n % 60);
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

function fmtDia(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a.slice(2)}`;
}

// Faixas: 8+ bom, 6 a 7,9 atenção, abaixo de 6 fraco.
function tomDaNota(n: number | null): string {
  if (n === null) return 'bg-[var(--color-bg-subtle)] text-[var(--color-text-muted)]';
  if (n >= 8) return 'bg-[var(--color-success-bg)] text-[var(--color-success)]';
  if (n >= 6) return 'bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]';
  return 'bg-[var(--color-error-bg)] text-[var(--color-error)]';
}

function corDaBarra(n: number): string {
  if (n >= 8) return 'bg-[var(--color-success)]';
  if (n >= 6) return 'bg-[var(--color-warning)]';
  return 'bg-[var(--color-error)]';
}

export default function QualidadePage() {
  const { role, userId } = useAppUser();
  const isAdmin = role === 'admin';
  const { operators } = useOperators();
  const [periodo, setPeriodo] = useState<Periodo>('7');
  const [filtroOperadora, setFiltroOperadora] = useState<string>('');
  const [aberto, setAberto] = useState<string | null>(null);
  const [avaliando, setAvaliando] = useState(false);

  const { de, ate } = intervalo(periodo);
  const { avaliacoes, loading, error, avaliar } = useAvaliacoes(de, ate);

  const nomeDe = (uid: string) => {
    const op = operators.find((o) => o.user_id === uid);
    return op ? operatorLabel(op) : uid === userId ? 'Você' : 'Atendente';
  };

  const visiveis = useMemo(
    () => (filtroOperadora ? avaliacoes.filter((a) => a.operador_id === filtroOperadora) : avaliacoes),
    [avaliacoes, filtroOperadora],
  );

  // Resumo por operadora — números agregados só das avaliações do período.
  const resumo = useMemo(() => {
    const porOp = new Map<string, Avaliacao[]>();
    for (const a of avaliacoes) {
      const lista = porOp.get(a.operador_id) ?? [];
      lista.push(a);
      porOp.set(a.operador_id, lista);
    }
    return [...porOp.entries()].map(([uid, lista]) => {
      const avaliadas = lista.filter((a) => a.status === 'avaliado');
      const porCriterio = CRITERIOS.map((c) => ({
        c,
        m: media(avaliadas.map((a) => a.criterios[c]?.nota)),
      })).filter((x): x is { c: Criterio; m: number } => x.m !== null);
      const pior = porCriterio.sort((a, b) => a.m - b.m)[0] ?? null;
      return {
        uid,
        atendimentos: lista.length,
        avaliadas: avaliadas.length,
        nota: media(avaliadas.map((a) => a.nota_geral)),
        resposta: mediana(lista.map((a) => a.metricas.resposta_mediana_min)),
        alertas: lista.reduce((s, a) => s + a.alertas.length, 0),
        esperando: lista.filter((a) => a.metricas.paciente_esperando_no_fim).length,
        pior,
      };
    }).sort((a, b) => (b.nota ?? -1) - (a.nota ?? -1));
  }, [avaliacoes]);

  // Lista: primeiro quem tem alerta, depois as notas mais baixas.
  const ordenadas = useMemo(
    () => [...visiveis].sort((a, b) => {
      if (b.alertas.length !== a.alertas.length) return b.alertas.length - a.alertas.length;
      return (a.nota_geral ?? 11) - (b.nota_geral ?? 11);
    }),
    [visiveis],
  );

  const pedirAvaliacao = async () => {
    setAvaliando(true);
    try {
      const r = await avaliar();
      toast.success('Atendimentos de hoje avaliados.', {
        description: `${r.avaliado} avaliado(s) · ${r.insuficiente} curto(s) demais para avaliar${r.erro ? ` · ${r.erro} com erro (tenta de novo na próxima rodada)` : ''}`,
      });
    } catch (e) {
      toast.error('Não foi possível avaliar agora', {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setAvaliando(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl glass-card flex items-center justify-center">
            <ShieldCheck className="h-5 w-5 text-[var(--color-accent-primary)]" />
          </div>
          <div>
            <div className="text-label">Seção</div>
            <h1 className="text-2xl font-bold text-display">Qualidade</h1>
            <p className="text-sm text-[var(--color-text-secondary)]">
              {isAdmin
                ? 'A IA avalia cada atendimento pela régua da clínica — tom, condução, valor e as regras do CFO'
                : 'O retorno da IA sobre os seus atendimentos, para você ver o que já faz bem e onde ajustar'}
            </p>
          </div>
        </div>
        {isAdmin && (
          <Button onClick={pedirAvaliacao} disabled={avaliando}>
            {avaliando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {avaliando ? 'Avaliando…' : 'Avaliar atendimentos de hoje'}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {([
          ['ontem', 'Ontem'],
          ['7', 'Últimos 7 dias'],
          ['30', 'Últimos 30 dias'],
        ] as Array<[Periodo, string]>).map(([v, rotulo]) => (
          <button
            key={v}
            type="button"
            onClick={() => setPeriodo(v)}
            className={cn(
              'rounded-full px-3 py-1 text-xs',
              periodo === v
                ? 'bg-[var(--color-accent-bg)] text-[var(--color-text-primary)] font-semibold'
                : 'bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]',
            )}
          >
            {rotulo}
          </button>
        ))}
        {isAdmin && resumo.length > 1 && (
          <select
            value={filtroOperadora}
            onChange={(e) => setFiltroOperadora(e.target.value)}
            className="ml-auto h-9 rounded-lg border border-[var(--color-border-card)] bg-[var(--color-bg-surface)] px-3 text-xs text-[var(--color-text-primary)]"
          >
            <option value="">Todas as atendentes</option>
            {resumo.map((r) => (
              <option key={r.uid} value={r.uid}>{nomeDe(r.uid)}</option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-4 py-3 text-sm text-[var(--color-error)]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando avaliações…
        </div>
      ) : avaliacoes.length === 0 ? (
        <div className="glass-card rounded-xl p-8 text-center space-y-2">
          <RefreshCw className="mx-auto h-6 w-6 text-[var(--color-text-muted)]" />
          <p className="text-sm font-medium text-[var(--color-text-primary)]">Nenhum atendimento avaliado neste período</p>
          <p className="text-xs text-[var(--color-text-secondary)]">
            A avaliação roda sozinha todo dia às 6h, com os atendimentos do dia anterior.
            {isAdmin && ' Para ver hoje, use "Avaliar atendimentos de hoje".'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {resumo.map((r) => (
              <div key={r.uid} className="glass-card rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-[var(--color-text-primary)]">{nomeDe(r.uid)}</div>
                    <div className="text-xs text-[var(--color-text-secondary)]">
                      {r.avaliadas} avaliado(s) de {r.atendimentos} atendimento(s)
                    </div>
                  </div>
                  <span className={cn('rounded-lg px-2.5 py-1 text-lg font-bold tabular-nums', tomDaNota(r.nota))}>
                    {fmtNota(r.nota)}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-[var(--color-text-muted)]">Tempo de resposta</dt>
                    <dd className="font-medium text-[var(--color-text-primary)]">{fmtMin(r.resposta)}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--color-text-muted)]">Paciente esperando no fim do dia</dt>
                    <dd className="font-medium text-[var(--color-text-primary)]">{r.esperando}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--color-text-muted)]">Onde mais escorrega</dt>
                    <dd className="font-medium text-[var(--color-text-primary)]">
                      {r.pior ? `${CRITERIO_ROTULO[r.pior.c]} (${fmtNota(r.pior.m)})` : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--color-text-muted)]">Alertas de regra</dt>
                    <dd className={cn('font-medium', r.alertas ? 'text-[var(--color-error)]' : 'text-[var(--color-text-primary)]')}>
                      {r.alertas}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>

          <div className="glass-card rounded-xl divide-y divide-[var(--color-border-divider)]">
            {ordenadas.map((a) => {
              const expandido = aberto === a.id;
              return (
                <div key={a.id}>
                  <button
                    type="button"
                    onClick={() => setAberto(expandido ? null : a.id)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-[var(--color-bg-subtle)]"
                  >
                    {expandido
                      ? <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
                      : <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />}
                    <span className={cn('mt-0.5 w-12 shrink-0 rounded-md py-0.5 text-center text-sm font-bold tabular-nums', tomDaNota(a.nota_geral))}>
                      {a.status === 'avaliado' ? fmtNota(a.nota_geral) : '—'}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 text-sm">
                        <span className="font-medium text-[var(--color-text-primary)]">{a.paciente ?? 'Paciente'}</span>
                        <span className="text-xs text-[var(--color-text-muted)]">
                          {fmtDia(a.dia)}{isAdmin ? ` · ${nomeDe(a.operador_id)}` : ''}
                        </span>
                        {a.alertas.map((al, i) => (
                          <span key={i} className="inline-flex items-center gap-1 rounded-full bg-[var(--color-error-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-error)]">
                            <AlertTriangle className="h-3 w-3" />
                            {REGRA_ROTULO[al.regra] ?? al.regra}
                          </span>
                        ))}
                        {a.metricas.paciente_esperando_no_fim && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-warning-bg)] px-2 py-0.5 text-[11px] text-[var(--color-warning-text)]">
                            <MessageCircleWarning className="h-3 w-3" />
                            Paciente sem resposta
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-[var(--color-text-secondary)]">
                        {a.status === 'avaliado'
                          ? a.resumo
                          : a.status === 'insuficiente'
                            ? 'Conversa curta demais para avaliar com justiça.'
                            : a.erro ?? 'A IA não respondeu.'}
                      </p>
                    </div>
                  </button>

                  {expandido && (
                    <div className="space-y-4 bg-[var(--color-bg-subtle)] px-4 pb-4 pl-[4.25rem] pt-1">
                      {a.alertas.length > 0 && (
                        <div className="space-y-1.5">
                          {a.alertas.map((al, i) => (
                            <div key={i} className="rounded-lg border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-xs">
                              <div className="font-semibold text-[var(--color-error)]">{REGRA_ROTULO[al.regra] ?? al.regra}</div>
                              <div className="mt-0.5 italic text-[var(--color-text-primary)]">“{al.trecho}”</div>
                            </div>
                          ))}
                        </div>
                      )}

                      {a.status === 'avaliado' && (
                        <div className="grid gap-3 md:grid-cols-2">
                          {CRITERIOS.map((c) => {
                            const cr = a.criterios[c];
                            if (!cr) return null;
                            return (
                              <div key={c} className="rounded-lg bg-[var(--color-bg-surface)] p-3 text-xs">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold text-[var(--color-text-primary)]">{CRITERIO_ROTULO[c]}</span>
                                  <span className="tabular-nums text-[var(--color-text-secondary)]">
                                    {cr.nota === null ? 'não se aplicou' : fmtNota(cr.nota)}
                                  </span>
                                </div>
                                {cr.nota !== null && (
                                  <div className="mt-1.5 h-1.5 rounded-full bg-[var(--color-bg-subtle)]">
                                    <div className={cn('h-1.5 rounded-full', corDaBarra(cr.nota))} style={{ width: `${cr.nota * 10}%` }} />
                                  </div>
                                )}
                                {cr.justificativa && <p className="mt-2 text-[var(--color-text-secondary)]">{cr.justificativa}</p>}
                                {cr.trecho && <p className="mt-1 italic text-[var(--color-text-muted)]">“{cr.trecho}”</p>}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {(a.pontos_fortes.length > 0 || a.a_melhorar.length > 0) && (
                        <div className="grid gap-3 md:grid-cols-2 text-xs">
                          <div>
                            <div className="mb-1 font-semibold text-[var(--color-success)]">O que já está bom</div>
                            <ul className="list-disc space-y-0.5 pl-4 text-[var(--color-text-primary)]">
                              {a.pontos_fortes.map((p, i) => <li key={i}>{p}</li>)}
                            </ul>
                          </div>
                          <div>
                            <div className="mb-1 font-semibold text-[var(--color-warning-text)]">Para ajustar</div>
                            <ul className="list-disc space-y-0.5 pl-4 text-[var(--color-text-primary)]">
                              {a.a_melhorar.map((p, i) => <li key={i}>{p}</li>)}
                            </ul>
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-secondary)]">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          Resposta: {fmtMin(a.metricas.resposta_mediana_min ?? null)}
                          {a.metricas.respostas_fora_janela ? ` · ${a.metricas.respostas_fora_janela} fora do expediente` : ''}
                        </span>
                        <span>
                          {a.metricas.msgs_atendente ?? 0} mensagem(ns) da atendente · {a.metricas.msgs_paciente ?? 0} do paciente
                        </span>
                        <Link
                          to={`/inbox?conversation=${a.conversation_id}`}
                          className="ml-auto inline-flex items-center gap-1 font-medium text-[var(--color-accent-primary)] hover:underline"
                        >
                          Abrir conversa <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <p className="text-[11px] text-[var(--color-text-muted)]">
            Avaliação feita pela IA — serve para treinar, não substitui a leitura de quem supervisiona. Toda nota traz
            um trecho da própria conversa; alerta só aparece quando há frase da atendente que prove a regra quebrada.
            Atendimento com alerta tem a nota geral limitada a 5.
          </p>
        </>
      )}
    </div>
  );
}
