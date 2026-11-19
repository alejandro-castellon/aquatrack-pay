import * as fs from 'fs';
import * as path from 'path';
import { HorizonOperation } from '@/shared/stellar/horizon.types';
import {
  TransferTarget,
  collectIncomingTransfers,
  judgeTransfer,
} from '@/modules/water-charge/domain/services/transfer-matcher';

/**
 * Horizon answers captured on testnet by `pnpm demo:smoke --capture`
 * (scripts/demo/smoke-testnet.ts), trimmed to the fields the API reads.
 * They pin the verifier to what the network really returns.
 */
const CAPTURE_DIR = path.join(__dirname, '..', '..', '__fixtures__', 'testnet');

interface Capture {
  description: string;
  target: TransferTarget;
  charge: { memo: string; dueStroops: string };
  lookedUpBy: string;
  operations: HorizonOperation[];
}

function load<T = Capture>(name: string): T {
  return JSON.parse(
    fs.readFileSync(path.join(CAPTURE_DIR, `${name}.json`), 'utf8'),
  ) as T;
}

function verdictOf(capture: Capture): string {
  const transfers = collectIncomingTransfers(
    capture.operations,
    capture.target,
  );
  if (transfers.length === 0) return 'ignored';
  return judgeTransfer(transfers[0], {
    memo: capture.charge.memo,
    dueStroops: BigInt(capture.charge.dueStroops),
  });
}

describe('transfer-matcher on testnet captures', () => {
  it.each([
    ['exact', 'settles'],
    ['overpaid', 'settles'],
    ['two-payments', 'settles'],
    ['fee-bump', 'settles'],
    ['fee-bump-inner-hash', 'settles'],
    ['underpaid', 'underpaid'],
    ['no-memo', 'wrong_memo'],
    ['wrong-asset', 'ignored'],
  ])('%s: %s', (name, expected) => {
    expect(verdictOf(load(name))).toBe(expected);
  });

  it('adds up the two payments of one transaction', () => {
    const capture = load('two-payments');
    const transfers = collectIncomingTransfers(
      capture.operations,
      capture.target,
    );

    expect(capture.operations).toHaveLength(2);
    expect(transfers).toHaveLength(1);
    expect(transfers[0].stroops).toBe(BigInt(capture.charge.dueStroops));
  });

  it('gives a fee bump the same ledger hash whichever hash it was looked up by', () => {
    const byOuter = load('fee-bump');
    const byInner = load('fee-bump-inner-hash');
    const [outer] = collectIncomingTransfers(
      byOuter.operations,
      byOuter.target,
    );
    const [inner] = collectIncomingTransfers(
      byInner.operations,
      byInner.target,
    );

    // Horizon echoes the hash it was asked for...
    expect(byInner.operations[0].transaction?.hash).toBe(byInner.lookedUpBy);
    expect(byInner.lookedUpBy).not.toBe(byOuter.lookedUpBy);
    // ...but the transfer is identified by the hash in the ledger.
    expect(inner.txHash).toBe(byOuter.lookedUpBy);
    expect(outer.txHash).toBe(byOuter.lookedUpBy);
  });

  it('names the resident as payer of a sponsored transaction, not the sponsor', () => {
    const capture = load('fee-bump');
    const [transfer] = collectIncomingTransfers(
      capture.operations,
      capture.target,
    );
    const transaction = capture.operations[0].transaction;

    expect(transaction?.fee_account).not.toBe(transaction?.source_account);
    expect(transfer.payerAddress).toBe(transaction?.source_account);
  });

  it('reads the treasury history as the watcher does', () => {
    const history = load<{
      target: TransferTarget;
      expectedTransfers: number;
      operations: HorizonOperation[];
    }>('account-payments');
    const transfers = collectIncomingTransfers(
      history.operations,
      history.target,
    );

    // The account creation and the payment in XLM are in the listing too.
    expect(history.operations.length).toBeGreaterThan(transfers.length);
    expect(transfers).toHaveLength(history.expectedTransfers);
    expect(new Set(transfers.map((transfer) => transfer.txHash)).size).toBe(
      transfers.length,
    );
    expect(load('exact').lookedUpBy).toBe(transfers[0].txHash);
  });
});
