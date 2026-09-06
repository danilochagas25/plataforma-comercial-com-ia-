// ============================================================================
// send-operator-media
// ----------------------------------------------------------------------------
// Operador anexa uma mídia (imagem/áudio/vídeo/documento) numa conversa. O
// arquivo chega como multipart/form-data e o destino depende do CANAL:
//   zernio / uazapi → sobe ao Zernio (/media/upload-direct, máx 25MB), envia
//     com attachmentUrl pela inbox 1:1 e persiste media_url = url do Zernio,
//     que o thread usa para renderizar. A ZERNIO_API_KEY nunca toca o browser.
//   meta (Cloud API direta) → sobe os bytes para a própria Meta
//     (POST /{phone_number_id}/media) e envia por media id. Nenhuma URL
//     pública nossa entra no caminho. Uma CÓPIA do arquivo é guardada no
//     bucket PRIVADO whatsapp-hub-inbox-media e media_url recebe a referência
//     '<bucket>/<org>/<conversa>/<mensagem>.<ext>' — assim o histórico do
//     atendimento fica completo no thread (pendência #36 do MEMORIA.md),
//     com a mesma retenção de 12 meses da mídia recebida.
//
// Notas privadas NÃO passam por aqui — são texto e nunca vão ao provedor.
// ============================================================================

import { requireOrgCaller, AuthError } from '../_shared/auth.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { ZernioError, uploadMediaDirect } from '../_shared/zernio.ts';
import { getSendContextForConversation, loadOrgZernioContext } from '../_shared/channels.ts';
import { MetaCloudError, metaSendMedia, metaUploadMedia } from '../_shared/meta-cloud.ts';
import { sendInboxWithResolve } from '../_shared/inbox-delivery.ts';
import { inboxMediaBuildRef, inboxMediaUpload } from '../_shared/inbox-media.ts';

const MAX_BYTES = 25 * 1024 * 1024;

function classify(mime: string): 'image' | 'audio' | 'video' | 'document' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'document';
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const caller = await requireOrgCaller(req);
    if (caller.role !== 'admin' && caller.role !== 'operator') {
      return jsonResponse({ ok: false, error: 'Sem permissão para enviar mensagens.' }, { status: 403 });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return jsonResponse({ ok: false, error: 'Esperado multipart/form-data.' }, { status: 400 });
    }

    const conversationId = String(form.get('conversation_id') ?? '').trim();
    const caption = String(form.get('content') ?? '').trim();
    const voiceNote = String(form.get('voice_note') ?? '') === 'true';
    const file = form.get('file');

    if (!conversationId) {
      return jsonResponse({ ok: false, error: 'conversation_id ausente.' }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return jsonResponse({ ok: false, error: 'Arquivo ausente.' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return jsonResponse({ ok: false, error: 'Arquivo excede 25MB.' }, { status: 400 });
    }

    const admin = getAdminClient();

    const { data: conv, error: convErr } = await admin
      .from('conversations')
      .select('id, org_id, contact_id, channel, channel_id, zernio_conversation_id, zernio_account_id, provider')
      .eq('id', conversationId)
      .maybeSingle();
    if (convErr) return jsonResponse({ ok: false, error: convErr.message }, { status: 500 });
    if (!conv) return jsonResponse({ ok: false, error: 'Conversa não encontrada.' }, { status: 404 });
    const convRow = conv as {
      id: string;
      org_id: string;
      contact_id: string;
      channel: 'whatsapp' | 'instagram' | null;
      channel_id?: string | null;
      zernio_conversation_id: string | null;
      zernio_account_id?: string | null;
      provider?: string | null;
    };
    // Cross-check de org: a conversa deve pertencer à org do caller.
    if (convRow.org_id !== caller.orgId) {
      return jsonResponse({ ok: false, error: 'Conversa não encontrada.' }, { status: 404 });
    }
    const channel = convRow.channel === 'instagram' ? 'instagram' : 'whatsapp';

    const contentType = classify(file.type || '');
    const mime = file.type || 'application/octet-stream';
    const filename = voiceNote ? 'voice-note.ogg' : (file.name || `arquivo-${contentType}`);
    const bytes = new Uint8Array(await file.arrayBuffer());

    const { data: contactRow } = await admin
      .from('contacts')
      .select('phone, instagram_id')
      .eq('id', convRow.contact_id)
      .maybeSingle();
    const contact = (contactRow as { phone?: string; instagram_id?: string } | null) ?? {};

    // 1. Roteia pelo CANAL da conversa ANTES de subir o arquivo. O Zernio é o
    //    host da mídia para zernio e uazapi, mas o canal Meta direto não tem
    //    esse host — e numa org só-Meta não existe Zernio API Key nenhuma, o
    //    que fazia o upload falhar com "Zernio API Key nao configurada".
    const sendCtx = await getSendContextForConversation(admin, {
      org_id: caller.orgId,
      channel_id: convRow.channel_id ?? null,
      provider: convRow.provider ?? null,
      zernio_account_id: convRow.zernio_account_id ?? null,
    });

    let mediaUrl: string | null = null;
    let providerMessageId: string | null = null;

    if (sendCtx.provider === 'meta') {
      if (channel !== 'whatsapp') {
        return jsonResponse({ ok: false, error: 'Canal Meta atende somente WhatsApp.' }, { status: 400 });
      }
      if (!contact.phone) {
        return jsonResponse({ ok: false, error: 'Contato sem telefone para envio pela Meta.' }, { status: 400 });
      }
      // 2a. Bytes direto para a Meta e envio por media id (sem URL pública).
      const { mediaId } = await metaUploadMedia(sendCtx.meta, {
        bytes,
        filename,
        mimeType: mime,
      });
      const sent = await metaSendMedia(sendCtx.meta, {
        phone: contact.phone,
        type: contentType,
        mediaId,
        caption: caption || undefined,
        filename,
      });
      providerMessageId = sent.messageId;
    } else {
      // 2b. Sobe a mídia ao Zernio (host da URL usada no attachmentUrl,
      //     inclusive para conversas UAZAPI que enviam a URL pela instância) e
      //     resolve a conversa 1:1, curando o id salvo se o Zernio o rejeitar.
      const zernio = await loadOrgZernioContext(admin, caller.orgId, convRow.zernio_account_id ?? null);
      mediaUrl = await uploadMediaDirect({ apiKey: zernio.apiKey, bytes, filename, contentType: mime });

      providerMessageId = await sendInboxWithResolve(
        admin,
        {
          conversationRowId: conversationId,
          orgId: caller.orgId,
          channel,
          phone: contact.phone ?? null,
          instagramId: contact.instagram_id ?? null,
          storedZernioConversationId: convRow.zernio_conversation_id,
          channelId: convRow.channel_id ?? null,
          zernioAccountId: convRow.zernio_account_id ?? null,
          provider: convRow.provider ?? null,
        },
        { attachmentUrl: mediaUrl, voiceNote, text: caption || undefined },
      );
    }

    // 3. Persiste a linha (media_url = url do Zernio quando houver; no canal
    //    Meta entra depois, com a referência da cópia no bucket privado).
    const { data: inserted, error: insErr } = await admin
      .from('messages')
      .insert({
        org_id: caller.orgId,
        conversation_id: conversationId,
        direction: 'outbound',
        sender_type: 'operator',
        sender_id: caller.userId,
        content_type: contentType,
        content: caption || null,
        media_url: mediaUrl,
        zernio_message_id: providerMessageId,
        meta_status: 'sent',
        is_private_note: false,
      })
      .select('id')
      .single();
    if (insErr) return jsonResponse({ ok: false, error: insErr.message }, { status: 500 });
    const messageId = (inserted as { id: string }).id;

    // 3b. Canal Meta: guarda a cópia do que o operador mandou, para o balão
    //     mostrar a mídia em vez do placeholder. A mensagem JÁ foi enviada e
    //     gravada — falhar aqui só custa a miniatura, nunca o envio.
    if (sendCtx.provider === 'meta') {
      try {
        const ref = inboxMediaBuildRef({
          orgId: caller.orgId,
          conversationId,
          messageId,
          mimeType: mime,
          filename,
        });
        await inboxMediaUpload(admin, ref, bytes, mime);
        const { error: refErr } = await admin
          .from('messages')
          .update({ media_url: ref.ref })
          .eq('id', messageId);
        if (refErr) throw new Error(refErr.message);
        mediaUrl = ref.ref;
      } catch (err) {
        console.error(JSON.stringify({
          event: 'operator_media_store_failed',
          message_id: messageId,
          message: err instanceof Error ? err.message : String(err),
        }));
      }
    }

    await admin
      .from('conversations')
      .update({
        last_message_at: new Date().toISOString(),
        status: 'human_active',
        ai_paused: true,
        assigned_to: caller.userId,
      })
      .eq('id', conversationId);

    return jsonResponse({
      ok: true,
      message_id: messageId,
      media_url: mediaUrl,
      provider: sendCtx.provider,
      sent_to_zernio: true,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonResponse({ ok: false, error: err.message }, { status: err.status });
    }
    if (err instanceof MetaCloudError) {
      return jsonResponse({ ok: false, error: err.message }, { status: err.status === 401 ? 401 : 502 });
    }
    if (err instanceof ZernioError) {
      return jsonResponse({ ok: false, error: err.message }, { status: err.status === 401 ? 401 : 502 });
    }
    console.error('send-operator-media error', err);
    return jsonResponse({ ok: false, error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 });
  }
});
