import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  WATER_CHARGE_REPOSITORY,
  WaterChargeRepositoryInterface,
} from '@modules/water-charge/domain/water-charge.repository.interface';
import { WaterChargeView } from '@modules/water-charge/domain/water-charge.entity';
import { PUBLIC_CODE_PATTERN } from '@modules/water-charge/domain/services/charge-reference';

export const CHARGE_NOT_FOUND_MESSAGE = 'Charge not found';

/**
 * The charge behind a pay link. No caller: whoever holds the unguessable code
 * may see that one charge, and nothing else.
 */
@Injectable()
export class GetPublicWaterChargeUseCase {
  constructor(
    @Inject(WATER_CHARGE_REPOSITORY)
    private readonly waterChargeRepository: WaterChargeRepositoryInterface,
  ) {}

  async execute(publicCode: string): Promise<WaterChargeView> {
    // A malformed code never reaches the database and looks like an unknown one.
    if (!PUBLIC_CODE_PATTERN.test(publicCode)) {
      throw new NotFoundException(CHARGE_NOT_FOUND_MESSAGE);
    }

    const view = await this.waterChargeRepository.findByPublicCode(publicCode);
    if (!view) {
      throw new NotFoundException(CHARGE_NOT_FOUND_MESSAGE);
    }
    return view;
  }
}
