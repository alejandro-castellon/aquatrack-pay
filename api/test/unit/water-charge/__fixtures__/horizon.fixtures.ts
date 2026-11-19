import {
  HorizonOperation,
  HorizonTransaction,
} from '@/shared/stellar/horizon.types';

export const TREASURY =
  'GBTREASURY3J7N5F2QZL4X6W7Y2PDKQ5H3M4R6T7V2B3N4M5K6J7H8G9A';
export const PAYER = 'GDPAYER2X3C4V5B6N7M8L9K2J3H4G5F6D7S8A9P2O3I4U5Y6T7R8E9WQ';
export const USDC_ISSUER =
  'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
export const MEMO = 'AQT-7F3K2M9QXZ';

export const TARGET = {
  destination: TREASURY,
  assetCode: 'USDC',
  assetIssuer: USDC_ISSUER,
};

let sequence = 0;

/** A successful transaction as Horizon embeds it with `join=transactions`. */
export function horizonTransaction(
  overrides: Partial<HorizonTransaction> = {},
): HorizonTransaction {
  sequence += 1;
  return {
    hash: `hash-${sequence}`,
    ledger: 1_000_000 + sequence,
    created_at: '2026-11-18T15:00:00Z',
    successful: true,
    source_account: PAYER,
    memo_type: 'text',
    memo: MEMO,
    ...overrides,
  };
}

/** A USDC payment to the treasury, joined with its transaction. */
export function paymentOperation(
  overrides: Partial<HorizonOperation> = {},
  transaction: HorizonTransaction = horizonTransaction(),
): HorizonOperation {
  sequence += 1;
  return {
    id: String(sequence),
    paging_token: String(sequence),
    type: 'payment',
    transaction_hash: transaction.hash,
    transaction_successful: transaction.successful,
    source_account: PAYER,
    created_at: transaction.created_at,
    from: PAYER,
    to: TREASURY,
    amount: '22.2800000',
    asset_type: 'credit_alphanum4',
    asset_code: 'USDC',
    asset_issuer: USDC_ISSUER,
    transaction,
    ...overrides,
  };
}
