// ============================================================================
// sync-template-status
// ----------------------------------------------------------------------------
// Traz o estado dos modelos de mensagem que estão na Meta para a tabela local
// whatsapp_hub.templates. Dois provedores, tratados de forma independente:
//
//   provider='zernio' → GET /whatsapp/templates (Zernio relaya a Meta).
//                       Comportamento histórico: SÓ atualiza linhas locais que
//                       já existem, casando por nome. Não importa nada.
//   provider='meta'   → GET /v25.0/{waba_id}/message_templates (Graph API
//                       direta). Faz UPSERT: modelo que existe na Meta e não
//                       existe aqui é IMPORTADO com corpo, cabeçalho, rodapé,
//                       botões e variáveis.
//
// A org pode ter os dois canais: nesse caso as duas rotinas rodam, na ordem
// zernio → meta (meta por último para prevalecer, que é a decisão vigente do
// projeto — canal oficial direto na Meta).
//
// Duas portas de entrada, ambas pelos helpers de _shared/auth.ts:
//   · admin logado  → botão "Atualizar status" na tela de Templates; sincroniza
//                     SÓ a org do caller.
//   · service role  → chamada de operação/cron (pg_net com a chave do Vault);
//                     sincroniza a org do corpo (`org_id`) ou todas as ativas.
// ============================================================================

import { requireAdmin, requireServiceRole, AuthError } from '../_shared/auth.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { ZernioError, listTemplates } from '../_shared/zernio.ts';
import { listActiveChannels, loadOrgZernioContext } from '../_shared/channels.ts';
import {
  MetaCloudError,
  metaContextFromChannel,
  metaListTemplates,
  type MetaTemplate,
} from '../_shared/meta-cloud.ts';

type LocalStatus = 'draft' | 'pending' | 'approved' | 'rejected';
type LocalCategory = 'marketing' | 'utility' | 'service' | 'authentication';
type LocalHeader = 'none' | 'text' | 'image' | 'video' | 'document';

// Estados da Meta: APPROVED · PENDING · REJECTED · PAUSED · DISABLED
// (+ IN_APPEAL, PENDING_DELETION, DELETED em contas antigas).
// O enum local só tem draft|pending|approved|rejected, então PAUSED e DISABLED
// caem em 'rejected' — é o mais próximo de "não pode ser usado agora".
// O valor cru da Meta fica preservado em templates.meta_template_status.
function mapStatus(meta: string | null): LocalStatus {
  const s = (meta ?? '').toUpperCase();
  if (s === 'APPROVED') return 'approved';
  if (['REJECTED', 'DISABLED', 'PAUSED', 'DELETED'].includes(s)) return 'rejected';
  return 'pending';
}

function mapCategory(meta: string | null): LocalCategory {
  const c = (meta ?? '').toUpperCase();
  if (c === 'MARKETING') return 'marketing';
  if (c === 'AUTHENTICATION') return 'authentication';
  return 'utility';
}

// --- tradução dos components da Meta para as colunas locais ------------------

interface LocalButton {
  type: 'quick_reply' | 'url' | 'phone';
  text: string;
  url?: string;
  phone?: string;
}

interface TemplateFields {
  body: string;
  header_type: LocalHeader;
  header_content: string | null;
  footer: string | null;
  buttons: LocalButton[];
  variables: Record<string, string>;
}

function asObj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

// Posições {{1}}, {{2}}... presentes no texto, em ordem crescente.
function variablePositions(body: string): number[] {
  const found = new Set<number>();
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) found.add(n);
  }
  return [...found].sort((a, b) => a - b);
}

function metaComponentsToFields(components: Record<string, unknown>[]): TemplateFields {
  const fields: TemplateFields = {
    body: '',
    header_type: 'none',
    header_content: null,
    footer: null,
    buttons: [],
    variables: {},
  };

  let bodyExamples: string[] = [];

  for (const comp of components) {
    const type = (str(comp.type) ?? '').toUpperCase();

    if (type === 'HEADER') {
      const format = (str(comp.format) ?? 'TEXT').toLowerCase();
      if (format === 'text' || format === 'image' || format === 'video' || format === 'document') {
        fields.header_type = format;
      }
      if (fields.header_type === 'text') {
        fields.header_content = str(comp.text);
      } else {
        // Mídia: a Meta devolve a amostra em example.header_handle[] (handle
        // interno da Meta, não URL pública — serve como referência, não como
        // imagem exibível).
        const handles = asObj(comp.example).header_handle;
        fields.header_content = Array.isArray(handles) ? str(handles[0]) : null;
      }
      continue;
    }

    if (type === 'BODY') {
      fields.body = str(comp.text) ?? '';
      const bt = asObj(comp.example).body_text;
      if (Array.isArray(bt) && Array.isArray(bt[0])) {
        bodyExamples = (bt[0] as unknown[]).map((v) => (typeof v === 'string' ? v : ''));
      }
      continue;
    }

    if (type === 'FOOTER') {
      fields.footer = str(comp.text);
      continue;
    }

    if (type === 'BUTTONS') {
      const list = Array.isArray(comp.buttons) ? comp.buttons : [];
      for (const raw of list) {
        const b = asObj(raw);
        const bType = (str(b.type) ?? '').toUpperCase();
        const text = str(b.text) ?? '';
        if (bType === 'QUICK_REPLY') {
          fields.buttons.push({ type: 'quick_reply', text });
        } else if (bType === 'URL') {
          fields.buttons.push({ type: 'url', text, url: str(b.url) ?? '' });
        } else if (bType === 'PHONE_NUMBER') {
          fields.buttons.push({ type: 'phone', text, phone: str(b.phone_number) ?? '' });
        }
        // COPY_CODE / OTP / FLOW: sem equivalente na tabela local — ignorados
        // de propósito (ficam preservados na Meta, só não aparecem na edição).
      }
      continue;
    }
  }

  // variables = posição → descrição. Sem descrição própria na Meta, usamos o
  // exemplo que ela devolve (é o que o admin escreveu ao criar o modelo).
  for (const pos of variablePositions(fields.body)) {
    const sample = bodyExamples[pos - 1];
    fields.variables[String(pos)] = sample && sample.trim() ? sample : `Variável ${pos}`;
  }

  return fields;
}

// A tabela local é UNIQUE (org_id, name) — a Meta é única por (name, language).
// Quando a mesma WABA tem o modelo em dois idiomas, só um cabe aqui: fica o
// pt_BR (idioma dos modelos de verdade do projeto); sem pt_BR, o primeiro.
function preferTemplate(current: MetaTemplate | undefined, candidate: MetaTemplate): MetaTemplate {
  if (!current) return candidate;
  const isPt = (t: MetaTemplate) => (t.language ?? '').toLowerCase().startsWith('pt');
  if (!isPt(current) && isPt(candidate)) return candidate;
  return current;
}

interface SyncCounters {
  providers: string[];
  checked: number;
  updated: number;
  imported: number;
  approved: number;
  rejected: number;
}

type SyncAdmin = ReturnType<typeof getAdminClient>;

// Sincroniza UMA organização. Erros de credencial/rede sobem para o chamador:
// o admin vê a mensagem na tela; a chamada de service role pula a org.
async function syncOrg(admin: SyncAdmin, orgId: string): Promise<SyncCounters> {
  const out: SyncCounters = {
    providers: [],
    checked: 0,
    updated: 0,
    imported: 0,
    approved: 0,
    rejected: 0,
  };

  const zernioChannels = await listActiveChannels(admin, orgId, 'zernio');
  const metaChannels = await listActiveChannels(admin, orgId, 'meta');

  // -------------------------------------------------------------------------
  // Zernio — comportamento histórico, intacto.
  // -------------------------------------------------------------------------
  // A org pode não ter Zernio nenhum (caso da clínica, que é Meta direto): aí
  // loadOrgZernioContext falha e a rotina é pulada em silêncio, desde que exista
  // canal Meta para fazer o trabalho. Sem canal Meta, o erro sobe como antes —
  // é informação útil para quem só tem Zernio.
  let zernioCtx: Awaited<ReturnType<typeof loadOrgZernioContext>> | null = null;
  try {
    zernioCtx = await loadOrgZernioContext(admin, orgId);
  } catch (err) {
    if (metaChannels.length === 0) throw err;
    zernioCtx = null;
  }

  if (zernioCtx) {
    out.providers.push('zernio');
    // Lista os templates da Meta por canal Zernio da org (accountId de cada
    // número conectado + o default da org como fallback). O status é o mesmo por
    // WABA, mas números distintos podem ter templates distintos.
    const accountIds = [
      ...new Set(
        [zernioCtx.accountId, ...zernioChannels.map((ch) => ch.zernio_account_id)]
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const byName = new Map<string, { id: string | null; name: string | null; status: string | null }>();
    for (const accountId of accountIds) {
      const remote = await listTemplates(zernioCtx.apiKey, accountId);
      for (const t of remote) {
        if (t.name) byName.set(t.name, t);
      }
    }
    out.checked += byName.size;

    // Só os templates DA ORG do caller. Sincronizamos todos que casam por nome
    // para refletir mudanças (ex.: pausados).
    const { data: locals, error } = await admin
      .from('templates')
      .select('id, name, status')
      .eq('org_id', orgId);
    if (error) throw new Error(error.message);

    for (const local of (locals ?? []) as Array<{ id: string; name: string; status: string }>) {
      const r = byName.get(local.name);
      if (!r) continue;
      const mapped = mapStatus(r.status);
      const patch: Record<string, unknown> = {
        status: mapped,
        meta_template_status: r.status ?? null,
      };
      if (r.id) patch.meta_template_id = r.id;
      if (mapped === 'approved') {
        patch.approved_at = new Date().toISOString();
        out.approved++;
      } else if (mapped === 'rejected') {
        out.rejected++;
      }
      // Evita escrita redundante quando nada mudou.
      if (local.status !== mapped || r.id) {
        await admin.from('templates').update(patch).eq('id', local.id);
        out.updated++;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Meta Cloud API direta — importa e atualiza (upsert por org_id + name).
  // -------------------------------------------------------------------------
  if (metaChannels.length > 0) {
    out.providers.push('meta');

    // Uma WABA pode ter vários números (canais). Os modelos são da WABA, não do
    // número: agrupa para não listar a mesma conta duas vezes.
    const byWaba = new Map<string, typeof metaChannels[number]>();
    for (const ch of metaChannels) {
      const waba = ch.meta_waba_id?.trim();
      if (waba && !byWaba.has(waba)) byWaba.set(waba, ch);
    }

    const remoteByName = new Map<string, MetaTemplate>();
    for (const channel of byWaba.values()) {
      const ctx = await metaContextFromChannel(channel);
      for (const t of await metaListTemplates(ctx)) {
        if (!t.name) continue;
        remoteByName.set(t.name, preferTemplate(remoteByName.get(t.name), t));
      }
    }
    out.checked += remoteByName.size;

    const { data: locals, error } = await admin
      .from('templates')
      .select('id, name, status, approved_at')
      .eq('org_id', orgId);
    if (error) throw new Error(error.message);

    const localByName = new Map(
      ((locals ?? []) as Array<{ id: string; name: string; status: string; approved_at: string | null }>)
        .map((l) => [l.name, l]),
    );

    const now = new Date().toISOString();
    for (const [name, remote] of remoteByName) {
      const mapped = mapStatus(remote.status);
      const fields = metaComponentsToFields(remote.components);
      const local = localByName.get(name);
      // A Meta manda rejected_reason='NONE' em modelo aprovado — só interessa
      // quando é motivo de verdade.
      const reason = remote.rejectedReason && remote.rejectedReason.toUpperCase() !== 'NONE'
        ? remote.rejectedReason
        : null;

      // Idempotente: o conflito (org_id, name) — constraint templates_org_name_key
      // — transforma a 2ª rodada em UPDATE, nunca em linha duplicada.
      const row: Record<string, unknown> = {
        org_id: orgId,
        name,
        category: mapCategory(remote.category),
        language: remote.language ?? 'pt_BR',
        status: mapped,
        meta_template_id: remote.id,
        // Guarda o estado cru e, quando houver, o motivo da recusa — o enum
        // local não tem onde registrar isso.
        meta_template_status: reason
          ? `${remote.status ?? ''} · ${reason}`.trim()
          : (remote.status ?? null),
        body: fields.body,
        header_type: fields.header_type,
        header_content: fields.header_content,
        footer: fields.footer,
        buttons: fields.buttons,
        variables: fields.variables,
      };
      if (mapped === 'approved') {
        row.approved_at = local?.approved_at ?? now;
      }

      const { error: upErr } = await admin
        .from('templates')
        .upsert(row, { onConflict: 'org_id,name' });
      if (upErr) {
        console.error(JSON.stringify({ event: 'sync_template_upsert_failed', name, error: upErr.message }));
        continue;
      }

      if (local) out.updated++;
      else out.imported++;
      if (mapped === 'approved') out.approved++;
      else if (mapped === 'rejected') out.rejected++;
    }
  }

  return out;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const admin = getAdminClient();

    // Portão de acesso: admin logado (escopo = a própria org) ou service role
    // (escopo = org do corpo, ou todas as ativas). Nenhum caminho novo abre a
    // função para usuário comum: requireServiceRole compara com a chave de
    // serviço, que já tem acesso total ao banco.
    let orgIds: string[];
    let scope: 'admin' | 'service';
    try {
      const caller = await requireAdmin(req);
      orgIds = [caller.orgId];
      scope = 'admin';
    } catch (err) {
      if (!(err instanceof AuthError)) throw err;
      await requireServiceRole(req);
      scope = 'service';
      const body = await req.json().catch(() => ({})) as { org_id?: unknown };
      if (typeof body?.org_id === 'string' && body.org_id.trim()) {
        orgIds = [body.org_id.trim()];
      } else {
        const { data: orgs, error } = await admin
          .from('organizations')
          .select('id')
          .eq('status', 'active');
        if (error) return jsonResponse({ ok: false, error: error.message }, { status: 500 });
        orgIds = ((orgs ?? []) as Array<{ id: string }>).map((o) => o.id);
      }
    }

    const total: SyncCounters = {
      providers: [],
      checked: 0,
      updated: 0,
      imported: 0,
      approved: 0,
      rejected: 0,
    };
    const failures: Array<{ org_id: string; error: string }> = [];

    for (const orgId of orgIds) {
      try {
        const one = await syncOrg(admin, orgId);
        for (const p of one.providers) {
          if (!total.providers.includes(p)) total.providers.push(p);
        }
        total.checked += one.checked;
        total.updated += one.updated;
        total.imported += one.imported;
        total.approved += one.approved;
        total.rejected += one.rejected;
      } catch (err) {
        // Chamada de admin (uma org só): o erro é a resposta — o operador
        // precisa vê-lo na tela. Chamada de service role: registra e segue.
        if (scope === 'admin') throw err;
        failures.push({ org_id: orgId, error: err instanceof Error ? err.message : 'erro' });
      }
    }

    return jsonResponse({
      ok: true,
      scope,
      orgs: orgIds.length,
      providers: total.providers,
      checked: total.checked,
      // `updated` conta linhas escritas de fato; `imported` são as que não
      // existiam aqui e vieram da Meta agora.
      updated: total.updated + total.imported,
      imported: total.imported,
      approved: total.approved,
      rejected: total.rejected,
      failures,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonResponse({ ok: false, error: err.message }, { status: err.status });
    }
    if (err instanceof ZernioError) {
      return jsonResponse({ ok: false, error: err.message }, { status: err.status === 401 ? 401 : 502 });
    }
    if (err instanceof MetaCloudError) {
      return jsonResponse({ ok: false, error: err.message }, { status: err.status === 401 ? 401 : 502 });
    }
    console.error('sync-template-status error', err);
    return jsonResponse({ ok: false, error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 });
  }
});
