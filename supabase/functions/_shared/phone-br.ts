// ============================================================================
// _shared/phone-br.ts — telefone canônico do CRM (Deno / Edge Functions)
// ----------------------------------------------------------------------------
// ⚠️ ARQUIVO PAREADO. A MESMA regra existe, em Node/browser, em
//    `src/lib/phone.ts`. Mexeu aqui, mexa lá — a divergência entre as duas
//    cópias é o risco desta peça. Não dá para importar uma da outra: o
//    frontend é Vite/Node e as functions são Deno.
//
// ⚠️ PREFIXO OBRIGATÓRIO `phoneBr*` em TODO nome deste arquivo. O inliner de
//    `api/bootstrap.ts` achata todos os `_shared/` no MESMO escopo do
//    `index.ts` da function; um homônimo (`normalizePhone`, por exemplo, que
//    já existe local em meta-webhook, zernio-webhook e ingest-lead)
//    sobrescreveria sem erro nenhum.
//
// ----------------------------------------------------------------------------
// O PROBLEMA DE NEGÓCIO (achado pelo Danilo em 06/09/2026)
// ----------------------------------------------------------------------------
// A Meta entrega o `wa_id` de números brasileiros SEM o nono dígito. O mesmo
// paciente cadastrado como `+5533999772570` responde e chega como
// `+553399772570` — e o CRM criava contato e conversa NOVOS. O orçamento fica
// num contato e a resposta em outro: o funil não avança e o relatório conclui
// que ninguém respondeu.
//
// ----------------------------------------------------------------------------
// FORMA CANÔNICA ESCOLHIDA: **COM o nono dígito** (`+55` + DDD + 9 dígitos)
// ----------------------------------------------------------------------------
//  1. É a forma que o WebDental exporta e que a recepção digita — a fonte dos
//     63 orçamentos. Gravar canônico não reescreve o dado do dono.
//  2. É a forma que a Meta ACEITA no envio (o truncamento é só de saída).
//  3. É a forma que um humano reconhece na tela.
// A forma curta continua reconhecida na BUSCA, via `phoneBrVariants`.
// Número de país que não seja o Brasil passa intacto.
// ============================================================================

// Só dígitos. Aceita '+55 (73) 99804-0599', '5573998040599', etc.
function phoneBrOnlyDigits(raw: string): string {
  return raw.replace(/\D/g, '');
}

// Quebra um número BR em DDD + assinante. null quando não é E.164 brasileiro
// plausível — nesse caso NADA é reescrito.
function phoneBrSplit(digits: string): { ddd: string; subscriber: string } | null {
  if (!digits.startsWith('55')) return null;
  // 55 + 2 (DDD) + 8 ou 9 (assinante) = 12 ou 13 dígitos.
  if (digits.length !== 12 && digits.length !== 13) return null;
  const ddd = digits.slice(2, 4);
  // DDD brasileiro válido vai de 11 a 99.
  if (!/^[1-9][1-9]$/.test(ddd)) return null;
  return { ddd, subscriber: digits.slice(4) };
}

// Celular na forma "curta" que a Meta entrega: 8 dígitos começando em 8 ou 9.
// Fixo (8 dígitos começando em 2–5) NÃO recebe o nono dígito.
function phoneBrIsShortMobile(subscriber: string): boolean {
  return /^[89]\d{7}$/.test(subscriber);
}

// Celular já na forma completa: 9 dígitos começando em 9.
function phoneBrIsLongMobile(subscriber: string): boolean {
  return /^9\d{8}$/.test(subscriber);
}

/**
 * Forma **canônica** de gravação: E.164 com o nono dígito quando é celular BR.
 * Não brasileiros e fixos passam intactos (só viram `+dígitos`).
 * `null` para entrada vazia ou curta demais para ser telefone.
 */
export function phoneBrNormalize(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = phoneBrOnlyDigits(raw);
  if (digits.length < 10) return null;
  const br = phoneBrSplit(digits);
  if (!br) return `+${digits}`;
  if (phoneBrIsShortMobile(br.subscriber)) return `+55${br.ddd}9${br.subscriber}`;
  return `+${digits}`;
}

/**
 * Todas as formas equivalentes do mesmo número, para **busca** no banco.
 * Sempre inclui a canônica; para celular BR inclui também a forma curta (sem o
 * nono dígito), que é como a Meta entrega. Ordem: canônica primeiro.
 */
export function phoneBrVariants(raw: string | null | undefined): string[] {
  const canonical = phoneBrNormalize(raw);
  if (!canonical) return [];
  const out = [canonical];
  const br = phoneBrSplit(phoneBrOnlyDigits(canonical));
  if (br && phoneBrIsLongMobile(br.subscriber)) {
    const short = br.subscriber.slice(1);
    // Só vale como variante se a forma curta ainda parecer celular (8/9). Sem
    // isso, `+5573912345678` viraria `+557312345678`, que é outro número.
    if (phoneBrIsShortMobile(short)) out.push(`+55${br.ddd}${short}`);
  }
  // Preserva a forma crua quando ela não é nenhuma das duas (dado legado).
  const rawE164 = raw ? `+${phoneBrOnlyDigits(raw)}` : null;
  if (rawE164 && !out.includes(rawE164)) out.push(rawE164);
  return out;
}

/** Comparação de identidade: duas grafias do mesmo telefone. */
export function phoneBrSame(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ca = phoneBrNormalize(a);
  const cb = phoneBrNormalize(b);
  if (!ca || !cb) return false;
  return ca === cb;
}
