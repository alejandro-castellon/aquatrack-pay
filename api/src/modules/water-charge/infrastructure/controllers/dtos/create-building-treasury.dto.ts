import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/** Shape of a Stellar account id; the network validates the checksum. */
export const STELLAR_ACCOUNT_PATTERN = /^G[A-Z2-7]{55}$/;

export class TreasurySignerDto {
  @ApiProperty({
    description: 'Stellar account (G...) of a person who will sign',
    example: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  })
  @IsString()
  @Matches(STELLAR_ACCOUNT_PATTERN, {
    message: 'publicKey must be a Stellar account (G...)',
  })
  publicKey!: string;

  @ApiProperty({
    description: 'Who that signer is, as the building knows them',
    example: 'Presidenta de la directiva',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  label!: string;
}

export class CreateBuildingTreasuryDto {
  @ApiProperty({
    description: 'People who will control the treasury (1 to 10)',
    type: [TreasurySignerDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => TreasurySignerDto)
  signers!: TreasurySignerDto[];

  @ApiProperty({
    description: 'How many of the signers must sign to move funds',
    example: 2,
  })
  @IsInt()
  @Min(1)
  @Max(10)
  threshold!: number;
}
