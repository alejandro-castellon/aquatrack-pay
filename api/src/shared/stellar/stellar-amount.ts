/** Stellar amounts have 7 decimals: 1 unit of an asset is 10,000,000 stroops. */
export const STROOPS_PER_UNIT = 10_000_000n;

const AMOUNT_PATTERN = /^\d+(\.\d{1,7})?$/;

/**
 * Parses a Stellar amount string ("12.5", "0.0000001") into stroops.
 * Amounts are compared as integers, never as floats.
 */
export function toStroops(amount: string): bigint {
  if (typeof amount !== 'string' || !AMOUNT_PATTERN.test(amount)) {
    throw new Error(`Invalid Stellar amount: ${String(amount)}`);
  }
  const [whole, fraction = ''] = amount.split('.');
  return BigInt(whole) * STROOPS_PER_UNIT + BigInt(fraction.padEnd(7, '0'));
}

/** Formats stroops as the 7-decimal string Horizon and the SDK use. */
export function fromStroops(stroops: bigint): string {
  if (stroops < 0n) {
    throw new Error('Stellar amounts cannot be negative');
  }
  const whole = stroops / STROOPS_PER_UNIT;
  const fraction = (stroops % STROOPS_PER_UNIT).toString().padStart(7, '0');
  return `${whole}.${fraction}`;
}
