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
//  · 🔴 UM TRATAMENTO = UM ORÇAMENTO. Uma LINHA do relatório vira UMA
//    oportunidade. **Por quê:** cada tratamento tem o seu próprio ciclo de
//    decisão — o paciente aprova a limpeza e recusa a prótese. Agrupado por
//    paciente, isso ficava invisível. Separado, dá para medir **conversão por
//    especialidade**, que é o indicador que a franqueadora cobra. O arquivo de
//    05/09 deixa de gerar 64 oportunidades e passa a gerar 81.
//
//  · CONTATO = TELEFONE (é a conversa do WhatsApp). O nome do paciente vive no
//    ORÇAMENTO, não no contato. Motivo: 4 telefones do arquivo real atendem
//    mais de um paciente — um deles atende 3 pessoas da mesma família. O índice
//    `contacts_org_phone_canonical_key` proíbe dois contatos com o mesmo
//    telefone, e está certo assim. Isso NÃO muda com um orçamento por
//    tratamento: o mesmo contato passa a ter mais orçamentos pendurados nele.
//
//  · 🔴 APROVAÇÃO É **FATO**, NÃO INFERÊNCIA (decisão do Danilo, 07/09/2026).
//    Passaram a entrar DOIS relatórios: o de não aprovados (`Dt Aprovação`
//    vazia) e o de aprovados (`Dt Aprovação` cheia). Quem aparece no segundo
//    vai para a etapa "Aprovado" com a DATA REAL da aprovação, fora de
//    qualquer régua.
//
//    **O que morreu junto: "sumiu do relatório = aprovado".** Sair do relatório
//    de não aprovados significa aprovado **ou cancelado**. Enquanto só existia
//    um arquivo, o CRM chutava "aprovado" — e chute errado aqui vira RECEITA
//    FANTASMA no relatório do dono. Agora, o orçamento que sai do arquivo de
//    não aprovados e **não** aparece no de aprovados é apenas SINALIZADO para
//    conferência humana: não vira aprovado, não vira perdido, não se move.
//    ⚠️ A sinalização só vale para orçamentos DENTRO do período coberto pelo
//    export, e só quando o relatório de NÃO aprovados foi realmente subido —
//    sem ele não existe "sumiço", só falta de informação.
//
//  · D+7 ENCERRA. Orçamento que passou de 7 dias sem sair da primeira etapa vai
//    para "Não aprovado". Deal que um humano já moveu (negociação, aguardando
//    decisão) NÃO é encerrado automaticamente — só é reportado.
//
//  · IDEMPOTÊNCIA. `deals.external_ref` =
//    `webdental:<paciente>:<data>:<tratamento>:<ocorrência>:<centavos>`, com
//    índice único por org. Reimportar o mesmo arquivo atualiza, nunca duplica.
//    Quando só o VALOR muda entre dois exports, o casamento cai para a
//    `chaveBase` (a mesma chave sem o valor) e o orçamento é ATUALIZADO — sem
//    isso, uma correção de preço viraria "sumiu do relatório = aprovado" de um
//    lado e um card novo do outro.
// ============================================================================

import { getSupabase } from '@/lib/supabase';
import { canonicalPhone, phoneVariants } from '@/lib/phone';
import {
  chaveBaseDoRef,
  contarPacientes,
  dataDoRef,
  grupoDoOrcamentoLido,
  grupoDoRef,
  refWebdentalEhAntigo,
  type ArquivoLido,
  type LeituraCombinada,
  type Orcamento,
  type VendaPlano,
} from '@/lib/webdental';

export const PIPELINE_ODONTO = 'Odonto — Orçamentos';
export const ETAPA_APRESENTADO = 'Orçamento apresentado';
export const ETAPA_APROVADO = 'Aprovado';
export const ETAPA_NAO_APROVADO = 'Não aprovado';
export const ORIGEM = 'WebDental · Controle de Efetivação';

/** Dias sem resposta até encerrar o orçamento como não aprovado. */
export const DIAS_ATE_ENCERRAR = 7;

/**
 * Títulos fixos das notas de auditoria em `crm_activities`. São a origem
 * declarada de cada movimento — e servem de trava: a nota de sumiço só é
 * escrita uma vez por oportunidade, senão o histórico do card viraria uma
 * parede de avisos idênticos, um por dia de importação.
 */
export const NOTA_APROVADO_POR_FATO = 'Aprovado por Dt Aprovação (relatório de aprovados)';
export const NOTA_SUMICO = 'Sumiu dos dois relatórios — verificar';

// ---------------------------------------------------------------------------
// Tipos do plano
// ---------------------------------------------------------------------------

export interface AcaoDeal {
  externalRef: string;
  paciente: string;
  telefone: string;
  dtOrcamento: string;
  valor: number;
  /** Tratamento do orçamento — agora é 1 por card, então é o que identifica. */
  tratamento?: string;
  /** Data REAL da aprovação (relatório de aprovados). Null = não aprovado. */
  dtAprovacao?: string | null;
  /** Só em "atualizados": o que mudou, em português. */
  mudancas?: string[];
  /** Só em "aprovados"/"não aprovados": id do deal já existente. */
  dealId?: string;
  /** Dias parados na etapa (para as movimentações). */
  diasParado?: number;
  /**
   * Chave anterior, quando o orçamento foi reconhecido pela `chaveBase` porque
   * o VALOR mudou entre um export e outro. A aplicação regrava o
   * `external_ref` para a chave nova.
   */
  refAnterior?: string;
}

export interface PlanoImportacao {
  pipelineId: string;
  etapas: Record<string, string>;
  periodo: { de: string | null; ate: string | null };
  /** Orçamentos NÃO aprovados que ainda não existem no CRM → "Orçamento apresentado". */
  novos: AcaoDeal[];
  /**
   * Orçamentos do relatório de APROVADOS que ainda não existem no CRM. Entram
   * direto na etapa "Aprovado", com a data real da aprovação — e portanto
   * **fora de qualquer régua**, que só olha "Orçamento apresentado".
   */
  novosAprovados: AcaoDeal[];
  /**
   * Já existiam abertos (vieram do relatório de não aprovados num dia anterior)
   * e agora apareceram no de APROVADOS. Movem para "Aprovado" com a data real,
   * sem duplicar. É o cruzamento entre os dois arquivos.
   */
  movidosParaAprovado: AcaoDeal[];
  /** Já existem e alguma informação mudou. */
  atualizados: AcaoDeal[];
  /** Já existem e estão idênticos — nada a fazer. */
  inalterados: AcaoDeal[];
  /**
   * 🔴 Sumiram do relatório de não aprovados e **não** apareceram no de
   * aprovados. Provavelmente CANCELADOS — mas pode ser erro de export, filtro
   * de período ou correção de cadastro. **Não viram aprovados, não viram
   * perdidos, não se movem.** Ganham uma nota de conferência e ficam nesta
   * lista para olho humano.
   */
  sumiramSemExplicacao: AcaoDeal[];
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
  /** Orçamentos nos arquivos (= linhas válidas = 1 por tratamento). */
  orcamentosNoArquivo: number;
  /** Quantos deles vieram do relatório de NÃO aprovados. */
  orcamentosNaoAprovados: number;
  /** Quantos vieram do relatório de APROVADOS. */
  orcamentosAprovados: number;
  /** Pacientes distintos por trás desses orçamentos. */
  pacientesNoArquivo: number;
  /** Os arquivos lidos, com o filtro que o CRM reconheceu em cada um. */
  arquivos: ArquivoLido[];
  /** Recebemos o universo dos não aprovados? Sem ele não existe "sumiço". */
  temNaoAprovados: boolean;
  /** Recebemos o universo dos aprovados? Sem ele não existe aprovação por fato. */
  temAprovados: boolean;
  /** 🔴 Vendas do plano DentalVidas — NÃO entram como orçamento odontológico. */
  vendasPlano: VendaPlano[];
  valorVendasPlano: number;
  /** Quantos orçamentos por especialidade — a leitura que a franqueadora cobra. */
  porEspecialidade: Array<{ especialidade: string; quantidade: number; valor: number }>;
  /** Telefones que atendem mais de um paciente. */
  familias: Array<{ telefone: string; pacientes: string[] }>;
  /** Procedimentos que não estão no catálogo e serão criados. */
  procedimentosNovos: string[];
  valorTotalArquivo: number;
  /** Soma só dos não aprovados (o que ainda está em jogo). */
  valorNaoAprovados: number;
  /** Soma só dos aprovados (o que já foi fechado). */
  valorAprovados: number;
  valorNovos: number;
  avisos: string[];
}

export interface ResultadoImportacao {
  contatosCriados: number;
  contatosAtualizados: number;
  dealsCriados: number;
  dealsAtualizados: number;
  marcadosAprovados: number;
  marcadosNaoAprovados: number;
  sinalizadosParaConferencia: number;
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
  won_at: string | null;
}

interface ContextoBanco {
  pipelineId: string;
  etapas: Record<string, string>;
  camposPorChave: Record<string, string>;
  produtosPorNome: Map<string, { id: string; product_type: string }>;
  /** Todos os deals de importação do funil, sem repetição. */
  dealsTodos: DealExistente[];
  dealsPorRef: Map<string, DealExistente>;
  /** Chave sem o valor → deal. Só entra chave que aparece UMA vez (sem ambiguidade). */
  dealsPorChaveBase: Map<string, DealExistente>;
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

/**
 * Título do card.
 *
 * Com 81 cards e UM tratamento em cada, o que precisa ser lido de relance é
 * **quem** e **o quê** — nessa ordem. A palavra "Orçamento" saiu: todo card do
 * funil é um orçamento, repeti-la 81 vezes só consome largura. A data fica no
 * fim porque o card já mostra o relógio da etapa.
 *
 * Quando o mesmo paciente tem o MESMO tratamento duas vezes no mesmo dia (dois
 * dentes), o ordinal entra — sem ele os dois cards ficariam idênticos na tela e
 * ninguém saberia qual já foi tratado.
 *
 *   "Maria Julia Santos — Clínica Geral · 01/09/2026"
 *   "Givaldo Pereira — Prótese (2º) · 01/09/2026"
 */
export function tituloDoOrcamento(orc: Orcamento): string {
  const ordinal = orc.totalOcorrencias > 1 ? ` (${orc.ocorrencia}º)` : '';
  return `${orc.pacienteNome} — ${orc.tratamento}${ordinal} · ${dataBr(orc.dtOrcamento)}`;
}

/** Valores dos campos personalizados que este orçamento produz. */
function valoresDoOrcamento(orc: Orcamento): Record<string, string> {
  return {
    paciente_nome: orc.pacienteNome,
    dt_orcamento: orc.dtOrcamento,
    // Um tratamento por orçamento: o campo deixa de ser uma lista concatenada e
    // passa a ser o tratamento DESTE card — é o que torna o filtro por
    // procedimento e a conversão por especialidade confiáveis.
    tratamento: orc.totalOcorrencias > 1 ? `${orc.tratamento} (${orc.ocorrencia}º)` : orc.tratamento,
    especialidade: orc.especialidade,
    dentista: orc.dentista,
    tabela_preco: orc.tabelaPreco,
    participacao_convenio: String(dinheiro(orc.participacaoConvenio)),
    dt_agenda: orc.dtAgenda ?? '',
    origem_import: ORIGEM,
  };
}

/**
 * Data de fechamento do orçamento.
 * · Aprovado → a data REAL da aprovação: o orçamento fechou naquele dia.
 * · Não aprovado → a previsão: tem 7 dias de régua para decidir.
 */
function dataDeFechamento(orc: Orcamento): string {
  if (orc.aprovado && orc.dtAprovacao) return orc.dtAprovacao;
  const d = new Date(`${orc.dtOrcamento}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + DIAS_ATE_ENCERRAR);
  return d.toISOString().slice(0, 10);
}

/**
 * Instante que vai para o relógio da etapa (`deals.stage_entered_at`).
 *
 * 🔴 Aprovado entra com a data da APROVAÇÃO, não com a do orçamento. É o que
 * põe o card "fora de qualquer régua": a régua conta dias parados em
 * "Orçamento apresentado", e o aprovado nunca esteve lá. Meio-dia UTC evita
 * que o fuso de Itabuna (UTC-3) empurre a data para o dia anterior na tela.
 */
function relogioDaEtapa(orc: Orcamento): string {
  const dia = orc.aprovado && orc.dtAprovacao ? orc.dtAprovacao : orc.dtOrcamento;
  return `${dia}T12:00:00Z`;
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
      .select('id, external_ref, contact_id, stage_id, value, status, title, archived_at, stage_entered_at, won_at')
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

  // Índice pela chave SEM o valor. Chave repetida (não deveria acontecer) fica
  // de fora: casar por ambiguidade é pior do que não casar.
  const dealsPorChaveBase = new Map<string, DealExistente>();
  const basesAmbiguas = new Set<string>();
  for (const d of deals) {
    if (d.archived_at) continue;
    const base = chaveBaseDoRef(d.external_ref);
    if (!base) continue;
    if (dealsPorChaveBase.has(base)) basesAmbiguas.add(base);
    dealsPorChaveBase.set(base, d);
  }
  for (const base of basesAmbiguas) dealsPorChaveBase.delete(base);

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
    dealsTodos: deals,
    dealsPorRef,
    dealsPorChaveBase,
    valoresPorDeal,
    itensPorDeal,
    contatoPorTelefone,
  };
}

// ---------------------------------------------------------------------------
// Planejamento (simulação — nada é gravado)
// ---------------------------------------------------------------------------

export interface OpcoesImportacao {
  /**
   * Escrever a nota de conferência em quem sumiu dos DOIS relatórios
   * (padrão: sim). Desmarcar não muda o funil — o orçamento não se move de
   * qualquer forma; só deixa de ficar registrado no histórico do card.
   */
  sinalizarSumicos: boolean;
  /** Encerrar como não aprovado quem passou de 7 dias (padrão: sim). */
  encerrarVencidos: boolean;
  /** "Hoje" — injetável para teste. */
  hoje?: Date;
}

export const OPCOES_PADRAO: OpcoesImportacao = {
  sinalizarSumicos: true,
  encerrarVencidos: true,
};

export async function planejarImportacao(
  leitura: LeituraCombinada,
  opcoes: OpcoesImportacao = OPCOES_PADRAO,
): Promise<{ plano: PlanoImportacao; ctx: ContextoBanco }> {
  const ctx = await carregarContexto(leitura.orcamentos);
  const hoje = opcoes.hoje ?? new Date();
  const avisos = [...leitura.avisos];

  const novos: AcaoDeal[] = [];
  const novosAprovados: AcaoDeal[] = [];
  const movidosParaAprovado: AcaoDeal[] = [];
  const atualizados: AcaoDeal[] = [];
  const inalterados: AcaoDeal[] = [];
  const voltaramAoRelatorio: AcaoDeal[] = [];
  const procedimentosNovos = new Set<string>();
  const telefonesNovos = new Set<string>();
  const telefonesExistentes = new Set<string>();

  // Deals já casados com alguma linha do arquivo. É este conjunto — e não uma
  // lista de chaves — que decide a AUSÊNCIA lá embaixo, porque um orçamento
  // pode ter sido reconhecido por uma chave antiga.
  const idsNoArquivo = new Set<string>();

  // -------------------------------------------------------------------------
  // CASAMENTO ARQUIVO × BANCO — três passadas, da evidência mais forte para a
  // mais fraca, e cada passada percorre TODAS as linhas antes da seguinte.
  //
  // 🔴 POR QUE EM PASSADAS, e não linha a linha. Casando linha a linha, um
  // orçamento avaliado cedo pode "roubar" pela regra fraca (passada 3) o deal
  // que uma linha posterior casaria pela regra forte (passada 1 ou 2). O
  // resultado seria um card trocado e um sumiço inventado ao lado. Varrendo
  // por passada, a evidência forte sempre ganha, independentemente da ordem.
  //
  //  1. chave inteira — mesmo paciente, dia, tratamento, ocorrência e valor;
  //  2. GRUPO + VALOR — ignora a ocorrência. É o que sobrevive ao caso em que a
  //     numeração dança porque o conjunto mudou (ver `grupoDoRef`): nos
  //     arquivos reais de 07/09 três orçamentos trocam de ordinal quando o
  //     relatório de aprovados entra junto;
  //  3. chave sem o VALOR — é o orçamento cujo preço foi corrigido no
  //     WebDental. Sem ela, uma correção de preço criaria um card novo E daria
  //     o antigo como sumido. **Esta passada não atravessa a fronteira
  //     aprovado × não aprovado** — ver `mesmoLadoDaAprovacao`, logo abaixo.
  const casado = new Map<string, DealExistente>();
  const refAnteriorPorOrc = new Map<string, string>();
  const pendentes = leitura.orcamentos.filter((orc) => {
    const d = ctx.dealsPorRef.get(orc.externalRef);
    if (!d || idsNoArquivo.has(d.id)) return true;
    casado.set(orc.externalRef, d);
    idsNoArquivo.add(d.id);
    return false;
  });

  // Passada 2: grupo + valor. Só casa quando há UM candidato livre — casar por
  // ambiguidade é pior do que não casar.
  const porGrupoEValor = new Map<string, DealExistente[]>();
  for (const d of ctx.dealsTodos) {
    if (d.archived_at || idsNoArquivo.has(d.id)) continue;
    const g = grupoDoRef(d.external_ref);
    if (!g) continue;
    const chave = `${g}|${dinheiro(Number(d.value ?? 0))}`;
    porGrupoEValor.set(chave, [...(porGrupoEValor.get(chave) ?? []), d]);
  }
  const pendentes3 = pendentes.filter((orc) => {
    const chave = `${grupoDoOrcamentoLido(orc)}|${orc.valor}`;
    const livres = (porGrupoEValor.get(chave) ?? []).filter((d) => !idsNoArquivo.has(d.id));
    if (livres.length !== 1) return true;
    casado.set(orc.externalRef, livres[0]);
    refAnteriorPorOrc.set(orc.externalRef, livres[0].external_ref);
    idsNoArquivo.add(livres[0].id);
    return false;
  });

  // Passada 3: mesma chave, valor diferente (correção de preço).
  //
  // 🔴 A FRONTEIRA QUE ESTA PASSADA NÃO PODE ATRAVESSAR (bug de 07/09/2026).
  // A `chaveBase` ignora o valor E depende da OCORRÊNCIA, que é uma posição
  // dentro do conjunto importado. Quando os dois relatórios sobem em
  // importações SEPARADAS, cada arquivo enxerga metade do universo e o mesmo
  // paciente com o mesmo tratamento no mesmo dia recebe "1º" nos dois lados —
  // mesmo sendo DOIS orçamentos diferentes. Nos arquivos reais isso acontece
  // 3 vezes (Gustavo Pereira, Laura Hage, Tania Santos: um orçamento de
  // Clínica Geral aprovado e OUTRO, de valor diferente, ainda em aberto).
  //
  // Sem esta guarda, a passada 3 casava os dois: a linha do relatório de
  // aprovados engolia o card aberto (some um orçamento do funil) ou a linha do
  // relatório de não aprovados sobrescrevia o valor de uma venda já
  // documentada. O total ia a 141 em vez de 144, e o resultado passava a
  // depender da ORDEM em que os arquivos foram subidos.
  //
  // A regra: a passada 3 só vale entre iguais. Correção de preço no WebDental
  // NÃO muda o relatório em que o orçamento aparece — logo, se um lado está
  // aprovado e o outro não, a evidência fraca não basta. O caso legítimo de
  // travessia (saiu dos não aprovados, apareceu nos aprovados) tem evidência
  // FORTE e é resolvido na passada 2, por grupo + valor.
  //
  // O deal conta como aprovado pelo `status` OU pela etapa: um aprovado cuja
  // gravação parou no meio nasce `open` já na etapa "Aprovado" (passo 3 da
  // aplicação), e continua sendo um aprovado.
  const etapaAprovado = ctx.etapas[ETAPA_APROVADO];
  const mesmoLadoDaAprovacao = (deal: DealExistente, orc: Orcamento): boolean =>
    (deal.status === 'won' || deal.stage_id === etapaAprovado) === orc.aprovado;

  for (const orc of pendentes3) {
    const candidato = ctx.dealsPorChaveBase.get(orc.chaveBase);
    if (!candidato || idsNoArquivo.has(candidato.id)) continue;
    if (!mesmoLadoDaAprovacao(candidato, orc)) continue;
    casado.set(orc.externalRef, candidato);
    refAnteriorPorOrc.set(orc.externalRef, candidato.external_ref);
    idsNoArquivo.add(candidato.id);
  }

  for (const orc of leitura.orcamentos) {
    const base: AcaoDeal = {
      externalRef: orc.externalRef,
      paciente: orc.pacienteNome,
      telefone: orc.telefone,
      dtOrcamento: orc.dtOrcamento,
      valor: orc.valor,
      tratamento: orc.tratamento,
      dtAprovacao: orc.dtAprovacao,
    };

    if (ctx.contatoPorTelefone.has(orc.telefone)) telefonesExistentes.add(orc.telefone);
    else telefonesNovos.add(orc.telefone);

    if (!ctx.produtosPorNome.has(orc.tratamento.toLowerCase())) procedimentosNovos.add(orc.tratamento);

    const existente = casado.get(orc.externalRef);
    const refAnterior = refAnteriorPorOrc.get(orc.externalRef);

    if (!existente) {
      // Orçamento novo: o relatório de origem decide a etapa em que ele nasce.
      (orc.aprovado ? novosAprovados : novos).push(base);
      continue;
    }
    // A gravação encontra o deal pela chave NOVA, mesmo quando ele foi
    // reconhecido por uma chave antiga.
    ctx.dealsPorRef.set(orc.externalRef, existente);

    // 🔴 O CRUZAMENTO ENTRE OS DOIS ARQUIVOS. O orçamento já existia (veio do
    // relatório de não aprovados num dia anterior) e agora aparece no de
    // APROVADOS: move para "Aprovado" com a data real, sem duplicar.
    //
    // Vale também quando o CRM já o tinha encerrado como "Não aprovado" pela
    // régua de 7 dias: FATO vence prazo. A data de aprovação é evidência
    // documental; o encerramento por prazo era só uma convenção nossa.
    const jaAprovado = existente.status === 'won';
    if (orc.aprovado && !jaAprovado) {
      movidosParaAprovado.push({ ...base, dealId: existente.id });
      if (existente.status === 'lost') {
        avisos.push(
          `${orc.pacienteNome} · ${orc.tratamento} (${orc.dtOrcamento}) estava encerrado como NÃO ` +
            `aprovado no CRM, mas o relatório de aprovados traz a data ${orc.dtAprovacao}. ` +
            'O CRM reabriu e marcou como aprovado — o fato vence o encerramento por prazo.',
        );
      }
    } else if (!orc.aprovado && existente.status !== 'open') {
      // Estava encerrado e voltou ao relatório de NÃO aprovados: o que o CRM
      // registrou não se sustenta. Reabrir é decisão de gente — só reporta.
      voltaramAoRelatorio.push({ ...base, dealId: existente.id });
    }

    const mudancas: string[] = [];
    // Reconhecido por uma chave antiga (passadas 2 e 3): a chave gravada
    // PRECISA ser regravada, senão a próxima importação não o encontra mais e
    // o orçamento vira card novo + sumiço.
    if (refAnterior) mudancas.push('chave de identidade');
    // Correção da data de aprovação no WebDental entre um export e outro.
    if (orc.aprovado && jaAprovado && (existente.won_at ?? '').slice(0, 10) !== orc.dtAprovacao) {
      mudancas.push('data de aprovação');
    }
    if (dinheiro(Number(existente.value ?? 0)) !== orc.valor) {
      mudancas.push(`valor ${dinheiro(Number(existente.value ?? 0))} → ${orc.valor}`);
    }
    const tituloNovo = tituloDoOrcamento(orc);
    if (existente.title !== tituloNovo) mudancas.push('título');

    const atuais = ctx.valoresPorDeal.get(existente.id) ?? {};
    const desejados = valoresDoOrcamento(orc);
    for (const [chave, valor] of Object.entries(desejados)) {
      if ((atuais[chave] ?? '') !== valor) mudancas.push(chave.replace(/_/g, ' '));
    }

    // O item único do orçamento: compara (produto, valor, quantidade).
    const itensAtuais = (ctx.itensPorDeal.get(existente.id) ?? [])
      .map((i) => `${i.product_id}|${dinheiro(i.value)}|${i.quantity}`)
      .sort()
      .join(';');
    const produto = ctx.produtosPorNome.get(orc.tratamento.toLowerCase());
    const itensDesejados = `${produto?.id ?? 'novo:' + orc.tratamento}|${dinheiro(orc.valor)}|1`;
    if (itensAtuais !== itensDesejados) mudancas.push('procedimento');

    const contatoAtual = ctx.contatoPorTelefone.get(orc.telefone);
    if (contatoAtual && contatoAtual.id !== existente.contact_id) mudancas.push('contato');

    // Quem vai para "Aprovado" já está contado na sua própria lista — a
    // mudança de etapa e de data é aplicada lá, não no bloco de atualização.
    const movidoAgora = movidosParaAprovado.some((m) => m.dealId === existente.id);
    if (mudancas.length === 0) {
      if (!movidoAgora) inalterados.push(base);
    } else {
      atualizados.push({ ...base, mudancas: [...new Set(mudancas)], dealId: existente.id, refAnterior });
    }
  }

  // --- Sumiu dos DOIS relatórios = SINAL DE CONFERÊNCIA ---------------------
  //
  // 🔴 AQUI ESTAVA A RECEITA FANTASMA. Até 06/09 o CRM lia "sumiu do relatório
  // de não aprovados" como "foi aprovado". Com o relatório de APROVADOS em
  // mãos, essa dedução deixou de fazer sentido: quem foi aprovado APARECE, com
  // data. Quem sumiu dos dois foi, quase sempre, CANCELADO — e contar
  // cancelamento como aprovação vira dinheiro que não existe no relatório do
  // dono.
  //
  // Regras da sinalização, todas conservadoras:
  //  1. só quando o relatório de NÃO aprovados foi realmente subido (sem ele
  //     "ausência" não quer dizer nada — o universo nem foi consultado);
  //  2. só dentro do período coberto pelo export;
  //  3. só o que estava aberto;
  //  4. **o orçamento não se move.** Fica onde está, com uma nota.
  const etapaApresentado = ctx.etapas[ETAPA_APRESENTADO];
  const sumiramSemExplicacao: AcaoDeal[] = [];
  const naoAprovados: AcaoDeal[] = [];
  const paradosEmNegociacao: AcaoDeal[] = [];
  const formatoAntigo: AcaoDeal[] = [];
  const idsMovidosParaAprovado = new Set(movidosParaAprovado.map((m) => m.dealId));

  for (const deal of ctx.dealsTodos) {
    if (deal.archived_at) continue;
    if (deal.status !== 'open') continue;

    const valores = ctx.valoresPorDeal.get(deal.id) ?? {};
    const dt = valores.dt_orcamento || dataDoRef(deal.external_ref) || '';
    const paciente = valores.paciente_nome || deal.title;
    const dentroDoPeriodo =
      !leitura.periodo.de || !leitura.periodo.ate
        ? false
        : Boolean(dt) && dt >= leitura.periodo.de && dt <= leitura.periodo.ate;
    const dias = dt ? diasDesde(dt, hoje) : 0;

    const acao: AcaoDeal = {
      externalRef: deal.external_ref,
      paciente,
      telefone: '',
      dtOrcamento: dt,
      valor: dinheiro(Number(deal.value ?? 0)),
      tratamento: valores.tratamento,
      dealId: deal.id,
      diasParado: dias,
    };

    if (!idsNoArquivo.has(deal.id)) {
      // Deal do modelo ANTIGO (um orçamento por paciente+data). Ele nunca vai
      // casar com uma linha do arquivo novo — tratá-lo como sumiço seria
      // sinalizar um problema que é só de formato. Fica de fora e é reportado.
      if (refWebdentalEhAntigo(deal.external_ref)) {
        formatoAntigo.push(acao);
        continue;
      }
      if (leitura.temNaoAprovados && dentroDoPeriodo) {
        sumiramSemExplicacao.push(acao);
      }
      continue;
    }

    // 🔴 Quem está indo para "Aprovado" nesta mesma importação NÃO pode ser
    // encerrado por prazo. Sem esta guarda, um orçamento antigo que acabou de
    // ser aprovado seria marcado como ganho e como perdido no mesmo minuto.
    if (idsMovidosParaAprovado.has(deal.id)) continue;

    // Continua no relatório de NÃO aprovados e já passou do prazo.
    if (opcoes.encerrarVencidos && dias > DIAS_ATE_ENCERRAR) {
      if (deal.stage_id === etapaApresentado) naoAprovados.push(acao);
      else paradosEmNegociacao.push(acao);
    }
  }

  if (formatoAntigo.length > 0) {
    avisos.push(
      `${formatoAntigo.length} oportunidade(s) foram importadas no modelo antigo (um orçamento por ` +
        'paciente e data, com vários tratamentos dentro). Elas NÃO são comparáveis com estes ' +
        'arquivos e ficaram de fora da conciliação — revise ou arquive na mão antes de confiar ' +
        'na conversão.',
    );
  }

  if (!leitura.temAprovados) {
    avisos.push(
      'Você subiu apenas o relatório de NÃO aprovados. Sem o de APROVADOS o CRM não tem como ' +
        'saber quem fechou: nenhum orçamento será marcado como aprovado, e o que sumir da lista ' +
        'fica só sinalizado para conferência. Exporte também o filtro "APENAS APROVADOS".',
    );
  }
  if (!leitura.temNaoAprovados) {
    avisos.push(
      'Você subiu apenas o relatório de APROVADOS. Sem o de NÃO aprovados o CRM não consegue ' +
        'detectar orçamento que saiu da lista nem aplicar o encerramento por prazo.',
    );
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
      'Não identifiquei o período dos relatórios. Por segurança, NENHUM orçamento ausente será ' +
        'sinalizado nesta importação — sem a janela do export, ausência não prova nada.',
    );
  }

  if (sumiramSemExplicacao.length > 0) {
    avisos.push(
      `${sumiramSemExplicacao.length} orçamento(s) sumiram do relatório de não aprovados e NÃO ` +
        `aparecem no de aprovados (${sumiramSemExplicacao.map((s) => s.paciente).slice(0, 3).join(', ')}` +
        `${sumiramSemExplicacao.length > 3 ? '…' : ''}). O mais provável é CANCELAMENTO no ` +
        'WebDental. O CRM não move nenhum deles — precisa de conferência humana.',
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

  // Distribuição por especialidade — só faz sentido com 1 tratamento por
  // orçamento; era isso que o modelo agrupado escondia.
  const espMap = new Map<string, { quantidade: number; valor: number }>();
  for (const o of leitura.orcamentos) {
    const atual = espMap.get(o.especialidade) ?? { quantidade: 0, valor: 0 };
    atual.quantidade += 1;
    atual.valor = dinheiro(atual.valor + o.valor);
    espMap.set(o.especialidade, atual);
  }
  const porEspecialidade = [...espMap.entries()]
    .map(([especialidade, v]) => ({ especialidade, ...v }))
    .sort((a, b) => b.quantidade - a.quantidade);

  const doArquivoAprovados = leitura.orcamentos.filter((o) => o.aprovado);
  const doArquivoNaoAprovados = leitura.orcamentos.filter((o) => !o.aprovado);

  const plano: PlanoImportacao = {
    pipelineId: ctx.pipelineId,
    etapas: ctx.etapas,
    periodo: leitura.periodo,
    novos,
    novosAprovados,
    movidosParaAprovado,
    atualizados,
    inalterados,
    sumiramSemExplicacao: opcoes.sinalizarSumicos ? sumiramSemExplicacao : [],
    naoAprovados,
    paradosEmNegociacao,
    voltaramAoRelatorio,
    contatosNovos: telefonesNovos.size,
    contatosExistentes: telefonesExistentes.size,
    orcamentosNoArquivo: leitura.orcamentos.length,
    orcamentosNaoAprovados: doArquivoNaoAprovados.length,
    orcamentosAprovados: doArquivoAprovados.length,
    pacientesNoArquivo: contarPacientes(leitura.orcamentos),
    arquivos: leitura.arquivos,
    temNaoAprovados: leitura.temNaoAprovados,
    temAprovados: leitura.temAprovados,
    vendasPlano: leitura.vendasPlano,
    valorVendasPlano: dinheiro(leitura.vendasPlano.reduce((a, v) => a + v.valor, 0)),
    porEspecialidade,
    familias,
    procedimentosNovos: [...procedimentosNovos],
    valorTotalArquivo: dinheiro(leitura.orcamentos.reduce((a, o) => a + o.valor, 0)),
    valorNaoAprovados: dinheiro(doArquivoNaoAprovados.reduce((a, o) => a + o.valor, 0)),
    valorAprovados: dinheiro(doArquivoAprovados.reduce((a, o) => a + o.valor, 0)),
    valorNovos: dinheiro([...novos, ...novosAprovados].reduce((a, n) => a + n.valor, 0)),
    avisos,
  };

  return { plano, ctx };
}

// ---------------------------------------------------------------------------
// Aplicação
// ---------------------------------------------------------------------------

export async function aplicarImportacao(
  leitura: LeituraCombinada,
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
    sinalizadosParaConferencia: 0,
    procedimentosCriados: 0,
    erros: [],
  };
  const passo = (pct: number, etapa: string) => onProgresso?.(pct, etapa);

  // --- 1. Procedimentos que faltam no catálogo -----------------------------
  passo(5, 'Catálogo de procedimentos');
  const novosProdutos = new Map<string, string>();
  for (const orc of leitura.orcamentos) {
    const chave = orc.tratamento.toLowerCase();
    if (!ctx.produtosPorNome.has(chave)) novosProdutos.set(orc.tratamento, orc.productType);
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
  //
  // Cada orçamento novo nasce na etapa que o SEU relatório determina:
  // não aprovado → "Orçamento apresentado"; aprovado → "Aprovado".
  //
  // ⚠️ O aprovado nasce com `status = 'open'` e só vira `'won'` no passo 6,
  // depois de o `deal_products` existir. Não é capricho: o gatilho
  // `_deal_won_to_sales` do banco lê os procedimentos do orçamento no instante
  // em que o status vira "ganho" e, sem eles, registra a venda com o TÍTULO do
  // card no lugar do nome do procedimento — o painel de vendas ficaria com
  // "Fulano — Prótese · 03/09/2026" como se fosse um produto. A etapa e a data
  // já entram certas aqui; só o carimbo de ganho espera.
  passo(35, 'Orçamentos novos');
  const refsNovos = new Set([...plano.novos, ...plano.novosAprovados].map((n) => n.externalRef));
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
      stage_id: plano.etapas[orc.aprovado ? ETAPA_APROVADO : ETAPA_APRESENTADO],
      title: tituloDoOrcamento(orc),
      value: orc.valor,
      currency: 'BRL',
      status: 'open',
      lead_type: 'Cliente', // o paciente JÁ é cliente da clínica
      temperature: orc.aprovado ? 'Quente' : 'Frio',
      // 🔴 O relógio recebe a data do ORÇAMENTO (ou a da APROVAÇÃO, quando o
      // orçamento vem do relatório de aprovados) — nunca a data do import.
      stage_entered_at: relogioDaEtapa(orc),
      expected_close: dataDeFechamento(orc),
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
  const refAnteriorPorRef = new Map(
    plano.atualizados.filter((a) => a.refAnterior).map((a) => [a.externalRef, a.refAnterior!]),
  );
  for (const ref of refsAtualizar) {
    const orc = porRef.get(ref);
    const deal = ctx.dealsPorRef.get(ref);
    if (!orc || !deal) continue;
    const contato = ctx.contatoPorTelefone.get(orc.telefone);
    const patch: Record<string, unknown> = {
      title: tituloDoOrcamento(orc),
      value: orc.valor,
      expected_close: dataDeFechamento(orc),
    };
    // Data de aprovação corrigida no WebDental: o carimbo de ganho e o relógio
    // da etapa acompanham. `status` fica FORA do patch de propósito — mandá-lo
    // acordaria `_sync_deal_outcome_ts`, que sobrescreveria o `won_at`.
    if (orc.aprovado && deal.status === 'won') {
      patch.won_at = relogioDaEtapa(orc);
      patch.stage_entered_at = relogioDaEtapa(orc);
    }
    // Só o preço mudou: o orçamento é o mesmo, a chave é que precisa acompanhar.
    if (refAnteriorPorRef.has(ref)) patch.external_ref = orc.externalRef;
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

    // UM item por orçamento — o próprio tratamento do card.
    //
    // POR QUE MANTER `deal_products` COM UMA LINHA SÓ. Parece redundante agora
    // que o tratamento também está no campo personalizado, mas o campo é TEXTO
    // livre (`custom_field_values.value`): não tem chave estrangeira, não
    // agrupa e não sobrevive a uma renomeação. `deal_products → products` é o
    // que liga o orçamento à taxonomia odonto (`products.product_type`) e é
    // dali que sai a **conversão por especialidade** que a franqueadora cobra,
    // além do subtítulo do card no funil e dos painéis de /vendas, que já leem
    // essa tabela. Custo: uma linha por orçamento. Tirar exigiria migração e
    // quebraria relatório — a redundância aqui é barata e a alternativa não é.
    const manter: string[] = [];
    const produto = ctx.produtosPorNome.get(orc.tratamento.toLowerCase());
    if (!produto) {
      res.erros.push(`${orc.pacienteNome}: procedimento "${orc.tratamento}" não está no catálogo.`);
    } else {
      manter.push(produto.id);
      itensParaGravar.push({
        deal_id: deal.id,
        product_id: produto.id,
        value: dinheiro(orc.valor),
        quantity: 1,
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

  // --- 6. Carimbo de APROVADO (por fato, não por ausência) -----------------
  //
  // Roda DEPOIS dos procedimentos (passo 5) de propósito — ver a nota do
  // passo 3 sobre `_deal_won_to_sales`.
  //
  // São dois grupos, e o `status` só muda aqui:
  //  · os que nasceram nesta importação já na etapa "Aprovado" (passo 3);
  //  · os que já existiam abertos e agora apareceram no relatório de aprovados.
  passo(85, 'Aprovados (Dt Aprovação do relatório)');
  const hojeBr = new Date().toLocaleDateString('pt-BR');

  interface Carimbo {
    dealId: string;
    acao: AcaoDeal;
    orc: Orcamento | undefined;
    novo: boolean;
  }
  const carimbos: Carimbo[] = [];
  for (const a of plano.novosAprovados) {
    const deal = ctx.dealsPorRef.get(a.externalRef);
    if (deal) carimbos.push({ dealId: deal.id, acao: a, orc: porRef.get(a.externalRef), novo: true });
  }
  for (const a of plano.movidosParaAprovado) {
    if (a.dealId) carimbos.push({ dealId: a.dealId, acao: a, orc: porRef.get(a.externalRef), novo: false });
  }

  for (const c of carimbos) {
    const dia = c.acao.dtAprovacao;
    if (!dia) continue;
    const carimbo = `${dia}T12:00:00Z`;
    const { error } = await supabase
      .from('deals')
      .update({
        stage_id: plano.etapas[ETAPA_APROVADO],
        status: 'won',
        won_at: carimbo,
        // A data REAL da aprovação no relógio da etapa. O gatilho
        // `deals_stage_clock` respeita o valor informado — é a guarda escrita
        // na migração de 06/09 que permite importar histórico sem falsear o
        // "parado há N dias".
        stage_entered_at: carimbo,
        lost_reason: null,
        temperature: 'Quente',
        expected_close: dia,
      })
      .eq('id', c.dealId);
    if (error) {
      res.erros.push(`Marcar aprovado (${c.acao.paciente}): ${error.message}`);
      continue;
    }
    res.marcadosAprovados++;
    const { error: eNota } = await supabase.from('crm_activities').insert({
      deal_id: c.dealId,
      type: 'note',
      title: NOTA_APROVADO_POR_FATO,
      body:
        `O tratamento "${c.acao.tratamento ?? '—'}" de ${c.acao.paciente}, orçado em ` +
        `${c.acao.dtOrcamento}, veio no relatório "Controle de Efetivação — APENAS APROVADOS" ` +
        `com Dt Aprovação ${dia} (importado em ${hojeBr}).\n\n` +
        `Isto é FATO documentado pelo WebDental, não inferência: a data da aprovação está no ` +
        `próprio relatório. O orçamento entrou na etapa "${ETAPA_APROVADO}" com essa data e fica ` +
        `fora da régua de acompanhamento.\n\n` +
        (c.novo
          ? 'O orçamento não existia no CRM: foi criado já aprovado.'
          : 'O orçamento já estava aberto no CRM e foi movido — sem duplicar o card.'),
      done: true,
      done_at: new Date().toISOString(),
    });
    if (eNota) res.erros.push(`Registro da aprovação: ${eNota.message}`);
  }

  // --- 6b. Sumiram dos DOIS relatórios: sinalizar, NUNCA aprovar -----------
  //
  // Nada se move. O orçamento continua exatamente onde está, na etapa em que
  // está, aberto. A única coisa que acontece é uma nota no histórico do card
  // pedindo conferência — e ela é escrita **uma vez só**: sem essa trava, uma
  // importação por dia encheria o card de avisos idênticos e ninguém leria
  // nenhum.
  passo(90, 'Sinalizar orçamentos que sumiram');
  if (plano.sumiramSemExplicacao.length > 0) {
    const idsSumidos = plano.sumiramSemExplicacao.map((s) => s.dealId!).filter(Boolean);
    const jaSinalizados = new Set<string>();
    for (const lote of chunk(idsSumidos, 200)) {
      const { data, error } = await supabase
        .from('crm_activities')
        .select('deal_id')
        .eq('title', NOTA_SUMICO)
        .in('deal_id', lote);
      if (error) {
        // Sem conseguir ler o histórico, é melhor NÃO escrever do que escrever
        // duplicado — a informação já está no resumo da tela.
        res.erros.push(`Conferência de sumiços: ${error.message}`);
        lote.forEach((id) => jaSinalizados.add(id));
        continue;
      }
      for (const a of (data ?? []) as Array<{ deal_id: string | null }>) {
        if (a.deal_id) jaSinalizados.add(a.deal_id);
      }
    }
    const notas = plano.sumiramSemExplicacao
      .filter((s) => s.dealId && !jaSinalizados.has(s.dealId))
      .map((s) => ({
        deal_id: s.dealId,
        type: 'note',
        title: NOTA_SUMICO,
        body:
          `O tratamento "${s.tratamento ?? '—'}" de ${s.paciente}, orçado em ${s.dtOrcamento}, ` +
          `SAIU do relatório de não aprovados e NÃO apareceu no de aprovados (importação de ` +
          `${hojeBr}; período dos relatórios: ${plano.periodo.de ?? '?'} a ${plano.periodo.ate ?? '?'}).\n\n` +
          `A explicação mais provável é CANCELAMENTO no WebDental. Pode ser também correção de ` +
          `cadastro, mudança de valor ou export incompleto.\n\n` +
          `⚠️ O CRM NÃO marcou como aprovado e NÃO encerrou: o orçamento continua onde estava. ` +
          `Contar isto como receita sem conferir na clínica seria inventar dinheiro. ` +
          `Confira no WebDental e mova na mão.`,
        done: false,
      }));
    for (const lote of chunk(notas, 100)) {
      const { error } = await supabase.from('crm_activities').insert(lote);
      if (error) res.erros.push(`Sinalização de sumiço: ${error.message}`);
      else res.sinalizadosParaConferencia += lote.length;
    }
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
        `O tratamento "${a.tratamento ?? '—'}" orçado em ${a.dtOrcamento} continuava no relatório de não aprovados após ` +
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
