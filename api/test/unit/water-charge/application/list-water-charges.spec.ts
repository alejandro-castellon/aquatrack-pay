import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ListWaterChargesByBuildingUseCase } from '@/modules/water-charge/application/use-cases/list-water-charges-by-building';
import { ListWaterChargesByApartmentUseCase } from '@/modules/water-charge/application/use-cases/list-water-charges-by-apartment';
import { WATER_CHARGE_REPOSITORY } from '@/modules/water-charge/domain/water-charge.repository.interface';
import { BUILDING_REPOSITORY } from '@/modules/building/domain/building.repository.interface';
import { APARTMENT_REPOSITORY } from '@/modules/apartment/domain/apartment.repository.interface';
import { UserRole } from '@/modules/user/domain/user.entity';
import { BuildingFixtures } from '../../building/__fixtures__/building.fixtures';
import { createMockBuildingRepository } from '../../building/__fixtures__/mock-types';
import { ApartmentFixtures } from '../../apartment/__fixtures__/apartment.fixtures';
import { createMockApartmentRepository } from '../../apartment/__fixtures__/mock-types';
import {
  ADMIN_ID,
  APARTMENT_ID,
  BUILDING_ID,
  createChargeView,
  createMockWaterChargeRepository,
} from '../__fixtures__/mock-types';

describe('listing water charges', () => {
  const OWNER_ID = 'owner-1';
  const TENANT_ID = 'tenant-1';

  let buildingRepository: ReturnType<typeof createMockBuildingRepository>;
  let apartmentRepository: ReturnType<typeof createMockApartmentRepository>;
  let chargeRepository: ReturnType<typeof createMockWaterChargeRepository>;
  let byBuilding: ListWaterChargesByBuildingUseCase;
  let byApartment: ListWaterChargesByApartmentUseCase;

  beforeEach(async () => {
    buildingRepository = createMockBuildingRepository();
    apartmentRepository = createMockApartmentRepository();
    chargeRepository = createMockWaterChargeRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ListWaterChargesByBuildingUseCase,
        ListWaterChargesByApartmentUseCase,
        { provide: BUILDING_REPOSITORY, useValue: buildingRepository },
        { provide: APARTMENT_REPOSITORY, useValue: apartmentRepository },
        { provide: WATER_CHARGE_REPOSITORY, useValue: chargeRepository },
      ],
    }).compile();

    byBuilding = module.get(ListWaterChargesByBuildingUseCase);
    byApartment = module.get(ListWaterChargesByApartmentUseCase);

    buildingRepository.findById.mockResolvedValue(
      BuildingFixtures.createBuilding({
        id: BUILDING_ID,
        adminIds: [ADMIN_ID],
      }),
    );
    apartmentRepository.findById.mockResolvedValue(
      ApartmentFixtures.createApartment({
        id: APARTMENT_ID,
        buildingId: BUILDING_ID,
        ownerId: OWNER_ID,
        tenantId: TENANT_ID,
      }),
    );
  });

  describe('ListWaterChargesByBuildingUseCase', () => {
    it('returns the charges of the month for an admin of the building', async () => {
      const charges = [createChargeView()];
      chargeRepository.findByBuildingIdAndMonth.mockResolvedValue(charges);

      await expect(
        byBuilding.execute(BUILDING_ID, '2026-10', UserRole.ADMIN, ADMIN_ID),
      ).resolves.toBe(charges);
      expect(chargeRepository.findByBuildingIdAndMonth).toHaveBeenCalledWith(
        BUILDING_ID,
        '2026-10',
      );
    });

    it('lets a super admin list any building', async () => {
      chargeRepository.findByBuildingIdAndMonth.mockResolvedValue([]);

      await expect(
        byBuilding.execute(
          BUILDING_ID,
          '2026-10',
          UserRole.SUPER_ADMIN,
          'super-admin',
        ),
      ).resolves.toEqual([]);
    });

    it('throws NotFoundException when the building does not exist', async () => {
      buildingRepository.findById.mockResolvedValue(null);

      await expect(
        byBuilding.execute(BUILDING_ID, '2026-10', UserRole.ADMIN, ADMIN_ID),
      ).rejects.toThrow(NotFoundException);
      expect(chargeRepository.findByBuildingIdAndMonth).not.toHaveBeenCalled();
    });

    it('forbids an admin who does not administer the building', async () => {
      await expect(
        byBuilding.execute(BUILDING_ID, '2026-10', UserRole.ADMIN, 'other'),
      ).rejects.toThrow(ForbiddenException);
      expect(chargeRepository.findByBuildingIdAndMonth).not.toHaveBeenCalled();
    });
  });

  describe('ListWaterChargesByApartmentUseCase', () => {
    it.each([
      ['its owner', UserRole.OWNER, OWNER_ID],
      ['its tenant', UserRole.TENANT, TENANT_ID],
      ['an admin of its building', UserRole.ADMIN, ADMIN_ID],
      ['a super admin', UserRole.SUPER_ADMIN, 'super-admin'],
    ])('returns the charges of the apartment for %s', async (_, role, id) => {
      const charges = [createChargeView()];
      chargeRepository.findByApartmentId.mockResolvedValue(charges);

      await expect(byApartment.execute(APARTMENT_ID, role, id)).resolves.toBe(
        charges,
      );
      expect(chargeRepository.findByApartmentId).toHaveBeenCalledWith(
        APARTMENT_ID,
      );
    });

    it.each([
      ['the owner of another apartment', UserRole.OWNER, 'owner-2'],
      ['the tenant of another apartment', UserRole.TENANT, 'tenant-2'],
      ['an owner using the tenant id', UserRole.OWNER, TENANT_ID],
      ['an admin of another building', UserRole.ADMIN, 'other-admin'],
    ])('forbids %s', async (_, role, id) => {
      await expect(byApartment.execute(APARTMENT_ID, role, id)).rejects.toThrow(
        ForbiddenException,
      );
      expect(chargeRepository.findByApartmentId).not.toHaveBeenCalled();
    });

    it('does not load the building for residents', async () => {
      chargeRepository.findByApartmentId.mockResolvedValue([]);

      await byApartment.execute(APARTMENT_ID, UserRole.OWNER, OWNER_ID);

      expect(buildingRepository.findById).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the apartment does not exist', async () => {
      apartmentRepository.findById.mockResolvedValue(null);

      await expect(
        byApartment.execute(APARTMENT_ID, UserRole.ADMIN, ADMIN_ID),
      ).rejects.toThrow(NotFoundException);
      expect(chargeRepository.findByApartmentId).not.toHaveBeenCalled();
    });
  });
});
