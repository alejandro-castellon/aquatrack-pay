import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import stellarConfig, { StellarConfig } from '@/shared/stellar/stellar.config';
import {
  ConflictErrorResponseDto,
  ErrorResponseDto,
  ValidationErrorResponseDto,
} from '@/shared/swagger/dtos/error-response.dto';
import { JwtAuthGuard } from '@modules/auth/infrastructure/guards/jwt-auth.guard';
import { RolesGuard } from '@modules/auth/infrastructure/guards/roles.guard';
import { Roles } from '@modules/auth/infrastructure/decorators/roles.decorator';
import { AuthRequest } from '@modules/auth/domain/auth-request.interface';
import { UserRole } from '@modules/user/domain/user.entity';
import { PublishWaterChargesUseCase } from '@modules/water-charge/application/use-cases/publish-water-charges';
import { ListWaterChargesByBuildingUseCase } from '@modules/water-charge/application/use-cases/list-water-charges-by-building';
import { ListWaterChargesByApartmentUseCase } from '@modules/water-charge/application/use-cases/list-water-charges-by-apartment';
import {
  ListWaterChargesQueryDto,
  PublishWaterChargesDto,
} from './dtos/publish-water-charges.dto';
import {
  PublishWaterChargesResponseDto,
  WaterChargeResponseDto,
} from './dtos/water-charge-response.dto';

@ApiTags('Water Charges')
@Controller('water-charges')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Unauthorized - Invalid or missing token',
})
@ApiForbiddenResponse({
  description: 'Forbidden - Not your building or apartment',
})
export class WaterChargeController {
  constructor(
    private readonly publishWaterChargesUseCase: PublishWaterChargesUseCase,
    private readonly listWaterChargesByBuildingUseCase: ListWaterChargesByBuildingUseCase,
    private readonly listWaterChargesByApartmentUseCase: ListWaterChargesByApartmentUseCase,
    @Inject(stellarConfig.KEY)
    private readonly config: StellarConfig,
  ) {}

  @Post('publish')
  @Roles('admin', 'super_admin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Publish the charges of a saved month',
    description:
      "Creates one payable charge per apartment that owes something in the building's saved prorrateo of that month, each with its USDC amount (Bs converted at the given rate, rounded up to the cent), its payment memo and its pay link. Idempotent: publishing again only adds the missing ones and never changes an existing charge. The building needs a treasury first.",
  })
  @ApiBody({
    type: PublishWaterChargesDto,
    examples: {
      default: {
        summary: 'Publish October',
        value: {
          buildingId: '9f7b3a46-946e-4e75-a0f3-dce1c07e7f4a',
          month: '2026-10',
          bsPerUsdc: 11.84,
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Charges of the month, with how many this call created',
    type: PublishWaterChargesResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid input, or no exchange rate given nor configured',
    type: ValidationErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Building not found, or no consumption saved for that month',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'The building has no treasury yet',
    type: ConflictErrorResponseDto,
  })
  async publish(
    @Body() dto: PublishWaterChargesDto,
    @Req() req: AuthRequest,
  ): Promise<PublishWaterChargesResponseDto> {
    const result = await this.publishWaterChargesUseCase.execute(
      {
        buildingId: dto.buildingId,
        month: dto.month,
        bsPerUsdc: dto.bsPerUsdc,
      },
      req.user.role as UserRole,
      req.user.sub,
    );
    return new PublishWaterChargesResponseDto(result, this.config);
  }

  @Get('by-building/:buildingId')
  @Roles('admin', 'super_admin')
  @ApiOperation({
    summary: 'List the charges of a building for a month',
    description:
      'Charges of every apartment of the building for that month, ordered by floor and apartment number, with their payment status.',
  })
  @ApiParam({
    name: 'buildingId',
    type: 'string',
    format: 'uuid',
    description: 'Building unique identifier',
    example: '9f7b3a46-946e-4e75-a0f3-dce1c07e7f4a',
  })
  @ApiOkResponse({
    description: 'Charges retrieved',
    type: [WaterChargeResponseDto],
  })
  @ApiBadRequestResponse({
    description: 'Invalid UUID or month format',
    type: ValidationErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Building not found',
    type: ErrorResponseDto,
  })
  async findByBuilding(
    @Param('buildingId', ParseUUIDPipe) buildingId: string,
    @Query() query: ListWaterChargesQueryDto,
    @Req() req: AuthRequest,
  ): Promise<WaterChargeResponseDto[]> {
    const views = await this.listWaterChargesByBuildingUseCase.execute(
      buildingId,
      query.month,
      req.user.role as UserRole,
      req.user.sub,
    );
    return views.map((view) => new WaterChargeResponseDto(view, this.config));
  }

  @Get('by-apartment/:apartmentId')
  @Roles('admin', 'owner', 'tenant', 'super_admin')
  @ApiOperation({
    summary: 'List the charges of an apartment',
    description:
      "Every charge of the apartment, newest month first. Open to the admins of its building and to the apartment's own owner and tenant.",
  })
  @ApiParam({
    name: 'apartmentId',
    type: 'string',
    format: 'uuid',
    description: 'Apartment unique identifier',
    example: '1a2b3c4d-5678-90ab-cdef-1234567890ab',
  })
  @ApiOkResponse({
    description: 'Charges retrieved',
    type: [WaterChargeResponseDto],
  })
  @ApiBadRequestResponse({
    description: 'Invalid UUID format',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Apartment not found',
    type: ErrorResponseDto,
  })
  async findByApartment(
    @Param('apartmentId', ParseUUIDPipe) apartmentId: string,
    @Req() req: AuthRequest,
  ): Promise<WaterChargeResponseDto[]> {
    const views = await this.listWaterChargesByApartmentUseCase.execute(
      apartmentId,
      req.user.role as UserRole,
      req.user.sub,
    );
    return views.map((view) => new WaterChargeResponseDto(view, this.config));
  }
}
