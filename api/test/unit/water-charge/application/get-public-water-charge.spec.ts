import { NotFoundException } from '@nestjs/common';
import { GetPublicWaterChargeUseCase } from '@/modules/water-charge/application/use-cases/get-public-water-charge';
import { GetNextDemoChargeUseCase } from '@/modules/water-charge/application/use-cases/get-next-demo-charge';
import { StellarConfig } from '@/shared/stellar/stellar.config';
import { StellarGatewayError } from '@/shared/stellar/stellar-gateway.interface';
import { USDC_ISSUER } from '../__fixtures__/horizon.fixtures';
import {
  BUILDING_ID,
  PUBLIC_CODE,
  SIGNER_A,
  STELLAR_CONFIG,
  createChargeView,
  createMockStellarGateway,
  createMockWaterChargeRepository,
} from '../__fixtures__/mock-types';

describe('GetPublicWaterChargeUseCase', () => {
  let chargeRepository: ReturnType<typeof createMockWaterChargeRepository>;
  let useCase: GetPublicWaterChargeUseCase;

  beforeEach(() => {
    chargeRepository = createMockWaterChargeRepository();
    useCase = new GetPublicWaterChargeUseCase(chargeRepository);
  });

  it('returns the charge behind the code', async () => {
    const view = createChargeView();
    chargeRepository.findByPublicCode.mockResolvedValue(view);

    await expect(useCase.execute(PUBLIC_CODE)).resolves.toBe(view);
    expect(chargeRepository.findByPublicCode).toHaveBeenCalledWith(PUBLIC_CODE);
  });

  it('answers 404 for an unknown code', async () => {
    chargeRepository.findByPublicCode.mockResolvedValue(null);

    await expect(useCase.execute(PUBLIC_CODE)).rejects.toThrow(
      new NotFoundException('Charge not found'),
    );
  });

  it.each([
    '',
    'short',
    'AQT-7F3K2M9QXZ',
    '7F3K2M9QXZ0A1B2C3D4E',
    '7f3k2m9qxz0a1b2c3d4e5',
    "7f3k2m9qxz0a1b2c3d4'",
    '6d1f0a9e-2b3c-4d5e-8f70-112233445566',
  ])('answers 404 for the malformed code %p without a query', async (code) => {
    await expect(useCase.execute(code)).rejects.toThrow(NotFoundException);
    expect(chargeRepository.findByPublicCode).not.toHaveBeenCalled();
  });
});

describe('GetNextDemoChargeUseCase', () => {
  const OTHER_CODE = '0a1b2c3d4e5f6g7h8j9k';
  /** Stands in for the operations account the faucet pays from. */
  const OPS = SIGNER_A;

  let chargeRepository: ReturnType<typeof createMockWaterChargeRepository>;
  let gateway: ReturnType<typeof createMockStellarGateway>;

  const build = (config: StellarConfig = STELLAR_CONFIG) =>
    new GetNextDemoChargeUseCase(chargeRepository, gateway, config);

  /** The faucet's account holding `balance` of an asset. */
  const faucetHolding = (balance: string, issuer: string = USDC_ISSUER) => {
    gateway.opsPublicKey.mockResolvedValue(OPS);
    gateway.getAccount.mockResolvedValue({
      balances: [
        { balance: '9000.0000000', asset_type: 'native' },
        {
          balance,
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: issuer,
        },
      ],
    });
  };

  beforeEach(() => {
    chargeRepository = createMockWaterChargeRepository();
    gateway = createMockStellarGateway();
  });

  it('returns the code of a pending charge', async () => {
    chargeRepository.findRandomPendingPublicCode.mockResolvedValue(PUBLIC_CODE);

    await expect(build().execute()).resolves.toBe(PUBLIC_CODE);
    expect(chargeRepository.findRandomPendingPublicCode).toHaveBeenCalledWith(
      null,
    );
  });

  it('stays inside the demo building when one is configured', async () => {
    chargeRepository.findRandomPendingPublicCode.mockResolvedValue(PUBLIC_CODE);

    await build({ ...STELLAR_CONFIG, demoBuildingId: BUILDING_ID }).execute();

    expect(chargeRepository.findRandomPendingPublicCode).toHaveBeenCalledWith(
      BUILDING_ID,
    );
  });

  it('prefers a charge the faucet can fund', async () => {
    faucetHolding('20.0000000');
    chargeRepository.findRandomPendingPublicCode.mockResolvedValue(PUBLIC_CODE);

    await expect(
      build({ ...STELLAR_CONFIG, demoBuildingId: BUILDING_ID }).execute(),
    ).resolves.toBe(PUBLIC_CODE);

    expect(gateway.getAccount).toHaveBeenCalledWith(OPS);
    expect(chargeRepository.findRandomPendingPublicCode.mock.calls).toEqual([
      [BUILDING_ID, '20.0000000'],
    ]);
  });

  it('hands out any pending charge when the faucet can fund none', async () => {
    faucetHolding('3.5000000');
    chargeRepository.findRandomPendingPublicCode
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(OTHER_CODE);

    await expect(build().execute()).resolves.toBe(OTHER_CODE);

    expect(chargeRepository.findRandomPendingPublicCode.mock.calls).toEqual([
      [null, '3.5000000'],
      [null],
    ]);
  });

  it('ignores what the faucet holds of another asset', async () => {
    faucetHolding('500.0000000', SIGNER_A);
    chargeRepository.findRandomPendingPublicCode.mockResolvedValue(PUBLIC_CODE);

    await expect(build().execute()).resolves.toBe(PUBLIC_CODE);

    expect(chargeRepository.findRandomPendingPublicCode.mock.calls).toEqual([
      [null],
    ]);
  });

  it.each([
    [
      'the network cannot be reached',
      () =>
        gateway.getAccount.mockRejectedValue(
          new StellarGatewayError('Could not reach Horizon'),
        ),
    ],
    [
      'the faucet account does not exist',
      () => gateway.getAccount.mockResolvedValue(null),
    ],
  ])('still hands out a charge when %s', async (_, arrange) => {
    gateway.opsPublicKey.mockResolvedValue(OPS);
    arrange();
    chargeRepository.findRandomPendingPublicCode.mockResolvedValue(PUBLIC_CODE);

    await expect(build().execute()).resolves.toBe(PUBLIC_CODE);

    expect(chargeRepository.findRandomPendingPublicCode.mock.calls).toEqual([
      [null],
    ]);
  });

  it('answers 404 when no charge is pending', async () => {
    chargeRepository.findRandomPendingPublicCode.mockResolvedValue(null);

    await expect(build().execute()).rejects.toThrow(NotFoundException);
  });

  it('answers 404 without looking anything up when the demo is off', async () => {
    const useCase = build({ ...STELLAR_CONFIG, demoFaucetEnabled: false });

    await expect(useCase.execute()).rejects.toThrow(NotFoundException);
    expect(chargeRepository.findRandomPendingPublicCode).not.toHaveBeenCalled();
    expect(gateway.opsPublicKey).not.toHaveBeenCalled();
  });
});
