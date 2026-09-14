// ============================================================================
// avaliar-atendimentos
// ----------------------------------------------------------------------------
// Avalia os atendimentos das operadoras. Um ATENDIMENTO = uma operadora, numa
// conversa, num dia (fuso America/Bahia). Grava em
// whatsapp_hub.atendimento_avaliacoes, uma linha por atendimento.
//
// DUAS CAMADAS, DE PROPÓSITO:
//   1. `metricas` — números calculados AQUI, a partir das mensagens: quantas
//      cada um mandou, tempo até responder, paciente esperando no fim do dia.
//      A IA nunca produz esse bloco: tempo de resposta não é opinião.
//   2. avaliação — a IA lê a conversa e julga a qualidade pela régua do
//      BASE-CONHECIMENTO-ODONTO.md. Cada nota vem com um TRECHO literal da
//      conversa; trecho que não existe na conversa é descartado aqui, porque
//      nota sem prova vira achismo e ninguém aceita.
//
// QUEM CHAMA:
//   - pg_cron (service role), sem corpo → avalia o DIA ANTERIOR, todas as orgs.
//   - admin pela tela Qualidade → { dia?, conversation_id?, forcar? } na org dele;
//     sem `dia`, avalia HOJE até agora.
//
// O QUE ESTA FUNÇÃO NUNCA FAZ: não envia mensagem, não altera conversa, deal,
// contato nem mensagem. Só lê e grava a avaliação.
//
// PREFIXO `aval` EM TUDO. O inliner de `api/bootstrap.ts` achata os `_shared/*`
// no MESMO escopo deste arquivo; um homônimo sobrescreveria um helper
// compartilhado sem erro nenhum (MEMORIA.md, armadilha 1).
// ============================================================================

import { getAdminClient } from '../_shared/supabase-admin.ts';
import { loadAppCredentials } from '../_shared/tenant-credentials.ts';
import { callLLM, parseJsonContent, type LLMProvider } from '../_shared/llm.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { requireAdmin, requireServiceRole, AuthError } from '../_shared/auth.ts';

type AvalAdminClient = ReturnType<typeof getAdminClient>;

// Lote por chamada. ~30 atendimentos/dia hoje; o cron roda 3 vezes seguidas,
// então 20 por chamada cobre com folga sem encostar no limite de tempo.
const AVAL_LOTE = 20;
const AVAL_CONCORRENCIA = 3;
// Histórico ANTES do dia avaliado, só para a IA entender a conversa.
const AVAL_CONTEXTO_ANTERIOR = 15;
const AVAL_MAX_CHARS_MSG = 800;
const AVAL_MAX_CHARS_TRANSCRICAO = 14_000;
// Resposta que demorou mais que isso é tratada como fora do expediente (o
// paciente escreveu à noite): não entra na média, só no contador.
const AVAL_JANELA_RESPOSTA_MIN = 12 * 60;
// Violação de regra do CFO derruba a nota geral para no máximo este valor.
// Um atendimento cordial que promete resultado não pode aparecer como 9.
const AVAL_TETO_COM_ALERTA = 5;
// Teto alto de propósito: os modelos Claude 5 gastam parte dele raciocinando
// antes de escrever. Com 1400 o JSON chegava cortado em ~40% das conversas
// (rodada de teste de 14/09). Se ainda assim vier cortado, tenta 1x com o dobro.
const AVAL_MAX_TOKENS = 4000;
const AVAL_TEMPERATURA = 0.2;
const AVAL_FUSO_OFFSET_H = 3; // America/Bahia = UTC-3, sem horário de verão.

const AVAL_CRITERIOS = ['acolhimento', 'entendimento', 'dinheiro', 'conducao', 'clareza'] as const;
type AvalCriterio = (typeof AVAL_CRITERIOS)[number];

const AVAL_REGRAS = [
  'prometeu_resultado',
  'deu_diagnostico',
  'prazo_ou_dor',
  'preco_inventado',
  'comparou_clinica',
  'falou_de_outro_paciente',
  'insistiu_apos_nao',
  'chamou_de_socio',
] as const;

// ---------------------------------------------------------------------------
// RÉGUA — transcrita do BASE-CONHECIMENTO-ODONTO.md. Mora no código, e não em
// configuração editável, pelo mesmo motivo do copiloto: as proibições do CFO
// são trava de conformidade e não podem cair por edição de tela. Se o
// documento mudar, mude aqui junto.
// ---------------------------------------------------------------------------
const AVAL_SYSTEM_PROMPT = `Você é auditor de qualidade de atendimento da Clínica Amor Saúde Itabuna — Odontologia.
Você lê uma conversa de WhatsApp entre a clínica e um paciente e avalia SOMENTE as mensagens marcadas como "ATENDENTE AVALIADA" no dia avaliado.
Mensagens marcadas "(antes)" são só contexto. Mensagens da IA, de modelos automáticos ou de outra atendente NÃO são dela: não credite nem penalize a atendente por elas.

CONTEXTO DA CLÍNICA
- O paciente passou por avaliação presencial, recebeu um plano de tratamento (orçamento) e decide depois.
- Pagamento: boleto em ATÉ 24x, cartão em ATÉ 12x. É um LIMITE: qualquer número de parcelas até ele está dentro da regra (ex.: "6x sem juros" no cartão é permitido). O ideal é falar em parcela mensal.
- A equipe pode ter valor negociado, desconto ou bonificação autorizados pela gestão que você não conhece. Não trate isso como erro.
- Paciente do Cartão de TODOS é "FILIADO". Chamar de "sócio" é erro.

CRITÉRIOS — nota de 0 a 10 cada. Use null quando o critério não teve como aparecer na conversa (ex.: ninguém falou de dinheiro).
1. acolhimento — trata por você, chama pelo primeiro nome, cordial, acolhe antes de vender, nunca constrange o paciente por não ter fechado ou por ter demorado.
2. entendimento — procura entender por que o paciente não fechou; responde a dúvida ANTES de falar de preço; escuta o que foi dito.
3. dinheiro — quando o assunto é valor: apresenta a condição com clareza, de preferência em parcela mensal, e usa o parcelamento para destravar a decisão. Parcelar em MENOS vezes que o limite não é erro e não deve baixar a nota.
4. conducao — leva a conversa para um próximo passo concreto (agendar, aprovar, data combinada). Terminar em "qualquer coisa estou à disposição" sem proposta é fraco. Se o paciente quer remarcar, oferecer data.
5. clareza — frases curtas, linguagem simples, responde exatamente o que foi perguntado, sem termo técnico sem explicação.

REGRAS QUE NUNCA PODEM SER QUEBRADAS (publicidade odontológica / CFO). Cada violação vira um alerta:
- prometeu_resultado: "vai ficar perfeito", "resolve de vez"
- deu_diagnostico: diagnóstico ou prognóstico — quem avalia é o dentista
- prazo_ou_dor: estimou prazo de cura ou garantiu que não dói
- preco_inventado: ofereceu parcelas ACIMA do limite (mais de 24x no boleto ou mais de 12x no cartão). Valor do orçamento, valor negociado, desconto ou bonificação NÃO são este alerta.
- comparou_clinica: comparou com outra clínica
- falou_de_outro_paciente: citou caso de outro paciente
- insistiu_apos_nao: insistiu depois de um "não" claro
- chamou_de_socio: chamou o filiado de "sócio"
Quando a atendente não sabe a resposta, o certo é dizer que vai confirmar com a equipe — isso é BOM, não penalize.

REGRAS DA SUA RESPOSTA
- Todo "trecho" deve ser cópia LITERAL de uma frase da conversa (até 160 caracteres). Se não houver trecho que prove, use null.
- Só aponte alerta com trecho literal da ATENDENTE AVALIADA que prove a violação. Na dúvida, não aponte.
- Seja justo: conversa curta e resolvida pode ter nota alta. Não invente problema.
- pontos_fortes e a_melhorar: no máximo 3 cada, frases curtas e acionáveis, em português do Brasil, falando com a própria atendente.
- justificativa: no máximo 25 palavras.
- resumo: 1 ou 2 frases sobre o atendimento.

Devolva SOMENTE este JSON, sem texto fora dele:
{"criterios":{"acolhimento":{"nota":0,"justificativa":"","trecho":null},"entendimento":{"nota":0,"justificativa":"","trecho":null},"dinheiro":{"nota":null,"justificativa":"","trecho":null},"conducao":{"nota":0,"justificativa":"","trecho":null},"clareza":{"nota":0,"justificativa":"","trecho":null}},"alertas":[{"regra":"","trecho":""}],"pontos_fortes":[""],"a_melhorar":[""],"resumo":""}`;

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface AvalMensagem {
  id: string;
  conversation_id: string;
  direction: 'inbound' | 'outbound';
  sender_type: 'contact' | 'ai' | 'operator' | 'system';
  sender_id: string | null;
  content_type: string;
  content: string | null;
  created_at: string;
}

interface AvalAlvo {
  orgId: string;
  conversationId: string;
  operadorId: string;
}

interface AvalCriterioSaida {
  nota: number | null;
  justificativa: string;
  trecho: string | null;
}

interface AvalSaidaIA {
  criterios?: Partial<Record<AvalCriterio, Partial<AvalCriterioSaida>>>;
  alertas?: Array<{ regra?: string; trecho?: string }>;
  pontos_fortes?: string[];
  a_melhorar?: string[];
  resumo?: string;
}

interface AvalMetricas {
  msgs_atendente: number;
  msgs_paciente: number;
  msgs_outros: number;
  primeira_resposta_min: number | null;
  resposta_mediana_min: number | null;
  respostas_contadas: number;
  respostas_fora_janela: number;
  paciente_esperando_no_fim: boolean;
}

// ---------------------------------------------------------------------------
// Datas no fuso da clínica
// ---------------------------------------------------------------------------

function avalDiaLocal(offsetDias: number): string {
  const agoraLocal = new Date(Date.now() - AVAL_FUSO_OFFSET_H * 3_600_000);
  agoraLocal.setUTCDate(agoraLocal.getUTCDate() + offsetDias);
  return agoraLocal.toISOString().slice(0, 10);
}

function avalJanelaDoDia(dia: string): { inicio: string; fim: string } {
  const inicio = new Date(`${dia}T00:00:00Z`);
  inicio.setUTCHours(inicio.getUTCHours() + AVAL_FUSO_OFFSET_H);
  const fim = new Date(inicio.getTime() + 24 * 3_600_000);
  return { inicio: inicio.toISOString(), fim: fim.toISOString() };
}

function avalHoraLocal(iso: string): string {
  const d = new Date(new Date(iso).getTime() - AVAL_FUSO_OFFSET_H * 3_600_000);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}:${mi}`;
}

// ---------------------------------------------------------------------------
// Métricas objetivas — sem IA
// ---------------------------------------------------------------------------

function avalMetricas(doDia: AvalMensagem[], operadorId: string): AvalMetricas {
  let msgsAtendente = 0;
  let msgsPaciente = 0;
  let msgsOutros = 0;
  const tempos: number[] = [];
  let foraJanela = 0;
  // Paciente escreveu e ninguém respondeu ainda: guarda a PRIMEIRA mensagem
  // dele, porque é dela que o paciente conta a espera.
  let esperandoDesde: number | null = null;

  for (const m of doDia) {
    const t = new Date(m.created_at).getTime();
    if (m.direction === 'inbound') {
      msgsPaciente++;
      if (esperandoDesde === null) esperandoDesde = t;
      continue;
    }
    const daAvaliada = m.sender_type === 'operator' && m.sender_id === operadorId;
    if (daAvaliada) msgsAtendente++;
    else msgsOutros++;

    if (esperandoDesde !== null) {
      // Só conta para a atendente a espera que ELA encerrou. Se a IA ou outra
      // pessoa respondeu primeiro, a espera acabou sem ser mérito nem culpa dela.
      if (daAvaliada) {
        const min = (t - esperandoDesde) / 60_000;
        if (min <= AVAL_JANELA_RESPOSTA_MIN) tempos.push(min);
        else foraJanela++;
      }
      esperandoDesde = null;
    }
  }

  const ordenados = [...tempos].sort((a, b) => a - b);
  const mediana = ordenados.length
    ? ordenados.length % 2
      ? ordenados[(ordenados.length - 1) / 2]
      : (ordenados[ordenados.length / 2 - 1] + ordenados[ordenados.length / 2]) / 2
    : null;
  const arred = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

  return {
    msgs_atendente: msgsAtendente,
    msgs_paciente: msgsPaciente,
    msgs_outros: msgsOutros,
    primeira_resposta_min: arred(tempos[0] ?? null),
    resposta_mediana_min: arred(mediana),
    respostas_contadas: tempos.length,
    respostas_fora_janela: foraJanela,
    paciente_esperando_no_fim: doDia.length > 0 && doDia[doDia.length - 1].direction === 'inbound',
  };
}

// ---------------------------------------------------------------------------
// Transcrição para a IA
// ---------------------------------------------------------------------------

function avalConteudo(m: AvalMensagem): string {
  const texto = (m.content ?? '').trim();
  const base = (() => {
    switch (m.content_type) {
      case 'text':
      case 'template':
        return texto;
      case 'audio':
        return texto ? `[áudio transcrito] ${texto}` : '[áudio sem transcrição]';
      case 'image':
        return texto ? `[imagem] ${texto}` : '[imagem]';
      case 'video':
        return texto ? `[vídeo] ${texto}` : '[vídeo]';
      case 'document':
        return texto ? `[documento] ${texto}` : '[documento]';
      default:
        return texto || `[${m.content_type}]`;
    }
  })();
  return base.length > AVAL_MAX_CHARS_MSG ? `${base.slice(0, AVAL_MAX_CHARS_MSG)}…` : base;
}

function avalQuemFala(m: AvalMensagem, operadorId: string): string {
  if (m.direction === 'inbound') return 'PACIENTE';
  if (m.sender_type === 'operator') {
    return m.sender_id === operadorId ? 'ATENDENTE AVALIADA' : 'OUTRA ATENDENTE';
  }
  if (m.sender_type === 'ai') return 'IA (robô)';
  return 'MODELO AUTOMÁTICO';
}

function avalTranscricao(anteriores: AvalMensagem[], doDia: AvalMensagem[], operadorId: string): string {
  const linhas = [
    ...anteriores.map((m) => `(antes) [${avalHoraLocal(m.created_at)}] ${avalQuemFala(m, operadorId)}: ${avalConteudo(m)}`),
    ...doDia.map((m) => `[${avalHoraLocal(m.created_at)}] ${avalQuemFala(m, operadorId)}: ${avalConteudo(m)}`),
  ];
  // Estourou o tamanho: corta do COMEÇO (contexto antigo) e preserva o dia.
  let total = linhas.reduce((s, l) => s + l.length + 1, 0);
  while (total > AVAL_MAX_CHARS_TRANSCRICAO && linhas.length > doDia.length) {
    total -= linhas.shift()!.length + 1;
  }
  return linhas.join('\n');
}

// ---------------------------------------------------------------------------
// Saneamento da resposta da IA
// ---------------------------------------------------------------------------

function avalNormaliza(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Trecho só vale se estiver MESMO na conversa. A IA às vezes parafraseia e
// apresenta como citação; aqui isso vira null em vez de prova falsa.
function avalTrechoReal(trecho: unknown, textoConversa: string): string | null {
  if (typeof trecho !== 'string') return null;
  const limpo = trecho.trim().replace(/^["“”']+|["“”']+$/g, '');
  if (limpo.length < 3) return null;
  return avalNormaliza(textoConversa).includes(avalNormaliza(limpo)) ? limpo.slice(0, 200) : null;
}

function avalNota(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.min(10, Math.max(0, n)) * 10) / 10;
}

function avalListaCurta(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()).slice(0, 3)
    : [];
}

function avalSaneia(bruto: AvalSaidaIA, textoAtendente: string, textoConversa: string) {
  const criterios = {} as Record<AvalCriterio, AvalCriterioSaida>;
  for (const c of AVAL_CRITERIOS) {
    const item = bruto.criterios?.[c] ?? {};
    criterios[c] = {
      nota: avalNota(item.nota),
      justificativa: typeof item.justificativa === 'string' ? item.justificativa.trim() : '',
      trecho: avalTrechoReal(item.trecho, textoConversa),
    };
  }

  // Alerta sem trecho literal DA ATENDENTE não passa: é acusação sem prova.
  const regrasValidas = new Set<string>(AVAL_REGRAS);
  const alertas = (bruto.alertas ?? [])
    .map((a) => ({ regra: String(a.regra ?? ''), trecho: avalTrechoReal(a.trecho, textoAtendente) }))
    .filter((a): a is { regra: string; trecho: string } => regrasValidas.has(a.regra) && a.trecho !== null);

  const notas = AVAL_CRITERIOS.map((c) => criterios[c].nota).filter((n): n is number => n !== null);
  let notaGeral = notas.length ? Math.round((notas.reduce((s, n) => s + n, 0) / notas.length) * 10) / 10 : null;
  if (notaGeral !== null && alertas.length > 0) notaGeral = Math.min(notaGeral, AVAL_TETO_COM_ALERTA);

  return {
    criterios,
    alertas,
    nota_geral: notaGeral,
    pontos_fortes: avalListaCurta(bruto.pontos_fortes),
    a_melhorar: avalListaCurta(bruto.a_melhorar),
    resumo: typeof bruto.resumo === 'string' ? bruto.resumo.trim() : null,
  };
}

// ---------------------------------------------------------------------------
// Descoberta dos atendimentos do dia
// ---------------------------------------------------------------------------

async function avalAlvosDoDia(
  admin: AvalAdminClient,
  dia: string,
  orgIds: string[],
  conversationId: string | null,
): Promise<AvalAlvo[]> {
  const { inicio, fim } = avalJanelaDoDia(dia);
  const vistos = new Map<string, AvalAlvo>();
  const PAGINA = 1000;
  for (let de = 0; ; de += PAGINA) {
    let q = admin
      .from('messages')
      .select('org_id, conversation_id, sender_id')
      .eq('sender_type', 'operator')
      .eq('is_private_note', false)
      .not('sender_id', 'is', null)
      .in('org_id', orgIds)
      .gte('created_at', inicio)
      .lt('created_at', fim)
      .order('created_at', { ascending: true })
      .range(de, de + PAGINA - 1);
    if (conversationId) q = q.eq('conversation_id', conversationId);
    const { data, error } = await q;
    if (error) throw new Error(`mensagens do dia: ${error.message}`);
    const linhas = (data ?? []) as Array<{ org_id: string; conversation_id: string; sender_id: string }>;
    for (const l of linhas) {
      const chave = `${l.conversation_id}:${l.sender_id}`;
      if (!vistos.has(chave)) {
        vistos.set(chave, { orgId: l.org_id, conversationId: l.conversation_id, operadorId: l.sender_id });
      }
    }
    if (linhas.length < PAGINA) break;
  }
  return [...vistos.values()];
}

// ---------------------------------------------------------------------------
// Avaliação de um atendimento
// ---------------------------------------------------------------------------

type AvalResultado = 'avaliado' | 'insuficiente' | 'erro' | 'em_dia';

async function avalUm(
  admin: AvalAdminClient,
  alvo: AvalAlvo,
  dia: string,
  forcar: boolean,
  credsPorOrg: Map<string, Awaited<ReturnType<typeof loadAppCredentials>>>,
): Promise<AvalResultado> {
  const { inicio, fim } = avalJanelaDoDia(dia);

  const [doDiaRes, antesRes, existenteRes] = await Promise.all([
    admin
      .from('messages')
      .select('id, conversation_id, direction, sender_type, sender_id, content_type, content, created_at')
      .eq('conversation_id', alvo.conversationId)
      .eq('is_private_note', false)
      .gte('created_at', inicio)
      .lt('created_at', fim)
      .order('created_at', { ascending: true })
      .limit(400),
    admin
      .from('messages')
      .select('id, conversation_id, direction, sender_type, sender_id, content_type, content, created_at')
      .eq('conversation_id', alvo.conversationId)
      .eq('is_private_note', false)
      .lt('created_at', inicio)
      .order('created_at', { ascending: false })
      .limit(AVAL_CONTEXTO_ANTERIOR),
    admin
      .from('atendimento_avaliacoes')
      .select('ate_mensagem_at, status')
      .eq('conversation_id', alvo.conversationId)
      .eq('operador_id', alvo.operadorId)
      .eq('dia', dia)
      .maybeSingle(),
  ]);
  if (doDiaRes.error) throw new Error(doDiaRes.error.message);

  const doDia = (doDiaRes.data ?? []) as AvalMensagem[];
  const anteriores = ((antesRes.data ?? []) as AvalMensagem[]).reverse();
  if (doDia.length === 0) return 'em_dia';
  const ultimaAt = doDia[doDia.length - 1].created_at;

  // Já avaliado e a conversa não andou desde então: não gasta IA de novo.
  // Linha em 'erro' sempre tenta outra vez.
  const existente = existenteRes.data as { ate_mensagem_at: string; status: string } | null;
  if (
    !forcar
    && existente
    && existente.status !== 'erro'
    && new Date(existente.ate_mensagem_at).getTime() >= new Date(ultimaAt).getTime()
  ) {
    return 'em_dia';
  }

  const metricas = avalMetricas(doDia, alvo.operadorId);
  const base = {
    org_id: alvo.orgId,
    conversation_id: alvo.conversationId,
    operador_id: alvo.operadorId,
    dia,
    metricas,
    ate_mensagem_at: ultimaAt,
  };

  const grava = async (linha: Record<string, unknown>) => {
    const { error } = await admin
      .from('atendimento_avaliacoes')
      .upsert({ ...base, ...linha }, { onConflict: 'conversation_id,operador_id,dia' });
    if (error) throw new Error(`gravar avaliação: ${error.message}`);
  };

  // Conversa curta demais para julgar com justiça: "bom dia" e "obrigada".
  // Guarda os números, não chama a IA e não dá nota.
  if (metricas.msgs_atendente < 2 && metricas.msgs_paciente < 2) {
    await grava({
      status: 'insuficiente', nota_geral: null, criterios: {}, alertas: [],
      pontos_fortes: [], a_melhorar: [], resumo: null, modelo: null, erro: null,
    });
    return 'insuficiente';
  }

  let creds = credsPorOrg.get(alvo.orgId);
  if (!creds) {
    creds = await loadAppCredentials(alvo.orgId);
    credsPorOrg.set(alvo.orgId, creds);
  }
  if (!creds.llm_api_key) {
    await grava({ status: 'erro', erro: 'Chave da IA não configurada (Ajustes → Atendente IA).' });
    return 'erro';
  }

  // Contexto do caso: nome do paciente e orçamento ativo. Ajuda a IA a saber do
  // que se trata; não é avaliado.
  const { data: conv } = await admin
    .from('conversations')
    .select('contact_id, active_deal_id')
    .eq('id', alvo.conversationId)
    .maybeSingle();
  const convRow = conv as { contact_id: string; active_deal_id: string | null } | null;
  let casoTexto = '';
  if (convRow) {
    const [{ data: contato }, { data: deal }] = await Promise.all([
      admin.from('contacts').select('name').eq('id', convRow.contact_id).maybeSingle(),
      convRow.active_deal_id
        ? admin.from('deals').select('title, value, stage:stages(name)').eq('id', convRow.active_deal_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const nome = (contato as { name: string | null } | null)?.name;
    const d = deal as { title: string | null; value: number | null; stage: { name: string } | null } | null;
    casoTexto = [
      nome ? `Paciente: ${nome}` : null,
      d?.title ? `Orçamento ativo: ${d.title}${d.value ? ` — R$ ${Number(d.value).toFixed(2)}` : ''}` : null,
      d?.stage?.name ? `Etapa do orçamento: ${d.stage.name}` : null,
    ].filter(Boolean).join('\n');
  }

  const transcricao = avalTranscricao(anteriores, doDia, alvo.operadorId);
  const textoAtendente = doDia
    .filter((m) => m.sender_type === 'operator' && m.sender_id === alvo.operadorId)
    .map((m) => m.content ?? '')
    .join('\n');

  const userPrompt = [
    `DIA AVALIADO: ${dia.split('-').reverse().join('/')}`,
    casoTexto ? `\nCASO:\n${casoTexto}` : '',
    `\nCONVERSA (cronológica):\n${transcricao}`,
    '\nDevolva SOMENTE o JSON pedido.',
  ].join('\n');

  try {
    const pedir = (maxTokens: number) => callLLM({
      provider: creds!.llm_provider as LLMProvider,
      apiKey: creds!.llm_api_key!,
      systemPrompt: AVAL_SYSTEM_PROMPT,
      userPrompt,
      json: true,
      maxTokens,
      temperature: AVAL_TEMPERATURA,
    });
    let out = await pedir(AVAL_MAX_TOKENS);
    let bruto: AvalSaidaIA;
    try {
      bruto = parseJsonContent<AvalSaidaIA>(out.content);
    } catch {
      // JSON cortado ou vazio: quase sempre é o teto de tokens. Uma nova chance.
      out = await pedir(AVAL_MAX_TOKENS * 2);
      bruto = parseJsonContent<AvalSaidaIA>(out.content);
    }
    const saneado = avalSaneia(bruto, textoAtendente, transcricao);
    await grava({ status: 'avaliado', ...saneado, modelo: out.model, erro: null });
    return 'avaliado';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({
      event: 'aval_llm_failed',
      conversation_id: alvo.conversationId,
      operador_id: alvo.operadorId,
      dia,
      error: msg.slice(0, 300),
    }));
    await grava({ status: 'erro', erro: 'A IA não respondeu. A próxima rodada tenta de novo.' });
    return 'erro';
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const admin = getAdminClient();
  let body: { dia?: unknown; conversation_id?: unknown; forcar?: unknown } = {};
  try {
    const texto = await req.text();
    body = texto ? JSON.parse(texto) : {};
  } catch {
    return jsonResponse({ ok: false, error: 'JSON inválido.' }, { status: 400 });
  }

  // Quem chamou: cron (service role) ou admin pela tela.
  let orgIds: string[];
  let porCron = false;
  try {
    await requireServiceRole(req);
    porCron = true;
    const { data: orgs, error } = await admin.from('organizations').select('id').eq('status', 'active');
    if (error) throw new Error(error.message);
    orgIds = ((orgs ?? []) as Array<{ id: string }>).map((o) => o.id);
  } catch (errServico) {
    if (errServico instanceof Error && !(errServico instanceof AuthError)) {
      return jsonResponse({ ok: false, error: errServico.message }, { status: 500 });
    }
    try {
      const caller = await requireAdmin(req);
      orgIds = [caller.orgId];
    } catch (err) {
      if (err instanceof AuthError) {
        return jsonResponse({ ok: false, error: 'Só administradores podem pedir avaliação.' }, { status: err.status });
      }
      throw err;
    }
  }
  if (orgIds.length === 0) return jsonResponse({ ok: true, data: { dia: null, avaliados: 0 } });

  const diaPedido = typeof body.dia === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.dia) ? body.dia : null;
  // Cron avalia o dia de ontem, inteiro. Pela tela, o padrão é hoje até agora.
  const dia = diaPedido ?? (porCron ? avalDiaLocal(-1) : avalDiaLocal(0));
  const conversationId = typeof body.conversation_id === 'string' && body.conversation_id ? body.conversation_id : null;
  const forcar = body.forcar === true;

  try {
    const alvos = await avalAlvosDoDia(admin, dia, orgIds, conversationId);
    const credsPorOrg = new Map<string, Awaited<ReturnType<typeof loadAppCredentials>>>();
    const contagem: Record<AvalResultado, number> = { avaliado: 0, insuficiente: 0, erro: 0, em_dia: 0 };

    // Processa até AVAL_LOTE avaliações que precisam de trabalho. Os que já
    // estão em dia saem baratos (só leitura) e não consomem o lote.
    let trabalhados = 0;
    let indice = 0;
    const proximo = async (): Promise<void> => {
      while (indice < alvos.length && trabalhados < AVAL_LOTE) {
        const alvo = alvos[indice++];
        // Uma conversa com problema não pode derrubar a rodada das outras.
        let r: AvalResultado;
        try {
          r = await avalUm(admin, alvo, dia, forcar, credsPorOrg);
        } catch (err) {
          r = 'erro';
          console.log(JSON.stringify({
            event: 'aval_atendimento_falhou',
            conversation_id: alvo.conversationId,
            operador_id: alvo.operadorId,
            dia,
            error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
          }));
        }
        contagem[r]++;
        if (r !== 'em_dia') trabalhados++;
      }
    };
    await Promise.all(Array.from({ length: AVAL_CONCORRENCIA }, () => proximo()));

    const restantes = Math.max(0, alvos.length - indice);
    console.log(JSON.stringify({ event: 'aval_rodada', dia, por_cron: porCron, alvos: alvos.length, ...contagem, restantes }));
    return jsonResponse({
      ok: true,
      data: { dia, atendimentos: alvos.length, ...contagem, restantes },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ event: 'aval_falhou', dia, error: msg }));
    return jsonResponse({ ok: false, error: msg }, { status: 500 });
  }
});
