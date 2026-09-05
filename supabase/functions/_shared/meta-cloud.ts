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

// Single fetch helper for every Graph API call (GET or JSON POST).
async function metaFetch(
  ctx: MetaContext,
  path: string,
  init: { method: 'GET' | 'POST'; body?: Record<string, unknown> } = { method: 'GET' },
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { Authorization: `Bearer ${ctx.token}` };
  if (init.body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${META_GRAPH_BASE}/${META_GRAPH_VERSION}${path}`, {
    method: init.method,
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* segue para o gate de status */
  }
  if (!res.ok || json.error) {
    const err = metaAsObject(json.error);
    const msg = typeof err.message === 'string' && err.message.trim()
      ? err.message
      : `Meta respondeu ${res.status}`;
    throw new MetaCloudError(
      msg,
      res.status,
      metaNumOrNull(err.code),
      metaNumOrNull(err.error_subcode),
    );
  }
  return json;
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

// Mídia por URL pública (`link`). A Meta baixa o arquivo do link — ele precisa
// estar acessível sem auth. Caption não se aplica a áudio.
export async function metaSendMedia(
  ctx: MetaContext,
  input: {
    phone: string;
    type: 'image' | 'video' | 'audio' | 'document';
    link: string;
    caption?: string;
    filename?: string;
  },
): Promise<{ messageId: string | null }> {
  const media: Record<string, unknown> = { link: input.link };
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
