/**
 * Utilidades puras del pago en Stellar: formato de montos, comparación exacta
 * y enlaces. Sin React ni dependencias, para poder probarlas con node --test.
 *
 * Los montos de Stellar tienen 7 decimales y viajan como texto ("13.1000000").
 * Se comparan como enteros (stroops), nunca como flotantes.
 */

const STROOPS_DECIMALS = 7;
const AMOUNT_PATTERN = /^\d+(\.\d{1,7})?$/;

/** "13.1" -> 131000000n. Lanza si el texto no es un monto de Stellar. */
export function toStroops(amount: string): bigint {
  if (typeof amount !== "string" || !AMOUNT_PATTERN.test(amount)) {
    throw new Error(`Monto de Stellar inválido: ${String(amount)}`);
  }
  const [whole, fraction = ""] = amount.split(".");
  return BigInt(whole + fraction.padEnd(STROOPS_DECIMALS, "0"));
}

/** 131000000n -> "13.1000000" */
export function fromStroops(stroops: bigint): string {
  const digits = stroops.toString().padStart(STROOPS_DECIMALS + 1, "0");
  const cut = digits.length - STROOPS_DECIMALS;
  return `${digits.slice(0, cut)}.${digits.slice(cut)}`;
}

/**
 * Cuánto le falta a un saldo para cubrir un monto, como texto de 7 decimales
 * ("0.0000000" cuando alcanza). Un saldo desconocido cuenta como cero.
 */
export function missingAmount(due: string, balance: string | null): string {
  const dueStroops = toStroops(due);
  let balanceStroops = BigInt(0);
  if (balance && AMOUNT_PATTERN.test(balance)) {
    balanceStroops = toStroops(balance);
  }
  const missing = dueStroops - balanceStroops;
  return fromStroops(missing > BigInt(0) ? missing : BigInt(0));
}

export function coversAmount(due: string, balance: string | null): boolean {
  return toStroops(missingAmount(due, balance)) === BigInt(0);
}

function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** 1234.5 -> "Bs 1.234,50" (formato es-BO, sin depender del ICU del entorno). */
export function formatBs(amount: number): string {
  const [whole, fraction] = Math.abs(amount).toFixed(2).split(".");
  const sign = amount < 0 ? "-" : "";
  return `Bs ${sign}${groupThousands(whole)},${fraction}`;
}

/**
 * "13.1000000" -> "13,10". Muestra dos decimales, o los que hagan falta cuando
 * el monto tiene más precisión ("0.1234567" -> "0,1234567").
 */
export function formatUsdc(amount: string): string {
  if (!AMOUNT_PATTERN.test(amount)) return amount;
  const [whole, rawFraction = ""] = amount.split(".");
  const trimmed = rawFraction.replace(/0+$/, "");
  const fraction = trimmed.length <= 2 ? trimmed.padEnd(2, "0") : trimmed;
  return `${groupThousands(whole)},${fraction}`;
}

/** 11.84 -> "11,84" */
export function formatRate(rate: number): string {
  const [whole, fraction] = rate.toFixed(4).split(".");
  const trimmed = fraction.replace(/0+$/, "").padEnd(2, "0");
  return `${groupThousands(whole)},${trimmed}`;
}

/** "GABC...WXYZ" abreviada para mostrar; el valor completo va en title o al copiar. */
export function shortAddress(address: string, visible = 4): string {
  if (address.length <= visible * 2 + 1) return address;
  return `${address.slice(0, visible)}…${address.slice(-visible)}`;
}

export interface PaymentRequest {
  destination: string;
  amount: string;
  assetCode: string;
  assetIssuer: string;
  memo: string;
}

/**
 * URI de pago SEP-7 (`web+stellar:pay`): las billeteras de Stellar que lo
 * entienden abren el pago con destino, monto, activo y memo ya puestos.
 */
export function buildSep7PayUri(request: PaymentRequest): string {
  // encodeURIComponent, no URLSearchParams: SEP-7 es un URI y un espacio debe
  // ir como %20; el "+" de los formularios llegaría literal a la billetera.
  const params: [string, string][] = [
    ["destination", request.destination],
    ["amount", request.amount],
    ["asset_code", request.assetCode],
    ["asset_issuer", request.assetIssuer],
    ["memo", request.memo],
    ["memo_type", "MEMO_TEXT"],
  ];
  const query = params
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  return `web+stellar:pay?${query}`;
}

const EXPLORER_BASE = "https://stellar.expert/explorer";

export function explorerAccountUrl(
  network: "testnet" | "public",
  publicKey: string,
): string {
  return `${EXPLORER_BASE}/${network}/account/${publicKey}`;
}

export function explorerTxUrl(
  network: "testnet" | "public",
  txHash: string,
): string {
  return `${EXPLORER_BASE}/${network}/tx/${txHash}`;
}

/** Tipo de activo que piden las APIs de Stellar según el largo del código. */
export function assetTypeOf(
  assetCode: string,
): "credit_alphanum4" | "credit_alphanum12" {
  return assetCode.length <= 4 ? "credit_alphanum4" : "credit_alphanum12";
}

const PUBLIC_CODE_PATTERN = /^[0-9a-hjkmnp-tv-z]{20}$/;

/** El código del enlace de pago: 20 caracteres en minúsculas. */
export function isPublicChargeCode(code: string): boolean {
  return PUBLIC_CODE_PATTERN.test(code);
}

/** "2026-10" -> { year: 2026, month: 10 }, o null si no tiene ese formato. */
export function parseChargeMonth(
  month: string,
): { year: number; month: number } | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  return match ? { year: Number(match[1]), month: Number(match[2]) } : null;
}

const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** "2026-10" -> "octubre de 2026" */
export function formatChargeMonth(month: string): string {
  const parsed = parseChargeMonth(month);
  if (!parsed) return month;
  return `${MONTH_NAMES[parsed.month - 1]} de ${parsed.year}`;
}
