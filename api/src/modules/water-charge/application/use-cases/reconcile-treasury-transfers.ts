import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  STELLAR_GATEWAY,
  StellarGateway,
} from '@/shared/stellar/stellar-gateway.interface';
import { HorizonOperation } from '@/shared/stellar/horizon.types';
import { fromStroops } from '@/shared/stellar/stellar-amount';
import { BuildingTreasuryEntity } from '@modules/water-charge/domain/building-treasury.entity';
import {
  BUILDING_TREASURY_REPOSITORY,
  BuildingTreasuryRepositoryInterface,
} from '@modules/water-charge/domain/building-treasury.repository.interface';
import {
  WATER_CHARGE_REPOSITORY,
  WaterChargeRepositoryInterface,
} from '@modules/water-charge/domain/water-charge.repository.interface';
import {
  collectIncomingTransfers,
  judgeTransfer,
} from '@modules/water-charge/domain/services/transfer-matcher';

export interface ReconcileSummary {
  /** Treasuries read in this run. */
  treasuries: number;
  /** Charges settled in this run. */
  settled: number;
}

const PAGE_SIZE = 200;
/** Upper bound of pages per treasury and run; the next run continues. */
const MAX_PAGES_PER_RUN = 10;

/**
 * Settles charges from what arrived at each treasury, for payments made
 * outside the app (another wallet, a QR) that nobody confirmed. It reads the
 * treasury history forward from a stored cursor, so each record is seen once.
 * No caller: it bypasses authorization, like the consumption jobs.
 */
@Injectable()
export class ReconcileTreasuryTransfersUseCase {
  private readonly logger = new Logger(ReconcileTreasuryTransfersUseCase.name);

  constructor(
    @Inject(BUILDING_TREASURY_REPOSITORY)
    private readonly buildingTreasuryRepository: BuildingTreasuryRepositoryInterface,
    @Inject(WATER_CHARGE_REPOSITORY)
    private readonly waterChargeRepository: WaterChargeRepositoryInterface,
    @Inject(STELLAR_GATEWAY)
    private readonly stellarGateway: StellarGateway,
  ) {}

  /** Every treasury that still has pending charges. One failing does not stop the rest. */
  async execute(): Promise<ReconcileSummary> {
    const treasuries =
      await this.buildingTreasuryRepository.findWithPendingCharges();
    let settled = 0;

    for (const treasury of treasuries) {
      try {
        settled += await this.reconcileTreasury(treasury);
      } catch (error) {
        this.logger.warn(
          `Could not reconcile treasury ${treasury.publicKey}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return { treasuries: treasuries.length, settled };
  }

  /** Reads one treasury from its cursor and returns how many charges it settled. */
  async reconcileTreasury(treasury: BuildingTreasuryEntity): Promise<number> {
    const target = {
      destination: treasury.publicKey,
      assetCode: treasury.assetCode,
      assetIssuer: treasury.assetIssuer,
    };
    let cursor = treasury.lastCursor ?? undefined;
    let settled = 0;

    for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
      const fetched = await this.stellarGateway.listAccountPayments(
        treasury.publicKey,
        { order: 'asc', limit: PAGE_SIZE, cursor },
      );
      if (fetched.length === 0) break;

      const records = this.withoutCutTransaction(fetched);
      const transfers = collectIncomingTransfers(records, target);
      const memos = [
        ...new Set(
          transfers
            .map((transfer) => transfer.memo)
            .filter((memo): memo is string => memo !== null),
        ),
      ];
      const charges = await this.waterChargeRepository.findByTreasuryIdAndMemos(
        treasury.id,
        memos,
      );
      const byMemo = new Map(charges.map((view) => [view.charge.memo, view]));

      for (const transfer of transfers) {
        const charge = transfer.memo
          ? byMemo.get(transfer.memo)?.charge
          : undefined;
        if (!charge?.isPending) continue;

        const verdict = judgeTransfer(transfer, {
          memo: charge.memo,
          dueStroops: charge.dueStroops,
        });
        if (verdict !== 'settles') continue;

        const result = await this.waterChargeRepository.settle(charge.id, {
          txHash: transfer.txHash,
          payerAddress: transfer.payerAddress,
          paidAmountUsdc: fromStroops(transfer.stroops),
          ledger: transfer.ledger,
          paidAt: transfer.createdAt,
        });
        if (result === 'settled') {
          settled += 1;
          // A later transfer with the same memo in this page is a duplicate.
          byMemo.delete(charge.memo);
        }
      }

      // Only now is the page done: a failure above leaves the cursor where it
      // was, and the next run reads the same records again.
      cursor = records[records.length - 1].paging_token;
      await this.buildingTreasuryRepository.updateCursor(treasury.id, cursor);

      if (fetched.length < PAGE_SIZE) break;
    }

    if (settled > 0) {
      this.logger.log(
        `Settled ${settled} charge(s) from treasury ${treasury.publicKey}`,
      );
    }
    return settled;
  }

  /**
   * A full page may end in the middle of a transaction with several payments.
   * Its records are left for the next page, so the amounts of a transaction
   * are always added up together.
   */
  private withoutCutTransaction(
    records: HorizonOperation[],
  ): HorizonOperation[] {
    if (records.length < PAGE_SIZE) return records;

    const lastHash = records[records.length - 1].transaction_hash;
    const complete = records.filter(
      (record) => record.transaction_hash !== lastHash,
    );
    // One transaction filling the whole page: process it as it is.
    return complete.length > 0 ? complete : records;
  }
}
