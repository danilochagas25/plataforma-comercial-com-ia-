import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { useAppUser } from '@/app/providers/AppUserProvider';

/**
 * Quantas CONVERSAS estão esperando resposta — o número que vai no selo ao lado
 * de "Conversas" no menu.
 *
 * Contamos conversas, não mensagens. Para quem atende, "3 pessoas esperando" é
 * a informação acionável; "17 mensagens" pode ser um paciente só mandando
 * áudios seguidos e assusta à toa.
 *
 * Arquivadas não entram: arquivar é justamente dizer "já resolvi isso".
 *
 * A consulta usa `head: true` — o Postgres devolve só o total, nenhuma linha
 * trafega. Isso importa porque o hook vive no menu, montado em todas as telas.
 */
export function useUnreadConversations(): number {
  const { userId } = useAppUser();
  const [count, setCount] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const supabase = getSupabase();
    const { count: total, error } = await supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .gt('unread_count', 0)
      .eq('archived', false);
    // Falha de rede não deve zerar o selo e dar a impressão de "não tem nada
    // esperando" — mantemos o último número conhecido.
    if (!error) setCount(total ?? 0);
  }, [userId]);

  // Agrupa rajadas: uma conversa com várias mensagens chegando de uma vez
  // dispara vários eventos, e todos querem a mesma recontagem.
  const scheduleReload = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void load(); }, 400);
  }, [load]);

  useEffect(() => {
    void load();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [load]);

  useEffect(() => {
    if (!userId) return;
    const supabase = getSupabase();
    // Nome aleatório para sobreviver ao mount duplo do StrictMode — mesmo
    // padrão do useConversations.
    const suffix = Math.random().toString(36).slice(2, 10);
    const channel = supabase
      .channel(`unread:${suffix}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'whatsapp_hub', table: 'conversations' },
        () => { scheduleReload(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [userId, scheduleReload]);

  // A aba pode ficar horas em segundo plano e perder eventos do realtime;
  // ao voltar, recontamos.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  return count;
}
