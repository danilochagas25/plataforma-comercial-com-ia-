import type { ThreadMessage } from '@/hooks/useMessages';

// Exporta a conversa como .txt no mesmo formato do "Exportar conversa" do
// WhatsApp: uma linha por mensagem, com data, hora e autor.
//
// Formato de texto, e não CSV ou PDF, porque o uso real é anexar ao prontuário
// ou mandar para o contador/advogado — precisa abrir em qualquer lugar e ser
// lido sem ferramenta nenhuma.
//
// As notas privadas VÃO junto, marcadas: quem exporta uma conversa de paciente
// normalmente quer o registro completo do atendimento. Elas ficam explícitas
// como internas para ninguém confundir com algo que o paciente leu.

function carimbo(iso: string): string {
  const d = new Date(iso);
  const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${data} ${hora}`;
}

function autor(m: ThreadMessage, nomePaciente: string): string {
  if (m.direction === 'inbound') return nomePaciente;
  if (m.is_private_note) return 'NOTA INTERNA';
  if (m.sender_type === 'ai') return 'Atendente IA';
  if (m.sender_type === 'owner') return 'WhatsApp (celular)';
  return 'Clínica';
}

function corpo(m: ThreadMessage): string {
  if (m.deleted_at) return '<mensagem apagada no CRM>';
  const texto = m.content?.trim();
  if (m.content_type === 'text' || m.content_type === 'note' || m.content_type === 'template') {
    return texto || '<vazio>';
  }
  const rotulo = `<${m.content_type}>`;
  return texto ? `${rotulo} ${texto}` : rotulo;
}

export function montarTextoConversa(
  mensagens: ThreadMessage[],
  nomePaciente: string,
  telefone: string | null,
): string {
  const cabecalho = [
    `Conversa com ${nomePaciente}${telefone ? ` (${telefone})` : ''}`,
    `Exportada em ${carimbo(new Date().toISOString())}`,
    `${mensagens.length} ${mensagens.length === 1 ? 'mensagem' : 'mensagens'}`,
    '',
  ].join('\n');

  const linhas = mensagens.map((m) => {
    const extras: string[] = [];
    if (m.forwarded) extras.push('encaminhada');
    if (m.reaction) extras.push(`clínica reagiu ${m.reaction}`);
    if (m.contact_reaction) extras.push(`paciente reagiu ${m.contact_reaction}`);
    const sufixo = extras.length ? ` [${extras.join(', ')}]` : '';
    return `[${carimbo(m.created_at)}] ${autor(m, nomePaciente)}: ${corpo(m)}${sufixo}`;
  });

  return `${cabecalho}${linhas.join('\n')}\n`;
}

// Nome de arquivo sem acento nem caractere que atrapalhe em Windows/macOS.
function nomeArquivo(nomePaciente: string): string {
  const base = nomePaciente
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'conversa';
  const hoje = new Date().toISOString().slice(0, 10);
  return `conversa-${base}-${hoje}.txt`;
}

export function exportarConversa(
  mensagens: ThreadMessage[],
  nomePaciente: string,
  telefone: string | null,
): void {
  const texto = montarTextoConversa(mensagens, nomePaciente, telefone);
  const blob = new Blob([texto], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo(nomePaciente);
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Sem o revoke o blob fica na memória da aba até a página recarregar.
  URL.revokeObjectURL(url);
}
