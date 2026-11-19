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
  ApiServiceUnavailableResponse,
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
import { GetBuildingTreasuryUseCase } from '@modules/water-charge/application/use-cases/get-building-treasury';
import { CreateBuildingTreasuryUseCase } from '@modules/water-charge/application/use-cases/create-building-treasury';
import { CreateBuildingTreasuryDto } from './dtos/create-building-treasury.dto';
import { BuildingTreasuryResponseDto } from './dtos/building-treasury-response.dto';

const BUILDING_ID_PARAM = {
  name: 'buildingId',
  type: 'string',
  format: 'uuid',
  description: 'Building unique identifier',
  example: '9f7b3a46-946e-4e75-a0f3-dce1c07e7f4a',
} as const;

@ApiTags('Building Treasury')
@Controller('buildings/:buildingId/treasury')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Unauthorized - Invalid or missing token',
})
@ApiForbiddenResponse({
  description: 'Forbidden - You are not an admin of this building',
})
export class BuildingTreasuryController {
  constructor(
    private readonly getBuildingTreasuryUseCase: GetBuildingTreasuryUseCase,
    private readonly createBuildingTreasuryUseCase: CreateBuildingTreasuryUseCase,
    @Inject(stellarConfig.KEY)
    private readonly config: StellarConfig,
  ) {}

  @Get()
  @Roles('admin', 'super_admin')
  @ApiOperation({
    summary: 'Get the building treasury',
    description:
      'Returns the Stellar account that receives the building\'s water charges: who signs, what it holds on the network and the latest incoming transfers. "treasury" is null while the building has none. Reading it also settles the charges paid since the last look. When Stellar cannot be reached the answer is still 200, with "onChain" null and no transfers.',
  })
  @ApiParam(BUILDING_ID_PARAM)
  @ApiOkResponse({
    description: 'Treasury retrieved (or null)',
    type: BuildingTreasuryResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid UUID format',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Building not found',
    type: ErrorResponseDto,
  })
  async find(
    @Param('buildingId', ParseUUIDPipe) buildingId: string,
    @Req() req: AuthRequest,
  ): Promise<BuildingTreasuryResponseDto> {
    const view = await this.getBuildingTreasuryUseCase.execute(
      buildingId,
      req.user.role as UserRole,
      req.user.sub,
    );
    return new BuildingTreasuryResponseDto(view, this.config);
  }

  @Post()
  @Roles('admin', 'super_admin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create the building treasury',
    description:
      'Creates a Stellar account for the building in one transaction: funded, able to hold the charge asset, controlled by the given signers ("threshold" of them must sign together) and with its own key disabled. The server pays for the setup and keeps no key of the account. Testnet only.',
  })
  @ApiParam(BUILDING_ID_PARAM)
  @ApiBody({
    type: CreateBuildingTreasuryDto,
    examples: {
      default: {
        summary: 'Two of three board members',
        value: {
          signers: [
            {
              publicKey:
                'GAKQZFNHCK3DGMXN4VOPBGGPYTN67VJF47V5T6FPU3WOCWIUG3B75SST',
              label: 'Administrador',
            },
            {
              publicKey:
                'GBHJPTVKJ2E6M4TRRPMNJMJ6IZLTRS3AGDOPIVL6Y3CLVZ33BMBQEH6P',
              label: 'Presidenta de la directiva',
            },
            {
              publicKey:
                'GACECUEKEQW577GW2WRAN2JY5ZSTABQNXWH5XTYKF3DOBQDQFXS2GNUR',
              label: 'Tesorero',
            },
          ],
          threshold: 2,
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Treasury created',
    type: BuildingTreasuryResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid input: malformed or repeated signers, or a threshold above their number',
    type: ValidationErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Building not found',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'The building already has a treasury',
    type: ConflictErrorResponseDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'Stellar is not available or rejected the transaction',
    type: ErrorResponseDto,
  })
  async create(
    @Param('buildingId', ParseUUIDPipe) buildingId: string,
    @Body() dto: CreateBuildingTreasuryDto,
    @Req() req: AuthRequest,
  ): Promise<BuildingTreasuryResponseDto> {
    const view = await this.createBuildingTreasuryUseCase.execute(
      buildingId,
      { signers: dto.signers, threshold: dto.threshold },
      req.user.role as UserRole,
      req.user.sub,
    );
    return new BuildingTreasuryResponseDto(view, this.config);
  }
}
