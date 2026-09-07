// ============================================================================
// src/lib/webdental.ts — leitura do relatório *Controle de Efetivação*
// ----------------------------------------------------------------------------
// Fonte: WebDental / Dental Vidas (`relatorios.webdentalsolucoes.io`),
// unidade AmorSaúde Itabuna Centro.
//
// 🔴 SÃO **DOIS** ARQUIVOS (decisão do Danilo, 07/09/2026).
//    · Arquivo A — filtro "APENAS NÃO APROVADOS": `Dt Aprovação` SEMPRE vazia.
//    · Arquivo B — filtro "APENAS APROVADOS":     `Dt Aprovação` SEMPRE cheia.
//
//    **Por que dois e não um.** O WebDental TRUNCA a exportação em 100 linhas.
//    Com "Exibir: TODOS" são 143 tratamentos e 43 se perdem em silêncio —
//    verificado em três exports. Separados, cada um cabe no limite.
//
//    **O CRM reconhece qual é qual pela coluna `Dt Aprovação`** — o usuário não
//    escolhe nada na tela. É `classificarRelatorio()`, aqui embaixo.
//
// ⚠️ O ARQUIVO NÃO É UM XLS. Apesar da extensão `.xls`, o export é uma PÁGINA
//    HTML com sete `<table>`. A tabela de dados é a que tem o cabeçalho
//    "Paciente / Tel / ... / Dt Orçamento". As outras seis são o cabeçalho do
//    relatório, as metas da franqueadora e o rodapé.
//
// ⚠️ POR QUE NÃO USAR O SheetJS COMO CAMINHO PRINCIPAL. O SheetJS lê o HTML,
//    mas converte a célula "2026-09-01" em objeto Date e o formata no fuso
//    LOCAL — em Itabuna (UTC-3) isso vira "8/31/26". **Todo orçamento perderia
//    um dia**, e a régua D+1/D+3/D+7 dispararia com a data errada. Por isso o
//    caminho principal é ler o texto cru da tabela HTML. O SheetJS fica só
//    como plano B, para o dia em que o WebDental exportar um XLS de verdade —
//    e lá a data é lida com os getters UTC, que desfazem o deslocamento.
//
// Este módulo é PURO: não fala com o Supabase, não usa DOM. Assim a mesma
// função que roda no navegador pode ser conferida fora dele.
// ============================================================================

import * as XLSX from 'xlsx';
import { canonicalPhone } from '@/lib/phone';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/**
 * Um orçamento = UMA LINHA do relatório = UM tratamento. Vira UM deal.
 *
 * 🔴 MUDANÇA DE MODELO (decisão do dono, 06/09/2026): *"cada tratamento deve
 *    ser um orçamento separado"*. Até então a unidade era o par
 *    (paciente + data), com os tratamentos como itens dentro de uma única
 *    oportunidade — o arquivo real virava 64 cards.
 *
 * **Por que separar (justificativa de negócio).** Cada tratamento tem o seu
 * próprio ciclo de decisão: o paciente aprova a limpeza e recusa a prótese.
 * Agrupado, isso fica invisível — o card inteiro parece "não aprovado" mesmo
 * quando metade do dinheiro já entrou. Separado, dá para medir **conversão por
 * especialidade**, que é o indicador que a franqueadora cobra (metas próprias
 * para orto, implante, prótese e clínica geral — ver ODONTO.md §2).
 */
export interface Orcamento {
  /**
   * Chave determinística e estável — trava de idempotência da importação.
   * `webdental:<paciente>:<data>:<tratamento>:<ocorrência>:<valor em centavos>`
   */
  externalRef: string;
  /**
   * O mesmo `externalRef` SEM o valor. Serve para reconhecer o orçamento
   * quando só o preço mudou entre um export e outro: sem isso, uma correção de
   * valor faria o CRM dar o orçamento antigo como "sumiu do relatório = foi
   * aprovado" (receita fantasma) e criar um card novo ao lado.
   */
  chaveBase: string;
  /** Telefone na forma canônica (+55 DDD 9XXXXXXXX). */
  telefone: string;
  /** Telefone exatamente como veio no arquivo. */
  telefoneCru: string;
  pacienteNome: string;
  /** AAAA-MM-DD */
  dtOrcamento: string;
  /**
   * AAAA-MM-DD quando o orçamento veio do relatório de APROVADOS, null quando
   * veio do de não aprovados.
   *
   * 🔴 É o campo que muda o destino do orçamento no funil, e é FATO — não
   * inferência. Com data → etapa "Aprovado", com a data real da aprovação,
   * fora de qualquer régua. Sem data → "Orçamento apresentado".
   */
  dtAprovacao: string | null;
  /** Atalho de leitura: `dtAprovacao !== null`. */
  aprovado: boolean;
  /** Nome do arquivo que trouxe esta linha — só para auditoria e resumo. */
  arquivo: string;
  /** AAAA-MM-DD ou null */
  dtAgenda: string | null;
  /** Valor da linha (Valor Total do tratamento). */
  valor: number;
  participacaoConvenio: number;
  /** Normalizada: "Filiado (Cartão de TODOS)" · "Particular" · "Life Premium". */
  tabelaPreco: string;
  /** Texto cru da tabela, preservado para auditoria. */
  tabelaPrecoCrua: string;
  dentista: string;
  endereco: string;
  /** Nome do tratamento como veio do relatório ("Clínica Geral", "Prótese"…). */
  tratamento: string;
  /** Especialidade correspondente (rótulo em português). */
  especialidade: string;
  /** Código de `products.product_type` ('clinica_geral', 'protese'…). */
  productType: string;
  /**
   * 1, 2, 3… entre tratamentos IGUAIS do mesmo paciente na mesma data. No
   * arquivo real há um paciente com DUAS próteses no mesmo dia — são dois
   * dentes, duas oportunidades legítimas, e é isto que as separa.
   */
  ocorrencia: number;
  /** Quantas linhas iguais existem no grupo (1 = tratamento único no dia). */
  totalOcorrencias: number;
  /** Linha do arquivo que gerou este orçamento (1-based, contando o cabeçalho). */
  linha: number;
}

export interface LinhaIgnorada {
  linha: number;
  motivo: string;
  paciente?: string;
}

/**
 * 🔴 DENTALVIDAS **NÃO É TRATAMENTO ODONTOLÓGICO** — é a venda do plano.
 *
 * Prova documental, para ninguém desfazer isto por engano depois:
 *  · o cabeçalho do próprio relatório conta separado — "QTD Tratamento
 *    Aprovados: 63" e "Valor Total Dental Vidas: R$ 510,00", contra 65 linhas
 *    somando R$ 35.213,31. A diferença é exatamente R$ 510,00 (2 × R$ 255,00);
 *  · o PDF do relatório traz a legenda "VENDA EXTERNA PLANO DENTALVIDAS".
 *
 * Entrar como orçamento odontológico criaria um procedimento "DENTALVIDAS" no
 * catálogo, inflaria a conversão por especialidade e somaria R$ 510,00 de
 * receita que não é de tratamento. Fica separado, é relatado no resumo e vira
 * pendência para o dono decidir o que fazer com a venda de plano.
 */
export interface VendaPlano {
  paciente: string;
  telefone: string | null;
  dtOrcamento: string;
  dtAprovacao: string | null;
  valor: number;
  tratamento: string;
  linha: number;
  arquivo: string;
}

/** O que o filtro do WebDental produziu, deduzido da coluna `Dt Aprovação`. */
export type TipoRelatorio = 'nao_aprovados' | 'aprovados' | 'misto' | 'vazio';

export interface ParseWebdentalResult {
  orcamentos: Orcamento[];
  /** Linhas de dados lidas (sem o cabeçalho). */
  linhasLidas: number;
  ignoradas: LinhaIgnorada[];
  /** Período do filtro do relatório (AAAA-MM-DD), quando o cabeçalho o traz. */
  periodo: { de: string | null; ate: string | null };
  /** Como o arquivo foi lido — só para exibir no resumo. */
  formato: 'html' | 'planilha';
  /** Avisos que não invalidam a linha, mas o dono precisa ver. */
  avisos: string[];
  /** Nome do arquivo lido. */
  arquivo: string;
  /** Aprovados / não aprovados — deduzido, não perguntado ao usuário. */
  tipo: TipoRelatorio;
  /** Linhas de venda do plano DENTALVIDAS — fora dos orçamentos. */
  vendasPlano: VendaPlano[];
}

// ---------------------------------------------------------------------------
// Higiene de texto
// ---------------------------------------------------------------------------

/**
 * Conserta texto UTF-8 que foi lido como Latin-1 ("ConceiÃ§Ã£o" → "Conceição").
 * Só age quando o padrão característico aparece; caso contrário devolve igual.
 *
 * O arquivo real de 05/09/2026 chega em UTF-8 correto quando lido como UTF-8 —
 * a corrupção acontece em quem lê com a codificação errada. Esta função é a
 * rede de segurança para esse caso.
 */
export function repararMojibake(texto: string): string {
  if (!texto) return texto;
  if (!/[\u00c3\u00c2][\u0080-\u00bf]/.test(texto)) return texto;
  // Só dá para reinterpretar se TODO caractere couber num byte.
  for (let i = 0; i < texto.length; i++) {
    if (texto.charCodeAt(i) > 0xff) return texto;
  }
  try {
    const bytes = new Uint8Array(texto.length);
    for (let i = 0; i < texto.length; i++) bytes[i] = texto.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return texto;
  }
}

const MAIUSCULA_ACENTUADA = 'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ';
const MINUSCULA_ACENTUADA = 'àáâãäåçèéêëìíîïñòóôõöùúûüý';

/**
 * Conserta o artefato de CAIXA do próprio WebDental: "ConceiÇÃo",
 * "AssunÇÃo", "JoÃo", "GuimarÃes", "VictÓria".
 *
 * Não é problema de codificação — os bytes são UTF-8 válidos. É um
 * `strtolower()` byte a byte na origem, que rebaixa só o A-Z e deixa a letra
 * acentuada em maiúscula no meio da palavra.
 *
 * A regra é conservadora: só rebaixa letra ACENTUADA maiúscula quando a letra
 * anterior é minúscula. Por isso "SÃO BOAVENTURA" (endereço em caixa alta)
 * passa intacto, e nomes legítimos em caixa alta também.
 */
export function repararCaixa(texto: string): string {
  if (!texto) return texto;
  let out = '';
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    const idx = MAIUSCULA_ACENTUADA.indexOf(c);
    // O caractere anterior é lido do RESULTADO, não da entrada. Em "ConceiÇÃo"
    // o 'Ç' vira 'ç' primeiro; só assim o 'Ã' seguinte enxerga uma minúscula
    // antes dele e também é rebaixado. Lendo da entrada, o 'Ã' veria o 'Ç'
    // maiúsculo e ficaria "ConceiçÃo" — meio conserto.
    const anterior = out.length > 0 ? out[out.length - 1] : '';
    const anteriorMinuscula =
      anterior !== '' && anterior !== anterior.toUpperCase() && anterior === anterior.toLowerCase();
    out += idx >= 0 && anteriorMinuscula ? MINUSCULA_ACENTUADA[idx] : c;
  }
  return out;
}

/** Limpeza padrão de toda célula de texto do relatório. */
export function limparTexto(valor: unknown): string {
  if (valor == null) return '';
  return repararCaixa(repararMojibake(String(valor)))
    .replace(/\s+/g, ' ')
    .replace(/;+\s*$/, '') // o WebDental termina o prestador com ';'
    .trim();
}

/** Remove acentos e reduz a [a-z0-9-] — usado na chave do orçamento. */
export function slug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Datas e valores
// ---------------------------------------------------------------------------

/**
 * Converte a data do relatório para AAAA-MM-DD.
 * Aceita "2026-09-01", "01/09/2026" e "1/9/26". Devolve null quando vazio ou
 * irreconhecível — nunca uma data inventada.
 */
export function parseDataRelatorio(valor: unknown): string | null {
  if (valor == null) return null;
  if (valor instanceof Date) {
    // Vem do SheetJS: a data foi criada à meia-noite UTC. Ler com os getters
    // UTC desfaz o deslocamento de fuso que transformaria 01/09 em 31/08.
    const y = valor.getUTCFullYear();
    const m = String(valor.getUTCMonth() + 1).padStart(2, '0');
    const d = String(valor.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(valor).trim();
  if (!s) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const br = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s);
  if (br) {
    let [, d, m, y] = br;
    if (y.length === 2) y = `20${y}`;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

/**
 * Telefone do relatório → forma canônica do CRM (E.164 com o nono dígito).
 *
 * ⚠️ O WebDental exporta SEM o código do país: "73-98882-7126", e três dos 81
 *    registros vêm sem o nono dígito: "73-8841-4920". `canonicalPhone` sozinho
 *    não resolve — ele exige que o número já esteja em E.164 e devolveria
 *    "+73988827126", que não é telefone nenhum. Aqui o "55" é reposto ANTES,
 *    e só então a regra do nono dígito (a mesma de `src/lib/phone.ts`) age.
 *
 * 10 ou 11 dígitos = número brasileiro sem DDI. 12 ou 13 já vêm com o 55 e
 * passam direto. Qualquer outra coisa devolve null — nunca um palpite.
 */
export function telefoneDoRelatorio(bruto: unknown): string | null {
  if (bruto == null) return null;
  let d = String(bruto).replace(/\D/g, '');
  d = d.replace(/^0+/, ''); // "0XX" da discagem antiga
  if (!d) return null;
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return canonicalPhone(d);
}

/**
 * Valor monetário do relatório. O export usa ponto decimal e não separa
 * milhar ("1458.00"), mas a função também aceita o formato brasileiro
 * ("R$ 1.458,00") caso o WebDental mude.
 */
export function parseValor(valor: unknown): number {
  if (valor == null) return 0;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  const s = String(valor).replace(/[^\d.,-]/g, '').trim();
  if (!s) return 0;
  const n = s.includes(',')
    ? Number(s.replace(/\./g, '').replace(',', '.'))
    : Number(s);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// Domínio odonto
// ---------------------------------------------------------------------------

/**
 * Tabela de preço → rótulo curto.
 * NOMENCLATURA OBRIGATÓRIA (ODONTO.md §4): quem paga com desconto do Cartão de
 * TODOS é **FILIADO**, nunca "sócio".
 */
export function normalizarTabelaPreco(bruto: string): string {
  const t = bruto.toLowerCase();
  if (t.includes('cart') && t.includes('todos')) return 'Filiado (Cartão de TODOS)';
  if (t.includes('particular')) return 'Particular';
  if (t.includes('life premium')) return 'Life Premium';
  return bruto.trim() || 'Não informada';
}

interface EspecialidadeInfo {
  especialidade: string;
  productType: string;
}

const ESPECIALIDADES: Array<{ teste: RegExp } & EspecialidadeInfo> = [
  { teste: /cl[ií]nica\s*geral/i, especialidade: 'Clínica Geral', productType: 'clinica_geral' },
  { teste: /pr[óo]tese/i, especialidade: 'Prótese', productType: 'protese' },
  { teste: /implant/i, especialidade: 'Implantodontia', productType: 'implante' },
  { teste: /ortod/i, especialidade: 'Ortodontia', productType: 'orto' },
  { teste: /endod/i, especialidade: 'Endodontia', productType: 'endo' },
  { teste: /period/i, especialidade: 'Periodontia', productType: 'perio' },
  { teste: /odontopedia/i, especialidade: 'Odontopediatria', productType: 'odontopediatria' },
  { teste: /est[ée]tic/i, especialidade: 'Estética', productType: 'estetica' },
  { teste: /cirurg/i, especialidade: 'Cirurgia', productType: 'cirurgia' },
];

/**
 * Reconhece a linha de VENDA DO PLANO DentalVidas, que o WebDental mistura com
 * os tratamentos. Ver o comentário de `VendaPlano` para a prova de que não é
 * procedimento. Cobre "DENTALVIDAS", "Dental Vidas" e "Plano DentalVidas".
 */
export function ehVendaDePlano(tratamento: string): boolean {
  return /dental\s*vidas/i.test(tratamento);
}

/**
 * Tratamento do relatório → especialidade + tipo do catálogo.
 * O arquivo real só traz 4 (Clínica Geral, Prótese, Ortodontia,
 * Implantodontia); as demais estão previstas para não travar um export futuro.
 * Tratamento desconhecido NÃO é descartado: entra com o próprio nome e cai em
 * 'clinica_geral', e a importação avisa o dono.
 */
export function classificarTratamento(tratamento: string): EspecialidadeInfo & { conhecido: boolean } {
  for (const e of ESPECIALIDADES) {
    if (e.teste.test(tratamento)) {
      return { especialidade: e.especialidade, productType: e.productType, conhecido: true };
    }
  }
  return {
    especialidade: tratamento.trim() || 'Não informada',
    productType: 'clinica_geral',
    conhecido: false,
  };
}

// ---------------------------------------------------------------------------
// Leitura do arquivo
// ---------------------------------------------------------------------------

const COLUNAS_ESPERADAS = [
  'Paciente', 'Tel', 'Endereço', 'Dt Orçamento', 'Dt Aprovação', 'Dt Finalização',
  'Tratamento', 'Valor Total', 'Total Participação Convenio', 'Tabela do Orçamento',
  'Prestador', 'Dt Agenda', 'Dt Retorno', 'Dt Obs', 'Obs Resp', 'Observação',
] as const;

interface Tabela {
  cabecalho: string[];
  linhas: string[][];
}

function decodificarHtml(trecho: string): string {
  return trecho
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)))
    .trim();
}

/** Extrai todas as `<table>` do HTML como matrizes de texto cru. */
function extrairTabelasHtml(html: string): Tabela[] {
  const tabelas: Tabela[] = [];
  for (const bloco of html.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    const trs = bloco.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    const linhas = trs.map((tr) =>
      [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => decodificarHtml(m[1])),
    );
    if (linhas.length === 0) continue;
    tabelas.push({ cabecalho: linhas[0], linhas: linhas.slice(1) });
  }
  return tabelas;
}

function ehTabelaDeDados(t: Tabela): boolean {
  const head = t.cabecalho.map((h) => limparTexto(h).toLowerCase());
  return head.includes('paciente') && head.some((h) => h.startsWith('dt or'));
}

/** Período do filtro, do cabeçalho do relatório ("PERÍODO:01/09/2026até30/09/2026"). */
function extrairPeriodo(texto: string): { de: string | null; ate: string | null } {
  const limpo = repararMojibake(texto);
  const m = /PER[IÍ]ODO:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s*at[ée]\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i.exec(limpo);
  if (!m) return { de: null, ate: null };
  return { de: parseDataRelatorio(m[1]), ate: parseDataRelatorio(m[2]) };
}

/** Lê o arquivo como planilha de verdade (plano B). */
function tabelaViaSheetJs(bytes: Uint8Array): Tabela | null {
  const wb = XLSX.read(bytes, { type: 'array', cellDates: true });
  for (const nome of wb.SheetNames) {
    const linhas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nome], {
      header: 1,
      raw: true,
      defval: '',
    });
    if (linhas.length < 2) continue;
    const cabecalho = (linhas[0] as unknown[]).map((c) => limparTexto(c));
    const t: Tabela = {
      cabecalho,
      // As datas precisam sobreviver como Date até `parseDataRelatorio`.
      linhas: linhas.slice(1) as unknown as string[][],
    };
    if (ehTabelaDeDados(t)) return t;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Parse principal
// ---------------------------------------------------------------------------

/** Um orçamento antes de ganhar a chave de identidade e a ocorrência. */
export type OrcamentoSemChave = Omit<
  Orcamento,
  'externalRef' | 'chaveBase' | 'ocorrencia' | 'totalOcorrencias'
>;

/** Grupo de identidade: mesmo paciente, mesma data, mesmo tratamento. */
function grupoDoOrcamento(o: OrcamentoSemChave): string {
  return `${slug(o.pacienteNome)}|${o.dtOrcamento}|${slug(o.tratamento)}`;
}

/**
 * Atribui ocorrência e chave de identidade a um conjunto de orçamentos.
 *
 * ⚠️ A ocorrência NÃO é a ordem do arquivo. Se fosse, um relatório que
 * exportasse as duas linhas do mesmo tratamento em ordem trocada geraria chaves
 * diferentes para os mesmos dois orçamentos: dois cards novos de um lado e dois
 * "aprovados por ausência" do outro — receita inventada. A ordem é decidida
 * pelo CONTEÚDO: valor, depois não-aprovado antes de aprovado, depois a linha.
 *
 * 🔴 POR QUE O CRITÉRIO "não aprovado antes de aprovado" ENTROU (07/09/2026).
 * Com DOIS arquivos, `linha` deixou de ser único: a linha 15 existe nos dois.
 * Sem um critério anterior a ela, dois tratamentos iguais do mesmo paciente no
 * mesmo dia — um em cada arquivo — poderiam receber a MESMA ocorrência e, se o
 * valor também coincidisse, a MESMA chave: dois orçamentos disputando um único
 * card. Com o critério, os arquivos ficam sempre separados antes de a linha ser
 * consultada.
 *
 * ⚠️ Limite conhecido e aceito: se dois tratamentos idênticos, no mesmo dia,
 * pelo mesmo valor, forem aprovados em dias diferentes, o ordinal de cada um
 * troca de lugar entre um export e outro. Como as duas linhas são
 * indistinguíveis (mesmo paciente, tratamento, data e valor), o efeito prático
 * é nenhum: um dos dois cards se move para Aprovado, e é impossível dizer qual
 * "deveria" ser. Não há chave melhor sem um identificador do WebDental, que o
 * relatório não exporta.
 */
export function atribuirChaves(itens: OrcamentoSemChave[]): Orcamento[] {
  const porGrupo = new Map<string, OrcamentoSemChave[]>();
  for (const c of itens) {
    const g = grupoDoOrcamento(c);
    const lista = porGrupo.get(g) ?? [];
    lista.push(c);
    porGrupo.set(g, lista);
  }
  const out: Orcamento[] = [];
  for (const [grupo, lista] of porGrupo) {
    lista.sort(
      (a, b) =>
        a.valor - b.valor ||
        Number(a.aprovado) - Number(b.aprovado) ||
        a.linha - b.linha ||
        a.arquivo.localeCompare(b.arquivo),
    );
    lista.forEach((c, i) => {
      const chaveBase = `webdental:${grupo.split('|').join(':')}:${i + 1}`;
      out.push({
        ...c,
        chaveBase,
        externalRef: `${chaveBase}:${Math.round(c.valor * 100)}`,
        ocorrencia: i + 1,
        totalOcorrencias: lista.length,
      });
    });
  }
  return out;
}

/** Ordena para exibição: data, paciente, tratamento, ocorrência. */
function ordenarParaExibicao(orcamentos: Orcamento[]): void {
  orcamentos.sort((a, b) => {
    if (a.dtOrcamento !== b.dtOrcamento) return a.dtOrcamento.localeCompare(b.dtOrcamento);
    const nome = a.pacienteNome.localeCompare(b.pacienteNome, 'pt-BR');
    if (nome !== 0) return nome;
    const trat = a.tratamento.localeCompare(b.tratamento, 'pt-BR');
    return trat !== 0 ? trat : a.ocorrencia - b.ocorrencia;
  });
}

/**
 * Lê o relatório e devolve **um orçamento por linha** — 1 linha = 1 tratamento
 * = 1 oportunidade no funil. Nada é agrupado por paciente.
 *
 * @param bytes conteúdo bruto do arquivo
 * @param arquivo nome do arquivo, só para o resumo e a auditoria
 */
export function parseWebdental(bytes: Uint8Array, arquivo = ''): ParseWebdentalResult {
  const avisos: string[] = [];
  const ignoradas: LinhaIgnorada[] = [];
  const vendasPlano: VendaPlano[] = [];

  const texto = new TextDecoder('utf-8').decode(bytes);
  const pareceHtml = /<table/i.test(texto.slice(0, 400_000));

  let tabela: Tabela | null = null;
  let periodo = { de: null as string | null, ate: null as string | null };
  let formato: 'html' | 'planilha' = 'html';

  if (pareceHtml) {
    const tabelas = extrairTabelasHtml(texto);
    tabela = tabelas.find(ehTabelaDeDados) ?? null;
    periodo = extrairPeriodo(texto);
  }
  if (!tabela) {
    formato = 'planilha';
    tabela = tabelaViaSheetJs(bytes);
  }

  if (!tabela) {
    throw new Error(
      'Não encontrei a tabela de tratamentos. Confira se o arquivo é o relatório ' +
        '"Controle de Efetivação" do WebDental, exportado com o filtro ' +
        '"APENAS NÃO APROVADOS" ou "APENAS APROVADOS".',
    );
  }

  // Índice de cada coluna pelo nome (o WebDental pode reordenar).
  const cabecalho = tabela.cabecalho.map((h) => limparTexto(h).toLowerCase());
  const col = (nome: string): number =>
    cabecalho.findIndex((h) => h === nome.toLowerCase());
  const idx = {
    paciente: col('Paciente'),
    tel: col('Tel'),
    endereco: col('Endereço'),
    dtOrcamento: cabecalho.findIndex((h) => h.startsWith('dt or')),
    // 🔴 A coluna que decide o destino do orçamento. Cheia = aprovado (fato).
    dtAprovacao: cabecalho.findIndex((h) => h.startsWith('dt aprova')),
    tratamento: col('Tratamento'),
    valor: col('Valor Total'),
    convenio: cabecalho.findIndex((h) => h.startsWith('total particip')),
    tabela: col('Tabela do Orçamento'),
    prestador: col('Prestador'),
    dtAgenda: col('Dt Agenda'),
  };

  const faltando = COLUNAS_ESPERADAS.filter(
    (c) => !cabecalho.includes(c.toLowerCase()) && !cabecalho.some((h) => h.startsWith(c.slice(0, 10).toLowerCase())),
  );
  if (faltando.length > 0) {
    avisos.push(`Colunas do relatório que não reconheci: ${faltando.join(', ')}.`);
  }
  if (idx.paciente < 0 || idx.tel < 0 || idx.dtOrcamento < 0 || idx.valor < 0) {
    throw new Error('O relatório não tem as colunas Paciente, Tel, Dt Orçamento e Valor Total.');
  }

  // --- 1 LINHA = 1 ORÇAMENTO ------------------------------------------------
  //
  // A chave NÃO inclui o telefone de propósito. Se a recepção corrigir o número
  // num export seguinte, o orçamento continua sendo o MESMO — o CRM atualiza o
  // contato em vez de criar um deal duplicado.
  //
  // A ocorrência é atribuída numa SEGUNDA passada, ordenando o grupo por valor
  // (e, no empate, pela linha). Se fosse na ordem do arquivo, um relatório com
  // as duas linhas trocadas de lugar geraria chaves diferentes para os mesmos
  // dois tratamentos — e a reimportação criaria dois cards novos, dando os dois
  // antigos por aprovados. Ordenar pelo CONTEÚDO torna a chave independente da
  // ordem em que o WebDental resolveu exportar.
  const crus: OrcamentoSemChave[] = [];
  const tratamentosDesconhecidos = new Set<string>();
  const telefonesPorPaciente = new Map<string, Set<string>>();
  let linhasLidas = 0;

  for (let i = 0; i < tabela.linhas.length; i++) {
    const r = tabela.linhas[i];
    const numeroLinha = i + 2; // 1-based, contando o cabeçalho
    if (!r || r.length === 0) continue;

    const paciente = limparTexto(r[idx.paciente]);
    const telCru = limparTexto(r[idx.tel]);
    const dt = parseDataRelatorio(r[idx.dtOrcamento]);
    const dtAprov = idx.dtAprovacao >= 0 ? parseDataRelatorio(r[idx.dtAprovacao]) : null;

    // Linha de rodapé/total do relatório: sem paciente e sem data.
    if (!paciente && !dt) continue;
    linhasLidas++;

    // 🔴 VENDA DO PLANO, não tratamento. Sai ANTES de classificar a
    // especialidade — senão viraria um procedimento "DENTALVIDAS" no catálogo,
    // R$ 510,00 de receita que não é de tratamento e uma conversão por
    // especialidade errada. Ver o comentário de `VendaPlano`.
    const tratamentoDaLinha = limparTexto(r[idx.tratamento]);
    if (ehVendaDePlano(tratamentoDaLinha)) {
      vendasPlano.push({
        paciente,
        telefone: telefoneDoRelatorio(telCru),
        dtOrcamento: dt ?? '',
        dtAprovacao: dtAprov,
        valor: Math.round(parseValor(r[idx.valor]) * 100) / 100,
        tratamento: tratamentoDaLinha,
        linha: numeroLinha,
        arquivo,
      });
      continue;
    }

    if (!paciente) {
      ignoradas.push({ linha: numeroLinha, motivo: 'Sem nome de paciente.' });
      continue;
    }
    if (!dt) {
      ignoradas.push({ linha: numeroLinha, motivo: 'Data do orçamento vazia ou ilegível.', paciente });
      continue;
    }
    const telefone = telefoneDoRelatorio(telCru);
    if (!telefone) {
      ignoradas.push({
        linha: numeroLinha,
        motivo: `Telefone inválido ou ausente ("${telCru}"). Sem telefone não há conversa de WhatsApp.`,
        paciente,
      });
      continue;
    }

    const tratamentoBruto = tratamentoDaLinha || 'Não informado';
    const classe = classificarTratamento(tratamentoBruto);
    if (!classe.conhecido) tratamentosDesconhecidos.add(tratamentoBruto);

    const tabelaPrecoCrua = idx.tabela >= 0 ? limparTexto(r[idx.tabela]) : '';

    crus.push({
      telefone,
      telefoneCru: telCru,
      pacienteNome: paciente,
      dtOrcamento: dt,
      dtAprovacao: dtAprov,
      aprovado: dtAprov !== null,
      arquivo,
      dtAgenda: idx.dtAgenda >= 0 ? parseDataRelatorio(r[idx.dtAgenda]) : null,
      valor: Math.round(parseValor(r[idx.valor]) * 100) / 100,
      participacaoConvenio:
        idx.convenio >= 0 ? Math.round(parseValor(r[idx.convenio]) * 100) / 100 : 0,
      tabelaPreco: normalizarTabelaPreco(tabelaPrecoCrua),
      tabelaPrecoCrua,
      dentista: idx.prestador >= 0 ? limparTexto(r[idx.prestador]) : '',
      endereco: idx.endereco >= 0 ? limparTexto(r[idx.endereco]) : '',
      tratamento: tratamentoBruto,
      especialidade: classe.especialidade,
      productType: classe.productType,
      linha: numeroLinha,
    });

    const chavePaciente = `${slug(paciente)}|${dt}`;
    const tels = telefonesPorPaciente.get(chavePaciente) ?? new Set<string>();
    tels.add(telefone);
    telefonesPorPaciente.set(chavePaciente, tels);
  }

  // --- 2ª passada: ocorrência e chave de identidade -------------------------
  //
  // ⚠️ Quando os DOIS relatórios são importados juntos, esta atribuição é
  // REFEITA sobre a união em `combinarLeituras()`. Aqui ela vale para o arquivo
  // isolado, que é como a função é usada em conferência e teste.
  const orcamentos = atribuirChaves(crus);

  // --- Avisos ---------------------------------------------------------------
  if (tratamentosDesconhecidos.size > 0) {
    avisos.push(
      `Tratamento(s) sem especialidade conhecida: ${[...tratamentosDesconhecidos].join(', ')}. ` +
        'Entram como Clínica Geral no catálogo — confira depois.',
    );
  }
  for (const [chave, tels] of telefonesPorPaciente) {
    if (tels.size > 1) {
      const orc = orcamentos.find((o) => `${slug(o.pacienteNome)}|${o.dtOrcamento}` === chave);
      avisos.push(
        `${orc?.pacienteNome ?? chave} aparece com ${tels.size} telefones diferentes no mesmo dia; ` +
          `cada orçamento fica com o telefone da própria linha.`,
      );
    }
  }
  const repetidos = orcamentos.filter((o) => o.totalOcorrencias > 1);
  if (repetidos.length > 0) {
    const grupos = new Set(repetidos.map((o) => `${o.pacienteNome} · ${o.tratamento} · ${o.dtOrcamento}`));
    avisos.push(
      `${grupos.size} caso(s) de tratamento REPETIDO no mesmo dia para o mesmo paciente ` +
        `(${[...grupos].slice(0, 3).join(' | ')}${grupos.size > 3 ? '…' : ''}). ` +
        'São dentes diferentes: cada um vira uma oportunidade própria, numerada (1º, 2º…).',
    );
  }
  const semValor = orcamentos.filter((o) => o.valor === 0);
  if (semValor.length > 0) {
    avisos.push(
      `${semValor.length} orçamento(s) com valor zero (${semValor
        .map((o) => o.pacienteNome)
        .slice(0, 3)
        .join(', ')}${semValor.length > 3 ? '…' : ''}). Entram assim mesmo — o valor é o do relatório.`,
    );
  }
  const telefonesCompartilhados = new Map<string, Set<string>>();
  for (const o of orcamentos) {
    const s = telefonesCompartilhados.get(o.telefone) ?? new Set<string>();
    s.add(o.pacienteNome);
    telefonesCompartilhados.set(o.telefone, s);
  }
  const familias = [...telefonesCompartilhados.values()].filter((s) => s.size > 1);
  if (familias.length > 0) {
    avisos.push(
      `${familias.length} telefone(s) atendem mais de um paciente (família). ` +
        'Um contato só, com os orçamentos de todos pendurados nele — é o modelo combinado.',
    );
  }

  // Sem cabeçalho de período (export futuro), o período vira o intervalo das
  // datas encontradas. Isso importa: a inferência "sumiu do relatório = foi
  // aprovado" SÓ pode olhar orçamentos dentro do período coberto.
  if (!periodo.de || !periodo.ate) {
    const datas = orcamentos.map((o) => o.dtOrcamento).sort();
    periodo = { de: datas[0] ?? null, ate: datas[datas.length - 1] ?? null };
    if (datas.length > 0) {
      avisos.push(
        `O cabeçalho não trouxe o período do filtro; usei o intervalo das datas do arquivo ` +
          `(${periodo.de} a ${periodo.ate}).`,
      );
    }
  }

  ordenarParaExibicao(orcamentos);

  // --- Que relatório é este? ------------------------------------------------
  // Deduzido da coluna `Dt Aprovação`, nunca perguntado ao usuário.
  const comAprovacao = orcamentos.filter((o) => o.aprovado).length;
  const tipo: TipoRelatorio =
    orcamentos.length === 0
      ? 'vazio'
      : comAprovacao === 0
        ? 'nao_aprovados'
        : comAprovacao === orcamentos.length
          ? 'aprovados'
          : 'misto';

  if (tipo === 'misto') {
    // Acontece se o WebDental for exportado com "Exibir: TODOS" — que é
    // exatamente a exportação que TRUNCA em 100 linhas e perde registros.
    avisos.push(
      `Este arquivo tem aprovados E não aprovados misturados (${comAprovacao} com data de ` +
        `aprovação, ${orcamentos.length - comAprovacao} sem). Provavelmente foi exportado com ` +
        '"Exibir: TODOS", que o WebDental TRUNCA em 100 linhas — registros podem estar faltando. ' +
        'Exporte separado: "APENAS NÃO APROVADOS" e "APENAS APROVADOS".',
    );
  }
  if (vendasPlano.length > 0) {
    const total = Math.round(vendasPlano.reduce((a, v) => a + v.valor, 0) * 100) / 100;
    avisos.push(
      `${vendasPlano.length} linha(s) de VENDA DO PLANO DentalVidas (R$ ${total.toFixed(2)}) ficaram ` +
        `FORA da importação: ${vendasPlano.map((v) => v.paciente).join(', ')}. ` +
        'Não é procedimento odontológico — o próprio relatório conta separado ' +
        '("Valor Total Dental Vidas") e o PDF chama de "venda externa plano". ' +
        'O que fazer com a venda de plano é decisão do dono.',
    );
  }

  return {
    orcamentos,
    linhasLidas,
    ignoradas,
    periodo,
    formato,
    avisos,
    arquivo,
    tipo,
    vendasPlano,
  };
}

// ---------------------------------------------------------------------------
// União dos DOIS relatórios
// ---------------------------------------------------------------------------

/** Rótulo em português do tipo de relatório — para a tela. */
export function rotuloDoTipo(tipo: TipoRelatorio): string {
  switch (tipo) {
    case 'nao_aprovados':
      return 'Não aprovados';
    case 'aprovados':
      return 'Aprovados';
    case 'misto':
      return 'Misturado (aprovados + não aprovados)';
    default:
      return 'Vazio';
  }
}

export interface ArquivoLido {
  nome: string;
  tipo: TipoRelatorio;
  linhas: number;
  orcamentos: number;
  valor: number;
  vendasPlano: number;
}

/**
 * O que a importação consome: a união dos relatórios subidos numa mesma vez.
 * Substitui o `ParseWebdentalResult` de um arquivo só na entrada de
 * `planejarImportacao`.
 */
export interface LeituraCombinada {
  orcamentos: Orcamento[];
  linhasLidas: number;
  ignoradas: LinhaIgnorada[];
  periodo: { de: string | null; ate: string | null };
  avisos: string[];
  vendasPlano: VendaPlano[];
  arquivos: ArquivoLido[];
  /** Recebemos o universo dos NÃO aprovados? Sem isso não existe "sumiço". */
  temNaoAprovados: boolean;
  /** Recebemos o universo dos aprovados? Sem isso não existe aprovação por fato. */
  temAprovados: boolean;
}

/**
 * Junta as leituras dos arquivos subidos e **REATRIBUI ocorrência e chave**
 * sobre a união.
 *
 * 🔴 POR QUE REATRIBUIR, e não só concatenar. A ocorrência é calculada dentro
 * do grupo (mesmo paciente, mesma data, mesmo tratamento). Se cada arquivo
 * calculasse a sua, um paciente com duas limpezas no mesmo dia — uma aprovada,
 * uma não — teria ocorrência 1 nos DOIS arquivos. Com o mesmo valor, isso vira
 * a MESMA chave para dois orçamentos diferentes: um sobrescreveria o outro no
 * banco (a chave é única por organização) e um tratamento sumiria do funil sem
 * ninguém perceber. Calculada sobre a união, a numeração é única por definição.
 */
export function combinarLeituras(leituras: ParseWebdentalResult[]): LeituraCombinada {
  const avisos: string[] = [];
  const ignoradas: LinhaIgnorada[] = [];
  const vendasPlano: VendaPlano[] = [];
  const arquivos: ArquivoLido[] = [];
  const semChave: OrcamentoSemChave[] = [];

  for (const l of leituras) {
    avisos.push(...l.avisos);
    ignoradas.push(...l.ignoradas);
    vendasPlano.push(...l.vendasPlano);
    arquivos.push({
      nome: l.arquivo,
      tipo: l.tipo,
      linhas: l.linhasLidas,
      orcamentos: l.orcamentos.length,
      valor: somarOrcamentos(l.orcamentos),
      vendasPlano: l.vendasPlano.length,
    });
    for (const o of l.orcamentos) {
      const { externalRef: _r, chaveBase: _b, ocorrencia: _o, totalOcorrencias: _t, ...resto } = o;
      semChave.push(resto);
    }
  }

  const orcamentos = atribuirChaves(semChave);
  ordenarParaExibicao(orcamentos);

  // Período = união dos períodos declarados. É a janela dentro da qual a
  // AUSÊNCIA de um orçamento significa alguma coisa.
  const des = leituras.map((l) => l.periodo.de).filter((d): d is string => Boolean(d));
  const ates = leituras.map((l) => l.periodo.ate).filter((d): d is string => Boolean(d));
  const periodo = {
    de: des.length === leituras.length && des.length > 0 ? des.slice().sort()[0] : null,
    ate: ates.length === leituras.length && ates.length > 0 ? ates.slice().sort().pop()! : null,
  };

  const temNaoAprovados = leituras.some((l) => l.tipo === 'nao_aprovados' || l.tipo === 'misto');
  const temAprovados = leituras.some((l) => l.tipo === 'aprovados' || l.tipo === 'misto');

  // Dois arquivos do MESMO filtro: o dono provavelmente subiu o mesmo relatório
  // duas vezes, ou esqueceu de trocar o filtro. Metade do quadro fica faltando.
  const tipos = arquivos.map((a) => a.tipo).filter((t) => t !== 'vazio');
  const repetido = tipos.find((t, i) => tipos.indexOf(t) !== i);
  if (repetido) {
    avisos.push(
      `Dois arquivos com o MESMO filtro ("${rotuloDoTipo(repetido)}"). Confira: o esperado é um ` +
        'relatório "APENAS NÃO APROVADOS" e um "APENAS APROVADOS".',
    );
  }

  // Mesmo tratamento, mesmo dia, mesmo valor, aparecendo nos dois relatórios ao
  // mesmo tempo. Não deveria existir (os filtros são excludentes) e é o único
  // caso em que a numeração de ocorrência fica ambígua — então é relatado.
  const gruposMistos = new Map<string, Set<boolean>>();
  for (const o of orcamentos) {
    const chave = `${grupoDoOrcamento(o)}|${Math.round(o.valor * 100)}`;
    const s = gruposMistos.get(chave) ?? new Set<boolean>();
    s.add(o.aprovado);
    gruposMistos.set(chave, s);
  }
  const ambiguos = [...gruposMistos.values()].filter((s) => s.size > 1).length;
  if (ambiguos > 0) {
    avisos.push(
      `${ambiguos} tratamento(s) idênticos (mesmo paciente, dia e valor) aparecem nos DOIS ` +
        'relatórios ao mesmo tempo — um como aprovado e outro não. Os filtros do WebDental são ' +
        'excludentes, então confira o export. Cada linha virou um orçamento próprio.',
    );
  }

  return {
    orcamentos,
    linhasLidas: leituras.reduce((a, l) => a + l.linhasLidas, 0),
    ignoradas,
    periodo,
    avisos,
    vendasPlano,
    arquivos,
    temNaoAprovados,
    temAprovados,
  };
}

/** Soma dos valores — usada no resumo antes de aplicar. */
export function somarOrcamentos(orcamentos: Orcamento[]): number {
  return Math.round(orcamentos.reduce((acc, o) => acc + o.valor, 0) * 100) / 100;
}

/** Pacientes distintos no arquivo (o nº que o dono conhece do cabeçalho). */
export function contarPacientes(orcamentos: Orcamento[]): number {
  return new Set(orcamentos.map((o) => slug(o.pacienteNome))).size;
}

// ---------------------------------------------------------------------------
// Leitura da chave de identidade já gravada em `deals.external_ref`
// ---------------------------------------------------------------------------

/**
 * Formato atual: `webdental:<paciente>:<data>:<tratamento>:<ocorrência>:<centavos>`
 * (6 partes). O formato ANTERIOR — de quando um orçamento era paciente + data —
 * tinha 3 partes. Distinguir os dois importa: um deal no formato antigo nunca
 * vai casar com uma linha do arquivo novo, e sem esta checagem ele seria dado
 * como "sumiu do relatório = aprovado", virando receita que ninguém aprovou.
 */
export function refWebdentalEhAntigo(ref: string): boolean {
  return ref.startsWith('webdental:') && ref.split(':').length < 6;
}

/** A chave sem o valor — usada para reconhecer o orçamento cujo preço mudou. */
export function chaveBaseDoRef(ref: string): string | null {
  const p = ref.split(':');
  return p.length === 6 ? p.slice(0, 5).join(':') : null;
}

/**
 * A chave sem a ocorrência e sem o valor — `webdental:<paciente>:<data>:<tratamento>`.
 *
 * 🔴 PARA QUE SERVE. A ocorrência é uma POSIÇÃO dentro do grupo, e posição
 * depende do conjunto: no arquivo de não aprovados sozinho, o único
 * "Clínica Geral" do Gustavo em 01/09 é o 1º; na união com o arquivo de
 * aprovados, onde existe outro Clínica Geral dele no mesmo dia, ele vira o 2º.
 * A chave inteira muda sem que nada tenha mudado no mundo real — e o CRM veria
 * um card novo e um sumiço no lugar do mesmo orçamento.
 *
 * Nos arquivos reais de 07/09/2026 isso acontece com 3 orçamentos. Por isso o
 * casamento tem uma passada por GRUPO + VALOR, que ignora a ocorrência: dois
 * exports do mesmo orçamento têm sempre o mesmo paciente, dia, tratamento e
 * preço, mesmo quando a numeração dança.
 */
export function grupoDoRef(ref: string): string | null {
  const p = ref.split(':');
  return p.length === 6 ? p.slice(0, 4).join(':') : null;
}

/** Grupo (sem ocorrência e sem valor) de um orçamento lido do arquivo. */
export function grupoDoOrcamentoLido(o: Orcamento): string {
  return `webdental:${grupoDoOrcamento(o).split('|').join(':')}`;
}

/** Data do orçamento embutida na chave (plano B quando o campo não foi lido). */
export function dataDoRef(ref: string): string | null {
  const p = ref.split(':');
  const bruto = p.length === 6 || p.length === 5 ? p[2] : p.length === 3 ? p[2] : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(bruto) ? bruto : null;
}
