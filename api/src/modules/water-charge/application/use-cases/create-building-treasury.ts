import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BUILDING_REPOSITORY,
  BuildingRepositoryInterface,
} from '@modules/building/domain/building.repository.interface';
import { UserRole } from '@modules/user/domain/user.entity';
import { ensureBuildingAccess } from '@/shared/utils/ownership';
import stellarConfig, { StellarConfig } from '@/shared/stellar/stellar.config';
import {
  STELLAR_GATEWAY,
  StellarGateway,
} from '@/shared/stellar/stellar-gateway.interface';
import {
  BuildingTreasuryEntity,
  TreasurySigner,
} from '@modules/water-charge/domain/building-treasury.entity';
import {
  BUILDING_TREASURY_REPOSITORY,
  BuildingTreasuryRepositoryInterface,
} from '@modules/water-charge/domain/building-treasury.repository.interface';
import {
  TreasuryView,
  TreasuryViewService,
} from '@modules/water-charge/application/services/treasury-view.service';
import { rethrowStellarError } from '@modules/water-charge/application/stellar-errors';

export interface CreateBuildingTreasuryInput {
  signers: TreasurySigner[];
  threshold: number;
}

/**
 * Creates the building's treasury on Stellar: an account that holds the
 * charge asset and that only the given signers can move, `threshold` of them
 * together. The server pays for the setup and keeps no key of it.
 */
@Injectable()
export class CreateBuildingTreasuryUseCase {
  private readonly logger = new Logger(CreateBuildingTreasuryUseCase.name);

  constructor(
    @Inject(BUILDING_REPOSITORY)
    private readonly buildingRepository: BuildingRepositoryInterface,
    @Inject(BUILDING_TREASURY_REPOSITORY)
    private readonly buildingTreasuryRepository: BuildingTreasuryRepositoryInterface,
    @Inject(STELLAR_GATEWAY)
    private readonly stellarGateway: StellarGateway,
    @Inject(stellarConfig.KEY)
    private readonly config: StellarConfig,
    private readonly treasuryViewService: TreasuryViewService,
  ) {}

  async execute(
    buildingId: string,
    input: CreateBuildingTreasuryInput,
    callerRole: UserRole,
    callerId: string,
  ): Promise<TreasuryView> {
    const building = await this.buildingRepository.findById(buildingId);
    if (!building) {
      throw new NotFoundException('Building not found');
    }

    ensureBuildingAccess(
      building,
      callerRole,
      callerId,
      'You can only manage the treasury of your own buildings',
    );

    const publicKeys = input.signers.map((signer) => signer.publicKey);
    if (new Set(publicKeys).size !== publicKeys.length) {
      throw new BadRequestException('Each signer can only appear once');
    }
    if (input.threshold > publicKeys.length) {
      throw new BadRequestException(
        'The threshold cannot be greater than the number of signers',
      );
    }

    const existing =
      await this.buildingTreasuryRepository.findByBuildingId(buildingId);
    if (existing) {
      throw new ConflictException('This building already has a treasury');
    }

    let account: { publicKey: string; txHash: string };
    try {
      account = await this.stellarGateway.createTreasuryAccount({
        signers: publicKeys,
        threshold: input.threshold,
      });
    } catch (error) {
      rethrowStellarError(error);
    }

    const result = await this.buildingTreasuryRepository.create(
      BuildingTreasuryEntity.create({
        buildingId,
        network: this.config.network,
        publicKey: account.publicKey,
        assetCode: this.config.assetCode,
        assetIssuer: this.config.assetIssuer,
        signers: input.signers.map(({ publicKey, label }) => ({
          publicKey,
          label: label.trim(),
        })),
        threshold: input.threshold,
        setupTxHash: account.txHash,
        createdById: callerId,
      }),
    );

    if (result.status === 'already_exists') {
      // A concurrent request won. The account just created stays on the
      // network, unused and controlled only by the same signers.
      this.logger.warn(
        `Treasury ${account.publicKey} was created for building ${buildingId} but another one was saved first`,
      );
      throw new ConflictException('This building already has a treasury');
    }

    return this.treasuryViewService.build(result.treasury);
  }
}
