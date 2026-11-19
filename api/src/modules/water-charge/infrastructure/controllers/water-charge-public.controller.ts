import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import stellarConfig, { StellarConfig } from '@/shared/stellar/stellar.config';
import {
  ConflictErrorResponseDto,
  ErrorResponseDto,
  ValidationErrorResponseDto,
} from '@/shared/swagger/dtos/error-response.dto';
import { GetPublicWaterChargeUseCase } from '@modules/water-charge/application/use-cases/get-public-water-charge';
import { ConfirmWaterChargeTransferUseCase } from '@modules/water-charge/application/use-cases/confirm-water-charge-transfer';
import { RequestDemoFundsUseCase } from '@modules/water-charge/application/use-cases/request-demo-funds';
import { GetNextDemoChargeUseCase } from '@modules/water-charge/application/use-cases/get-next-demo-charge';
import {
  ConfirmWaterChargeDto,
  RequestDemoFundsDto,
} from './dtos/public-water-charge-request.dto';
import {
  ConfirmWaterChargeResponseDto,
  DemoFundsResponseDto,
  NextDemoChargeResponseDto,
  PublicWaterChargeResponseDto,
} from './dtos/public-water-charge-response.dto';

const CODE_PARAM = {
  name: 'code',
  type: 'string',
  description: 'Code of the pay link (20 characters)',
  example: '7f3k2m9qxz0a1b2c3d4e',
} as const;

/**
 * Pay page endpoints. No guards on purpose: the holder of a pay link pays
 * without an AquaTrack account. The unguessable code is the only credential,
 * and the answers carry no identifier, no person and no other charge.
 */
@ApiTags('Water Charges')
@Controller('water-charges/public')
export class WaterChargePublicController {
  constructor(
    private readonly getPublicWaterChargeUseCase: GetPublicWaterChargeUseCase,
    private readonly confirmWaterChargeTransferUseCase: ConfirmWaterChargeTransferUseCase,
    private readonly requestDemoFundsUseCase: RequestDemoFundsUseCase,
    private readonly getNextDemoChargeUseCase: GetNextDemoChargeUseCase,
    @Inject(stellarConfig.KEY)
    private readonly config: StellarConfig,
  ) {}

  @Get('demo/next')
  @ApiOperation({
    summary: 'Get a pending charge to try the demo (testnet)',
    description:
      'Returns the pay-link code of a random pending charge, for the demo guide. 404 unless the demo is enabled, or when no charge is pending.',
  })
  @ApiOkResponse({
    description: 'Code of a pending charge',
    type: NextDemoChargeResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Demo disabled or no pending charge',
    type: ErrorResponseDto,
  })
  async nextDemoCharge(): Promise<NextDemoChargeResponseDto> {
    return new NextDemoChargeResponseDto(
      await this.getNextDemoChargeUseCase.execute(),
    );
  }

  @Get(':code')
  @ApiOperation({
    summary: 'Get the charge behind a pay link',
    description:
      'What to pay and where: the amount in Bs and USDC, the treasury account, the asset and the memo. Once paid it also carries the transaction that paid it.',
  })
  @ApiParam(CODE_PARAM)
  @ApiOkResponse({
    description: 'Charge retrieved',
    type: PublicWaterChargeResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Unknown or malformed code',
    type: ErrorResponseDto,
  })
  async find(
    @Param('code') code: string,
  ): Promise<PublicWaterChargeResponseDto> {
    const view = await this.getPublicWaterChargeUseCase.execute(code);
    return new PublicWaterChargeResponseDto(view, this.config);
  }

  @Post(':code/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm the transaction that paid a charge',
    description:
      'Looks the transaction up on the ledger and settles the charge when it credited the treasury with the full amount, in the charge asset and with the charge memo. It records only what the ledger says, so it is safe to call by anyone. "not_found_yet" means the network has not ingested the transaction: retry in a few seconds.',
  })
  @ApiParam(CODE_PARAM)
  @ApiBody({ type: ConfirmWaterChargeDto })
  @ApiOkResponse({
    description: 'Outcome of the check and the charge as it stands',
    type: ConfirmWaterChargeResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Malformed transaction hash',
    type: ValidationErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Unknown or malformed code',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'The charge was cancelled',
    type: ConflictErrorResponseDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'Stellar is not available',
    type: ErrorResponseDto,
  })
  async confirm(
    @Param('code') code: string,
    @Body() dto: ConfirmWaterChargeDto,
  ): Promise<ConfirmWaterChargeResponseDto> {
    const result = await this.confirmWaterChargeTransferUseCase.execute(
      code,
      dto.txHash,
    );
    return new ConfirmWaterChargeResponseDto(result, this.config);
  }

  @Post(':code/demo-funds')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ask for test funds to pay a charge (testnet)',
    description:
      'Demo faucet: sends the paying wallet only the test USDC it is short of for this charge, at most twice per charge. The wallet must already exist and hold the asset trustline. 404 unless the demo is enabled.',
  })
  @ApiParam(CODE_PARAM)
  @ApiBody({ type: RequestDemoFundsDto })
  @ApiOkResponse({
    description: 'What was sent; nothing when the wallet already had enough',
    type: DemoFundsResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Malformed account, or a wallet that does not exist yet or lacks the trustline',
    type: ValidationErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Demo disabled, or unknown code',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'The charge is not pending or already used its test funds',
    type: ConflictErrorResponseDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'Stellar is not available or rejected the transfer',
    type: ErrorResponseDto,
  })
  async demoFunds(
    @Param('code') code: string,
    @Body() dto: RequestDemoFundsDto,
  ): Promise<DemoFundsResponseDto> {
    const result = await this.requestDemoFundsUseCase.execute(
      code,
      dto.payerAddress,
    );
    return new DemoFundsResponseDto(result);
  }
}
