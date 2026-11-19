import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GetBuildingTreasuryUseCase } from '@/modules/water-charge/application/use-cases/get-building-treasury';
import { ReconcileTreasuryTransfersUseCase } from '@/modules/water-charge/application/use-cases/reconcile-treasury-transfers';
import { TreasuryViewService } from '@/modules/water-charge/application/services/treasury-view.service';
import { BUILDING_TREASURY_REPOSITORY } from '@/modules/water-charge/domain/building-treasury.repository.interface';
import { BUILDING_REPOSITORY } from '@/modules/building/domain/building.repository.interface';
import { UserRole } from '@/modules/user/domain/user.entity';
import { StellarGatewayError } from '@/shared/stellar/stellar-gateway.interface';
import { BuildingFixtures } from '../../building/__fixtures__/building.fixtures';
import { createMockBuildingRepository } from '../../building/__fixtures__/mock-types';
import {
  ADMIN_ID,
  BUILDING_ID,
  createMockBuildingTreasuryRepository,
  createTreasury,
} from '../__fixtures__/mock-types';

describe('GetBuildingTreasuryUseCase', () => {
  let useCase: GetBuildingTreasuryUseCase;
  let buildingRepository: ReturnType<typeof createMockBuildingRepository>;
  let treasuryRepository: ReturnType<
    typeof createMockBuildingTreasuryRepository
  >;
  let reconcile: { reconcileTreasury: jest.Mock };
  let viewService: { build: jest.Mock };

  beforeEach(async () => {
    buildingRepository = createMockBuildingRepository();
    treasuryRepository = createMockBuildingTreasuryRepository();
    reconcile = { reconcileTreasury: jest.fn().mockResolvedValue(0) };
    viewService = { build: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetBuildingTreasuryUseCase,
        { provide: BUILDING_REPOSITORY, useValue: buildingRepository },
        { provide: BUILDING_TREASURY_REPOSITORY, useValue: treasuryRepository },
        { provide: ReconcileTreasuryTransfersUseCase, useValue: reconcile },
        { provide: TreasuryViewService, useValue: viewService },
      ],
    }).compile();

    useCase = module.get(GetBuildingTreasuryUseCase);

    buildingRepository.findById.mockResolvedValue(
      BuildingFixtures.createBuilding({
        id: BUILDING_ID,
        adminIds: [ADMIN_ID],
      }),
    );
  });

  it('returns null while the building has no treasury', async () => {
    treasuryRepository.findByBuildingId.mockResolvedValue(null);

    await expect(
      useCase.execute(BUILDING_ID, UserRole.ADMIN, ADMIN_ID),
    ).resolves.toBeNull();
    expect(reconcile.reconcileTreasury).not.toHaveBeenCalled();
    expect(viewService.build).not.toHaveBeenCalled();
  });

  it('settles what arrived, then reads the treasury', async () => {
    const treasury = createTreasury();
    const view = { treasury, onChain: null, transfers: [] };
    const order: string[] = [];
    treasuryRepository.findByBuildingId.mockResolvedValue(treasury);
    reconcile.reconcileTreasury.mockImplementation(() => {
      order.push('reconcile');
      return Promise.resolve(1);
    });
    viewService.build.mockImplementation(() => {
      order.push('view');
      return Promise.resolve(view);
    });

    await expect(
      useCase.execute(BUILDING_ID, UserRole.ADMIN, ADMIN_ID),
    ).resolves.toBe(view);
    expect(reconcile.reconcileTreasury).toHaveBeenCalledWith(treasury);
    expect(order).toEqual(['reconcile', 'view']);
  });

  it('still answers when Stellar cannot be reached to reconcile', async () => {
    const treasury = createTreasury();
    const view = { treasury, onChain: null, transfers: [] };
    treasuryRepository.findByBuildingId.mockResolvedValue(treasury);
    reconcile.reconcileTreasury.mockRejectedValue(
      new StellarGatewayError('Could not reach Horizon'),
    );
    viewService.build.mockResolvedValue(view);

    await expect(
      useCase.execute(BUILDING_ID, UserRole.ADMIN, ADMIN_ID),
    ).resolves.toBe(view);
  });

  it('does not hide errors that are not about Stellar', async () => {
    treasuryRepository.findByBuildingId.mockResolvedValue(createTreasury());
    reconcile.reconcileTreasury.mockRejectedValue(new Error('database down'));

    await expect(
      useCase.execute(BUILDING_ID, UserRole.ADMIN, ADMIN_ID),
    ).rejects.toThrow('database down');
  });

  it('throws NotFoundException when the building does not exist', async () => {
    buildingRepository.findById.mockResolvedValue(null);

    await expect(
      useCase.execute(BUILDING_ID, UserRole.ADMIN, ADMIN_ID),
    ).rejects.toThrow(NotFoundException);
    expect(treasuryRepository.findByBuildingId).not.toHaveBeenCalled();
  });

  it('forbids an admin who does not administer the building', async () => {
    await expect(
      useCase.execute(BUILDING_ID, UserRole.ADMIN, 'another-admin'),
    ).rejects.toThrow(ForbiddenException);
    expect(treasuryRepository.findByBuildingId).not.toHaveBeenCalled();
  });
});
