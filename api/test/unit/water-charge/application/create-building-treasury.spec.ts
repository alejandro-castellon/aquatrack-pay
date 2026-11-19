import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CreateBuildingTreasuryUseCase } from '@/modules/water-charge/application/use-cases/create-building-treasury';
import { TreasuryViewService } from '@/modules/water-charge/application/services/treasury-view.service';
import { BUILDING_TREASURY_REPOSITORY } from '@/modules/water-charge/domain/building-treasury.repository.interface';
import { BuildingTreasuryEntity } from '@/modules/water-charge/domain/building-treasury.entity';
import { BUILDING_REPOSITORY } from '@/modules/building/domain/building.repository.interface';
import { UserRole } from '@/modules/user/domain/user.entity';
import stellarConfig from '@/shared/stellar/stellar.config';
import {
  STELLAR_GATEWAY,
  StellarGatewayError,
  StellarInputError,
  StellarSubmitError,
} from '@/shared/stellar/stellar-gateway.interface';
import { BuildingFixtures } from '../../building/__fixtures__/building.fixtures';
import { createMockBuildingRepository } from '../../building/__fixtures__/mock-types';
import { TREASURY } from '../__fixtures__/horizon.fixtures';
import {
  ADMIN_ID,
  BUILDING_ID,
  SIGNER_A,
  SIGNER_B,
  SIGNER_C,
  STELLAR_CONFIG,
  createMockBuildingTreasuryRepository,
  createMockStellarGateway,
  createTreasury,
} from '../__fixtures__/mock-types';

describe('CreateBuildingTreasuryUseCase', () => {
  const input = {
    signers: [
      { publicKey: SIGNER_A, label: ' Administrador ' },
      { publicKey: SIGNER_B, label: 'Presidenta de la directiva' },
      { publicKey: SIGNER_C, label: 'Tesorero' },
    ],
    threshold: 2,
  };

  let useCase: CreateBuildingTreasuryUseCase;
  let buildingRepository: ReturnType<typeof createMockBuildingRepository>;
  let treasuryRepository: ReturnType<
    typeof createMockBuildingTreasuryRepository
  >;
  let gateway: ReturnType<typeof createMockStellarGateway>;
  let viewService: { build: jest.Mock };

  beforeEach(async () => {
    buildingRepository = createMockBuildingRepository();
    treasuryRepository = createMockBuildingTreasuryRepository();
    gateway = createMockStellarGateway();
    viewService = { build: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreateBuildingTreasuryUseCase,
        { provide: BUILDING_REPOSITORY, useValue: buildingRepository },
        { provide: BUILDING_TREASURY_REPOSITORY, useValue: treasuryRepository },
        { provide: STELLAR_GATEWAY, useValue: gateway },
        { provide: stellarConfig.KEY, useValue: STELLAR_CONFIG },
        { provide: TreasuryViewService, useValue: viewService },
      ],
    }).compile();

    useCase = module.get(CreateBuildingTreasuryUseCase);

    buildingRepository.findById.mockResolvedValue(
      BuildingFixtures.createBuilding({
        id: BUILDING_ID,
        adminIds: [ADMIN_ID],
      }),
    );
    treasuryRepository.findByBuildingId.mockResolvedValue(null);
    gateway.createTreasuryAccount.mockResolvedValue({
      publicKey: TREASURY,
      txHash: 'setup-hash',
    });
    treasuryRepository.create.mockImplementation(
      (treasury: BuildingTreasuryEntity) =>
        Promise.resolve({ status: 'created', treasury }),
    );
    viewService.build.mockImplementation((treasury: BuildingTreasuryEntity) =>
      Promise.resolve({ treasury, onChain: null, transfers: [] }),
    );
  });

  it('creates the account for the signers and saves the treasury', async () => {
    const view = await useCase.execute(
      BUILDING_ID,
      input,
      UserRole.ADMIN,
      ADMIN_ID,
    );

    expect(gateway.createTreasuryAccount).toHaveBeenCalledWith({
      signers: [SIGNER_A, SIGNER_B, SIGNER_C],
      threshold: 2,
    });

    const saved: BuildingTreasuryEntity =
      treasuryRepository.create.mock.calls[0][0];
    expect(saved.toPlainObject()).toEqual(
      expect.objectContaining({
        buildingId: BUILDING_ID,
        network: 'testnet',
        publicKey: TREASURY,
        assetCode: STELLAR_CONFIG.assetCode,
        assetIssuer: STELLAR_CONFIG.assetIssuer,
        threshold: 2,
        setupTxHash: 'setup-hash',
        lastCursor: null,
        createdById: ADMIN_ID,
      }),
    );
    expect(saved.signers[0]).toEqual({
      publicKey: SIGNER_A,
      label: 'Administrador',
    });
    expect(viewService.build).toHaveBeenCalledWith(saved);
    expect(view.treasury).toBe(saved);
  });

  it('lets a super admin create it for any building', async () => {
    await expect(
      useCase.execute(BUILDING_ID, input, UserRole.SUPER_ADMIN, 'super-admin'),
    ).resolves.toBeDefined();
  });

  it('throws NotFoundException when the building does not exist', async () => {
    buildingRepository.findById.mockResolvedValue(null);

    await expect(
      useCase.execute(BUILDING_ID, input, UserRole.ADMIN, ADMIN_ID),
    ).rejects.toThrow(NotFoundException);
    expect(gateway.createTreasuryAccount).not.toHaveBeenCalled();
  });

  it('forbids an admin who does not administer the building', async () => {
    await expect(
      useCase.execute(BUILDING_ID, input, UserRole.ADMIN, 'another-admin'),
    ).rejects.toThrow(ForbiddenException);
    expect(gateway.createTreasuryAccount).not.toHaveBeenCalled();
  });

  it('rejects a repeated signer before touching the network', async () => {
    const repeated = {
      signers: [input.signers[0], { ...input.signers[0], label: 'Otra vez' }],
      threshold: 1,
    };

    await expect(
      useCase.execute(BUILDING_ID, repeated, UserRole.ADMIN, ADMIN_ID),
    ).rejects.toThrow(
      new BadRequestException('Each signer can only appear once'),
    );
    expect(gateway.createTreasuryAccount).not.toHaveBeenCalled();
  });

  it('rejects a threshold above the number of signers', async () => {
    await expect(
      useCase.execute(
        BUILDING_ID,
        { ...input, threshold: 4 },
        UserRole.ADMIN,
        ADMIN_ID,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(gateway.createTreasuryAccount).not.toHaveBeenCalled();
  });

  it('answers 409 when the building already has a treasury', async () => {
    treasuryRepository.findByBuildingId.mockResolvedValue(createTreasury());

    await expect(
      useCase.execute(BUILDING_ID, input, UserRole.ADMIN, ADMIN_ID),
    ).rejects.toThrow(ConflictException);
    expect(gateway.createTreasuryAccount).not.toHaveBeenCalled();
  });

  it('answers 409 when a concurrent request saved a treasury first', async () => {
    treasuryRepository.create.mockResolvedValue({ status: 'already_exists' });

    await expect(
      useCase.execute(BUILDING_ID, input, UserRole.ADMIN, ADMIN_ID),
    ).rejects.toThrow(ConflictException);
    expect(viewService.build).not.toHaveBeenCalled();
  });

  it('turns a request the gateway refuses into a 400 with its reason', async () => {
    gateway.createTreasuryAccount.mockRejectedValue(
      new StellarInputError('Invalid Stellar account: GBAD'),
    );

    await expect(
      useCase.execute(BUILDING_ID, input, UserRole.ADMIN, ADMIN_ID),
    ).rejects.toThrow(new BadRequestException('Invalid Stellar account: GBAD'));
    expect(treasuryRepository.create).not.toHaveBeenCalled();
  });

  it.each([
    ['Horizon is unreachable', new StellarGatewayError('timeout')],
    ['the network rejects the setup', new StellarSubmitError('tx_failed')],
  ])('answers 503 when %s', async (_, error) => {
    gateway.createTreasuryAccount.mockRejectedValue(error);

    await expect(
      useCase.execute(BUILDING_ID, input, UserRole.ADMIN, ADMIN_ID),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(treasuryRepository.create).not.toHaveBeenCalled();
  });
});
