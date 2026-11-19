import { Injectable } from '@nestjs/common';
import {
  BuildingTreasury as PrismaBuildingTreasury,
  Prisma,
  WaterChargeStatus,
} from '@prisma/client';
import { PrismaService } from '@/shared/database/prisma.service';
import { isUniqueViolationError } from '@/shared/database/prisma-errors';
import {
  BuildingTreasuryRepositoryInterface,
  CreateBuildingTreasuryResult,
} from '@modules/water-charge/domain/building-treasury.repository.interface';
import {
  BuildingTreasuryEntity,
  TreasurySigner,
} from '@modules/water-charge/domain/building-treasury.entity';

@Injectable()
export class PrismaBuildingTreasuryRepository implements BuildingTreasuryRepositoryInterface {
  constructor(private readonly prisma: PrismaService) {}

  async findByBuildingId(
    buildingId: string,
  ): Promise<BuildingTreasuryEntity | null> {
    const row = await this.prisma.buildingTreasury.findUnique({
      where: { buildingId },
    });
    return row ? this.toDomain(row) : null;
  }

  async create(
    treasury: BuildingTreasuryEntity,
  ): Promise<CreateBuildingTreasuryResult> {
    const data = treasury.toPlainObject();

    try {
      const row = await this.prisma.buildingTreasury.create({
        data: {
          id: data.id,
          buildingId: data.buildingId,
          network: data.network,
          publicKey: data.publicKey,
          assetCode: data.assetCode,
          assetIssuer: data.assetIssuer,
          signers: data.signers as unknown as Prisma.InputJsonValue,
          threshold: data.threshold,
          setupTxHash: data.setupTxHash,
          lastCursor: data.lastCursor,
          createdById: data.createdById,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        },
      });
      return { status: 'created', treasury: this.toDomain(row) };
    } catch (error) {
      // Unique buildingId (or publicKey): a concurrent request created it first.
      if (isUniqueViolationError(error)) {
        return { status: 'already_exists' };
      }
      throw error;
    }
  }

  async findWithPendingCharges(): Promise<BuildingTreasuryEntity[]> {
    const rows = await this.prisma.buildingTreasury.findMany({
      where: { charges: { some: { status: WaterChargeStatus.pending } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => this.toDomain(row));
  }

  async updateCursor(id: string, cursor: string): Promise<void> {
    await this.prisma.buildingTreasury.updateMany({
      where: { id },
      data: { lastCursor: cursor },
    });
  }

  private toDomain(row: PrismaBuildingTreasury): BuildingTreasuryEntity {
    return BuildingTreasuryEntity.fromPersistence({
      id: row.id,
      buildingId: row.buildingId,
      network: row.network,
      publicKey: row.publicKey,
      assetCode: row.assetCode,
      assetIssuer: row.assetIssuer,
      signers: this.toSigners(row.signers),
      threshold: row.threshold,
      setupTxHash: row.setupTxHash,
      lastCursor: row.lastCursor ?? null,
      createdById: row.createdById ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  /** The column is free-form JSON: keep only well-formed entries. */
  private toSigners(value: Prisma.JsonValue): TreasurySigner[] {
    if (!Array.isArray(value)) return [];

    return value.flatMap((entry) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        return [];
      }
      const { publicKey, label } = entry as Record<string, unknown>;
      return typeof publicKey === 'string'
        ? [{ publicKey, label: typeof label === 'string' ? label : '' }]
        : [];
    });
  }
}
