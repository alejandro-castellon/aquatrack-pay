import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import stellarConfig, { StellarConfig } from '@/shared/stellar/stellar.config';
import {
  STELLAR_GATEWAY,
  StellarGateway,
} from '@/shared/stellar/stellar-gateway.interface';
import {
  WATER_CHARGE_REPOSITORY,
  WaterChargeRepositoryInterface,
} from '@modules/water-charge/domain/water-charge.repository.interface';

/**
 * Hands the demo guide a pending charge to try a payment on (testnet only).
 * It only ever reveals a pay-link code, the same thing a resident receives.
 *
 * It prefers a charge the demo faucet can still fund: a visitor sent to a
 * receipt larger than the faucet's balance could not get the test funds to
 * pay it. When no pending charge fits, or the balance cannot be read, any
 * pending charge is handed out: it can still be paid from another wallet.
 */
@Injectable()
export class GetNextDemoChargeUseCase {
  private readonly logger = new Logger(GetNextDemoChargeUseCase.name);

  constructor(
    @Inject(WATER_CHARGE_REPOSITORY)
    private readonly waterChargeRepository: WaterChargeRepositoryInterface,
    @Inject(STELLAR_GATEWAY)
    private readonly stellarGateway: StellarGateway,
    @Inject(stellarConfig.KEY)
    private readonly config: StellarConfig,
  ) {}

  async execute(): Promise<string> {
    const code = this.config.demoFaucetEnabled
      ? await this.findPendingCode()
      : null;

    if (!code) {
      throw new NotFoundException('No pending charge available for the demo');
    }
    return code;
  }

  private async findPendingCode(): Promise<string | null> {
    const buildingId = this.config.demoBuildingId;
    const faucetBalance = await this.readFaucetBalance();

    if (faucetBalance) {
      const affordable =
        await this.waterChargeRepository.findRandomPendingPublicCode(
          buildingId,
          faucetBalance,
        );
      if (affordable) return affordable;
    }
    return this.waterChargeRepository.findRandomPendingPublicCode(buildingId);
  }

  /**
   * What the faucet holds of the payment asset. Null when it cannot be read:
   * the balance only steers the choice, it is never a reason to fail.
   */
  private async readFaucetBalance(): Promise<string | null> {
    try {
      const opsPublicKey = await this.stellarGateway.opsPublicKey();
      if (!opsPublicKey) return null;

      const account = await this.stellarGateway.getAccount(opsPublicKey);
      const holding = account?.balances.find(
        (balance) =>
          balance.asset_code === this.config.assetCode &&
          balance.asset_issuer === this.config.assetIssuer,
      );
      return holding?.balance ?? null;
    } catch (error) {
      this.logger.warn(
        `Could not read the demo faucet balance: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}
