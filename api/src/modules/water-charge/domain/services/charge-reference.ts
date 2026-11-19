import { randomBytes } from 'crypto';

/** Crockford base32: no I, L, O or U, so a memo can be read aloud or typed. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const CHARGE_MEMO_PREFIX = 'AQT-';
const MEMO_RANDOM_LENGTH = 10;
const PUBLIC_CODE_LENGTH = 20;

/** "AQT-" + 10 Crockford characters: 14 bytes, under Stellar's 28-byte text memo limit. */
export const CHARGE_MEMO_PATTERN = /^AQT-[0-9A-HJKMNP-TV-Z]{10}$/;
export const PUBLIC_CODE_PATTERN = /^[0-9a-hjkmnp-tv-z]{20}$/;

function randomBase32(length: number): string {
  let out = '';
  // 256 is a multiple of 32, so masking a byte keeps the distribution uniform.
  for (const byte of randomBytes(length)) {
    out += CROCKFORD[byte & 31];
  }
  return out;
}

/**
 * Reference a payment must carry as its text memo. It becomes public on the
 * ledger, so it says nothing about the building or the apartment and it is
 * never used to open the pay page.
 */
export function generateChargeMemo(): string {
  return CHARGE_MEMO_PREFIX + randomBase32(MEMO_RANDOM_LENGTH);
}

/** Unguessable code (100 bits) of the public pay link. */
export function generatePublicCode(): string {
  return randomBase32(PUBLIC_CODE_LENGTH).toLowerCase();
}

/**
 * Canonical form of a memo someone may have typed by hand: trimmed, upper
 * case, and with the letters Crockford leaves out mapped to their digits.
 * Returns null when the text cannot be one of our memos.
 */
export function normalizeChargeMemo(
  memo: string | null | undefined,
): string | null {
  if (typeof memo !== 'string') return null;

  const upper = memo.trim().toUpperCase();
  if (!upper.startsWith(CHARGE_MEMO_PREFIX)) return null;

  const body = upper
    .slice(CHARGE_MEMO_PREFIX.length)
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  const normalized = CHARGE_MEMO_PREFIX + body;

  return CHARGE_MEMO_PATTERN.test(normalized) ? normalized : null;
}
