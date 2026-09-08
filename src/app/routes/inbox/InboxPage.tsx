import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, Inbox as InboxIcon, Info, PanelRightClose, PanelRightOpen, Pin, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { getSupabase } from '@/lib/supabase';
import { Avatar } from '@/components/ui/Avatar';
import { useAppUser } from '@/app/providers/AppUserProvider';
import { useAiChannels } from '@/hooks/useAiChannels';
import { useWhatsappProvider } from '@/hooks/useWhatsappProvider';
import { useConversations } from '@/hooks/useConversations';
import type { ConversationWithContact } from '@/types/inbox';
import { useMessages } from '@/hooks/useMessages';
import { operatorLabel, useOperators } from '@/hooks/useOperators';
import { useTags } from '@/hooks/useTags';
import { ConversationList } from '@/components/inbox/ConversationList';
import { MessageThread } from '@/components/inbox/MessageThread';
import { MessageInput } from '@/components/inbox/MessageInput';
import { CopilotPanel } from '@/components/inbox/CopilotPanel';
import { ContactPanel } from '@/components/inbox/ContactPanel';
import { ForwardDialog } from '@/components/inbox/ForwardDialog';
import { MessageInfoDialog } from '@/components/inbox/MessageInfoDialog';
import { exportarConversa } from '@/lib/conversationExport';
import type { ThreadMessage } from '@/hooks/useMessages';
import { InboxFilters } from '@/components/inbox/InboxFilters';
import {
  matchesFilters,
  readFiltersFromParams,
  sortConversations,
  writeFiltersToParams,
  type InboxFilterState,
  type InboxSort,
} from '@/components/inbox/inbox-filters';
import { LoadErrorBanner } from '@/components/LoadErrorBanner';
import { VOCAB } from '@/config/vocab';

export default function InboxPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFiltersState] = useState<InboxFilterState>(() =>
    readFiltersFromParams(searchParams),
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get('conversation'),
  );
  const [sort, setSort] = useState<InboxSort>('recente');
  // Ponte copiloto → caixa de mensagem. O botão "Usar" empurra o texto para o
  // MessageInput e PARA ALI: quem envia continua sendo a atendente, no botão
  // Enviar. O `token` cresce a cada clique para o efeito do input saber que é
  // um pedido novo, e não um re-render.
  const [copilotPrefill, setCopilotPrefill] = useState<{ text: string; token: number } | null>(null);
  const usarSugestao = useCallback((texto: string) => {
    setCopilotPrefill((prev) => ({ text: texto, token: (prev?.token ?? 0) + 1 }));
  }, []);
  // No mobile (<lg) mostramos uma coluna por vez: lista quando nada está
  // selecionado, senão a thread. O painel de contato vira um overlay.
  const [showPanelMobile, setShowPanelMobile] = useState(false);
  // Painel de contato (coluna direita, xl+) recolhível; preferência persiste.
  const [panelCollapsed, setPanelCollapsed] = useState(
    () => localStorage.getItem('inbox_panel_collapsed') === '1',
  );
  const togglePanel = () =>
    setPanelCollapsed((v) => {
      localStorage.setItem('inbox_panel_collapsed', v ? '0' : '1');
      return !v;
    });
  const { operators } = useOperators();
  const { tags } = useTags();
  const { userId, role } = useAppUser();
  const { aiEnabledForChannel } = useAiChannels();
  const { providerOf } = useWhatsappProvider();

  // Nome exibível do operador atribuído: display_name do perfil, senão a parte
  // local do e-mail (via list_operators).
  const operatorName = useCallback(
    (uid: string | null) => {
      if (!uid) return null;
      const op = operators.find((o) => o.user_id === uid);
      return op ? operatorLabel(op) : null;
    },
    [operators],
  );

  // Conversa atribuída a OUTRO operador fica bloqueada para quem não é admin.
  // Sem atribuição, todo mundo vê; admin vê tudo.
  const isLocked = useCallback(
    (c: ConversationWithContact) => role !== 'admin' && Boolean(c.assigned_to) && c.assigned_to !== userId,
    [role, userId],
  );

  // Persiste os filtros na querystring (namespace f*), preservando ?conversation.
  const updateFilters = (next: InboxFilterState) => {
    setFiltersState(next);
    setSearchParams((prev) => writeFiltersToParams(prev, next), { replace: true });
  };

  // Sync selectedId ↔ URL query. Notifications deep-link into the inbox with
  // ?conversation=<uuid> — we pick it up here and also update the URL when
  // the operator switches rows so sharing / bookmarks work.
  useEffect(() => {
    const fromUrl = searchParams.get('conversation');
    if (fromUrl && fromUrl !== selectedId) {
      setSelectedId(fromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (selectedId && searchParams.get('conversation') !== selectedId) {
      // Merge — não sobrescreve os params de filtro.
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.set('conversation', selectedId);
          return p;
        },
        { replace: true },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const {
    conversations,
    loading: loadingConvs,
    error: convError,
    reload: reloadConvs,
    setStatus,
    setAiPaused,
    setAssigned,
    setActiveDeal,
    setPinnedNote,
    setArchived,
    markRead,
    markUnread,
    setPinned,
    setMutedUntil,
    clearConversation,
    setContactBlocked,
  } = useConversations();

  // Conversa que o operador acabou de marcar como nao lida. No desktop a
  // auto-selecao reabriria justamente ela (a ordenacao poe as nao lidas no
  // topo) e o efeito de leitura desfaria a marcacao. Guardamos o id para
  // pular essa conversa ate ele escolher outra.
  const skipAutoSelect = useRef<string | null>(null);

  // Mensagem sendo citada na resposta, busca dentro da conversa e os dois
  // diálogos (encaminhar / dados). Tudo por conversa: trocar de conversa
  // limpa, senão a atendente responderia no paciente errado.
  const [replyTo, setReplyTo] = useState<ThreadMessage | null>(null);
  const [buscaThread, setBuscaThread] = useState('');
  const [buscaAberta, setBuscaAberta] = useState(false);
  const [encaminhar, setEncaminhar] = useState<ThreadMessage | null>(null);
  const [infoDe, setInfoDe] = useState<ThreadMessage | null>(null);
  const [focoMensagem, setFocoMensagem] = useState<string | null>(null);

  const visibleConversations = useMemo(() => {
    const now = Date.now();
    const filtered = conversations.filter((c) => matchesFilters(c, filters, now));
    return sortConversations(filtered, sort);
  }, [conversations, filters, sort]);

  const {
    messages: todasMensagens,
    loading: loadingMsgs,
    sendText,
    retry,
    dismissFailed,
    react,
    setStarred,
    setPinned: setMessagePinned,
    deleteMessage,
  } = useMessages(selectedId);

  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  // "Limpar conversa" esconde o que veio antes — as linhas continuam no banco.
  const messages = useMemo(() => {
    const corte = selected?.cleared_at ? new Date(selected.cleared_at).getTime() : 0;
    if (!corte) return todasMensagens;
    return todasMensagens.filter((m) => new Date(m.created_at).getTime() > corte);
  }, [todasMensagens, selected?.cleared_at]);

  // Se a conversa aberta for (re)atribuída a outro operador (deep-link ou
  // realtime), fecha imediatamente para quem não pode vê-la.
  useEffect(() => {
    if (selected && isLocked(selected)) setSelectedId(null);
  }, [selected, isLocked]);

  // Janela de 24h: aberta se a última mensagem do CONTATO foi há menos de 24h.
  // Fora dela, a Meta só permite reiniciar com template.
  const withinWindow = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].direction === 'inbound') {
        return Date.now() - new Date(messages[i].created_at).getTime() < 24 * 60 * 60 * 1000;
      }
    }
    return false;
  }, [messages]);

  // UAZAPI (não oficial) não tem janela de 24h — envio liberado sempre. A
  // trava só vale para a API oficial da Meta (WhatsApp Meta e Instagram).
  const selectedProvider = selected ? providerOf(selected) : 'meta';
  const effectiveWithinWindow = selectedProvider === 'uazapi' ? true : withinWindow;

  // Deep-link vindo do drawer do card do funil: ?contact=<uuid> seleciona a
  // conversa daquele contato assim que a lista carrega.
  useEffect(() => {
    const contactId = searchParams.get('contact');
    if (!contactId) return;
    const conv = conversations.find((c) => c.contact?.id === contactId);
    if (conv) setSelectedId(conv.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations]);

  // Auto-select the first conversation only on desktop (lg+). No mobile,
  // auto-selecionar esconderia a lista e jogaria o usuário direto na thread.
  useEffect(() => {
    if (typeof window !== 'undefined' && !window.matchMedia('(min-width: 1024px)').matches) {
      return;
    }
    if (searchParams.get('contact')) return; // deixa o deep-link por contato decidir
    const firstOpen = visibleConversations.find(
      (c) => !isLocked(c) && c.id !== skipAutoSelect.current,
    );
    if (!selectedId && firstOpen) {
      setSelectedId(firstOpen.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleConversations, selectedId]);

  // Trocar de conversa zera citação, busca e diálogos: responder ao paciente
  // errado por causa de estado que sobrou é o tipo de erro que não se desfaz.
  useEffect(() => {
    setReplyTo(null);
    setBuscaThread('');
    setBuscaAberta(false);
    setEncaminhar(null);
    setInfoDe(null);
    setFocoMensagem(null);
  }, [selectedId]);

  // Clear unread count when a conversation is open AND visible.
  useEffect(() => {
    if (selected && selected.unread_count > 0) {
      void markRead(selected.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selected?.unread_count]);

  const nomePaciente = selected?.contact?.name?.trim() || selected?.contact?.phone || '-';

  // Busca dentro da conversa acontece NO CLIENTE: as mensagens já estão todas
  // aqui, então ir ao banco seria uma ida de rede para reencontrar o que já
  // temos — e a digitação ficaria com atraso a cada tecla.
  const resultadosBusca = useMemo(() => {
    const q = buscaThread.trim().toLowerCase();
    if (!q) return [];
    return messages.filter((m) => (m.content ?? '').toLowerCase().includes(q));
  }, [messages, buscaThread]);

  const autorDe = useCallback((m: ThreadMessage): string => {
    if (m.direction === 'inbound') return nomePaciente;
    if (m.sender_type === 'ai') return 'a IA';
    if (m.sender_type === 'owner') return 'o WhatsApp do celular';
    return operatorName(m.sender_id) ?? 'a clínica';
  }, [nomePaciente, operatorName]);

  const aoReagir = useCallback(async (m: ThreadMessage, emoji: string) => {
    const res = await react(m.id, emoji);
    if (!res.ok) toast.error(res.error ?? 'Não foi possível reagir.');
  }, [react]);

  const aoApagarMensagem = useCallback((m: ThreadMessage) => {
    // A Meta não apaga mensagem já entregue. Dizer isso ANTES é a diferença
    // entre a atendente saber e a atendente achar que resolveu.
    const ok = window.confirm(
      'Apagar esta mensagem do CRM?\n\n'
      + 'Ela some da tela para a equipe, mas o paciente CONTINUA VENDO no WhatsApp dele — '
      + 'a Meta não permite apagar mensagem já entregue.',
    );
    if (!ok) return;
    void deleteMessage(m.id);
  }, [deleteMessage]);

  const aoEncaminhar = useCallback(async (destinos: string[]) => {
    const msg = encaminhar;
    if (!msg) return;
    const texto = msg.content?.trim();
    if (!texto) {
      toast.error('Só dá para encaminhar mensagem de texto por enquanto.');
      setEncaminhar(null);
      return;
    }
    const supabase = getSupabase();
    let enviadas = 0;
    for (const destino of destinos) {
      const { data, error } = await supabase.functions.invoke('send-operator-message', {
        body: {
          conversation_id: destino,
          content: texto,
          is_private_note: false,
          forwarded_from_id: msg.id,
        },
      });
      if (!error && data?.ok) enviadas += 1;
    }
    setEncaminhar(null);
    if (enviadas === destinos.length) {
      toast.success(`Encaminhada para ${enviadas} ${enviadas === 1 ? 'conversa' : 'conversas'}.`);
    } else {
      toast.error(`Encaminhada para ${enviadas} de ${destinos.length}. Confira as que falharam.`);
    }
    void reloadConvs();
  }, [encaminhar, reloadConvs]);

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl glass-card flex items-center justify-center">
            <InboxIcon className="h-5 w-5 text-[var(--accent-primary)]" />
          </div>
          <div>
            <div className="text-label">Seção</div>
            <h1 className="text-2xl font-bold text-display">{VOCAB.inbox}</h1>
          </div>
        </div>
      </div>

      {convError && (
        <div className="mb-3">
          <LoadErrorBanner message={convError} onRetry={() => void reloadConvs()} />
        </div>
      )}

      <div
        className={`flex-1 lg:grid gap-3 min-h-0 ${
          panelCollapsed ? 'lg:grid-cols-[300px_1fr_44px]' : 'lg:grid-cols-[300px_1fr_320px]'
        }`}
      >
        {/* Left: conversation list — no mobile some quando há conversa aberta */}
        <div
          className={`glass-card glass-card-static p-0 flex-col overflow-hidden h-full ${
            selectedId ? 'hidden lg:flex' : 'flex'
          }`}
        >
          <div className="p-3 border-b border-[var(--color-border-soft)] space-y-2">
            {/* Filtros + ordenação (os campos de nome/telefone/email vivem dentro
                do popover de Filtros — por isso não há mais busca solta aqui). */}
            <InboxFilters
              filters={filters}
              onChange={updateFilters}
              sort={sort}
              onSortChange={setSort}
              operators={operators}
              tags={tags}
            />
            <div className="flex justify-end">
              <span className="text-[11px] text-[var(--color-text-secondary)] whitespace-nowrap">
                {visibleConversations.length} conversa{visibleConversations.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            <ConversationList
              conversations={visibleConversations}
              loading={loadingConvs}
              selectedId={selectedId}
              onSelect={(id) => { skipAutoSelect.current = null; setSelectedId(id); }}
              aiEnabledForChannel={aiEnabledForChannel}
              operatorName={operatorName}
              isLocked={isLocked}
              providerOf={providerOf}
              onMarkUnread={(c) => {
                // Fechar a conversa é parte da ação, não um efeito colateral:
                // com ela aberta, o efeito que zera o contador (logo acima)
                // desfaria a marcação no mesmo instante.
                skipAutoSelect.current = c.id;
                if (selectedId === c.id) setSelectedId(null);
                void markUnread(c.id);
              }}
              onMarkRead={(c) => { void markRead(c.id); }}
              onArchive={(c, archived) => {
                if (archived && selectedId === c.id) setSelectedId(null);
                void setArchived(c.id, archived);
              }}
              onClose={(c) => { void setStatus(c.id, 'closed'); }}
              onPin={(c, pinned) => { void setPinned(c.id, pinned); }}
              onMute={(c, until) => { void setMutedUntil(c.id, until); }}
              onBlock={(c, blocked) => {
                if (!c.contact) return;
                if (blocked && !window.confirm(
                  `Bloquear ${c.contact.name?.trim() || c.contact.phone}?\n\n`
                  + 'Ele para de receber disparo e resposta automática da IA. '
                  + 'As mensagens que ele mandar continuam chegando aqui.',
                )) return;
                void setContactBlocked(c.contact.id, blocked);
              }}
              onShowContact={(c) => { setSelectedId(c.id); setShowPanelMobile(true); }}
              onExport={(c) => {
                if (c.id !== selectedId) {
                  // Só temos as mensagens da conversa ABERTA carregadas.
                  setSelectedId(c.id);
                  toast.info('Conversa aberta. Clique em Exportar de novo para baixar.');
                  return;
                }
                exportarConversa(messages, nomePaciente, c.contact?.phone ?? null);
              }}
              onClear={(c) => {
                if (!window.confirm(
                  'Limpar esta conversa?\n\n'
                  + 'As mensagens somem da tela, mas continuam guardadas no banco — '
                  + 'conversa de paciente é registro de atendimento e não se apaga de verdade.',
                )) return;
                void clearConversation(c.id);
              }}
              onDelete={(c) => {
                if (!window.confirm(
                  'Apagar esta conversa?\n\n'
                  + 'Ela sai da lista e a tela fica vazia. O histórico permanece no banco '
                  + 'para auditoria, e volta a aparecer se o paciente mandar mensagem de novo.',
                )) return;
                if (selectedId === c.id) setSelectedId(null);
                void clearConversation(c.id);
                void setArchived(c.id, true);
              }}
            />
          </div>
        </div>

        {/* Center: thread — no mobile ocupa a tela quando há conversa aberta */}
        <div
          className={`glass-card glass-card-static p-0 flex-col overflow-hidden h-full ${
            selectedId ? 'flex' : 'hidden lg:flex'
          }`}
        >
          {selected ? (
            <>
              <div className="flex items-center gap-2.5 border-b border-[var(--color-border-soft)] bg-[var(--color-bg-surface)] px-4 py-3">
                <button
                  onClick={() => setSelectedId(null)}
                  aria-label="Voltar à lista"
                  className="lg:hidden h-9 w-9 shrink-0 flex items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)] transition-all duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
                >
                  <ArrowLeft className="h-4.5 w-4.5" />
                </button>
                <Avatar
                  src={selected.contact?.profile_pic_url}
                  name={selected.contact?.name?.trim() || selected.contact?.phone || '-'}
                  size="md"
                  className="hidden shrink-0 sm:flex"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold text-[var(--color-text-primary)]">
                    {selected.contact?.name?.trim() || selected.contact?.phone || '-'}
                  </div>
                  <div className="truncate font-mono text-[11px] text-[var(--color-text-secondary)]">
                    {selected.contact?.phone}
                  </div>
                </div>
                {/* Janela de 24h: fora dela a Meta só aceita template. É a
                    primeira coisa que a recepção precisa saber antes de digitar. */}
                <span
                  className={`hidden shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold sm:inline-flex ${
                    effectiveWithinWindow
                      ? 'border-[rgba(15,122,85,0.35)] bg-[var(--color-success-bg)] text-[var(--color-success)]'
                      : 'border-[rgba(154,74,7,0.28)] bg-[var(--color-warning-bg)] text-[var(--color-warning)]'
                  }`}
                >
                  {selectedProvider === 'uazapi'
                    ? 'Sem janela'
                    : effectiveWithinWindow
                      ? 'Janela 24h aberta'
                      : 'Janela 24h fechada'}
                </span>
                <button
                  onClick={() => { setBuscaAberta((v) => !v); if (buscaAberta) setBuscaThread(''); }}
                  aria-label="Buscar nesta conversa"
                  title="Buscar nesta conversa"
                  className={`h-9 w-9 shrink-0 flex items-center justify-center rounded-lg transition-all duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] ${
                    buscaAberta
                      ? 'bg-[var(--color-accent-bg)] text-[var(--accent-primary)]'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  <Search className="h-4.5 w-4.5" />
                </button>
                <button
                  onClick={() => setShowPanelMobile(true)}
                  aria-label="Detalhes da conversa"
                  className="xl:hidden h-9 w-9 shrink-0 flex items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)] transition-all duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
                >
                  <Info className="h-4.5 w-4.5" />
                </button>
              </div>
              {buscaAberta && (
                <div className="flex items-center gap-2 border-b border-[var(--color-border-soft)] bg-[var(--color-bg-subtle)] px-4 py-2">
                  <Search className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-secondary)]" />
                  <input
                    autoFocus
                    value={buscaThread}
                    onChange={(e) => setBuscaThread(e.target.value)}
                    placeholder="Buscar nesta conversa..."
                    className="flex-1 bg-transparent text-[13px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
                  />
                  <span className="shrink-0 text-[11px] text-[var(--color-text-secondary)]">
                    {buscaThread.trim()
                      ? `${resultadosBusca.length} ${resultadosBusca.length === 1 ? 'resultado' : 'resultados'}`
                      : ''}
                  </span>
                  {/* Pular direto para o resultado mais recente: numa conversa
                      longa, achar "implante" e ainda ter que rolar é o mesmo
                      que não ter busca. */}
                  {resultadosBusca.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setFocoMensagem(resultadosBusca[resultadosBusca.length - 1].id)}
                      className="shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold text-[var(--accent-primary)] hover:bg-[var(--color-bg-surface)]"
                    >
                      Ir para o último
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="Fechar busca"
                    onClick={() => { setBuscaAberta(false); setBuscaThread(''); setFocoMensagem(null); }}
                    className="shrink-0 rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              {selected.pinned_note && (
                <div className="flex items-start gap-2 border-b border-[rgba(154,74,7,0.28)] bg-[var(--color-warning-bg)] px-4 py-2 text-sm text-[var(--color-warning)]">
                  <Pin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span className="text-[var(--color-text-primary)] whitespace-pre-wrap break-words">{selected.pinned_note}</span>
                </div>
              )}
              <MessageThread
                messages={messages}
                loading={loadingMsgs}
                onRetry={retry}
                onDismiss={dismissFailed}
                searchQuery={buscaThread}
                focusMessageId={focoMensagem}
                onReply={(m) => setReplyTo(m)}
                onReact={(m, emoji) => { void aoReagir(m, emoji); }}
                onToggleStar={(m) => { void setStarred(m.id, !m.starred); }}
                onTogglePin={(m) => { void setMessagePinned(m.id, !m.pinned); }}
                onForward={(m) => setEncaminhar(m)}
                onShowInfo={(m) => setInfoDe(m)}
                onDelete={aoApagarMensagem}
              />
              {selected.status !== 'closed' && (
                <>
                  {/* Copiloto entre a conversa e a caixa: a atendente lê o caso
                      e a sugestão logo acima de onde vai digitar. */}
                  <CopilotPanel conversationId={selected.id} onUsar={usarSugestao} />
                  <MessageInput
                    conversationId={selected.id}
                    withinWindow={effectiveWithinWindow}
                    onSendText={(text, isPrivate) => {
                      const opts = replyTo ? { replyToId: replyTo.id } : undefined;
                      setReplyTo(null);
                      return sendText(text, isPrivate, opts);
                    }}
                    prefill={copilotPrefill}
                    replyingTo={replyTo ? {
                      id: replyTo.id,
                      author: autorDe(replyTo),
                      preview: replyTo.content?.trim() || `[${replyTo.content_type}]`,
                    } : null}
                    onCancelReply={() => setReplyTo(null)}
                  />
                </>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-label">
                Selecione uma conversa
              </div>
            </div>
          )}
        </div>

        {/* Right: contact panel — coluna fixa só em xl; abaixo disso é overlay.
            Recolhível: vira uma régua estreita com botão de expandir. */}
        <div className="hidden xl:flex glass-card glass-card-static p-0 overflow-hidden h-full flex-col">
          {panelCollapsed ? (
            <button
              onClick={togglePanel}
              aria-label="Expandir painel de detalhes"
              title="Expandir painel"
              className="h-full w-full flex items-start justify-center pt-3 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)] transition-all duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
            >
              <PanelRightOpen className="h-4.5 w-4.5" />
            </button>
          ) : selected ? (
            <>
              <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border-soft)]">
                <span className="text-label">Detalhes</span>
                <button
                  onClick={togglePanel}
                  aria-label="Recolher painel de detalhes"
                  title="Recolher painel"
                  className="h-8 w-8 flex items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)] transition-all duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
                >
                  <PanelRightClose className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 min-h-0">
                <ContactPanel
                  conversation={selected}
                  withinWindow={effectiveWithinWindow}
                  provider={selectedProvider}
                  operators={operators}
                  aiEnabled={aiEnabledForChannel(selected.channel ?? null)}
                  assignedName={operatorName(selected.assigned_to)}
                  onPauseAI={() => setAiPaused(selected.id, true)}
                  onResumeAI={() => setAiPaused(selected.id, false)}
                  onClose={() => setStatus(selected.id, 'closed')}
                  onReopen={() => setStatus(selected.id, 'human_active')}
                  onAssign={(uid) => setAssigned(selected.id, uid)}
                  onSetActiveDeal={(dealId) => setActiveDeal(selected.id, dealId)}
                  onPinNote={(note) => setPinnedNote(selected.id, note)}
                  onArchive={(a) => setArchived(selected.id, a)}
                  onContactRefresh={() => void reloadConvs()}
                />
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-end px-2 py-2">
                <button
                  onClick={togglePanel}
                  aria-label="Recolher painel de detalhes"
                  title="Recolher painel"
                  className="h-8 w-8 flex items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)] transition-all duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
                >
                  <PanelRightClose className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 flex items-center justify-center p-6">
                <div className="text-label">Sem conversa selecionada</div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Overlay do painel de contato em telas < xl */}
      {selected && showPanelMobile && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <div
            className="absolute inset-0 bg-[rgba(23,40,43,0.38)] backdrop-blur-sm"
            onClick={() => setShowPanelMobile(false)}
          />
          <div className="absolute right-0 top-0 h-full w-80 max-w-[85vw] glass-surface border-l border-[var(--color-border-card)] overflow-y-auto">
            <div className="flex justify-end p-2">
              <button
                onClick={() => setShowPanelMobile(false)}
                aria-label="Fechar detalhes"
                className="h-11 w-11 flex items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)] transition-all duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <ContactPanel
              conversation={selected}
              withinWindow={effectiveWithinWindow}
              provider={selectedProvider}
              operators={operators}
              aiEnabled={aiEnabledForChannel(selected.channel ?? null)}
              assignedName={operatorName(selected.assigned_to)}
              onPauseAI={() => setAiPaused(selected.id, true)}
              onResumeAI={() => setAiPaused(selected.id, false)}
              onClose={() => setStatus(selected.id, 'closed')}
              onReopen={() => setStatus(selected.id, 'human_active')}
              onAssign={(uid) => setAssigned(selected.id, uid)}
              onSetActiveDeal={(dealId) => setActiveDeal(selected.id, dealId)}
              onPinNote={(note) => setPinnedNote(selected.id, note)}
              onArchive={(a) => setArchived(selected.id, a)}
              onContactRefresh={() => void reloadConvs()}
            />
          </div>
        </div>
      )}

      {encaminhar && (
        <ForwardDialog
          message={encaminhar}
          conversations={conversations}
          currentConversationId={selectedId}
          onCancel={() => setEncaminhar(null)}
          onConfirm={aoEncaminhar}
        />
      )}

      {infoDe && (
        <MessageInfoDialog
          message={infoDe}
          senderLabel={autorDe(infoDe)}
          onClose={() => setInfoDe(null)}
        />
      )}
    </div>
  );
}
