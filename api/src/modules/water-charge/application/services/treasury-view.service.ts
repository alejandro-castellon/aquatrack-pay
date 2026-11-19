import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  STELLAR_GATEWAY,
  StellarGateway,
  StellarGatewayError,
} from '@/shared/stellar/stellar-gateway.interface';
import { fromStroops } from '@/shared/stellar/stellar-amount';
import { BuildingTreasuryEntity } from '@modules/water-charge/domain/building-treasury.entity';
import { WaterChargeView } from '@modules/water-charge/domain/water-charge.entity';
import {
  WATER_CHARGE_REPOSITORY,
  WaterChargeRepositoryInterface,
} from '@modules/water-charge/domain/water-charge.repository.interface';
import {
  IncomingTransfer,
  collectIncomingTransfers,
  judgeTransfer,
} from '@modules/water-charge/domain/services/transfer-matcher';

/**
 * - matched: the transfer that settled a charge.
 * - duplicate: carries the memo of a charge another transaction settled.
 * - underpaid: carries the memo of a pending charge but does not cover it.
 * - unmatched: no memo, or one that belongs to no charge of this treasury.
 */
export type TreasuryTransferStatus =
  'matched' | 'unmatched' | 'underpaid' | 'duplicate';

export interface TreasuryOnChainView {
  /** Balance in the charge asset, 7 decimals. */
  balance: string;
  xlmBalance: string;
  /** Weight of the account's own key: 0 means nobody holds a master key. */
  masterWeight: number;
  thresholds: { low: number; med: number; high: number };
  /** The board's signers as the network has them, without the master key. */
  signers: { publicKey: string; weight: number }[];
}

export interface TreasuryTransferView {
  txHash: string;
  createdAt: Date;
  payerAddress: string;
  amountUsdc: string;
  memo: string | null;
  status: TreasuryTransferStatus;
  apartmentNumber: string | null;
  month: string | null;
}

export interface TreasuryView {
  treasury: BuildingTreasuryEntity;
  /** null when Horizon cannot be reached or the account is gone. */
  onChain: TreasuryOnChainView | null;
  transfers: TreasuryTransferView[];
}

/** One Horizon page; enough to show the latest transfers. */
const HISTORY_PAGE_SIZE = 200;
const TRANSFERS_SHOWN = 50;
const ZERO_AMOUNT = '0.0000000';

/**
 * Reads what the network says about a treasury: who can sign, how much it
 * holds and what came in. It only reads; a Horizon outage degrades the view
 * instead of failing the request.
 */
@Injectable()
export class TreasuryViewService {
  private readonly logger = new Logger(TreasuryViewService.name);

  constructor(
    @Inject(STELLAR_GATEWAY)
    private readonly stellarGateway: StellarGateway,
    @Inject(WATER_CHARGE_REPOSITORY)
    private readonly waterChargeRepository: WaterChargeRepositoryInterface,
  ) {}

  async build(treasury: BuildingTreasuryEntity): Promise<TreasuryView> {
    const [onChain, transfers] = await Promise.all([
      this.readOnChain(treasury),
      this.readTransfers(treasury),
    ]);
    return { treasury, onChain, transfers };
  }

  private async readOnChain(
    treasury: BuildingTreasuryEntity,
  ): Promise<TreasuryOnChainView | null> {
    try {
      const account = await this.stellarGateway.getAccount(treasury.publicKey);
      if (!account) return null;

      const assetBalance = account.balances.find(
        (balance) =>
          balance.asset_code === treasury.assetCode &&
          balance.asset_issuer === treasury.assetIssuer,
      );
      const xlmBalance = account.balances.find(
        (balance) => balance.asset_type === 'native',
      );
      const master = account.signers.find(
        (signer) => signer.key === treasury.publicKey,
      );

      return {
        balance: assetBalance?.balance ?? ZERO_AMOUNT,
        xlmBalance: xlmBalance?.balance ?? ZERO_AMOUNT,
        masterWeight: master?.weight ?? 0,
        thresholds: {
          low: account.thresholds.low_threshold,
          med: account.thresholds.med_threshold,
          high: account.thresholds.high_threshold,
        },
        signers: account.signers
          .filter((signer) => signer.key !== treasury.publicKey)
          .map((signer) => ({ publicKey: signer.key, weight: signer.weight })),
      };
    } catch (error) {
      if (!(error instanceof StellarGatewayError)) throw error;
      this.logger.warn(
        `Treasury ${treasury.publicKey} could not be read: ${error.message}`,
      );
      return null;
    }
  }

  private async readTransfers(
    treasury: BuildingTreasuryEntity,
  ): Promise<TreasuryTransferView[]> {
    let transfers: IncomingTransfer[];
    try {
      const operations = await this.stellarGateway.listAccountPayments(
        treasury.publicKey,
        { order: 'desc', limit: HISTORY_PAGE_SIZE },
      );
      transfers = collectIncomingTransfers(operations, {
        destination: treasury.publicKey,
        assetCode: treasury.assetCode,
        assetIssuer: treasury.assetIssuer,
      });

      // A full page may cut the oldest transaction in half; leave it out
      // rather than show a wrong amount for it.
      if (operations.length === HISTORY_PAGE_SIZE) {
        const cut = operations[operations.length - 1].transaction_hash;
        transfers = transfers.filter((transfer) => transfer.txHash !== cut);
      }
    } catch (error) {
      if (!(error instanceof StellarGatewayError)) throw error;
      this.logger.warn(
        `Transfers of ${treasury.publicKey} could not be read: ${error.message}`,
      );
      return [];
    }

    const shown = transfers.slice(0, TRANSFERS_SHOWN);
    const memos = [
      ...new Set(
        shown
          .map((transfer) => transfer.memo)
          .filter((memo): memo is string => memo !== null),
      ),
    ];
    const charges = await this.waterChargeRepository.findByTreasuryIdAndMemos(
      treasury.id,
      memos,
    );
    const byMemo = new Map(charges.map((view) => [view.charge.memo, view]));

    return shown.map((transfer) => {
      const view = transfer.memo ? byMemo.get(transfer.memo) : undefined;
      const status = this.statusOf(transfer, view);
      const known = status !== 'unmatched' ? view : undefined;

      return {
        txHash: transfer.txHash,
        createdAt: transfer.createdAt,
        payerAddress: transfer.payerAddress,
        amountUsdc: fromStroops(transfer.stroops),
        memo: transfer.memo ?? transfer.rawMemo,
        status,
        apartmentNumber: known?.apartmentNumber ?? null,
        month: known?.charge.month ?? null,
      };
    });
  }

  private statusOf(
    transfer: IncomingTransfer,
    view: WaterChargeView | undefined,
  ): TreasuryTransferStatus {
    if (!view) return 'unmatched';

    const { charge } = view;
    if (charge.txHash === transfer.txHash) return 'matched';
    if (charge.isPaid) return 'duplicate';
    if (
      charge.isPending &&
      judgeTransfer(transfer, {
        memo: charge.memo,
        dueStroops: charge.dueStroops,
      }) === 'underpaid'
    ) {
      return 'underpaid';
    }
    // A cancelled charge, or a pending one not reconciled yet.
    return 'unmatched';
  }
}
