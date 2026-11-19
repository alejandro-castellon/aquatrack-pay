import { Test, TestingModule } from '@nestjs/testing';
import { BuildingTreasuryController } from '@/modules/water-charge/infrastructure/controllers/building-treasury.controller';
import { WaterChargeController } from '@/modules/water-charge/infrastructure/controllers/water-charge.controller';
import { WaterChargePublicController } from '@/modules/water-charge/infrastructure/controllers/water-charge-public.controller';
import { BuildingTreasuryResponseDto } from '@/modules/water-charge/infrastructure/controllers/dtos/building-treasury-response.dto';
import {
  PublishWaterChargesResponseDto,
  WaterChargeResponseDto,
} from '@/modules/water-charge/infrastructure/controllers/dtos/water-charge-response.dto';
import {
  ConfirmWaterChargeResponseDto,
  PublicWaterChargeResponseDto,
} from '@/modules/water-charge/infrastructure/controllers/dtos/public-water-charge-response.dto';
import { GetBuildingTreasuryUseCase } from '@/modules/water-charge/application/use-cases/get-building-treasury';
import { CreateBuildingTreasuryUseCase } from '@/modules/water-charge/application/use-cases/create-building-treasury';
import { PublishWaterChargesUseCase } from '@/modules/water-charge/application/use-cases/publish-water-charges';
import { ListWaterChargesByBuildingUseCase } from '@/modules/water-charge/application/use-cases/list-water-charges-by-building';
import { ListWaterChargesByApartmentUseCase } from '@/modules/water-charge/application/use-cases/list-water-charges-by-apartment';
import { GetPublicWaterChargeUseCase } from '@/modules/water-charge/application/use-cases/get-public-water-charge';
import { ConfirmWaterChargeTransferUseCase } from '@/modules/water-charge/application/use-cases/confirm-water-charge-transfer';
import { RequestDemoFundsUseCase } from '@/modules/water-charge/application/use-cases/request-demo-funds';
import { GetNextDemoChargeUseCase } from '@/modules/water-charge/application/use-cases/get-next-demo-charge';
import { JwtAuthGuard } from '@/modules/auth/infrastructure/guards/jwt-auth.guard';
import { RolesGuard } from '@/modules/auth/infrastructure/guards/roles.guard';
import { AuthRequest } from '@/modules/auth/domain/auth-request.interface';
import stellarConfig from '@/shared/stellar/stellar.config';
import {
  MEMO,
  PAYER,
  TREASURY,
  USDC_ISSUER,
} from '../../__fixtures__/horizon.fixtures';
import {
  APARTMENT_ID,
  BUILDING_ID,
  CHARGE_ID,
  PUBLIC_CODE,
  SIGNER_A,
  SIGNER_B,
  SIGNER_C,
  STELLAR_CONFIG,
  TX_HASH,
  createChargeView,
  createTreasury,
} from '../../__fixtures__/mock-types';

const EXPLORER = 'https://stellar.expert/explorer/testnet';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe('water-charge controllers', () => {
  const req = {
    user: { sub: 'admin-a', role: 'admin' },
  } as unknown as AuthRequest;
  const allow = { canActivate: jest.fn(() => true) };

  const useCase = () => ({ execute: jest.fn() });
  let getTreasury: ReturnType<typeof useCase>;
  let createTreasuryUseCase: ReturnType<typeof useCase>;
  let publish: ReturnType<typeof useCase>;
  let listByBuilding: ReturnType<typeof useCase>;
  let listByApartment: ReturnType<typeof useCase>;
  let getPublic: ReturnType<typeof useCase>;
  let confirm: ReturnType<typeof useCase>;
  let demoFunds: ReturnType<typeof useCase>;
  let nextDemo: ReturnType<typeof useCase>;

  let treasuryController: BuildingTreasuryController;
  let chargeController: WaterChargeController;
  let publicController: WaterChargePublicController;

  beforeEach(async () => {
    getTreasury = useCase();
    createTreasuryUseCase = useCase();
    publish = useCase();
    listByBuilding = useCase();
    listByApartment = useCase();
    getPublic = useCase();
    confirm = useCase();
    demoFunds = useCase();
    nextDemo = useCase();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [
        BuildingTreasuryController,
        WaterChargeController,
        WaterChargePublicController,
      ],
      providers: [
        { provide: GetBuildingTreasuryUseCase, useValue: getTreasury },
        {
          provide: CreateBuildingTreasuryUseCase,
          useValue: createTreasuryUseCase,
        },
        { provide: PublishWaterChargesUseCase, useValue: publish },
        {
          provide: ListWaterChargesByBuildingUseCase,
          useValue: listByBuilding,
        },
        {
          provide: ListWaterChargesByApartmentUseCase,
          useValue: listByApartment,
        },
        { provide: GetPublicWaterChargeUseCase, useValue: getPublic },
        { provide: ConfirmWaterChargeTransferUseCase, useValue: confirm },
        { provide: RequestDemoFundsUseCase, useValue: demoFunds },
        { provide: GetNextDemoChargeUseCase, useValue: nextDemo },
        { provide: stellarConfig.KEY, useValue: STELLAR_CONFIG },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(allow)
      .overrideGuard(RolesGuard)
      .useValue(allow)
      .compile();

    treasuryController = module.get(BuildingTreasuryController);
    chargeController = module.get(WaterChargeController);
    publicController = module.get(WaterChargePublicController);
  });

  describe('BuildingTreasuryController', () => {
    it('answers { treasury: null } while the building has none', async () => {
      getTreasury.execute.mockResolvedValue(null);

      const result = await treasuryController.find(BUILDING_ID, req);

      expect(getTreasury.execute).toHaveBeenCalledWith(
        BUILDING_ID,
        'admin',
        'admin-a',
      );
      expect(result).toBeInstanceOf(BuildingTreasuryResponseDto);
      expect(result).toEqual({ treasury: null });
    });

    it('returns the treasury with its explorer links', async () => {
      const treasury = createTreasury();
      getTreasury.execute.mockResolvedValue({
        treasury,
        onChain: {
          balance: '104.7300000',
          xlmBalance: '4.9990000',
          masterWeight: 0,
          thresholds: { low: 2, med: 2, high: 2 },
          signers: [{ publicKey: SIGNER_A, weight: 1 }],
        },
        transfers: [
          {
            txHash: TX_HASH,
            createdAt: new Date('2026-11-18T15:00:00.000Z'),
            payerAddress: PAYER,
            amountUsdc: '22.2800000',
            memo: MEMO,
            status: 'matched',
            apartmentNumber: '101',
            month: '2026-10',
          },
        ],
      });

      const result = await treasuryController.find(BUILDING_ID, req);

      expect(result.treasury).toEqual({
        publicKey: TREASURY,
        network: 'testnet',
        assetCode: 'USDC',
        assetIssuer: USDC_ISSUER,
        threshold: 2,
        signers: [
          { publicKey: SIGNER_A, label: 'Administrador' },
          { publicKey: SIGNER_B, label: 'Presidenta de la directiva' },
          { publicKey: SIGNER_C, label: 'Tesorero' },
        ],
        setupTxHash: 'setup-hash',
        createdAt: treasury.createdAt,
        explorerUrl: `${EXPLORER}/account/${TREASURY}`,
        onChain: {
          balance: '104.7300000',
          xlmBalance: '4.9990000',
          masterWeight: 0,
          thresholds: { low: 2, med: 2, high: 2 },
          signers: [{ publicKey: SIGNER_A, weight: 1 }],
        },
        transfers: [
          {
            txHash: TX_HASH,
            createdAt: new Date('2026-11-18T15:00:00.000Z'),
            payerAddress: PAYER,
            amountUsdc: '22.2800000',
            memo: MEMO,
            status: 'matched',
            apartmentNumber: '101',
            month: '2026-10',
            explorerUrl: `${EXPLORER}/tx/${TX_HASH}`,
          },
        ],
      });
      // Internal ids and the watcher cursor stay inside.
      expect(JSON.stringify(result)).not.toMatch(UUID);
      expect(result.treasury).not.toHaveProperty('lastCursor');
    });

    it('creates the treasury with the body and the caller context', async () => {
      createTreasuryUseCase.execute.mockResolvedValue({
        treasury: createTreasury(),
        onChain: null,
        transfers: [],
      });
      const dto = {
        signers: [
          { publicKey: SIGNER_A, label: 'Administrador' },
          { publicKey: SIGNER_B, label: 'Presidenta' },
        ],
        threshold: 2,
      };

      const result = await treasuryController.create(BUILDING_ID, dto, req);

      expect(createTreasuryUseCase.execute).toHaveBeenCalledWith(
        BUILDING_ID,
        dto,
        'admin',
        'admin-a',
      );
      expect(result.treasury?.publicKey).toBe(TREASURY);
      expect(result.treasury?.onChain).toBeNull();
      expect(result.treasury?.transfers).toEqual([]);
    });
  });

  describe('WaterChargeController', () => {
    it('publishes a month and returns how many charges it created', async () => {
      publish.execute.mockResolvedValue({
        created: 1,
        charges: [createChargeView()],
      });
      const dto = {
        buildingId: BUILDING_ID,
        month: '2026-10',
        bsPerUsdc: 6.96,
      };

      const result = await chargeController.publish(dto, req);

      expect(publish.execute).toHaveBeenCalledWith(dto, 'admin', 'admin-a');
      expect(result).toBeInstanceOf(PublishWaterChargesResponseDto);
      expect(result.created).toBe(1);
      expect(result.charges[0]).toBeInstanceOf(WaterChargeResponseDto);
    });

    it('lists the charges of a building as response DTOs', async () => {
      listByBuilding.execute.mockResolvedValue([createChargeView()]);

      const result = await chargeController.findByBuilding(
        BUILDING_ID,
        { month: '2026-10' },
        req,
      );

      expect(listByBuilding.execute).toHaveBeenCalledWith(
        BUILDING_ID,
        '2026-10',
        'admin',
        'admin-a',
      );
      expect(result).toEqual([
        {
          id: CHARGE_ID,
          apartmentId: APARTMENT_ID,
          apartmentNumber: '101',
          apartmentFloor: 1,
          buildingId: BUILDING_ID,
          month: '2026-10',
          consumption: 77.5,
          amountBs: 155,
          exchangeRate: 6.96,
          amountUsdc: '22.2800000',
          assetCode: 'USDC',
          status: 'pending',
          publicCode: PUBLIC_CODE,
          memo: MEMO,
          txHash: null,
          payerAddress: null,
          paidAmountUsdc: null,
          paidAt: null,
          explorerUrl: null,
          createdAt: new Date('2026-11-18T13:00:00.000Z'),
        },
      ]);
    });

    it('lists the charges of an apartment, with the paying transaction', async () => {
      const paidAt = new Date('2026-11-18T15:00:00.000Z');
      listByApartment.execute.mockResolvedValue([
        createChargeView({
          status: 'paid',
          txHash: TX_HASH,
          payerAddress: PAYER,
          paidAmountUsdc: '22.2800000',
          paidAt,
        }),
      ]);
      const resident = {
        user: { sub: 'owner-1', role: 'owner' },
      } as unknown as AuthRequest;

      const [charge] = await chargeController.findByApartment(
        APARTMENT_ID,
        resident,
      );

      expect(listByApartment.execute).toHaveBeenCalledWith(
        APARTMENT_ID,
        'owner',
        'owner-1',
      );
      expect(charge).toEqual(
        expect.objectContaining({
          status: 'paid',
          txHash: TX_HASH,
          payerAddress: PAYER,
          paidAmountUsdc: '22.2800000',
          paidAt,
          explorerUrl: `${EXPLORER}/tx/${TX_HASH}`,
        }),
      );
    });
  });

  describe('WaterChargePublicController', () => {
    it('shows what to pay and where, without any identifier', async () => {
      getPublic.execute.mockResolvedValue(createChargeView());

      const result = await publicController.find(PUBLIC_CODE);

      expect(getPublic.execute).toHaveBeenCalledWith(PUBLIC_CODE);
      expect(result).toBeInstanceOf(PublicWaterChargeResponseDto);
      expect(result).toEqual({
        buildingName: 'Edificio Central',
        apartmentNumber: '101',
        month: '2026-10',
        periodStartDate: '2026-10-01',
        periodEndDate: '2026-10-31',
        consumption: 77.5,
        amountBs: 155,
        exchangeRate: 6.96,
        amountUsdc: '22.2800000',
        status: 'pending',
        payment: {
          destination: TREASURY,
          assetCode: 'USDC',
          assetIssuer: USDC_ISSUER,
          memo: MEMO,
          network: 'testnet',
          networkPassphrase: 'Test SDF Network ; September 2015',
        },
        paid: null,
        demo: { faucetEnabled: true },
      });
      expect(JSON.stringify(result)).not.toMatch(UUID);
    });

    it('confirms a transaction and returns the outcome with the charge', async () => {
      const paidAt = new Date('2026-11-18T15:00:00.000Z');
      confirm.execute.mockResolvedValue({
        outcome: 'paid',
        charge: createChargeView({
          status: 'paid',
          txHash: TX_HASH,
          payerAddress: PAYER,
          paidAmountUsdc: '22.2800000',
          paidAt,
        }),
      });

      const result = await publicController.confirm(PUBLIC_CODE, {
        txHash: TX_HASH,
      });

      expect(confirm.execute).toHaveBeenCalledWith(PUBLIC_CODE, TX_HASH);
      expect(result).toBeInstanceOf(ConfirmWaterChargeResponseDto);
      expect(result.outcome).toBe('paid');
      expect(result.charge.status).toBe('paid');
      expect(result.charge.paid).toEqual({
        txHash: TX_HASH,
        paidAt,
        paidAmountUsdc: '22.2800000',
        payerAddress: PAYER,
        explorerUrl: `${EXPLORER}/tx/${TX_HASH}`,
      });
      expect(JSON.stringify(result)).not.toMatch(UUID);
    });

    it('asks for test funds for the paying wallet', async () => {
      demoFunds.execute.mockResolvedValue({
        txHash: 'faucet-hash',
        amount: '22.2800000',
      });

      await expect(
        publicController.demoFunds(PUBLIC_CODE, { payerAddress: PAYER }),
      ).resolves.toEqual({ txHash: 'faucet-hash', amount: '22.2800000' });
      expect(demoFunds.execute).toHaveBeenCalledWith(PUBLIC_CODE, PAYER);
    });

    it('hands out the code of a pending charge for the demo', async () => {
      nextDemo.execute.mockResolvedValue(PUBLIC_CODE);

      await expect(publicController.nextDemoCharge()).resolves.toEqual({
        code: PUBLIC_CODE,
      });
    });
  });
});
