import { Prisma } from '@prisma/client';
import { PrismaWaterChargeRepository } from '@/modules/water-charge/infrastructure/repositories/prisma-water-charge.repository';
import { PrismaBuildingTreasuryRepository } from '@/modules/water-charge/infrastructure/repositories/prisma-building-treasury.repository';
import { PrismaService } from '@/shared/database/prisma.service';
import {
  MEMO,
  TREASURY,
  USDC_ISSUER,
} from '../../__fixtures__/horizon.fixtures';
import {
  ADMIN_ID,
  APARTMENT_ID,
  BUILDING_ID,
  CHARGE_ID,
  MONTHLY_ROW_ID,
  PUBLIC_CODE,
  SIGNER_A,
  TREASURY_ID,
  TX_HASH,
  createCharge,
  createTreasury,
} from '../../__fixtures__/mock-types';

const knownError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('error', {
    code,
    clientVersion: 'test',
  });

describe('PrismaWaterChargeRepository', () => {
  let prisma: {
    waterCharge: {
      createMany: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
    };
  };
  let repository: PrismaWaterChargeRepository;

  /** A row as Prisma returns it with the repository's include. */
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: CHARGE_ID,
    apartmentMonthlyConsumptionId: MONTHLY_ROW_ID,
    apartmentId: APARTMENT_ID,
    buildingId: BUILDING_ID,
    treasuryId: TREASURY_ID,
    month: '2026-10',
    amountBs: new Prisma.Decimal('155'),
    exchangeRate: new Prisma.Decimal('6.96'),
    amountUsdc: new Prisma.Decimal('22.28'),
    memo: MEMO,
    publicCode: PUBLIC_CODE,
    status: 'pending',
    txHash: null,
    payerAddress: null,
    paidAmountUsdc: null,
    ledger: null,
    paidAt: null,
    faucetDrips: 0,
    createdById: ADMIN_ID,
    createdAt: new Date('2026-11-18T13:00:00.000Z'),
    updatedAt: new Date('2026-11-18T13:00:00.000Z'),
    apartment: { apartmentNumber: '101', floor: 1 },
    apartmentMonthlyConsumption: {
      consumption: new Prisma.Decimal('77.5'),
      periodStartDate: new Date('2026-10-01T00:00:00.000Z'),
      periodEndDate: null,
    },
    building: { name: 'Edificio Central' },
    treasury: {
      publicKey: TREASURY,
      network: 'testnet',
      assetCode: 'USDC',
      assetIssuer: USDC_ISSUER,
    },
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      waterCharge: {
        createMany: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn(),
      },
    };
    repository = new PrismaWaterChargeRepository(
      prisma as unknown as PrismaService,
    );
  });

  describe('createManySkippingExisting', () => {
    it('inserts with ON CONFLICT DO NOTHING and returns how many were new', async () => {
      prisma.waterCharge.createMany.mockResolvedValue({ count: 1 });
      const charge = createCharge();

      await expect(
        repository.createManySkippingExisting([charge]),
      ).resolves.toBe(1);

      expect(prisma.waterCharge.createMany).toHaveBeenCalledWith({
        data: [
          {
            id: CHARGE_ID,
            apartmentMonthlyConsumptionId: MONTHLY_ROW_ID,
            apartmentId: APARTMENT_ID,
            buildingId: BUILDING_ID,
            treasuryId: TREASURY_ID,
            month: '2026-10',
            amountBs: 155,
            exchangeRate: 6.96,
            amountUsdc: '22.2800000',
            memo: MEMO,
            publicCode: PUBLIC_CODE,
            status: 'pending',
            createdById: ADMIN_ID,
            createdAt: charge.createdAt,
            updatedAt: charge.updatedAt,
          },
        ],
        skipDuplicates: true,
      });
    });

    it('does not query for an empty list', async () => {
      await expect(repository.createManySkippingExisting([])).resolves.toBe(0);
      expect(prisma.waterCharge.createMany).not.toHaveBeenCalled();
    });
  });

  describe('reads', () => {
    it('maps a row to a charge with its context', async () => {
      prisma.waterCharge.findUnique.mockResolvedValue(row());

      const view = await repository.findByPublicCode(PUBLIC_CODE);

      expect(prisma.waterCharge.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { publicCode: PUBLIC_CODE } }),
      );
      expect(view?.charge.toPlainObject()).toEqual(
        expect.objectContaining({
          id: CHARGE_ID,
          amountBs: 155,
          exchangeRate: 6.96,
          // 7 decimals, as Stellar writes amounts.
          amountUsdc: '22.2800000',
          status: 'pending',
          txHash: null,
          paidAmountUsdc: null,
          paidAt: null,
        }),
      );
      expect(view).toEqual(
        expect.objectContaining({
          apartmentNumber: '101',
          apartmentFloor: 1,
          consumption: 77.5,
          periodStartDate: new Date('2026-10-01T00:00:00.000Z'),
          periodEndDate: null,
          buildingName: 'Edificio Central',
          treasury: {
            publicKey: TREASURY,
            network: 'testnet',
            assetCode: 'USDC',
            assetIssuer: USDC_ISSUER,
          },
        }),
      );
    });

    it('maps what was paid of a settled charge', async () => {
      const paidAt = new Date('2026-11-18T15:00:00.000Z');
      prisma.waterCharge.findUnique.mockResolvedValue(
        row({
          status: 'paid',
          txHash: TX_HASH,
          payerAddress: SIGNER_A,
          paidAmountUsdc: new Prisma.Decimal('25'),
          ledger: 4321,
          paidAt,
        }),
      );

      const view = await repository.findByPublicCode(PUBLIC_CODE);

      expect(view?.charge.toPlainObject()).toEqual(
        expect.objectContaining({
          status: 'paid',
          txHash: TX_HASH,
          payerAddress: SIGNER_A,
          paidAmountUsdc: '25.0000000',
          ledger: 4321,
          paidAt,
        }),
      );
    });

    it('never asks for the people of the apartment', async () => {
      prisma.waterCharge.findUnique.mockResolvedValue(null);

      await expect(
        repository.findByPublicCode(PUBLIC_CODE),
      ).resolves.toBeNull();

      const { include } = prisma.waterCharge.findUnique.mock.calls[0][0];
      expect(include.apartment).toEqual({
        select: { apartmentNumber: true, floor: true },
      });
      expect(JSON.stringify(include)).not.toMatch(/owner|tenant|email/i);
    });

    it('orders a building month by floor, then apartment number', async () => {
      prisma.waterCharge.findMany.mockResolvedValue([row()]);

      const views = await repository.findByBuildingIdAndMonth(
        BUILDING_ID,
        '2026-10',
      );

      expect(prisma.waterCharge.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { buildingId: BUILDING_ID, month: '2026-10' },
          orderBy: [
            { apartment: { floor: 'asc' } },
            { apartment: { apartmentNumber: 'asc' } },
          ],
        }),
      );
      expect(views).toHaveLength(1);
    });

    it('lists an apartment newest month first', async () => {
      prisma.waterCharge.findMany.mockResolvedValue([]);

      await repository.findByApartmentId(APARTMENT_ID);

      expect(prisma.waterCharge.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { apartmentId: APARTMENT_ID },
          orderBy: { month: 'desc' },
        }),
      );
    });

    it('looks memos up inside one treasury only', async () => {
      prisma.waterCharge.findMany.mockResolvedValue([row()]);

      await repository.findByTreasuryIdAndMemos(TREASURY_ID, [MEMO]);

      expect(prisma.waterCharge.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { treasuryId: TREASURY_ID, memo: { in: [MEMO] } },
        }),
      );
    });

    it('does not query for an empty list of memos', async () => {
      await expect(
        repository.findByTreasuryIdAndMemos(TREASURY_ID, []),
      ).resolves.toEqual([]);
      expect(prisma.waterCharge.findMany).not.toHaveBeenCalled();
    });
  });

  describe('settle', () => {
    const facts = {
      txHash: TX_HASH,
      payerAddress: SIGNER_A,
      paidAmountUsdc: '22.2800000',
      ledger: 4321,
      paidAt: new Date('2026-11-18T15:00:00.000Z'),
    };

    it('marks the charge paid only while it is pending', async () => {
      prisma.waterCharge.updateMany.mockResolvedValue({ count: 1 });

      await expect(repository.settle(CHARGE_ID, facts)).resolves.toBe(
        'settled',
      );
      expect(prisma.waterCharge.updateMany).toHaveBeenCalledWith({
        where: { id: CHARGE_ID, status: 'pending' },
        data: { status: 'paid', ...facts },
      });
    });

    it('reports not_pending when nothing was updated', async () => {
      prisma.waterCharge.updateMany.mockResolvedValue({ count: 0 });

      await expect(repository.settle(CHARGE_ID, facts)).resolves.toBe(
        'not_pending',
      );
    });

    it('reports hash_already_used on the unique txHash', async () => {
      prisma.waterCharge.updateMany.mockRejectedValue(knownError('P2002'));

      await expect(repository.settle(CHARGE_ID, facts)).resolves.toBe(
        'hash_already_used',
      );
    });

    it('rethrows any other error', async () => {
      prisma.waterCharge.updateMany.mockRejectedValue(knownError('P2003'));

      await expect(repository.settle(CHARGE_ID, facts)).rejects.toThrow();
    });
  });

  describe('faucet sends', () => {
    it('takes one send only from a pending charge below the limit', async () => {
      prisma.waterCharge.updateMany.mockResolvedValue({ count: 1 });

      await expect(repository.reserveFaucetDrip(CHARGE_ID, 2)).resolves.toBe(
        true,
      );
      expect(prisma.waterCharge.updateMany).toHaveBeenCalledWith({
        where: { id: CHARGE_ID, status: 'pending', faucetDrips: { lt: 2 } },
        data: { faucetDrips: { increment: 1 } },
      });
    });

    it('refuses when the limit is reached', async () => {
      prisma.waterCharge.updateMany.mockResolvedValue({ count: 0 });

      await expect(repository.reserveFaucetDrip(CHARGE_ID, 2)).resolves.toBe(
        false,
      );
    });

    it('gives a send back without going below zero', async () => {
      prisma.waterCharge.updateMany.mockResolvedValue({ count: 1 });

      await repository.releaseFaucetDrip(CHARGE_ID);

      expect(prisma.waterCharge.updateMany).toHaveBeenCalledWith({
        where: { id: CHARGE_ID, faucetDrips: { gt: 0 } },
        data: { faucetDrips: { decrement: 1 } },
      });
    });
  });

  describe('findRandomPendingPublicCode', () => {
    it('picks one of the pending charges', async () => {
      prisma.waterCharge.count.mockResolvedValue(3);
      prisma.waterCharge.findFirst.mockResolvedValue({
        publicCode: PUBLIC_CODE,
      });

      await expect(repository.findRandomPendingPublicCode()).resolves.toBe(
        PUBLIC_CODE,
      );

      const query = prisma.waterCharge.findFirst.mock.calls[0][0];
      expect(query.where).toEqual({ status: 'pending' });
      expect(query.skip).toBeGreaterThanOrEqual(0);
      expect(query.skip).toBeLessThan(3);
      expect(query.select).toEqual({ publicCode: true });
    });

    it('can be limited to one building', async () => {
      prisma.waterCharge.count.mockResolvedValue(1);
      prisma.waterCharge.findFirst.mockResolvedValue({
        publicCode: PUBLIC_CODE,
      });

      await repository.findRandomPendingPublicCode(BUILDING_ID);

      expect(prisma.waterCharge.count).toHaveBeenCalledWith({
        where: { status: 'pending', buildingId: BUILDING_ID },
      });
    });

    it('can be limited to charges of at most an amount', async () => {
      prisma.waterCharge.count.mockResolvedValue(2);
      prisma.waterCharge.findFirst.mockResolvedValue({
        publicCode: PUBLIC_CODE,
      });

      await repository.findRandomPendingPublicCode(BUILDING_ID, '20.0000000');

      const where = {
        status: 'pending',
        buildingId: BUILDING_ID,
        amountUsdc: { lte: '20.0000000' },
      };
      expect(prisma.waterCharge.count).toHaveBeenCalledWith({ where });
      expect(prisma.waterCharge.findFirst.mock.calls[0][0].where).toEqual(
        where,
      );
    });

    it('returns null when nothing is pending', async () => {
      prisma.waterCharge.count.mockResolvedValue(0);

      await expect(
        repository.findRandomPendingPublicCode(),
      ).resolves.toBeNull();
      expect(prisma.waterCharge.findFirst).not.toHaveBeenCalled();
    });
  });
});

describe('PrismaBuildingTreasuryRepository', () => {
  let prisma: {
    buildingTreasury: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let repository: PrismaBuildingTreasuryRepository;

  const row = (overrides: Record<string, unknown> = {}) => ({
    ...createTreasury().toPlainObject(),
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      buildingTreasury: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    repository = new PrismaBuildingTreasuryRepository(
      prisma as unknown as PrismaService,
    );
  });

  it('finds the treasury of a building', async () => {
    prisma.buildingTreasury.findUnique.mockResolvedValue(row());

    const treasury = await repository.findByBuildingId(BUILDING_ID);

    expect(prisma.buildingTreasury.findUnique).toHaveBeenCalledWith({
      where: { buildingId: BUILDING_ID },
    });
    expect(treasury?.toPlainObject()).toEqual(createTreasury().toPlainObject());
  });

  it('returns null when the building has none', async () => {
    prisma.buildingTreasury.findUnique.mockResolvedValue(null);

    await expect(repository.findByBuildingId(BUILDING_ID)).resolves.toBeNull();
  });

  it('keeps only well-formed signers of the JSON column', async () => {
    prisma.buildingTreasury.findUnique.mockResolvedValue(
      row({
        signers: [
          { publicKey: SIGNER_A, label: 'Administrador' },
          { publicKey: SIGNER_A },
          { label: 'sin llave' },
          'texto',
          null,
        ],
      }),
    );

    const treasury = await repository.findByBuildingId(BUILDING_ID);

    expect(treasury?.signers).toEqual([
      { publicKey: SIGNER_A, label: 'Administrador' },
      { publicKey: SIGNER_A, label: '' },
    ]);
  });

  it('saves a new treasury', async () => {
    const treasury = createTreasury();
    prisma.buildingTreasury.create.mockResolvedValue(row());

    const result = await repository.create(treasury);

    expect(prisma.buildingTreasury.create).toHaveBeenCalledWith({
      data: treasury.toPlainObject(),
    });
    expect(result.status).toBe('created');
  });

  it('reports already_exists when the building got one concurrently', async () => {
    prisma.buildingTreasury.create.mockRejectedValue(knownError('P2002'));

    await expect(repository.create(createTreasury())).resolves.toEqual({
      status: 'already_exists',
    });
  });

  it('rethrows any other error on create', async () => {
    prisma.buildingTreasury.create.mockRejectedValue(knownError('P2003'));

    await expect(repository.create(createTreasury())).rejects.toThrow();
  });

  it('lists only treasuries that still have pending charges', async () => {
    prisma.buildingTreasury.findMany.mockResolvedValue([row()]);

    const treasuries = await repository.findWithPendingCharges();

    expect(prisma.buildingTreasury.findMany).toHaveBeenCalledWith({
      where: { charges: { some: { status: 'pending' } } },
      orderBy: { createdAt: 'asc' },
    });
    expect(treasuries).toHaveLength(1);
  });

  it('stores the watcher cursor', async () => {
    prisma.buildingTreasury.updateMany.mockResolvedValue({ count: 1 });

    await repository.updateCursor(TREASURY_ID, '4242');

    expect(prisma.buildingTreasury.updateMany).toHaveBeenCalledWith({
      where: { id: TREASURY_ID },
      data: { lastCursor: '4242' },
    });
  });
});
