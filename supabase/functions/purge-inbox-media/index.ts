// ============================================================================
// purge-inbox-media  (cron: wh-purge-inbox-media, 03:20 UTC = 00:20 Itabuna)
// ----------------------------------------------------------------------------
// Expurgo automático da mídia de paciente aos 12 MESES — decisão do dono
// (Danilo, 06/09/2026; MEMORIA.md pendências #21/#23/#36).
//
// O que apaga: o OBJETO no bucket privado whatsapp-hub-inbox-media e o
// ponteiro messages.media_url.
// O que NÃO apaga: a MENSAGEM. O histórico do atendimento (texto, transcrição
// do áudio, descrição da foto) continua legível para sempre; só o arquivo
// expira. Depois do expurgo o thread volta a mostrar "Mídia recebida
// (visualização indisponível)".
//
// Só toca em linhas cujo media_url é referência do NOSSO bucket. Mídia do
// modelo Zernio/UAZAPI (URL http externa) não é nossa para apagar e passa
// intacta.
//
// Chamada pela service role (pg_cron via _cron_invoke_edge). Aceita
// `{ dry_run: true }` para conferir o que sairia sem apagar nada, e
// `{ retention_days: N }` para inspeção — o padrão é 365 dias.
// ============================================================================

import { getAdminClient } from '../_shared/supabase-admin.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { requireServiceRole } from '../_shared/auth.ts';
import { INBOX_MEDIA_BUCKET, inboxMediaParseRef, inboxMediaRemove } from '../_shared/inbox-media.ts';

const DEFAULT_RETENTION_DAYS = 365; // 12 meses
const BATCH = 200;                  // lote por rodada (o cron é diário)

interface PurgeRow {
  id: string;
  media_url: string | null;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    await requireServiceRole(req);
  } catch {
    return jsonResponse({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  let body: { dry_run?: boolean; retention_days?: number } = {};
  try {
    body = await req.json();
  } catch {
    body = {}; // o cron manda '{}' — corpo vazio também é aceito
  }

  const retentionDays = Number.isFinite(body.retention_days) && (body.retention_days as number) > 0
    ? Math.floor(body.retention_days as number)
    : DEFAULT_RETENTION_DAYS;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  const admin = getAdminClient();

  // `like` no prefixo do bucket: só o que está guardado por nós.
  const { data, error } = await admin
    .from('messages')
    .select('id, media_url')
    .not('media_url', 'is', null)
    .like('media_url', `${INBOX_MEDIA_BUCKET}/%`)
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(BATCH);
  if (error) {
    return jsonResponse({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as PurgeRow[];
  const paths: string[] = [];
  const ids: string[] = [];
  for (const row of rows) {
    const ref = inboxMediaParseRef(row.media_url);
    if (!ref || ref.bucket !== INBOX_MEDIA_BUCKET) continue;
    paths.push(ref.path);
    ids.push(row.id);
  }

  if (body.dry_run) {
    return jsonResponse({
      ok: true,
      dry_run: true,
      cutoff,
      retention_days: retentionDays,
      candidates: ids.length,
    });
  }

  if (ids.length === 0) {
    return jsonResponse({ ok: true, cutoff, retention_days: retentionDays, purged: 0 });
  }

  // Ordem importa: apaga o ARQUIVO primeiro. Se zerássemos media_url antes e o
  // remove falhasse, o objeto ficaria órfão no bucket para sempre, sem
  // ponteiro que o encontrasse na próxima rodada.
  try {
    await inboxMediaRemove(admin, INBOX_MEDIA_BUCKET, paths);
  } catch (err) {
    console.error(JSON.stringify({
      event: 'purge_inbox_media_remove_failed',
      message: err instanceof Error ? err.message : String(err),
      count: paths.length,
    }));
    return jsonResponse({ ok: false, error: 'Falha ao apagar arquivos do Storage.' }, { status: 502 });
  }

  const { error: updErr } = await admin
    .from('messages')
    .update({ media_url: null })
    .in('id', ids);
  if (updErr) {
    console.error(JSON.stringify({
      event: 'purge_inbox_media_update_failed',
      message: updErr.message,
      count: ids.length,
    }));
    return jsonResponse({ ok: false, error: updErr.message }, { status: 500 });
  }

  console.log(JSON.stringify({
    event: 'purge_inbox_media_done',
    cutoff,
    retention_days: retentionDays,
    purged: ids.length,
    // Mais que o lote significa que sobrou fila para amanhã (ou para uma
    // chamada manual). Com o cron diário isso só acontece na 1ª limpeza.
    batch_full: ids.length >= BATCH,
  }));

  return jsonResponse({
    ok: true,
    cutoff,
    retention_days: retentionDays,
    purged: ids.length,
    batch_full: ids.length >= BATCH,
  });
});
