// ============================================================================
// src/lib/phone.ts — telefone canônico do CRM (Node / browser)
// ----------------------------------------------------------------------------
// ⚠️ ARQUIVO PAREADO. Existe uma cópia com a MESMA regra, em Deno, em
//    `supabase/functions/_shared/phone-br.ts` (lá os nomes levam o prefixo
//    `phoneBr*`, exigido pelo inliner de `api/bootstrap.ts`, que achata todos
//    os `_shared/` num escopo plano — homônimo sobrescreve sem erro).
//    Mexeu aqui, mexa lá. As duas implementações são deliberadamente idênticas
//    linha a linha na lógica; a divergência entre elas é o risco desta peça.
//
// ----------------------------------------------------------------------------
// O PROBLEMA DE NEGÓCIO (achado pelo Danilo em 06/09/2026)
// ----------------------------------------------------------------------------
// A Meta entrega o `wa_id` de números brasileiros SEM o nono dígito. O mesmo
// paciente que a clínica cadastrou como `+5533999772570` responde e chega como
// `+553399772570` — e o CRM criava um contato e uma conversa NOVOS. Resultado:
// o orçamento fica num contato, a resposta em outro, o funil não avança e o
// relatório conclui que ninguém respondeu.
//
// ----------------------------------------------------------------------------
// FORMA CANÔNICA ESCOLHIDA: **COM o nono dígito** (`+55` + DDD + 9 dígitos)
// ----------------------------------------------------------------------------
// Por quê:
//  1. É a forma que o WebDental exporta e que a recepção digita — a fonte dos
//     63 orçamentos. Gravar canônico significa NÃO reescrever o dado do dono.
//  2. É a forma que a própria Meta ACEITA no envio (o truncamento é só de
//     saída, no `wa_id`), então o número gravado serve direto para disparar.
//  3. É a forma que um humano reconhece na tela de Pessoas.
// A forma curta continua sendo reconhecida na BUSCA, via `phoneVariants`.
// Nunca reescrevemos telefone de país que não seja o Brasil.
// ============================================================================

import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

// --- regra do nono dígito ---------------------------------------------------

// Só dígitos. Aceita '+55 (73) 99804-0599', '5573998040599', etc.
function onlyDigits(raw: string): string {
  return raw.replace(/\D/g, '');
}

// Quebra um número BR em DDD + assinante. Devolve null quando não é um E.164
// brasileiro plausível — nesse caso NADA é reescrito.
function splitBr(digits: string): { ddd: string; subscriber: string } | null {
  if (!digits.startsWith('55')) return null;
  // 55 + 2 (DDD) + 8 ou 9 (assinante) = 12 ou 13 dígitos.
  if (digits.length !== 12 && digits.length !== 13) return null;
  const ddd = digits.slice(2, 4);
  // DDD brasileiro válido vai de 11 a 99 (nunca começa em 0 ou 1 isolado).
  if (!/^[1-9][1-9]$/.test(ddd)) return null;
  return { ddd, subscriber: digits.slice(4) };
}

// Celular na forma "curta" que a Meta entrega: 8 dígitos começando em 8 ou 9.
// Fixo (8 dígitos começando em 2–5) NÃO recebe o nono dígito.
function isShortBrMobile(subscriber: string): boolean {
  return /^[89]\d{7}$/.test(subscriber);
}

// Celular já na forma completa: 9 dígitos começando em 9.
function isLongBrMobile(subscriber: string): boolean {
  return /^9\d{8}$/.test(subscriber);
}

/**
 * Forma **canônica** de gravação: E.164 com o nono dígito quando é celular BR.
 * Números não brasileiros e fixos passam intactos (só viram `+dígitos`).
 * Devolve `null` para entrada vazia ou curta demais para ser telefone.
 */
export function canonicalPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = onlyDigits(raw);
  if (digits.length < 10) return null;
  const br = splitBr(digits);
  if (!br) return `+${digits}`;
  if (isShortBrMobile(br.subscriber)) return `+55${br.ddd}9${br.subscriber}`;
  return `+${digits}`;
}

/**
 * Todas as formas equivalentes do mesmo número, para **busca** no banco.
 * Sempre inclui a canônica; para celular BR inclui também a forma curta (sem o
 * nono dígito), que é como a Meta entrega. Ordem: canônica primeiro.
 */
export function phoneVariants(raw: string | null | undefined): string[] {
  const canonical = canonicalPhone(raw);
  if (!canonical) return [];
  const out = [canonical];
  const br = splitBr(onlyDigits(canonical));
  if (br && isLongBrMobile(br.subscriber)) {
    const short = br.subscriber.slice(1);
    // Só vale como variante se a forma curta ainda parecer celular (8/9). Sem
    // isso, `+5573912345678` viraria `+557312345678`, que é outro número.
    if (isShortBrMobile(short)) out.push(`+55${br.ddd}${short}`);
  }
  // Preserva a forma crua quando ela não é nenhuma das duas (dado legado).
  const rawE164 = raw ? `+${onlyDigits(raw)}` : null;
  if (rawE164 && !out.includes(rawE164)) out.push(rawE164);
  return out;
}

/** Comparação de identidade: duas grafias do mesmo telefone. */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = canonicalPhone(a);
  const cb = canonicalPhone(b);
  if (!ca || !cb) return false;
  return ca === cb;
}

// --- validação de entrada humana (contrato antigo, preservado) ---------------

// Normalize a raw phone input to E.164 (+55…). Used by contact CRUD and the
// CSV importer to reject or repair input consistently across the app.
//
// Defaults country code to BR — change via the second arg when we internationalize.
//
// Regra de negócio acrescentada em 06/09/2026: o E.164 devolvido passa pela
// forma canônica acima, então um número digitado sem o nono dígito é GRAVADO
// com ele. Assinatura e comportamento de erro seguem iguais aos de antes.
export function normalizePhone(
  raw: string,
  defaultCountry: CountryCode = 'BR',
): { ok: true; e164: string } | { ok: false; error: string } {
  if (!raw) return { ok: false, error: 'Telefone vazio' };
  const cleaned = raw.trim();
  try {
    const parsed = parsePhoneNumberFromString(cleaned, defaultCountry);
    if (!parsed || !parsed.isValid()) {
      return { ok: false, error: 'Número inválido' };
    }
    const e164 = parsed.format('E.164');
    return { ok: true, e164: canonicalPhone(e164) ?? e164 };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Falha ao validar',
    };
  }
}
