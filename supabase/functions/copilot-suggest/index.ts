// ============================================================================
// copilot-suggest
// ----------------------------------------------------------------------------
// COPILOTO da atendente — não é a IA que fala com o paciente.
//
// Chamada pela tela de Conversas quando a atendente abre uma conversa. Devolve
// três blocos, na ordem em que a tela os mostra:
//
//   1. contexto  — FATOS, montados AQUI a partir do banco. A LLM nunca escreve
//                  este bloco. Procedimento, valor, data, dias parado, filiado
//                  ou particular, dentista, template enviado, botão tocado.
//   2. leitura   — uma ou duas frases da LLM: o que trava, qual a alavanca,
//                  o que evitar.
//   3. sugestao  — texto pronto para a atendente usar, editar ou descartar.
//
// POR QUE O `contexto` NÃO PASSA PELA LLM. Se o modelo redigisse os fatos, um
// valor ou uma data errada apareceriam com a mesma cara de verdade que os
// certos, e a atendente repassaria isso ao paciente. Os fatos vêm do SELECT; a
// LLM só recebe o bloco pronto e opina em cima dele.
//
// O QUE ESTA FUNÇÃO NUNCA FAZ:
//   - não grava em `messages` (sugestão não é mensagem);
//   - não envia nada para a Meta / para o paciente;
//   - não altera deal, etapa, conversa ou contato.
// Ela é somente leitura, exceto pelo cache em memória.
//
// PREFIXO `copilot*` EM TUDO. O inliner de `api/bootstrap.ts` achata os
// `_shared/*` no MESMO escopo deste arquivo; um homônimo sobrescreveria o
// helper compartilhado sem erro nenhum. Ver MEMORIA.md, armadilha 1.
// ============================================================================

import { getAdminClient } from '../_shared/supabase-admin.ts';
import { loadAppCredentials } from '../_shared/tenant-credentials.ts';
import { callLLM, type LLMProvider } from '../_shared/llm.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { requireOrgCaller, AuthError } from '../_shared/auth.ts';

const COPILOT_EMBED_MODEL = 'text-embedding-3-small';
const COPILOT_TOP_K = 5;
const COPILOT_HISTORY_LIMIT = 25;
const COPILOT_CACHE_TTL_MS = 60_000;
// Teto de saída: leitura curta + sugestão de WhatsApp. Acima disso o modelo
// começa a escrever textão, que é justamente o que a atendente não vai usar.
const COPILOT_MAX_TOKENS = 700;
// Temperatura baixa: o copiloto não deve ser criativo com regra de clínica.
const COPILOT_TEMPERATURE = 0.3;

// ---------------------------------------------------------------------------
// PROMPT DO COPILOTO — mora aqui, no código, e não em `ai_agent_config`.
//
// Três razões, registradas no MEMORIA.md:
//
// 1. `whatsapp_hub.ai_agent_config` é um singleton POR ORG e já está ocupado
//    pelo agente que responde o PACIENTE (hoje `is_active = true`). Dividir a
//    mesma coluna faria um sobrescrever o outro; uma coluna nova exigiria
//    migração, que esta frente não aplica sem decisão do dono.
// 2. Este texto não é preferência de uso: é a trava de conformidade da seção 7
//    do BASE-CONHECIMENTO-ODONTO.md (CFO). Editável por qualquer admin na tela,
//    as proibições cairiam sem revisão de ninguém.
// 3. O prompt tem contrato com o código: ele PRECISA devolver
//    `{"leitura","sugestao"}` para a tela funcionar. Prompt e parser mudam
//    juntos, no mesmo commit — isso é código, não configuração.
//
// Os FATOS da clínica (preço, horário, objeção, o que explicar de cada
// procedimento) NÃO entram aqui: vêm da base de conhecimento pelo RAG e dos
// dados do orçamento. Assim o dono muda o conteúdo sem deploy, e a regra de
// segurança continua versionada.
// ---------------------------------------------------------------------------
const COPILOT_SYSTEM_PROMPT = `Você é um COPILOTO de atendimento da Amor Saúde Odontologia, em Itabuna (BA).

Você NÃO conversa com o paciente. Você escreve para a ATENDENTE da clínica. Ela lê o que você sugeriu, edita se quiser e decide se envia. Nada do que você escreve sai sozinho.

O caso chega pronto: os fatos do orçamento já foram apurados no sistema e estão no bloco "CONTEXTO DO CASO". Você não precisa (nem deve) recalcular ou reescrever esses fatos.

## O que você devolve

SOMENTE um objeto JSON válido, sem texto fora dele, com exatamente duas chaves:

{"leitura": "...", "sugestao": "..."}

- "leitura": UMA OU DUAS FRASES para a atendente, nunca para o paciente. Diga o que está travando (dinheiro, dúvida ou agenda), qual é a alavanca, e o que evitar. Exemplo do tom: "Ela tocou em parcelamento — o caminho é falar em parcela mensal, não no valor cheio. Não repita os R$ 1.458."
- "sugestao": a mensagem pronta para o paciente, em português do Brasil, de 2 a 4 frases curtas, como se fosse digitada no WhatsApp. Sem saudação protocolar longa, sem assinatura, sem emoji em excesso (no máximo um). Chame a pessoa pelo primeiro nome quando ele estiver no contexto.

Se o contexto for pobre demais para uma leitura honesta (sem orçamento, sem histórico), diga isso na "leitura" e faça da "sugestao" uma retomada simples e acolhedora, sem inventar detalhe de caso.

## PROIBIDO — sem exceção

- Prometer resultado ("vai ficar perfeito", "resolve de vez").
- Dar diagnóstico, prognóstico ou opinião clínica. Quem avalia é o dentista.
- Estimar prazo de cura, tempo de recuperação, ou garantir ausência de dor.
- Inventar preço, desconto, prazo, parcela ou condição que não esteja no contexto ou na base de conhecimento. Se não estiver escrito, não existe.
- Comparar a clínica com outra, citar concorrente ou falar de preço de terceiro.
- Mencionar caso, nome ou tratamento de outro paciente.
- Insistir depois de um "não" claro. Aceite, agradeça e deixe a porta aberta.
- Cobrar o paciente pela demora ou constrangê-lo por não ter fechado.
- Escrever qualquer coisa como se você fosse enviar a mensagem. Quem envia é a atendente.

## OBRIGATÓRIO

- Dinheiro se fala em PARCELA MENSAL, nunca no valor cheio. Diga "fica em torno de R$ 61 por mês", não "são R$ 1.458". O contexto já traz a parcela estimada.
- A parcela do contexto é ESTIMATIVA por divisão simples. Trate como ordem de grandeza ("em torno de", "por volta de"). Nunca feche condição, nunca prometa 24x como certo — o número de parcelas depende do valor e quem confirma é a equipe.
- O paciente do Cartão de TODOS é FILIADO. Nunca "sócio", nunca "associado", nunca "cliente do plano".
- Quando o paciente demonstrar DÚVIDA, responda a dúvida ANTES de falar de preço.
- Quando o assunto for AGENDA, ofereça remarcar e não repita o orçamento.
- Quando não souber, diga que vai confirmar com a equipe e retornar. NUNCA preencha o vazio com suposição — nem sobre valor, nem sobre prazo, nem sobre o que o tratamento inclui.

## Tom

Português do Brasil, simples, sem termo técnico sem explicação. Trata por "você". Frases curtas: a pessoa lê no celular, muitas vezes trabalhando. Acolhe antes de vender — quem não fechou tem um motivo, e entender vem antes de insistir.`;

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface CopilotMessageRow {
  id: string;
  direction: 'inbound' | 'outbound';
  sender_type: 'contact' | 'ai' | 'operator' | 'system';
  content_type: string;
  content: string | null;
  is_private_note: boolean;
  created_at: string;
}

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
  /** 'filiado' quando a tabela é a do Cartão de TODOS. Nunca "sócio". */
  vinculo: 'filiado' | 'particular' | 'indefinido';
  procedimentos: string[];
  /** Estimativa por divisão simples — NÃO é condição fechada. */
  parcela_24x: number | null;
  parcela_12x: number | null;
}

interface CopilotContexto {
  contato_nome: string | null;
  contato_primeiro_nome: string | null;
  telefone: string | null;
  orcamentos: CopilotOrcamento[];
  /** Um paciente pode ter mais de um orçamento aberto — decisão do dono. */
  total_orcamentos_abertos: number;
  ultimo_template_enviado: { nome: string | null; quando: string } | null;
  botao_tocado: { texto: string; quando: string; confianca: 'confirmado' | 'provavel' } | null;
  ultima_mensagem_paciente: { texto: string | null; quando: string } | null;
  horas_sem_resposta: number | null;
  janela_24h_aberta: boolean;
  total_mensagens: number;
}

interface CopilotResposta {
  contexto: CopilotContexto;
  leitura: string | null;
  sugestao: string | null;
  /** Avisos honestos para a tela — o que faltou para a sugestão sair melhor. */
  avisos: string[];
  origem: 'llm' | 'cache' | 'somente_contexto';
}

// ---------------------------------------------------------------------------
// Cache em memória — 60s por conversa.
//
// A chave inclui o id da ÚLTIMA mensagem: mensagem nova invalida na hora, sem
// esperar o TTL. Sem isso a atendente leria uma sugestão anterior à mensagem
// que acabou de chegar, que é pior do que não ter sugestão.
//
// É best-effort: cada instância da função tem o seu Map e instâncias morrem.
// Serve para o re-render da tela, não como garantia de custo.
// ---------------------------------------------------------------------------
const copilotCache = new Map<string, { expiresAt: number; leitura: string; sugestao: string }>();

function copilotCacheGet(key: string): { leitura: string; sugestao: string } | null {
  const hit = copilotCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    copilotCache.delete(key);
    return null;
  }
  return { leitura: hit.leitura, sugestao: hit.sugestao };
}

function copilotCacheSet(key: string, leitura: string, sugestao: string): void {
  // Poda preguiçosa: sem isso o Map cresce enquanto a instância viver.
  if (copilotCache.size > 200) {
    const now = Date.now();
    for (const [k, v] of copilotCache) if (v.expiresAt < now) copilotCache.delete(k);
  }
  copilotCache.set(key, { expiresAt: Date.now() + COPILOT_CACHE_TTL_MS, leitura, sugestao });
}

// ---------------------------------------------------------------------------
// Helpers de leitura
// ---------------------------------------------------------------------------

/**
 * Sem acento e em minúsculas — para comparar "Cartão de Todos" com
 * "cartao de todos".
 *
 * Usa `\p{Diacritic}` em vez da faixa U+0300–U+036F escrita à mão: a faixa
 * exigiria escapes de barra invertida no código-fonte, e barra invertida não
 * sobrevive igual ao passar pelo JSON do deploy — o arquivo publicado saía
 * com bytes diferentes do bundle local e a conferência por sha256 acusava.
 */
function copilotNormalize(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

function copilotFirstName(name: string | null | undefined): string | null {
  const first = (name ?? '').trim().split(/\s+/)[0];
  return first || null;
}

/** Dias inteiros desde o carimbo. Espelha `src/lib/diasParado.ts` (apresentação). */
function copilotDiasParado(stageEnteredAt: string | null): number | null {
  if (!stageEnteredAt) return null;
  const t = new Date(stageEnteredAt).getTime();
  if (Number.isNaN(t)) return null;
  const dias = Math.floor((Date.now() - t) / 86_400_000);
  return dias < 0 ? 0 : dias;
}

/**
 * Parcela estimada por DIVISÃO SIMPLES. Não é condição comercial: o mínimo por
 * parcela e a exigência de entrada não estão definidos na base (marcados 🟡 no
 * BASE-CONHECIMENTO-ODONTO.md). O prompt obriga a tratar como ordem de
 * grandeza e a mandar confirmar com a equipe.
 */
function copilotParcela(valor: number | null, vezes: number): number | null {
  if (valor === null || !Number.isFinite(valor) || valor <= 0) return null;
  return Math.round((valor / vezes) * 100) / 100;
}

function copilotVinculo(tabela: string | null): CopilotOrcamento['vinculo'] {
  if (!tabela) return 'indefinido';
  const t = copilotNormalize(tabela);
  if (t.includes('cartao de todos') || t.includes('cartao todos')) return 'filiado';
  return 'particular';
}

function copilotBrl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ---------------------------------------------------------------------------
// Embedding + RAG. Ambos OPCIONAIS: sem chave ou sem base carregada, o copiloto
// segue trabalhando só com os dados do orçamento e do histórico.
// ---------------------------------------------------------------------------
async function copilotEmbed(openaiKey: string, text: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: COPILOT_EMBED_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return body?.data?.[0]?.embedding ?? [];
}

/** Tolerante ao formato: aceita ```json ... ``` e prosa em volta do objeto. */
function copilotParseJson(raw: string): { leitura?: unknown; sugestao?: unknown } | null {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as { leitura?: unknown; sugestao?: unknown };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Texto do contexto para a LLM. É o MESMO bloco que a tela mostra, escrito em
// prosa — assim o que a atendente lê e o que o modelo leu não divergem.
// ---------------------------------------------------------------------------
function copilotContextoTexto(ctx: CopilotContexto): string {
  const linhas: string[] = [];
  linhas.push(`Paciente: ${ctx.contato_nome ?? 'sem nome cadastrado'}`);

  if (ctx.orcamentos.length === 0) {
    linhas.push('Orçamentos abertos: NENHUM registrado no CRM para este paciente.');
  } else {
    linhas.push(`Orçamentos abertos: ${ctx.orcamentos.length}`);
    for (const o of ctx.orcamentos) {
      const partes: string[] = [];
      partes.push(`- ${o.tratamento ?? o.titulo}`);
      if (o.especialidade) partes.push(`especialidade ${o.especialidade}`);
      if (o.valor !== null) partes.push(`valor total ${copilotBrl(o.valor)}`);
      if (o.parcela_24x !== null) {
        partes.push(
          `parcela estimada em torno de ${copilotBrl(o.parcela_24x)}/mês em 24x no boleto ou ${copilotBrl(o.parcela_12x ?? 0)}/mês em 12x no cartão (ESTIMATIVA por divisão simples, confirmar com a equipe)`,
        );
      }
      if (o.dt_orcamento) partes.push(`orçamento de ${o.dt_orcamento}`);
      if (o.dias_parado !== null) partes.push(`parado há ${o.dias_parado} dia(s)`);
      if (o.etapa) partes.push(`etapa "${o.etapa}"`);
      if (o.dentista) partes.push(`dentista ${o.dentista}`);
      partes.push(
        o.vinculo === 'filiado'
          ? 'é FILIADO do Cartão de TODOS (o valor já contempla a condição de filiado)'
          : o.vinculo === 'particular'
            ? 'é PARTICULAR (tabela cheia)'
            : 'vínculo não identificado (não afirme se é filiado ou particular)',
      );
      linhas.push(partes.join(' · '));
    }
  }

  if (ctx.ultimo_template_enviado) {
    linhas.push(
      `Último modelo enviado pela clínica: ${ctx.ultimo_template_enviado.nome ?? 'modelo aprovado'} em ${ctx.ultimo_template_enviado.quando}.`,
    );
  }
  if (ctx.botao_tocado) {
    linhas.push(
      `O paciente tocou no botão "${ctx.botao_tocado.texto}"${ctx.botao_tocado.confianca === 'provavel' ? ' (provável — o sistema não distingue botão de texto digitado)' : ''}.`,
    );
  }
  if (ctx.horas_sem_resposta !== null) {
    linhas.push(`Última manifestação do paciente há ${ctx.horas_sem_resposta} hora(s).`);
  }
  linhas.push(
    ctx.janela_24h_aberta
      ? 'Janela de 24h ABERTA: a atendente pode responder com texto livre.'
      : 'Janela de 24h FECHADA: só é possível reiniciar com modelo aprovado. A sugestão precisa caber nisso, ou a atendente vai ter que usar um modelo.',
  );
  return linhas.join('\n');
}

function copilotHistoricoTexto(history: CopilotMessageRow[]): string {
  const linhas = history
    .filter((m) => m.content && m.content.trim())
    .map((m) => {
      if (m.is_private_note) return `[Nota interna da equipe] ${m.content}`;
      const quem =
        m.sender_type === 'contact'
          ? 'Paciente'
          : m.sender_type === 'ai'
            ? 'Atendimento automático'
            : m.sender_type === 'operator'
              ? 'Atendente'
              : 'Sistema';
      const tipo = m.content_type === 'template' ? ' (modelo)' : '';
      return `[${quem}${tipo}] ${m.content}`;
    });
  return linhas.length ? linhas.join('\n') : '(sem mensagens registradas)';
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  // Só usuário logado da organização. Edge Function roda com service_role e
  // ignora RLS, então o org_id da conversa é conferido contra o do caller.
  let caller;
  try {
    caller = await requireOrgCaller(req);
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 401;
    return jsonResponse({ ok: false, error: 'Não autorizado.' }, { status });
  }

  let body: { conversation_id?: string; apenas_contexto?: boolean };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: 'JSON inválido.' }, { status: 400 });
  }
  const conversationId = (body.conversation_id ?? '').trim();
  if (!conversationId) {
    return jsonResponse({ ok: false, error: 'conversation_id ausente.' }, { status: 400 });
  }
  const apenasContexto = body.apenas_contexto === true;

  const admin = getAdminClient();
  const avisos: string[] = [];

  // 1. Conversa (+ trava de organização).
  const { data: convRow } = await admin
    .from('conversations')
    .select('id, org_id, contact_id, status, active_deal_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (!convRow) {
    return jsonResponse({ ok: false, error: 'Conversa não encontrada.' }, { status: 404 });
  }
  const conversation = convRow as {
    id: string; org_id: string; contact_id: string; status: string; active_deal_id: string | null;
  };
  if (conversation.org_id !== caller.orgId && !caller.isSuperAdmin) {
    return jsonResponse({ ok: false, error: 'Conversa de outra organização.' }, { status: 403 });
  }
  const orgId = conversation.org_id;

  // 2. Contato.
  const { data: contactRow } = await admin
    .from('contacts')
    .select('id, name, phone')
    .eq('id', conversation.contact_id)
    .maybeSingle();
  const contact = (contactRow as { name: string | null; phone: string | null } | null) ?? null;

  // 3. Histórico recente (mais novas primeiro; invertido logo abaixo).
  const { data: historyRows } = await admin
    .from('messages')
    .select('id, direction, sender_type, content_type, content, is_private_note, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(COPILOT_HISTORY_LIMIT);
  const historyDesc = (historyRows ?? []) as CopilotMessageRow[];
  const history = [...historyDesc].reverse();

  // 4. Orçamentos ABERTOS do contato. Um paciente pode ter vários — decisão do
  //    dono registrada no MEMORIA.md: um orçamento por tratamento.
  const { data: dealRows } = await admin
    .from('deals')
    .select('id, title, value, stage_id, stage_entered_at, stages:stage_id(name), deal_products(value, quantity, products:product_id(name))')
    .eq('org_id', orgId)
    .eq('contact_id', conversation.contact_id)
    .eq('status', 'open')
    .is('archived_at', null)
    .order('stage_entered_at', { ascending: true });
  const deals = (dealRows ?? []) as Array<{
    id: string;
    title: string;
    value: number | string | null;
    stage_id: string | null;
    stage_entered_at: string | null;
    stages: { name?: string } | null;
    deal_products: Array<{ products: { name?: string } | null }> | null;
  }>;

  // 5. Campos personalizados dos orçamentos (tratamento, dentista, tabela…).
  //    Uma consulta só para todos os deals — não uma por card.
  const camposPorDeal = new Map<string, Record<string, string>>();
  if (deals.length > 0) {
    const { data: cfvRows } = await admin
      .from('custom_field_values')
      .select('deal_id, value, custom_fields:custom_field_id(key)')
      .eq('org_id', orgId)
      .in('deal_id', deals.map((d) => d.id));
    for (const row of (cfvRows ?? []) as Array<{
      deal_id: string; value: string | null; custom_fields: { key?: string } | null;
    }>) {
      const key = row.custom_fields?.key;
      if (!key || !row.value) continue;
      const bucket = camposPorDeal.get(row.deal_id) ?? {};
      bucket[key] = row.value;
      camposPorDeal.set(row.deal_id, bucket);
    }
  }

  const orcamentos: CopilotOrcamento[] = deals.map((d) => {
    const campos = camposPorDeal.get(d.id) ?? {};
    const valor = d.value === null ? null : Number(d.value);
    const valorOk = valor !== null && Number.isFinite(valor) ? valor : null;
    const tabela = campos.tabela_preco ?? null;
    return {
      deal_id: d.id,
      titulo: d.title,
      valor: valorOk,
      etapa: d.stages?.name ?? null,
      dias_parado: copilotDiasParado(d.stage_entered_at),
      dt_orcamento: campos.dt_orcamento ?? null,
      tratamento: campos.tratamento ?? null,
      especialidade: campos.especialidade ?? null,
      dentista: campos.dentista ?? null,
      tabela_preco: tabela,
      vinculo: copilotVinculo(tabela),
      procedimentos: (d.deal_products ?? [])
        .map((dp) => dp.products?.name)
        .filter((n): n is string => Boolean(n)),
      parcela_24x: copilotParcela(valorOk, 24),
      parcela_12x: copilotParcela(valorOk, 12),
    };
  });

  if (orcamentos.length === 0) {
    avisos.push('Nenhum orçamento aberto no CRM para este paciente — a sugestão sai sem contexto de caso.');
  }
  if (orcamentos.some((o) => o.vinculo === 'indefinido')) {
    avisos.push('Tabela de preço não preenchida em ao menos um orçamento: não dá para afirmar se é filiado ou particular.');
  }

  // 6. Último modelo (template) enviado pela clínica nesta conversa.
  const ultimoTemplate = historyDesc.find(
    (m) => m.direction === 'outbound' && m.content_type === 'template',
  );

  // 7. Botão tocado pelo paciente.
  //
  //    ⚠️ LIMITE REAL: o `meta-webhook` achata resposta de botão (`button` /
  //    `interactive`) em mensagem de TEXTO comum — o título do botão vira o
  //    `content` e nada marca a linha como "veio de botão". Ver decodeInbound
  //    em supabase/functions/meta-webhook/index.ts. Então aqui só dá para
  //    INFERIR: se o texto do paciente bate com o rótulo de um botão de algum
  //    modelo cadastrado, é quase certo que ele tocou. A confiança vai marcada
  //    e o prompt sabe que pode ser inferência.
  const ultimaInbound = historyDesc.find((m) => m.direction === 'inbound');
  let botaoTocado: CopilotContexto['botao_tocado'] = null;
  if (ultimaInbound?.content) {
    const alvo = copilotNormalize(ultimaInbound.content);
    // Botão de WhatsApp tem no máximo 20 caracteres — texto longo nem tenta.
    if (alvo.length > 0 && alvo.length <= 40) {
      const { data: tplRows } = await admin
        .from('templates')
        .select('name, buttons')
        .eq('org_id', orgId);
      for (const tpl of (tplRows ?? []) as Array<{ name: string; buttons: unknown }>) {
        const botoes = Array.isArray(tpl.buttons) ? tpl.buttons : [];
        for (const b of botoes) {
          const rotulo =
            typeof b === 'string'
              ? b
              : ((b as { text?: string; title?: string } | null)?.text ??
                 (b as { text?: string; title?: string } | null)?.title ?? '');
          if (rotulo && copilotNormalize(rotulo) === alvo) {
            botaoTocado = {
              texto: rotulo,
              quando: ultimaInbound.created_at,
              confianca: 'provavel',
            };
            break;
          }
        }
        if (botaoTocado) break;
      }
    }
  }
  if (!botaoTocado && ultimaInbound) {
    avisos.push('O sistema ainda não distingue resposta de botão de texto digitado (limite do webhook — pendência registrada).');
  }

  const horasSemResposta = ultimaInbound
    ? Math.floor((Date.now() - new Date(ultimaInbound.created_at).getTime()) / 3_600_000)
    : null;

  const contexto: CopilotContexto = {
    contato_nome: contact?.name ?? null,
    contato_primeiro_nome: copilotFirstName(contact?.name),
    telefone: contact?.phone ?? null,
    orcamentos,
    total_orcamentos_abertos: orcamentos.length,
    ultimo_template_enviado: ultimoTemplate
      ? { nome: ultimoTemplate.content, quando: ultimoTemplate.created_at }
      : null,
    botao_tocado: botaoTocado,
    ultima_mensagem_paciente: ultimaInbound
      ? { texto: ultimaInbound.content, quando: ultimaInbound.created_at }
      : null,
    horas_sem_resposta: horasSemResposta,
    janela_24h_aberta: horasSemResposta !== null && horasSemResposta < 24,
    total_mensagens: history.length,
  };

  // Modo barato: a tela pede só os fatos ao abrir a conversa. Zero LLM.
  if (apenasContexto) {
    const semLlm: CopilotResposta = {
      contexto, leitura: null, sugestao: null, avisos, origem: 'somente_contexto',
    };
    return jsonResponse({ ok: true, data: semLlm });
  }

  // 8. Cache: chave por conversa + última mensagem. Mensagem nova invalida.
  const cacheKey = `${conversationId}:${historyDesc[0]?.id ?? 'vazio'}`;
  const cached = copilotCacheGet(cacheKey);
  if (cached) {
    const doCache: CopilotResposta = {
      contexto, leitura: cached.leitura, sugestao: cached.sugestao, avisos, origem: 'cache',
    };
    return jsonResponse({ ok: true, data: doCache });
  }

  // 9. Credenciais da org.
  const creds = await loadAppCredentials(orgId);
  const provider: LLMProvider = creds.llm_provider;
  const llmKey = creds.llm_api_key;
  if (!llmKey) {
    return jsonResponse(
      {
        ok: false,
        error: 'Chave da IA não configurada. Cadastre em Ajustes → Atendente IA.',
        data: { contexto, leitura: null, sugestao: null, avisos, origem: 'somente_contexto' },
      },
      { status: 400 },
    );
  }

  // 10. RAG — opcional. Base vazia ou sem chave de embedding não impede nada.
  let ragChunks: string[] = [];
  if (creds.openai_api_key) {
    try {
      const consulta = [
        ultimaInbound?.content ?? '',
        orcamentos.map((o) => `${o.tratamento ?? ''} ${o.especialidade ?? ''}`).join(' '),
      ].join(' ').trim();
      if (consulta) {
        const emb = await copilotEmbed(creds.openai_api_key, consulta);
        const { data: ragRows } = await admin.rpc('knowledge_search', {
          p_query_embedding: emb,
          p_top_k: COPILOT_TOP_K,
          p_org_id: orgId,
        });
        ragChunks = ((ragRows ?? []) as Array<{ content: string }>).map((r) => r.content);
      }
    } catch (err) {
      // RAG é acessório: falhou, segue sem ele e avisa a tela.
      console.log(JSON.stringify({
        event: 'copilot_rag_failed',
        conversation_id: conversationId,
        error: err instanceof Error ? err.message : String(err),
      }));
      avisos.push('Não foi possível consultar a base de conhecimento agora.');
    }
  }
  if (ragChunks.length === 0) {
    avisos.push('Base de conhecimento sem conteúdo para este caso — a sugestão se apoia só no orçamento e no histórico.');
  }

  // 11. Chamada da LLM.
  const userPrompt = [
    `CONTEXTO DO CASO (fatos apurados no sistema — não reescreva, não recalcule):\n${copilotContextoTexto(contexto)}`,
    ragChunks.length
      ? `\nBASE DE CONHECIMENTO DA CLÍNICA (única fonte autorizada de preço, prazo e condição):\n${ragChunks.map((c, i) => `(${i + 1}) ${c}`).join('\n\n')}`
      : '\nBASE DE CONHECIMENTO DA CLÍNICA: vazia. Não afirme nada que não esteja no contexto acima; mande confirmar com a equipe.',
    `\nCONVERSA ATÉ AQUI (cronológica):\n${copilotHistoricoTexto(history)}`,
    '\nDevolva SOMENTE o JSON {"leitura": "...", "sugestao": "..."}.',
  ].join('\n');

  let bruto: string;
  try {
    const out = await callLLM({
      provider,
      apiKey: llmKey,
      systemPrompt: COPILOT_SYSTEM_PROMPT,
      userPrompt,
      json: true,
      maxTokens: COPILOT_MAX_TOKENS,
      temperature: COPILOT_TEMPERATURE,
    });
    bruto = out.content;
  } catch (err) {
    console.log(JSON.stringify({
      event: 'copilot_llm_failed',
      conversation_id: conversationId,
      error: err instanceof Error ? err.message : String(err),
    }));
    return jsonResponse(
      {
        ok: false,
        error: 'A IA não respondeu agora. Tente de novo em instantes.',
        data: { contexto, leitura: null, sugestao: null, avisos, origem: 'somente_contexto' },
      },
      { status: 502 },
    );
  }

  const parsed = copilotParseJson(bruto);
  const leitura = typeof parsed?.leitura === 'string' ? parsed.leitura.trim() : '';
  const sugestao = typeof parsed?.sugestao === 'string' ? parsed.sugestao.trim() : '';
  if (!leitura && !sugestao) {
    return jsonResponse(
      {
        ok: false,
        error: 'A IA respondeu num formato inesperado. Tente de novo.',
        data: { contexto, leitura: null, sugestao: null, avisos, origem: 'somente_contexto' },
      },
      { status: 502 },
    );
  }

  copilotCacheSet(cacheKey, leitura, sugestao);

  console.log(JSON.stringify({
    event: 'copilot_suggested',
    conversation_id: conversationId,
    org_id: orgId,
    orcamentos: orcamentos.length,
    rag_chunks: ragChunks.length,
  }));

  const resposta: CopilotResposta = {
    contexto,
    leitura: leitura || null,
    sugestao: sugestao || null,
    avisos,
    origem: 'llm',
  };
  return jsonResponse({ ok: true, data: resposta });
});
