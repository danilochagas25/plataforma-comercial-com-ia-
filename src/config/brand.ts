// Marca em um lugar só — nenhuma string de marca espalhada por componente.
//
// Esta instalação é da Clínica Amor Saúde Itabuna (BA). Os arquivos de logo em
// public/ vieram do logotipo vetorial oficial da rede
// (www.amorsaude.com/images/logo_as.svg), que contém exatamente duas cores:
// turquesa #61C1D0 e vermelho #D53E36 — as mesmas do design system.
//
//   amorsaude-simbolo.svg  o símbolo isolado, em quadrado (131×131), para o
//                          ícone da sidebar, do login e do menu no celular
//   amorsaude-logo.svg     o logotipo completo com a palavra, para onde couber
//                          na horizontal
export const BRAND = {
  /** Assinatura de quem opera a instalação, acima do nome do produto.
      Deixe vazio para mostrar só o produto. */
  owner: 'Clínica',
  /** Nome do produto. É o que ganha o destaque visual na sidebar e no login. */
  product: 'Amor Saúde Itabuna (BA)',
  /** Arquivo em public/. Quadrado — é exibido dentro de um quadro. */
  mark: '/amorsaude-simbolo.svg',
  /** Logotipo horizontal completo, com a palavra. */
  wordmark: '/amorsaude-logo.svg',
  /** Usado no <title> e no prompt padrão do agente. */
  companyName: 'Clínica Amor Saúde Itabuna (BA)',
} as const;
