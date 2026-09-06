// ============================================================================
// _shared/inbox-media.ts  —  guarda de mídia de paciente (Supabase Storage)
// ----------------------------------------------------------------------------
// Bucket PRIVADO `whatsapp-hub-inbox-media` (migração 20260906230000).
// Decisão do dono (MEMORIA.md, pendências #21/#23/#36): foto, áudio, vídeo e
// documento de paciente ficam na nossa base, visíveis para admin e recepção,
// com retenção de 12 meses e expurgo automático.
//
// `messages.media_url` guarda uma REFERÊNCIA, não uma URL:
//     whatsapp-hub-inbox-media/<org_id>/<conversation_id>/<message_id>.<ext>
// Quem lê (front, transcribe-audio, process-ai-message) reconhece que não
// começa com http(s) e resolve pelo Storage — signed URL no browser, download
// pela service role no servidor. Valor legado (URL do Zernio/UAZAPI) continua
// sendo tratado como URL, sem migração de dado.
//
// ⚠️ PREFIXO OBRIGATÓRIO `inboxMedia*` em TODO helper daqui.
// O inliner de api/bootstrap.ts achata todos os _shared/* no MESMO escopo
// plano do index.ts. Um helper genérico (extFor / cleanMime / download)
// sobrescreveria o homônimo de outro _shared SEM erro nenhum — declaração
// duplicada não quebra em JS, a última vence. Mesma regra dos `meta*` de
// meta-cloud.ts e dos `phoneBr*` de phone-br.ts.
// ============================================================================

// ⚠️ `import { type X }` e NÃO `import type { X }`: o hoister de
// api/bootstrap.ts trata a palavra `type` de `import type {...}` como import
// DEFAULT e emite `import type, { …, type X, X }` — dois bindings com o mesmo
// nome, que é SyntaxError e derruba a function no boot. A forma com o
// modificador dentro da chave é a que `supabase-admin.ts` já usa, então o
// specifier é idêntico e o hoister deduplica.
import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

export const INBOX_MEDIA_BUCKET = 'whatsapp-hub-inbox-media';

// Teto do bucket (file_size_limit da migração). Arquivo maior é recusado pelo
// Storage; conferimos antes para logar a razão certa e não perder a mensagem.
export const INBOX_MEDIA_MAX_BYTES = 25 * 1024 * 1024;

// MIME → extensão. Só o que o WhatsApp entrega de fato; o resto cai em 'bin'.
const INBOX_MEDIA_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/wav': 'wav',
  'audio/webm': 'weba',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/zip': 'zip',
  'text/plain': 'txt',
  'text/csv': 'csv',
};

// Espelha `allowed_mime_types` do bucket. O que não estiver aqui é gravado
// como application/octet-stream — nada de paciente é descartado por causa de
// um Content-Type exótico.
const INBOX_MEDIA_ALLOWED = new Set<string>([
  ...Object.keys(INBOX_MEDIA_EXT),
  'application/octet-stream',
]);

// A Meta manda 'audio/ogg; codecs=opus'. O Storage compara o MIME inteiro
// contra allowed_mime_types, então o parâmetro tem que sair.
export function inboxMediaCleanMime(raw: string | null | undefined): string {
  const base = (raw ?? '').split(';')[0].trim().toLowerCase();
  return base || 'application/octet-stream';
}

// MIME aceito pelo bucket (o cru quando conhecido, senão octet-stream).
export function inboxMediaStorageMime(raw: string | null | undefined): string {
  const clean = inboxMediaCleanMime(raw);
  return INBOX_MEDIA_ALLOWED.has(clean) ? clean : 'application/octet-stream';
}

// Extensão do arquivo. `fallbackName` é o filename que o WhatsApp mandou no
// documento — quando o MIME é desconhecido, ele preserva a extensão original.
export function inboxMediaExt(
  raw: string | null | undefined,
  fallbackName?: string | null,
): string {
  const clean = inboxMediaCleanMime(raw);
  const known = INBOX_MEDIA_EXT[clean];
  if (known) return known;
  const fromName = (fallbackName ?? '').split('.').pop() ?? '';
  if (/^[a-z0-9]{1,8}$/i.test(fromName)) return fromName.toLowerCase();
  return 'bin';
}

export interface InboxMediaRef {
  bucket: string;
  path: string;
  /** Valor gravado em messages.media_url: `<bucket>/<path>`. */
  ref: string;
}

export function inboxMediaBuildRef(input: {
  orgId: string;
  conversationId: string;
  messageId: string;
  mimeType: string | null;
  filename?: string | null;
}): InboxMediaRef {
  const ext = inboxMediaExt(input.mimeType, input.filename);
  const path = `${input.orgId}/${input.conversationId}/${input.messageId}.${ext}`;
  return { bucket: INBOX_MEDIA_BUCKET, path, ref: `${INBOX_MEDIA_BUCKET}/${path}` };
}

// Lê o valor de messages.media_url. Devolve null quando é URL http(s) (modelo
// Zernio/UAZAPI) ou quando está vazio — o chamador segue tratando como URL.
export function inboxMediaParseRef(
  value: string | null | undefined,
): { bucket: string; path: string } | null {
  const raw = (value ?? '').trim();
  if (!raw || /^https?:\/\//i.test(raw)) return null;
  const slash = raw.indexOf('/');
  if (slash <= 0) return null;
  const bucket = raw.slice(0, slash);
  const path = raw.slice(slash + 1);
  if (!path || !bucket.startsWith('whatsapp-hub-')) return null;
  return { bucket, path };
}

// Sobe os bytes no bucket privado. `upsert` para uma reentrega da Meta não
// falhar no arquivo que já está lá.
export async function inboxMediaUpload(
  admin: SupabaseClient,
  ref: InboxMediaRef,
  bytes: Uint8Array,
  mimeType: string | null,
): Promise<void> {
  // `Uint8Array<ArrayBufferLike>` não estreita para BlobPart no lib do Deno
  // (SharedArrayBuffer está na união). Os bytes sempre vêm de ArrayBuffer aqui.
  const part = bytes as unknown as BlobPart;
  const contentType = inboxMediaStorageMime(mimeType);
  const { error } = await admin.storage
    .from(ref.bucket)
    .upload(ref.path, new Blob([part], { type: contentType }), {
      contentType,
      upsert: true,
    });
  if (error) throw new Error(`storage upload: ${error.message}`);
}

// Baixa pela service role (o bucket é privado; fetch simples devolveria 400).
export async function inboxMediaDownload(
  admin: SupabaseClient,
  parsed: { bucket: string; path: string },
): Promise<{ blob: Blob; mimeType: string }> {
  const { data, error } = await admin.storage.from(parsed.bucket).download(parsed.path);
  if (error || !data) {
    throw new Error(`storage download: ${error?.message ?? 'arquivo ausente'}`);
  }
  return { blob: data, mimeType: data.type || 'application/octet-stream' };
}

export async function inboxMediaRemove(
  admin: SupabaseClient,
  bucket: string,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await admin.storage.from(bucket).remove(paths);
  if (error) throw new Error(`storage remove: ${error.message}`);
}
