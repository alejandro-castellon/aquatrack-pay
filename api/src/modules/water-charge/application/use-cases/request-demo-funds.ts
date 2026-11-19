import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import stellarConfig, { StellarConfig } from '@/shared/stellar/stellar.config';
import {
  STELLAR_GATEWAY,
  StellarGateway,
  StellarSubmitError,
} from '@/shared/stellar/stellar-gateway.interface';
import { HorizonAccount } from '@/shared/stellar/horizon.types';
import { fromStroops, toStroops } from '@/shared/stellar/stellar-amount';
import {
  WATER_CHARGE_REPOSITORY,
  WaterChargeRepositoryInterface,
} from '@modules/water-charge/domain/water-charge.repository.interface';
import { rethrowStellarError } from '@modules/water-charge/application/stellar-errors';
import { GetPublicWaterChargeUseCase } from './get-public-water-charge';

export interface DemoFundsResult {
  /** null when the payer already had enough and nothing was sent. */
  txHash: string | null;
  /** What was sent, 7 decimals. */
  amount: string;
}

/** Sends of test funds one charge may trigger. */
export const MAX_FAUCET_DRIPS_PER_CHARGE = 2;
export const DEMO_FAUCET_MEMO = 'AQT-DEMO';
export const DEMO_FAUCET_EMPTY_MESSAGE =
  'The demo faucet is out of test funds. Try again later.';
const NOTHING_SENT = '0.0000000';

/** The operations account does not hold what the transfer needs. */
function isUnderfunded(error: unknown): boolean {
  return (
    error instanceof StellarSubmitError &&
    (error.resultCodes?.operations ?? []).includes('op_underfunded')
  );
}

/**
 * Demo faucet (testnet only): gives the payer of a pending charge the test
 * funds they are short of, so a visitor without USDC can try a payment. It is
 * bounded by design: never more than the charge, twice per charge at most.
 */
@Injectable()
export class RequestDemoFundsUseCase {
  private readonly logger = new Logger(RequestDemoFundsUseCase.name);

  constructor(
    @Inject(WATER_CHARGE_REPOSITORY)
    private readonly waterChargeRepository: WaterChargeRepositoryInterface,
    @Inject(STELLAR_GATEWAY)
    private readonly stellarGateway: StellarGateway,
    @Inject(stellarConfig.KEY)
    private readonly config: StellarConfig,
    private readonly getPublicWaterChargeUseCase: GetPublicWaterChargeUseCase,
  ) {}

  async execute(
    publicCode: string,
    payerAddress: string,
  ): Promise<DemoFundsResult> {
    if (!this.config.demoFaucetEnabled) {
      throw new NotFoundException('Demo funds are not available');
    }

    const view = await this.getPublicWaterChargeUseCase.execute(publicCode);
    const { charge } = view;
    if (!charge.isPending) {
      throw new ConflictException('This charge is not pending');
    }

    let account: HorizonAccount | null;
    try {
      account = await this.stellarGateway.getAccount(payerAddress);
    } catch (error) {
      rethrowStellarError(error);
    }

    const holding = account?.balances.find(
      (balance) =>
        balance.asset_code === view.treasury.assetCode &&
        balance.asset_issuer === view.treasury.assetIssuer,
    );
    if (!holding) {
      // No account yet, or no trustline: the transfer would bounce.
      throw new BadRequestException(
        'Log in first so your wallet is created, then ask for test funds',
      );
    }

    const shortfall = charge.dueStroops - toStroops(holding.balance);
    if (shortfall <= 0n) {
      return { txHash: null, amount: NOTHING_SENT };
    }

    const reserved = await this.waterChargeRepository.reserveFaucetDrip(
      charge.id,
      MAX_FAUCET_DRIPS_PER_CHARGE,
    );
    if (!reserved) {
      throw new ConflictException('This charge already used its test funds');
    }

    const amount = fromStroops(shortfall);
    try {
      const { txHash } = await this.stellarGateway.sendFromOps({
        destination: payerAddress,
        amount,
        memo: DEMO_FAUCET_MEMO,
      });
      this.logger.log(
        `Demo faucet sent ${amount} ${view.treasury.assetCode} to ${payerAddress} in ${txHash}`,
      );
      return { txHash, amount };
    } catch (error) {
      // Nothing left the faucet: do not count this attempt against the charge.
      await this.waterChargeRepository.releaseFaucetDrip(charge.id);
      if (isUnderfunded(error)) {
        // Retrying does not help: the operations account needs a refill.
        this.logger.warn(
          `Demo faucet is out of funds: could not send ${amount} ${view.treasury.assetCode}`,
        );
        throw new ServiceUnavailableException(DEMO_FAUCET_EMPTY_MESSAGE);
      }
      rethrowStellarError(error);
    }
  }
}
