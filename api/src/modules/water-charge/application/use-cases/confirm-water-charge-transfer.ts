import { ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  STELLAR_GATEWAY,
  StellarGateway,
} from '@/shared/stellar/stellar-gateway.interface';
import { HorizonOperation } from '@/shared/stellar/horizon.types';
import { fromStroops } from '@/shared/stellar/stellar-amount';
import {
  WATER_CHARGE_REPOSITORY,
  WaterChargeRepositoryInterface,
} from '@modules/water-charge/domain/water-charge.repository.interface';
import { WaterChargeView } from '@modules/water-charge/domain/water-charge.entity';
import {
  collectIncomingTransfers,
  judgeTransfer,
} from '@modules/water-charge/domain/services/transfer-matcher';
import { rethrowStellarError } from '@modules/water-charge/application/stellar-errors';
import { GetPublicWaterChargeUseCase } from './get-public-water-charge';

/**
 * - paid: this call settled the charge.
 * - already_paid: it was settled before (by this or another transaction).
 * - not_found_yet: Horizon does not know the hash yet; ask again shortly.
 * - not_a_payment: the transaction credited nothing to the treasury in the
 *   charge asset (or it failed).
 * - wrong_memo: it paid the treasury without this charge's memo.
 * - underpaid: it carries the memo but does not cover the amount.
 */
export type ConfirmWaterChargeOutcome =
  | 'paid'
  | 'already_paid'
  | 'not_found_yet'
  | 'not_a_payment'
  | 'wrong_memo'
  | 'underpaid';

export interface ConfirmWaterChargeResult {
  outcome: ConfirmWaterChargeOutcome;
  charge: WaterChargeView;
}

/**
 * Checks a transaction on the ledger and, when it pays the charge, marks it
 * paid. It has no caller on purpose: it records nothing but on-chain facts,
 * so naming someone else's transaction cannot settle anything it did not pay.
 */
@Injectable()
export class ConfirmWaterChargeTransferUseCase {
  constructor(
    @Inject(WATER_CHARGE_REPOSITORY)
    private readonly waterChargeRepository: WaterChargeRepositoryInterface,
    @Inject(STELLAR_GATEWAY)
    private readonly stellarGateway: StellarGateway,
    private readonly getPublicWaterChargeUseCase: GetPublicWaterChargeUseCase,
  ) {}

  async execute(
    publicCode: string,
    txHash: string,
  ): Promise<ConfirmWaterChargeResult> {
    const view = await this.getPublicWaterChargeUseCase.execute(publicCode);
    const { charge } = view;

    if (charge.isPaid) {
      return { outcome: 'already_paid', charge: view };
    }
    if (!charge.isPending) {
      throw new ConflictException('This charge was cancelled');
    }

    let operations: HorizonOperation[] | null;
    try {
      operations = await this.stellarGateway.getTransactionOperations(txHash);
    } catch (error) {
      rethrowStellarError(error);
    }
    if (!operations) {
      return { outcome: 'not_found_yet', charge: view };
    }

    // One transaction yields at most one transfer: its payments are added up.
    const [transfer] = collectIncomingTransfers(operations, {
      destination: view.treasury.publicKey,
      assetCode: view.treasury.assetCode,
      assetIssuer: view.treasury.assetIssuer,
    });
    if (!transfer) {
      return { outcome: 'not_a_payment', charge: view };
    }

    const verdict = judgeTransfer(transfer, {
      memo: charge.memo,
      dueStroops: charge.dueStroops,
    });
    if (verdict !== 'settles') {
      return { outcome: verdict, charge: view };
    }

    const result = await this.waterChargeRepository.settle(charge.id, {
      // The hash in the ledger, never the string the client sent.
      txHash: transfer.txHash,
      payerAddress: transfer.payerAddress,
      paidAmountUsdc: fromStroops(transfer.stroops),
      ledger: transfer.ledger,
      paidAt: transfer.createdAt,
    });

    const fresh = await this.getPublicWaterChargeUseCase.execute(publicCode);
    if (result === 'settled') {
      return { outcome: 'paid', charge: fresh };
    }
    if (fresh.charge.isPaid) {
      // The watcher or another confirmation settled it first.
      return { outcome: 'already_paid', charge: fresh };
    }
    throw new ConflictException(
      'This transaction already settled another charge',
    );
  }
}
