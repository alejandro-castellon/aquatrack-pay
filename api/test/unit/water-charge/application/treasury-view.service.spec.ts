import { Test, TestingModule } from '@nestjs/testing';
import { TreasuryViewService } from '@/modules/water-charge/application/services/treasury-view.service';
import { WATER_CHARGE_REPOSITORY } from '@/modules/water-charge/domain/water-charge.repository.interface';
import {
  STELLAR_GATEWAY,
  StellarGatewayError,
} from '@/shared/stellar/stellar-gateway.interface';
import {
  MEMO,
  PAYER,
  TREASURY,
  horizonTransaction,
  paymentOperation,
} from '../__fixtures__/horizon.fixtures';
import {
  SIGNER_A,
  SIGNER_B,
  SIGNER_C,
  TREASURY_ID,
  createChargeView,
  createMockStellarGateway,
  createMockWaterChargeRepository,
  createTreasury,
  createTreasuryAccount,
} from '../__fixtures__/mock-types';

describe('TreasuryViewService', () => {
  let service: TreasuryViewService;
  let gateway: ReturnType<typeof createMockStellarGateway>;
  let chargeRepository: ReturnType<typeof createMockWaterChargeRepository>;

  /** A payment to the treasury in its own transaction. */
  const transferOperation = (
    hash: string,
    memo: string | undefined,
    amount = '22.2800000',
  ) =>
    paymentOperation(
      { amount, transaction_hash: hash },
      horizonTransaction({
        hash,
        memo,
        memo_type: memo === undefined ? 'none' : 'text',
      }),
    );

  beforeEach(async () => {
    gateway = createMockStellarGateway();
    chargeRepository = createMockWaterChargeRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TreasuryViewService,
        { provide: STELLAR_GATEWAY, useValue: gateway },
        { provide: WATER_CHARGE_REPOSITORY, useValue: chargeRepository },
      ],
    }).compile();

    service = module.get(TreasuryViewService);

    gateway.getAccount.mockResolvedValue(createTreasuryAccount());
    gateway.listAccountPayments.mockResolvedValue([]);
    chargeRepository.findByTreasuryIdAndMemos.mockResolvedValue([]);
  });

  describe('on-chain state', () => {
    it('reports balances, thresholds and the board signers', async () => {
      const { onChain } = await service.build(createTreasury());

      expect(gateway.getAccount).toHaveBeenCalledWith(TREASURY);
      expect(onChain).toEqual({
        balance: '104.7300000',
        xlmBalance: '4.9990000',
        masterWeight: 0,
        thresholds: { low: 2, med: 2, high: 2 },
        signers: [
          { publicKey: SIGNER_A, weight: 1 },
          { publicKey: SIGNER_B, weight: 1 },
          { publicKey: SIGNER_C, weight: 1 },
        ],
      });
    });

    it('shows a zero balance when the trustline holds nothing readable', async () => {
      gateway.getAccount.mockResolvedValue(
        createTreasuryAccount({
          balances: [{ balance: '5.0000000', asset_type: 'native' }],
        }),
      );

      const { onChain } = await service.build(createTreasury());

      expect(onChain?.balance).toBe('0.0000000');
      expect(onChain?.xlmBalance).toBe('5.0000000');
    });

    it('is null when the account is not on the network', async () => {
      gateway.getAccount.mockResolvedValue(null);

      await expect(service.build(createTreasury())).resolves.toEqual(
        expect.objectContaining({ onChain: null }),
      );
    });

    it('degrades to an empty view when Horizon cannot be reached', async () => {
      const outage = new StellarGatewayError('Could not reach Horizon');
      gateway.getAccount.mockRejectedValue(outage);
      gateway.listAccountPayments.mockRejectedValue(outage);

      const treasury = createTreasury();

      await expect(service.build(treasury)).resolves.toEqual({
        treasury,
        onChain: null,
        transfers: [],
      });
      expect(chargeRepository.findByTreasuryIdAndMemos).not.toHaveBeenCalled();
    });

    it('does not swallow errors that are not about Stellar', async () => {
      gateway.getAccount.mockRejectedValue(new Error('bug'));

      await expect(service.build(createTreasury())).rejects.toThrow('bug');
    });
  });

  describe('transfers', () => {
    it('reads the newest page of the treasury history', async () => {
      await service.build(createTreasury());

      expect(gateway.listAccountPayments).toHaveBeenCalledWith(TREASURY, {
        order: 'desc',
        limit: 200,
      });
    });

    it('marks the transfer that settled a charge as matched', async () => {
      gateway.listAccountPayments.mockResolvedValue([
        transferOperation('hash-paid', MEMO),
      ]);
      chargeRepository.findByTreasuryIdAndMemos.mockResolvedValue([
        createChargeView({ status: 'paid', txHash: 'hash-paid' }),
      ]);

      const { transfers } = await service.build(createTreasury());

      expect(chargeRepository.findByTreasuryIdAndMemos).toHaveBeenCalledWith(
        TREASURY_ID,
        [MEMO],
      );
      expect(transfers).toEqual([
        {
          txHash: 'hash-paid',
          createdAt: new Date('2026-11-18T15:00:00Z'),
          payerAddress: PAYER,
          amountUsdc: '22.2800000',
          memo: MEMO,
          status: 'matched',
          apartmentNumber: '101',
          month: '2026-10',
        },
      ]);
    });

    it('marks a second payment of a settled charge as duplicate', async () => {
      gateway.listAccountPayments.mockResolvedValue([
        transferOperation('hash-second', MEMO),
        transferOperation('hash-first', MEMO),
      ]);
      chargeRepository.findByTreasuryIdAndMemos.mockResolvedValue([
        createChargeView({ status: 'paid', txHash: 'hash-first' }),
      ]);

      const { transfers } = await service.build(createTreasury());

      expect(transfers.map((transfer) => transfer.status)).toEqual([
        'duplicate',
        'matched',
      ]);
      expect(transfers[0].apartmentNumber).toBe('101');
    });

    it('marks a short payment of a pending charge as underpaid', async () => {
      gateway.listAccountPayments.mockResolvedValue([
        transferOperation('hash-short', MEMO, '22.2700000'),
      ]);
      chargeRepository.findByTreasuryIdAndMemos.mockResolvedValue([
        createChargeView(),
      ]);

      const { transfers } = await service.build(createTreasury());

      expect(transfers[0]).toEqual(
        expect.objectContaining({
          status: 'underpaid',
          amountUsdc: '22.2700000',
          apartmentNumber: '101',
          month: '2026-10',
        }),
      );
    });

    it.each([
      ['no memo', undefined, null],
      ['a memo that is not a charge reference', 'gracias', 'gracias'],
      [
        'the memo of no charge of this treasury',
        'AQT-0000000000',
        'AQT-0000000000',
      ],
    ])('leaves a transfer with %s unmatched', async (_, memo, shownMemo) => {
      gateway.listAccountPayments.mockResolvedValue([
        transferOperation('hash-x', memo),
      ]);

      const { transfers } = await service.build(createTreasury());

      expect(transfers[0]).toEqual(
        expect.objectContaining({
          status: 'unmatched',
          memo: shownMemo,
          apartmentNumber: null,
          month: null,
        }),
      );
    });

    it('leaves a transfer for a cancelled charge unmatched', async () => {
      gateway.listAccountPayments.mockResolvedValue([
        transferOperation('hash-x', MEMO),
      ]);
      chargeRepository.findByTreasuryIdAndMemos.mockResolvedValue([
        createChargeView({ status: 'cancelled' }),
      ]);

      const { transfers } = await service.build(createTreasury());

      expect(transfers[0].status).toBe('unmatched');
      expect(transfers[0].apartmentNumber).toBeNull();
    });

    it('ignores what is not an incoming transfer in the charge asset', async () => {
      gateway.listAccountPayments.mockResolvedValue([
        paymentOperation({ asset_type: 'native', asset_code: undefined }),
        paymentOperation({ from: TREASURY, to: PAYER }),
        paymentOperation({ type: 'create_account', amount: undefined }),
      ]);

      const { transfers } = await service.build(createTreasury());

      expect(transfers).toEqual([]);
    });

    it('shows at most 50 transfers', async () => {
      gateway.listAccountPayments.mockResolvedValue(
        Array.from({ length: 60 }, (_, i) =>
          transferOperation(`hash-${i}`, undefined),
        ),
      );

      const { transfers } = await service.build(createTreasury());

      expect(transfers).toHaveLength(50);
      expect(transfers[0].txHash).toBe('hash-0');
    });

    it('leaves out a transaction a full page may have cut in half', async () => {
      const page = Array.from({ length: 200 }, (_, i) =>
        transferOperation(i === 199 ? 'hash-cut' : `hash-${i}`, undefined),
      );
      gateway.listAccountPayments.mockResolvedValue(page);

      const { transfers } = await service.build(createTreasury());

      expect(transfers.some((transfer) => transfer.txHash === 'hash-cut')).toBe(
        false,
      );
    });
  });
});
