import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BUILDING_REPOSITORY,
  BuildingRepositoryInterface,
} from '@modules/building/domain/building.repository.interface';
import {
  APARTMENT_MONTHLY_CONSUMPTION_REPOSITORY,
  ApartmentMonthlyConsumptionRepositoryInterface,
} from '@modules/apartment-consumption/domain/apartment-consumption.repository.interface';
import { UserRole } from '@modules/user/domain/user.entity';
import { ensureBuildingAccess } from '@/shared/utils/ownership';
import stellarConfig, { StellarConfig } from '@/shared/stellar/stellar.config';
import {
  BUILDING_TREASURY_REPOSITORY,
  BuildingTreasuryRepositoryInterface,
} from '@modules/water-charge/domain/building-treasury.repository.interface';
import {
  WATER_CHARGE_REPOSITORY,
  WaterChargeRepositoryInterface,
} from '@modules/water-charge/domain/water-charge.repository.interface';
import {
  WaterChargeEntity,
  WaterChargeView,
} from '@modules/water-charge/domain/water-charge.entity';
import { convertBsToUsdc } from '@modules/water-charge/domain/services/charge-amount';
import {
  generateChargeMemo,
  generatePublicCode,
} from '@modules/water-charge/domain/services/charge-reference';

export interface PublishWaterChargesInput {
  buildingId: string;
  /** "YYYY-MM" of a saved prorrateo. */
  month: string;
  /** Bs per 1 USDC; falls back to the configured default. */
  bsPerUsdc?: number;
}

export interface PublishWaterChargesResult {
  /** Charges created by this call; 0 when the month was already published. */
  created: number;
  /** Every charge of the building for that month, old and new. */
  charges: WaterChargeView[];
}

/**
 * Turns the saved monthly amounts of a building into payable charges, one
 * per apartment that owes something. Publishing again only adds the missing
 * ones: an existing charge keeps its amount, rate, memo and link.
 */
@Injectable()
export class PublishWaterChargesUseCase {
  constructor(
    @Inject(BUILDING_REPOSITORY)
    private readonly buildingRepository: BuildingRepositoryInterface,
    @Inject(BUILDING_TREASURY_REPOSITORY)
    private readonly buildingTreasuryRepository: BuildingTreasuryRepositoryInterface,
    @Inject(APARTMENT_MONTHLY_CONSUMPTION_REPOSITORY)
    private readonly apartmentMonthlyConsumptionRepository: ApartmentMonthlyConsumptionRepositoryInterface,
    @Inject(WATER_CHARGE_REPOSITORY)
    private readonly waterChargeRepository: WaterChargeRepositoryInterface,
    @Inject(stellarConfig.KEY)
    private readonly config: StellarConfig,
  ) {}

  async execute(
    input: PublishWaterChargesInput,
    callerRole: UserRole,
    callerId: string,
  ): Promise<PublishWaterChargesResult> {
    const { buildingId, month } = input;

    const building = await this.buildingRepository.findById(buildingId);
    if (!building) {
      throw new NotFoundException('Building not found');
    }

    ensureBuildingAccess(
      building,
      callerRole,
      callerId,
      'You can only publish charges for your own buildings',
    );

    const treasury =
      await this.buildingTreasuryRepository.findByBuildingId(buildingId);
    if (!treasury) {
      throw new ConflictException(
        'Create the building treasury before publishing charges',
      );
    }

    const bsPerUsdc = input.bsPerUsdc ?? this.config.defaultBsPerUsdc;
    if (bsPerUsdc === null || bsPerUsdc === undefined) {
      throw new BadRequestException(
        'An exchange rate (Bs per USDC) is required to publish charges',
      );
    }

    const rows =
      await this.apartmentMonthlyConsumptionRepository.findByBuildingIdAndMonth(
        buildingId,
        month,
      );
    if (rows.length === 0) {
      throw new NotFoundException(
        'No monthly consumption saved for this building and month',
      );
    }

    const charges = rows
      .filter((row) => row.payment > 0)
      .map((row) => {
        const amount = this.convert(row.payment, bsPerUsdc);
        return WaterChargeEntity.create({
          apartmentMonthlyConsumptionId: row.id,
          apartmentId: row.apartmentId,
          buildingId,
          treasuryId: treasury.id,
          month,
          amountBs: row.payment,
          exchangeRate: bsPerUsdc,
          amountUsdc: amount,
          memo: generateChargeMemo(),
          publicCode: generatePublicCode(),
          createdById: callerId,
        });
      });

    const created =
      await this.waterChargeRepository.createManySkippingExisting(charges);

    return {
      created,
      charges: await this.waterChargeRepository.findByBuildingIdAndMonth(
        buildingId,
        month,
      ),
    };
  }

  private convert(amountBs: number, bsPerUsdc: number): string {
    try {
      return convertBsToUsdc(amountBs, bsPerUsdc).amountUsdc;
    } catch (error) {
      if (error instanceof RangeError) {
        throw new BadRequestException('The exchange rate is not valid');
      }
      throw error;
    }
  }
}
