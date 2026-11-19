import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { STELLAR_ACCOUNT_PATTERN } from './create-building-treasury.dto';

export class ConfirmWaterChargeDto {
  @ApiProperty({
    description: 'Hash of the Stellar transaction that paid the charge',
    example: 'cce693a4c66c1579b2523d91b99fdd2fdd649647149814cfc1b2a560a5013f93',
  })
  @IsString()
  @Matches(/^[0-9a-fA-F]{64}$/, {
    message: 'txHash must be a 64-character transaction hash',
  })
  txHash!: string;
}

export class RequestDemoFundsDto {
  @ApiProperty({
    description: 'Stellar account (G...) of the wallet that will pay',
    example: 'GACECUEKEQW577GW2WRAN2JY5ZSTABQNXWH5XTYKF3DOBQDQFXS2GNUR',
  })
  @IsString()
  @Matches(STELLAR_ACCOUNT_PATTERN, {
    message: 'payerAddress must be a Stellar account (G...)',
  })
  payerAddress!: string;
}
