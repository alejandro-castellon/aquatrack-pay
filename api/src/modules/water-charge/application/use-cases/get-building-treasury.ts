import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  BUILDING_REPOSITORY,
  BuildingRepositoryInterface,
} from '@modules/building/domain/building.repository.interface';
import { UserRole } from '@modules/user/domain/user.entity';
import { ensureBuildingAccess } from '@/shared/utils/ownership';
import { StellarGatewayError } from '@/shared/stellar/stellar-gateway.interface';
import {
  BUILDING_TREASURY_REPOSITORY,
  BuildingTreasuryRepositoryInterface,
} from '@modules/water-charge/domain/building-treasury.repository.interface';
import {
  TreasuryView,
  TreasuryViewService,
} from '@modules/water-charge/application/services/treasury-view.service';
import { ReconcileTreasuryTransfersUseCase } from './reconcile-treasury-transfers';

@Injectable()
export class GetBuildingTreasuryUseCase {
  private readonly logger = new Logger(GetBuildingTreasuryUseCase.name);

  constructor(
    @Inject(BUILDING_REPOSITORY)
    private readonly buildingRepository: BuildingRepositoryInterface,
    @Inject(BUILDING_TREASURY_REPOSITORY)
    private readonly buildingTreasuryRepository: BuildingTreasuryRepositoryInterface,
    private readonly reconcileTreasuryTransfersUseCase: ReconcileTreasuryTransfersUseCase,
    private readonly treasuryViewService: TreasuryViewService,
  ) {}

  /** null when the building has no treasury yet. */
  async execute(
    buildingId: string,
    callerRole: UserRole,
    callerId: string,
  ): Promise<TreasuryView | null> {
    const building = await this.buildingRepository.findById(buildingId);
    if (!building) {
      throw new NotFoundException('Building not found');
    }

    ensureBuildingAccess(
      building,
      callerRole,
      callerId,
      'You can only view the treasury of your own buildings',
    );

    const treasury =
      await this.buildingTreasuryRepository.findByBuildingId(buildingId);
    if (!treasury) return null;

    // Opening the treasury settles whatever arrived since the last look, so
    // the view is right even while the background watcher is off.
    try {
      await this.reconcileTreasuryTransfersUseCase.reconcileTreasury(treasury);
    } catch (error) {
      if (!(error instanceof StellarGatewayError)) throw error;
      this.logger.warn(
        `Treasury ${treasury.publicKey} could not be reconciled: ${error.message}`,
      );
    }

    return this.treasuryViewService.build(treasury);
  }
}
