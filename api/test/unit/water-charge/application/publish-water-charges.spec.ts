import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PublishWaterChargesUseCase } from '@/modules/water-charge/application/use-cases/publish-water-charges';
import { WATER_CHARGE_REPOSITORY } from '@/modules/water-charge/domain/water-charge.repository.interface';
import { BUILDING_TREASURY_REPOSITORY } from '@/modules/water-charge/domain/building-treasury.repository.interface';
import { WaterChargeEntity } from '@/modules/water-charge/domain/water-charge.entity';
import {
  CHARGE_MEMO_PATTERN,
  PUBLIC_CODE_PATTERN,
} from '@/modules/water-charge/domain/services/charge-reference';
import { BUILDING_REPOSITORY } from '@/modules/building/domain/building.repository.interface';
import { APARTMENT_MONTHLY_CONSUMPTION_REPOSITORY } from '@/modules/apartment-consumption/domain/apartment-consumption.repository.interface';
import { UserRole } from '@/modules/user/domain/user.entity';
import stellarConfig, { StellarConfig } from '@/shared/stellar/stellar.config';
import { BuildingFixtures } from '../../building/__fixtures__/building.fixtures';
import { createMockBuildingRepository } from '../../building/__fixtures__/mock-types';
import { createMockApartmentMonthlyConsumptionRepository } from '../../apartment-consumption/__fixtures__/mock-types';
import {
  ADMIN_ID,
  BUILDING_ID,
  STELLAR_CONFIG,
  TREASURY_ID,
  createChargeView,
  createMockBuildingTreasuryRepository,
  createMockWaterChargeRepository,
  createTreasury,
} from '../__fixtures__/mock-types';

describe('PublishWaterChargesUseCase', () => {
  const MONTH = '2026-10';
  const monthlyRow = (
    id: string,
    apartmentId: string,
    payment: number,
    apartmentNumber: string,
  ) => ({
    id,
    apartmentId,
    month: MONTH,
    payment,
    consumption: payment / 2,
    avgDailyUsage: 1,
    peakDayUsage: 2,
    periodStartDate: null,
    periodEndDate: null,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    updatedAt: new Date('2026-11-01T00:00:00.000Z'),
    apartmentNumber,
    apartmentFloor: 1,
  });

  let buildingRepository: ReturnType<typeof createMockBuildingRepository>;
  let treasuryRepository: ReturnType<
    typeof createMockBuildingTreasuryRepository
  >;
  let monthlyRepository: ReturnType<
    typeof createMockApartmentMonthlyConsumptionRepository
  >;
  let chargeRepository: ReturnType<typeof createMockWaterChargeRepository>;

  const build = async (
    config: StellarConfig = STELLAR_CONFIG,
  ): Promise<PublishWaterChargesUseCase> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublishWaterChargesUseCase,
        { provide: BUILDING_REPOSITORY, useValue: buildingRepository },
        { provide: BUILDING_TREASURY_REPOSITORY, useValue: treasuryRepository },
        {
          provide: APARTMENT_MONTHLY_CONSUMPTION_REPOSITORY,
          useValue: monthlyRepository,
        },
        { provide: WATER_CHARGE_REPOSITORY, useValue: chargeRepository },
        { provide: stellarConfig.KEY, useValue: config },
      ],
    }).compile();
    return module.get(PublishWaterChargesUseCase);
  };

  beforeEach(() => {
    buildingRepository = createMockBuildingRepository();
    treasuryRepository = createMockBuildingTreasuryRepository();
    monthlyRepository = createMockApartmentMonthlyConsumptionRepository();
    chargeRepository = createMockWaterChargeRepository();

    buildingRepository.findById.mockResolvedValue(
      BuildingFixtures.createBuilding({
        id: BUILDING_ID,
        adminIds: [ADMIN_ID],
      }),
    );
    treasuryRepository.findByBuildingId.mockResolvedValue(createTreasury());
    monthlyRepository.findByBuildingIdAndMonth.mockResolvedValue([
      monthlyRow('row-101', 'apt-101', 155, '101'),
      monthlyRow('row-102', 'apt-102', 111.6, '102'),
      monthlyRow('row-103', 'apt-103', 0, '103'),
    ]);
    chargeRepository.createManySkippingExisting.mockImplementation(
      (charges: WaterChargeEntity[]) => Promise.resolve(charges.length),
    );
    chargeRepository.findByBuildingIdAndMonth.mockResolvedValue([
      createChargeView(),
    ]);
  });

  it('creates one charge per apartment that owes something', async () => {
    const useCase = await build();

    const result = await useCase.execute(
      { buildingId: BUILDING_ID, month: MONTH, bsPerUsdc: 6.96 },
      UserRole.ADMIN,
      ADMIN_ID,
    );

    expect(monthlyRepository.findByBuildingIdAndMonth).toHaveBeenCalledWith(
      BUILDING_ID,
      MONTH,
    );
    const charges: WaterChargeEntity[] =
      chargeRepository.createManySkippingExisting.mock.calls[0][0];
    expect(charges.map((charge) => charge.toPlainObject())).toEqual([
      expect.objectContaining({
        apartmentMonthlyConsumptionId: 'row-101',
        apartmentId: 'apt-101',
        buildingId: BUILDING_ID,
        treasuryId: TREASURY_ID,
        month: MONTH,
        amountBs: 155,
        exchangeRate: 6.96,
        amountUsdc: '22.2800000',
        status: 'pending',
        txHash: null,
        createdById: ADMIN_ID,
      }),
      expect.objectContaining({
        apartmentMonthlyConsumptionId: 'row-102',
        apartmentId: 'apt-102',
        amountBs: 111.6,
        amountUsdc: '16.0400000',
      }),
    ]);

    expect(result.created).toBe(2);
    expect(chargeRepository.findByBuildingIdAndMonth).toHaveBeenCalledWith(
      BUILDING_ID,
      MONTH,
    );
    expect(result.charges).toHaveLength(1);
  });

  it('gives every charge its own memo and its own pay-link code', async () => {
    const useCase = await build();

    await useCase.execute(
      { buildingId: BUILDING_ID, month: MONTH, bsPerUsdc: 6.96 },
      UserRole.ADMIN,
      ADMIN_ID,
    );

    const [first, second]: WaterChargeEntity[] =
      chargeRepository.createManySkippingExisting.mock.calls[0][0];
    expect(first.memo).toMatch(CHARGE_MEMO_PATTERN);
    expect(first.publicCode).toMatch(PUBLIC_CODE_PATTERN);
    expect(first.memo).not.toBe(second.memo);
    expect(first.publicCode).not.toBe(second.publicCode);
    // The memo ends up public on the ledger: it must not open the pay page.
    expect(first.publicCode.toUpperCase()).not.toContain(first.memo.slice(4));
  });

  it('reports 0 created when the month was already published', async () => {
    const useCase = await build();
    chargeRepository.createManySkippingExisting.mockResolvedValue(0);

    const result = await useCase.execute(
      { buildingId: BUILDING_ID, month: MONTH, bsPerUsdc: 6.96 },
      UserRole.ADMIN,
      ADMIN_ID,
    );

    expect(result.created).toBe(0);
    expect(result.charges).toHaveLength(1);
  });

  it('uses the configured reference rate when none is given', async () => {
    const useCase = await build({ ...STELLAR_CONFIG, defaultBsPerUsdc: 11.84 });

    await useCase.execute(
      { buildingId: BUILDING_ID, month: MONTH },
      UserRole.ADMIN,
      ADMIN_ID,
    );

    const [first]: WaterChargeEntity[] =
      chargeRepository.createManySkippingExisting.mock.calls[0][0];
    expect(first.exchangeRate).toBe(11.84);
    expect(first.amountUsdc).toBe('13.1000000');
  });

  it('prefers the rate of the request over the configured one', async () => {
    const useCase = await build({ ...STELLAR_CONFIG, defaultBsPerUsdc: 11.84 });

    await useCase.execute(
      { buildingId: BUILDING_ID, month: MONTH, bsPerUsdc: 6.96 },
      UserRole.ADMIN,
      ADMIN_ID,
    );

    const [first]: WaterChargeEntity[] =
      chargeRepository.createManySkippingExisting.mock.calls[0][0];
    expect(first.exchangeRate).toBe(6.96);
  });

  it('answers 400 when no rate is given nor configured', async () => {
    const useCase = await build();

    await expect(
      useCase.execute(
        { buildingId: BUILDING_ID, month: MONTH },
        UserRole.ADMIN,
        ADMIN_ID,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(chargeRepository.createManySkippingExisting).not.toHaveBeenCalled();
  });

  it('answers 400 for a rate that cannot convert anything', async () => {
    const useCase = await build();

    await expect(
      useCase.execute(
        { buildingId: BUILDING_ID, month: MONTH, bsPerUsdc: 0 },
        UserRole.ADMIN,
        ADMIN_ID,
      ),
    ).rejects.toThrow(
      new BadRequestException('The exchange rate is not valid'),
    );
    expect(chargeRepository.createManySkippingExisting).not.toHaveBeenCalled();
  });

  it('answers 409 while the building has no treasury', async () => {
    const useCase = await build();
    treasuryRepository.findByBuildingId.mockResolvedValue(null);

    await expect(
      useCase.execute(
        { buildingId: BUILDING_ID, month: MONTH, bsPerUsdc: 6.96 },
        UserRole.ADMIN,
        ADMIN_ID,
      ),
    ).rejects.toThrow(ConflictException);
    expect(monthlyRepository.findByBuildingIdAndMonth).not.toHaveBeenCalled();
  });

  it('answers 404 when the month has no saved consumption', async () => {
    const useCase = await build();
    monthlyRepository.findByBuildingIdAndMonth.mockResolvedValue([]);

    await expect(
      useCase.execute(
        { buildingId: BUILDING_ID, month: MONTH, bsPerUsdc: 6.96 },
        UserRole.ADMIN,
        ADMIN_ID,
      ),
    ).rejects.toThrow(NotFoundException);
    expect(chargeRepository.createManySkippingExisting).not.toHaveBeenCalled();
  });

  it('publishes nothing new when nobody owes anything', async () => {
    const useCase = await build();
    monthlyRepository.findByBuildingIdAndMonth.mockResolvedValue([
      monthlyRow('row-103', 'apt-103', 0, '103'),
    ]);
    chargeRepository.findByBuildingIdAndMonth.mockResolvedValue([]);

    const result = await useCase.execute(
      { buildingId: BUILDING_ID, month: MONTH, bsPerUsdc: 6.96 },
      UserRole.ADMIN,
      ADMIN_ID,
    );

    expect(chargeRepository.createManySkippingExisting).toHaveBeenCalledWith(
      [],
    );
    expect(result).toEqual({ created: 0, charges: [] });
  });

  it('throws NotFoundException when the building does not exist', async () => {
    const useCase = await build();
    buildingRepository.findById.mockResolvedValue(null);

    await expect(
      useCase.execute(
        { buildingId: BUILDING_ID, month: MONTH, bsPerUsdc: 6.96 },
        UserRole.ADMIN,
        ADMIN_ID,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('forbids an admin who does not administer the building', async () => {
    const useCase = await build();

    await expect(
      useCase.execute(
        { buildingId: BUILDING_ID, month: MONTH, bsPerUsdc: 6.96 },
        UserRole.ADMIN,
        'another-admin',
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(treasuryRepository.findByBuildingId).not.toHaveBeenCalled();
  });

  it('lets a super admin publish for any building', async () => {
    const useCase = await build();

    await expect(
      useCase.execute(
        { buildingId: BUILDING_ID, month: MONTH, bsPerUsdc: 6.96 },
        UserRole.SUPER_ADMIN,
        'super-admin',
      ),
    ).resolves.toEqual(expect.objectContaining({ created: 2 }));
  });
});
