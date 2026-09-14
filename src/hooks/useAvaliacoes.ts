import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';

// Avaliações de atendimento gravadas pela Edge Function `avaliar-atendimentos`.
// A RLS decide o que volta: admin recebe a organização toda, operadora recebe
// só as dela — a tela não precisa (e não deve) filtrar isso por conta própria.

export const CRITERIOS = ['acolhimento', 'entendimento', 'dinheiro', 'conducao', 'clareza'] as const;
export type Criterio = (typeof CRITERIOS)[number];

export const CRITERIO_ROTULO: Record<Criterio, string> = {
  acolhimento: 'Acolhimento',
  entendimento: 'Entender antes de vender',
  dinheiro: 'Condução do valor',
  conducao: 'Próximo passo',
  clareza: 'Clareza',
};

export const REGRA_ROTULO: Record<string, string> = {
  prometeu_resultado: 'Prometeu resultado',
  deu_diagnostico: 'Deu diagnóstico',
  prazo_ou_dor: 'Prazo de cura ou "não dói"',
  preco_inventado: 'Parcelas acima do limite (24x boleto / 12x cartão)',
  comparou_clinica: 'Comparou com outra clínica',
  falou_de_outro_paciente: 'Falou de outro paciente',
  insistiu_apos_nao: 'Insistiu depois de um "não"',
  chamou_de_socio: 'Chamou filiado de "sócio"',
};

export interface AvaliacaoCriterio {
  nota: number | null;
  justificativa: string;
  trecho: string | null;
}

export interface AvaliacaoMetricas {
  msgs_atendente: number;
  msgs_paciente: number;
  msgs_outros: number;
  primeira_resposta_min: number | null;
  resposta_mediana_min: number | null;
  respostas_contadas: number;
  respostas_fora_janela: number;
  paciente_esperando_no_fim: boolean;
}

export interface Avaliacao {
  id: string;
  conversation_id: string;
  operador_id: string;
  dia: string;
  status: 'avaliado' | 'insuficiente' | 'erro';
  nota_geral: number | null;
  criterios: Partial<Record<Criterio, AvaliacaoCriterio>>;
  alertas: Array<{ regra: string; trecho: string }>;
  pontos_fortes: string[];
  a_melhorar: string[];
  resumo: string | null;
  metricas: Partial<AvaliacaoMetricas>;
  erro: string | null;
  updated_at: string;
  paciente: string | null;
}

interface LinhaBanco extends Omit<Avaliacao, 'paciente' | 'nota_geral'> {
  nota_geral: number | string | null;
  conversation: { contact: { name: string | null; phone: string | null } | null } | null;
}

export interface RodadaAvaliacao {
  atendimentos: number;
  avaliado: number;
  insuficiente: number;
  erro: number;
}

export function useAvaliacoes(de: string, ate: string) {
  const [avaliacoes, setAvaliacoes] = useState<Avaliacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await getSupabase()
      .from('atendimento_avaliacoes')
      .select('*, conversation:conversations(contact:contacts(name, phone))')
      .gte('dia', de)
      .lte('dia', ate)
      .order('dia', { ascending: false })
      .limit(1000);
    if (err) {
      setError(err.message);
    } else {
      setAvaliacoes(((data ?? []) as LinhaBanco[]).map((l) => {
        const { conversation, ...resto } = l;
        return {
          ...resto,
          // numeric chega como string em algumas versões do PostgREST.
          nota_geral: l.nota_geral === null ? null : Number(l.nota_geral),
          alertas: Array.isArray(l.alertas) ? l.alertas : [],
          paciente: conversation?.contact?.name ?? conversation?.contact?.phone ?? null,
        };
      }));
    }
    setLoading(false);
  }, [de, ate]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Pede avaliação à Edge Function (só admin). Cada chamada processa um lote;
  // repete enquanto sobrar atendimento, com teto para não prender a tela.
  const avaliar = useCallback(async (dia?: string): Promise<RodadaAvaliacao> => {
    const total: RodadaAvaliacao = { atendimentos: 0, avaliado: 0, insuficiente: 0, erro: 0 };
    for (let volta = 0; volta < 6; volta++) {
      const { data, error: err } = await getSupabase().functions.invoke('avaliar-atendimentos', {
        body: dia ? { dia } : {},
      });
      if (err || !data?.ok) {
        const msg = (data as { error?: string } | null)?.error ?? err?.message ?? 'Falha ao avaliar.';
        throw new Error(msg);
      }
      const r = data.data as RodadaAvaliacao & { restantes: number };
      total.atendimentos = r.atendimentos;
      total.avaliado += r.avaliado;
      total.insuficiente += r.insuficiente;
      total.erro += r.erro;
      if (!r.restantes) break;
    }
    await reload();
    return total;
  }, [reload]);

  return { avaliacoes, loading, error, reload, avaliar };
}
