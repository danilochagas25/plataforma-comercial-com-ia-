// Vocabulário das seções, num lugar só. Clínica Amor Saúde Itabuna —
// Odontologia: "Oportunidades" virou **Orçamentos** e "Pessoas" virou
// **Pacientes** (decisão do dono, 07/09/2026). Só o rótulo que o usuário lê
// muda: rota, tabela, tipo e variável continuam com o nome antigo.
//
// Fala do trabalho comercial de qualquer
// negócio, sem jargão de CRM (nada de "pipeline", "deal", "inbox") e sem
// metáfora. Trocar aqui reflete no menu, nos títulos de página e nos textos
// que citam a seção. Chaves estáveis; só os valores mudam.
export const VOCAB = {
  dashboard:   'Painel',
  inbox:       'Conversas',
  funnel:      'Orçamentos',
  sales:       'Clientes',
  contacts:    'Pacientes',
  campaigns:   'Disparos',
  automations: 'Fluxos',
  aiAgent:     'Atendente IA',
  settings:    'Ajustes',
  orgs:        'Contas',
} as const;

// Singular/plural e artigos usados em frases correntes ("abrir a oportunidade",
// "nova pessoa"). Mantém a concordância quando o vocabulário muda.
export const VOCAB_UNIT = {
  deal:    { one: 'orçamento',  many: 'orçamentos', article: 'o' },
  contact: { one: 'paciente',   many: 'pacientes',  article: 'o' },
  stage:   { one: 'etapa',        many: 'etapas',        article: 'a' },
} as const;
