import { BuildingTreasuryEntity } from './building-treasury.entity';

export const BUILDING_TREASURY_REPOSITORY = Symbol(
  'BUILDING_TREASURY_REPOSITORY',
);

/**
 * - created: the treasury row was inserted.
 * - already_exists: the building (or that Stellar account) already has one;
 *   a concurrent request won.
 */
export type CreateBuildingTreasuryResult =
  | { status: 'created'; treasury: BuildingTreasuryEntity }
  | { status: 'already_exists' };

export interface BuildingTreasuryRepositoryInterface {
  findByBuildingId(buildingId: string): Promise<BuildingTreasuryEntity | null>;
  create(
    treasury: BuildingTreasuryEntity,
  ): Promise<CreateBuildingTreasuryResult>;
  /** Treasuries with at least one pending charge: the only ones worth polling. */
  findWithPendingCharges(): Promise<BuildingTreasuryEntity[]>;
  /** Remembers how far the watcher read the treasury's payment history. */
  updateCursor(id: string, cursor: string): Promise<void>;
}
