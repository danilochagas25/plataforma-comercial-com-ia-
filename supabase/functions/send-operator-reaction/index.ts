// ============================================================================
// send-operator-reaction
// ----------------------------------------------------------------------------
// A clínica reage com emoji a uma mensagem da conversa (👍, ❤️, …).
//
// Reação NÃO é mensagem: ela gruda numa mensagem que já existe. Por isso não
// inserimos linha em `messages` — gravamos o emoji na coluna `reaction` da
// mensagem alvo. Emoji vazio remove, que é como a própria Meta modela (não
// existe endpoint de "desreagir").
//
// A ordem importa: mandamos para a Meta ANTES de gravar. Ao contrário de uma
// mensagem — onde persistir primeiro é certo, porque o texto precisa aparecer
// na tela mesmo se a Meta recusar — uma reação que só existe no CRM é mentira
// visual: a atendente vê o 👍 e acredita que o paciente também vê.
// ============================================================================

import { requireOrgCaller, AuthError } from '../_shared/auth.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { getSendContextForConversation } from '../_shared/channels.ts';
import { metaSendReaction } from '../_shared/meta-cloud.ts';

interface Payload {
  message_id?: string;
  // Emoji, ou string vazia para remover a reação.
  emoji?: string;
}

// Um emoji só. O limite generoso de 16 é porque emoji composto (👍🏽, 👨‍👩‍👧)
// ocupa vários code points — cortar em 2 quebraria justamente os que as pessoas
// usam. Serve para barrar alguém enfiando um texto no campo.
const MAX_EMOJI_LENGTH = 16;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const caller = await requireOrgCaller(req);
    if (caller.role !== 'admin' && caller.role !== 'operator') {
      return jsonResponse({ ok: false, error: 'Sem permissão para reagir.' }, { status: 403 });
    }

    let body: Payload;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ ok: false, error: 'JSON inválido.' }, { status: 400 });
    }

    const messageId = body.message_id?.trim();
    const emoji = (body.emoji ?? '').trim();
    if (!messageId) return jsonResponse({ ok: false, error: 'message_id ausente.' }, { status: 400 });
    if (emoji.length > MAX_EMOJI_LENGTH) {
      return jsonResponse({ ok: false, error: 'Reação deve ser um emoji.' }, { status: 400 });
    }

    const admin = getAdminClient();

    const { data: msgRow, error: msgErr } = await admin
      .from('messages')
      .select('id, org_id, conversation_id, zernio_message_id, is_private_note, deleted_at')
      .eq('id', messageId)
      .maybeSingle();
    if (msgErr) return jsonResponse({ ok: false, error: msgErr.message }, { status: 500 });
    const msg = msgRow as {
      id: string;
      org_id: string;
      conversation_id: string;
      zernio_message_id: string | null;
      is_private_note: boolean;
      deleted_at: string | null;
    } | null;
    if (!msg || msg.org_id !== caller.orgId) {
      return jsonResponse({ ok: false, error: 'Mensagem não encontrada.' }, { status: 404 });
    }
    if (msg.deleted_at) {
      return jsonResponse({ ok: false, error: 'Mensagem apagada.' }, { status: 400 });
    }

    // Nota privada nunca saiu do CRM: a reação também não sai, e isso está
    // certo. Gravamos e devolvemos sem tocar na Meta.
    if (msg.is_private_note) {
      await admin.from('messages').update({ reaction: emoji || null }).eq('id', msg.id);
      return jsonResponse({ ok: true, sent_to_meta: false, reaction: emoji || null });
    }

    const { data: convRow } = await admin
      .from('conversations')
      .select('id, org_id, contact_id, channel, channel_id, provider, zernio_account_id')
      .eq('id', msg.conversation_id)
      .maybeSingle();
    const conv = convRow as {
      org_id: string;
      contact_id: string;
      channel: string | null;
      channel_id: string | null;
      provider: string | null;
      zernio_account_id: string | null;
    } | null;
    if (!conv || conv.org_id !== caller.orgId) {
      return jsonResponse({ ok: false, error: 'Conversa não encontrada.' }, { status: 404 });
    }

    const sendCtx = await getSendContextForConversation(admin, {
      org_id: conv.org_id,
      channel_id: conv.channel_id,
      provider: conv.provider,
      zernio_account_id: conv.zernio_account_id,
    });

    // Só a Meta tem reação implementada aqui. Nos outros provedores é melhor
    // recusar do que gravar um emoji que o paciente nunca vai ver.
    if (sendCtx.provider !== 'meta') {
      return jsonResponse(
        { ok: false, error: 'Reagir só está disponível no canal WhatsApp da Meta.' },
        { status: 400 },
      );
    }
    if (!msg.zernio_message_id) {
      return jsonResponse(
        { ok: false, error: 'Esta mensagem não chegou a ser entregue — não é possível reagir.' },
        { status: 400 },
      );
    }

    const { data: contactRow } = await admin
      .from('contacts')
      .select('phone')
      .eq('id', conv.contact_id)
      .maybeSingle();
    const phone = (contactRow as { phone?: string } | null)?.phone;
    if (!phone) {
      return jsonResponse({ ok: false, error: 'Contato sem telefone.' }, { status: 400 });
    }

    try {
      await metaSendReaction(sendCtx.meta, {
        phone,
        wamId: msg.zernio_message_id,
        emoji,
      });
    } catch (err) {
      console.log(JSON.stringify({
        event: 'reaction_send_failed',
        message_id: msg.id,
        error: err instanceof Error ? err.message : String(err),
      }));
      return jsonResponse(
        { ok: false, error: err instanceof Error ? err.message : 'Erro ao enviar a reação.' },
        { status: 502 },
      );
    }

    const { error: updErr } = await admin
      .from('messages')
      .update({ reaction: emoji || null })
      .eq('id', msg.id);
    if (updErr) return jsonResponse({ ok: false, error: updErr.message }, { status: 500 });

    return jsonResponse({ ok: true, sent_to_meta: true, reaction: emoji || null });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonResponse({ ok: false, error: err.message }, { status: err.status });
    }
    console.error('send-operator-reaction error', err);
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : 'Erro interno' },
      { status: 500 },
    );
  }
});
