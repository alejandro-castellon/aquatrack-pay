import { WaterChargeEntity, WaterChargeView } from './water-charge.entity';

export const WATER_CHARGE_REPOSITORY = Symbol('WATER_CHARGE_REPOSITORY');

/** What the ledger says about the transaction that paid a charge. */
export interface SettlementFacts {
  /** Hash of the transaction in the ledger, never the client's string. */
  txHash: string;
  payerAddress: string;
  /** 7-decimal string. */
  paidAmountUsdc: string;
  ledger: number;
  paidAt: Date;
}

/**
 * - settled: the charge was pending and is now paid.
 * - not_pending: someone else settled (or cancelled) it first.
 * - hash_already_used: that transaction already settled another charge.
 */
export type SettleWaterChargeResult =
  'settled' | 'not_pending' | 'hash_already_used';

export interface WaterChargeRepositoryInterface {
  /**
   * Inserts the charges that do not exist yet (one per monthly consumption
   * row) and returns how many were created. Existing ones are left untouched.
   */
  createManySkippingExisting(charges: WaterChargeEntity[]): Promise<number>;
  /** Ordered by floor, then apartment number. */
  findByBuildingIdAndMonth(
    buildingId: string,
    month: string,
  ): Promise<WaterChargeView[]>;
  /** Newest month first. */
  findByApartmentId(apartmentId: string): Promise<WaterChargeView[]>;
  findByPublicCode(publicCode: string): Promise<WaterChargeView | null>;
  /** Charges of a treasury carrying one of these memos, whatever their status. */
  findByTreasuryIdAndMemos(
    treasuryId: string,
    memos: string[],
  ): Promise<WaterChargeView[]>;
  /**
   * Marks a charge as paid only if it is still pending. Confirmation, the
   * watcher and the treasury view all settle through here, so they never
   * overwrite each other.
   */
  settle(id: string, facts: SettlementFacts): Promise<SettleWaterChargeResult>;
  /**
   * Takes one of the charge's demo faucet sends. False when the charge is no
   * longer pending or already used `maxDrips`.
   */
  reserveFaucetDrip(id: string, maxDrips: number): Promise<boolean>;
  /** Gives a reserved send back when the transfer did not go out. */
  releaseFaucetDrip(id: string): Promise<void>;
  /**
   * Public code of a random pending charge, optionally of one building and
   * of at most `maxAmountUsdc` (7-decimal string).
   */
  findRandomPendingPublicCode(
    buildingId?: string | null,
    maxAmountUsdc?: string,
  ): Promise<string | null>;
}
