import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { useAppUser } from '@/app/providers/AppUserProvider';
import type { Message } from '@/types/inbox';

// Mensagem exibida na thread: pode ser uma linha real do banco ou um balão
// OTIMISTA (ainda sendo enviado). Os campos `_...` só existem no cliente.
export type ThreadMessage = Message & {
  _tempId?: string;
  _state?: 'pending' | 'sent' | 'failed';
  _realId?: string;
  _retry?: { text: string; isPrivate: boolean; opts?: SendOptions };
  // Chave de render estável: mantém o MESMO nó React quando o balão otimista é
  // substituído pela linha real (troca invisível, sem remontar/re-animar).
  _key?: string;
};

export interface SendResult {
  ok: boolean;
  zernioError?: string | null;
}

// Extras de um envio: citar uma mensagem, ou marcar que este texto veio
// encaminhado de outra conversa.
export interface SendOptions {
  replyToId?: string | null;
  forwardedFromId?: string | null;
}

interface UseMessagesResult {
  messages: ThreadMessage[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  sendText: (text: string, isPrivate: boolean, opts?: SendOptions) => Promise<SendResult>;
  retry: (tempId: string) => Promise<SendResult>;
  dismissFailed: (tempId: string) => void;
  // Ações sobre uma mensagem já existente.
  react: (messageId: string, emoji: string) => Promise<{ ok: boolean; error?: string }>;
  setStarred: (messageId: string, starred: boolean) => Promise<void>;
  setPinned: (messageId: string, pinned: boolean) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
}

// Campos das colunas novas para o balão OTIMISTA — o que ainda não foi para o
// banco nasce sem reação, sem estrela e não apagado.
const NEW_MESSAGE_DEFAULTS = {
  reaction: null,
  contact_reaction: null,
  deleted_at: null,
  deleted_by: null,
  starred: false,
  pinned: false,
} as const;

export function useMessages(conversationId: string | null): UseMessagesResult {
  const { userId } = useAppUser();
  const [real, setReal] = useState<Message[]>([]);
  const [optimistic, setOptimistic] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!conversationId) {
      setReal([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    const { data, error: err } = await supabase.schema('whatsapp_hub')
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (err) setError(err.message);
    else setReal((data ?? []) as Message[]);
    setLoading(false);
  }, [conversationId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Troca de conversa: descarta balões otimistas da conversa anterior.
  useEffect(() => {
    setOptimistic([]);
  }, [conversationId]);

  // Realtime: append new messages + update existing (meta_status transitions).
  useEffect(() => {
    if (!userId || !conversationId) return;
    const supabase = getSupabase();
    const suffix = Math.random().toString(36).slice(2, 10);
    const channel = supabase
      .channel(`messages:${conversationId}:${suffix}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'whatsapp_hub',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const next = payload.new as Message;
            setReal((prev) => (prev.some((m) => m.id === next.id) ? prev : [...prev, next]));
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as Message;
            setReal((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
          } else if (payload.eventType === 'DELETE') {
            const removed = payload.old as Message;
            setReal((prev) => prev.filter((m) => m.id !== removed.id));
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, conversationId]);

  // Concilia balões otimistas com as linhas reais. O casamento acontece assim
  // que a linha real CHEGA PELO REALTIME — não depende da resposta HTTP do
  // envio (que pode demorar enquanto o Zernio responde). Isso elimina o
  // "fantasma" duplicado (balão "enviando" + mensagem real ao mesmo tempo).
  //
  // Estratégia de casamento:
  //   1) por id (_realId), quando a resposta HTTP já voltou;
  //   2) fallback por conteúdo (mesma direção/remetente/nota/texto), para o
  //      caso comum em que a linha real chega antes da resposta HTTP.
  // A linha real casada herda o `_key` do balão otimista → a troca não remonta
  // o nó React (transição suave). Balões `failed` ficam de fora do fallback
  // para preservar as ações de reenviar/descartar.
  const messages = useMemo<ThreadMessage[]>(() => {
    const realIds = new Set(real.map((m) => m.id));
    const realToTemp = new Map<string, string>();
    const claimedOpt = new Set<string>();
    const claimedReal = new Set<string>();

    for (const o of optimistic) {
      const tempId = o._tempId;
      if (!tempId) continue;
      if (o._realId && realIds.has(o._realId) && !claimedReal.has(o._realId)) {
        realToTemp.set(o._realId, tempId);
        claimedOpt.add(tempId);
        claimedReal.add(o._realId);
      }
    }
    for (const o of optimistic) {
      const tempId = o._tempId;
      if (!tempId || claimedOpt.has(tempId) || o._state === 'failed') continue;
      const oTime = +new Date(o.created_at);
      const match = real.find(
        (m) =>
          !claimedReal.has(m.id) &&
          m.direction === 'outbound' &&
          m.sender_type === 'operator' &&
          m.is_private_note === o.is_private_note &&
          (m.content ?? '') === (o.content ?? '') &&
          +new Date(m.created_at) >= oTime - 30_000,
      );
      if (match) {
        realToTemp.set(match.id, tempId);
        claimedOpt.add(tempId);
        claimedReal.add(match.id);
      }
    }

    const merged: ThreadMessage[] = real.map((m) => {
      const tempId = realToTemp.get(m.id);
      return tempId ? { ...(m as ThreadMessage), _key: tempId } : (m as ThreadMessage);
    });
    for (const o of optimistic) {
      if (o._tempId && !claimedOpt.has(o._tempId)) merged.push({ ...o, _key: o._tempId });
    }
    return merged.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
  }, [real, optimistic]);

  // Executa (ou re-executa) o envio de um balão otimista e concilia o estado.
  const doSend = useCallback(
    async (
      tempId: string,
      text: string,
      isPrivate: boolean,
      opts?: SendOptions,
    ): Promise<SendResult> => {
      if (!conversationId) return { ok: false };
      setOptimistic((prev) =>
        prev.map((o) => (o._tempId === tempId ? { ...o, _state: 'pending' } : o)),
      );
      const supabase = getSupabase();
      const { data, error: err } = await supabase.functions.invoke('send-operator-message', {
        body: {
          conversation_id: conversationId,
          content: text,
          is_private_note: isPrivate,
          reply_to_id: opts?.replyToId ?? undefined,
          forwarded_from_id: opts?.forwardedFromId ?? undefined,
        },
      });
      if (err || !data?.ok) {
        setOptimistic((prev) =>
          prev.map((o) => (o._tempId === tempId ? { ...o, _state: 'failed' } : o)),
        );
        return { ok: false, zernioError: data?.error ?? err?.message ?? null };
      }
      setOptimistic((prev) =>
        prev.map((o) =>
          o._tempId === tempId
            ? { ...o, _state: 'sent', _realId: (data.message_id as string) ?? undefined }
            : o,
        ),
      );
      return { ok: true, zernioError: (data.zernio_error as string | undefined) ?? null };
    },
    [conversationId],
  );

  const sendText = useCallback(
    async (text: string, isPrivate: boolean, opts?: SendOptions): Promise<SendResult> => {
      const trimmed = text.trim();
      if (!conversationId || !trimmed) return { ok: false };
      const tempId = `temp-${crypto.randomUUID()}`;
      const bubble: ThreadMessage = {
        id: tempId,
        conversation_id: conversationId,
        direction: 'outbound',
        sender_type: 'operator',
        sender_id: userId,
        content_type: isPrivate ? 'note' : 'text',
        content: trimmed,
        media_url: null,
        zernio_message_id: null,
        meta_status: null,
        error_reason: null,
        is_private_note: isPrivate,
        created_at: new Date().toISOString(),
        ...NEW_MESSAGE_DEFAULTS,
        reply_to_id: opts?.replyToId ?? null,
        forwarded: Boolean(opts?.forwardedFromId),
        forwarded_from_id: opts?.forwardedFromId ?? null,
        _tempId: tempId,
        _state: 'pending',
        _retry: { text: trimmed, isPrivate, opts },
      };
      setOptimistic((prev) => [...prev, bubble]);
      return doSend(tempId, trimmed, isPrivate, opts);
    },
    [conversationId, userId, doSend],
  );

  const retry = useCallback(
    async (tempId: string): Promise<SendResult> => {
      const bubble = optimistic.find((o) => o._tempId === tempId);
      if (!bubble?._retry) return { ok: false };
      return doSend(tempId, bubble._retry.text, bubble._retry.isPrivate, bubble._retry.opts);
    },
    [optimistic, doSend],
  );

  const dismissFailed = useCallback((tempId: string) => {
    setOptimistic((prev) => prev.filter((o) => o._tempId !== tempId));
  }, []);

  // Reagir passa por Edge Function, não por UPDATE direto: a reação precisa
  // chegar ao aparelho do paciente, e só o backend tem o token da Meta. A
  // função grava a coluna depois de a Meta aceitar — um 👍 que existe só aqui
  // seria mentira visual.
  const react = useCallback(
    async (messageId: string, emoji: string): Promise<{ ok: boolean; error?: string }> => {
      const supabase = getSupabase();
      const { data, error: err } = await supabase.functions.invoke('send-operator-reaction', {
        body: { message_id: messageId, emoji },
      });
      if (err || !data?.ok) {
        return { ok: false, error: (data?.error as string) ?? err?.message ?? 'Erro ao reagir.' };
      }
      return { ok: true };
    },
    [],
  );

  // Favoritar, fixar e apagar são LOCAIS do CRM — nada disso viaja para o
  // WhatsApp do paciente — então vão por UPDATE direto, sem Edge Function.
  const setStarred = useCallback(async (messageId: string, starred: boolean) => {
    const supabase = getSupabase();
    await supabase.from('messages').update({ starred }).eq('id', messageId);
  }, []);

  const setPinned = useCallback(async (messageId: string, pinned: boolean) => {
    const supabase = getSupabase();
    await supabase.from('messages').update({ pinned }).eq('id', messageId);
  }, []);

  // Apagar é lógico. A Meta não tem endpoint para apagar mensagem entregue: o
  // paciente CONTINUA VENDO. Quem chama precisa dizer isso na tela.
  const deleteMessage = useCallback(async (messageId: string) => {
    const supabase = getSupabase();
    await supabase
      .from('messages')
      .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
      .eq('id', messageId);
  }, [userId]);

  return {
    messages, loading, error, reload, sendText, retry, dismissFailed,
    react, setStarred, setPinned, deleteMessage,
  };
}
