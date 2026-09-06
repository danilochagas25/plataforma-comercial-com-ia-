// ============================================================================
// meta-webhook  (público, HMAC-verified)
// ----------------------------------------------------------------------------
// Receptor dos eventos da WhatsApp Cloud API DIRETA da Meta (sem Zernio).
// URL registrada no App "AMS Odontologia CRM" (Configuração > Webhooks):
//   {SUPABASE_URL}/functions/v1/meta-webhook
//
// GET  → desafio de verificação da Meta (hub.mode / hub.verify_token /
//        hub.challenge). Responde o challenge em TEXTO PURO, sem JSON.
// POST → eventos. O gate é a assinatura X-Hub-Signature-256 (HMAC-SHA256 do
//        corpo BRUTO com o App Secret). Sem JWT: a Meta chama anonimamente,
//        por isso a função sobe com verify_jwt = false.
//
// Segredos (cofre por org, public.org_settings — nunca em arquivo/.env):
//   meta_app_secret             → valida a assinatura do POST
//   meta_webhook_verify_token   → valida o desafio do GET
//   token de envio              → cifrado na linha do canal (meta_token_encrypted)
//
// Payload (v25.0):
//   { object:'whatsapp_business_account',
//     entry:[{ id:<WABA_ID>, changes:[{ field:'messages', value:{
//       metadata:{ phone_number_id, display_phone_number },
//       contacts:[{ wa_id, profile:{ name } }],
//       messages:[{ from, id, timestamp, type, text:{body}, ... }],
//       statuses:[{ id, status, timestamp, recipient_id, errors:[...] }] }}]}]}
//
// O canal (e portanto a ORG) é resolvido por value.metadata.phone_number_id →
// whatsapp_hub.channels (provider='meta'). É o único identificador do evento
// que amarra a mensagem a uma organização.
//
// A criação de contato/conversa/mensagem segue o MESMO caminho do
// zernio-webhook — o que muda aqui é só o formato do payload e a resolução do
// canal. O INSERT em messages dispara a IA pelo trigger do banco.
// ============================================================================

import { getAdminClient } from '../_shared/supabase-admin.ts';
import { getCredential } from '../_shared/credentials.ts';
import { jsonResponse, preflight, corsHeaders } from '../_shared/cors.ts';
import {
  getChannelByMetaPhoneNumberId,
  type ChannelRow,
} from '../_shared/channels.ts';
import { metaTimingSafeEqual, verifyMetaSignature } from '../_shared/meta-cloud.ts';
import { phoneBrNormalize, phoneBrVariants } from '../_shared/phone-br.ts';

type AdminClient = ReturnType<typeof getAdminClient>;
type DeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';

const RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3 };

// --- helpers de leitura de payload ------------------------------------------

function asObj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return null;
}

// A Meta manda o wa_id em dígitos ('5573998040599'); o banco guarda E.164.
//
// Regra de negócio (06/09/2026): a Meta entrega número brasileiro SEM o nono
// dígito. `phoneBrNormalize` devolve a forma CANÔNICA (com o 9), que é a que
// gravamos; a busca do contato usa `phoneBrVariants` para casar as duas.
function normalizePhone(raw: string | null): string | null {
  return phoneBrNormalize(raw);
}

// --- idempotência -----------------------------------------------------------

// Um POST da Meta pode trazer VÁRIAS mensagens/status, então a dedup é por
// item, não por requisição. A tabela webhook_events tem PK global
// (zernio_event_id, nome herdado do Zernio) — prefixamos com 'meta:' para os
// espaços de id não colidirem.
// Retorna true quando o item é NOVO (deve ser processado).
async function claimEvent(
  admin: AdminClient,
  orgId: string,
  eventId: string,
  eventType: string,
): Promise<boolean> {
  const { error } = await admin
    .from('webhook_events')
    .insert({ org_id: orgId, zernio_event_id: eventId, event_type: eventType });
  if (!error) return true;
  if ((error as { code?: string }).code === '23505') return false; // já processado
  // Falha inesperada no registro não bloqueia o processamento.
  console.error(JSON.stringify({
    event: 'meta_webhook_event_claim_failed',
    message: error.message,
  }));
  return true;
}

// --- domínio (espelha o zernio-webhook) -------------------------------------

// Resolve o contato do remetente. `phone` já vem canônico (com o nono dígito).
//
// Regra de negócio: procurar por TODAS as formas equivalentes antes de criar.
// Sem isso, o paciente que a clínica cadastrou com o número completo vira um
// contato novo quando responde, porque a Meta entrega o wa_id sem o 9 — e aí
// o orçamento fica num contato e a resposta em outro.
async function findOrCreateContact(
  admin: AdminClient,
  orgId: string,
  phone: string,
  name: string | null,
): Promise<string | null> {
  const variants = phoneBrVariants(phone);
  const { data: matches } = await admin
    .from('contacts')
    .select('id, phone, created_at')
    .eq('org_id', orgId)
    .in('phone', variants.length > 0 ? variants : [phone])
    .order('created_at', { ascending: true });
  const rows = (matches ?? []) as Array<{ id: string; phone: string | null }>;
  if (rows.length > 0) {
    // Sobrevivente: o que já está na forma canônica; senão o mais antigo.
    const canonical = rows.find((r) => r.phone === phone);
    const chosen = canonical ?? rows[0];
    if (!canonical && rows.length === 1) {
      // Contato legado gravado na forma curta e sem concorrente: promove para a
      // canônica. Best-effort — se colidir com o índice único, segue como está.
      const { error: upErr } = await admin
        .from('contacts')
        .update({ phone })
        .eq('id', chosen.id);
      if (upErr) {
        console.log(JSON.stringify({
          event: 'meta_webhook_phone_canonicalize_skipped',
          contact_id: chosen.id,
        }));
      }
    }
    return chosen.id;
  }
  const { data: created, error } = await admin
    .from('contacts')
    .insert({ org_id: orgId, phone, name, source: 'whatsapp' })
    .select('id')
    .single();
  if (error) return null;
  return (created as { id: string }).id;
}

async function findOrCreateConversation(
  admin: AdminClient,
  orgId: string,
  contactId: string,
  channelRow: ChannelRow,
): Promise<string | null> {
  const { data: existing } = await admin
    .from('conversations')
    .select('id, provider, channel_id')
    .eq('org_id', orgId)
    .eq('contact_id', contactId)
    .maybeSingle();
  if (existing) {
    const row = existing as { id: string; provider: string | null; channel_id: string | null };
    // O último inbound decide o provedor da conversa (mesma regra do Zernio).
    // Não sobrescreve a atribuição de operador de conversas já existentes.
    const patch: Record<string, unknown> = {};
    if (row.channel_id !== channelRow.id) patch.channel_id = channelRow.id;
    if (row.provider !== 'meta') patch.provider = 'meta';
    if (Object.keys(patch).length > 0) {
      await admin.from('conversations').update(patch).eq('id', row.id);
    }
    return row.id;
  }

  const insert: Record<string, unknown> = {
    org_id: orgId,
    contact_id: contactId,
    status: 'ai_active',
    channel: 'whatsapp',
    provider: 'meta',
    channel_id: channelRow.id,
    last_message_at: new Date().toISOString(),
  };
  // Atribuição automática: conversa nova herda o operador do canal (se houver).
  if (channelRow.assigned_member) {
    insert.assigned_to = channelRow.assigned_member;
    insert.assigned_at = new Date().toISOString();
  }
  const { data: created, error } = await admin
    .from('conversations')
    .insert(insert)
    .select('id')
    .single();
  if (error) return null;
  const conversationId = (created as { id: string }).id;
  // IA desligada neste número: a conversa nasce direto no humano. O UPDATE
  // (não o INSERT) faz o flip ai_paused false→true, que dispara os triggers
  // de handoff.
  if (channelRow.ai_enabled === false) {
    await admin
      .from('conversations')
      .update({ status: 'human_active', ai_paused: true })
      .eq('id', conversationId);
  }
  return conversationId;
}

// Tipos de mensagem da Cloud API: text, image, audio, video, document, sticker,
// location, contacts, button, interactive, reaction, order, system, unknown.
// Mídia vem como { id, mime_type, sha256, caption? } — SEM url (ver
// metaResolveMediaUrl em _shared/meta-cloud.ts).
function decodeInbound(message: Record<string, unknown>): {
  contentType: 'text' | 'image' | 'audio' | 'video' | 'document';
  content: string | null;
  mediaId: string | null;
} {
  const type = (str(message, ['type']) ?? '').toLowerCase();
  const media = asObj(message[type]);
  const caption = str(media, ['caption']);
  const mediaId = str(media, ['id']);

  switch (type) {
    case 'text':
      return { contentType: 'text', content: str(asObj(message.text), ['body']) ?? '', mediaId: null };
    case 'image':
    case 'sticker':
      return { contentType: 'image', content: caption, mediaId };
    case 'audio':
    case 'voice':
      return { contentType: 'audio', content: null, mediaId };
    case 'video':
      return { contentType: 'video', content: caption, mediaId };
    case 'document':
      return { contentType: 'document', content: caption ?? str(media, ['filename']), mediaId };
    case 'button':
      // Resposta de botão de template: { button: { text, payload } }.
      return { contentType: 'text', content: str(asObj(message.button), ['text', 'payload']), mediaId: null };
    case 'interactive': {
      // Lista/botão interativo: { interactive: { button_reply|list_reply: { title } } }.
      const inter = asObj(message.interactive);
      const reply = asObj(inter.button_reply ?? inter.list_reply);
      return { contentType: 'text', content: str(reply, ['title', 'id']), mediaId: null };
    }
    case 'reaction':
      return { contentType: 'text', content: str(asObj(message.reaction), ['emoji']), mediaId: null };
    default:
      // location, contacts, order, system, unknown — registra como texto para o
      // operador ver que algo chegou, sem inventar conteúdo.
      return { contentType: 'text', content: `[mensagem do tipo ${type || 'desconhecido'}]`, mediaId: null };
  }
}

async function handleInboundMessage(
  admin: AdminClient,
  orgId: string,
  channelRow: ChannelRow,
  message: Record<string, unknown>,
  profileNameByWaId: Map<string, string>,
  errors: string[],
): Promise<void> {
  const wamid = str(message, ['id']);
  const phone = normalizePhone(str(message, ['from']));
  if (!phone) {
    errors.push('mensagem sem remetente');
    return;
  }
  if (wamid && !(await claimEvent(admin, orgId, `meta:msg:${wamid}`, 'meta.message.received'))) {
    return; // reentrega da Meta — já processada
  }

  const waId = (str(message, ['from']) ?? '').replace(/\D/g, '');
  const contactId = await findOrCreateContact(
    admin,
    orgId,
    phone,
    profileNameByWaId.get(waId) ?? null,
  );
  if (!contactId) {
    errors.push(`contato falhou: ${phone}`);
    return;
  }

  const conversationId = await findOrCreateConversation(admin, orgId, contactId, channelRow);
  if (!conversationId) {
    errors.push('conversa falhou');
    return;
  }

  // Dedup de mensagem (a Meta é at-least-once; o índice único cobre a corrida).
  if (wamid) {
    const { data: dup } = await admin
      .from('messages')
      .select('id')
      .eq('org_id', orgId)
      .eq('zernio_message_id', wamid)
      .maybeSingle();
    if (dup) return;
  }

  const { contentType, content, mediaId } = decodeInbound(message);
  // Mídia inbound: a Meta entrega só o id, e a URL do GET /{media_id} exige
  // Bearer e expira em ~5min — guardar essa URL em media_url não serve para o
  // front. Enquanto não houver rehospedagem em Storage, media_url fica null e
  // o id é registrado no log. Pendência aberta no MEMORIA.md.
  if (mediaId) {
    console.log(JSON.stringify({
      event: 'meta_inbound_media_unresolved',
      org_id: orgId,
      media_id: mediaId,
      content_type: contentType,
    }));
  }

  const { error: insErr } = await admin.from('messages').insert({
    org_id: orgId,
    conversation_id: conversationId,
    direction: 'inbound',
    sender_type: 'contact',
    content_type: contentType,
    content,
    media_url: null,
    zernio_message_id: wamid,
    is_private_note: false,
  });
  if (insErr) {
    if ((insErr as { code?: string }).code === '23505') return; // corrida de dedup
    errors.push(`message insert: ${insErr.message}`);
    return;
  }

  await admin.rpc('increment_unread_count', { p_conversation_id: conversationId });

  // Resposta do contato cancela follow-ups: marca o último campaign_contact ativo.
  const { data: ccHit } = await admin
    .from('campaign_contacts')
    .select('id, campaign_id')
    .eq('contact_id', contactId)
    .is('replied_at', null)
    .in('status', ['sent', 'delivered', 'read'])
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (ccHit) {
    await admin
      .from('campaign_contacts')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', (ccHit as { id: string }).id);
    await admin.rpc('bump_campaign_counter', {
      p_campaign_id: (ccHit as { campaign_id: string }).campaign_id,
      p_column: 'replied',
      p_delta: 1,
    });
  }
}

// statuses[]: { id (wamid da mensagem ENVIADA), status, timestamp,
// recipient_id, errors:[{ code, title, message, error_data:{ details } }] }.
async function handleStatus(
  admin: AdminClient,
  orgId: string,
  entry: Record<string, unknown>,
  errors: string[],
): Promise<void> {
  const wamid = str(entry, ['id']);
  const raw = (str(entry, ['status']) ?? '').toLowerCase();
  if (!wamid || !['sent', 'delivered', 'read', 'failed'].includes(raw)) return;
  const status = raw as DeliveryStatus;

  if (!(await claimEvent(admin, orgId, `meta:st:${wamid}:${status}`, `meta.message.${status}`))) {
    return;
  }

  const firstError = asObj(asArr(entry.errors)[0]);
  const reason = str(firstError, ['message', 'title'])
    ?? str(asObj(firstError.error_data), ['details']);

  await syncCampaignContactStatus(admin, orgId, status, wamid, reason);

  const { data: msg } = await admin
    .from('messages')
    .select('id, meta_status')
    .eq('org_id', orgId)
    .eq('zernio_message_id', wamid)
    .maybeSingle();
  if (!msg) return;
  const m = msg as { id: string; meta_status: string | null };
  if (status === 'failed') {
    await admin
      .from('messages')
      .update({
        meta_status: 'failed',
        error_reason: reason ?? 'Falha na entrega (sem detalhe da Meta)',
      })
      .eq('id', m.id);
    return;
  }
  // Funil monotônico: nunca regride (read não volta para delivered).
  if ((RANK[status] ?? 0) <= (RANK[m.meta_status ?? ''] ?? 0)) return;
  const { error: updErr } = await admin
    .from('messages')
    .update({ meta_status: status })
    .eq('id', m.id);
  if (updErr) errors.push(`status update: ${updErr.message}`);
}

// Avança a linha de campaign_contacts do envio 1:1 (match por wamid) e os
// contadores agregados da campanha. 'replied' é terminal e vem do inbound.
async function syncCampaignContactStatus(
  admin: AdminClient,
  orgId: string,
  status: DeliveryStatus,
  wamid: string,
  reason: string | null,
): Promise<void> {
  const { data: cc } = await admin
    .from('campaign_contacts')
    .select('id, campaign_id, status, delivered_at')
    .eq('org_id', orgId)
    .eq('zernio_message_id', wamid)
    .maybeSingle();
  if (!cc) return;
  const row = cc as {
    id: string;
    campaign_id: string;
    status: string;
    delivered_at: string | null;
  };
  if (!['sent', 'delivered'].includes(row.status)) return;

  const nowIso = new Date().toISOString();
  if (status === 'failed') {
    await admin
      .from('campaign_contacts')
      .update({ status: 'failed', error_message: reason ?? 'Falha na entrega' })
      .eq('id', row.id);
    await admin.rpc('bump_campaign_counter', {
      p_campaign_id: row.campaign_id,
      p_column: 'failed',
      p_delta: 1,
    });
    return;
  }
  if (status === 'sent') return; // já marcado no dispatch
  if ((RANK[status] ?? 0) <= (RANK[row.status] ?? 0)) return;

  const patch: Record<string, unknown> = { status };
  if (status === 'delivered') patch.delivered_at = nowIso;
  if (status === 'read') {
    patch.read_at = nowIso;
    if (!row.delivered_at) patch.delivered_at = nowIso;
  }
  await admin.from('campaign_contacts').update(patch).eq('id', row.id);
  await admin.rpc('bump_campaign_counter', {
    p_campaign_id: row.campaign_id,
    p_column: status,
    p_delta: 1,
  });
  if (status === 'read' && row.status === 'sent') {
    await admin.rpc('bump_campaign_counter', {
      p_campaign_id: row.campaign_id,
      p_column: 'delivered',
      p_delta: 1,
    });
  }
}

// field='message_template_status_update': { event: APPROVED|REJECTED|...,
// message_template_id, message_template_name, message_template_language,
// reason }. Substitui o polling de status de template.
async function handleTemplateStatus(
  admin: AdminClient,
  orgId: string,
  value: Record<string, unknown>,
): Promise<void> {
  const metaTemplateId = str(value, ['message_template_id']);
  const name = str(value, ['message_template_name']);
  const rawStatus = (str(value, ['event', 'status']) ?? '').toUpperCase();
  if (!metaTemplateId && !name) return;
  if (!(await claimEvent(
    admin,
    orgId,
    `meta:tpl:${metaTemplateId ?? name}:${rawStatus}`,
    'meta.template.status_updated',
  ))) {
    return;
  }

  const mapped: 'approved' | 'rejected' | 'pending' =
    rawStatus === 'APPROVED'
      ? 'approved'
      : ['REJECTED', 'DISABLED', 'PAUSED'].includes(rawStatus)
        ? 'rejected'
        : 'pending';

  const update: Record<string, unknown> = {
    meta_template_status: rawStatus || null,
    status: mapped,
  };
  if (mapped === 'approved') update.approved_at = new Date().toISOString();

  let query = admin.from('templates').update(update).eq('org_id', orgId);
  query = metaTemplateId
    ? query.eq('meta_template_id', metaTemplateId)
    : query.eq('name', name as string);
  await query;
}

// --- resolução de org -------------------------------------------------------

// Fallback usado só pelo desafio GET (que não carrega phone_number_id):
// ?org=<uuid> e, na ausência dele, a única organização ativa.
async function resolveOrgFromQuery(
  admin: AdminClient,
  orgFromQuery: string | null,
): Promise<string | null> {
  if (orgFromQuery) {
    const { data } = await admin
      .from('organizations')
      .select('id')
      .eq('id', orgFromQuery)
      .maybeSingle();
    return data ? (data as { id: string }).id : null;
  }
  const { data: actives } = await admin
    .from('organizations')
    .select('id')
    .eq('status', 'active')
    .limit(2);
  const rows = (actives ?? []) as Array<{ id: string }>;
  return rows.length === 1 ? rows[0].id : null;
}

// Espia o corpo BRUTO só para achar o phone_number_id → canal → org. Nenhuma
// ação é tomada com esse conteúdo antes da assinatura ser validada.
function peekPhoneNumberId(rawBody: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  for (const entry of asArr(asObj(parsed).entry)) {
    for (const change of asArr(asObj(entry).changes)) {
      const metadata = asObj(asObj(asObj(change).value).metadata);
      const id = str(metadata, ['phone_number_id']);
      if (id) return id;
    }
  }
  return null;
}

// --- entrypoint -------------------------------------------------------------

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const admin = getAdminClient();
  const url = new URL(req.url);

  // ---- GET: desafio de verificação da Meta ---------------------------------
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token') ?? '';
    const challenge = url.searchParams.get('hub.challenge') ?? '';
    if (mode !== 'subscribe' || !token || !challenge) {
      return jsonResponse({ ok: false, error: 'Invalid verification request' }, { status: 400 });
    }
    const orgId = await resolveOrgFromQuery(admin, url.searchParams.get('org'));
    if (!orgId) {
      console.log(JSON.stringify({ event: 'meta_webhook_verify_no_org' }));
      return jsonResponse({ ok: false, error: 'Forbidden' }, { status: 403 });
    }
    const expected = await getCredential(orgId, 'meta_webhook_verify_token');
    if (!expected || !metaTimingSafeEqual(token, expected)) {
      console.log(JSON.stringify({ event: 'meta_webhook_verify_token_mismatch', org_id: orgId }));
      return jsonResponse({ ok: false, error: 'Forbidden' }, { status: 403 });
    }
    // A Meta exige o challenge cru, em text/plain.
    return new Response(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain', ...corsHeaders },
    });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, { status: 405 });
  }

  // ---- POST: eventos -------------------------------------------------------
  // Corpo BRUTO primeiro: a assinatura é sobre o texto exato recebido.
  const rawBody = await req.text();

  const phoneNumberId = peekPhoneNumberId(rawBody);
  if (!phoneNumberId) {
    console.log(JSON.stringify({ event: 'meta_webhook_no_phone_number_id' }));
    return jsonResponse({ ok: true, skipped: 'no_phone_number_id' });
  }

  const channelRow = await getChannelByMetaPhoneNumberId(admin, phoneNumberId);
  if (!channelRow) {
    // Número não cadastrado em channels: aceitar (200) para a Meta não reenviar.
    console.log(JSON.stringify({
      event: 'meta_webhook_unknown_channel',
      phone_number_id: phoneNumberId,
    }));
    return jsonResponse({ ok: true, skipped: 'unknown_channel' });
  }
  const orgId = channelRow.org_id;

  const appSecret = await getCredential(orgId, 'meta_app_secret');
  if (!appSecret) {
    console.error(JSON.stringify({ event: 'meta_webhook_app_secret_missing', org_id: orgId }));
    return jsonResponse({ ok: false, error: 'Server misconfigured' }, { status: 500 });
  }

  const signature = req.headers.get('X-Hub-Signature-256');
  if (!signature) {
    return jsonResponse({ ok: false, error: 'Missing signature' }, { status: 401 });
  }
  if (!(await verifyMetaSignature(appSecret, rawBody, signature))) {
    console.log(JSON.stringify({ event: 'meta_webhook_invalid_signature', org_id: orgId }));
    return jsonResponse({ ok: false, error: 'Invalid signature' }, { status: 401 });
  }

  // Só depois da assinatura validada o payload vira dado confiável.
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const errors: string[] = [];
  try {
    for (const entry of asArr(asObj(payload).entry)) {
      for (const change of asArr(asObj(entry).changes)) {
        const changeObj = asObj(change);
        const field = str(changeObj, ['field']) ?? '';
        const value = asObj(changeObj.value);

        if (field === 'message_template_status_update') {
          await handleTemplateStatus(admin, orgId, value);
          continue;
        }
        if (field !== 'messages') continue;

        // Um change só pertence a este canal se o phone_number_id casar — um
        // POST com vários números não pode vazar mensagem entre orgs.
        const metaPhone = str(asObj(value.metadata), ['phone_number_id']);
        if (metaPhone && metaPhone !== channelRow.meta_phone_number_id) {
          console.log(JSON.stringify({
            event: 'meta_webhook_phone_mismatch',
            expected: channelRow.meta_phone_number_id,
            got: metaPhone,
          }));
          continue;
        }

        // contacts[] traz o nome do perfil, casado por wa_id.
        const profileNameByWaId = new Map<string, string>();
        for (const c of asArr(value.contacts)) {
          const contact = asObj(c);
          const waId = str(contact, ['wa_id']);
          const name = str(asObj(contact.profile), ['name']);
          if (waId && name) profileNameByWaId.set(waId.replace(/\D/g, ''), name);
        }

        for (const m of asArr(value.messages)) {
          await handleInboundMessage(
            admin,
            orgId,
            channelRow,
            asObj(m),
            profileNameByWaId,
            errors,
          );
        }
        for (const s of asArr(value.statuses)) {
          await handleStatus(admin, orgId, asObj(s), errors);
        }
      }
    }
  } catch (err) {
    console.error(JSON.stringify({
      event: 'meta_webhook_handler_error',
      message: err instanceof Error ? err.message : String(err),
    }));
    return jsonResponse({ ok: false, error: 'handler error' }, { status: 500 });
  }

  return jsonResponse({ ok: true, errors });
});
