import { HorizonAccount, HorizonOperation } from './horizon.types';

export const STELLAR_GATEWAY = Symbol('STELLAR_GATEWAY');

/** Horizon could not be reached or answered something unusable. */
export class StellarGatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StellarGatewayError';
  }
}

/** The network refused a transaction; `resultCodes` are Horizon's. */
export class StellarSubmitError extends StellarGatewayError {
  constructor(
    message: string,
    readonly resultCodes?: { transaction?: string; operations?: string[] },
  ) {
    super(message);
    this.name = 'StellarSubmitError';
  }
}

/** A request the gateway refuses before touching the network. */
export class StellarInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StellarInputError';
  }
}

export interface CreateTreasuryInput {
  /** Stellar accounts (G...) of the people who will control the treasury. */
  signers: string[];
  /** How many of them must sign to move funds. */
  threshold: number;
}

export interface ListPaymentsOptions {
  cursor?: string;
  order: 'asc' | 'desc';
  limit: number;
}

/**
 * Everything the API needs from Stellar. Reads go to Horizon; the two writes
 * are signed by the server's operations account, which only exists on
 * testnet. Tests replace this port with a fake, so the SDK never loads there.
 */
export interface StellarGateway {
  /** null when the account does not exist on the network. */
  getAccount(publicKey: string): Promise<HorizonAccount | null>;

  /**
   * Operations of a transaction, each carrying the transaction itself.
   * null while Horizon does not know the hash (not ingested yet, or bogus).
   */
  getTransactionOperations(txHash: string): Promise<HorizonOperation[] | null>;

  /** Payment-like operations of an account, joined with their transactions. */
  listAccountPayments(
    publicKey: string,
    options: ListPaymentsOptions,
  ): Promise<HorizonOperation[]>;

  /**
   * Creates a treasury account in one transaction: funded, with the asset
   * trustline, the given signers and thresholds, and its master key disabled.
   * The temporary key is discarded, so only the signers can move funds.
   */
  createTreasuryAccount(
    input: CreateTreasuryInput,
  ): Promise<{ publicKey: string; txHash: string }>;

  /** Pays the configured asset from the operations account (demo faucet). */
  sendFromOps(input: {
    destination: string;
    amount: string;
    memo?: string;
  }): Promise<{ txHash: string }>;

  /** Public key of the operations account, or null when none is configured. */
  opsPublicKey(): Promise<string | null>;
}
