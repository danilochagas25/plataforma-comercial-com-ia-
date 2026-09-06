// ============================================================================
// _shared/meta-cloud.ts — client da WhatsApp Cloud API (Deno, Edge Functions)
// ----------------------------------------------------------------------------
// Integração DIRETA com a Meta (graph.facebook.com), sem intermediário: base =
// https://graph.facebook.com/v25.0, auth via `Authorization: Bearer <token>`.
// Multi-número: cada Phone Number ID é um CANAL (whatsapp_hub.channels,
// provider='meta') da org — o token do System User fica cifrado na própria
// linha (meta_token_encrypted, AES-256-GCM / CRYPTO_KEY).
//
// Molde: _shared/uazapi.ts (o outro provedor que fala direto com API externa).
//
// Versão da Graph API confirmada na tela do App "AMS Odontologia CRM" em
// 05/09/2026 (App ID 1432963662062927): v25.0. Não trocar por chute — a Meta
// muda o shape de payload entre versões maiores.
// Envio:  POST /v25.0/{phone_number_id}/messages
// Número: GET  /v25.0/{phone_number_id}?fields=...
// Mídia:  GET  /v25.0/{media_id} → { url } (baixar com o MESMO Bearer)
//
// Naming note: every private helper here is `meta`-prefixed on purpose. The
// deploy inlines each _shared file into ONE flat scope (api/bootstrap.ts →
// bundleEdgeFunction), so a generic `toNumber`/`asObject`/`bytesToHex` would
// silently override the identically-named helper of zernio.ts / uazapi.ts /
// credentials.ts in the same bundle. Keep the prefix when adding helpers.
// ============================================================================

import { decryptValue } from './credentials.ts';

export const META_GRAPH_BASE = 'https://graph.facebook.com';
export const META_GRAPH_VERSION = 'v25.0';

// A Meta responde erro em { error: { message, type, code, error_subcode, ... } }.
// `code` é o discriminante útil: 190 = token inválido/expirado, 131047 = fora da
// janela de 24h, 131026 = número não recebe, 200 = permissão faltando.
export class MetaCloudError extends Error {
  status: number;
  code: number | null;
  subcode: number | null;
  constructor(message: string, status: number, code: number | null = null, subcode: number | null = null) {
    super(message);
    this.name = 'MetaCloudError';
    this.status = status;
    this.code = code;
    this.subcode = subcode;
  }
}

export interface MetaContext {
  phoneNumberId: string;
  token: string;
  wabaId?: string | null;
}

// Monta o contexto a partir de uma linha de whatsapp_hub.channels
// (provider='meta'). O token fica cifrado na linha (AES-GCM/CRYPTO_KEY).
export async function metaContextFromChannel(channel: {
  meta_phone_number_id: string | null;
  meta_token_encrypted: string | null;
  meta_waba_id?: string | null;
}): Promise<MetaContext> {
  const phoneNumberId = channel.meta_phone_number_id?.trim();
  const encrypted = channel.meta_token_encrypted?.trim();
  if (!phoneNumberId || !encrypted) {
    throw new MetaCloudError(
      'Canal Meta sem Phone Number ID / token configurados.',
      500,
    );
  }
  return {
    phoneNumberId,
    token: await decryptValue(encrypted),
    wabaId: channel.meta_waba_id ?? null,
  };
}

function metaAsObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function metaNumOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// Erros conhecidos da Meta traduzidos para português. A mensagem crua da Meta
// vem em inglês e chega até a tela do admin — quem opera o CRM não lê inglês.
// Códigos que não estão aqui repassam a frase original (diagnóstico).
// Nenhum desses textos carrega token, App Secret ou dado de paciente.
function metaFriendlyMessage(
  code: number | null,
  subcode: number | null,
  raw: string,
): string {
  if (code === 190) {
    return 'Token da Meta inválido ou expirado. Gere um token novo no Usuário do '
      + 'Sistema e atualize o canal em Configurações → Canais.';
  }
  if (code === 200 || code === 10 || code === 3) {
    return 'A Meta recusou por falta de permissão. Confira se o Usuário do Sistema '
      + 'tem acesso total ao App e à conta do WhatsApp (WABA), com as permissões '
      + 'whatsapp_business_management e whatsapp_business_messaging.';
  }
  if (code === 100) {
    // 33 = objeto inexistente ou sem permissão de leitura para este token.
    if (subcode === 33) {
      return 'A Meta não encontrou a conta do WhatsApp (WABA) ou o número informado. '
        + 'Confira o ID da conta e o ID do número no canal.';
    }
    return `Parâmetro inválido na chamada à Meta: ${raw}`;
  }
  if (code === 132000) {
    return 'A Meta recusou o modelo: número de variáveis do texto não bate com os '
      + 'exemplos enviados.';
  }
  if (code === 132001) {
    return 'Já existe um modelo com este nome e idioma na conta da Meta. Use outro '
      + 'nome ou sincronize os modelos antes de enviar.';
  }
  if (code === 131047) {
    return 'Fora da janela de 24 horas: só é possível enviar modelo aprovado para '
      + 'este contato.';
  }
  return raw;
}

// Reads the Graph API response body and turns any error shape into a
// MetaCloudError. Shared by the JSON path (metaFetchUrl) and by the multipart
// upload (metaUploadMedia), which cannot reuse the same fetch because its body
// is a FormData and must NOT carry a JSON Content-Type.
async function metaReadJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* segue para o gate de status */
  }
  if (!res.ok || json.error) {
    const err = metaAsObject(json.error);
    const raw = typeof err.message === 'string' && err.message.trim()
      ? err.message
      : `Meta respondeu ${res.status}`;
    const code = metaNumOrNull(err.code);
    const subcode = metaNumOrNull(err.error_subcode);
    throw new MetaCloudError(metaFriendlyMessage(code, subcode, raw), res.status, code, subcode);
  }
  return json;
}

// Single fetch helper for every Graph API call (GET or JSON POST).
// `url` is absolute so pagination (paging.next) can reuse it verbatim.
async function metaFetchUrl(
  ctx: MetaContext,
  url: string,
  init: { method: 'GET' | 'POST'; body?: Record<string, unknown> } = { method: 'GET' },
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { Authorization: `Bearer ${ctx.token}` };
  if (init.body) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method: init.method,
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  return await metaReadJson(res);
}

async function metaFetch(
  ctx: MetaContext,
  path: string,
  init: { method: 'GET' | 'POST'; body?: Record<string, unknown> } = { method: 'GET' },
): Promise<Record<string, unknown>> {
  return await metaFetchUrl(ctx, `${META_GRAPH_BASE}/${META_GRAPH_VERSION}${path}`, init);
}

// A Graph API só aceita as operações de modelo no ID da WABA — o Phone Number
// ID não serve. Canal criado antes da tela nova pode estar sem o campo.
function metaRequireWabaId(ctx: MetaContext): string {
  const wabaId = ctx.wabaId?.trim();
  if (!wabaId) {
    throw new MetaCloudError(
      'Canal Meta sem o ID da conta do WhatsApp (WABA). Edite o canal em '
      + 'Configurações → Canais e informe o ID da conta.',
      400,
    );
  }
  return wabaId;
}

// A Meta aceita o destino em E.164 SEM o '+' (só dígitos).
function metaToNumber(phone: string): string {
  return phone.replace(/\D/g, '');
}

// { messaging_product, contacts:[...], messages:[{ id: "wamid...." }] }
function metaMessageIdOf(root: Record<string, unknown>): string | null {
  const messages = Array.isArray(root.messages) ? root.messages : [];
  const first = metaAsObject(messages[0]);
  return typeof first.id === 'string' && first.id.trim() ? first.id : null;
}

async function metaSendMessage(
  ctx: MetaContext,
  body: Record<string, unknown>,
): Promise<{ messageId: string | null }> {
  const root = await metaFetch(ctx, `/${ctx.phoneNumberId}/messages`, { method: 'POST', body });
  return { messageId: metaMessageIdOf(root) };
}

// Texto livre — só entrega DENTRO da janela de 24h; fora dela a Meta recusa com
// code 131047 e a mensagem precisa ser template aprovado (metaSendTemplate).
export async function metaSendText(
  ctx: MetaContext,
  input: { phone: string; text: string },
): Promise<{ messageId: string | null }> {
  return await metaSendMessage(ctx, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: metaToNumber(input.phone),
    type: 'text',
    text: { body: input.text, preview_url: false },
  });
}

// Template aprovado — único envio permitido FORA da janela de 24h.
// `components` segue o shape da Meta: [{ type: 'body', parameters: [...] }].
export async function metaSendTemplate(
  ctx: MetaContext,
  input: {
    phone: string;
    templateName: string;
    languageCode: string;
    components?: unknown[];
  },
): Promise<{ messageId: string | null }> {
  const template: Record<string, unknown> = {
    name: input.templateName,
    language: { code: input.languageCode },
  };
  if (input.components && input.components.length > 0) {
    template.components = input.components;
  }
  return await metaSendMessage(ctx, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: metaToNumber(input.phone),
    type: 'template',
    template,
  });
}

// Sobe o arquivo para a PRÓPRIA Meta (POST /{phone_number_id}/media) e devolve
// o media id, que vale 30 dias e é aceito no lugar do `link` no envio.
// Por que existe: o caminho Zernio hospeda a mídia e manda uma URL pública; no
// canal Meta direto não há esse host, e publicar mídia de paciente numa URL
// aberta é decisão de LGPD do dono (pendências #21/#23 do MEMORIA.md). Mandando
// os bytes direto para a Meta, o arquivo não passa por nenhuma URL pública nossa.
export async function metaUploadMedia(
  ctx: MetaContext,
  input: { bytes: Uint8Array; filename: string; mimeType: string },
): Promise<{ mediaId: string }> {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', input.mimeType);
  // `Uint8Array<ArrayBufferLike>` does not narrow to `BlobPart` in Deno's lib
  // (SharedArrayBuffer is in the union). The bytes always come from a plain
  // ArrayBuffer here, so the cast is safe.
  const filePart = input.bytes as unknown as BlobPart;
  form.append('file', new Blob([filePart], { type: input.mimeType }), input.filename);

  // Multipart: o boundary é montado pelo runtime, então NÃO definimos
  // Content-Type aqui — só o Bearer.
  const res = await fetch(
    `${META_GRAPH_BASE}/${META_GRAPH_VERSION}/${ctx.phoneNumberId}/media`,
    { method: 'POST', headers: { Authorization: `Bearer ${ctx.token}` }, body: form },
  );
  const json = await metaReadJson(res);
  const mediaId = typeof json.id === 'string' ? json.id.trim() : '';
  if (!mediaId) {
    throw new MetaCloudError('A Meta não devolveu o id da mídia enviada.', 502);
  }
  return { mediaId };
}

// Mídia por URL pública (`link`) OU por id já subido na Meta (`mediaId`, de
// metaUploadMedia). Com `link` a Meta baixa o arquivo — ele precisa estar
// acessível sem auth. Caption não se aplica a áudio.
export async function metaSendMedia(
  ctx: MetaContext,
  input: {
    phone: string;
    type: 'image' | 'video' | 'audio' | 'document';
    link?: string;
    mediaId?: string;
    caption?: string;
    filename?: string;
  },
): Promise<{ messageId: string | null }> {
  const mediaId = input.mediaId?.trim();
  const link = input.link?.trim();
  if (!mediaId && !link) {
    throw new MetaCloudError('Envio de mídia sem link público nem id do arquivo.', 400);
  }
  const media: Record<string, unknown> = mediaId ? { id: mediaId } : { link };
  if (input.caption && input.type !== 'audio') media.caption = input.caption;
  if (input.filename && input.type === 'document') media.filename = input.filename;
  return await metaSendMessage(ctx, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: metaToNumber(input.phone),
    type: input.type,
    [input.type]: media,
  });
}

export interface MetaNumberInfo {
  id: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  codeVerificationStatus: string | null;
  platformType: string | null;
  throughputLevel: string | null;
}

// Saúde do número (widget do dashboard e alerta de qualidade). `throughput` vem
// como objeto { level: 'STANDARD' | 'HIGH' | ... }.
export async function metaGetNumberInfo(ctx: MetaContext): Promise<MetaNumberInfo> {
  const fields = [
    'verified_name',
    'display_phone_number',
    'quality_rating',
    'code_verification_status',
    'platform_type',
    'throughput',
  ].join(',');
  const root = await metaFetch(ctx, `/${ctx.phoneNumberId}?fields=${fields}`);
  const pick = (key: string): string | null => {
    const v = root[key];
    return typeof v === 'string' && v.trim() ? v : null;
  };
  const throughput = metaAsObject(root.throughput);
  return {
    id: pick('id') ?? ctx.phoneNumberId,
    displayPhoneNumber: pick('display_phone_number'),
    verifiedName: pick('verified_name'),
    qualityRating: pick('quality_rating'),
    codeVerificationStatus: pick('code_verification_status'),
    platformType: pick('platform_type'),
    throughputLevel: typeof throughput.level === 'string' ? throughput.level : null,
  };
}

// Mídia recebida: a Meta NÃO manda URL no webhook, manda só o `id` do arquivo
// (ex.: { type:'image', image:{ id, mime_type, sha256 } }). Para chegar no
// arquivo são DOIS passos:
//   1. GET /{media_id} → { url, mime_type, file_size }
//   2. GET nessa `url` com o MESMO header Authorization: Bearer <token>
// A URL do passo 1 é de uso único, expira em ~5 minutos e responde 401 sem o
// Bearer — não adianta guardá-la em messages.media_url para o front abrir.
// Quem for exibir a mídia precisa baixar aqui e republicar no Storage.
export async function metaResolveMediaUrl(
  ctx: MetaContext,
  mediaId: string,
): Promise<{ url: string | null; mimeType: string | null; fileSize: number | null }> {
  const root = await metaFetch(ctx, `/${mediaId}`);
  return {
    url: typeof root.url === 'string' && root.url.trim() ? root.url : null,
    mimeType: typeof root.mime_type === 'string' ? root.mime_type : null,
    fileSize: metaNumOrNull(root.file_size),
  };
}

// Baixa o binário da URL devolvida por metaResolveMediaUrl (exige o Bearer).
export async function metaDownloadMedia(
  ctx: MetaContext,
  url: string,
): Promise<{ bytes: Uint8Array; mimeType: string | null }> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${ctx.token}` } });
  if (!res.ok) {
    throw new MetaCloudError(`Falha ao baixar mídia da Meta (${res.status})`, res.status);
  }
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    mimeType: res.headers.get('content-type'),
  };
}

// --- modelos de mensagem (message templates) --------------------------------
// Endpoints da WABA (não do número):
//   GET  /v25.0/{waba_id}/message_templates  → lista paginada
//   POST /v25.0/{waba_id}/message_templates  → submete para aprovação
// O shape devolvido aqui é próximo do `listTemplates` do Zernio (id/name/status)
// mais os campos que só a Meta entrega (category, language, components), para o
// chamador espelhar o modelo na tabela local sem transformar duas vezes.

export type MetaTemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';

export interface MetaTemplate {
  id: string | null;
  name: string | null;
  status: string | null;
  category: string | null;
  language: string | null;
  components: Record<string, unknown>[];
  rejectedReason: string | null;
}

function metaStr(root: Record<string, unknown>, key: string): string | null {
  const v = root[key];
  return typeof v === 'string' && v.trim() ? v : null;
}

function metaComponentsOf(root: Record<string, unknown>): Record<string, unknown>[] {
  const raw = Array.isArray(root.components) ? root.components : [];
  return raw.map((c) => metaAsObject(c));
}

// Lista TODOS os modelos da WABA, seguindo `paging.next` até acabar. A Meta
// devolve no máximo ~1000 por página; o limite pedido aqui é só o tamanho da
// página. `metaPageGuard` evita laço infinito se a Meta devolver um cursor que
// aponta para si mesmo.
export async function metaListTemplates(
  ctx: MetaContext,
  options: { limit?: number } = {},
): Promise<MetaTemplate[]> {
  const wabaId = metaRequireWabaId(ctx);
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000);
  const fields = 'id,name,status,category,language,components,rejected_reason';

  let url = `${META_GRAPH_BASE}/${META_GRAPH_VERSION}/${wabaId}/message_templates`
    + `?limit=${limit}&fields=${encodeURIComponent(fields)}`;

  const out: MetaTemplate[] = [];
  const seenPages = new Set<string>();
  const metaPageGuard = 50; // teto de páginas — 50 × 1000 cobre qualquer WABA real

  for (let page = 0; page < metaPageGuard; page++) {
    if (seenPages.has(url)) break;
    seenPages.add(url);

    const root = await metaFetchUrl(ctx, url);
    const list = Array.isArray(root.data) ? root.data : [];
    for (const item of list) {
      const t = metaAsObject(item);
      out.push({
        id: metaStr(t, 'id'),
        name: metaStr(t, 'name'),
        status: metaStr(t, 'status'),
        category: metaStr(t, 'category'),
        language: metaStr(t, 'language'),
        components: metaComponentsOf(t),
        rejectedReason: metaStr(t, 'rejected_reason'),
      });
    }

    const next = metaStr(metaAsObject(root.paging), 'next');
    if (!next) break;
    url = next;
  }

  return out;
}

// Submete um modelo para aprovação. `components` já precisa vir no formato da
// Graph API (type/format/button.type em MAIÚSCULAS).
export async function metaCreateTemplate(
  ctx: MetaContext,
  input: {
    name: string;
    language: string;
    category: MetaTemplateCategory;
    components: unknown[];
  },
): Promise<{ id: string | null; status: string | null; category: string | null }> {
  const wabaId = metaRequireWabaId(ctx);
  const root = await metaFetch(ctx, `/${wabaId}/message_templates`, {
    method: 'POST',
    body: {
      name: input.name,
      language: input.language,
      category: input.category,
      components: input.components,
    },
  });
  // Resposta real: { id, status, category }.
  return {
    id: metaStr(root, 'id'),
    status: metaStr(root, 'status'),
    category: metaStr(root, 'category'),
  };
}

// --- assinatura do webhook --------------------------------------------------

function metaBytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time string compare (no early return on mismatch).
function metaConstantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// X-Hub-Signature-256: "sha256=<hex>" — HMAC-SHA256 do corpo BRUTO com o App
// Secret. Tem que ser o texto exato recebido: qualquer JSON.parse/stringify
// antes disso reordena chaves e invalida a assinatura.
export async function verifyMetaSignature(
  appSecret: string,
  rawBody: string,
  headerValue: string | null,
): Promise<boolean> {
  if (!appSecret || !headerValue) return false;
  const got = headerValue.trim();
  if (!got.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)),
  );
  return metaConstantTimeEquals(got.slice(7).toLowerCase(), metaBytesToHex(mac));
}

// Comparação constant-time exportada para o desafio GET do webhook
// (hub.verify_token contra a credencial do cofre).
export function metaTimingSafeEqual(a: string, b: string): boolean {
  return metaConstantTimeEquals(a, b);
}
