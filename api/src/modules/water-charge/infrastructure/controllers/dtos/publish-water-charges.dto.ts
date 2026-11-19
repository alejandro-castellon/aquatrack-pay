import {
  IsNumber,
  IsOptional,
  IsPositive,
  IsUUID,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const CHARGE_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export class PublishWaterChargesDto {
  @ApiProperty({
    description: 'Building whose saved month is published',
    format: 'uuid',
    example: '9f7b3a46-946e-4e75-a0f3-dce1c07e7f4a',
  })
  @IsUUID()
  buildingId!: string;

  @ApiProperty({
    description: 'Month of the saved prorrateo (YYYY-MM)',
    example: '2026-10',
  })
  @Matches(CHARGE_MONTH_PATTERN, { message: 'month must be YYYY-MM' })
  month!: string;

  @ApiPropertyOptional({
    description:
      'Bs per 1 USDC, fixed on the charges it creates. Defaults to the configured reference rate.',
    example: 11.84,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  bsPerUsdc?: number;
}

export class ListWaterChargesQueryDto {
  @ApiProperty({
    description: 'Month of the charges (YYYY-MM)',
    example: '2026-10',
  })
  @Matches(CHARGE_MONTH_PATTERN, { message: 'month must be YYYY-MM' })
  month!: string;
}
