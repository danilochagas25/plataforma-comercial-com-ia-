// ============================================================================
// src/lib/odontoImport.ts — importação DIÁRIA dos orçamentos não aprovados
// ----------------------------------------------------------------------------
// Duas etapas, sempre nesta ordem:
//
//   1. `planejarImportacao()` — SÓ LEITURA. Compara o arquivo com o banco e
//      devolve o que aconteceria. É a "simulação" que o dono vê antes de
//      confirmar. Nada é gravado aqui.
//   2. `aplicarImportacao()` — grava exatamente o plano que foi mostrado.
//
// REGRAS DE NEGÓCIO (decisões do Danilo, 06/09/2026):
//
//  · CONTATO = TELEFONE (é a conversa do WhatsApp). O nome do paciente vive no
//    ORÇAMENTO, não no contato. Motivo: 4 telefones do arquivo real atendem
//    mais de um paciente — um deles atende 3 pessoas da mesma família. O índice
//    `contacts_org_phone_canonical_key` proíbe dois contatos com o mesmo
//    telefone, e está certo assim.
//
//  · SINAL DE APROVAÇÃO POR AUSÊNCIA. O relatório traz APENAS não aprovados.
//    Logo, o orçamento que SOME do relatório do dia seguinte foi aprovado (ou
//    cancelado). É assim que a conversão é medida sem ninguém marcar nada na
//    mão. ⚠️ A inferência só vale para orçamentos DENTRO do período coberto
//    pelo export — senão um orçamento de agosto, ausente de um relatório de
//    setembro, seria dado como aprovado sem nenhuma evidência.
//
//  · D+7 ENCERRA. Orçamento que passou de 7 dias sem sair da primeira etapa vai
//    para "Não aprovado". Deal que um humano já moveu (negociação, aguardando
//    decisão) NÃO é encerrado automaticamente — só é reportado.
//
//  · IDEMPOTÊNCIA. `deals.external_ref` (`webdental:<paciente>:<data>`) com
//    índice único por org. Reimportar o mesmo arquivo atualiza, nunca duplica.
// ============================================================================

import { getSupabase } from '@/lib/supabase';
import { canonicalPhone, phoneVariants } from '@/lib/phone';
import type { Orcamento, ParseWebdentalResult } from '@/lib/webdental';

export const PIPELINE_ODONTO = 'Odonto — Orçamentos';
export const ETAPA_APRESENTADO = 'Orçamento apresentado';
export const ETAPA_APROVADO = 'Aprovado';
export const ETAPA_NAO_APROVADO = 'Não aprovado';
export const ORIGEM = 'WebDental · Controle de Efetivação';

/** Dias sem resposta até encerrar o orçamento como não aprovado. */
export const DIAS_ATE_ENCERRAR = 7;

// ---------------------------------------------------------------------------
// Tipos do plano
// ---------------------------------------------------------------------------

export interface AcaoDeal {
  externalRef: string;
  paciente: string;
  telefone: string;
  dtOrcamento: string;
  valor: number;
  /** Só em "atualizados": o que mudou, em português. */
  mudancas?: string[];
  /** Só em "aprovados"/"não aprovados": id do deal já existente. */
  dealId?: string;
  /** Dias parados na etapa (para as movimentações). */
  diasParado?: number;
}

export interface PlanoImportacao {
  pipelineId: string;
  etapas: Record<string, string>;
  periodo: { de: string | null; ate: string | null };
  /** Orçamentos que ainda não existem no CRM. */
  novos: AcaoDeal[];
  /** Já existem e alguma informação mudou. */
  atualizados: AcaoDeal[];
  /** Já existem e estão idênticos — nada a fazer. */
  inalterados: AcaoDeal[];
  /** Sumiram do relatório dentro do período → serão marcados como APROVADOS. */
  aprovados: AcaoDeal[];
  /** Passaram de 7 dias na primeira etapa → serão marcados como NÃO APROVADOS. */
  naoAprovados: AcaoDeal[];
  /** Parados há mais de 7 dias mas JÁ movidos por uma pessoa — não são tocados. */
  paradosEmNegociacao: AcaoDeal[];
  /**
   * Orçamentos que o CRM já tinha dado por encerrado (aprovado ou não aprovado)
   * e que VOLTARAM a aparecer no relatório de não aprovados. Sinal de que a
   * inferência anterior estava errada — mas desfazer é decisão de gente, não do
   * importador. Aqui só é reportado.
   */
  voltaramAoRelatorio: AcaoDeal[];
  contatosNovos: number;
  contatosExistentes: number;
  /** Telefones que atendem mais de um paciente. */
  familias: Array<{ telefone: string; pacientes: string[] }>;
  /** Procedimentos que não estão no catálogo e serão criados. */
  procedimentosNovos: string[];
  valorTotalArquivo: number;
  valorNovos: number;
  valorAprovados: number;
  avisos: string[];
}

export interface ResultadoImportacao {
  contatosCriados: number;
  contatosAtualizados: number;
  dealsCriados: number;
  dealsAtualizados: number;
  marcadosAprovados: number;
  marcadosNaoAprovados: number;
  procedimentosCriados: number;
  erros: string[];
}

// ---------------------------------------------------------------------------
// Estruturas internas carregadas do banco
// ---------------------------------------------------------------------------

interface DealExistente {
  id: string;
  external_ref: string;
  contact_id: string;
  stage_id: string | null;
  value: number | null;
  status: string;
  title: string;
  archived_at: string | null;
  stage_entered_at: string;
}

interface ContextoBanco {
  pipelineId: string;
  etapas: Record<string, string>;
  camposPorChave: Record<string, string>;
  produtosPorNome: Map<string, { id: string; product_type: string }>;
  dealsPorRef: Map<string, DealExistente>;
  valoresPorDeal: Map<string, Record<string, string>>;
  itensPorDeal: Map<string, Array<{ product_id: string; value: number; quantity: number }>>;
  contatoPorTelefone: Map<string, { id: string; phone: string; name: string | null; custom_fields: Record<string, unknown> }>;
}

const CHAVES_CAMPO = [
  'paciente_nome',
  'dt_orcamento',
  'tratamento',
  'especialidade',
  'dentista',
  'tabela_preco',
  'participacao_convenio',
  'dt_agenda',
  'origem_import',
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dinheiro = (n: number) => Math.round(n * 100) / 100;

function dataBr(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function diasDesde(iso: string, hoje: Date): number {
  const ref = new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime();
  const base = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate());
  return Math.floor((base - ref) / 86_400_000);
}

/** Título do deal, conforme ODONTO.md §4. */
export function tituloDoOrcamento(orc: Orcamento): string {
  const trat = orc.tratamentos.length > 60 ? `${orc.tratamentos.slice(0, 57)}…` : orc.tratamentos;
  return `Orçamento ${orc.pacienteNome} — ${trat} — ${dataBr(orc.dtOrcamento)}`;
}

/** Valores dos campos personalizados que este orçamento produz. */
function valoresDoOrcamento(orc: Orcamento): Record<string, string> {
  return {
    paciente_nome: orc.pacienteNome,
    dt_orcamento: orc.dtOrcamento,
    tratamento: orc.tratamentos,
    especialidade: orc.especialidade,
    dentista: orc.dentista,
    tabela_preco: orc.tabelaPreco,
    participacao_convenio: String(dinheiro(orc.participacaoConvenio)),
    dt_agenda: orc.dtAgenda ?? '',
    origem_import: ORIGEM,
  };
}

/** Data de decisão esperada: o orçamento tem 7 dias de régua. */
function previsaoFechamento(dtOrcamento: string): string {
  const d = new Date(`${dtOrcamento}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + DIAS_ATE_ENCERRAR);
  return d.toISOString().slice(0, 10);
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// ---------------------------------------------------------------------------
// Carregamento do contexto
// ---------------------------------------------------------------------------

async function carregarContexto(orcamentos: Orcamento[]): Promise<ContextoBanco> {
  const supabase = getSupabase();

  const { data: pipes, error: ePipe } = await supabase
    .from('pipelines')
    .select('id, name')
    .eq('name', PIPELINE_ODONTO)
    .limit(1);
  if (ePipe) throw new Error(`Não consegui ler os funis: ${ePipe.message}`);
  const pipelineId = (pipes ?? [])[0]?.id as string | undefined;
  if (!pipelineId) {
    throw new Error(
      `O funil "${PIPELINE_ODONTO}" não existe neste banco. Rode a migração de seed do CRM odonto antes de importar.`,
    );
  }

  const [stagesRes, camposRes, produtosRes, dealsRes] = await Promise.all([
    supabase.from('stages').select('id, name').eq('pipeline_id', pipelineId),
    supabase.from('custom_fields').select('id, key, label'),
    supabase.from('products').select('id, name, product_type'),
    supabase
      .from('deals')
      .select('id, external_ref, contact_id, stage_id, value, status, title, archived_at, stage_entered_at')
      .eq('pipeline_id', pipelineId)
      .like('external_ref', 'webdental:%'),
  ]);

  if (stagesRes.error) throw new Error(`Etapas: ${stagesRes.error.message}`);
  if (camposRes.error) throw new Error(`Campos personalizados: ${camposRes.error.message}`);
  if (produtosRes.error) throw new Error(`Catálogo: ${produtosRes.error.message}`);
  if (dealsRes.error) throw new Error(`Oportunidades: ${dealsRes.error.message}`);

  const etapas: Record<string, string> = {};
  for (const s of (stagesRes.data ?? []) as Array<{ id: string; name: string }>) etapas[s.name] = s.id;
  for (const nome of [ETAPA_APRESENTADO, ETAPA_APROVADO, ETAPA_NAO_APROVADO]) {
    if (!etapas[nome]) throw new Error(`A etapa "${nome}" não existe no funil ${PIPELINE_ODONTO}.`);
  }

  const camposPorChave: Record<string, string> = {};
  for (const c of (camposRes.data ?? []) as Array<{ id: string; key: string | null }>) {
    if (c.key) camposPorChave[c.key] = c.id;
  }
  const faltando = CHAVES_CAMPO.filter((k) => !camposPorChave[k]);
  if (faltando.length > 0) {
    throw new Error(`Faltam campos personalizados no banco: ${faltando.join(', ')}.`);
  }

  const produtosPorNome = new Map<string, { id: string; product_type: string }>();
  for (const p of (produtosRes.data ?? []) as Array<{ id: string; name: string; product_type: string }>) {
    produtosPorNome.set(p.name.toLowerCase(), { id: p.id, product_type: p.product_type });
  }

  const deals = (dealsRes.data ?? []) as DealExistente[];
  const dealsPorRef = new Map(deals.map((d) => [d.external_ref, d]));

  // Valores e itens dos deals já existentes — só para saber o que MUDOU.
  const valoresPorDeal = new Map<string, Record<string, string>>();
  const itensPorDeal = new Map<string, Array<{ product_id: string; value: number; quantity: number }>>();
  const ids = deals.map((d) => d.id);
  for (const lote of chunk(ids, 200)) {
    const [cfv, dp] = await Promise.all([
      supabase.from('custom_field_values').select('deal_id, custom_field_id, value').in('deal_id', lote),
      supabase.from('deal_products').select('deal_id, product_id, value, quantity').in('deal_id', lote),
    ]);
    const chavePorId: Record<string, string> = {};
    for (const [k, id] of Object.entries(camposPorChave)) chavePorId[id] = k;
    for (const v of (cfv.data ?? []) as Array<{ deal_id: string; custom_field_id: string; value: string | null }>) {
      const chave = chavePorId[v.custom_field_id];
      if (!chave) continue;
      const atual = valoresPorDeal.get(v.deal_id) ?? {};
      atual[chave] = v.value ?? '';
      valoresPorDeal.set(v.deal_id, atual);
    }
    for (const it of (dp.data ?? []) as Array<{ deal_id: string; product_id: string; value: number | null; quantity: number | null }>) {
      const lista = itensPorDeal.get(it.deal_id) ?? [];
      lista.push({ product_id: it.product_id, value: Number(it.value ?? 0), quantity: Number(it.quantity ?? 1) });
      itensPorDeal.set(it.deal_id, lista);
    }
  }

  // Contatos: busca por TODAS as grafias equivalentes do telefone (a Meta
  // entrega número BR sem o nono dígito — MEMORIA.md 06/09/2026).
  const contatoPorTelefone = new Map<string, { id: string; phone: string; name: string | null; custom_fields: Record<string, unknown> }>();
  const telefones = [...new Set(orcamentos.map((o) => o.telefone))];
  const buscas = [...new Set(telefones.flatMap((t) => phoneVariants(t)))];
  for (const lote of chunk(buscas, 300)) {
    const { data, error } = await supabase
      .from('contacts')
      .select('id, phone, name, custom_fields')
      .in('phone', lote);
    if (error) throw new Error(`Contatos: ${error.message}`);
    for (const c of (data ?? []) as Array<{ id: string; phone: string; name: string | null; custom_fields: Record<string, unknown> | null }>) {
      const canon = canonicalPhone(c.phone);
      if (canon && !contatoPorTelefone.has(canon)) {
        contatoPorTelefone.set(canon, { id: c.id, phone: c.phone, name: c.name, custom_fields: c.custom_fields ?? {} });
      }
    }
  }

  return {
    pipelineId,
    etapas,
    camposPorChave,
    produtosPorNome,
    dealsPorRef,
    valoresPorDeal,
    itensPorDeal,
    contatoPorTelefone,
  };
}

// ---------------------------------------------------------------------------
// Planejamento (simulação — nada é gravado)
// ---------------------------------------------------------------------------

export interface OpcoesImportacao {
  /** Marcar como aprovado quem sumiu do relatório (padrão: sim). */
  inferirAprovados: boolean;
  /** Encerrar como não aprovado quem passou de 7 dias (padrão: sim). */
  encerrarVencidos: boolean;
  /** "Hoje" — injetável para teste. */
  hoje?: Date;
}

export const OPCOES_PADRAO: OpcoesImportacao = {
  inferirAprovados: true,
  encerrarVencidos: true,
};

export async function planejarImportacao(
  leitura: ParseWebdentalResult,
  opcoes: OpcoesImportacao = OPCOES_PADRAO,
): Promise<{ plano: PlanoImportacao; ctx: ContextoBanco }> {
  const ctx = await carregarContexto(leitura.orcamentos);
  const hoje = opcoes.hoje ?? new Date();
  const avisos = [...leitura.avisos];

  const novos: AcaoDeal[] = [];
  const atualizados: AcaoDeal[] = [];
  const inalterados: AcaoDeal[] = [];
  const voltaramAoRelatorio: AcaoDeal[] = [];
  const procedimentosNovos = new Set<string>();
  const telefonesNovos = new Set<string>();
  const telefonesExistentes = new Set<string>();

  for (const orc of leitura.orcamentos) {
    const base: AcaoDeal = {
      externalRef: orc.externalRef,
      paciente: orc.pacienteNome,
      telefone: orc.telefone,
      dtOrcamento: orc.dtOrcamento,
      valor: orc.valorTotal,
    };

    if (ctx.contatoPorTelefone.has(orc.telefone)) telefonesExistentes.add(orc.telefone);
    else telefonesNovos.add(orc.telefone);

    for (const it of orc.itens) {
      if (!ctx.produtosPorNome.has(it.tratamento.toLowerCase())) procedimentosNovos.add(it.tratamento);
    }

    const existente = ctx.dealsPorRef.get(orc.externalRef);
    if (!existente) {
      novos.push(base);
      continue;
    }

    // Estava encerrado e voltou ao relatório de NÃO aprovados: a inferência
    // anterior não se sustentou. Reabrir é decisão de gente — aqui só reporta.
    if (existente.status !== 'open') {
      voltaramAoRelatorio.push({ ...base, dealId: existente.id });
    }

    const mudancas: string[] = [];
    if (dinheiro(Number(existente.value ?? 0)) !== orc.valorTotal) {
      mudancas.push(`valor ${dinheiro(Number(existente.value ?? 0))} → ${orc.valorTotal}`);
    }
    const tituloNovo = tituloDoOrcamento(orc);
    if (existente.title !== tituloNovo) mudancas.push('título');

    const atuais = ctx.valoresPorDeal.get(existente.id) ?? {};
    const desejados = valoresDoOrcamento(orc);
    for (const [chave, valor] of Object.entries(desejados)) {
      if ((atuais[chave] ?? '') !== valor) mudancas.push(chave.replace(/_/g, ' '));
    }

    // Itens: compara pelo par (produto, valor, quantidade).
    const itensAtuais = (ctx.itensPorDeal.get(existente.id) ?? [])
      .map((i) => `${i.product_id}|${dinheiro(i.value)}|${i.quantity}`)
      .sort()
      .join(';');
    const itensDesejados = orc.itens
      .map((it) => {
        const p = ctx.produtosPorNome.get(it.tratamento.toLowerCase());
        return `${p?.id ?? 'novo:' + it.tratamento}|${dinheiro(it.valor)}|${it.quantidade}`;
      })
      .sort()
      .join(';');
    if (itensAtuais !== itensDesejados) mudancas.push('procedimentos');

    const contatoAtual = ctx.contatoPorTelefone.get(orc.telefone);
    if (contatoAtual && contatoAtual.id !== existente.contact_id) mudancas.push('contato');

    if (mudancas.length === 0) inalterados.push(base);
    else atualizados.push({ ...base, mudancas: [...new Set(mudancas)], dealId: existente.id });
  }

  // --- Sumiu do relatório = APROVADO ---------------------------------------
  // Só dentro do período coberto pelo export, e só o que estava aberto.
  const refsNoArquivo = new Set(leitura.orcamentos.map((o) => o.externalRef));
  const etapaApresentado = ctx.etapas[ETAPA_APRESENTADO];
  const aprovados: AcaoDeal[] = [];
  const naoAprovados: AcaoDeal[] = [];
  const paradosEmNegociacao: AcaoDeal[] = [];

  for (const deal of ctx.dealsPorRef.values()) {
    if (deal.archived_at) continue;
    if (deal.status !== 'open') continue;

    const valores = ctx.valoresPorDeal.get(deal.id) ?? {};
    const dt = valores.dt_orcamento || deal.external_ref.split(':').pop() || '';
    const paciente = valores.paciente_nome || deal.title;
    const dentroDoPeriodo =
      !leitura.periodo.de || !leitura.periodo.ate
        ? false
        : dt >= leitura.periodo.de && dt <= leitura.periodo.ate;
    const dias = dt ? diasDesde(dt, hoje) : 0;

    const acao: AcaoDeal = {
      externalRef: deal.external_ref,
      paciente,
      telefone: '',
      dtOrcamento: dt,
      valor: dinheiro(Number(deal.value ?? 0)),
      dealId: deal.id,
      diasParado: dias,
    };

    if (!refsNoArquivo.has(deal.external_ref)) {
      if (opcoes.inferirAprovados && dentroDoPeriodo) {
        aprovados.push(acao);
      }
      continue;
    }

    // Continua no relatório (= continua não aprovado) e já passou do prazo.
    if (opcoes.encerrarVencidos && dias > DIAS_ATE_ENCERRAR) {
      if (deal.stage_id === etapaApresentado) naoAprovados.push(acao);
      else paradosEmNegociacao.push(acao);
    }
  }

  if (voltaramAoRelatorio.length > 0) {
    avisos.push(
      `${voltaramAoRelatorio.length} orçamento(s) que o CRM já tinha encerrado voltaram a aparecer no ` +
        `relatório de não aprovados (${voltaramAoRelatorio.map((v) => v.paciente).slice(0, 3).join(', ')}` +
        `${voltaramAoRelatorio.length > 3 ? '…' : ''}). A importação NÃO reabre sozinha — revise na mão.`,
    );
  }

  if (!leitura.periodo.de || !leitura.periodo.ate) {
    avisos.push(
      'Não identifiquei o período do relatório. Por segurança, NENHUM orçamento será marcado ' +
        'como aprovado por ausência nesta importação.',
    );
  }

  // Famílias (telefone compartilhado) — o dono precisa saber.
  const porTelefone = new Map<string, Set<string>>();
  for (const o of leitura.orcamentos) {
    const s = porTelefone.get(o.telefone) ?? new Set<string>();
    s.add(o.pacienteNome);
    porTelefone.set(o.telefone, s);
  }
  const familias = [...porTelefone.entries()]
    .filter(([, s]) => s.size > 1)
    .map(([telefone, s]) => ({ telefone, pacientes: [...s] }));

  const plano: PlanoImportacao = {
    pipelineId: ctx.pipelineId,
    etapas: ctx.etapas,
    periodo: leitura.periodo,
    novos,
    atualizados,
    inalterados,
    aprovados,
    naoAprovados,
    paradosEmNegociacao,
    voltaramAoRelatorio,
    contatosNovos: telefonesNovos.size,
    contatosExistentes: telefonesExistentes.size,
    familias,
    procedimentosNovos: [...procedimentosNovos],
    valorTotalArquivo: dinheiro(leitura.orcamentos.reduce((a, o) => a + o.valorTotal, 0)),
    valorNovos: dinheiro(novos.reduce((a, n) => a + n.valor, 0)),
    valorAprovados: dinheiro(aprovados.reduce((a, n) => a + n.valor, 0)),
    avisos,
  };

  return { plano, ctx };
}

// ---------------------------------------------------------------------------
// Aplicação
// ---------------------------------------------------------------------------

export async function aplicarImportacao(
  leitura: ParseWebdentalResult,
  plano: PlanoImportacao,
  ctx: ContextoBanco,
  onProgresso?: (pct: number, etapa: string) => void,
): Promise<ResultadoImportacao> {
  const supabase = getSupabase();
  const res: ResultadoImportacao = {
    contatosCriados: 0,
    contatosAtualizados: 0,
    dealsCriados: 0,
    dealsAtualizados: 0,
    marcadosAprovados: 0,
    marcadosNaoAprovados: 0,
    procedimentosCriados: 0,
    erros: [],
  };
  const passo = (pct: number, etapa: string) => onProgresso?.(pct, etapa);

  // --- 1. Procedimentos que faltam no catálogo -----------------------------
  passo(5, 'Catálogo de procedimentos');
  const novosProdutos = new Map<string, string>();
  for (const orc of leitura.orcamentos) {
    for (const it of orc.itens) {
      const chave = it.tratamento.toLowerCase();
      if (!ctx.produtosPorNome.has(chave)) novosProdutos.set(it.tratamento, it.productType);
    }
  }
  if (novosProdutos.size > 0) {
    const { data, error } = await supabase
      .from('products')
      .upsert(
        [...novosProdutos].map(([name, product_type]) => ({
          name,
          product_type,
          description: 'Procedimento criado pela importação do WebDental.',
        })),
        { onConflict: 'org_id,name' },
      )
      .select('id, name, product_type');
    if (error) res.erros.push(`Catálogo: ${error.message}`);
    else {
      for (const p of (data ?? []) as Array<{ id: string; name: string; product_type: string }>) {
        ctx.produtosPorNome.set(p.name.toLowerCase(), { id: p.id, product_type: p.product_type });
        res.procedimentosCriados++;
      }
    }
  }

  // --- 2. Contatos ---------------------------------------------------------
  // Um contato por TELEFONE. O nome fica com o primeiro paciente visto; a lista
  // completa da casa vai para `custom_fields.pacientes`, que é o que revela a
  // família na ficha do contato.
  passo(15, 'Contatos');
  const pacientesPorTelefone = new Map<string, string[]>();
  const enderecoPorTelefone = new Map<string, string>();
  for (const o of leitura.orcamentos) {
    const lista = pacientesPorTelefone.get(o.telefone) ?? [];
    if (!lista.includes(o.pacienteNome)) lista.push(o.pacienteNome);
    pacientesPorTelefone.set(o.telefone, lista);
    if (o.endereco && !enderecoPorTelefone.has(o.telefone)) enderecoPorTelefone.set(o.telefone, o.endereco);
  }

  const criar: Array<Record<string, unknown>> = [];
  const atualizar: Array<Record<string, unknown>> = [];
  for (const [telefone, pacientes] of pacientesPorTelefone) {
    const existente = ctx.contatoPorTelefone.get(telefone);
    const endereco = enderecoPorTelefone.get(telefone) ?? '';
    if (!existente) {
      criar.push({
        phone: telefone,
        name: pacientes[0],
        source: 'webdental',
        custom_fields: {
          pacientes: pacientes.join(' · '),
          ...(endereco ? { endereco } : {}),
        },
      });
      continue;
    }
    // Contato legado gravado sem o nono dígito é ATUALIZADO para a canônica
    // (pelo id), nunca duplicado — mesma regra da importação de contatos.
    const cf = { ...(existente.custom_fields ?? {}) } as Record<string, unknown>;
    const listaAtual = String(cf.pacientes ?? '')
      .split('·')
      .map((s) => s.trim())
      .filter(Boolean);
    const unidos = [...new Set([...listaAtual, ...pacientes])];
    const mudouLista = unidos.join(' · ') !== String(cf.pacientes ?? '');
    const mudouEndereco = Boolean(endereco) && cf.endereco !== endereco;
    const mudouTelefone = existente.phone !== telefone;
    if (mudouLista || mudouEndereco || mudouTelefone) {
      atualizar.push({
        id: existente.id,
        phone: telefone,
        custom_fields: { ...cf, pacientes: unidos.join(' · '), ...(endereco ? { endereco } : {}) },
      });
    }
  }

  for (const lote of chunk(criar, 200)) {
    const { data, error } = await supabase
      .from('contacts')
      .upsert(lote, { onConflict: 'org_id,phone' })
      .select('id, phone, name');
    if (error) {
      res.erros.push(`Contatos novos: ${error.message}`);
      continue;
    }
    for (const c of (data ?? []) as Array<{ id: string; phone: string; name: string | null }>) {
      const canon = canonicalPhone(c.phone);
      if (canon) ctx.contatoPorTelefone.set(canon, { id: c.id, phone: c.phone, name: c.name, custom_fields: {} });
      res.contatosCriados++;
    }
  }
  for (const lote of chunk(atualizar, 200)) {
    const { error } = await supabase.from('contacts').upsert(lote, { onConflict: 'id' });
    if (error) res.erros.push(`Contatos existentes: ${error.message}`);
    else res.contatosAtualizados += lote.length;
  }

  // Se algum telefone ainda não resolveu para um contato, relê — pode ter sido
  // criado por outro caminho entre o plano e a aplicação.
  const semContato = [...pacientesPorTelefone.keys()].filter((t) => !ctx.contatoPorTelefone.has(t));
  if (semContato.length > 0) {
    for (const lote of chunk([...new Set(semContato.flatMap((t) => phoneVariants(t)))], 300)) {
      const { data } = await supabase.from('contacts').select('id, phone, name, custom_fields').in('phone', lote);
      for (const c of (data ?? []) as Array<{ id: string; phone: string; name: string | null }>) {
        const canon = canonicalPhone(c.phone);
        if (canon && !ctx.contatoPorTelefone.has(canon)) {
          ctx.contatoPorTelefone.set(canon, { id: c.id, phone: c.phone, name: c.name, custom_fields: {} });
        }
      }
    }
  }

  // --- 3. Deals novos ------------------------------------------------------
  passo(35, 'Orçamentos novos');
  const refsNovos = new Set(plano.novos.map((n) => n.externalRef));
  const refsAtualizar = new Set(plano.atualizados.map((n) => n.externalRef));
  const porRef = new Map(leitura.orcamentos.map((o) => [o.externalRef, o]));

  const inserir: Array<Record<string, unknown>> = [];
  for (const ref of refsNovos) {
    const orc = porRef.get(ref);
    if (!orc) continue;
    const contato = ctx.contatoPorTelefone.get(orc.telefone);
    if (!contato) {
      res.erros.push(`${orc.pacienteNome}: não consegui resolver o contato do telefone ${orc.telefone}.`);
      continue;
    }
    inserir.push({
      external_ref: orc.externalRef,
      contact_id: contato.id,
      pipeline_id: plano.pipelineId,
      stage_id: plano.etapas[ETAPA_APRESENTADO],
      title: tituloDoOrcamento(orc),
      value: orc.valorTotal,
      currency: 'BRL',
      status: 'open',
      lead_type: 'Cliente', // o paciente JÁ é cliente da clínica
      // 🔴 O relógio recebe a DATA DO ORÇAMENTO, nunca a data do import.
      stage_entered_at: `${orc.dtOrcamento}T12:00:00Z`,
      expected_close: previsaoFechamento(orc.dtOrcamento),
      origin_channel: 'webdental',
    });
  }

  for (const lote of chunk(inserir, 100)) {
    const { data, error } = await supabase
      .from('deals')
      .upsert(lote, { onConflict: 'org_id,external_ref' })
      .select('id, external_ref, contact_id');
    if (error) {
      res.erros.push(`Orçamentos novos: ${error.message}`);
      continue;
    }
    for (const d of (data ?? []) as DealExistente[]) {
      ctx.dealsPorRef.set(d.external_ref, d);
      res.dealsCriados++;
    }
  }

  // --- 4. Deals que mudaram ------------------------------------------------
  passo(55, 'Orçamentos atualizados');
  for (const ref of refsAtualizar) {
    const orc = porRef.get(ref);
    const deal = ctx.dealsPorRef.get(ref);
    if (!orc || !deal) continue;
    const contato = ctx.contatoPorTelefone.get(orc.telefone);
    const patch: Record<string, unknown> = {
      title: tituloDoOrcamento(orc),
      value: orc.valorTotal,
      expected_close: previsaoFechamento(orc.dtOrcamento),
    };
    if (contato && contato.id !== deal.contact_id) patch.contact_id = contato.id;
    const { error } = await supabase.from('deals').update(patch).eq('id', deal.id);
    if (error) res.erros.push(`${orc.pacienteNome}: ${error.message}`);
    else res.dealsAtualizados++;
  }

  // --- 5. Campos personalizados e procedimentos ----------------------------
  passo(70, 'Campos e procedimentos');
  const valoresParaGravar: Array<Record<string, unknown>> = [];
  const itensParaGravar: Array<Record<string, unknown>> = [];
  const apagarItens: Array<{ dealId: string; manter: string[] }> = [];

  for (const ref of [...refsNovos, ...refsAtualizar]) {
    const orc = porRef.get(ref);
    const deal = ctx.dealsPorRef.get(ref);
    if (!orc || !deal) continue;

    for (const [chave, valor] of Object.entries(valoresDoOrcamento(orc))) {
      const campoId = ctx.camposPorChave[chave];
      if (!campoId) continue;
      valoresParaGravar.push({
        custom_field_id: campoId,
        deal_id: deal.id,
        value: valor,
        updated_at: new Date().toISOString(),
      });
    }

    const manter: string[] = [];
    for (const it of orc.itens) {
      const produto = ctx.produtosPorNome.get(it.tratamento.toLowerCase());
      if (!produto) {
        res.erros.push(`${orc.pacienteNome}: procedimento "${it.tratamento}" não está no catálogo.`);
        continue;
      }
      manter.push(produto.id);
      itensParaGravar.push({
        deal_id: deal.id,
        product_id: produto.id,
        value: dinheiro(it.valor),
        quantity: it.quantidade,
      });
    }
    apagarItens.push({ dealId: deal.id, manter });
  }

  for (const lote of chunk(valoresParaGravar, 400)) {
    const { error } = await supabase
      .from('custom_field_values')
      .upsert(lote, { onConflict: 'custom_field_id,deal_id' });
    if (error) res.erros.push(`Campos personalizados: ${error.message}`);
  }
  for (const lote of chunk(itensParaGravar, 400)) {
    const { error } = await supabase.from('deal_products').upsert(lote, { onConflict: 'deal_id,product_id' });
    if (error) res.erros.push(`Procedimentos do orçamento: ${error.message}`);
  }
  // Procedimento que saiu do orçamento numa reimportação some da oportunidade.
  for (const { dealId, manter } of apagarItens) {
    if (manter.length === 0) continue;
    const { error } = await supabase
      .from('deal_products')
      .delete()
      .eq('deal_id', dealId)
      .not('product_id', 'in', `("${manter.join('","')}")`);
    if (error) res.erros.push(`Limpeza de procedimentos: ${error.message}`);
  }

  // --- 6. Aprovados por ausência ------------------------------------------
  passo(85, 'Aprovados por ausência no relatório');
  const hojeBr = new Date().toLocaleDateString('pt-BR');
  for (const lote of chunk(plano.aprovados, 50)) {
    const ids = lote.map((a) => a.dealId!).filter(Boolean);
    if (ids.length === 0) continue;
    const { error } = await supabase
      .from('deals')
      .update({ stage_id: plano.etapas[ETAPA_APROVADO], status: 'won', temperature: 'Quente' })
      .in('id', ids);
    if (error) {
      res.erros.push(`Marcar aprovados: ${error.message}`);
      continue;
    }
    res.marcadosAprovados += ids.length;
    const notas = lote.map((a) => ({
      deal_id: a.dealId,
      type: 'note',
      title: 'Aprovado por inferência (ausência no relatório)',
      body:
        `Este orçamento estava no relatório "Controle de Efetivação — APENAS NÃO APROVADOS" e ` +
        `DEIXOU de aparecer na importação de ${hojeBr} ` +
        `(período do relatório: ${plano.periodo.de ?? '?'} a ${plano.periodo.ate ?? '?'}).\n\n` +
        `⚠️ Isto é INFERÊNCIA, não confirmação humana: sair do relatório significa aprovado OU ` +
        `cancelado no WebDental. Confirme na clínica antes de contar como receita.`,
      done: true,
      done_at: new Date().toISOString(),
    }));
    const { error: eNota } = await supabase.from('crm_activities').insert(notas);
    if (eNota) res.erros.push(`Registro da inferência: ${eNota.message}`);
  }

  // --- 7. Encerrar os que passaram de 7 dias -------------------------------
  passo(95, 'Encerramento em 7 dias');
  for (const lote of chunk(plano.naoAprovados, 50)) {
    const ids = lote.map((a) => a.dealId!).filter(Boolean);
    if (ids.length === 0) continue;
    const { error } = await supabase
      .from('deals')
      .update({
        stage_id: plano.etapas[ETAPA_NAO_APROVADO],
        status: 'lost',
        lost_reason: `Sem resposta em ${DIAS_ATE_ENCERRAR} dias (régua D+1/D+3/D+7 encerrada).`,
      })
      .in('id', ids);
    if (error) {
      res.erros.push(`Encerrar vencidos: ${error.message}`);
      continue;
    }
    res.marcadosNaoAprovados += ids.length;
    const notas = lote.map((a) => ({
      deal_id: a.dealId,
      type: 'note',
      title: 'Encerrado por prazo',
      body:
        `Orçamento de ${a.dtOrcamento} continuava no relatório de não aprovados após ` +
        `${a.diasParado} dias e nunca saiu da etapa "${ETAPA_APRESENTADO}". ` +
        `A régua vai até D+${DIAS_ATE_ENCERRAR}; depois disso o CRM encerra como não aprovado.`,
      done: true,
      done_at: new Date().toISOString(),
    }));
    const { error: eNota } = await supabase.from('crm_activities').insert(notas);
    if (eNota) res.erros.push(`Registro do encerramento: ${eNota.message}`);
  }

  passo(100, 'Concluído');
  return res;
}
