// ============================================================================
// Importação DIÁRIA dos orçamentos (WebDental).
// ----------------------------------------------------------------------------
// Fluxo em 4 passos: arquivo(s) → SIMULAÇÃO → confirmação → resultado.
// NADA é gravado antes de o dono confirmar o resumo. É a regra do projeto.
//
// Por que uma tela própria e não a "Importar contatos": aquela cria contato a
// partir de colunas mapeadas à mão. Esta cria CONTATO + ORÇAMENTO + PROCEDIMENTO
// + CAMPOS, com a data certa no relógio da etapa, e ainda concilia os dois
// relatórios entre si e com o que já está no funil.
//
// 🔴 SÃO **DOIS** ARQUIVOS (decisão do dono, 07/09/2026): "APENAS NÃO
//    APROVADOS" e "APENAS APROVADOS". O WebDental TRUNCA a exportação em 100
//    linhas — com "Exibir: TODOS" são 143 tratamentos e 43 se perdem em
//    silêncio. **O usuário não escolhe qual é qual:** o CRM reconhece cada um
//    pela coluna `Dt Aprovação`, e a tela só mostra o que reconheceu.
//
// 🔴 UM TRATAMENTO = UMA OPORTUNIDADE (decisão do dono, 06/09/2026). Cada LINHA
//    vira um card. O resumo mostra orçamentos e pacientes lado a lado, porque é
//    o número de pacientes que aparece no cabeçalho do relatório.
// ============================================================================

import { useCallback, useState, type ChangeEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  Loader2,
  Search,
  Sparkles,
  TrendingUp,
  Users,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  combinarLeituras,
  parseWebdental,
  rotuloDoTipo,
  type LeituraCombinada,
  type ParseWebdentalResult,
} from '@/lib/webdental';
import {
  aplicarImportacao,
  planejarImportacao,
  OPCOES_PADRAO,
  DIAS_ATE_ENCERRAR,
  ETAPA_APRESENTADO,
  type PlanoImportacao,
  type ResultadoImportacao,
} from '@/lib/odontoImport';

type Passo = 'arquivo' | 'analisando' | 'resumo' | 'gravando' | 'pronto';

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');

interface Props {
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
}

export function ImportOrcamentosDialog({ open, onClose, onDone }: Props) {
  const [passo, setPasso] = useState<Passo>('arquivo');
  const [nomeArquivo, setNomeArquivo] = useState('');
  const [leitura, setLeitura] = useState<LeituraCombinada | null>(null);
  const [plano, setPlano] = useState<PlanoImportacao | null>(null);
  // O contexto do banco carregado na simulação é reaproveitado na gravação,
  // para que o que é aplicado seja exatamente o que foi mostrado.
  const [ctx, setCtx] = useState<unknown>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null);
  const [progresso, setProgresso] = useState({ pct: 0, etapa: '' });
  const [sinalizarSumicos, setSinalizarSumicos] = useState(true);
  const [encerrarVencidos, setEncerrarVencidos] = useState(true);

  const reset = useCallback(() => {
    setPasso('arquivo');
    setNomeArquivo('');
    setLeitura(null);
    setPlano(null);
    setCtx(null);
    setErro(null);
    setResultado(null);
    setProgresso({ pct: 0, etapa: '' });
  }, []);

  const fechar = () => {
    reset();
    onClose();
  };

  const analisar = useCallback(
    async (combinada: LeituraCombinada, opts: { sinalizar: boolean; encerrar: boolean }) => {
      setPasso('analisando');
      setErro(null);
      try {
        const { plano: p, ctx: c } = await planejarImportacao(combinada, {
          ...OPCOES_PADRAO,
          sinalizarSumicos: opts.sinalizar,
          encerrarVencidos: opts.encerrar,
        });
        setPlano(p);
        setCtx(c);
        setPasso('resumo');
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e));
        setPasso('arquivo');
      }
    },
    [],
  );

  // Aceita 1 ou 2 arquivos de uma vez. Qual é o de aprovados e qual é o de não
  // aprovados NÃO é pergunta para o usuário: o parser decide pela coluna
  // `Dt Aprovação` e o resumo mostra o que reconheceu em cada um.
  const escolherArquivo = async (e: ChangeEvent<HTMLInputElement>) => {
    const arquivos = [...(e.target.files ?? [])];
    if (arquivos.length === 0) return;
    setNomeArquivo(arquivos.map((f) => f.name).join(' + '));
    setErro(null);
    try {
      const lidos: ParseWebdentalResult[] = [];
      for (const f of arquivos) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        lidos.push(parseWebdental(bytes, f.name));
      }
      const combinada = combinarLeituras(lidos);
      if (combinada.orcamentos.length === 0) {
        setErro(
          combinada.vendasPlano.length > 0
            ? 'Os arquivos só têm linhas de venda do plano DentalVidas, que não é tratamento. Nenhum orçamento a importar.'
            : 'Não encontrei nenhum orçamento válido nos arquivos.',
        );
        return;
      }
      setLeitura(combinada);
      await analisar(combinada, { sinalizar: sinalizarSumicos, encerrar: encerrarVencidos });
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      e.target.value = '';
    }
  };

  const reanalisar = async (sinalizar: boolean, encerrar: boolean) => {
    if (!leitura) return;
    await analisar(leitura, { sinalizar, encerrar });
  };

  const confirmar = async () => {
    if (!leitura || !plano || !ctx) return;
    setPasso('gravando');
    try {
      const r = await aplicarImportacao(
        leitura,
        plano,
        ctx as Parameters<typeof aplicarImportacao>[2],
        (pct, etapa) => setProgresso({ pct, etapa }),
      );
      setResultado(r);
      setPasso('pronto');
      if (r.erros.length === 0) toast.success('Importação concluída.');
      else toast.warning(`Importação concluída com ${r.erros.length} aviso(s).`);
      onDone?.();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setPasso('resumo');
    }
  };

  const nadaAFazer =
    plano != null &&
    plano.novos.length === 0 &&
    plano.novosAprovados.length === 0 &&
    plano.movidosParaAprovado.length === 0 &&
    plano.atualizados.length === 0 &&
    plano.naoAprovados.length === 0 &&
    plano.sumiramSemExplicacao.length === 0;

  return (
    <Dialog
      open={open}
      onClose={fechar}
      title="Importar orçamentos do WebDental"
      description={
        'Relatório "Controle de Efetivação". Suba os DOIS arquivos: "APENAS NÃO APROVADOS" e ' +
        '"APENAS APROVADOS". O CRM reconhece qual é qual sozinho. ' +
        'Nada é gravado antes de você conferir o resumo.'
      }
      widthClass="max-w-5xl"
      opaque
    >
      {erro && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] p-4">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-error)]" />
          <div className="text-sm text-[var(--color-text-primary)]">{erro}</div>
        </div>
      )}

      {passo === 'arquivo' && (
        <label
          htmlFor="orcamentos_file"
          className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[var(--color-border-card)] bg-[var(--color-bg-subtle)] p-10 hover:border-[var(--color-accent-primary)]"
        >
          <FileUp className="h-8 w-8 text-[var(--accent-primary)]" />
          <div className="text-center">
            <div className="font-semibold">Selecione os arquivos exportados</div>
            <div className="text-sm text-[var(--color-text-secondary)]">
              Pode selecionar os dois de uma vez: "APENAS NÃO APROVADOS" e "APENAS APROVADOS".
            </div>
            <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
              Aceita o .xls do WebDental (que na verdade é HTML) e planilhas .xlsx / .csv.
              Exporte separado — com "Exibir: TODOS" o WebDental corta em 100 linhas e perde
              registros sem avisar.
            </div>
          </div>
          <input
            id="orcamentos_file"
            type="file"
            multiple
            accept=".xls,.xlsx,.csv,.html,.htm"
            onChange={escolherArquivo}
            className="sr-only"
          />
        </label>
      )}

      {passo === 'analisando' && (
        <div className="flex flex-col items-center gap-3 py-12">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-primary)]" />
          <div className="text-sm text-[var(--color-text-secondary)]">
            Conferindo {nomeArquivo} contra o CRM… nada foi gravado.
          </div>
        </div>
      )}

      {passo === 'resumo' && plano && leitura && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--color-text-secondary)]">
            <span>
              {leitura.linhasLidas} linhas ·{' '}
              <strong className="text-[var(--color-text-primary)]">
                {plano.orcamentosNoArquivo} orçamentos
              </strong>{' '}
              (1 por tratamento) de {plano.pacientesNoArquivo} pacientes · período{' '}
              {dataBr(plano.periodo.de)} a {dataBr(plano.periodo.ate)}
            </span>
            <span className="text-xs uppercase tracking-wider text-[var(--accent-primary)]">
              simulação — nada gravado
            </span>
          </div>

          {/* O que o CRM reconheceu em cada arquivo. O usuário não escolheu
              nada: o filtro foi deduzido da coluna Dt Aprovação. */}
          <div className="glass-card p-4">
            <div className="text-label mb-2">Arquivos lidos</div>
            <ul className="space-y-1 text-xs text-[var(--color-text-secondary)]">
              {plano.arquivos.map((a) => (
                <li key={a.nome}>
                  <span className="font-mono text-[var(--color-text-primary)]">{a.nome}</span> ·{' '}
                  <strong className="text-[var(--color-text-primary)]">{rotuloDoTipo(a.tipo)}</strong> ·{' '}
                  {a.orcamentos} orçamentos · {brl(a.valor)}
                  {a.vendasPlano > 0 && ` · ${a.vendasPlano} venda(s) de plano fora da conta`}
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Cartao
              rotulo="Em aberto (não aprovados)"
              valor={plano.orcamentosNaoAprovados}
              detalhe={brl(plano.valorNaoAprovados)}
              destaque
            />
            <Cartao
              rotulo="Aprovados"
              valor={plano.orcamentosAprovados}
              detalhe={`${brl(plano.valorAprovados)} · data real, fora da régua`}
            />
            <Cartao rotulo="Sem mudança" valor={plano.inalterados.length} detalhe="nada a fazer" />
            <Cartao
              rotulo="Valor total dos arquivos"
              valor={brl(plano.valorTotalArquivo)}
              detalhe={`${plano.orcamentosNoArquivo} orçamentos · ${plano.pacientesNoArquivo} pacientes`}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Cartao
              rotulo="Novos em Orçamento apresentado"
              valor={plano.novos.length}
              detalhe="entram com a Dt Orçamento no relógio"
            />
            <Cartao
              rotulo="Novos já em Aprovado"
              valor={plano.novosAprovados.length}
              detalhe="entram com a Dt Aprovação"
            />
            <Cartao
              rotulo="Movidos para Aprovado"
              valor={plano.movidosParaAprovado.length}
              detalhe="já estavam no funil — sem duplicar"
            />
            <Cartao rotulo="Atualizados" valor={plano.atualizados.length} detalhe="algo mudou no relatório" />
          </div>

          {/* 🔴 DENTALVIDAS não é tratamento — é venda do plano. O próprio
              relatório conta separado ("Valor Total Dental Vidas"). */}
          {plano.vendasPlano.length > 0 && (
            <Aviso icone="alerta">
              <strong className="text-[var(--color-text-primary)]">
                {plano.vendasPlano.length} venda(s) do plano DentalVidas ({brl(plano.valorVendasPlano)}) ficam
                FORA da importação.
              </strong>
              <span className="mt-1 block">
                DentalVidas não é procedimento odontológico — é a venda do plano. O cabeçalho do
                próprio relatório conta separado e o PDF chama de "venda externa plano". Entrar como
                orçamento criaria um procedimento falso no catálogo, inflaria a conversão por
                especialidade e somaria receita que não é de tratamento.
              </span>
              <ul className="mt-1 space-y-0.5 font-mono text-xs">
                {plano.vendasPlano.map((v) => (
                  <li key={`${v.arquivo}-${v.linha}`}>
                    {v.paciente} · {dataBr(v.dtOrcamento)} · {brl(v.valor)}
                  </li>
                ))}
              </ul>
              <span className="mt-1 block">
                O que fazer com a venda de plano é decisão sua — hoje o CRM só não a confunde com
                tratamento.
              </span>
            </Aviso>
          )}

          {plano.porEspecialidade.length > 0 && (
            <div className="glass-card p-4">
              <div className="text-label mb-2">Por especialidade</div>
              <div className="flex flex-wrap gap-2">
                {plano.porEspecialidade.map((e) => (
                  <span
                    key={e.especialidade}
                    className="rounded-full border border-[var(--color-accent-border)] bg-[var(--color-accent-bg)] px-3 py-1 text-xs text-[var(--color-text-secondary)]"
                  >
                    <strong className="text-[var(--color-text-primary)]">{e.especialidade}</strong>{' '}
                    {e.quantidade} · {brl(e.valor)}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                Um tratamento por oportunidade — é o que torna a conversão por especialidade
                mensurável.
              </p>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <div className="glass-card p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
                <Users className="h-4 w-4 text-[var(--accent-primary)]" /> Contatos
              </div>
              <p className="text-sm text-[var(--color-text-secondary)]">
                {plano.contatosNovos} novo(s) · {plano.contatosExistentes} já existente(s).
                {plano.familias.length > 0 && (
                  <>
                    {' '}
                    <span className="text-[var(--color-text-primary)]">
                      {plano.familias.length} telefone(s) atendem mais de um paciente
                    </span>{' '}
                    — um contato só, com os orçamentos de todos pendurados nele.
                  </>
                )}
              </p>
              {plano.familias.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-[var(--color-text-secondary)]">
                  {plano.familias.slice(0, 4).map((f) => (
                    <li key={f.telefone}>
                      <span className="font-mono">{f.telefone}</span> · {f.pacientes.join(', ')}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="glass-card p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
                <TrendingUp className="h-4 w-4 text-[var(--accent-primary)]" /> Conciliação
              </div>

              <p className="text-sm text-[var(--color-text-secondary)]">
                <strong className="text-[var(--color-success)]">Aprovado</strong> agora é FATO, não
                palpite: vem da coluna <span className="font-mono">Dt Aprovação</span> do relatório de
                aprovados, com a data real.
                <span className="block text-xs opacity-70">
                  A leitura é por TRATAMENTO: o paciente pode ter a limpeza aprovada e a prótese ainda
                  parada — só o card da limpeza se move.
                </span>
              </p>

              <label className="flex items-start gap-2 text-sm text-[var(--color-text-secondary)]">
                <input
                  type="checkbox"
                  checked={sinalizarSumicos}
                  onChange={(e) => {
                    setSinalizarSumicos(e.target.checked);
                    void reanalisar(e.target.checked, encerrarVencidos);
                  }}
                  className="mt-1 accent-[var(--accent-primary)]"
                />
                <span>
                  Sinalizar para conferência quem sumiu dos DOIS relatórios —{' '}
                  {plano.sumiramSemExplicacao.length} orçamento(s).
                  <span className="block text-xs opacity-70">
                    Saiu da lista de não aprovados e não apareceu na de aprovados: o mais provável é
                    cancelamento. <strong>Nenhum deles vira aprovado e nenhum se move</strong> — cada um
                    só ganha uma nota pedindo conferência. Dar isso como aprovado seria inventar receita.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2 text-sm text-[var(--color-text-secondary)]">
                <input
                  type="checkbox"
                  checked={encerrarVencidos}
                  onChange={(e) => {
                    setEncerrarVencidos(e.target.checked);
                    void reanalisar(sinalizarSumicos, e.target.checked);
                  }}
                  className="mt-1 accent-[var(--accent-primary)]"
                />
                <span>
                  Encerrar como <strong className="text-[var(--color-error)]">Não aprovado</strong> quem passou de{' '}
                  {DIAS_ATE_ENCERRAR} dias — {plano.naoAprovados.length} orçamento(s).
                  <span className="block text-xs opacity-70">
                    Só quem nunca saiu de "{ETAPA_APRESENTADO}". Orçamento que alguém já moveu não é encerrado
                    automaticamente.
                  </span>
                </span>
              </label>

              {plano.paradosEmNegociacao.length > 0 && (
                <p className="text-xs text-[var(--color-text-secondary)]">
                  {plano.paradosEmNegociacao.length} orçamento(s) passaram de {DIAS_ATE_ENCERRAR} dias mas já
                  foram movidos por uma pessoa — <strong>não serão tocados</strong>.
                </p>
              )}
            </div>
          </div>

          {plano.procedimentosNovos.length > 0 && (
            <Aviso icone="ok">
              Procedimento(s) que serão criados no catálogo: {plano.procedimentosNovos.join(', ')}.
            </Aviso>
          )}

          {leitura.ignoradas.length > 0 && (
            <Aviso icone="alerta">
              {leitura.ignoradas.length} linha(s) do arquivo não entram:
              <ul className="mt-1 space-y-0.5 font-mono text-xs">
                {leitura.ignoradas.slice(0, 8).map((i) => (
                  <li key={`${i.linha}-${i.motivo}`}>
                    linha {i.linha}
                    {i.paciente ? ` (${i.paciente})` : ''}: {i.motivo}
                  </li>
                ))}
              </ul>
            </Aviso>
          )}

          {plano.avisos.map((a) => (
            <Aviso key={a} icone="alerta">
              {a}
            </Aviso>
          ))}

          {plano.novos.length + plano.novosAprovados.length > 0 && (
            <details className="glass-card p-4">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--color-text-primary)]">
                Ver os {plano.novos.length + plano.novosAprovados.length} orçamentos novos
              </summary>
              <div className="mt-3 max-h-64 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-[var(--color-bg-surface)]">
                    <tr className="text-left text-[var(--color-text-secondary)]">
                      <th className="p-1.5">Paciente</th>
                      <th className="p-1.5">Tratamento</th>
                      <th className="p-1.5">Entra em</th>
                      <th className="p-1.5">Telefone</th>
                      <th className="p-1.5">Data</th>
                      <th className="p-1.5 text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...plano.novos, ...plano.novosAprovados].map((n) => (
                      <tr key={n.externalRef} className="border-t border-[var(--color-border-divider)]">
                        <td className="p-1.5 text-[var(--color-text-primary)]">{n.paciente}</td>
                        <td className="p-1.5 text-[var(--color-text-secondary)]">{n.tratamento ?? '—'}</td>
                        <td className="p-1.5 text-[var(--color-text-secondary)]">
                          {n.dtAprovacao ? `Aprovado ${dataBr(n.dtAprovacao)}` : ETAPA_APRESENTADO}
                        </td>
                        <td className="p-1.5 font-mono text-[var(--color-text-secondary)]">{n.telefone}</td>
                        <td className="p-1.5 text-[var(--color-text-secondary)]">{dataBr(n.dtOrcamento)}</td>
                        <td className="p-1.5 text-right text-[var(--color-text-primary)]">{brl(n.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {plano.movidosParaAprovado.length > 0 && (
            <details className="glass-card p-4">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--color-text-primary)]">
                Ver os {plano.movidosParaAprovado.length} que saem do funil aberto para Aprovado
              </summary>
              <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-xs text-[var(--color-text-secondary)]">
                {plano.movidosParaAprovado.map((a) => (
                  <li key={a.externalRef}>
                    {a.paciente} · <strong className="text-[var(--color-text-primary)]">{a.tratamento ?? '—'}</strong>{' '}
                    · orçado {dataBr(a.dtOrcamento)} · aprovado {dataBr(a.dtAprovacao ?? null)} · {brl(a.valor)}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/* 🔴 Sumiu dos dois relatórios: NÃO vira aprovado. Só conferência. */}
          {plano.sumiramSemExplicacao.length > 0 && (
            <details className="glass-card p-4" open>
              <summary className="cursor-pointer text-sm font-semibold text-[var(--color-text-primary)]">
                <Search className="mr-1 inline h-3.5 w-3.5 text-[var(--accent-primary)]" />
                {plano.sumiramSemExplicacao.length} orçamento(s) sumiram dos dois relatórios — conferir
              </summary>
              <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                Saíram da lista de não aprovados e não apareceram na de aprovados. O mais provável é
                cancelamento no WebDental. <strong>Nenhum se move e nenhum vira aprovado</strong> — cada
                um recebe uma nota pedindo conferência.
              </p>
              <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-xs text-[var(--color-text-secondary)]">
                {plano.sumiramSemExplicacao.map((a) => (
                  <li key={a.externalRef}>
                    {a.paciente} · <strong className="text-[var(--color-text-primary)]">{a.tratamento ?? '—'}</strong>{' '}
                    · {dataBr(a.dtOrcamento)} · {brl(a.valor)}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="ghost" onClick={reset}>
              Trocar arquivos
            </Button>
            <Button onClick={confirmar} disabled={nadaAFazer}>
              {nadaAFazer
                ? 'Nada a aplicar'
                : `Aplicar: ${plano.novos.length + plano.novosAprovados.length} novos, ` +
                  `${plano.movidosParaAprovado.length} para Aprovado, ${plano.atualizados.length} atualizados`}
            </Button>
          </div>
        </div>
      )}

      {passo === 'gravando' && (
        <div className="flex flex-col items-center gap-4 py-12">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-primary)]" />
          <div className="text-sm text-[var(--color-text-primary)]">
            {progresso.etapa} — {progresso.pct}%
          </div>
          <div className="h-2 w-full max-w-md overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full bg-[var(--accent-primary)] transition-all"
              style={{ width: `${progresso.pct}%` }}
            />
          </div>
        </div>
      )}

      {passo === 'pronto' && resultado && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-[var(--color-success-border)] bg-[var(--color-success-bg)] p-4">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-[var(--color-success)]" />
            <div className="text-sm">
              <div className="font-semibold text-[var(--color-text-primary)]">Importação aplicada</div>
              <ul className="mt-1 space-y-0.5 text-[var(--color-text-secondary)]">
                <li>{resultado.contatosCriados} contato(s) criados · {resultado.contatosAtualizados} atualizados</li>
                <li>{resultado.dealsCriados} orçamento(s) criados · {resultado.dealsAtualizados} atualizados</li>
                <li>
                  {resultado.marcadosAprovados} marcados como aprovados pela Dt Aprovação do relatório
                </li>
                <li>{resultado.marcadosNaoAprovados} encerrados por prazo de {DIAS_ATE_ENCERRAR} dias</li>
                {resultado.sinalizadosParaConferencia > 0 && (
                  <li>
                    {resultado.sinalizadosParaConferencia} sinalizados para conferência (sumiram dos dois
                    relatórios — não foram movidos)
                  </li>
                )}
                {resultado.procedimentosCriados > 0 && (
                  <li>{resultado.procedimentosCriados} procedimento(s) novos no catálogo</li>
                )}
              </ul>
            </div>
          </div>

          {resultado.erros.length > 0 && (
            <Aviso icone="alerta">
              <ul className="space-y-0.5 font-mono text-xs">
                {resultado.erros.slice(0, 12).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Aviso>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={reset}>
              Nova importação
            </Button>
            <Button onClick={fechar}>Fechar</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function Cartao({
  rotulo,
  valor,
  detalhe,
  destaque,
}: {
  rotulo: string;
  valor: string | number;
  detalhe?: string;
  destaque?: boolean;
}) {
  return (
    <div className="glass-card p-4">
      <div className="text-label">{rotulo}</div>
      <div
        className={`mt-1 text-2xl font-extrabold ${
          destaque ? 'text-[var(--accent-primary)]' : 'text-[var(--color-text-primary)]'
        }`}
      >
        {valor}
      </div>
      {detalhe && <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{detalhe}</div>}
    </div>
  );
}

function Aviso({ icone, children }: { icone: 'alerta' | 'ok'; children: ReactNode }) {
  const alerta = icone === 'alerta';
  return (
    <div
      className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${
        alerta
          ? 'border-[var(--color-warning-border)] bg-[var(--color-warning-bg)]'
          : 'border-[var(--color-accent-border)] bg-[var(--color-accent-bg)]'
      }`}
    >
      {alerta ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning-text)]" />
      ) : (
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-primary)]" />
      )}
      <div className="text-[var(--color-text-secondary)]">{children}</div>
    </div>
  );
}
