import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfirmWaterChargeTransferUseCase } from '@/modules/water-charge/application/use-cases/confirm-water-charge-transfer';
import { GetPublicWaterChargeUseCase } from '@/modules/water-charge/application/use-cases/get-public-water-charge';
import { WATER_CHARGE_REPOSITORY } from '@/modules/water-charge/domain/water-charge.repository.interface';
import {
  STELLAR_GATEWAY,
  StellarGatewayError,
} from '@/shared/stellar/stellar-gateway.interface';
import {
  MEMO,
  PAYER,
  horizonTransaction,
  paymentOperation,
} from '../__fixtures__/horizon.fixtures';
import {
  CHARGE_ID,
  PUBLIC_CODE,
  TX_HASH,
  createChargeView,
  createMockStellarGateway,
  createMockWaterChargeRepository,
} from '../__fixtures__/mock-types';

describe('ConfirmWaterChargeTransferUseCase', () => {
  let useCase: ConfirmWaterChargeTransferUseCase;
  let chargeRepository: ReturnType<typeof createMockWaterChargeRepository>;
  let gateway: ReturnType<typeof createMockStellarGateway>;

  /** Operations of a transaction paying the treasury, as the gateway returns them. */
  const paying = (
    overrides: { amount?: string; memo?: string; to?: string } = {},
    hash = TX_HASH,
  ) => [
    paymentOperation(
      {
        transaction_hash: hash,
        amount: overrides.amount ?? '22.2800000',
        ...(overrides.to ? { to: overrides.to } : {}),
      },
      horizonTransaction({
        hash,
        ledger: 4321,
        created_at: '2026-11-18T16:00:00Z',
        memo: overrides.memo ?? MEMO,
      }),
    ),
  ];

  beforeEach(async () => {
    chargeRepository = createMockWaterChargeRepository();
    gateway = createMockStellarGateway();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfirmWaterChargeTransferUseCase,
        GetPublicWaterChargeUseCase,
        { provide: WATER_CHARGE_REPOSITORY, useValue: chargeRepository },
        { provide: STELLAR_GATEWAY, useValue: gateway },
      ],
    }).compile();

    useCase = module.get(ConfirmWaterChargeTransferUseCase);

    chargeRepository.findByPublicCode.mockResolvedValue(createChargeView());
    gateway.getTransactionOperations.mockResolvedValue(paying());
    chargeRepository.settle.mockResolvedValue('settled');
  });

  it('settles the charge with what the ledger says', async () => {
    const paid = createChargeView({ status: 'paid', txHash: TX_HASH });
    chargeRepository.findByPublicCode
      .mockResolvedValueOnce(createChargeView())
      .mockResolvedValueOnce(paid);

    const result = await useCase.execute(PUBLIC_CODE, TX_HASH);

    expect(gateway.getTransactionOperations).toHaveBeenCalledWith(TX_HASH);
    expect(chargeRepository.settle).toHaveBeenCalledWith(CHARGE_ID, {
      txHash: TX_HASH,
      payerAddress: PAYER,
      paidAmountUsdc: '22.2800000',
      ledger: 4321,
      paidAt: new Date('2026-11-18T16:00:00Z'),
    });
    expect(result).toEqual({ outcome: 'paid', charge: paid });
  });

  it('records the ledger hash, not the one the client sent', async () => {
    // A fee bump confirmed by its inner hash: Horizon echoes the inner hash
    // in the transaction, the operation carries the one in the ledger.
    gateway.getTransactionOperations.mockResolvedValue([
      paymentOperation(
        { transaction_hash: 'outer-hash' },
        horizonTransaction({
          hash: 'inner-hash',
          inner_transaction: { hash: 'inner-hash' },
          fee_bump_transaction: { hash: 'outer-hash' },
        }),
      ),
    ]);

    await useCase.execute(PUBLIC_CODE, 'inner-hash');

    expect(chargeRepository.settle).toHaveBeenCalledWith(
      CHARGE_ID,
      expect.objectContaining({ txHash: 'outer-hash', payerAddress: PAYER }),
    );
  });

  it('settles when more than the amount was paid, recording what arrived', async () => {
    gateway.getTransactionOperations.mockResolvedValue(
      paying({ amount: '25.0000000' }),
    );

    const result = await useCase.execute(PUBLIC_CODE, TX_HASH);

    expect(chargeRepository.settle).toHaveBeenCalledWith(
      CHARGE_ID,
      expect.objectContaining({ paidAmountUsdc: '25.0000000' }),
    );
    expect(result.outcome).toBe('paid');
  });

  it('answers already_paid without reading the ledger again', async () => {
    const paid = createChargeView({ status: 'paid', txHash: 'earlier-hash' });
    chargeRepository.findByPublicCode.mockResolvedValue(paid);

    await expect(useCase.execute(PUBLIC_CODE, TX_HASH)).resolves.toEqual({
      outcome: 'already_paid',
      charge: paid,
    });
    expect(gateway.getTransactionOperations).not.toHaveBeenCalled();
    expect(chargeRepository.settle).not.toHaveBeenCalled();
  });

  it('answers not_found_yet while Horizon does not know the hash', async () => {
    gateway.getTransactionOperations.mockResolvedValue(null);

    const result = await useCase.execute(PUBLIC_CODE, TX_HASH);

    expect(result.outcome).toBe('not_found_yet');
    expect(chargeRepository.settle).not.toHaveBeenCalled();
  });

  it.each([
    ['paid someone else', paying({ to: 'GSOMEONEELSE' })],
    ['has no payment', []],
    [
      'failed',
      [paymentOperation({}, horizonTransaction({ successful: false }))],
    ],
  ])('answers not_a_payment when the transaction %s', async (_, operations) => {
    gateway.getTransactionOperations.mockResolvedValue(operations);

    const result = await useCase.execute(PUBLIC_CODE, TX_HASH);

    expect(result.outcome).toBe('not_a_payment');
    expect(chargeRepository.settle).not.toHaveBeenCalled();
  });

  it('does not let the payment of another charge settle this one', async () => {
    gateway.getTransactionOperations.mockResolvedValue(
      paying({ memo: 'AQT-0000000000' }),
    );

    const result = await useCase.execute(PUBLIC_CODE, TX_HASH);

    expect(result.outcome).toBe('wrong_memo');
    expect(chargeRepository.settle).not.toHaveBeenCalled();
  });

  it('answers underpaid when the amount does not cover the charge', async () => {
    gateway.getTransactionOperations.mockResolvedValue(
      paying({ amount: '22.2799999' }),
    );

    const result = await useCase.execute(PUBLIC_CODE, TX_HASH);

    expect(result.outcome).toBe('underpaid');
    expect(chargeRepository.settle).not.toHaveBeenCalled();
  });

  it('answers already_paid when someone else settled it meanwhile', async () => {
    const paid = createChargeView({ status: 'paid', txHash: TX_HASH });
    chargeRepository.settle.mockResolvedValue('not_pending');
    chargeRepository.findByPublicCode
      .mockResolvedValueOnce(createChargeView())
      .mockResolvedValueOnce(paid);

    await expect(useCase.execute(PUBLIC_CODE, TX_HASH)).resolves.toEqual({
      outcome: 'already_paid',
      charge: paid,
    });
  });

  it('answers 409 when the transaction already settled another charge', async () => {
    chargeRepository.settle.mockResolvedValue('hash_already_used');

    await expect(useCase.execute(PUBLIC_CODE, TX_HASH)).rejects.toThrow(
      ConflictException,
    );
  });

  it('answers 409 for a cancelled charge', async () => {
    chargeRepository.findByPublicCode.mockResolvedValue(
      createChargeView({ status: 'cancelled' }),
    );

    await expect(useCase.execute(PUBLIC_CODE, TX_HASH)).rejects.toThrow(
      new ConflictException('This charge was cancelled'),
    );
    expect(gateway.getTransactionOperations).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown or malformed code', async () => {
    chargeRepository.findByPublicCode.mockResolvedValue(null);

    await expect(useCase.execute(PUBLIC_CODE, TX_HASH)).rejects.toThrow(
      NotFoundException,
    );
    await expect(useCase.execute('not-a-code', TX_HASH)).rejects.toThrow(
      NotFoundException,
    );
    expect(gateway.getTransactionOperations).not.toHaveBeenCalled();
  });

  it('answers 503 when Stellar cannot be reached', async () => {
    gateway.getTransactionOperations.mockRejectedValue(
      new StellarGatewayError('Could not reach Horizon'),
    );

    await expect(useCase.execute(PUBLIC_CODE, TX_HASH)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(chargeRepository.settle).not.toHaveBeenCalled();
  });
});
