// ============================================================================
// submit-template
// ----------------------------------------------------------------------------
// Admin ships a locally-drafted template to Meta for approval. We translate
// the row in whatsapp_hub.templates into Meta's component schema, POST it,
// and update the row with status='pending' + meta_template_id.
//
// Dois caminhos, escolhidos pelo canal ativo da org:
//   provider='meta'   → POST /v25.0/{waba_id}/message_templates (Graph API
//                       direta). Componentes em MAIÚSCULAS.
//   provider='zernio' → POST /whatsapp/templates (Zernio relaya a Meta).
//                       Componentes em minúsculas.
// Org com os DOIS canais usa o **meta**: a decisão vigente do projeto
// (05/09/2026) é falar direto com a Meta, sem intermediário.
//
// Meta's template schema is component-oriented:
//   components: [
//     { type: 'HEADER', format: 'TEXT|IMAGE|VIDEO|DOCUMENT', text?, example? },
//     { type: 'BODY', text, example? },
//     { type: 'FOOTER', text },
//     { type: 'BUTTONS', buttons: [{type:'QUICK_REPLY',text},{type:'URL',text,url},{type:'PHONE_NUMBER',text,phone_number}] },
//   ]
// O Zernio usa o MESMO desenho em minúsculas (e phone_number vira 'phone_number'
// do mesmo jeito) — por isso os dois construtores abaixo compartilham a lógica
// e diferem só no caixa das chaves.
// ============================================================================

import { requireAdmin, AuthError } from '../_shared/auth.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import {
  ZernioError,
  createTemplate,
  type ZernioTemplateCategory,
} from '../_shared/zernio.ts';
import { listActiveChannels, loadOrgZernioContext } from '../_shared/channels.ts';
import {
  MetaCloudError,
  metaContextFromChannel,
  metaCreateTemplate,
  type MetaTemplateCategory,
} from '../_shared/meta-cloud.ts';

type HeaderType = 'none' | 'text' | 'image' | 'video' | 'document';

interface TemplateRow {
  id: string;
  org_id: string;
  name: string;
  category: 'marketing' | 'utility' | 'service' | 'authentication';
  language: string;
  status: 'draft' | 'pending' | 'approved' | 'rejected';
  header_type: HeaderType;
  header_content: string | null;
  body: string;
  footer: string | null;
  buttons: Array<
    | { type: 'quick_reply'; text: string }
    | { type: 'url'; text: string; url: string }
    | { type: 'phone'; text: string; phone: string }
  >;
  variables: Record<string, string>;
}

function countVariables(body: string): number {
  const matches = body.match(/\{\{\s*\d+\s*\}\}/g) ?? [];
  const uniq = new Set(matches.map((m) => m));
  return uniq.size;
}

// A Meta exige `example.body_text` (array de arrays) quando o corpo tem
// variáveis. Usamos as descrições do usuário como amostra.
function bodyExamples(row: TemplateRow): string[] | null {
  const varCount = countVariables(row.body);
  if (varCount === 0) return null;
  const examples: string[] = [];
  for (let i = 1; i <= varCount; i++) {
    examples.push(row.variables?.[String(i)] || `exemplo ${i}`);
  }
  return examples;
}

// Componentes no formato do Zernio (POST /whatsapp/templates) — tudo lowercase:
// type header|body|footer|buttons; header.format text|image|video|document;
// button.type quick_reply|url|phone_number. Mídia no header vai como
// example.header_handle = [url público] (o Zernio baixa e sobe à Meta).
function buildZernioComponents(row: TemplateRow) {
  const components: Array<Record<string, unknown>> = [];

  if (row.header_type !== 'none') {
    const header: Record<string, unknown> = {
      type: 'header',
      format: row.header_type, // text | image | video | document
    };
    if (row.header_type === 'text') {
      if (row.header_content) header.text = row.header_content;
    } else if (row.header_content) {
      // header_content guarda a URL de exemplo da mídia (amostra p/ a Meta).
      header.example = { header_handle: [row.header_content] };
    }
    components.push(header);
  }

  const body: Record<string, unknown> = { type: 'body', text: row.body };
  const examples = bodyExamples(row);
  if (examples) body.example = { body_text: [examples] };
  components.push(body);

  if (row.footer) {
    components.push({ type: 'footer', text: row.footer });
  }

  if (row.buttons && row.buttons.length > 0) {
    components.push({
      type: 'buttons',
      buttons: row.buttons.map((b) => {
        if (b.type === 'quick_reply') return { type: 'quick_reply', text: b.text };
        if (b.type === 'url') return { type: 'url', text: b.text, url: b.url };
        if (b.type === 'phone') return { type: 'phone_number', text: b.text, phone_number: b.phone };
        return null;
      }).filter(Boolean),
    });
  }

  return components;
}

// Componentes no formato da Graph API: type/format/button.type em MAIÚSCULAS.
// Diferença real em relação ao Zernio é só o caixa das chaves de tipo — o resto
// do desenho (example.body_text como array de arrays, {{1}} nas variáveis,
// example.header_handle para mídia) é idêntico, porque o Zernio só repassa.
function buildMetaGraphComponents(row: TemplateRow) {
  const components: Array<Record<string, unknown>> = [];

  if (row.header_type !== 'none') {
    const header: Record<string, unknown> = {
      type: 'HEADER',
      format: row.header_type.toUpperCase(), // TEXT | IMAGE | VIDEO | DOCUMENT
    };
    if (row.header_type === 'text') {
      if (row.header_content) header.text = row.header_content;
    } else if (row.header_content) {
      // Para mídia a Meta espera o handle devolvido pela Resumable Upload API.
      // Guardamos o que o admin informou (URL ou handle) — se for URL, a Meta
      // recusa e a mensagem de erro volta para a tela.
      header.example = { header_handle: [row.header_content] };
    }
    components.push(header);
  }

  const body: Record<string, unknown> = { type: 'BODY', text: row.body };
  const examples = bodyExamples(row);
  if (examples) body.example = { body_text: [examples] };
  components.push(body);

  if (row.footer) {
    components.push({ type: 'FOOTER', text: row.footer });
  }

  if (row.buttons && row.buttons.length > 0) {
    components.push({
      type: 'BUTTONS',
      buttons: row.buttons.map((b) => {
        if (b.type === 'quick_reply') return { type: 'QUICK_REPLY', text: b.text };
        if (b.type === 'url') return { type: 'URL', text: b.text, url: b.url };
        if (b.type === 'phone') return { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone };
        return null;
      }).filter(Boolean),
    });
  }

  return components;
}

// A Meta só aceita MARKETING, UTILITY e AUTHENTICATION. A categoria interna
// legada 'service' (atendimento livre) não é categoria de modelo — mapeada para
// UTILITY por compatibilidade.
const CATEGORY_UPPER: Record<TemplateRow['category'], MetaTemplateCategory> = {
  marketing: 'MARKETING',
  utility: 'UTILITY',
  authentication: 'AUTHENTICATION',
  service: 'UTILITY',
};

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const caller = await requireAdmin(req);

    let body: { template_id?: string };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ ok: false, error: 'JSON inválido.' }, { status: 400 });
    }

    if (!body.template_id) {
      return jsonResponse({ ok: false, error: 'template_id ausente.' }, { status: 400 });
    }

    const admin = getAdminClient();

    const { data: row, error: rowErr } = await admin
      .from('templates')
      .select('*')
      .eq('id', body.template_id)
      .maybeSingle();
    if (rowErr) return jsonResponse({ ok: false, error: rowErr.message }, { status: 500 });
    if (!row) return jsonResponse({ ok: false, error: 'Template não encontrado.' }, { status: 404 });

    const template = row as TemplateRow;
    // Cross-check de org: o template deve pertencer à org do caller.
    if (template.org_id !== caller.orgId) {
      return jsonResponse({ ok: false, error: 'Template não encontrado.' }, { status: 404 });
    }

    const category = CATEGORY_UPPER[template.category] ?? 'UTILITY';
    const metaChannels = await listActiveChannels(admin, caller.orgId, 'meta');

    let result: { id: string | null; status: string | null };
    let provider: 'meta' | 'zernio';

    if (metaChannels.length > 0) {
      // Canal Meta tem precedência sobre o Zernio quando a org tem os dois.
      provider = 'meta';
      // Modelo é da WABA: qualquer canal ativo daquela conta serve. Preferimos o
      // primeiro que tenha o ID da WABA preenchido.
      const channel = metaChannels.find((ch) => ch.meta_waba_id?.trim()) ?? metaChannels[0];
      try {
        const ctx = await metaContextFromChannel(channel);
        result = await metaCreateTemplate(ctx, {
          name: template.name,
          language: template.language,
          category,
          components: buildMetaGraphComponents(template),
        });
      } catch (err) {
        // Mantém status='draft' para o admin corrigir e re-tentar.
        const msg = err instanceof Error ? err.message : 'Erro na Meta';
        await admin
          .from('templates')
          .update({ meta_template_status: msg })
          .eq('id', template.id);
        const status = err instanceof MetaCloudError && err.status === 401 ? 401 : 200;
        return jsonResponse({ ok: false, error: msg }, { status });
      }
    } else {
      provider = 'zernio';
      const ctx = await loadOrgZernioContext(admin, caller.orgId);
      try {
        result = await createTemplate({
          apiKey: ctx.apiKey,
          accountId: ctx.accountId,
          name: template.name,
          category: category as ZernioTemplateCategory,
          language: template.language,
          components: buildZernioComponents(template),
        });
      } catch (err) {
        // Mantem status='draft' para o admin corrigir e re-tentar.
        const msg = err instanceof Error ? err.message : 'Erro no Zernio';
        await admin
          .from('templates')
          .update({ meta_template_status: msg })
          .eq('id', template.id);
        const status = err instanceof ZernioError && err.status === 401 ? 401 : 200;
        return jsonResponse({ ok: false, error: msg }, { status });
      }
    }

    const { error: upErr } = await admin
      .from('templates')
      .update({
        status: 'pending',
        meta_template_id: result.id,
        meta_template_status: result.status ?? 'PENDING',
        submitted_at: new Date().toISOString(),
      })
      .eq('id', template.id);

    if (upErr) return jsonResponse({ ok: false, error: upErr.message }, { status: 500 });

    return jsonResponse({
      ok: true,
      provider,
      meta_template_id: result.id,
      meta_status: result.status ?? 'PENDING',
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonResponse({ ok: false, error: err.message }, { status: err.status });
    }
    if (err instanceof MetaCloudError) {
      return jsonResponse({ ok: false, error: err.message }, { status: err.status === 401 ? 401 : 502 });
    }
    console.error('submit-template error', err);
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : 'Erro interno' },
      { status: 500 },
    );
  }
});
