import { Inject, Injectable, Logger } from '@nestjs/common';
import type * as StellarSdk from '@stellar/stellar-sdk';
import {
  HorizonAccount,
  HorizonOperation,
  HorizonSubmitResult,
  HorizonTransaction,
} from './horizon.types';
import {
  CreateTreasuryInput,
  ListPaymentsOptions,
  StellarGateway,
  StellarGatewayError,
  StellarInputError,
  StellarSubmitError,
} from './stellar-gateway.interface';
import stellarConfig, { StellarConfig } from './stellar.config';

type Sdk = typeof StellarSdk;

const ACCOUNT_ID_PATTERN = /^G[A-Z2-7]{55}$/;
const TX_HASH_PATTERN = /^[0-9a-f]{64}$/;

/** Covers the reserve of a trustline and a few signers, plus the board's own fees. */
const TREASURY_STARTING_XLM = '5';
const MAX_TREASURY_SIGNERS = 10;
/** Stroops per operation: ten times the minimum, so testnet surges do not stall setup. */
const OPERATION_FEE = '1000';
const READ_TIMEOUT_MS = 15_000;
const SUBMIT_TIMEOUT_MS = 60_000;
const TX_TIMEOUT_SECONDS = 120;

interface HorizonPage<T> {
  _embedded: { records: T[] };
}

interface HorizonProblem {
  title?: string;
  hash?: string;
  ledger?: number;
  successful?: boolean;
  extras?: {
    hash?: string;
    result_codes?: { transaction?: string; operations?: string[] };
  };
}

@Injectable()
export class HorizonStellarGateway implements StellarGateway {
  private readonly logger = new Logger(HorizonStellarGateway.name);
  /** Serializes transactions of the operations account: one sequence number at a time. */
  private opsQueue: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(stellarConfig.KEY)
    private readonly config: StellarConfig,
  ) {}

  async getAccount(publicKey: string): Promise<HorizonAccount | null> {
    if (!ACCOUNT_ID_PATTERN.test(publicKey)) return null;
    return this.horizonGet<HorizonAccount>(`/accounts/${publicKey}`);
  }

  async getTransactionOperations(
    txHash: string,
  ): Promise<HorizonOperation[] | null> {
    const hash = txHash.trim().toLowerCase();
    if (!TX_HASH_PATTERN.test(hash)) return null;

    const transaction = await this.horizonGet<HorizonTransaction>(
      `/transactions/${hash}`,
    );
    if (!transaction) return null;

    // Ask by the hash Horizon reports: for a fee bump the caller may hold the
    // inner hash while the operations hang from the outer one.
    const page = await this.horizonGet<HorizonPage<HorizonOperation>>(
      `/transactions/${transaction.hash}/operations?limit=200&order=asc`,
    );
    if (!page) return null;

    return page._embedded.records.map((operation) => ({
      ...operation,
      transaction,
    }));
  }

  async listAccountPayments(
    publicKey: string,
    options: ListPaymentsOptions,
  ): Promise<HorizonOperation[]> {
    if (!ACCOUNT_ID_PATTERN.test(publicKey)) return [];

    const query = new URLSearchParams({
      order: options.order,
      limit: String(Math.min(Math.max(options.limit, 1), 200)),
      join: 'transactions',
    });
    if (options.cursor) query.set('cursor', options.cursor);

    const page = await this.horizonGet<HorizonPage<HorizonOperation>>(
      `/accounts/${publicKey}/payments?${query.toString()}`,
    );
    return page?._embedded.records ?? [];
  }

  async createTreasuryAccount(
    input: CreateTreasuryInput,
  ): Promise<{ publicKey: string; txHash: string }> {
    const { sdk, keypair: ops } = await this.requireOps();
    const signers = [...new Set(input.signers)];

    if (signers.length !== input.signers.length) {
      throw new StellarInputError('Each signer can only appear once');
    }
    if (signers.length < 1 || signers.length > MAX_TREASURY_SIGNERS) {
      throw new StellarInputError(
        `A treasury needs between 1 and ${MAX_TREASURY_SIGNERS} signers`,
      );
    }
    if (
      !Number.isInteger(input.threshold) ||
      input.threshold < 1 ||
      input.threshold > signers.length
    ) {
      throw new StellarInputError(
        'The threshold must be between 1 and the number of signers',
      );
    }
    for (const signer of signers) {
      if (!sdk.StrKey.isValidEd25519PublicKey(signer)) {
        throw new StellarInputError(`Invalid Stellar account: ${signer}`);
      }
      if (signer === ops.publicKey()) {
        throw new StellarInputError(
          'The operations account cannot be a signer of a treasury',
        );
      }
    }

    // The treasury key only lives inside this call. After the transaction its
    // weight is 0, so nobody, this server included, can sign with it.
    const treasury = sdk.Keypair.random();
    const treasuryId = treasury.publicKey();
    const asset = new sdk.Asset(this.config.assetCode, this.config.assetIssuer);

    const result = await this.submitFromOps(sdk, ops, [treasury], (builder) => {
      builder
        .addOperation(
          sdk.Operation.createAccount({
            destination: treasuryId,
            startingBalance: TREASURY_STARTING_XLM,
          }),
        )
        .addOperation(sdk.Operation.changeTrust({ asset, source: treasuryId }));

      for (const signer of signers) {
        builder.addOperation(
          sdk.Operation.setOptions({
            signer: { ed25519PublicKey: signer, weight: 1 },
            source: treasuryId,
          }),
        );
      }

      // Last: signatures of the whole transaction are checked before any
      // operation applies, so disabling the master key here is safe.
      builder.addOperation(
        sdk.Operation.setOptions({
          masterWeight: 0,
          lowThreshold: input.threshold,
          medThreshold: input.threshold,
          highThreshold: input.threshold,
          source: treasuryId,
        }),
      );
    });

    this.logger.log(
      `Treasury ${treasuryId} created (${input.threshold} of ${signers.length}) in ${result.hash}`,
    );
    return { publicKey: treasuryId, txHash: result.hash };
  }

  async sendFromOps(input: {
    destination: string;
    amount: string;
    memo?: string;
  }): Promise<{ txHash: string }> {
    const { sdk, keypair: ops } = await this.requireOps();

    if (!sdk.StrKey.isValidEd25519PublicKey(input.destination)) {
      throw new StellarInputError(
        `Invalid Stellar account: ${input.destination}`,
      );
    }

    const asset = new sdk.Asset(this.config.assetCode, this.config.assetIssuer);
    const result = await this.submitFromOps(
      sdk,
      ops,
      [],
      (builder) => {
        builder.addOperation(
          sdk.Operation.payment({
            destination: input.destination,
            asset,
            amount: input.amount,
          }),
        );
      },
      input.memo,
    );

    return { txHash: result.hash };
  }

  async opsPublicKey(): Promise<string | null> {
    if (!this.config.opsSecret) return null;
    const { keypair } = await this.requireOps();
    return keypair.publicKey();
  }

  // The SDK is loaded on first use: Jest 29 cannot load it (its CommonJS
  // entry requires ES-module-only packages), and reads never need it.
  private loadSdk(): Promise<Sdk> {
    return import('@stellar/stellar-sdk');
  }

  private async requireOps(): Promise<{
    sdk: Sdk;
    keypair: StellarSdk.Keypair;
  }> {
    if (this.config.network !== 'testnet') {
      throw new StellarInputError(
        'The server only signs on testnet; on the public network the board creates its own treasury',
      );
    }
    if (!this.config.opsSecret) {
      throw new StellarInputError(
        'The operations account is not configured (STELLAR_OPS_SECRET)',
      );
    }

    const sdk = await this.loadSdk();
    try {
      return { sdk, keypair: sdk.Keypair.fromSecret(this.config.opsSecret) };
    } catch {
      throw new StellarInputError(
        'STELLAR_OPS_SECRET is not a valid secret key',
      );
    }
  }

  /**
   * Builds, signs and submits a transaction whose source is the operations
   * account. Calls are queued so two requests never race for the same
   * sequence number; a stale sequence is retried once.
   */
  private submitFromOps(
    sdk: Sdk,
    ops: StellarSdk.Keypair,
    extraSigners: StellarSdk.Keypair[],
    addOperations: (builder: StellarSdk.TransactionBuilder) => void,
    memo?: string,
  ): Promise<HorizonSubmitResult> {
    const attempt = async (): Promise<HorizonSubmitResult> => {
      const account = await this.getAccount(ops.publicKey());
      if (!account) {
        throw new StellarGatewayError(
          `The operations account ${ops.publicKey()} does not exist on ${this.config.network}`,
        );
      }

      const builder = new sdk.TransactionBuilder(
        new sdk.Account(account.account_id, account.sequence),
        {
          fee: OPERATION_FEE,
          networkPassphrase: this.config.networkPassphrase,
        },
      );
      addOperations(builder);
      if (memo) builder.addMemo(sdk.Memo.text(memo));

      const transaction = builder.setTimeout(TX_TIMEOUT_SECONDS).build();
      transaction.sign(ops, ...extraSigners);
      return this.submit(transaction.toXDR());
    };

    const run = async (): Promise<HorizonSubmitResult> => {
      try {
        return await attempt();
      } catch (error) {
        if (
          error instanceof StellarSubmitError &&
          error.resultCodes?.transaction === 'tx_bad_seq'
        ) {
          return attempt();
        }
        throw error;
      }
    };

    const queued = this.opsQueue.then(run, run);
    this.opsQueue = queued.catch(() => undefined);
    return queued;
  }

  private async submit(xdr: string): Promise<HorizonSubmitResult> {
    let response: Response;
    try {
      response = await fetch(`${this.config.horizonUrl}/transactions`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ tx: xdr }).toString(),
        signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
      });
    } catch (error) {
      throw new StellarGatewayError(
        `Could not reach Horizon to submit: ${this.describe(error)}`,
      );
    }

    const body = (await response
      .json()
      .catch(() => null)) as HorizonProblem | null;

    if (response.ok && body?.hash && body.successful !== false) {
      return { hash: body.hash, ledger: body.ledger ?? 0, successful: true };
    }

    // 504: Horizon stopped waiting, but the transaction may still be applied.
    if (response.status === 504 && body?.extras?.hash) {
      return this.waitForTransaction(body.extras.hash);
    }

    const codes = body?.extras?.result_codes;
    throw new StellarSubmitError(
      `Stellar rejected the transaction: ${
        codes ? JSON.stringify(codes) : (body?.title ?? response.status)
      }`,
      codes,
    );
  }

  private async waitForTransaction(hash: string): Promise<HorizonSubmitResult> {
    for (let attempt = 0; attempt < 15; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const transaction = await this.horizonGet<HorizonTransaction>(
        `/transactions/${hash}`,
      );
      if (transaction) {
        if (!transaction.successful) {
          throw new StellarSubmitError(`Transaction ${hash} failed`);
        }
        return {
          hash: transaction.hash,
          ledger: transaction.ledger,
          successful: true,
        };
      }
    }
    throw new StellarGatewayError(
      `Transaction ${hash} was not confirmed in time`,
    );
  }

  /** GET on Horizon: null on 404, StellarGatewayError on anything else that is not 2xx. */
  private async horizonGet<T>(path: string): Promise<T | null> {
    let response: Response;
    try {
      response = await fetch(`${this.config.horizonUrl}${path}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });
    } catch (error) {
      throw new StellarGatewayError(
        `Could not reach Horizon: ${this.describe(error)}`,
      );
    }

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new StellarGatewayError(
        `Horizon answered ${response.status} for ${path.split('?')[0]}`,
      );
    }
    return (await response.json()) as T;
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
