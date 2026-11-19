import { Test, TestingModule } from '@nestjs/testing';
import { ReconcileTreasuryTransfersUseCase } from '@/modules/water-charge/application/use-cases/reconcile-treasury-transfers';
import { WATER_CHARGE_REPOSITORY } from '@/modules/water-charge/domain/water-charge.repository.interface';
import { BUILDING_TREASURY_REPOSITORY } from '@/modules/water-charge/domain/building-treasury.repository.interface';
import {
  STELLAR_GATEWAY,
  StellarGatewayError,
} from '@/shared/stellar/stellar-gateway.interface';
import { HorizonOperation } from '@/shared/stellar/horizon.types';
import {
  MEMO,
  PAYER,
  TREASURY,
  horizonTransaction,
  paymentOperation,
} from '../__fixtures__/horizon.fixtures';
import {
  CHARGE_ID,
  TREASURY_ID,
  createChargeView,
  createMockBuildingTreasuryRepository,
  createMockStellarGateway,
  createMockWaterChargeRepository,
  createTreasury,
} from '../__fixtures__/mock-types';

describe('ReconcileTreasuryTransfersUseCase', () => {
  const OTHER_MEMO = 'AQT-0000000001';

  let useCase: ReconcileTreasuryTransfersUseCase;
  let treasuryRepository: ReturnType<
    typeof createMockBuildingTreasuryRepository
  >;
  let chargeRepository: ReturnType<typeof createMockWaterChargeRepository>;
  let gateway: ReturnType<typeof createMockStellarGateway>;

  /** A payment to the treasury in its own transaction, with a paging token. */
  const record = (
    token: string,
    overrides: { hash?: string; memo?: string; amount?: string } = {},
  ): HorizonOperation => {
    const hash = overrides.hash ?? `hash-${token}`;
    return paymentOperation(
      {
        paging_token: token,
        transaction_hash: hash,
        amount: overrides.amount ?? '22.2800000',
      },
      horizonTransaction({
        hash,
        ledger: 7000,
        created_at: '2026-11-18T16:00:00Z',
        memo: overrides.memo ?? MEMO,
      }),
    );
  };

  beforeEach(async () => {
    treasuryRepository = createMockBuildingTreasuryRepository();
    chargeRepository = createMockWaterChargeRepository();
    gateway = createMockStellarGateway();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReconcileTreasuryTransfersUseCase,
        { provide: BUILDING_TREASURY_REPOSITORY, useValue: treasuryRepository },
        { provide: WATER_CHARGE_REPOSITORY, useValue: chargeRepository },
        { provide: STELLAR_GATEWAY, useValue: gateway },
      ],
    }).compile();

    useCase = module.get(ReconcileTreasuryTransfersUseCase);

    chargeRepository.findByTreasuryIdAndMemos.mockResolvedValue([
      createChargeView(),
    ]);
    chargeRepository.settle.mockResolvedValue('settled');
    gateway.listAccountPayments.mockResolvedValue([]);
  });

  describe('reconcileTreasury', () => {
    it('settles a pending charge paid with its memo and remembers the cursor', async () => {
      gateway.listAccountPayments.mockResolvedValue([record('41')]);

      const settled = await useCase.reconcileTreasury(createTreasury());

      expect(gateway.listAccountPayments).toHaveBeenCalledWith(TREASURY, {
        order: 'asc',
        limit: 200,
        cursor: undefined,
      });
      expect(chargeRepository.findByTreasuryIdAndMemos).toHaveBeenCalledWith(
        TREASURY_ID,
        [MEMO],
      );
      expect(chargeRepository.settle).toHaveBeenCalledWith(CHARGE_ID, {
        txHash: 'hash-41',
        payerAddress: PAYER,
        paidAmountUsdc: '22.2800000',
        ledger: 7000,
        paidAt: new Date('2026-11-18T16:00:00Z'),
      });
      expect(treasuryRepository.updateCursor).toHaveBeenCalledWith(
        TREASURY_ID,
        '41',
      );
      expect(settled).toBe(1);
    });

    it('continues from the stored cursor', async () => {
      await useCase.reconcileTreasury(createTreasury({ lastCursor: '40' }));

      expect(gateway.listAccountPayments).toHaveBeenCalledWith(
        TREASURY,
        expect.objectContaining({ cursor: '40' }),
      );
      // Nothing new: the cursor stays where it was.
      expect(treasuryRepository.updateCursor).not.toHaveBeenCalled();
    });

    it.each([
      ['a short payment', record('41', { amount: '22.2700000' })],
      ['a memo of no charge', record('41', { memo: OTHER_MEMO })],
      ['a payment without reference', record('41', { memo: 'gracias' })],
      [
        'a payment in another asset',
        paymentOperation({ paging_token: '41', asset_code: 'USDT' }),
      ],
    ])('settles nothing for %s but moves past it', async (_, operation) => {
      chargeRepository.findByTreasuryIdAndMemos.mockImplementation(
        (_treasuryId: string, memos: string[]) =>
          Promise.resolve(memos.includes(MEMO) ? [createChargeView()] : []),
      );
      gateway.listAccountPayments.mockResolvedValue([operation]);

      const settled = await useCase.reconcileTreasury(createTreasury());

      expect(chargeRepository.settle).not.toHaveBeenCalled();
      expect(treasuryRepository.updateCursor).toHaveBeenCalledWith(
        TREASURY_ID,
        '41',
      );
      expect(settled).toBe(0);
    });

    it('leaves a charge that is already paid alone', async () => {
      chargeRepository.findByTreasuryIdAndMemos.mockResolvedValue([
        createChargeView({ status: 'paid', txHash: 'earlier' }),
      ]);
      gateway.listAccountPayments.mockResolvedValue([record('41')]);

      await expect(useCase.reconcileTreasury(createTreasury())).resolves.toBe(
        0,
      );
      expect(chargeRepository.settle).not.toHaveBeenCalled();
    });

    it('settles once when the same memo was paid twice', async () => {
      gateway.listAccountPayments.mockResolvedValue([
        record('41'),
        record('42'),
      ]);

      const settled = await useCase.reconcileTreasury(createTreasury());

      expect(chargeRepository.settle).toHaveBeenCalledTimes(1);
      expect(chargeRepository.settle).toHaveBeenCalledWith(
        CHARGE_ID,
        expect.objectContaining({ txHash: 'hash-41' }),
      );
      expect(treasuryRepository.updateCursor).toHaveBeenCalledWith(
        TREASURY_ID,
        '42',
      );
      expect(settled).toBe(1);
    });

    it('does not count a charge someone else settled first', async () => {
      chargeRepository.settle.mockResolvedValue('not_pending');
      gateway.listAccountPayments.mockResolvedValue([record('41')]);

      await expect(useCase.reconcileTreasury(createTreasury())).resolves.toBe(
        0,
      );
    });

    it('adds up the payments of one transaction', async () => {
      gateway.listAccountPayments.mockResolvedValue([
        record('41', { hash: 'split', amount: '10.0000000' }),
        record('42', { hash: 'split', amount: '12.2800000' }),
      ]);

      await useCase.reconcileTreasury(createTreasury());

      expect(chargeRepository.settle).toHaveBeenCalledWith(
        CHARGE_ID,
        expect.objectContaining({
          txHash: 'split',
          paidAmountUsdc: '22.2800000',
        }),
      );
    });

    it('reads the next page after a full one, without cutting a transaction', async () => {
      // 199 unrelated records, then a transaction whose two payments fall on
      // both sides of the page boundary.
      const firstPage = [
        ...Array.from({ length: 199 }, (_, i) =>
          record(String(i + 1), { memo: 'gracias' }),
        ),
        record('200', { hash: 'split', amount: '10.0000000' }),
      ];
      const secondPage = [
        record('200', { hash: 'split', amount: '10.0000000' }),
        record('201', { hash: 'split', amount: '12.2800000' }),
      ];
      gateway.listAccountPayments
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce(secondPage);

      const settled = await useCase.reconcileTreasury(createTreasury());

      expect(gateway.listAccountPayments).toHaveBeenNthCalledWith(
        2,
        TREASURY,
        expect.objectContaining({ cursor: '199' }),
      );
      expect(treasuryRepository.updateCursor).toHaveBeenNthCalledWith(
        1,
        TREASURY_ID,
        '199',
      );
      expect(treasuryRepository.updateCursor).toHaveBeenNthCalledWith(
        2,
        TREASURY_ID,
        '201',
      );
      expect(chargeRepository.settle).toHaveBeenCalledTimes(1);
      expect(chargeRepository.settle).toHaveBeenCalledWith(
        CHARGE_ID,
        expect.objectContaining({ paidAmountUsdc: '22.2800000' }),
      );
      expect(settled).toBe(1);
    });

    it('stops after a bounded number of pages and resumes next time', async () => {
      let token = 0;
      gateway.listAccountPayments.mockImplementation(() =>
        Promise.resolve(
          Array.from({ length: 200 }, () =>
            record(String(++token), { memo: 'gracias' }),
          ),
        ),
      );

      await useCase.reconcileTreasury(createTreasury());

      expect(gateway.listAccountPayments).toHaveBeenCalledTimes(10);
    });

    it('keeps the cursor when settling fails, so the page is read again', async () => {
      chargeRepository.settle.mockRejectedValue(new Error('database down'));
      gateway.listAccountPayments.mockResolvedValue([record('41')]);

      await expect(useCase.reconcileTreasury(createTreasury())).rejects.toThrow(
        'database down',
      );
      expect(treasuryRepository.updateCursor).not.toHaveBeenCalled();
    });
  });

  describe('execute', () => {
    it('reads every treasury that has pending charges', async () => {
      const first = createTreasury({ id: 'treasury-1', publicKey: 'GFIRST' });
      const second = createTreasury({ id: 'treasury-2', publicKey: 'GSECOND' });
      treasuryRepository.findWithPendingCharges.mockResolvedValue([
        first,
        second,
      ]);

      await expect(useCase.execute()).resolves.toEqual({
        treasuries: 2,
        settled: 0,
      });
      expect(gateway.listAccountPayments).toHaveBeenCalledWith(
        'GFIRST',
        expect.anything(),
      );
      expect(gateway.listAccountPayments).toHaveBeenCalledWith(
        'GSECOND',
        expect.anything(),
      );
    });

    it('goes on with the rest when one treasury cannot be read', async () => {
      const broken = createTreasury({ id: 'treasury-1', publicKey: 'GBROKEN' });
      const healthy = createTreasury({ id: 'treasury-2' });
      treasuryRepository.findWithPendingCharges.mockResolvedValue([
        broken,
        healthy,
      ]);
      gateway.listAccountPayments.mockImplementation((publicKey: string) =>
        publicKey === 'GBROKEN'
          ? Promise.reject(new StellarGatewayError('Could not reach Horizon'))
          : Promise.resolve([record('41')]),
      );

      await expect(useCase.execute()).resolves.toEqual({
        treasuries: 2,
        settled: 1,
      });
    });

    it('does nothing when no treasury has pending charges', async () => {
      treasuryRepository.findWithPendingCharges.mockResolvedValue([]);

      await expect(useCase.execute()).resolves.toEqual({
        treasuries: 0,
        settled: 0,
      });
      expect(gateway.listAccountPayments).not.toHaveBeenCalled();
    });
  });
});
