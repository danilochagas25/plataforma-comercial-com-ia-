import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  CheckCheck,
  ChevronDown,
  Copy,
  Instagram,
  KeyRound,
  Loader2,
  MessageCircle,
  Phone,
  Plus,
  ShieldCheck,
  UserRound,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/app/providers/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { operatorLabel, useOperators } from '@/hooks/useOperators';
import { InstagramCard } from './InstagramCard';

// Configurações → Canais. Multi-número: cada linha de whatsapp_hub.channels é
// um número de WhatsApp da organização —
//   · provider 'zernio'  — API oficial da Meta via Zernio (janela de 24h)
//   · provider 'uazapi'  — instância UAZAPI própria (sem janela)
//   · provider 'meta'    — API oficial da Meta DIRETO, sem intermediário
// Cada número pode ser vinculado a um membro: conversas que chegam por aquele
// número são atribuídas automaticamente a ele (sem vínculo, vale o round-robin).

interface ChannelRow {
  id: string;
  provider: 'zernio' | 'uazapi' | 'meta';
  label: string;
  phone: string | null;
  zernio_account_id: string | null;
  meta_waba_id: string | null;
  meta_phone_number_id: string | null;
  assigned_member: string | null;
  is_active: boolean;
  ai_enabled: boolean;
}

// Status do número lido da Graph API (GET /api/meta-connect).
// platformType === 'CLOUD_API' é a prova de que o número foi REGISTRADO na
// Cloud API — adicionar e verificar por SMS não registra. Sem registro o
// número envia, mas não recebe: a conversa chega sem campo de digitação.
interface MetaChannelStatus {
  id: string;
  connected: boolean;
  status: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  platformType: string | null;
  codeVerificationStatus: string | null;
}

type ConnState = boolean | null; // null = carregando

const ZERNIO_COLOR = '#25D366';
const UAZAPI_COLOR = '#2DD4BF';
const META_COLOR = '#0866FF';

// Identificadores da conta Meta da clínica (Odontologia), confirmados na tela
// do Gerenciador em 05/09/2026. Não são segredo — só pré-preenchem o
// formulário; o operador pode trocar qualquer um deles.
const META_DEFAULTS = {
  label: 'WhatsApp Odonto (oficial)',
  phone: '+5573998040599',
  wabaId: '1500039648549092',
  phoneNumberId: '1308096539052095',
};

// Fallback: a URL real vem do backend (montada a partir do SUPABASE_URL).
const META_WEBHOOK_URL_FALLBACK =
  'https://feptvmsjzreovfynrlql.supabase.co/functions/v1/meta-webhook';

// Mesma pintura dos inputs das outras seções, extraída porque o formulário da
// Meta tem sete campos.
const FIELD_CLASS =
  'w-full rounded-lg border border-[rgba(212,165,116,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:border-[var(--accent-primary)] focus:outline-none';

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={
        active
          ? 'inline-flex items-center gap-1.5 rounded-full bg-[rgba(16,185,129,0.12)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.05em] text-[#10B981]'
          : 'inline-flex items-center gap-1.5 rounded-full bg-[rgba(148,163,184,0.12)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--color-text-secondary)]'
      }
    >
      <span
        className={
          active
            ? 'h-1.5 w-1.5 rounded-full bg-[#10B981] shadow-[0_0_6px_rgba(16,185,129,0.8)]'
            : 'h-1.5 w-1.5 rounded-full bg-[#64748B]'
        }
      />
      {active ? 'Ativo' : 'Desativado'}
    </span>
  );
}

// Avatar do membro vinculado — foto se houver, senão iniciais.
function MemberAvatar({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name} className="h-6 w-6 rounded-full object-cover" />;
  }
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[rgba(212,165,116,0.18)] text-[10px] font-bold text-[#E8C89A]">
      {initials || <UserRound className="h-3.5 w-3.5" />}
    </span>
  );
}

export function ChannelsSettings() {
  const { session } = useAuth();
  const { operators } = useOperators();
  const [channels, setChannels] = useState<ChannelRow[] | null>(null);
  const [instagram, setInstagram] = useState<ConnState>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showUazapiForm, setShowUazapiForm] = useState(false);
  const [uazForm, setUazForm] = useState({ label: '', serverUrl: '', token: '' });
  const [savingUaz, setSavingUaz] = useState(false);
  const [zernioChoices, setZernioChoices] = useState<{ id: string; name: string }[] | null>(null);
  const [connectingZernio, setConnectingZernio] = useState(false);
  // Zernio API Key (credencial em app_settings) — conecta números oficiais +
  // Instagram. Fica recolhida quando já configurada para não poluir a tela.
  const [showZernioKey, setShowZernioKey] = useState(false);
  const [zernioKey, setZernioKey] = useState('');
  const [zernioKeyExists, setZernioKeyExists] = useState(false);
  const [savingZernioKey, setSavingZernioKey] = useState(false);
  // Canal Meta direto (provider 'meta'). Identificadores pré-preenchidos, os
  // três segredos sempre em branco — o CRM nunca devolve valor de segredo.
  const [showMetaForm, setShowMetaForm] = useState(false);
  const [metaForm, setMetaForm] = useState({
    ...META_DEFAULTS,
    token: '',
    appSecret: '',
    verifyToken: '',
  });
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaSecrets, setMetaSecrets] = useState({ appSecret: false, verifyToken: false });
  const [metaWebhookUrl, setMetaWebhookUrl] = useState(META_WEBHOOK_URL_FALLBACK);
  const [metaStatus, setMetaStatus] = useState<Record<string, MetaChannelStatus>>({});
  const [webhookCopied, setWebhookCopied] = useState(false);
  // Registro do número na Cloud API: PIN de 6 dígitos por canal. O valor vive
  // só no formulário e é limpo assim que a chamada termina.
  const [showRegisterFor, setShowRegisterFor] = useState<string | null>(null);
  const [registerPin, setRegisterPin] = useState('');
  const [registeringId, setRegisteringId] = useState<string | null>(null);

  const loadChannels = useCallback(async () => {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .schema('whatsapp_hub')
      .from('channels')
      .select(
        'id, provider, label, phone, zernio_account_id, meta_waba_id, meta_phone_number_id, assigned_member, is_active, ai_enabled',
      )
      .order('created_at');
    if (error) {
      toast.error('Falha ao carregar os números', { description: error.message });
      setChannels([]);
      return;
    }
    setChannels((data ?? []) as ChannelRow[]);
  }, []);

  const loadInstagramStatus = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch('/api/zernio-connect', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const body = (await res.json()) as { connected?: boolean };
      setInstagram(Boolean(body.connected));
    } catch {
      setInstagram(false);
    }
  }, [session]);

  // Quais segredos já estão no cofre da org (só o "existe", nunca o valor).
  const loadCredentialStatus = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch(
        '/api/credentials?keys=zernio_api_key,meta_app_secret,meta_webhook_verify_token',
        { headers: { Authorization: `Bearer ${session.access_token}` } },
      );
      const body = (await res.json()) as Record<string, { exists?: boolean }>;
      setZernioKeyExists(Boolean(body?.zernio_api_key?.exists));
      setMetaSecrets({
        appSecret: Boolean(body?.meta_app_secret?.exists),
        verifyToken: Boolean(body?.meta_webhook_verify_token?.exists),
      });
    } catch {
      // status informativo — falha aqui não bloqueia a edição.
    }
  }, [session]);

  // Status dos números Meta direto na Graph API (nome verificado e qualidade).
  const loadMetaStatus = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch('/api/meta-connect', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const body = (await res.json()) as {
        webhookUrl?: string;
        channels?: MetaChannelStatus[];
      };
      if (body.webhookUrl) setMetaWebhookUrl(body.webhookUrl);
      setMetaStatus(
        Object.fromEntries((body.channels ?? []).map((c) => [c.id, c])),
      );
    } catch {
      // status informativo — a listagem do canal vem do banco, não daqui.
    }
  }, [session]);

  useEffect(() => {
    void loadChannels();
    void loadInstagramStatus();
    void loadCredentialStatus();
    void loadMetaStatus();
  }, [loadChannels, loadInstagramStatus, loadCredentialStatus, loadMetaStatus]);

  const zernioChannels = useMemo(
    () => (channels ?? []).filter((c) => c.provider === 'zernio'),
    [channels],
  );
  const uazapiChannels = useMemo(
    () => (channels ?? []).filter((c) => c.provider === 'uazapi'),
    [channels],
  );
  const metaChannels = useMemo(
    () => (channels ?? []).filter((c) => c.provider === 'meta'),
    [channels],
  );
  const activeCount = (channels ?? []).filter((c) => c.is_active).length;

  // Salva a Zernio API Key e já tenta conectar (resolve conta + webhook).
  const saveZernioKey = async () => {
    if (!session || !zernioKey.trim()) return;
    setSavingZernioKey(true);
    try {
      const res = await fetch('/api/credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ credentials: { zernio_api_key: zernioKey.trim() } }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.message ?? 'Falha ao salvar a chave.');
      setZernioKeyExists(true);
      setZernioKey('');
      setShowZernioKey(false);
      toast.success('Zernio API Key salva.');
      await connectZernio();
    } catch (err) {
      toast.error('Falha ao salvar a Zernio API Key', {
        description: err instanceof Error ? err.message : 'Erro interno',
      });
    } finally {
      setSavingZernioKey(false);
    }
  };

  // Vincula/desvincula o membro responsável pelo número (atribuição automática).
  const setAssignedMember = async (channel: ChannelRow, userId: string | null) => {
    setBusy(channel.id);
    const supabase = getSupabase();
    const { error } = await supabase
      .schema('whatsapp_hub')
      .from('channels')
      .update({ assigned_member: userId })
      .eq('id', channel.id);
    setBusy(null);
    if (error) {
      toast.error('Falha ao vincular membro', { description: error.message });
      return;
    }
    toast.success(userId ? 'Membro vinculado ao número.' : 'Vínculo removido.');
    void loadChannels();
  };

  // Liga/desliga o agente de IA neste número (refina o toggle global da IA).
  const toggleChannelAi = async (channel: ChannelRow) => {
    setBusy(channel.id);
    const supabase = getSupabase();
    const { error } = await supabase
      .schema('whatsapp_hub')
      .from('channels')
      .update({ ai_enabled: !channel.ai_enabled })
      .eq('id', channel.id);
    setBusy(null);
    if (error) {
      toast.error('Falha ao atualizar a IA do número', { description: error.message });
      return;
    }
    toast.success(
      channel.ai_enabled
        ? 'IA desligada neste número: conversas novas vão direto para o humano.'
        : 'IA ligada neste número.',
    );
    void loadChannels();
  };

  const toggleActive = async (channel: ChannelRow) => {
    setBusy(channel.id);
    const supabase = getSupabase();
    const { error } = await supabase
      .schema('whatsapp_hub')
      .from('channels')
      .update({ is_active: !channel.is_active })
      .eq('id', channel.id);
    setBusy(null);
    if (error) {
      toast.error('Falha ao atualizar o número', { description: error.message });
      return;
    }
    void loadChannels();
  };

  // Conecta/reconecta números da conta Zernio (a API Key precisa estar salva).
  // Com várias contas, o backend devolve needsSelection.
  const connectZernio = async (accountId?: string) => {
    if (!session) return;
    setConnectingZernio(true);
    try {
      const res = await fetch('/api/zernio-connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(accountId ? { accountId } : {}),
      });
      const body = await res.json();
      if (res.ok && body.needsSelection) {
        setZernioChoices(body.accounts ?? []);
        return;
      }
      if (!res.ok || !body.success) {
        throw new Error(body.message ?? 'Falha ao conectar o número no Zernio.');
      }
      setZernioChoices(null);
      toast.success('Número Zernio conectado.');
      void loadChannels();
      void loadInstagramStatus();
    } catch (err) {
      toast.error('Falha ao conectar via Zernio', {
        description: err instanceof Error ? err.message : 'Erro interno',
      });
    } finally {
      setConnectingZernio(false);
    }
  };

  // Cria (ou revalida) uma instância UAZAPI como canal da org.
  const saveUazapiChannel = async () => {
    if (!session) return;
    setSavingUaz(true);
    try {
      const res = await fetch('/api/uazapi-connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          label: uazForm.label.trim() || undefined,
          serverUrl: uazForm.serverUrl.trim(),
          token: uazForm.token.trim(),
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.message ?? 'Falha ao conectar a instância UAZAPI.');
      }
      toast.success('Instância UAZAPI conectada e webhook cadastrado.');
      setShowUazapiForm(false);
      setUazForm({ label: '', serverUrl: '', token: '' });
      void loadChannels();
    } catch (err) {
      toast.error('Falha ao conectar a UAZAPI', {
        description: err instanceof Error ? err.message : 'Erro interno',
      });
    } finally {
      setSavingUaz(false);
    }
  };

  // Cria (ou revalida) o canal Meta direto. O backend testa o par
  // Phone Number ID + token na Graph API antes de gravar qualquer coisa.
  const saveMetaChannel = async () => {
    if (!session) return;
    setSavingMeta(true);
    try {
      const existing = metaChannels.find(
        (c) => c.meta_phone_number_id === metaForm.phoneNumberId.trim(),
      );
      const res = await fetch('/api/meta-connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          channelId: existing?.id,
          label: metaForm.label.trim() || undefined,
          phone: metaForm.phone.trim() || undefined,
          wabaId: metaForm.wabaId.trim(),
          phoneNumberId: metaForm.phoneNumberId.trim(),
          token: metaForm.token.trim(),
          appSecret: metaForm.appSecret.trim(),
          verifyToken: metaForm.verifyToken.trim(),
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.message ?? 'Falha ao conectar o número na Meta.');
      }
      if (body.webhookUrl) setMetaWebhookUrl(body.webhookUrl);
      // Segredo digitado nunca fica em memória depois de salvo.
      setMetaForm((f) => ({ ...f, token: '', appSecret: '', verifyToken: '' }));
      toast.success('Número conectado na Meta.', {
        description: [
          body.verifiedName ? `Nome verificado: ${body.verifiedName}` : null,
          body.qualityRating ? `qualidade ${body.qualityRating}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
      });
      if (body.wabaWarning) {
        toast.warning('Conta do WhatsApp (WABA) não confirmada', {
          description: String(body.wabaWarning),
        });
      }
      void loadChannels();
      void loadCredentialStatus();
      void loadMetaStatus();
    } catch (err) {
      toast.error('Falha ao conectar na Meta', {
        description: err instanceof Error ? err.message : 'Erro interno',
      });
    } finally {
      setSavingMeta(false);
    }
  };

  const copyWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText(metaWebhookUrl);
      setWebhookCopied(true);
      window.setTimeout(() => setWebhookCopied(false), 2000);
      toast.success('URL do webhook copiada.');
    } catch {
      toast.error('Não foi possível copiar. Selecione a URL e copie manualmente.');
    }
  };

  // Registra o número na Cloud API (POST /{phone_number_id}/register na Meta).
  // É o passo que faz o número existir como conta de WhatsApp — sem ele o CRM
  // envia e a Meta entrega, mas o destinatário não consegue responder.
  const registerMetaNumber = async (channelId: string) => {
    if (!session) return;
    const pin = registerPin.trim();
    if (!/^\d{6}$/.test(pin)) {
      toast.error('PIN inválido', {
        description: 'Digite exatamente 6 dígitos numéricos, sem espaço.',
      });
      return;
    }
    setRegisteringId(channelId);
    try {
      const res = await fetch('/api/meta-connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: 'register', channelId, pin }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.message ?? 'Falha ao registrar o número na Meta.');
      }
      setRegisterPin('');
      setShowRegisterFor(null);
      toast.success('Número registrado na Cloud API.', {
        description: [
          body.platformType ? `Plataforma: ${body.platformType}` : null,
          body.codeVerificationStatus ? `verificação: ${body.codeVerificationStatus}` : null,
          body.qualityRating ? `qualidade ${body.qualityRating}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
      });
      if (body.pinWarning) {
        toast.warning('PIN não guardado', { description: String(body.pinWarning) });
      }
      if (body.infoWarning) {
        toast.warning('Estado do número não relido', { description: String(body.infoWarning) });
      }
      void loadMetaStatus();
    } catch (err) {
      toast.error('Falha ao registrar o número', {
        description: err instanceof Error ? err.message : 'Erro interno',
      });
    } finally {
      setRegisteringId(null);
    }
  };

  const findOperator = (userId: string | null) =>
    userId ? operators.find((o) => o.user_id === userId) : undefined;

  // Card de um número — usado nas três seções (Zernio, UAZAPI e Meta).
  const renderChannelCard = (channel: ChannelRow) => {
    const owner = findOperator(channel.assigned_member);
    const accent = channel.provider === 'uazapi'
      ? UAZAPI_COLOR
      : channel.provider === 'meta'
        ? META_COLOR
        : ZERNIO_COLOR;
    return (
      <div
        key={channel.id}
        className="glass-card p-4"
        style={{ borderLeft: `3px solid ${channel.is_active ? accent : 'rgba(148,163,184,0.3)'}` }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold text-[var(--color-text-primary)]">
                {channel.label}
              </span>
              <StatusBadge active={channel.is_active} />
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
              <Phone className="h-3 w-3 shrink-0" />
              <span className="font-mono">{channel.phone ?? 'número não identificado'}</span>
            </div>
          </div>
          <button
            onClick={() => void toggleActive(channel)}
            disabled={busy === channel.id}
            className="shrink-0 rounded-lg border border-[rgba(212,165,116,0.25)] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-[var(--color-text-primary)] transition hover:border-[var(--accent-primary)] disabled:opacity-50"
          >
            {channel.is_active ? 'Desativar' : 'Reativar'}
          </button>
        </div>

        {/* Operador responsável — conversas deste número vão direto para ele. */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[rgba(212,165,116,0.08)] pt-3">
          {owner ? (
            <MemberAvatar name={operatorLabel(owner)} avatarUrl={owner.avatar_url} />
          ) : (
            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-[rgba(148,163,184,0.35)]">
              <UserRound className="h-3.5 w-3.5 text-[var(--color-text-secondary)]" />
            </span>
          )}
          <select
            value={channel.assigned_member ?? ''}
            disabled={busy === channel.id}
            onChange={(e) => void setAssignedMember(channel, e.target.value || null)}
            className="min-w-0 flex-1 rounded-lg border border-[rgba(212,165,116,0.2)] bg-[rgba(15,18,35,0.8)] px-3 py-1.5 text-xs text-[var(--color-text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
            title="Operador responsável: conversas deste número são atribuídas a ele"
          >
            <option value="">Sem operador fixo (round-robin da equipe)</option>
            {operators.map((op) => (
              <option key={op.user_id} value={op.user_id}>
                {operatorLabel(op)}
              </option>
            ))}
          </select>
        </div>

        {/* IA por número — refina o toggle global (Configurações → Agente IA). */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[rgba(212,165,116,0.08)] pt-3">
          <Bot
            className="h-4 w-4 shrink-0"
            style={{ color: channel.ai_enabled ? '#E8C89A' : 'var(--color-text-secondary)' }}
          />
          <div className="min-w-0 flex-1">
            <span className="text-xs font-medium text-[var(--color-text-primary)]">
              Agente de IA neste número
            </span>
            {!channel.ai_enabled ? (
              <p className="text-[11px] text-[var(--color-text-secondary)]">
                Conversas novas vão direto para o operador vinculado (ou rodízio da equipe).
              </p>
            ) : null}
          </div>
          <button
            role="switch"
            aria-checked={channel.ai_enabled}
            onClick={() => void toggleChannelAi(channel)}
            disabled={busy === channel.id}
            className="relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-50"
            style={{
              background: channel.ai_enabled ? 'var(--accent-primary)' : 'rgba(148,163,184,0.3)',
            }}
            title={channel.ai_enabled ? 'IA ligada neste número' : 'IA desligada neste número'}
          >
            <span
              className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all"
              style={{ left: channel.ai_enabled ? '18px' : '2px' }}
            />
          </button>
        </div>
      </div>
    );
  };

  const loading = channels === null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <div className="text-label">Canais</div>
        <h2 className="text-xl font-bold text-display">Números de WhatsApp</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Cada operador pode ter o próprio número. Vincule um operador a um número e as
          conversas que chegarem por ele serão atribuídas automaticamente.
        </p>
      </header>

      {/* Resumo — quantos números por provedor */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="glass-card p-4">
          <div className="text-label">Ativos</div>
          <div className="mt-1 text-2xl font-extrabold text-[var(--color-text-primary)]">
            {loading ? '-' : activeCount}
          </div>
          <div className="text-[11px] text-[var(--color-text-secondary)]">
            de {loading ? '-' : channels.length} números
          </div>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center gap-1.5 text-label">
            <MessageCircle className="h-3 w-3" style={{ color: ZERNIO_COLOR }} /> Oficial
          </div>
          <div className="mt-1 text-2xl font-extrabold" style={{ color: ZERNIO_COLOR }}>
            {loading ? '-' : zernioChannels.length}
          </div>
          <div className="text-[11px] text-[var(--color-text-secondary)]">via Zernio (Meta)</div>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center gap-1.5 text-label">
            <Zap className="h-3 w-3" style={{ color: UAZAPI_COLOR }} /> UAZAPI
          </div>
          <div className="mt-1 text-2xl font-extrabold" style={{ color: UAZAPI_COLOR }}>
            {loading ? '-' : uazapiChannels.length}
          </div>
          <div className="text-[11px] text-[var(--color-text-secondary)]">sem janela de 24h</div>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center gap-1.5 text-label">
            <ShieldCheck className="h-3 w-3" style={{ color: META_COLOR }} /> Meta
          </div>
          <div className="mt-1 text-2xl font-extrabold" style={{ color: META_COLOR }}>
            {loading ? '-' : metaChannels.length}
          </div>
          <div className="text-[11px] text-[var(--color-text-secondary)]">direto na Meta</div>
        </div>
      </div>

      {/* ── Zernio — WhatsApp Oficial + Instagram (card único) ── */}
      <section>
        <div className="glass-card space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border"
                style={{ borderColor: 'rgba(37,211,102,0.25)', background: 'rgba(37,211,102,0.08)' }}
              >
                <MessageCircle className="h-5 w-5" style={{ color: ZERNIO_COLOR }} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                  Zernio · WhatsApp Oficial e Instagram
                </h3>
                <p className="text-[11px] text-[var(--color-text-secondary)]">
                  Os canais são conectados e gerenciados no painel do Zernio. Aqui você só
                  informa a API Key.
                </p>
              </div>
            </div>
            {/* Resumo do que a chave está trazendo para o CRM */}
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(37,211,102,0.1)] px-2.5 py-1 text-[11px] font-semibold" style={{ color: ZERNIO_COLOR }}>
                <MessageCircle className="h-3 w-3" />
                {loading ? '-' : `${zernioChannels.filter((c) => c.is_active).length} de ${zernioChannels.length}`} números ativos
              </span>
              <span
                className={
                  instagram
                    ? 'inline-flex items-center gap-1.5 rounded-full bg-[rgba(225,48,108,0.1)] px-2.5 py-1 text-[11px] font-semibold text-[#E1306C]'
                    : 'inline-flex items-center gap-1.5 rounded-full bg-[rgba(148,163,184,0.1)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-text-secondary)]'
                }
              >
                <Instagram className="h-3 w-3" />
                {instagram === null ? '…' : instagram ? 'Instagram conectado' : 'Instagram não conectado'}
              </span>
            </div>
          </div>

          {/* Zernio API Key — única ação disponível no CRM */}
          <div className="rounded-xl border border-[rgba(212,165,116,0.15)] bg-white/[0.02] p-4">
            <button
              onClick={() => setShowZernioKey((v) => !v)}
              className="flex w-full items-center gap-3 text-left"
            >
              <KeyRound className="h-4 w-4 shrink-0 text-[#E8C89A]" />
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-[var(--color-text-primary)]">
                  Zernio API Key
                </span>
                <span
                  className={
                    zernioKeyExists
                      ? 'ml-2 text-xs text-[#10B981]'
                      : 'ml-2 text-xs text-[#F59E0B]'
                  }
                >
                  {zernioKeyExists ? '· configurada' : '· pendente'}
                </span>
              </div>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-[var(--color-text-secondary)] transition-transform ${showZernioKey ? 'rotate-180' : ''}`}
              />
            </button>
            {showZernioKey ? (
              <div className="mt-3 space-y-3 border-t border-[rgba(212,165,116,0.08)] pt-3">
                <input
                  value={zernioKey}
                  onChange={(e) => setZernioKey(e.target.value)}
                  type="password"
                  autoComplete="off"
                  placeholder={zernioKeyExists ? '•••••••••••• (configurada)' : 'Cole a Zernio API Key'}
                  className="w-full rounded-lg border border-[rgba(212,165,116,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:border-[var(--accent-primary)] focus:outline-none"
                />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    Ao salvar, o CRM sincroniza os números oficiais e o Instagram da sua conta
                    Zernio e cadastra o webhook.
                  </p>
                  <button
                    onClick={() => void saveZernioKey()}
                    disabled={!zernioKey.trim() || savingZernioKey || connectingZernio}
                    className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-gradient-to-br from-[#182940] to-[#D4A574] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                  >
                    {savingZernioKey || connectingZernio ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    Salvar e sincronizar
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {/* Instagram: o token entra por aqui. Voltou de Credenciais, que era a
              única tela que gravava instagram_access_token e ficou órfã (fora do
              router) na atualização de agosto — sem isso o badge acima ficava
              preso em "não conectado" sem caminho para conectar. */}
          <InstagramCard onSaved={() => setInstagram(true)} />

          {/* Seletor de conta Zernio (API Key com várias contas WhatsApp) */}
          {zernioChoices ? (
            <div className="rounded-xl border border-[rgba(212,165,116,0.15)] bg-white/[0.02] p-4">
              <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
                Escolha a conta WhatsApp para conectar
              </h4>
              <div className="mt-3 space-y-2">
                {zernioChoices.map((acc) => (
                  <button
                    key={acc.id}
                    onClick={() => void connectZernio(acc.id)}
                    disabled={connectingZernio}
                    className="flex w-full items-center justify-between rounded-lg border border-[rgba(212,165,116,0.2)] bg-white/[0.02] p-3 text-left text-sm text-[var(--color-text-primary)] transition hover:border-[var(--accent-primary)]"
                  >
                    <span className="truncate">{acc.name}</span>
                    <span className="ml-3 shrink-0 font-mono text-[11px] text-[var(--color-text-secondary)]">
                      {acc.id}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* Números oficiais trazidos pela chave */}
          {loading ? (
            <div className="flex items-center gap-3 text-sm text-[var(--color-text-secondary)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando números...
            </div>
          ) : zernioChannels.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[rgba(148,163,184,0.25)] p-4 text-sm text-[var(--color-text-secondary)]">
              {zernioKeyExists
                ? 'Nenhum número oficial sincronizado ainda. Conecte o WhatsApp no painel do Zernio e ele aparecerá aqui.'
                : 'Configure a Zernio API Key acima para sincronizar os números da sua conta Zernio.'}
            </div>
          ) : (
            <div className="space-y-3">{zernioChannels.map(renderChannelCard)}</div>
          )}
        </div>
      </section>

      {/* ── UAZAPI (card único) ── */}
      <section>
        <div className="glass-card space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border"
                style={{ borderColor: 'rgba(45,212,191,0.25)', background: 'rgba(45,212,191,0.08)' }}
              >
                <Zap className="h-5 w-5" style={{ color: UAZAPI_COLOR }} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                  WhatsApp via UAZAPI
                </h3>
                <p className="text-[11px] text-[var(--color-text-secondary)]">
                  Instância própria · sem janela de 24h · ideal para o número de cada operador
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={{ background: 'rgba(45,212,191,0.1)', color: UAZAPI_COLOR }}
              >
                <Zap className="h-3 w-3" />
                {loading ? '-' : `${uazapiChannels.filter((c) => c.is_active).length} de ${uazapiChannels.length}`} instâncias ativas
              </span>
              <button
                onClick={() => setShowUazapiForm((v) => !v)}
                className="inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold transition"
                style={{
                  borderColor: 'rgba(45,212,191,0.35)',
                  background: 'rgba(45,212,191,0.08)',
                  color: UAZAPI_COLOR,
                }}
              >
                <Plus className="h-3.5 w-3.5" /> Adicionar instância
              </button>
            </div>
          </div>

          {/* Form de nova instância UAZAPI */}
          {showUazapiForm ? (
            <div className="space-y-3 rounded-xl border border-[rgba(212,165,116,0.15)] bg-white/[0.02] p-4">
              <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
                Nova instância UAZAPI
              </h4>
            <input
              value={uazForm.label}
              onChange={(e) => setUazForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="Nome do número (ex: WhatsApp da Maria)"
              className="w-full rounded-lg border border-[rgba(212,165,116,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:border-[var(--accent-primary)] focus:outline-none"
            />
            <input
              value={uazForm.serverUrl}
              onChange={(e) => setUazForm((f) => ({ ...f, serverUrl: e.target.value }))}
              placeholder="Server URL (https://…uazapi.com)"
              className="w-full rounded-lg border border-[rgba(212,165,116,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:border-[var(--accent-primary)] focus:outline-none"
            />
            <input
              value={uazForm.token}
              onChange={(e) => setUazForm((f) => ({ ...f, token: e.target.value }))}
              placeholder="Instance Token"
              type="password"
              className="w-full rounded-lg border border-[rgba(212,165,116,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:border-[var(--accent-primary)] focus:outline-none"
            />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowUazapiForm(false)}
                  className="rounded-lg border border-[rgba(212,165,116,0.2)] px-4 py-2 text-sm text-[var(--color-text-secondary)]"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => void saveUazapiChannel()}
                  disabled={savingUaz || !uazForm.serverUrl.trim() || !uazForm.token.trim()}
                  className="rounded-lg bg-gradient-to-br from-[#182940] to-[#D4A574] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  {savingUaz ? 'Conectando...' : 'Conectar e cadastrar webhook'}
                </button>
              </div>
            </div>
          ) : null}

          {/* Instâncias conectadas */}
          {loading ? (
            <div className="flex items-center gap-3 text-sm text-[var(--color-text-secondary)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando números...
            </div>
          ) : uazapiChannels.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[rgba(148,163,184,0.25)] p-4 text-sm text-[var(--color-text-secondary)]">
              Nenhuma instância UAZAPI conectada. Cada operador pode conectar o próprio número
              clicando em "Adicionar instância".
            </div>
          ) : (
            <div className="space-y-3">{uazapiChannels.map(renderChannelCard)}</div>
          )}
        </div>
      </section>

      {/* ── Meta Cloud API direto (card único) ── */}
      <section>
        <div className="glass-card space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border"
                style={{ borderColor: 'rgba(8,102,255,0.25)', background: 'rgba(8,102,255,0.08)' }}
              >
                <ShieldCheck className="h-5 w-5" style={{ color: META_COLOR }} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                  WhatsApp — API oficial da Meta (direto)
                </h3>
                <p className="text-[11px] text-[var(--color-text-secondary)]">
                  Sem intermediário: o CRM fala direto com a Meta. Fora da janela de 24h só
                  sai mensagem com template aprovado.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={{ background: 'rgba(8,102,255,0.1)', color: META_COLOR }}
              >
                <ShieldCheck className="h-3 w-3" />
                {loading
                  ? '-'
                  : `${metaChannels.filter((c) => c.is_active).length} de ${metaChannels.length}`}{' '}
                números ativos
              </span>
              <button
                onClick={() => setShowMetaForm((v) => !v)}
                className="inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold transition"
                style={{
                  borderColor: 'rgba(8,102,255,0.35)',
                  background: 'rgba(8,102,255,0.08)',
                  color: META_COLOR,
                }}
              >
                <Plus className="h-3.5 w-3.5" /> Conectar número
              </button>
            </div>
          </div>

          {/* Formulário do canal Meta — identificadores já preenchidos com os
              dados da conta da clínica; segredos sempre em branco. */}
          {showMetaForm ? (
            <div className="space-y-3 rounded-xl border border-[rgba(212,165,116,0.15)] bg-white/[0.02] p-4">
              <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
                Dados do número na Meta
              </h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="block text-label">Nome do canal</span>
                  <input
                    value={metaForm.label}
                    onChange={(e) => setMetaForm((f) => ({ ...f, label: e.target.value }))}
                    placeholder="Ex.: WhatsApp Odonto (oficial)"
                    className={FIELD_CLASS}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="block text-label">Número</span>
                  <input
                    value={metaForm.phone}
                    onChange={(e) => setMetaForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="+55 73 99804-0599"
                    className={FIELD_CLASS}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="block text-label">ID da conta (WABA)</span>
                  <input
                    value={metaForm.wabaId}
                    onChange={(e) => setMetaForm((f) => ({ ...f, wabaId: e.target.value }))}
                    placeholder="ID da conta do WhatsApp Business"
                    className={FIELD_CLASS}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="block text-label">ID do número (Phone Number ID)</span>
                  <input
                    value={metaForm.phoneNumberId}
                    onChange={(e) => setMetaForm((f) => ({ ...f, phoneNumberId: e.target.value }))}
                    placeholder="ID do número na Meta"
                    className={FIELD_CLASS}
                  />
                </label>
              </div>

              <div className="space-y-3 border-t border-[rgba(212,165,116,0.08)] pt-3">
                <label className="space-y-1.5">
                  <span className="block text-label">Token de acesso</span>
                  <input
                    value={metaForm.token}
                    onChange={(e) => setMetaForm((f) => ({ ...f, token: e.target.value }))}
                    type="password"
                    autoComplete="off"
                    placeholder="Cole o token permanente do Usuário do Sistema"
                    className={FIELD_CLASS}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="block text-label">Chave secreta do app (App Secret)</span>
                  <input
                    value={metaForm.appSecret}
                    onChange={(e) => setMetaForm((f) => ({ ...f, appSecret: e.target.value }))}
                    type="password"
                    autoComplete="off"
                    placeholder={
                      metaSecrets.appSecret
                        ? '•••••••••••• (configurado)'
                        : '32 caracteres do App Secret'
                    }
                    className={FIELD_CLASS}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="block text-label">
                    Senha de verificação do webhook (Verify Token)
                  </span>
                  <input
                    value={metaForm.verifyToken}
                    onChange={(e) => setMetaForm((f) => ({ ...f, verifyToken: e.target.value }))}
                    type="password"
                    autoComplete="off"
                    placeholder={
                      metaSecrets.verifyToken
                        ? '•••••••••••• (configurado)'
                        : 'Senha que você repete no painel da Meta'
                    }
                    className={FIELD_CLASS}
                  />
                </label>
                <p className="text-[11px] text-[var(--color-text-secondary)]">
                  Os três campos acima ficam cifrados no banco e nunca voltam para a tela.
                  Numa edição, deixe em branco o que não quiser trocar.
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowMetaForm(false)}
                  className="rounded-lg border border-[rgba(212,165,116,0.2)] px-4 py-2 text-sm text-[var(--color-text-secondary)]"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => void saveMetaChannel()}
                  disabled={savingMeta || !metaForm.phoneNumberId.trim()}
                  className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-br from-[#182940] to-[#D4A574] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  {savingMeta ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Salvar e testar conexão
                </button>
              </div>
            </div>
          ) : null}

          {/* URL do webhook — a Meta não aceita cadastro por API: é colada à mão. */}
          <div
            className="rounded-xl border p-4"
            style={{ borderColor: 'rgba(8,102,255,0.25)', background: 'rgba(8,102,255,0.06)' }}
          >
            <div className="text-label">URL do webhook</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-[rgba(15,18,35,0.8)] px-3 py-2 font-mono text-[11px] text-[var(--color-text-primary)]">
                {metaWebhookUrl}
              </code>
              <button
                onClick={() => void copyWebhookUrl()}
                className="inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition"
                style={{
                  borderColor: 'rgba(8,102,255,0.35)',
                  background: 'rgba(8,102,255,0.08)',
                  color: META_COLOR,
                }}
              >
                {webhookCopied ? (
                  <CheckCheck className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {webhookCopied ? 'Copiada' : 'Copiar'}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-[var(--color-text-secondary)]">
              Cole esta URL na Meta em <strong>Configuração da API → Etapa 3</strong> e assine
              os campos <code className="font-mono">messages</code> e{' '}
              <code className="font-mono">message_template_status_update</code>.
            </p>
          </div>

          {/* Números conectados direto na Meta */}
          {loading ? (
            <div className="flex items-center gap-3 text-sm text-[var(--color-text-secondary)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando números...
            </div>
          ) : metaChannels.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[rgba(148,163,184,0.25)] p-4 text-sm text-[var(--color-text-secondary)]">
              Nenhum número conectado direto na Meta. Clique em "Conectar número" e informe o
              token de acesso.
            </div>
          ) : (
            <div className="space-y-3">
              {metaChannels.map((channel) => {
                const st = metaStatus[channel.id];
                const registered = st?.platformType === 'CLOUD_API';
                const registerOpen = showRegisterFor === channel.id;
                return (
                  <div key={channel.id} className="space-y-1">
                    {renderChannelCard(channel)}
                    {st ? (
                      <p className="px-1 text-[11px] text-[var(--color-text-secondary)]">
                        {st.connected
                          ? `Meta: ${st.verifiedName ?? 'sem nome verificado'}${
                              st.qualityRating ? ` · qualidade ${st.qualityRating}` : ''
                            }${st.status ? ` · ${st.status}` : ''}`
                          : `Meta não respondeu: ${st.status ?? 'erro'}`}
                      </p>
                    ) : null}

                    {/* Registro na Cloud API — sem ele o número envia mas não
                        recebe: a conversa chega sem campo de digitação. */}
                    {registered ? (
                      <div
                        className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-[11px] font-semibold"
                        style={{
                          borderColor: 'rgba(16,185,129,0.3)',
                          background: 'rgba(16,185,129,0.08)',
                          color: '#10B981',
                        }}
                      >
                        <CheckCheck className="h-3.5 w-3.5" />
                        Número registrado na Cloud API
                        <span className="font-normal text-[var(--color-text-secondary)]">
                          Já recebe e responde mensagens.
                        </span>
                      </div>
                    ) : (
                      <div
                        className="rounded-lg border"
                        style={{
                          borderColor: 'rgba(8,102,255,0.25)',
                          background: 'rgba(8,102,255,0.05)',
                        }}
                      >
                        <button
                          onClick={() => {
                            setRegisterPin('');
                            setShowRegisterFor(registerOpen ? null : channel.id);
                          }}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                        >
                          <span className="flex items-center gap-2 text-[11px] font-semibold" style={{ color: META_COLOR }}>
                            <KeyRound className="h-3.5 w-3.5" />
                            Registrar número na Cloud API
                          </span>
                          <ChevronDown
                            className={`h-3.5 w-3.5 shrink-0 text-[var(--color-text-secondary)] transition ${
                              registerOpen ? 'rotate-180' : ''
                            }`}
                          />
                        </button>
                        {registerOpen ? (
                          <div className="space-y-3 border-t border-[rgba(8,102,255,0.15)] px-3 py-3">
                            <p className="text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
                              Cadastrar e confirmar o número por SMS <strong>não basta</strong>:
                              enquanto o registro não é feito, o número envia mensagem mas
                              ninguém consegue responder — a conversa chega sem o campo de
                              digitar e o contato aparece como "Convidar para o WhatsApp".
                              <br />
                              <br />
                              O PIN abaixo é <strong>escolhido por você</strong> — não é código
                              de SMS, não vem da Meta. São 6 números que você inventa.
                              <strong> Anote em local seguro:</strong> a Meta vai exigir esse
                              mesmo PIN em qualquer novo registro deste número.
                            </p>
                            <div className="flex flex-wrap items-end gap-2">
                              <label className="min-w-[10rem] flex-1 space-y-1.5">
                                <span className="block text-label">PIN de 6 dígitos</span>
                                <input
                                  value={registerPin}
                                  onChange={(e) =>
                                    setRegisterPin(e.target.value.replace(/\D/g, '').slice(0, 6))
                                  }
                                  type="password"
                                  inputMode="numeric"
                                  autoComplete="off"
                                  maxLength={6}
                                  placeholder="Ex.: 6 números que você escolher"
                                  className={FIELD_CLASS}
                                />
                              </label>
                              <button
                                onClick={() => void registerMetaNumber(channel.id)}
                                disabled={
                                  registeringId === channel.id || registerPin.trim().length !== 6
                                }
                                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-br from-[#182940] to-[#D4A574] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                              >
                                {registeringId === channel.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : null}
                                Registrar número
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

    </div>
  );
}
