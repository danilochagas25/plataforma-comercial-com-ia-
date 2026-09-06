import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../src/lib/admin-auth.js';
import { decrypt, encrypt, setCredential } from '../src/lib/credentials.js';
import {
  MetaCloudError,
  isValidMetaPin,
  metaNumberInfo,
  metaRegisterPhoneNumber,
  metaWabaInfo,
} from '../src/lib/meta-cloud.js';
import { setupConfig } from '../setup.config.js';

// ============================================================================
// api/meta-connect
// ----------------------------------------------------------------------------
// Integração DIRETA com a WhatsApp Cloud API da Meta (não passa pelo Zernio).
// Multi-número: cada Phone Number ID é um CANAL da org
// (whatsapp_hub.channels, provider='meta') com o token do Usuário do Sistema
// cifrado na própria linha (meta_token_encrypted).
//
//  GET  → lista os canais Meta da org com o status do número na Graph API
//         (inclui platform_type e code_verification_status: são eles que
//         provam se o número foi REGISTRADO na Cloud API, não só verificado).
//  POST { action: 'register', channelId?, pin } → registra o número na Cloud
//         API (POST /{phone_number_id}/register). O PIN de 6 dígitos é
//         escolhido pelo dono e fica cifrado no cofre da org
//         (meta_registration_pin) — perder o PIN trava qualquer re-registro.
//  POST → cria/atualiza um canal:
//         { channelId?, label?, phone?, wabaId?, phoneNumberId?, token?,
//           appSecret?, verifyToken? }
//         · channelId ausente → cria (ou reusa o canal com o mesmo número)
//         · channelId presente → atualiza; token vazio mantém o token atual
//         O par (phoneNumberId + token) é SEMPRE validado na Meta antes de
//         qualquer escrita.
//
// Diferente da UAZAPI, o webhook da Meta NÃO se cadastra por API: é colado à
// mão no painel do App (Configuração da API → Etapa 3). Por isso este endpoint
// só devolve a URL para a tela exibir.
//
// App Secret e Verify Token não moram na linha do canal: vão para o cofre da
// org (public.org_settings), que é onde a Edge Function `meta-webhook` os lê.
//
// Segredo nunca é logado aqui — nem em console.error.
// ============================================================================

type ApiRequest = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};
type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
  end: () => void;
};

interface ChannelRow {
  id: string;
  org_id: string;
  label: string;
  phone: string | null;
  meta_waba_id: string | null;
  meta_phone_number_id: string | null;
  meta_token_encrypted: string | null;
  assigned_member: string | null;
  is_active: boolean;
}

// Uma string literal só: concatenar quebra a inferencia de tipo do supabase-js.
const CHANNEL_COLUMNS = 'id, org_id, label, phone, meta_waba_id, meta_phone_number_id, meta_token_encrypted, assigned_member, is_active';

function authHeaderOf(req: ApiRequest): string | string[] | undefined {
  return req.headers?.authorization ?? req.headers?.Authorization;
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase core nao configurado.');
  return createClient(url, key, { auth: { persistSession: false } });
}

function channelsTable() {
  return getSupabaseAdmin().schema('whatsapp_hub').from('channels');
}

// URL fixa da função: a Meta casa o evento com o canal pelo phone_number_id do
// próprio payload, então não existe secret na querystring (como no uazapi).
// Em instalação com mais de uma organização ativa, o desafio GET aceita
// `?org=<id>` — hoje há uma só, então a URL limpa basta.
function webhookUrl(): string {
  const base = process.env.SUPABASE_URL;
  if (!base) throw new Error('SUPABASE_URL ausente para montar a URL do webhook.');
  return `${base.replace(/\/$/, '')}/functions/v1/meta-webhook`;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

// Telefone só para exibição no CRM: normaliza para E.164 sem depender de lib.
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  return digits ? `+${digits}` : null;
}

// Valida App Secret / Verify Token com o MESMO validador da tela de
// credenciais (setup.config.ts) — uma regra só, em um lugar só.
async function validateVaultValue(key: string, value: string) {
  const field = setupConfig.appCredentials.find((item) => item.key === key);
  if (!field) return { ok: true as const };
  return field.validate(value);
}

async function handleGet(orgId: string, res: ApiResponse) {
  const { data, error } = await channelsTable()
    .select(CHANNEL_COLUMNS)
    .eq('org_id', orgId)
    .eq('provider', 'meta')
    .order('created_at');
  if (error) throw error;

  const channels = await Promise.all(
    ((data ?? []) as ChannelRow[]).map(async (ch) => {
      let connected = false;
      let status: string | null = null;
      let verifiedName: string | null = null;
      let qualityRating: string | null = null;
      // platform_type = 'CLOUD_API' é a prova de que o número foi REGISTRADO
      // (verificar por SMS não registra). Sem ele o número não recebe mensagem.
      let platformType: string | null = null;
      let codeVerificationStatus: string | null = null;
      try {
        if (ch.meta_phone_number_id && ch.meta_token_encrypted) {
          const info = await metaNumberInfo(
            ch.meta_phone_number_id,
            decrypt(ch.meta_token_encrypted),
          );
          connected = true;
          status = info.codeVerificationStatus;
          verifiedName = info.verifiedName;
          qualityRating = info.qualityRating;
          platformType = info.platformType;
          codeVerificationStatus = info.codeVerificationStatus;
        } else {
          status = 'não configurado';
        }
      } catch (err) {
        status = err instanceof Error ? err.message : 'erro';
      }
      return {
        id: ch.id,
        label: ch.label,
        phone: ch.phone,
        wabaId: ch.meta_waba_id,
        phoneNumberId: ch.meta_phone_number_id,
        assigned_member: ch.assigned_member,
        is_active: ch.is_active,
        connected,
        status,
        verifiedName,
        qualityRating,
        platformType,
        codeVerificationStatus,
      };
    }),
  );

  return res.status(200).json({
    success: true,
    configured: channels.length > 0,
    connected: channels.some((c) => c.connected),
    webhookUrl: webhookUrl(),
    channels,
  });
}

// Resolve o canal Meta alvo: pelo id quando informado, senão o único da org.
async function findMetaChannel(
  orgId: string,
  channelId: string,
): Promise<ChannelRow | null> {
  if (channelId) {
    const { data, error } = await channelsTable()
      .select(CHANNEL_COLUMNS)
      .eq('id', channelId)
      .eq('org_id', orgId)
      .eq('provider', 'meta')
      .maybeSingle();
    if (error) throw error;
    return (data as ChannelRow | null) ?? null;
  }
  const { data, error } = await channelsTable()
    .select(CHANNEL_COLUMNS)
    .eq('org_id', orgId)
    .eq('provider', 'meta')
    .order('created_at');
  if (error) throw error;
  const rows = (data ?? []) as ChannelRow[];
  return rows.length === 1 ? rows[0] : null;
}

// ── POST { action: 'register' } ──
// Registra o número na Cloud API. Só depois disso ele existe como conta de
// WhatsApp (recebe mensagem, aparece na busca, tem campo de digitação).
// O PIN nunca é logado, nem em console.error, nem devolvido na resposta.
async function handleRegister(orgId: string, body: Record<string, unknown>, res: ApiResponse) {
  const pin = str(body.pin);
  const channelId = str(body.channelId);

  // Valida o formato antes de gastar chamada na Meta — PIN errado demais
  // bloqueia o número por tempo (erro 133008).
  if (!isValidMetaPin(pin)) {
    return res.status(400).json({
      success: false,
      message: 'O PIN precisa ter exatamente 6 dígitos numéricos (só números, sem espaço).',
    });
  }

  const channel = await findMetaChannel(orgId, channelId);
  if (!channel) {
    return res.status(404).json({
      success: false,
      message: 'Canal da Meta não encontrado. Conecte o número antes de registrar.',
    });
  }
  if (!channel.meta_phone_number_id || !channel.meta_token_encrypted) {
    return res.status(400).json({
      success: false,
      message: 'Este canal não tem ID do número ou token de acesso salvo. Edite o canal antes de registrar.',
    });
  }

  const token = decrypt(channel.meta_token_encrypted);
  await metaRegisterPhoneNumber(channel.meta_phone_number_id, token, pin);

  // Guarda o PIN cifrado no cofre da org: sem ele, qualquer re-registro futuro
  // deste número fica travado. Falha aqui não desfaz o registro, só avisa.
  let pinSaved = false;
  let pinWarning: string | null = null;
  try {
    await setCredential(orgId, 'meta_registration_pin', pin);
    pinSaved = true;
  } catch {
    pinWarning =
      'O número foi registrado, mas não foi possível guardar o PIN no cofre. Anote o PIN em local seguro: ele é exigido em qualquer novo registro.';
  }

  // Estado atualizado do número — é aqui que platform_type vira CLOUD_API.
  let info: Awaited<ReturnType<typeof metaNumberInfo>> | null = null;
  let infoWarning: string | null = null;
  try {
    info = await metaNumberInfo(channel.meta_phone_number_id, token);
  } catch (err) {
    infoWarning = err instanceof MetaCloudError
      ? err.message
      : 'Registro concluído, mas não foi possível reler o estado do número na Meta.';
  }

  return res.status(200).json({
    success: true,
    channelId: channel.id,
    registered: true,
    pinSaved,
    pinWarning,
    infoWarning,
    phoneNumberId: channel.meta_phone_number_id,
    status: info?.codeVerificationStatus ?? null,
    verifiedName: info?.verifiedName ?? null,
    qualityRating: info?.qualityRating ?? null,
    platformType: info?.platformType ?? null,
    codeVerificationStatus: info?.codeVerificationStatus ?? null,
  });
}

async function handlePost(orgId: string, req: ApiRequest, res: ApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (str(body.action) === 'register') return handleRegister(orgId, body, res);
  const channelId = str(body.channelId);
  const wabaIdInput = str(body.wabaId);
  const label = str(body.label) || 'WhatsApp Meta (oficial)';
  const phoneInput = str(body.phone);
  const appSecret = str(body.appSecret);
  const verifyToken = str(body.verifyToken);
  let phoneNumberId = str(body.phoneNumberId);
  let token = str(body.token);

  let channel: ChannelRow | null = null;

  if (channelId) {
    const { data, error } = await channelsTable()
      .select(CHANNEL_COLUMNS)
      .eq('id', channelId)
      .eq('org_id', orgId)
      .eq('provider', 'meta')
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: 'Canal não encontrado.' });
    }
    channel = data as ChannelRow;
    phoneNumberId = phoneNumberId || (channel.meta_phone_number_id ?? '');
    // Edição sem token digitado: mantém o token já cifrado na linha.
    token = token || (channel.meta_token_encrypted ? decrypt(channel.meta_token_encrypted) : '');
  }

  if (!phoneNumberId || !token) {
    return res.status(400).json({
      success: false,
      message: 'Informe o ID do número (Phone Number ID) e o token de acesso da Meta.',
    });
  }

  // Valida os segredos ANTES de gravar qualquer coisa no cofre.
  for (const [key, value] of [
    ['meta_app_secret', appSecret],
    ['meta_webhook_verify_token', verifyToken],
  ] as const) {
    if (!value) continue;
    const result = await validateVaultValue(key, value);
    if (!result.ok) {
      return res.status(400).json({
        success: false,
        error_code: 'INVALID_CREDENTIAL',
        key,
        message: result.message ?? 'Credencial inválida.',
      });
    }
  }

  // Teste de conexão: se a Meta responder, o token é válido e enxerga o número.
  // Nada é gravado antes disso.
  const info = await metaNumberInfo(phoneNumberId, token);

  // Confirmação do vínculo com a WABA — informativa: erro aqui não impede o
  // canal de enviar mensagem, só sinaliza que o token não gerencia a conta.
  const wabaId = wabaIdInput || channel?.meta_waba_id || '';
  let wabaName: string | null = null;
  let wabaWarning: string | null = null;
  if (wabaId) {
    try {
      wabaName = (await metaWabaInfo(wabaId, token)).name;
    } catch (err) {
      wabaWarning = err instanceof MetaCloudError
        ? err.message
        : 'Não foi possível confirmar a conta do WhatsApp (WABA).';
    }
  }

  const phone = phoneInput
    ? normalizePhone(phoneInput)
    : (channel?.phone ?? normalizePhone(info.displayPhoneNumber ?? ''));
  const encryptedToken = encrypt(token);

  if (!channel) {
    // Reusa o canal que já tem este número (a UNIQUE da org é por
    // (org_id, provider, meta_phone_number_id)).
    const { data: existing, error: findError } = await channelsTable()
      .select(CHANNEL_COLUMNS)
      .eq('org_id', orgId)
      .eq('provider', 'meta')
      .eq('meta_phone_number_id', phoneNumberId)
      .maybeSingle();
    if (findError) throw findError;
    if (existing) channel = existing as ChannelRow;
  }

  if (channel) {
    const { error } = await channelsTable()
      .update({
        label,
        ...(phone ? { phone } : {}),
        meta_waba_id: wabaId || null,
        meta_phone_number_id: phoneNumberId,
        meta_token_encrypted: encryptedToken,
        updated_at: new Date().toISOString(),
      })
      .eq('id', channel.id);
    if (error) throw error;
  } else {
    const { data: created, error } = await channelsTable()
      .insert({
        org_id: orgId,
        provider: 'meta',
        label,
        phone,
        meta_waba_id: wabaId || null,
        meta_phone_number_id: phoneNumberId,
        meta_token_encrypted: encryptedToken,
      })
      .select(CHANNEL_COLUMNS)
      .single();
    if (error) throw error;
    channel = created as ChannelRow;
  }

  // Cofre da org: só grava o que veio preenchido. Campo vazio numa edição
  // significa "não mexer", nunca "apagar".
  if (appSecret) await setCredential(orgId, 'meta_app_secret', appSecret);
  if (verifyToken) await setCredential(orgId, 'meta_webhook_verify_token', verifyToken);

  return res.status(200).json({
    success: true,
    channelId: channel.id,
    webhookUrl: webhookUrl(),
    phoneNumberId,
    wabaId: wabaId || null,
    wabaName,
    wabaWarning,
    phone: channel.phone ?? phone,
    verifiedName: info.verifiedName,
    displayPhoneNumber: info.displayPhoneNumber,
    qualityRating: info.qualityRating,
    codeVerificationStatus: info.codeVerificationStatus,
    platformType: info.platformType,
    appSecretSaved: Boolean(appSecret),
    verifyTokenSaved: Boolean(verifyToken),
  });
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

    const auth = await requireAdmin(authHeaderOf(req));
    if (!auth.ok) {
      return res.status(auth.status).json({ success: false, message: auth.message });
    }

    return await (req.method === 'GET'
      ? handleGet(auth.orgId, res)
      : handlePost(auth.orgId, req, res));
  } catch (err) {
    if (err instanceof MetaCloudError) {
      return res.status(err.status === 401 ? 401 : 502).json({
        success: false,
        message: err.message,
      });
    }
    // Só a mensagem: o objeto de erro pode carregar o corpo da requisição.
    console.error('meta-connect error', err instanceof Error ? err.message : 'erro desconhecido');
    return res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : 'Erro interno',
    });
  }
}
