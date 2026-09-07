import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import {
  META_CONVERSAO_GERAL,
  META_POR_ESPECIALIDADE,
  ESPECIALIDADE_LABEL,
  type PeriodRange,
} from '@/lib/dashboard';

// -----------------------------------------------------------------------------
// Conversão de orçamentos da odontologia.
//
// Responde as quatro perguntas do dono: quanto foi orçado, quanto fechou,
// quanto está parado e o quanto isso está longe da meta da franqueadora.
//
// Regras de negócio (ODONTO.md + decisões de 06 e 07/09/2026):
//  - cada `deal` é UM TRATAMENTO, não um paciente;
//  - APROVADO  = etapa com `is_won` (ou `status = 'won'`, para o card que
//    nasceu na etapa certa mas cuja gravação parou no meio);
//  - NÃO APROVADO = etapa com `is_lost` (ou `status = 'lost'`);
//  - PARADO    = todo o resto — não fechou e ainda não foi descartado;
//  - ORÇADO    = aprovado + não aprovado + parado (tudo do período);
//  - a especialidade vem de `deal_products → products.product_type`, nunca do
//    campo de texto `especialidade`, que é livre e não sobrevive a renomeação;
//  - o período é medido pela **Dt Orçamento** (`custom_fields.key =
//    'dt_orcamento'`), não por `created_at` — `created_at` é a hora da
//    importação e colocaria a base inteira no mesmo dia.
// -----------------------------------------------------------------------------

export interface ConversaoBloco {
  count: number;
  value: number;
}

export interface EspecialidadeLinha {
  /** `products.product_type` — chave estável. */
  tipo: string;
  label: string;
  orcado: ConversaoBloco;
  aprovado: ConversaoBloco;
  naoAprovado: ConversaoBloco;
  parado: ConversaoBloco;
  /** Aprovados ÷ orçados, em % (null quando não houve orçamento). */
  conversao: number | null;
  /** Meta oficial da franqueadora, em % (null quando não há meta definida). */
  meta: number | null;
}

export interface FaixaParado {
  label: string;
  count: number;
  value: number;
}

export interface OdontoConversao {
  orcado: ConversaoBloco;
  aprovado: ConversaoBloco;
  naoAprovado: ConversaoBloco;
  parado: ConversaoBloco;
  /** % do VALOR orçado que virou tratamento aprovado. */
  conversaoValor: number | null;
  /** % dos TRATAMENTOS orçados que foram aprovados. */
  conversaoTratamentos: number | null;
  metaGeral: number;
  especialidades: EspecialidadeLinha[];
  /** Parados com mais de 7 dias de orçamento — a régua do dono. */
  paradoMais7: ConversaoBloco;
  faixasParado: FaixaParado[];
  /** true quando o funil "Odonto — Orçamentos" não existe no banco. */
  semFunil: boolean;
}

const BLOCO_VAZIO: ConversaoBloco = { count: 0, value: 0 };

const VAZIO: OdontoConversao = {
  orcado: BLOCO_VAZIO,
  aprovado: BLOCO_VAZIO,
  naoAprovado: BLOCO_VAZIO,
  parado: BLOCO_VAZIO,
  conversaoValor: null,
  conversaoTratamentos: null,
  metaGeral: META_CONVERSAO_GERAL,
  especialidades: [],
  paradoMais7: BLOCO_VAZIO,
  faixasParado: [],
  semFunil: false,
};

type Situacao = 'aprovado' | 'nao_aprovado' | 'parado';

interface DealOdonto {
  id: string;
  value: number;
  situacao: Situacao;
  /** 'YYYY-MM-DD' */
  dtOrcamento: string;
  tipo: string;
  diasParado: number;
}

// Data local em 'YYYY-MM-DD'. Não usar toISOString(): ele converte para UTC e
// no fuso do Brasil joga o orçamento da noite para o dia seguinte.
function chaveData(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function soma(deals: DealOdonto[]): ConversaoBloco {
  return {
    count: deals.length,
    value: deals.reduce((s, d) => s + d.value, 0),
  };
}

function pct(parte: number, total: number): number | null {
  if (!total) return null;
  return (parte / total) * 100;
}

// Faixas de estagnação. A primeira quebra é em 7 dias porque é o limite da
// régua do dono ("orçamento parado há mais de uma semana já esfriou").
const FAIXAS: { label: string; min: number; max: number }[] = [
  { label: 'Até 7 dias', min: 0, max: 7 },
  { label: '8 a 15 dias', min: 8, max: 15 },
  { label: '16 a 30 dias', min: 16, max: 30 },
  { label: 'Mais de 30 dias', min: 31, max: Number.POSITIVE_INFINITY },
];

function agrega(deals: DealOdonto[], metaGeral: number): OdontoConversao {
  const aprovados = deals.filter((d) => d.situacao === 'aprovado');
  const naoAprovados = deals.filter((d) => d.situacao === 'nao_aprovado');
  const parados = deals.filter((d) => d.situacao === 'parado');

  const orcado = soma(deals);
  const aprovado = soma(aprovados);

  // Por especialidade: mesma fórmula do geral (aprovados ÷ orçados), para que
  // a soma das linhas feche com o cartão de cima.
  const porTipo = new Map<string, DealOdonto[]>();
  for (const d of deals) {
    const arr = porTipo.get(d.tipo);
    if (arr) arr.push(d);
    else porTipo.set(d.tipo, [d]);
  }
  const especialidades: EspecialidadeLinha[] = [...porTipo.entries()]
    .map(([tipo, lista]) => {
      const ap = lista.filter((d) => d.situacao === 'aprovado');
      const na = lista.filter((d) => d.situacao === 'nao_aprovado');
      const pa = lista.filter((d) => d.situacao === 'parado');
      return {
        tipo,
        label: ESPECIALIDADE_LABEL[tipo] ?? tipo,
        orcado: soma(lista),
        aprovado: soma(ap),
        naoAprovado: soma(na),
        parado: soma(pa),
        conversao: pct(ap.length, lista.length),
        meta: META_POR_ESPECIALIDADE[tipo] ?? null,
      };
    })
    // Maior volume primeiro: é onde mora o dinheiro e a decisão.
    .sort((a, b) => b.orcado.value - a.orcado.value);

  const faixasParado: FaixaParado[] = FAIXAS.map((f) => {
    const lista = parados.filter((d) => d.diasParado >= f.min && d.diasParado <= f.max);
    return { label: f.label, count: lista.length, value: lista.reduce((s, d) => s + d.value, 0) };
  });

  return {
    orcado,
    aprovado,
    naoAprovado: soma(naoAprovados),
    parado: soma(parados),
    conversaoValor: pct(aprovado.value, orcado.value),
    conversaoTratamentos: pct(aprovado.count, orcado.count),
    metaGeral,
    especialidades,
    paradoMais7: soma(parados.filter((d) => d.diasParado > 7)),
    faixasParado,
    semFunil: false,
  };
}

export function useOdontoConversion(range: PeriodRange) {
  const [linhas, setLinhas] = useState<DealOdonto[] | null>(null);
  const [semFunil, setSemFunil] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = getSupabase();

    // 1. O funil da odonto. Procurado pelo nome ("Odonto — Orçamentos") para
    //    não depender de um id fixo entre ambientes.
    const pipesRes = await supabase.from('pipelines').select('id, name');
    if (pipesRes.error) {
      setError(pipesRes.error.message);
      setLinhas(null);
      setLoading(false);
      return;
    }
    const pipes = (pipesRes.data ?? []) as { id: string; name: string }[];
    const pipe = pipes.find((p) => /odonto/i.test(p.name ?? ''));
    if (!pipe) {
      setSemFunil(true);
      setLinhas([]);
      setLoading(false);
      return;
    }
    setSemFunil(false);

    // 2. Etapas (para saber qual é a de aprovado e a de não aprovado),
    //    orçamentos, itens do orçamento, catálogo e a Dt Orçamento.
    const campoRes = await supabase.from('custom_fields').select('id, key').eq('key', 'dt_orcamento');
    const campoId = ((campoRes.data ?? []) as { id: string; key: string }[])[0]?.id ?? null;

    const [stagesRes, dealsRes, dpRes, prodRes, cfvRes] = await Promise.all([
      supabase.from('stages').select('id, name, is_won, is_lost').eq('pipeline_id', pipe.id),
      supabase
        .from('deals')
        .select('id, value, stage_id, status, stage_entered_at, created_at')
        .eq('pipeline_id', pipe.id)
        .is('archived_at', null)
        .limit(20000),
      supabase.from('deal_products').select('deal_id, product_id').limit(20000),
      supabase.from('products').select('id, name, product_type'),
      campoId
        ? supabase.from('custom_field_values').select('deal_id, value').eq('custom_field_id', campoId).limit(20000)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const primeiroErro =
      campoRes.error || stagesRes.error || dealsRes.error || dpRes.error || prodRes.error || cfvRes.error;
    if (primeiroErro) {
      setError(primeiroErro.message);
      setLinhas(null);
      setLoading(false);
      return;
    }

    const stagePorId = new Map<string, { is_won: boolean; is_lost: boolean }>(
      ((stagesRes.data ?? []) as { id: string; is_won: boolean; is_lost: boolean }[]).map((s) => [
        s.id,
        { is_won: s.is_won, is_lost: s.is_lost },
      ]),
    );
    const tipoPorProduto = new Map<string, string>(
      ((prodRes.data ?? []) as { id: string; product_type: string | null }[]).map((p) => [
        p.id,
        p.product_type ?? 'sem_especialidade',
      ]),
    );
    // Um orçamento = um tratamento; se vier mais de um item, o primeiro manda.
    const tipoPorDeal = new Map<string, string>();
    for (const dp of (dpRes.data ?? []) as { deal_id: string; product_id: string | null }[]) {
      if (tipoPorDeal.has(dp.deal_id)) continue;
      const tipo = dp.product_id ? tipoPorProduto.get(dp.product_id) : undefined;
      if (tipo) tipoPorDeal.set(dp.deal_id, tipo);
    }
    const dtPorDeal = new Map<string, string>();
    for (const v of (cfvRes.data ?? []) as { deal_id: string; value: string | null }[]) {
      const s = (v.value ?? '').slice(0, 10);
      if (s) dtPorDeal.set(v.deal_id, s);
    }

    const hoje = new Date();
    const hojeMs = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime();

    const out: DealOdonto[] = [];
    for (const d of (dealsRes.data ?? []) as {
      id: string;
      value: number | null;
      stage_id: string | null;
      status: string | null;
      stage_entered_at: string | null;
      created_at: string;
    }[]) {
      const st = d.stage_id ? stagePorId.get(d.stage_id) : undefined;
      // Deal fora das etapas deste funil não entra na conta.
      if (!st) continue;
      const situacao: Situacao =
        d.status === 'won' || st.is_won ? 'aprovado' : d.status === 'lost' || st.is_lost ? 'nao_aprovado' : 'parado';

      // Sem Dt Orçamento (orçamento criado à mão no CRM), cai para a data de
      // criação — é o melhor carimbo disponível.
      const dtOrcamento = dtPorDeal.get(d.id) ?? chaveData(new Date(d.created_at));
      const dtMs = new Date(`${dtOrcamento}T00:00:00`).getTime();
      const diasParado = Number.isFinite(dtMs) ? Math.max(0, Math.floor((hojeMs - dtMs) / 86400000)) : 0;

      out.push({
        id: d.id,
        value: Number(d.value ?? 0),
        situacao,
        dtOrcamento,
        tipo: tipoPorDeal.get(d.id) ?? 'sem_especialidade',
        diasParado,
      });
    }

    setLinhas(out);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // O filtro de período é aplicado em memória: a base é pequena (centenas de
  // orçamentos) e assim trocar de mês não refaz as cinco consultas.
  const data = useMemo<OdontoConversao>(() => {
    if (!linhas) return { ...VAZIO, semFunil };
    const de = chaveData(range.from);
    const ate = chaveData(range.to);
    const noPeriodo = linhas.filter((d) => d.dtOrcamento >= de && d.dtOrcamento <= ate);
    return { ...agrega(noPeriodo, META_CONVERSAO_GERAL), semFunil };
  }, [linhas, semFunil, range.from, range.to]);

  return { data, loading, error, reload };
}
