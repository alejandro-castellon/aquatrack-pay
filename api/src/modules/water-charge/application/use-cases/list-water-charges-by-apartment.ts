import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  APARTMENT_REPOSITORY,
  ApartmentRepositoryInterface,
} from '@modules/apartment/domain/apartment.repository.interface';
import {
  BUILDING_REPOSITORY,
  BuildingRepositoryInterface,
} from '@modules/building/domain/building.repository.interface';
import { UserRole } from '@modules/user/domain/user.entity';
import {
  ensureApartmentAccess,
  ensureBuildingAccess,
} from '@/shared/utils/ownership';
import {
  WATER_CHARGE_REPOSITORY,
  WaterChargeRepositoryInterface,
} from '@modules/water-charge/domain/water-charge.repository.interface';
import { WaterChargeView } from '@modules/water-charge/domain/water-charge.entity';

@Injectable()
export class ListWaterChargesByApartmentUseCase {
  constructor(
    @Inject(APARTMENT_REPOSITORY)
    private readonly apartmentRepository: ApartmentRepositoryInterface,
    @Inject(BUILDING_REPOSITORY)
    private readonly buildingRepository: BuildingRepositoryInterface,
    @Inject(WATER_CHARGE_REPOSITORY)
    private readonly waterChargeRepository: WaterChargeRepositoryInterface,
  ) {}

  async execute(
    apartmentId: string,
    callerRole: UserRole,
    callerId: string,
  ): Promise<WaterChargeView[]> {
    const apartment = await this.apartmentRepository.findById(apartmentId);
    if (!apartment) {
      throw new NotFoundException('Apartment not found');
    }

    // Owner and tenant: only their own apartment.
    ensureApartmentAccess(
      apartment,
      callerRole,
      callerId,
      'You can only view the charges of your own apartment',
    );

    // ensureApartmentAccess does nothing for admins: check the building too.
    if (callerRole === UserRole.ADMIN) {
      const building = await this.buildingRepository.findById(
        apartment.buildingId,
      );
      ensureBuildingAccess(
        building,
        callerRole,
        callerId,
        'You can only view the charges of apartments in your own buildings',
      );
    }

    return this.waterChargeRepository.findByApartmentId(apartmentId);
  }
}
