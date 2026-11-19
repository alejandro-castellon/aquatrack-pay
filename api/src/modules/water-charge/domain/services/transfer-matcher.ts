import { HorizonOperation } from '@/shared/stellar/horizon.types';
import { toStroops } from '@/shared/stellar/stellar-amount';
import { normalizeChargeMemo } from './charge-reference';

/** Where a charge must be paid: the building treasury and its asset. */
export interface TransferTarget {
  destination: string;
  assetCode: string;
  assetIssuer: string;
}

/** What one successful transaction credited to the treasury. */
export interface IncomingTransfer {
  /** Hash of the transaction in the ledger (the outer hash of a fee bump). */
  txHash: string;
  ledger: number;
  createdAt: Date;
  /** Normalized charge memo, or null when the memo is not one of ours. */
  memo: string | null;
  /** Raw text memo exactly as it travelled, for display. */
  rawMemo: string | null;
  payerAddress: string;
  /** Total credited in the target asset, summed over the transaction. */
  stroops: bigint;
  /** Paging token of the last matching operation, to resume the watcher. */
  pagingToken: string;
}

export type TransferVerdict = 'settles' | 'underpaid' | 'wrong_memo';

/** Operation types that credit an account with an exact `amount` in an asset. */
const CREDIT_OPERATION_TYPES = new Set([
  'payment',
  'path_payment_strict_receive',
  'path_payment_strict_send',
]);

function creditsTarget(
  operation: HorizonOperation,
  target: TransferTarget,
): boolean {
  return (
    CREDIT_OPERATION_TYPES.has(operation.type) &&
    operation.transaction_successful === true &&
    operation.to === target.destination &&
    operation.asset_type !== 'native' &&
    operation.asset_code === target.assetCode &&
    operation.asset_issuer === target.assetIssuer &&
    typeof operation.amount === 'string'
  );
}

/**
 * Groups Horizon operation records (requested with `join=transactions`) into
 * one transfer per transaction, keeping only what was really credited to the
 * target account in the target asset. Everything else is ignored: other
 * assets, other destinations, failed transactions and contract calls.
 * The input order is preserved.
 */
export function collectIncomingTransfers(
  operations: HorizonOperation[],
  target: TransferTarget,
): IncomingTransfer[] {
  const byHash = new Map<string, IncomingTransfer>();

  for (const operation of operations) {
    if (!creditsTarget(operation, target)) continue;

    const transaction = operation.transaction;
    // The operation always carries the ledger hash. The joined transaction
    // does not: Horizon echoes whichever hash it was asked for, so a fee bump
    // looked up by its inner hash reports the inner one.
    const txHash = operation.transaction_hash;
    const stroops = toStroops(operation.amount as string);
    const existing = byHash.get(txHash);

    if (existing) {
      existing.stroops += stroops;
      existing.pagingToken = operation.paging_token;
      continue;
    }

    const rawMemo =
      transaction?.memo_type === 'text' && typeof transaction.memo === 'string'
        ? transaction.memo
        : null;

    byHash.set(txHash, {
      txHash,
      ledger: transaction?.ledger ?? 0,
      createdAt: new Date(transaction?.created_at ?? operation.created_at),
      memo: normalizeChargeMemo(rawMemo),
      rawMemo,
      payerAddress: operation.from ?? operation.source_account,
      stroops,
      pagingToken: operation.paging_token,
    });
  }

  return [...byHash.values()];
}

/**
 * Decides whether a transfer settles a charge. One transaction must carry the
 * charge memo and cover the whole amount; partial payments do not settle.
 */
export function judgeTransfer(
  transfer: IncomingTransfer,
  charge: { memo: string; dueStroops: bigint },
): TransferVerdict {
  if (transfer.memo !== charge.memo) return 'wrong_memo';
  return transfer.stroops >= charge.dueStroops ? 'settles' : 'underpaid';
}
