import { Injectable } from '@nestjs/common';
import { Prisma, WaterChargeStatus } from '@prisma/client';
import { PrismaService } from '@/shared/database/prisma.service';
import { isUniqueViolationError } from '@/shared/database/prisma-errors';
import {
  SettleWaterChargeResult,
  SettlementFacts,
  WaterChargeRepositoryInterface,
} from '@modules/water-charge/domain/water-charge.repository.interface';
import {
  WaterChargeEntity,
  WaterChargeView,
} from '@modules/water-charge/domain/water-charge.entity';

/** Everything a charge is shown with. Never people: no owner or tenant. */
const withContext = {
  include: {
    apartment: { select: { apartmentNumber: true, floor: true } },
    apartmentMonthlyConsumption: {
      select: {
        consumption: true,
        periodStartDate: true,
        periodEndDate: true,
      },
    },
    building: { select: { name: true } },
    treasury: {
      select: {
        publicKey: true,
        network: true,
        assetCode: true,
        assetIssuer: true,
      },
    },
  },
} satisfies Prisma.WaterChargeDefaultArgs;

type WaterChargeWithContext = Prisma.WaterChargeGetPayload<typeof withContext>;

/** Stellar amounts leave the database as the 7-decimal strings the network uses. */
const USDC_DECIMALS = 7;

@Injectable()
export class PrismaWaterChargeRepository implements WaterChargeRepositoryInterface {
  constructor(private readonly prisma: PrismaService) {}

  async createManySkippingExisting(
    charges: WaterChargeEntity[],
  ): Promise<number> {
    if (charges.length === 0) return 0;

    // ON CONFLICT DO NOTHING on the unique apartmentMonthlyConsumptionId:
    // publishing the same month twice never touches an existing charge.
    const result = await this.prisma.waterCharge.createMany({
      data: charges.map((charge) => {
        const data = charge.toPlainObject();
        return {
          id: data.id,
          apartmentMonthlyConsumptionId: data.apartmentMonthlyConsumptionId,
          apartmentId: data.apartmentId,
          buildingId: data.buildingId,
          treasuryId: data.treasuryId,
          month: data.month,
          amountBs: data.amountBs,
          exchangeRate: data.exchangeRate,
          amountUsdc: data.amountUsdc,
          memo: data.memo,
          publicCode: data.publicCode,
          status: WaterChargeStatus.pending,
          createdById: data.createdById,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        };
      }),
      skipDuplicates: true,
    });

    return result.count;
  }

  async findByBuildingIdAndMonth(
    buildingId: string,
    month: string,
  ): Promise<WaterChargeView[]> {
    const rows = await this.prisma.waterCharge.findMany({
      where: { buildingId, month },
      orderBy: [
        { apartment: { floor: 'asc' } },
        { apartment: { apartmentNumber: 'asc' } },
      ],
      ...withContext,
    });
    return rows.map((row) => this.toView(row));
  }

  async findByApartmentId(apartmentId: string): Promise<WaterChargeView[]> {
    const rows = await this.prisma.waterCharge.findMany({
      where: { apartmentId },
      orderBy: { month: 'desc' },
      ...withContext,
    });
    return rows.map((row) => this.toView(row));
  }

  async findByPublicCode(publicCode: string): Promise<WaterChargeView | null> {
    const row = await this.prisma.waterCharge.findUnique({
      where: { publicCode },
      ...withContext,
    });
    return row ? this.toView(row) : null;
  }

  async findByTreasuryIdAndMemos(
    treasuryId: string,
    memos: string[],
  ): Promise<WaterChargeView[]> {
    if (memos.length === 0) return [];

    const rows = await this.prisma.waterCharge.findMany({
      where: { treasuryId, memo: { in: memos } },
      ...withContext,
    });
    return rows.map((row) => this.toView(row));
  }

  async settle(
    id: string,
    facts: SettlementFacts,
  ): Promise<SettleWaterChargeResult> {
    try {
      // Guarded by the current status, like the device-command transitions:
      // of two concurrent settlements exactly one updates the row.
      const result = await this.prisma.waterCharge.updateMany({
        where: { id, status: WaterChargeStatus.pending },
        data: {
          status: WaterChargeStatus.paid,
          txHash: facts.txHash,
          payerAddress: facts.payerAddress,
          paidAmountUsdc: facts.paidAmountUsdc,
          ledger: facts.ledger,
          paidAt: facts.paidAt,
        },
      });
      return result.count === 1 ? 'settled' : 'not_pending';
    } catch (error) {
      // Unique txHash: the transaction is already recorded on another charge.
      if (isUniqueViolationError(error)) {
        return 'hash_already_used';
      }
      throw error;
    }
  }

  async reserveFaucetDrip(id: string, maxDrips: number): Promise<boolean> {
    const result = await this.prisma.waterCharge.updateMany({
      where: {
        id,
        status: WaterChargeStatus.pending,
        faucetDrips: { lt: maxDrips },
      },
      data: { faucetDrips: { increment: 1 } },
    });
    return result.count === 1;
  }

  async releaseFaucetDrip(id: string): Promise<void> {
    await this.prisma.waterCharge.updateMany({
      where: { id, faucetDrips: { gt: 0 } },
      data: { faucetDrips: { decrement: 1 } },
    });
  }

  async findRandomPendingPublicCode(
    buildingId?: string | null,
    maxAmountUsdc?: string,
  ): Promise<string | null> {
    const where: Prisma.WaterChargeWhereInput = {
      status: WaterChargeStatus.pending,
      ...(buildingId ? { buildingId } : {}),
      ...(maxAmountUsdc ? { amountUsdc: { lte: maxAmountUsdc } } : {}),
    };

    const total = await this.prisma.waterCharge.count({ where });
    if (total === 0) return null;

    const row = await this.prisma.waterCharge.findFirst({
      where,
      orderBy: { id: 'asc' },
      skip: Math.floor(Math.random() * total),
      select: { publicCode: true },
    });
    return row?.publicCode ?? null;
  }

  private toView(row: WaterChargeWithContext): WaterChargeView {
    return {
      charge: WaterChargeEntity.fromPersistence({
        id: row.id,
        apartmentMonthlyConsumptionId: row.apartmentMonthlyConsumptionId,
        apartmentId: row.apartmentId,
        buildingId: row.buildingId,
        treasuryId: row.treasuryId,
        month: row.month,
        amountBs: Number(row.amountBs),
        exchangeRate: Number(row.exchangeRate),
        amountUsdc: row.amountUsdc.toFixed(USDC_DECIMALS),
        memo: row.memo,
        publicCode: row.publicCode,
        status: row.status,
        txHash: row.txHash ?? null,
        payerAddress: row.payerAddress ?? null,
        paidAmountUsdc: row.paidAmountUsdc?.toFixed(USDC_DECIMALS) ?? null,
        ledger: row.ledger ?? null,
        paidAt: row.paidAt ?? null,
        faucetDrips: row.faucetDrips,
        createdById: row.createdById ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }),
      apartmentNumber: row.apartment.apartmentNumber,
      apartmentFloor: row.apartment.floor,
      consumption: Number(row.apartmentMonthlyConsumption.consumption),
      periodStartDate: row.apartmentMonthlyConsumption.periodStartDate ?? null,
      periodEndDate: row.apartmentMonthlyConsumption.periodEndDate ?? null,
      buildingName: row.building.name,
      treasury: {
        publicKey: row.treasury.publicKey,
        network: row.treasury.network,
        assetCode: row.treasury.assetCode,
        assetIssuer: row.treasury.assetIssuer,
      },
    };
  }
}
