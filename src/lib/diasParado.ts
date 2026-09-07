// Relógio de estagnação — APRESENTAÇÃO APENAS.
//
// Lê `deals.stage_entered_at` (carimbado pela importação do WebDental com a
// Dt Orçamento, nunca com a data do import) e devolve há quantos dias o
// orçamento está parado na etapa atual, mais o tom do chip.
//
// Este arquivo NÃO consulta o banco, NÃO decide disparo e NÃO conhece a régua.
// A régua de follow-up vive em `check-follow-ups` (Edge Function) e é
// território de outro trabalho. Aqui só se converte data em rótulo.
//
// Por que a recepção precisa disso na tela: com 81 orçamentos abertos, o que
// decide a ordem do dia não é o valor — é há quanto tempo o paciente está sem
// resposta. Sem o número na cara, a operadora abriria card por card.

export type TomParado = 'novo' | 'atencao' | 'critico';

/** Dias inteiros desde a entrada na etapa. `null` quando não há carimbo. */
export function diasParado(stageEnteredAt: string | null | undefined): number | null {
  if (!stageEnteredAt) return null;
  const t = new Date(stageEnteredAt).getTime();
  if (Number.isNaN(t)) return null;
  const dias = Math.floor((Date.now() - t) / 86_400_000);
  return dias < 0 ? 0 : dias;
}

// Faixas alinhadas ao ciclo do orçamento odonto (7 dias até encerrar):
// 0–1 = ainda quente · 2 = começa a esfriar · 3+ = precisa de ação hoje.
export function tomParado(dias: number): TomParado {
  if (dias >= 3) return 'critico';
  if (dias >= 2) return 'atencao';
  return 'novo';
}

/** "Hoje" · "1 dia" · "N dias" — texto do chip. */
export function rotuloParado(dias: number): string {
  if (dias <= 0) return 'Hoje';
  return dias === 1 ? '1 dia' : `${dias} dias`;
}

// Chip: fundo tingido + texto escuro, todos os pares acima de 4,5:1.
// crítico  #B02D26 sobre #FDEBEA = 5,62:1
// atenção  #9A4A07 sobre #FDF1E3 = 5,70:1
// novo     #4E666B sobre #EEF6F7 = 5,58:1
export const PARADO_CHIP_CLASS: Record<TomParado, string> = {
  critico: 'bg-[var(--color-error-bg)] text-[var(--color-error)]',
  atencao: 'bg-[var(--color-warning-bg)] text-[var(--color-warning)]',
  novo: 'bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]',
};
