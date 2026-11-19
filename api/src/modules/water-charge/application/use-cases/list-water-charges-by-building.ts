import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  BUILDING_REPOSITORY,
  BuildingRepositoryInterface,
} from '@modules/building/domain/building.repository.interface';
import { UserRole } from '@modules/user/domain/user.entity';
import { ensureBuildingAccess } from '@/shared/utils/ownership';
import {
  WATER_CHARGE_REPOSITORY,
  WaterChargeRepositoryInterface,
} from '@modules/water-charge/domain/water-charge.repository.interface';
import { WaterChargeView } from '@modules/water-charge/domain/water-charge.entity';

@Injectable()
export class ListWaterChargesByBuildingUseCase {
  constructor(
    @Inject(BUILDING_REPOSITORY)
    private readonly buildingRepository: BuildingRepositoryInterface,
    @Inject(WATER_CHARGE_REPOSITORY)
    private readonly waterChargeRepository: WaterChargeRepositoryInterface,
  ) {}

  async execute(
    buildingId: string,
    month: string,
    callerRole: UserRole,
    callerId: string,
  ): Promise<WaterChargeView[]> {
    const building = await this.buildingRepository.findById(buildingId);
    if (!building) {
      throw new NotFoundException('Building not found');
    }

    ensureBuildingAccess(
      building,
      callerRole,
      callerId,
      'You can only view the charges of your own buildings',
    );

    return this.waterChargeRepository.findByBuildingIdAndMonth(
      buildingId,
      month,
    );
  }
}
