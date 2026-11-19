import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  StellarGatewayError,
  StellarInputError,
  StellarSubmitError,
} from '@/shared/stellar/stellar-gateway.interface';

export const STELLAR_UNAVAILABLE_MESSAGE =
  'Stellar is not available right now. Try again in a moment.';
export const STELLAR_REJECTED_MESSAGE =
  'Stellar rejected the transaction. Try again in a moment.';

/**
 * Turns a gateway failure into the HTTP answer the client can act on. There
 * is no global exception filter, so a raw gateway error would surface as 500.
 * Anything that is not a gateway error is rethrown untouched.
 */
export function rethrowStellarError(error: unknown): never {
  if (error instanceof StellarInputError) {
    throw new BadRequestException(error.message);
  }
  if (error instanceof StellarSubmitError) {
    throw new ServiceUnavailableException(STELLAR_REJECTED_MESSAGE);
  }
  if (error instanceof StellarGatewayError) {
    throw new ServiceUnavailableException(STELLAR_UNAVAILABLE_MESSAGE);
  }
  throw error;
}
