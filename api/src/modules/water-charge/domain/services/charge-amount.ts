import { fromStroops } from '@/shared/stellar/stellar-amount';

const STROOPS_PER_USDC_CENT = 100_000n;

export interface ChargeAmount {
  /** 7-decimal string, as Stellar expects it ("22.2800000"). */
  amountUsdc: string;
  stroops: bigint;
}

/**
 * Parses a non-negative decimal into an integer scaled by 10^decimals, so the
 * conversion below never touches floating point. Numbers are rounded to
 * `decimals` places first (the API stores Bs with 2 and the rate with 4).
 */
function toScaledInteger(
  value: number | string,
  decimals: number,
  label: string,
): bigint {
  const text =
    typeof value === 'number'
      ? Number.isFinite(value)
        ? value.toFixed(decimals)
        : ''
      : value.trim();

  if (!new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(text)) {
    throw new RangeError(`Invalid ${label}: ${String(value)}`);
  }

  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole + fraction.padEnd(decimals, '0'));
}

/**
 * Converts an amount owed in Bs to USDC at a fixed rate (Bs per 1 USDC),
 * rounding UP to the USDC cent so a payment of the quoted amount always
 * covers the charge.
 */
export function convertBsToUsdc(
  amountBs: number | string,
  bsPerUsdc: number | string,
): ChargeAmount {
  const bsCents = toScaledInteger(amountBs, 2, 'amount in Bs');
  const rateE4 = toScaledInteger(bsPerUsdc, 4, 'exchange rate');

  if (bsCents <= 0n) {
    throw new RangeError('The amount in Bs must be greater than zero');
  }
  if (rateE4 <= 0n) {
    throw new RangeError('The exchange rate must be greater than zero');
  }

  // usdc = bs / rate  =>  usdcCents = bsCents * 10^4 / rateE4, rounded up.
  const usdcCents = (bsCents * 10_000n + rateE4 - 1n) / rateE4;
  const stroops = usdcCents * STROOPS_PER_USDC_CENT;

  return { amountUsdc: fromStroops(stroops), stroops };
}
