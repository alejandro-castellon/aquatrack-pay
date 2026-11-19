import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RequestDemoFundsUseCase } from '@/modules/water-charge/application/use-cases/request-demo-funds';
import { GetPublicWaterChargeUseCase } from '@/modules/water-charge/application/use-cases/get-public-water-charge';
import { WATER_CHARGE_REPOSITORY } from '@/modules/water-charge/domain/water-charge.repository.interface';
import stellarConfig, { StellarConfig } from '@/shared/stellar/stellar.config';
import {
  STELLAR_GATEWAY,
  StellarGatewayError,
  StellarSubmitError,
} from '@/shared/stellar/stellar-gateway.interface';
import { HorizonAccount } from '@/shared/stellar/horizon.types';
import { PAYER, USDC_ISSUER } from '../__fixtures__/horizon.fixtures';
import {
  CHARGE_ID,
  PUBLIC_CODE,
  STELLAR_CONFIG,
  createChargeView,
  createMockStellarGateway,
  createMockWaterChargeRepository,
} from '../__fixtures__/mock-types';

describe('RequestDemoFundsUseCase', () => {
  let chargeRepository: ReturnType<typeof createMockWaterChargeRepository>;
  let gateway: ReturnType<typeof createMockStellarGateway>;

  /** The payer's wallet with a USDC trustline holding `balance`. */
  const wallet = (balance: string | null): HorizonAccount => ({
    id: PAYER,
    account_id: PAYER,
    sequence: '1',
    subentry_count: 1,
    thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
    signers: [{ key: PAYER, weight: 1, type: 'ed25519_public_key' }],
    balances: [
      ...(balance === null
        ? []
        : [
            {
              balance,
              asset_type: 'credit_alphanum4' as const,
              asset_code: 'USDC',
              asset_issuer: USDC_ISSUER,
            },
          ]),
      { balance: '2.0000000', asset_type: 'native' as const },
    ],
  });

  const build = async (
    config: StellarConfig = STELLAR_CONFIG,
  ): Promise<RequestDemoFundsUseCase> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestDemoFundsUseCase,
        GetPublicWaterChargeUseCase,
        { provide: WATER_CHARGE_REPOSITORY, useValue: chargeRepository },
        { provide: STELLAR_GATEWAY, useValue: gateway },
        { provide: stellarConfig.KEY, useValue: config },
      ],
    }).compile();
    return module.get(RequestDemoFundsUseCase);
  };

  beforeEach(() => {
    chargeRepository = createMockWaterChargeRepository();
    gateway = createMockStellarGateway();

    chargeRepository.findByPublicCode.mockResolvedValue(createChargeView());
    chargeRepository.reserveFaucetDrip.mockResolvedValue(true);
    gateway.getAccount.mockResolvedValue(wallet('0.0000000'));
    gateway.sendFromOps.mockResolvedValue({ txHash: 'faucet-hash' });
  });

  it('sends the whole amount to an empty wallet', async () => {
    const useCase = await build();

    await expect(useCase.execute(PUBLIC_CODE, PAYER)).resolves.toEqual({
      txHash: 'faucet-hash',
      amount: '22.2800000',
    });
    expect(gateway.getAccount).toHaveBeenCalledWith(PAYER);
    expect(chargeRepository.reserveFaucetDrip).toHaveBeenCalledWith(
      CHARGE_ID,
      2,
    );
    expect(gateway.sendFromOps).toHaveBeenCalledWith({
      destination: PAYER,
      amount: '22.2800000',
      memo: 'AQT-DEMO',
    });
  });

  it('sends only what the wallet is short of', async () => {
    const useCase = await build();
    gateway.getAccount.mockResolvedValue(wallet('20.0000000'));

    await expect(useCase.execute(PUBLIC_CODE, PAYER)).resolves.toEqual({
      txHash: 'faucet-hash',
      amount: '2.2800000',
    });
  });

  it('sends nothing and uses no attempt when the wallet already has enough', async () => {
    const useCase = await build();
    gateway.getAccount.mockResolvedValue(wallet('22.2800000'));

    await expect(useCase.execute(PUBLIC_CODE, PAYER)).resolves.toEqual({
      txHash: null,
      amount: '0.0000000',
    });
    expect(chargeRepository.reserveFaucetDrip).not.toHaveBeenCalled();
    expect(gateway.sendFromOps).not.toHaveBeenCalled();
  });

  it('answers 404 when the demo faucet is off', async () => {
    const useCase = await build({
      ...STELLAR_CONFIG,
      demoFaucetEnabled: false,
    });

    await expect(useCase.execute(PUBLIC_CODE, PAYER)).rejects.toThrow(
      NotFoundException,
    );
    expect(chargeRepository.findByPublicCode).not.toHaveBeenCalled();
    expect(gateway.sendFromOps).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown code', async () => {
    const useCase = await build();
    chargeRepository.findByPublicCode.mockResolvedValue(null);

    await expect(useCase.execute(PUBLIC_CODE, PAYER)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('answers 409 when the charge is no longer pending', async () => {
    const useCase = await build();
    chargeRepository.findByPublicCode.mockResolvedValue(
      createChargeView({ status: 'paid', txHash: 'paid-hash' }),
    );

    await expect(useCase.execute(PUBLIC_CODE, PAYER)).rejects.toThrow(
      ConflictException,
    );
    expect(gateway.getAccount).not.toHaveBeenCalled();
  });

  it.each([
    ['does not exist yet', null],
    ['has no trustline for the asset', wallet(null)],
  ])('answers 400 when the wallet %s', async (_, account) => {
    const useCase = await build();
    gateway.getAccount.mockResolvedValue(account);

    await expect(useCase.execute(PUBLIC_CODE, PAYER)).rejects.toThrow(
      new BadRequestException(
        'Log in first so your wallet is created, then ask for test funds',
      ),
    );
    expect(chargeRepository.reserveFaucetDrip).not.toHaveBeenCalled();
    expect(gateway.sendFromOps).not.toHaveBeenCalled();
  });

  it('answers 409 when the charge already used its two sends', async () => {
    const useCase = await build();
    chargeRepository.reserveFaucetDrip.mockResolvedValue(false);

    await expect(useCase.execute(PUBLIC_CODE, PAYER)).rejects.toThrow(
      new ConflictException('This charge already used its test funds'),
    );
    expect(gateway.sendFromOps).not.toHaveBeenCalled();
  });

  it('gives the attempt back when the transfer does not go out', async () => {
    const useCase = await build();
    gateway.sendFromOps.mockRejectedValue(
      new StellarSubmitError('op_underfunded'),
    );

    await expect(useCase.execute(PUBLIC_CODE, PAYER)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(chargeRepository.releaseFaucetDrip).toHaveBeenCalledWith(CHARGE_ID);
  });

  it('says the faucet is empty when the operations account cannot cover the send', async () => {
    const useCase = await build();
    gateway.sendFromOps.mockRejectedValue(
      new StellarSubmitError('Stellar rejected the transaction', {
        transaction: 'tx_failed',
        operations: ['op_underfunded'],
      }),
    );

    await expect(useCase.execute(PUBLIC_CODE, PAYER)).rejects.toThrow(
      new ServiceUnavailableException(
        'The demo faucet is out of test funds. Try again later.',
      ),
    );
    expect(chargeRepository.releaseFaucetDrip).toHaveBeenCalledWith(CHARGE_ID);
  });

  it('keeps the generic answer for any other refusal', async () => {
    const useCase = await build();
    gateway.sendFromOps.mockRejectedValue(
      new StellarSubmitError('Stellar rejected the transaction', {
        transaction: 'tx_failed',
        operations: ['op_no_trust'],
      }),
    );

    await expect(useCase.execute(PUBLIC_CODE, PAYER)).rejects.toThrow(
      new ServiceUnavailableException(
        'Stellar rejected the transaction. Try again in a moment.',
      ),
    );
  });

  it('answers 503 when the wallet cannot be read', async () => {
    const useCase = await build();
    gateway.getAccount.mockRejectedValue(
      new StellarGatewayError('Could not reach Horizon'),
    );

    await expect(useCase.execute(PUBLIC_CODE, PAYER)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(chargeRepository.reserveFaucetDrip).not.toHaveBeenCalled();
  });
});
