import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StellarConfig } from '@/shared/stellar/stellar.config';
import { txUrl } from '@/shared/stellar/stellar-explorer';
import {
  WaterChargeStatus,
  WaterChargeView,
} from '@modules/water-charge/domain/water-charge.entity';
import { PublishWaterChargesResult } from '@modules/water-charge/application/use-cases/publish-water-charges';

const STATUSES: WaterChargeStatus[] = ['pending', 'paid', 'cancelled'];

/** A charge as the building's admin and the apartment's residents see it. */
export class WaterChargeResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  apartmentId: string;

  @ApiProperty({ example: '101' })
  apartmentNumber: string;

  @ApiProperty({ example: 1 })
  apartmentFloor: number;

  @ApiProperty({ format: 'uuid' })
  buildingId: string;

  @ApiProperty({ description: 'Month charged (YYYY-MM)', example: '2026-10' })
  month: string;

  @ApiProperty({ description: 'Consumption of the month (m³)', example: 9.2 })
  consumption: number;

  @ApiProperty({ description: 'Amount owed (Bs.)', example: 124 })
  amountBs: number;

  @ApiProperty({
    description: 'Bs per 1 USDC, fixed when the charge was published',
    example: 11.84,
  })
  exchangeRate: number;

  @ApiProperty({
    description: 'Amount to pay in USDC, 7 decimals',
    example: '10.4800000',
  })
  amountUsdc: string;

  @ApiProperty({
    description: 'Code of the asset the charge is paid in',
    example: 'USDC',
  })
  assetCode: string;

  @ApiProperty({ enum: STATUSES, example: 'pending' })
  status: WaterChargeStatus;

  @ApiProperty({
    description: 'Code of the public pay link',
    example: '7f3k2m9qxz0a1b2c3d4e',
  })
  publicCode: string;

  @ApiProperty({
    description: 'Text memo the payment must carry',
    example: 'AQT-7F3K2M9QXZ',
  })
  memo: string;

  @ApiPropertyOptional({
    description: 'Hash of the transaction that paid it',
    nullable: true,
    example: null,
  })
  txHash: string | null;

  @ApiPropertyOptional({
    description: 'Stellar account that paid',
    nullable: true,
    example: null,
  })
  payerAddress: string | null;

  @ApiPropertyOptional({
    description: 'USDC received, 7 decimals',
    nullable: true,
    example: null,
  })
  paidAmountUsdc: string | null;

  @ApiPropertyOptional({ nullable: true, example: null })
  paidAt: Date | null;

  @ApiPropertyOptional({
    description: 'Public page of the paying transaction',
    nullable: true,
    example: null,
  })
  explorerUrl: string | null;

  @ApiProperty({ example: '2026-11-18T15:00:00.000Z' })
  createdAt: Date;

  constructor(view: WaterChargeView, config: StellarConfig) {
    const { charge } = view;

    this.id = charge.id;
    this.apartmentId = charge.apartmentId;
    this.apartmentNumber = view.apartmentNumber;
    this.apartmentFloor = view.apartmentFloor;
    this.buildingId = charge.buildingId;
    this.month = charge.month;
    this.consumption = view.consumption;
    this.amountBs = charge.amountBs;
    this.exchangeRate = charge.exchangeRate;
    this.amountUsdc = charge.amountUsdc;
    this.assetCode = view.treasury.assetCode;
    this.status = charge.status;
    this.publicCode = charge.publicCode;
    this.memo = charge.memo;
    this.txHash = charge.txHash;
    this.payerAddress = charge.payerAddress;
    this.paidAmountUsdc = charge.paidAmountUsdc;
    this.paidAt = charge.paidAt;
    this.explorerUrl = charge.txHash ? txUrl(config, charge.txHash) : null;
    this.createdAt = charge.createdAt;
  }
}

export class PublishWaterChargesResponseDto {
  @ApiProperty({
    description:
      'Charges created by this call; 0 when the month was already published',
    example: 10,
  })
  created: number;

  @ApiProperty({
    description: 'Every charge of the building for that month',
    type: [WaterChargeResponseDto],
  })
  charges: WaterChargeResponseDto[];

  constructor(result: PublishWaterChargesResult, config: StellarConfig) {
    this.created = result.created;
    this.charges = result.charges.map(
      (view) => new WaterChargeResponseDto(view, config),
    );
  }
}
