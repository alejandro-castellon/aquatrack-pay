import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StellarConfig } from '@/shared/stellar/stellar.config';
import { accountUrl, txUrl } from '@/shared/stellar/stellar-explorer';
import {
  TreasuryTransferStatus,
  TreasuryView,
} from '@modules/water-charge/application/services/treasury-view.service';

const TRANSFER_STATUSES: TreasuryTransferStatus[] = [
  'matched',
  'unmatched',
  'underpaid',
  'duplicate',
];

export class TreasurySignerResponseDto {
  @ApiProperty({ description: 'Stellar account of the signer (G...)' })
  publicKey!: string;

  @ApiProperty({ example: 'Presidenta de la directiva' })
  label!: string;
}

export class TreasuryThresholdsDto {
  @ApiProperty({ example: 2 })
  low!: number;

  @ApiProperty({ example: 2 })
  med!: number;

  @ApiProperty({ example: 2 })
  high!: number;
}

export class TreasuryOnChainSignerDto {
  @ApiProperty({ description: 'Stellar account of the signer (G...)' })
  publicKey!: string;

  @ApiProperty({ example: 1 })
  weight!: number;
}

/** What the network says about the account right now. */
export class TreasuryOnChainDto {
  @ApiProperty({
    description: 'Balance in the charge asset, 7 decimals',
    example: '104.7300000',
  })
  balance!: string;

  @ApiProperty({ example: '4.9990000' })
  xlmBalance!: string;

  @ApiProperty({
    description:
      "Weight of the account's own key. 0 means nobody, AquaTrack included, can move funds alone.",
    example: 0,
  })
  masterWeight!: number;

  @ApiProperty({ type: TreasuryThresholdsDto })
  thresholds!: TreasuryThresholdsDto;

  @ApiProperty({ type: [TreasuryOnChainSignerDto] })
  signers!: TreasuryOnChainSignerDto[];
}

export class TreasuryTransferDto {
  @ApiProperty({ description: 'Hash of the transaction' })
  txHash!: string;

  @ApiProperty({ example: '2026-11-18T15:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ description: 'Stellar account that paid (G...)' })
  payerAddress!: string;

  @ApiProperty({ example: '10.4800000' })
  amountUsdc!: string;

  @ApiPropertyOptional({
    description: 'Text memo the transfer carried',
    nullable: true,
    example: 'AQT-7F3K2M9QXZ',
  })
  memo!: string | null;

  @ApiProperty({
    description:
      'matched: settled a charge. duplicate: second payment of a settled charge. underpaid: does not cover its charge. unmatched: no known reference.',
    enum: TRANSFER_STATUSES,
    example: 'matched',
  })
  status!: TreasuryTransferStatus;

  @ApiPropertyOptional({ nullable: true, example: '101' })
  apartmentNumber!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-10' })
  month!: string | null;

  @ApiProperty({ description: 'Public page of the transaction' })
  explorerUrl!: string;
}

export class TreasuryResponseDto {
  @ApiProperty({ description: 'Stellar account of the treasury (G...)' })
  publicKey: string;

  @ApiProperty({ example: 'testnet' })
  network: string;

  @ApiProperty({ example: 'USDC' })
  assetCode: string;

  @ApiProperty({ description: 'Issuer of the asset (G...)' })
  assetIssuer: string;

  @ApiProperty({
    description: 'Signatures needed to move funds',
    example: 2,
  })
  threshold: number;

  @ApiProperty({
    description: 'The signers as they were named at setup',
    type: [TreasurySignerResponseDto],
  })
  signers: TreasurySignerResponseDto[];

  @ApiProperty({ description: 'Transaction that created the treasury' })
  setupTxHash: string;

  @ApiProperty({ example: '2026-11-18T15:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ description: 'Public page of the account' })
  explorerUrl: string;

  @ApiPropertyOptional({
    description: 'Live state on the network; null when it cannot be read',
    type: TreasuryOnChainDto,
    nullable: true,
  })
  onChain: TreasuryOnChainDto | null;

  @ApiProperty({
    description:
      'Latest incoming transfers in the charge asset, newest first (up to 50)',
    type: [TreasuryTransferDto],
  })
  transfers: TreasuryTransferDto[];

  constructor(view: TreasuryView, config: StellarConfig) {
    const { treasury } = view;

    this.publicKey = treasury.publicKey;
    this.network = treasury.network;
    this.assetCode = treasury.assetCode;
    this.assetIssuer = treasury.assetIssuer;
    this.threshold = treasury.threshold;
    this.signers = treasury.signers;
    this.setupTxHash = treasury.setupTxHash;
    this.createdAt = treasury.createdAt;
    this.explorerUrl = accountUrl(config, treasury.publicKey);
    this.onChain = view.onChain;
    this.transfers = view.transfers.map((transfer) => ({
      ...transfer,
      explorerUrl: txUrl(config, transfer.txHash),
    }));
  }
}

export class BuildingTreasuryResponseDto {
  @ApiPropertyOptional({
    description: 'null while the building has no treasury',
    type: TreasuryResponseDto,
    nullable: true,
  })
  treasury: TreasuryResponseDto | null;

  constructor(view: TreasuryView | null, config: StellarConfig) {
    this.treasury = view ? new TreasuryResponseDto(view, config) : null;
  }
}
