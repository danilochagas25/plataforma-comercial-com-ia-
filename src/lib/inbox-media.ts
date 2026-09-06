// ============================================================================
// src/lib/inbox-media.ts — leitura da mídia guardada na nossa base
// ----------------------------------------------------------------------------
// Par de browser do `supabase/functions/_shared/inbox-media.ts` (Deno). Os dois
// precisam concordar no FORMATO da referência; não dá para importar um do
// outro (Vite/Node × Deno).
//
// `messages.media_url` tem dois formatos:
//   · URL http(s)  → modelo Zernio/UAZAPI (e a URL do proxy autenticado).
//   · '<bucket>/<org_id>/<conversation_id>/<message_id>.<ext>' → canal Meta
//     direto: o arquivo vive no bucket PRIVADO whatsapp-hub-inbox-media.
//
// Privado quer dizer que a tag <img>/<audio> não abre o arquivo sozinha: o
// browser precisa de uma URL ASSINADA, que o próprio usuário logado gera
// (a policy `wh_inbox_media_org_read` libera SELECT para admin e recepção
// dentro da própria organização).
// ============================================================================

import { getSupabase } from './supabase';

export const INBOX_MEDIA_BUCKET = 'whatsapp-hub-inbox-media';

/** Validade da URL assinada. Uma hora cobre a sessão de atendimento sem
 *  deixar link vivo por aí — é dado de paciente. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

export interface StorageRef {
  bucket: string;
  path: string;
}

/** Devolve null quando o valor é URL http(s) ou não parece referência nossa. */
export function parseStorageRef(value: string | null | undefined): StorageRef | null {
  const raw = (value ?? '').trim();
  if (!raw || /^https?:\/\//i.test(raw)) return null;
  const slash = raw.indexOf('/');
  if (slash <= 0) return null;
  const bucket = raw.slice(0, slash);
  const path = raw.slice(slash + 1);
  if (!path || !bucket.startsWith('whatsapp-hub-')) return null;
  return { bucket, path };
}

export async function createSignedMediaUrl(ref: StorageRef): Promise<string | null> {
  const { data, error } = await getSupabase()
    .storage
    .from(ref.bucket)
    .createSignedUrl(ref.path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
