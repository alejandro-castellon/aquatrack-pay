import {
  collectIncomingTransfers,
  judgeTransfer,
} from '@/modules/water-charge/domain/services/transfer-matcher';
import {
  MEMO,
  PAYER,
  TARGET,
  TREASURY,
  horizonTransaction,
  paymentOperation,
} from '../../__fixtures__/horizon.fixtures';

const DUE = 222_800_000n; // 22.28 USDC

describe('transfer-matcher', () => {
  describe('collectIncomingTransfers', () => {
    it('reads a USDC payment to the treasury with its memo', () => {
      const transaction = horizonTransaction({ hash: 'abc', ledger: 123 });
      const operation = paymentOperation({ paging_token: '900' }, transaction);

      expect(collectIncomingTransfers([operation], TARGET)).toEqual([
        {
          txHash: 'abc',
          ledger: 123,
          createdAt: new Date('2026-11-18T15:00:00Z'),
          memo: MEMO,
          rawMemo: MEMO,
          payerAddress: PAYER,
          stroops: DUE,
          pagingToken: '900',
        },
      ]);
    });

    it('sums several payments of the same transaction', () => {
      const transaction = horizonTransaction();
      const transfers = collectIncomingTransfers(
        [
          paymentOperation({ amount: '10.0000000' }, transaction),
          paymentOperation(
            { amount: '12.2800000', paging_token: '77' },
            transaction,
          ),
        ],
        TARGET,
      );

      expect(transfers).toHaveLength(1);
      expect(transfers[0].stroops).toBe(DUE);
      expect(transfers[0].pagingToken).toBe('77');
    });

    it('keeps transactions apart and in the order received', () => {
      const first = paymentOperation({ amount: '1.0000000' });
      const second = paymentOperation({ amount: '2.0000000' });

      const transfers = collectIncomingTransfers([first, second], TARGET);

      expect(transfers.map((transfer) => transfer.stroops)).toEqual([
        10_000_000n,
        20_000_000n,
      ]);
      expect(transfers[0].txHash).not.toBe(transfers[1].txHash);
    });

    it('counts a path payment by what the treasury received', () => {
      const [transfer] = collectIncomingTransfers(
        [paymentOperation({ type: 'path_payment_strict_receive' })],
        TARGET,
      );

      expect(transfer.stroops).toBe(DUE);
    });

    it.each(['outer', 'inner'])(
      'reports the ledger hash of a fee bump looked up by its %s hash',
      (lookedUpBy) => {
        // Horizon echoes the hash it was asked for in `transaction.hash`.
        const transaction = horizonTransaction({
          hash: lookedUpBy,
          fee_account: 'GSPONSOR',
          inner_transaction: { hash: 'inner' },
          fee_bump_transaction: { hash: 'outer' },
        });

        const [transfer] = collectIncomingTransfers(
          [paymentOperation({ transaction_hash: 'outer' }, transaction)],
          TARGET,
        );

        expect(transfer.txHash).toBe('outer');
        expect(transfer.payerAddress).toBe(PAYER);
      },
    );

    it('normalizes a memo typed by hand and keeps the raw text', () => {
      const [transfer] = collectIncomingTransfers(
        [paymentOperation({}, horizonTransaction({ memo: ' aqt-7f3k2m9qxz' }))],
        TARGET,
      );

      expect(transfer.memo).toBe(MEMO);
      expect(transfer.rawMemo).toBe(' aqt-7f3k2m9qxz');
    });

    it.each([
      ['a memo id', { memo_type: 'id' as const, memo: '12345' }],
      ['no memo', { memo_type: 'none' as const, memo: undefined }],
      ['a memo that is not ours', { memo: 'gracias' }],
    ])('keeps the transfer but without reference for %s', (_, memoFields) => {
      const [transfer] = collectIncomingTransfers(
        [paymentOperation({}, horizonTransaction(memoFields))],
        TARGET,
      );

      expect(transfer.memo).toBeNull();
      expect(transfer.stroops).toBe(DUE);
    });

    it.each([
      ['another issuer', { asset_issuer: 'GFAKEISSUER' }],
      ['another asset code', { asset_code: 'USDT' }],
      [
        'lumens',
        {
          asset_type: 'native' as const,
          asset_code: undefined,
          asset_issuer: undefined,
        },
      ],
      ['another destination', { to: 'GSOMEONEELSE' }],
      ['a payment sent by the treasury', { from: TREASURY, to: PAYER }],
      ['an account creation', { type: 'create_account' }],
      [
        'a contract call',
        { type: 'invoke_host_function', to: undefined, amount: undefined },
      ],
    ])('ignores %s', (_, overrides) => {
      expect(
        collectIncomingTransfers([paymentOperation(overrides)], TARGET),
      ).toEqual([]);
    });

    it('ignores the payments of a failed transaction', () => {
      const failed = horizonTransaction({ successful: false });

      expect(
        collectIncomingTransfers([paymentOperation({}, failed)], TARGET),
      ).toEqual([]);
    });

    it('still reads the amount when the transaction was not joined', () => {
      const operation = paymentOperation({
        transaction: undefined,
        transaction_hash: 'bare',
      });

      const [transfer] = collectIncomingTransfers([operation], TARGET);

      expect(transfer).toMatchObject({
        txHash: 'bare',
        memo: null,
        ledger: 0,
        stroops: DUE,
      });
    });
  });

  describe('judgeTransfer', () => {
    const charge = { memo: MEMO, dueStroops: DUE };
    const transferOf = (amount: string, memo = MEMO) =>
      collectIncomingTransfers(
        [paymentOperation({ amount }, horizonTransaction({ memo }))],
        TARGET,
      )[0];

    it('settles with the exact amount', () => {
      expect(judgeTransfer(transferOf('22.2800000'), charge)).toBe('settles');
    });

    it('settles when more than the amount is paid', () => {
      expect(judgeTransfer(transferOf('25.0000000'), charge)).toBe('settles');
    });

    it('does not settle one stroop short', () => {
      expect(judgeTransfer(transferOf('22.2799999'), charge)).toBe('underpaid');
    });

    it('does not settle with the memo of another charge', () => {
      expect(
        judgeTransfer(transferOf('22.2800000', 'AQT-0000000000'), charge),
      ).toBe('wrong_memo');
    });

    it('does not settle without a memo, whatever the amount', () => {
      expect(judgeTransfer(transferOf('99.0000000', 'gracias'), charge)).toBe(
        'wrong_memo',
      );
    });
  });
});
