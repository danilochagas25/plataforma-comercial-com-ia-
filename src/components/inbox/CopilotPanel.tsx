// ============================================================================
// CopilotPanel — o copiloto da atendente, dentro da conversa.
// ----------------------------------------------------------------------------
// COPILOTO, NÃO PILOTO. A IA sugere; a atendente lê, edita se quiser e é ELA
// quem envia. "Usar" apenas escreve o texto na caixa de mensagem logo abaixo —
// nenhum caminho deste arquivo envia nada para o paciente.
//
// Três blocos, na ordem do desenho aprovado:
//   1. Contexto do caso — o que hoje exige abrir três telas.
//   2. A leitura do caso — o que trava, qual a alavanca, o que evitar.
//   3. Sugestão de resposta — com [Usar] · [Editar] · [Escrever eu mesma].
//
// CUSTO. O bloco 1 vem do banco e é de graça: carrega sozinho ao abrir a
// conversa (`apenas_contexto`). Os blocos 2 e 3 custam uma chamada de LLM, e
// por isso só saem quando a atendente clica em "Analisar o caso". Com 81
// orçamentos abertos, gerar sugestão a cada clique na lista queimaria dinheiro
// em conversas que ninguém ia responder naquele momento.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, Bot, ChevronDown, ChevronUp, Clock, Copy, Loader2,
  PencilLine, Sparkles, Stethoscope, Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { functionErrorMessage, getSupabase } from '@/lib/supabase';
import { PARADO_CHIP_CLASS, rotuloParado, tomParado } from '@/lib/diasParado';

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Espelha o payload de supabase/functions/copilot-suggest/index.ts.
interface CopilotOrcamento {
  deal_id: string;
  titulo: string;
  valor: number | null;
  etapa: string | null;
  dias_parado: number | null;
  dt_orcamento: string | null;
  tratamento: string | null;
  especialidade: string | null;
  dentista: string | null;
  tabela_preco: string | null;
  vinculo: 'filiado' | 'particular' | 'indefinido';
  procedimentos: string[];
  parcela_24x: number | null;
  parcela_12x: number | null;
}

interface CopilotContexto {
  contato_nome: string | null;
  contato_primeiro_nome: string | null;
  telefone: string | null;
  orcamentos: CopilotOrcamento[];
  total_orcamentos_abertos: number;
  ultimo_template_enviado: { nome: string | null; quando: string } | null;
  botao_tocado: { texto: string; quando: string; confianca: 'confirmado' | 'provavel' } | null;
  ultima_mensagem_paciente: { texto: string | null; quando: string } | null;
  horas_sem_resposta: number | null;
  janela_24h_aberta: boolean;
  total_mensagens: number;
}

interface CopilotData {
  contexto: CopilotContexto;
  leitura: string | null;
  sugestao: string | null;
  avisos: string[];
  origem: 'llm' | 'cache' | 'somente_contexto';
}

interface CopilotPanelProps {
  conversationId: string;
  /** Empurra a sugestão para a caixa de mensagem. NÃO envia. */
  onUsar: (texto: string) => void;
}

function dataCurta(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Rótulo do vínculo. FILIADO do Cartão de TODOS — nunca "sócio". */
function VinculoChip({ vinculo }: { vinculo: CopilotOrcamento['vinculo'] }) {
  if (vinculo === 'filiado') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-highlight)] px-2 py-0.5 text-[10px] font-bold text-[var(--accent-primary)]">
        Filiado Cartão de TODOS
      </span>
    );
  }
  if (vinculo === 'particular') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-subtle)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-text-secondary)]">
        Particular
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-warning-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-warning)]">
      Vínculo não informado
    </span>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-label)]">
        {rotulo}
      </div>
      <div className="truncate text-[13px] text-[var(--color-text-primary)]" title={valor}>
        {valor}
      </div>
    </div>
  );
}

function OrcamentoCard({ o }: { o: CopilotOrcamento }) {
  return (
    <div className="rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-bg-surface)] p-3 space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">
          {o.tratamento ?? o.titulo}
        </span>
        <VinculoChip vinculo={o.vinculo} />
        {o.dias_parado !== null && (
          <span
            className={`ml-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold ${PARADO_CHIP_CLASS[tomParado(o.dias_parado)]}`}
          >
            <Clock className="h-2.5 w-2.5" />
            Parado {rotuloParado(o.dias_parado)}
          </span>
        )}
      </div>

      {/* Dinheiro em PARCELA MENSAL. O valor cheio fica em segundo plano — é o
          número que trava a conversa quando dito primeiro. */}
      {o.parcela_24x !== null && (
        <div className="flex items-baseline gap-2 rounded-md bg-[var(--color-bg-highlight)] px-2.5 py-1.5">
          <Wallet className="h-3.5 w-3.5 shrink-0 text-[var(--accent-primary)]" />
          <span className="text-[15px] font-bold text-[var(--accent-primary)]">
            ~{brl(o.parcela_24x)}/mês
          </span>
          <span className="text-[11px] text-[var(--color-text-secondary)]">
            em 24x boleto
            {o.parcela_12x !== null && ` · ~${brl(o.parcela_12x)} em 12x cartão`}
          </span>
        </div>
      )}
      <p className="text-[10px] leading-snug text-[var(--color-text-label)]">
        Parcela estimada por divisão simples. Confirme a condição com a equipe antes de fechar.
      </p>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
        {o.valor !== null && <Campo rotulo="Valor total" valor={brl(o.valor)} />}
        {o.dt_orcamento && <Campo rotulo="Orçamento" valor={dataCurta(o.dt_orcamento) ?? o.dt_orcamento} />}
        {o.especialidade && <Campo rotulo="Especialidade" valor={o.especialidade} />}
        {o.dentista && <Campo rotulo="Dentista" valor={o.dentista} />}
        {o.etapa && <Campo rotulo="Etapa" valor={o.etapa} />}
      </div>
    </div>
  );
}

export function CopilotPanel({ conversationId, onUsar }: CopilotPanelProps) {
  const [aberto, setAberto] = useState(
    () => localStorage.getItem('inbox_copilot_aberto') !== '0',
  );
  const [data, setData] = useState<CopilotData | null>(null);
  const [carregandoContexto, setCarregandoContexto] = useState(false);
  const [analisando, setAnalisando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const alternar = () =>
    setAberto((v) => {
      localStorage.setItem('inbox_copilot_aberto', v ? '0' : '1');
      return !v;
    });

  const chamar = useCallback(
    async (apenasContexto: boolean) => {
      const supabase = getSupabase();
      const { data: res, error } = await supabase.functions.invoke('copilot-suggest', {
        body: { conversation_id: conversationId, apenas_contexto: apenasContexto },
      });
      if (error || !res?.ok) {
        // Mesmo no erro a função devolve o contexto quando conseguiu montá-lo —
        // a atendente continua vendo os fatos do caso.
        const parcial = (res as { data?: CopilotData } | null)?.data ?? null;
        if (parcial?.contexto) setData(parcial);
        throw new Error(await functionErrorMessage(error, res));
      }
      setData((res as { data: CopilotData }).data);
    },
    [conversationId],
  );

  // Bloco 1 (contexto) carrega sozinho ao trocar de conversa. Sem LLM, sem custo.
  useEffect(() => {
    let vivo = true;
    setData(null);
    setErro(null);
    if (!conversationId) return;
    setCarregandoContexto(true);
    void chamar(true)
      .catch((e: unknown) => {
        if (vivo) setErro(e instanceof Error ? e.message : 'Falha ao carregar o caso.');
      })
      .finally(() => {
        if (vivo) setCarregandoContexto(false);
      });
    return () => {
      vivo = false;
    };
  }, [conversationId, chamar]);

  const analisar = async () => {
    setAnalisando(true);
    setErro(null);
    try {
      await chamar(false);
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'A IA não respondeu.');
    } finally {
      setAnalisando(false);
    }
  };

  const ctx = data?.contexto ?? null;
  const temSugestao = Boolean(data?.sugestao);

  return (
    <div className="border-t border-[var(--color-border-soft)] bg-[var(--color-bg-subtle)]">
      {/* Cabeçalho — sempre visível, recolhe o painel inteiro. */}
      <button
        type="button"
        onClick={alternar}
        aria-expanded={aberto}
        className="flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-[var(--color-bg-highlight)]"
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-[var(--accent-primary)]" />
        <span className="text-label">Copiloto</span>
        {ctx && ctx.total_orcamentos_abertos > 0 && (
          <span className="rounded-md bg-[var(--color-bg-highlight)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--accent-primary)]">
            {ctx.total_orcamentos_abertos} orçamento{ctx.total_orcamentos_abertos !== 1 ? 's' : ''}
          </span>
        )}
        <span className="ml-auto text-[10px] text-[var(--color-text-label)]">
          Sugere. Quem envia é você.
        </span>
        {aberto ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-[var(--color-text-secondary)]" />
        ) : (
          <ChevronUp className="h-4 w-4 shrink-0 text-[var(--color-text-secondary)]" />
        )}
      </button>

      {aberto && (
        <div className="max-h-[42vh] space-y-3 overflow-y-auto px-4 pb-3">
          {/* ---------------------------------------------------------------
              BLOCO 1 — CONTEXTO DO CASO
              Fatos do banco, montados na Edge Function. A IA não escreve nada
              aqui: valor errado com cara de verdade chegaria ao paciente.
              --------------------------------------------------------------- */}
          {carregandoContexto && !ctx && (
            <div className="flex items-center gap-2 py-3 text-[13px] text-[var(--color-text-secondary)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Carregando o caso…
            </div>
          )}

          {ctx && (
            <div className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-label)]">
                1 · Contexto do caso
              </div>

              {ctx.orcamentos.length === 0 ? (
                <div className="rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-bg-surface)] px-3 py-2.5 text-[13px] text-[var(--color-text-secondary)]">
                  Nenhum orçamento aberto no CRM para este paciente.
                </div>
              ) : (
                <div className="space-y-2">
                  {ctx.orcamentos.map((o) => (
                    <OrcamentoCard key={o.deal_id} o={o} />
                  ))}
                </div>
              )}

              {/* O que a clínica mandou e o que o paciente fez com isso. */}
              {(ctx.ultimo_template_enviado || ctx.botao_tocado) && (
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-text-secondary)]">
                  {ctx.ultimo_template_enviado && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-surface)] px-2 py-1">
                      <Stethoscope className="h-3 w-3 shrink-0 text-[var(--color-text-label)]" />
                      Enviado {dataCurta(ctx.ultimo_template_enviado.quando)}
                    </span>
                  )}
                  {ctx.botao_tocado && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-highlight)] px-2 py-1 font-semibold text-[var(--accent-primary)]">
                      Tocou em “{ctx.botao_tocado.texto}”
                      {ctx.botao_tocado.confianca === 'provavel' && (
                        <span className="font-normal text-[var(--color-text-secondary)]">(provável)</span>
                      )}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ---------------------------------------------------------------
              BLOCOS 2 e 3 — custam LLM, então só depois do clique.
              --------------------------------------------------------------- */}
          {ctx && !temSugestao && !erro && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void analisar()}
              disabled={analisando}
            >
              {analisando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
              {analisando ? 'Analisando…' : 'Analisar o caso e sugerir resposta'}
            </Button>
          )}

          {erro && (
            <div className="flex items-start gap-2 rounded-lg border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-3 py-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-warning)]" />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] text-[var(--color-text-primary)]">{erro}</p>
                <button
                  type="button"
                  onClick={() => void analisar()}
                  disabled={analisando}
                  className="mt-1 text-[11px] font-semibold text-[var(--accent-primary)] hover:underline disabled:opacity-50"
                >
                  Tentar de novo
                </button>
              </div>
            </div>
          )}

          {data?.leitura && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-label)]">
                2 · A leitura do caso
              </div>
              <p className="rounded-lg border-l-2 border-[var(--color-brand-fill)] bg-[var(--color-bg-surface)] px-3 py-2 text-[13px] leading-relaxed text-[var(--color-text-primary)]">
                {data.leitura}
              </p>
            </div>
          )}

          {data?.sugestao && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-label)]">
                3 · Sugestão de resposta
              </div>
              <p className="whitespace-pre-wrap rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-bg-surface)] px-3 py-2.5 text-[13px] leading-relaxed text-[var(--color-text-primary)]">
                {data.sugestao}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {/* "Usar" e "Editar" fazem a MESMA coisa de propósito: os dois
                    escrevem na caixa e param ali. A diferença é só o que a
                    atendente pretende fazer depois — e nenhum dos dois envia. */}
                <Button type="button" size="sm" onClick={() => onUsar(data.sugestao ?? '')}>
                  <Copy className="h-4 w-4" />
                  Usar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onUsar(data.sugestao ?? '')}
                >
                  <PencilLine className="h-4 w-4" />
                  Editar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setData({ ...data, leitura: null, sugestao: null })}
                >
                  Escrever eu mesma
                </Button>
                <span className="text-[10px] text-[var(--color-text-label)]">
                  Preenche a caixa abaixo. O envio continua sendo seu.
                </span>
              </div>
            </div>
          )}

          {/* Avisos honestos: o que faltou para a sugestão sair melhor. */}
          {data && data.avisos.length > 0 && (
            <ul className="space-y-0.5">
              {data.avisos.map((a) => (
                <li key={a} className="text-[10px] leading-snug text-[var(--color-text-label)]">
                  · {a}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
