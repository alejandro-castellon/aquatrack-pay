import {
  BuildingTreasuryRepositoryInterface,
  CreateBuildingTreasuryResult,
} from '@/modules/water-charge/domain/building-treasury.repository.interface';
import { BuildingTreasuryEntity } from '@/modules/water-charge/domain/building-treasury.entity';
import {
  SettleWaterChargeResult,
  SettlementFacts,
  WaterChargeRepositoryInterface,
} from '@/modules/water-charge/domain/water-charge.repository.interface';
import {
  WaterChargeEntity,
  WaterChargeView,
} from '@/modules/water-charge/domain/water-charge.entity';
import { toStroops } from '@/shared/stellar/stellar-amount';

/** What the Prisma repository reads from the related tables. */
export interface ChargeContext {
  buildingNames: Map<string, string>;
  apartments: Map<string, { apartmentNumber: string; floor: number }>;
  monthlyRows: Map<
    string,
    {
      consumption: number;
      periodStartDate: Date | null;
      periodEndDate: Date | null;
    }
  >;
}

/**
 * In-memory repositories with the same guarantees the Prisma ones get from
 * the database (unique keys, guarded transitions), to run the whole feature
 * over HTTP without Postgres.
 */
export class InMemoryWaterChargeRepository implements WaterChargeRepositoryInterface {
  charges: WaterChargeEntity[] = [];

  constructor(
    private readonly context: ChargeContext,
    private readonly treasuries: InMemoryBuildingTreasuryRepository,
  ) {}

  createManySkippingExisting(charges: WaterChargeEntity[]): Promise<number> {
    let created = 0;
    for (const charge of charges) {
      const clash = this.charges.some(
        (existing) =>
          existing.apartmentMonthlyConsumptionId ===
            charge.apartmentMonthlyConsumptionId ||
          existing.memo === charge.memo ||
          existing.publicCode === charge.publicCode,
      );
      if (clash) continue;
      this.charges.push(charge);
      created += 1;
    }
    return Promise.resolve(created);
  }

  findByBuildingIdAndMonth(
    buildingId: string,
    month: string,
  ): Promise<WaterChargeView[]> {
    const views = this.charges
      .filter(
        (charge) => charge.buildingId === buildingId && charge.month === month,
      )
      .map((charge) => this.toView(charge))
      .sort(
        (a, b) =>
          a.apartmentFloor - b.apartmentFloor ||
          a.apartmentNumber.localeCompare(b.apartmentNumber),
      );
    return Promise.resolve(views);
  }

  findByApartmentId(apartmentId: string): Promise<WaterChargeView[]> {
    const views = this.charges
      .filter((charge) => charge.apartmentId === apartmentId)
      .map((charge) => this.toView(charge))
      .sort((a, b) => b.charge.month.localeCompare(a.charge.month));
    return Promise.resolve(views);
  }

  findByPublicCode(publicCode: string): Promise<WaterChargeView | null> {
    const charge = this.charges.find(
      (candidate) => candidate.publicCode === publicCode,
    );
    return Promise.resolve(charge ? this.toView(charge) : null);
  }

  findByTreasuryIdAndMemos(
    treasuryId: string,
    memos: string[],
  ): Promise<WaterChargeView[]> {
    return Promise.resolve(
      this.charges
        .filter(
          (charge) =>
            charge.treasuryId === treasuryId && memos.includes(charge.memo),
        )
        .map((charge) => this.toView(charge)),
    );
  }

  settle(id: string, facts: SettlementFacts): Promise<SettleWaterChargeResult> {
    if (this.charges.some((charge) => charge.txHash === facts.txHash)) {
      return Promise.resolve('hash_already_used');
    }
    const index = this.charges.findIndex(
      (charge) => charge.id === id && charge.isPending,
    );
    if (index === -1) return Promise.resolve('not_pending');

    this.charges[index] = WaterChargeEntity.fromPersistence({
      ...this.charges[index].toPlainObject(),
      status: 'paid',
      ...facts,
    });
    return Promise.resolve('settled');
  }

  reserveFaucetDrip(id: string, maxDrips: number): Promise<boolean> {
    const index = this.charges.findIndex(
      (charge) =>
        charge.id === id && charge.isPending && charge.faucetDrips < maxDrips,
    );
    if (index === -1) return Promise.resolve(false);

    this.replace(index, { faucetDrips: this.charges[index].faucetDrips + 1 });
    return Promise.resolve(true);
  }

  releaseFaucetDrip(id: string): Promise<void> {
    const index = this.charges.findIndex(
      (charge) => charge.id === id && charge.faucetDrips > 0,
    );
    if (index !== -1) {
      this.replace(index, { faucetDrips: this.charges[index].faucetDrips - 1 });
    }
    return Promise.resolve();
  }

  findRandomPendingPublicCode(
    buildingId?: string | null,
    maxAmountUsdc?: string,
  ): Promise<string | null> {
    const pending = this.charges.filter(
      (charge) =>
        charge.isPending &&
        (!buildingId || charge.buildingId === buildingId) &&
        (!maxAmountUsdc || charge.dueStroops <= toStroops(maxAmountUsdc)),
    );
    return Promise.resolve(pending[0]?.publicCode ?? null);
  }

  private replace(index: number, changes: { faucetDrips: number }): void {
    this.charges[index] = WaterChargeEntity.fromPersistence({
      ...this.charges[index].toPlainObject(),
      ...changes,
    });
  }

  private toView(charge: WaterChargeEntity): WaterChargeView {
    const apartment = this.context.apartments.get(charge.apartmentId);
    const row = this.context.monthlyRows.get(
      charge.apartmentMonthlyConsumptionId,
    );
    const treasury = this.treasuries.treasuries.find(
      (candidate) => candidate.id === charge.treasuryId,
    );
    if (!apartment || !row || !treasury) {
      throw new Error(`Incomplete fixture for charge ${charge.id}`);
    }

    return {
      charge,
      apartmentNumber: apartment.apartmentNumber,
      apartmentFloor: apartment.floor,
      consumption: row.consumption,
      periodStartDate: row.periodStartDate,
      periodEndDate: row.periodEndDate,
      buildingName: this.context.buildingNames.get(charge.buildingId) ?? '',
      treasury: {
        publicKey: treasury.publicKey,
        network: treasury.network,
        assetCode: treasury.assetCode,
        assetIssuer: treasury.assetIssuer,
      },
    };
  }
}

export class InMemoryBuildingTreasuryRepository implements BuildingTreasuryRepositoryInterface {
  treasuries: BuildingTreasuryEntity[] = [];
  /** Set by the charge repository's owner so pending charges can be seen. */
  pendingTreasuryIds: () => string[] = () => [];

  findByBuildingId(buildingId: string): Promise<BuildingTreasuryEntity | null> {
    return Promise.resolve(
      this.treasuries.find((treasury) => treasury.buildingId === buildingId) ??
        null,
    );
  }

  create(
    treasury: BuildingTreasuryEntity,
  ): Promise<CreateBuildingTreasuryResult> {
    const clash = this.treasuries.some(
      (existing) =>
        existing.buildingId === treasury.buildingId ||
        existing.publicKey === treasury.publicKey,
    );
    if (clash) return Promise.resolve({ status: 'already_exists' });

    this.treasuries.push(treasury);
    return Promise.resolve({ status: 'created', treasury });
  }

  findWithPendingCharges(): Promise<BuildingTreasuryEntity[]> {
    const ids = new Set(this.pendingTreasuryIds());
    return Promise.resolve(
      this.treasuries.filter((treasury) => ids.has(treasury.id)),
    );
  }

  updateCursor(id: string, cursor: string): Promise<void> {
    const index = this.treasuries.findIndex((treasury) => treasury.id === id);
    if (index !== -1) {
      this.treasuries[index] = BuildingTreasuryEntity.fromPersistence({
        ...this.treasuries[index].toPlainObject(),
        lastCursor: cursor,
      });
    }
    return Promise.resolve();
  }
}
