// ============================================================================
// src/lib/conversations.ts — abrir a conversa de um contato na Caixa de Entrada
// ----------------------------------------------------------------------------
// Regra de negócio: até aqui, uma conversa só nascia quando o contato mandava
// a PRIMEIRA mensagem (o webhook do provedor cria a linha). Quem começa o
// contato é a clínica — orçamento não aprovado não escreve primeiro. Sem uma
// conversa aberta, o operador não tem onde clicar em "Reiniciar com template",
// que é o único envio permitido fora da janela de 24h.
//
// Esta função resolve isso: devolve a conversa existente do contato ou cria
// uma nova, carimbada no número (canal) conectado da organização.
// ============================================================================

import { getSupabase } from './supabase';

interface ChannelPick {
  id: string;
  provider: string;
  label: string | null;
}

/**
 * Get-or-create da conversa de um contato. Devolve o id da conversa.
 * Lança Error com mensagem em português quando não há número conectado.
 */
export async function ensureConversationForContact(contactId: string): Promise<string> {
  const supabase = getSupabase();

  // 1. Conversa que já existe (a mais antiga — é a "principal" do contato).
  const { data: existing, error: findErr } = await supabase
    .from('conversations')
    .select('id')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (findErr) throw new Error(findErr.message);
  if (existing) return (existing as { id: string }).id;

  // 2. Número conectado que vai atender. Preferimos o canal oficial da Meta
  //    (decisão vigente do projeto), depois zernio, e por último uazapi.
  const { data: channels, error: chErr } = await supabase
    .from('channels')
    .select('id, provider, label')
    .eq('is_active', true)
    .order('created_at', { ascending: true });
  if (chErr) throw new Error(chErr.message);
  const list = (channels ?? []) as ChannelPick[];
  const channel =
    list.find((c) => c.provider === 'meta')
    ?? list.find((c) => c.provider === 'zernio')
    ?? list[0];
  if (!channel) {
    throw new Error(
      'Nenhum número de WhatsApp conectado. Conecte um número em Configurações → Canais.',
    );
  }

  // 3. Cria já como atendimento humano: quem abriu foi o operador, então a IA
  //    não deve assumir a conversa sozinha nesse primeiro momento.
  //    `org_id` tem default whatsapp_hub.current_org_id() — não enviar.
  const { data: created, error: insErr } = await supabase
    .from('conversations')
    .insert({
      contact_id: contactId,
      channel: 'whatsapp',
      provider: channel.provider,
      channel_id: channel.id,
      status: 'human_active',
      ai_paused: true,
    })
    .select('id')
    .single();
  if (insErr) throw new Error(insErr.message);
  return (created as { id: string }).id;
}
