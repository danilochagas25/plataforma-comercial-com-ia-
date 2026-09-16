import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { useAppUser } from '@/app/providers/AppUserProvider';
import type { AudienceFilter, Campaign, VariableSource } from '@/types/campaigns';
import type { Contact } from '@/types/db';

interface CreateCampaignInput {
  name: string;
  template_id: string;
  audience_filter: AudienceFilter;
  variable_mapping: Record<string, VariableSource>;
  scheduled_at: string | null; // ISO; null = start immediately
  // Número (canal Zernio) que dispara o broadcast; null = default da org.
  channel_id: string | null;
  /**
   * Público explícito, em vez de resolver `audience_filter`. Usado pelo disparo
   * que sai da própria importação: ali já sabemos exatamente quem entrou no
   * lote, e reconsultar por filtro pegaria também quem chegou em dias
   * anteriores. A trava anti-repetição continua valendo sobre esta lista.
   */
  contact_ids?: string[];
}

interface UseCampaignsResult {
  campaigns: Campaign[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  createAndQueue: (
    input: CreateCampaignInput,
  ) => Promise<{ campaign: Campaign; queued: number; removidosAprovado: number } | null>;
  pause: (id: string) => Promise<void>;
  resume: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  previewAudience: (filter: AudienceFilter) => Promise<AudiencePreview>;
}

export interface AudiencePreview {
  total: number;
  /** Tirados porque só têm orçamento aprovado (regra de 16/09/2026). */
  removidosAprovado: number;
}

interface OrcamentoLinha {
  contact_id: string;
  status: string | null;
  stage_id: string | null;
  archived_at: string | null;
}

// Etapas marcadas como "ganho" (hoje só "Aprovado"). O deal aprovado pode estar
// na etapa e ainda com status 'open' — a importação só vira o status depois —,
// por isso a regra olha as duas coisas.
async function carregarEtapasAprovado(): Promise<Set<string>> {
  const { data, error } = await getSupabase().from('stages').select('id').eq('is_won', true);
  if (error) throw new Error(error.message);
  return new Set(((data ?? []) as Array<{ id: string }>).map((s) => s.id));
}

function ehAprovado(d: Pick<OrcamentoLinha, 'status' | 'stage_id'>, etapasAprovado: Set<string>): boolean {
  return d.status === 'won' || (d.stage_id !== null && etapasAprovado.has(d.stage_id));
}

// Lê todos os orçamentos em páginas: o PostgREST devolve no máximo 1000 linhas
// por consulta, e a base já passa de 600.
async function carregarTodosOsOrcamentos(): Promise<OrcamentoLinha[]> {
  const PAGINA = 1000;
  const out: OrcamentoLinha[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await getSupabase()
      .from('deals')
      .select('contact_id, status, stage_id, archived_at')
      .order('id')
      .range(de, de + PAGINA - 1);
    if (error) throw new Error(error.message);
    const linhas = (data ?? []) as OrcamentoLinha[];
    out.push(...linhas);
    if (linhas.length < PAGINA) break;
  }
  return out;
}

// Regra do Danilo (16/09/2026): disparo é para quem tem orçamento NÃO aprovado.
// Sai quem tem orçamento aprovado e nenhum outro em aberto. Quem aprovou um e
// tem outro ainda não aprovado (aprovou a limpeza, não o implante) continua
// recebendo — é o orçamento caro que a clínica perde. Paciente sem orçamento
// nenhum (etiqueta, base toda) não é afetado.
async function removerQuemSoTemAprovado(
  ids: string[],
): Promise<{ ids: string[]; removidos: number }> {
  if (ids.length === 0) return { ids, removidos: 0 };
  const [etapasAprovado, orcamentos] = await Promise.all([
    carregarEtapasAprovado(),
    carregarTodosOsOrcamentos(),
  ]);
  const comAprovado = new Set<string>();
  const comOutroEmAberto = new Set<string>();
  for (const d of orcamentos) {
    if (ehAprovado(d, etapasAprovado)) comAprovado.add(d.contact_id);
    else if (!d.archived_at) comOutroEmAberto.add(d.contact_id);
  }
  const ficam = ids.filter((id) => !comAprovado.has(id) || comOutroEmAberto.has(id));
  return { ids: ficam, removidos: ids.length - ficam.length };
}

// Tira da lista quem já recebeu disparo nos últimos N dias. Buscamos QUEM
// recebeu no período (poucas linhas) em vez de filtrar pela lista de
// candidatos: um `.in()` com a base inteira estoura o tamanho da URL do
// PostgREST.
async function aplicarTravaDeRepeticao(
  ids: string[],
  dias: number | undefined,
): Promise<string[]> {
  if (!(typeof dias === 'number' && dias > 0) || ids.length === 0) return ids;
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentes, error } = await getSupabase()
    .from('campaign_contacts')
    .select('contact_id')
    .gte('sent_at', desde)
    // `sent_at` marca a TENTATIVA, e a Meta pode recusar depois. Quem ficou em
    // 'failed' não recebeu nada — segurar essa pessoa é o contrário do que a
    // trava existe para fazer: ela protege quem JÁ foi alcançado, não quem o
    // envio não alcançou.
    .neq('status', 'failed');
  if (error) throw new Error(error.message);
  const jaRecebeu = new Set(
    ((recentes ?? []) as Array<{ contact_id: string }>).map((r) => r.contact_id),
  );
  return ids.filter((id) => !jaRecebeu.has(id));
}

// Última etapa de toda montagem de público, com filtro ou com lista pronta:
// primeiro a regra do aprovado, depois a trava anti-repetição.
async function aplicarTravasDoDisparo(
  ids: string[],
  dias: number | undefined,
): Promise<{ ids: string[]; removidosAprovado: number }> {
  const semAprovado = await removerQuemSoTemAprovado(ids);
  return {
    ids: await aplicarTravaDeRepeticao(semAprovado.ids, dias),
    removidosAprovado: semAprovado.removidos,
  };
}

async function resolveAudienceIds(
  filter: AudienceFilter,
): Promise<{ ids: string[]; removidosAprovado: number }> {
  const vazio = { ids: [] as string[], removidosAprovado: 0 };
  const supabase = getSupabase();

  const hasTags = Array.isArray(filter.tag_ids) && filter.tag_ids.length > 0;
  const cfEntries = Object.entries(filter.custom_fields ?? {}).filter(
    ([k, v]) => k.trim() && v.trim(),
  );
  const hasCustom = cfEntries.length > 0;
  const hasPipeline = typeof filter.pipeline_id === 'string' && filter.pipeline_id.length > 0;
  const hasStages = Array.isArray(filter.stage_ids) && filter.stage_ids.length > 0;
  // Período do orçamento: 'YYYY-MM-DD' vira o instante de abertura/fechamento
  // do dia NO FUSO DE QUEM MONTA o disparo (a recepção escolhe "ontem" pensando
  // no dia dela, não em UTC).
  const dealFrom = typeof filter.deal_from === 'string' && filter.deal_from ? filter.deal_from : null;
  const dealTo = typeof filter.deal_to === 'string' && filter.deal_to ? filter.deal_to : null;
  const hasPeriod = Boolean(dealFrom || dealTo);
  const hasDeals = hasPipeline || hasStages || hasPeriod;

  // SEGURANÇA: só dispara para TODA a base quando o filtro é explicitamente
  // `{ all: true }`. Um filtro de tags/custom/funil vazio (ex.: modo "tags"
  // selecionado mas nenhuma tag marcada) resolve para ZERO — nunca para todos
  // — para evitar disparo em massa acidental contra a base inteira.
  if (!filter.all && !hasTags && !hasCustom && !hasDeals) return vazio;

  // Interseção (AND) entre conjuntos de candidatos; null = "sem restrição ainda".
  const intersect = (a: string[] | null, b: string[]): string[] =>
    a === null ? b : a.filter((id) => new Set(b).has(id));

  // Start with the set of contact IDs matching tag filters, if any.
  let candidateIds: string[] | null = null;
  if (hasTags) {
    const { data: links } = await supabase
      .from('contact_tags')
      .select('contact_id')
      .in('tag_id', filter.tag_ids as string[]);
    candidateIds = Array.from(
      new Set(((links ?? []) as Array<{ contact_id: string }>).map((l) => l.contact_id)),
    );
    if (candidateIds.length === 0) return vazio;
  }

  // Restringe pelos contatos que têm ao menos um deal no funil/etapas escolhidos.
  // Filtrar por stage_id já implica o funil; sem etapas, considera o funil todo.
  if (hasDeals) {
    let dealsQuery = supabase.schema('whatsapp_hub').from('deals').select('contact_id, status, stage_id');
    if (hasStages) dealsQuery = dealsQuery.in('stage_id', filter.stage_ids as string[]);
    else if (hasPipeline) dealsQuery = dealsQuery.eq('pipeline_id', filter.pipeline_id as string);
    // `stage_entered_at` é a data do orçamento carimbada pela importação do
    // WebDental (ver src/lib/diasParado.ts). O relógio reinicia se alguém
    // arrastar o card de coluna — para a régua diária, que só olha cards
    // recém-importados, isso não acontece.
    if (dealFrom) dealsQuery = dealsQuery.gte('stage_entered_at', new Date(`${dealFrom}T00:00:00`).toISOString());
    if (dealTo) dealsQuery = dealsQuery.lte('stage_entered_at', new Date(`${dealTo}T23:59:59.999`).toISOString());
    const { data: dealRows, error: dealsErr } = await dealsQuery;
    if (dealsErr) throw new Error(dealsErr.message);
    // Orçamento aprovado não conta como motivo para receber: escolher a coluna
    // "Aprovado" não alcança ninguém, e o período vale sobre o orçamento em aberto.
    const etapasAprovado = await carregarEtapasAprovado();
    const dealContactIds = Array.from(
      new Set(
        ((dealRows ?? []) as Array<Pick<OrcamentoLinha, 'contact_id' | 'status' | 'stage_id'>>)
          .filter((d) => !ehAprovado(d, etapasAprovado))
          .map((d) => d.contact_id),
      ),
    );
    if (dealContactIds.length === 0) return vazio;
    candidateIds = intersect(candidateIds, dealContactIds);
    if (candidateIds.length === 0) return vazio;
  }

  let query = supabase.schema('whatsapp_hub').from('contacts').select('id, custom_fields');
  if (candidateIds) query = query.in('id', candidateIds);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<Pick<Contact, 'id' | 'custom_fields'>>;

  // Apply custom-field filter in JS (Postgrest JSON filters would work too
  // but stay simple for now — audiences are small).
  const filtered = !hasCustom
    ? rows
    : rows.filter((r) => {
        const fields = r.custom_fields ?? {};
        return cfEntries.every(([k, v]) => String(fields[k] ?? '') === v);
      });

  return await aplicarTravasDoDisparo(filtered.map((r) => r.id), filter.exclude_messaged_days);
}

export function useCampaigns(): UseCampaignsResult {
  const { userId } = useAppUser();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    const { data, error: err } = await supabase
      .from('campaigns')
      .select('*')
      .order('created_at', { ascending: false });
    if (err) setError(err.message);
    else setCampaigns((data ?? []) as Campaign[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Subscribes to live campaign-row changes so the list stays fresh while
  // dispatch-campaign bumps counters in the background. Channel name is
  // randomized per mount because React StrictMode double-mounts effects —
  // Supabase rejects adding listeners to a channel whose subscription is
  // still being torn down from the first invocation.
  useEffect(() => {
    if (!userId) return;
    const supabase = getSupabase();
    const channelName = `campaigns:${Math.random().toString(36).slice(2, 10)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'whatsapp_hub',
          table: 'campaigns',
        },
        () => {
          void reload();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, reload]);

  const previewAudience = async (filter: AudienceFilter): Promise<AudiencePreview> => {
    if (!userId) return { total: 0, removidosAprovado: 0 };
    const r = await resolveAudienceIds(filter);
    return { total: r.ids.length, removidosAprovado: r.removidosAprovado };
  };

  const createAndQueue: UseCampaignsResult['createAndQueue'] = async (input) => {
    if (!userId) return null;
    const supabase = getSupabase();

    // Lista explícita (disparo que sai da importação) ou resolução por filtro.
    // Mesmo com lista pronta, as travas valem: um paciente que já recebeu ontem
    // não pode ser cobrado de novo só porque um orçamento novo dele entrou hoje,
    // e quem só tem orçamento aprovado não recebe.
    const publico = input.contact_ids?.length
      ? await aplicarTravasDoDisparo(input.contact_ids, input.audience_filter.exclude_messaged_days)
      : await resolveAudienceIds(input.audience_filter);
    const contactIds = publico.ids;
    if (contactIds.length === 0) {
      throw new Error('Nenhum contato corresponde aos filtros da audiência.');
    }

    const { data: campaign, error: err } = await supabase
      .from('campaigns')
      .insert({
        name: input.name,
        template_id: input.template_id,
        channel_id: input.channel_id,
        status: input.scheduled_at ? 'scheduled' : 'sending',
        scheduled_at: input.scheduled_at,
        audience_filter: input.audience_filter,
        variable_mapping: input.variable_mapping,
        total_contacts: contactIds.length,
        started_at: input.scheduled_at ? null : new Date().toISOString(),
      })
      .select()
      .single();
    if (err || !campaign) {
      throw new Error(err?.message ?? 'Falha ao criar campanha');
    }
    const created = campaign as Campaign;

    // Materialize the queue. Chunk to be friendly to PostgREST payload limits.
    const CHUNK = 500;
    for (let i = 0; i < contactIds.length; i += CHUNK) {
      const chunk = contactIds.slice(i, i + CHUNK);
      const { error: insErr } = await supabase.schema('whatsapp_hub').from('campaign_contacts').insert(
        chunk.map((contact_id) => ({
          campaign_id: created.id,
          contact_id,
          status: 'pending' as const,
        })),
      );
      if (insErr) throw new Error(insErr.message);
    }

    await reload();
    return { campaign: created, queued: contactIds.length, removidosAprovado: publico.removidosAprovado };
  };

  const pause: UseCampaignsResult['pause'] = async (id) => {
    const supabase = getSupabase();
    const { error: err } = await supabase
      .from('campaigns')
      .update({ status: 'paused' })
      .eq('id', id);
    if (err) {
      setError(err.message);
      throw new Error(translateDbError(err.message));
    }
    await reload();
  };

  const resume: UseCampaignsResult['resume'] = async (id) => {
    const supabase = getSupabase();
    const { error: err } = await supabase
      .from('campaigns')
      .update({ status: 'sending' })
      .eq('id', id);
    if (err) {
      setError(err.message);
      throw new Error(translateDbError(err.message));
    }
    await reload();
  };

  const remove: UseCampaignsResult['remove'] = async (id) => {
    const supabase = getSupabase();
    const { error: err } = await supabase.schema('whatsapp_hub').from('campaigns').delete().eq('id', id);
    if (err) {
      setError(err.message);
      throw new Error(translateDbError(err.message));
    }
    await reload();
  };

  return {
    campaigns,
    loading,
    error,
    reload,
    createAndQueue,
    pause,
    resume,
    remove,
    previewAudience,
  };
}

// Maps the most common Postgres/PostgREST errors to actionable pt-BR messages.
function translateDbError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('duplicate key')) return 'Registro duplicado. Verifique os dados informados.';
  if (lower.includes('row-level security') || lower.includes('permission denied')) return 'Você não tem permissão para esta ação.';
  if (lower.includes('violates foreign key')) return 'Não é possível concluir: há registros vinculados.';
  if (lower.includes('violates check constraint') || lower.includes('invalid input')) return 'Dados inválidos. Revise os campos e tente novamente.';
  return message || 'Não foi possível concluir a operação.';
}
