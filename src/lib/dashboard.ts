// Registry de widgets e utilidades de período do Painel.
//
// 07/09/2026 — o painel deixou de ser o do template do curso (infoproduto:
// "previsão de caixa", "quem mais fechou", origem de tráfego por UTM) e passou
// a responder as perguntas da clínica: quanto foi orçado, quanto fechou,
// quanto está parado e o quanto isso está longe da meta da franqueadora.
//
// Os widgets de UTM foram RETIRADOS: paciente de odontologia chega pela cadeira
// do dentista, não por anúncio — nenhum orçamento tem UTM e todos ficariam
// eternamente em "Sem dados de rastreio ainda".

export type WidgetKey =
  | 'odonto_resumo'
  | 'odonto_conversao'
  | 'odonto_especialidade'
  | 'odonto_parados'
  | 'ranking_vendedores'
  | 'tempo_primeira_resposta';

export interface WidgetDef {
  key: WidgetKey;
  label: string;
  group: 'Orçamentos' | 'Atendimento';
}

// Ordem = posição default no grid.
export const WIDGETS: WidgetDef[] = [
  { key: 'odonto_resumo', label: 'Orçado · Aprovado · Parado', group: 'Orçamentos' },
  { key: 'odonto_conversao', label: 'Conversão em valor e em tratamentos', group: 'Orçamentos' },
  { key: 'odonto_especialidade', label: 'Conversão por especialidade', group: 'Orçamentos' },
  { key: 'odonto_parados', label: 'Há quanto tempo estão parados', group: 'Orçamentos' },
  // Título do cartão é "Quem mais fechou" (fica em widgets.tsx, território da
  // frente de design). O rótulo aqui acompanha o cartão de propósito.
  { key: 'ranking_vendedores', label: 'Quem mais fechou', group: 'Atendimento' },
  { key: 'tempo_primeira_resposta', label: 'Tempo até a 1ª resposta', group: 'Atendimento' },
];

// -----------------------------------------------------------------------------
// Metas oficiais da franqueadora (relatório Controle de Efetivação, Dental
// Vidas / AmorSaúde). NÃO são metas internas: mudar aqui é decisão do Danilo.
// -----------------------------------------------------------------------------

/** Meta de aprovação, tanto em valor quanto em nº de tratamentos. */
export const META_CONVERSAO_GERAL = 75;

/** Meta por especialidade, chaveada por `products.product_type`. */
export const META_POR_ESPECIALIDADE: Record<string, number> = {
  clinica_geral: 85,
  orto: 35,
  implante: 10,
  protese: 10,
};

/** `products.product_type` → como o dono chama a especialidade. */
export const ESPECIALIDADE_LABEL: Record<string, string> = {
  clinica_geral: 'Clínica Geral',
  orto: 'Ortodontia',
  implante: 'Implantodontia',
  protese: 'Prótese',
  endo: 'Endodontia',
  perio: 'Periodontia',
  cirurgia: 'Cirurgia',
  odontopediatria: 'Odontopediatria',
  estetica: 'Estética',
  sem_especialidade: 'Sem especialidade',
};

export const WIDGET_LABEL: Record<WidgetKey, string> = Object.fromEntries(
  WIDGETS.map((w) => [w.key, w.label]),
) as Record<WidgetKey, string>;

export type PeriodKey = 'all' | 'today' | 'yesterday' | 'this_week' | 'last_week' | '1d' | '7d' | '15d' | '30d' | '60d' | '90d' | 'this_month' | 'last_month' | 'custom';

export const PERIOD_PRESETS: { key: Exclude<PeriodKey, 'custom'>; label: string; days: number }[] = [
  // "Tudo" existe porque a base veio de uma importação: há orçamento de maio
  // ainda em aberto. Sem esta opção o total do painel nunca bate com o total
  // do funil, e o dono acha que sumiu dinheiro.
  { key: 'all', label: 'Tudo', days: 0 },
  { key: 'today', label: 'Hoje', days: 0 },
  { key: 'yesterday', label: 'Ontem', days: 0 },
  { key: 'this_week', label: 'Essa semana', days: 0 },
  { key: 'last_week', label: 'Semana anterior', days: 0 },
  { key: '1d', label: '1d', days: 1 },
  { key: '7d', label: '7d', days: 7 },
  { key: '15d', label: '15d', days: 15 },
  { key: '30d', label: '30d', days: 30 },
  { key: '60d', label: '60d', days: 60 },
  { key: '90d', label: '90d', days: 90 },
  { key: 'this_month', label: 'Este mês', days: 0 },
  { key: 'last_month', label: 'Mês anterior', days: 0 },
];

export interface PeriodRange {
  from: Date;
  to: Date;
}

// Resolve o intervalo a partir do preset (últimos N dias até agora) ou custom.
export function periodRange(key: PeriodKey, customFrom?: string, customTo?: string): PeriodRange {
  if (key === 'custom' && customFrom && customTo) {
    const from = new Date(customFrom + 'T00:00:00');
    const to = new Date(customTo + 'T23:59:59');
    return { from, to };
  }
  if (key === 'all') {
    // Início arbitrário bem antes de qualquer dado da clínica.
    return { from: new Date(2020, 0, 1), to: new Date() };
  }
  if (key === 'today') {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { from, to: now };
  }
  if (key === 'yesterday') {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59);
    return { from, to };
  }
  if (key === 'this_week') {
    // Semana começa no domingo (getDay() === 0).
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
    return { from, to: now };
  }
  if (key === 'last_week') {
    // Domingo a sábado da semana anterior.
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() - 7);
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() - 1, 23, 59, 59);
    return { from, to };
  }
  if (key === 'this_month') {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = now;
    return { from, to };
  }
  if (key === 'last_month') {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    return { from, to };
  }
  const preset = PERIOD_PRESETS.find((p) => p.key === key) ?? PERIOD_PRESETS[1];
  const to = new Date();
  const from = new Date(to.getTime() - preset.days * 24 * 60 * 60 * 1000);
  return { from, to };
}

export function inRange(iso: string | null, r: PeriodRange): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= r.from.getTime() && t <= r.to.getTime();
}

// Formata uma duração (ms) em texto curto pt-BR (min / h / d).
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '-';
  const min = ms / 60000;
  if (min < 60) return `${Math.round(min)} min`;
  const h = min / 60;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} d`;
}

export const brl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

// BRL com centavos (para CAC/ticket, onde arredondar para inteiro engana).
export const brl2 = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 });

// Percentual pt-BR com 1 casa: 12.5 → "12,5%". null → "-".
export function formatPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '-';
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

// Canais normalizados → rótulo legível (para os gráficos de origem).
export const ORIGIN_CHANNEL_LABEL: Record<string, string> = {
  google: 'Google',
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  meta_ads: 'Meta Ads',
  instagram_ads: 'Instagram Ads',
  facebook_ads: 'Facebook Ads',
  google_ads: 'Google Ads',
  tiktok_ads: 'TikTok Ads',
  linkedin_ads: 'LinkedIn Ads',
  youtube_ads: 'YouTube Ads',
  // Chaves de organico e direto que o mapa UTM gera. Sem elas o painel
  // mostrava a chave crua (instagram_organico) no lugar de um rotulo.
  instagram_organico: 'Instagram (orgânico)',
  facebook_organico: 'Facebook (orgânico)',
  google_organico: 'Google (orgânico)',
  tiktok_organico: 'TikTok (orgânico)',
  linkedin_organico: 'LinkedIn (orgânico)',
  whatsapp_direto: 'WhatsApp direto',
  outro: 'Outro',
};

export const TRAFFIC_LABEL: Record<string, string> = {
  organico: 'Orgânico',
  pago: 'Pago',
  direto: 'Direto',
  manual: 'Manual',
};
