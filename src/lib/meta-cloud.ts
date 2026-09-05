// ============================================================================
// Client Meta Cloud API (Node — API Routes da Vercel; usado só na conexão do
// canal). Integração DIRETA com a Meta: base = https://graph.facebook.com/v25.0,
// auth via header `Authorization: Bearer <access token>`.
//
// Molde: src/lib/uazapi.ts (o outro provedor que fala direto com API externa).
//
// Este arquivo é o par Node do `supabase/functions/_shared/meta-cloud.ts`
// (Deno, usado em runtime pelas Edge Functions). Os dois devolvem o MESMO
// shape em `MetaNumberInfo`; lá a função equivalente se chama
// `metaGetNumberInfo(ctx)` porque recebe o contexto já montado a partir da
// linha do canal — aqui recebe `phoneNumberId` + `token` soltos, porque no
// cadastro o canal ainda não existe.
//
// Versão da Graph API confirmada na tela do App "AMS Odontologia CRM" em
// 05/09/2026 (App ID 1432963662062927): v25.0. Não trocar por chute — a Meta
// muda o shape de payload entre versões maiores.
// ============================================================================

export const META_GRAPH_BASE = 'https://graph.facebook.com';
export const META_GRAPH_VERSION = 'v25.0';

// A Meta responde erro em { error: { message, type, code, error_subcode } }.
// `code` é o discriminante útil (190 = token, 200/10 = permissão, 100 = param).
export class MetaCloudError extends Error {
  status: number;
  code: number | null;
  subcode: number | null;
  constructor(
    message: string,
    status: number,
    code: number | null = null,
    subcode: number | null = null,
  ) {
    super(message);
    this.name = 'MetaCloudError';
    this.status = status;
    this.code = code;
    this.subcode = subcode;
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

// Traduz o erro da Meta para uma frase que o Danilo entenda na tela. Só os
// códigos que aparecem no cadastro do canal; o resto repassa a mensagem crua.
function friendlyMessage(code: number | null, status: number, raw: string): string {
  if (code === 190) {
    return 'Token de acesso inválido ou expirado. Gere um token novo no Usuário do Sistema e cole de novo.';
  }
  if (code === 200 || code === 10) {
    return 'O token não tem permissão nesta conta. Confira se o Usuário do Sistema tem acesso total ao App e à conta do WhatsApp (WABA).';
  }
  if (code === 100) {
    return 'A Meta não reconheceu o ID informado. Confira o ID do número (Phone Number ID) e o ID da conta (WABA).';
  }
  if (status === 401 || status === 403) {
    return `Acesso negado pela Meta: ${raw}`;
  }
  return raw;
}

async function mfetch(
  token: string,
  path: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${META_GRAPH_BASE}/${META_GRAPH_VERSION}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* respostas não-JSON caem no gate abaixo */
  }
  if (!res.ok || json.error) {
    const err = asObject(json.error);
    const code = numOrNull(err.code);
    const raw = strOrNull(err.message) ?? `Meta respondeu ${res.status}`;
    throw new MetaCloudError(
      friendlyMessage(code, res.status, raw),
      res.status,
      code,
      numOrNull(err.error_subcode),
    );
  }
  return json;
}

export interface MetaNumberInfo {
  id: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  codeVerificationStatus: string | null;
  platformType: string | null;
}

// GET /{phone_number_id} — é o teste de conexão do canal: se responde, o token
// é válido E enxerga este número. Também confirma se o número é mesmo o
// esperado (verified_name / display_phone_number).
export async function metaNumberInfo(
  phoneNumberId: string,
  token: string,
): Promise<MetaNumberInfo> {
  const fields = [
    'verified_name',
    'display_phone_number',
    'quality_rating',
    'code_verification_status',
    'platform_type',
  ].join(',');
  const root = await mfetch(token, `/${phoneNumberId.trim()}?fields=${fields}`);
  return {
    id: strOrNull(root.id) ?? phoneNumberId.trim(),
    displayPhoneNumber: strOrNull(root.display_phone_number),
    verifiedName: strOrNull(root.verified_name),
    qualityRating: strOrNull(root.quality_rating),
    codeVerificationStatus: strOrNull(root.code_verification_status),
    platformType: strOrNull(root.platform_type),
  };
}

export interface MetaWabaInfo {
  id: string | null;
  name: string | null;
  accountReviewStatus: string | null;
}

// GET /{waba_id} — opcional. Confirma que o token também alcança a conta do
// WhatsApp Business informada (vínculo App ↔ WABA). Falha aqui não impede o
// canal de funcionar para envio, então quem chama trata como informativo.
export async function metaWabaInfo(
  wabaId: string,
  token: string,
): Promise<MetaWabaInfo> {
  const root = await mfetch(token, `/${wabaId.trim()}?fields=name,account_review_status`);
  return {
    id: strOrNull(root.id) ?? wabaId.trim(),
    name: strOrNull(root.name),
    accountReviewStatus: strOrNull(root.account_review_status),
  };
}
