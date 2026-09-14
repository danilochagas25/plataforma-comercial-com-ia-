import { AlertTriangle, ExternalLink, FileText, Image, Phone, Reply, Video } from 'lucide-react';
import type { Template } from '@/types/templates';

// Prévia do template no passo 1 do disparo. Existe para a recepção reconhecer
// a mensagem pelo TEXTO, não pelo nome técnico (`odonto_orcamento_d1_v2` não
// diz nada a quem monta a campanha). Mostra o que o paciente vai ler: cabeçalho,
// corpo, rodapé e botões, com cada variável indicando o que entra no lugar.

const VARIAVEL = /\{\{\s*(\d+)\s*\}\}/g;

const CATEGORIA: Record<Template['category'], string> = {
  marketing: 'Marketing',
  utility: 'Utilidade',
  authentication: 'Autenticação',
  service: 'Utilidade',
};

const MIDIA: Record<'image' | 'video' | 'document', { rotulo: string; Icone: typeof Image }> = {
  image: { rotulo: 'Imagem no cabeçalho', Icone: Image },
  video: { rotulo: 'Vídeo no cabeçalho', Icone: Video },
  document: { rotulo: 'Documento no cabeçalho', Icone: FileText },
};

interface Props {
  template: Template;
  /**
   * O que entra em cada variável, por posição ("1" → "Nome do paciente").
   * Posição sem entrada aparece como pendente.
   */
  rotulosVariaveis: Record<string, string | null>;
}

// Chaves que sobraram no texto depois de tirar as variáveis válidas. Foi
// exatamente o defeito dos templates d1/d3/d7 ("Olá, {{1}}1}}"): a Meta aprovou
// e o paciente leu "Olá, Maria1}}". Aqui é o último lugar para alguém perceber.
function temChaveSobrando(texto: string): boolean {
  const semVariaveis = texto.replace(VARIAVEL, '');
  return semVariaveis.includes('{{') || semVariaveis.includes('}}');
}

function CorpoComVariaveis({ texto, rotulos }: { texto: string; rotulos: Props['rotulosVariaveis'] }) {
  const partes: Array<string | { pos: string }> = [];
  let ultimo = 0;
  for (const m of texto.matchAll(VARIAVEL)) {
    const inicio = m.index ?? 0;
    if (inicio > ultimo) partes.push(texto.slice(ultimo, inicio));
    partes.push({ pos: m[1] });
    ultimo = inicio + m[0].length;
  }
  if (ultimo < texto.length) partes.push(texto.slice(ultimo));

  return (
    <>
      {partes.map((p, i) => {
        if (typeof p === 'string') return <span key={i}>{p}</span>;
        const rotulo = rotulos[p.pos];
        return rotulo ? (
          <span
            key={i}
            className="rounded bg-[var(--color-accent-bg)] px-1.5 py-0.5 text-[var(--color-accent-primary)] font-semibold"
          >
            {rotulo}
          </span>
        ) : (
          <span
            key={i}
            className="rounded border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-1.5 py-0.5 font-mono text-[var(--color-warning-text)]"
            title="Escolha abaixo o que entra nesta variável"
          >
            {`{{${p.pos}}}`}
          </span>
        );
      })}
    </>
  );
}

export function TemplatePreviewCard({ template, rotulosVariaveis }: Props) {
  const midia = template.header_type !== 'none' && template.header_type !== 'text'
    ? MIDIA[template.header_type]
    : null;
  const defeito = temChaveSobrando(template.body)
    || (template.header_type === 'text' && temChaveSobrando(template.header_content ?? ''));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[var(--color-text-primary)]">
          Prévia da mensagem
        </span>
        <span className="text-[11px] text-[var(--color-text-muted)]">
          {CATEGORIA[template.category]} · {template.language}
        </span>
      </div>

      <div className="rounded-lg bg-[var(--color-bg-subtle)] p-3">
        <div className="max-w-md rounded-lg border border-[var(--color-border-card)] bg-[var(--color-bg-surface)] shadow-sm">
          <div className="space-y-2 px-3 py-2.5 text-sm leading-relaxed text-[var(--color-text-primary)]">
            {midia && (
              <div className="flex items-center gap-2 rounded-md bg-[var(--color-bg-subtle)] px-2 py-3 text-xs text-[var(--color-text-secondary)]">
                <midia.Icone className="h-4 w-4" />
                {midia.rotulo}
              </div>
            )}
            {template.header_type === 'text' && template.header_content && (
              <div className="font-semibold">
                <CorpoComVariaveis texto={template.header_content} rotulos={rotulosVariaveis} />
              </div>
            )}
            <div className="whitespace-pre-wrap break-words">
              <CorpoComVariaveis texto={template.body} rotulos={rotulosVariaveis} />
            </div>
            {template.footer && (
              <div className="text-xs text-[var(--color-text-muted)]">{template.footer}</div>
            )}
          </div>

          {template.buttons.length > 0 && (
            <div className="divide-y divide-[var(--color-border-divider)] border-t border-[var(--color-border-divider)]">
              {template.buttons.map((b, i) => {
                const Icone = b.type === 'url' ? ExternalLink : b.type === 'phone' ? Phone : Reply;
                return (
                  <div
                    key={i}
                    className="flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-[var(--color-accent-primary)]"
                  >
                    <Icone className="h-3.5 w-3.5" />
                    {b.text}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {defeito && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-3 py-2 text-xs text-[var(--color-warning-text)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>O texto aprovado tem chaves sobrando</strong> (<code>{'{{'}</code> ou <code>{'}}'}</code> fora
            de uma variável). O paciente vai ler isso exatamente assim. Prefira outro template.
          </span>
        </div>
      )}
    </div>
  );
}
