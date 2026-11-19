import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  StellarConfig,
  networkPassphraseOf,
} from '@/shared/stellar/stellar.config';
import { txUrl } from '@/shared/stellar/stellar-explorer';
import { formatDateOnly } from '@/shared/utils/date-only';
import {
  WaterChargeStatus,
  WaterChargeView,
} from '@modules/water-charge/domain/water-charge.entity';
import {
  ConfirmWaterChargeOutcome,
  ConfirmWaterChargeResult,
} from '@modules/water-charge/application/use-cases/confirm-water-charge-transfer';
import { DemoFundsResult } from '@modules/water-charge/application/use-cases/request-demo-funds';

const STATUSES: WaterChargeStatus[] = ['pending', 'paid', 'cancelled'];
const OUTCOMES: ConfirmWaterChargeOutcome[] = [
  'paid',
  'already_paid',
  'not_found_yet',
  'not_a_payment',
  'wrong_memo',
  'underpaid',
];

/** Where and how to pay: everything a Stellar wallet needs. */
export class PublicChargePaymentDto {
  @ApiProperty({ description: 'Treasury account of the building (G...)' })
  destination!: string;

  @ApiProperty({ example: 'USDC' })
  assetCode!: string;

  @ApiProperty({ description: 'Issuer of the asset (G...)' })
  assetIssuer!: string;

  @ApiProperty({
    description: 'Text memo the payment must carry',
    example: 'AQT-7F3K2M9QXZ',
  })
  memo!: string;

  @ApiProperty({ example: 'testnet' })
  network!: string;

  @ApiProperty({ example: 'Test SDF Network ; September 2015' })
  networkPassphrase!: string;
}

/** What the ledger recorded once the charge was paid. */
export class PublicChargePaidDto {
  @ApiProperty({ description: 'Hash of the paying transaction' })
  txHash!: string;

  @ApiProperty({ example: '2026-11-18T15:00:00.000Z' })
  paidAt!: Date;

  @ApiProperty({ example: '10.4800000' })
  paidAmountUsdc!: string;

  @ApiProperty({ description: 'Stellar account that paid (G...)' })
  payerAddress!: string;

  @ApiProperty({ description: 'Public page of the transaction' })
  explorerUrl!: string;
}

export class PublicChargeDemoDto {
  @ApiProperty({
    description: 'Whether the page may ask for test funds (testnet demo only)',
    example: false,
  })
  faucetEnabled!: boolean;
}

/**
 * The charge behind a pay link. Deliberately free of identifiers and people:
 * no UUID, no owner or tenant, and nothing about other months.
 */
export class PublicWaterChargeResponseDto {
  @ApiProperty({ example: 'Edificio Central' })
  buildingName: string;

  @ApiProperty({ example: '101' })
  apartmentNumber: string;

  @ApiProperty({ description: 'Month charged (YYYY-MM)', example: '2026-10' })
  month: string;

  @ApiPropertyOptional({
    description: 'First day of the billed period (YYYY-MM-DD)',
    nullable: true,
    example: '2026-10-01',
  })
  periodStartDate: string | null;

  @ApiPropertyOptional({
    description: 'Last day of the billed period (YYYY-MM-DD)',
    nullable: true,
    example: '2026-10-31',
  })
  periodEndDate: string | null;

  @ApiProperty({ description: 'Consumption of the month (m³)', example: 9.2 })
  consumption: number;

  @ApiProperty({ description: 'Amount owed (Bs.)', example: 124 })
  amountBs: number;

  @ApiProperty({ description: 'Bs per 1 USDC', example: 11.84 })
  exchangeRate: number;

  @ApiProperty({
    description: 'Amount to pay in USDC, 7 decimals',
    example: '10.4800000',
  })
  amountUsdc: string;

  @ApiProperty({ enum: STATUSES, example: 'pending' })
  status: WaterChargeStatus;

  @ApiProperty({ type: PublicChargePaymentDto })
  payment: PublicChargePaymentDto;

  @ApiPropertyOptional({ type: PublicChargePaidDto, nullable: true })
  paid: PublicChargePaidDto | null;

  @ApiProperty({ type: PublicChargeDemoDto })
  demo: PublicChargeDemoDto;

  constructor(view: WaterChargeView, config: StellarConfig) {
    const { charge, treasury } = view;

    this.buildingName = view.buildingName;
    this.apartmentNumber = view.apartmentNumber;
    this.month = charge.month;
    this.periodStartDate = formatDateOnly(view.periodStartDate);
    this.periodEndDate = formatDateOnly(view.periodEndDate);
    this.consumption = view.consumption;
    this.amountBs = charge.amountBs;
    this.exchangeRate = charge.exchangeRate;
    this.amountUsdc = charge.amountUsdc;
    this.status = charge.status;
    this.payment = {
      destination: treasury.publicKey,
      assetCode: treasury.assetCode,
      assetIssuer: treasury.assetIssuer,
      memo: charge.memo,
      network: treasury.network,
      networkPassphrase: networkPassphraseOf(treasury.network),
    };
    this.paid =
      charge.txHash && charge.paidAt && charge.paidAmountUsdc
        ? {
            txHash: charge.txHash,
            paidAt: charge.paidAt,
            paidAmountUsdc: charge.paidAmountUsdc,
            payerAddress: charge.payerAddress ?? '',
            explorerUrl: txUrl(config, charge.txHash),
          }
        : null;
    this.demo = { faucetEnabled: config.demoFaucetEnabled };
  }
}

export class ConfirmWaterChargeResponseDto {
  @ApiProperty({
    description:
      'What checking the transaction on the ledger concluded. Only "paid" and "already_paid" mean the charge is settled; "not_found_yet" means retry shortly.',
    enum: OUTCOMES,
    example: 'paid',
  })
  outcome: ConfirmWaterChargeOutcome;

  @ApiProperty({ type: PublicWaterChargeResponseDto })
  charge: PublicWaterChargeResponseDto;

  constructor(result: ConfirmWaterChargeResult, config: StellarConfig) {
    this.outcome = result.outcome;
    this.charge = new PublicWaterChargeResponseDto(result.charge, config);
  }
}

export class DemoFundsResponseDto {
  @ApiPropertyOptional({
    description:
      'Transaction that sent the test funds; null when the wallet already had enough',
    nullable: true,
  })
  txHash: string | null;

  @ApiProperty({
    description: 'Test funds sent, 7 decimals',
    example: '10.4800000',
  })
  amount: string;

  constructor(result: DemoFundsResult) {
    this.txHash = result.txHash;
    this.amount = result.amount;
  }
}

export class NextDemoChargeResponseDto {
  @ApiProperty({
    description: 'Pay-link code of a pending charge',
    example: '7f3k2m9qxz0a1b2c3d4e',
  })
  code: string;

  constructor(code: string) {
    this.code = code;
  }
}
