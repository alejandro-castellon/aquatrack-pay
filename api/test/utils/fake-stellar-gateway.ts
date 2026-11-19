import { randomBytes } from 'crypto';
import {
  HorizonAccount,
  HorizonOperation,
  HorizonTransaction,
} from '@/shared/stellar/horizon.types';
import {
  CreateTreasuryInput,
  ListPaymentsOptions,
  StellarGateway,
  StellarGatewayError,
  StellarInputError,
} from '@/shared/stellar/stellar-gateway.interface';
import { fromStroops, toStroops } from '@/shared/stellar/stellar-amount';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Circle's testnet USDC, the default asset of the `stellar` config. */
export const FAKE_ASSET_CODE = 'USDC';
export const FAKE_ASSET_ISSUER =
  'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

/** A string shaped like a Stellar account id (no valid checksum). */
export function fakeAccountId(): string {
  let id = 'G';
  for (const byte of randomBytes(55)) id += BASE32[byte & 31];
  return id;
}

export function fakeTxHash(): string {
  return randomBytes(32).toString('hex');
}

export interface FakePaymentInput {
  from: string;
  to: string;
  /** One amount per payment operation of the transaction. */
  amounts: string[];
  memo?: string | null;
  assetCode?: string;
  assetIssuer?: string;
  successful?: boolean;
  /** Makes it a fee bump: Horizon then answers to both hashes. */
  feeBump?: boolean;
  createdAt?: string;
}

/**
 * In-memory stand-in for Horizon and the operations account, for tests. It
 * keeps accounts and a ledger of operations, and answers like Horizon does:
 * unknown things are null, a fee bump is found by either hash, payments are
 * listed by paging token. Nothing here touches the network or the SDK.
 */
export class FakeStellarGateway implements StellarGateway {
  assetCode = FAKE_ASSET_CODE;
  assetIssuer = FAKE_ASSET_ISSUER;
  /** null simulates a server without STELLAR_OPS_SECRET. */
  opsKey: string | null = fakeAccountId();
  /** While true every call fails as if Horizon were unreachable. */
  down = false;

  private readonly accounts = new Map<string, HorizonAccount>();
  private operations: HorizonOperation[] = [];
  /** Operation id -> account created by it: Horizon lists it in that account's payments. */
  private readonly createdAccounts = new Map<string, string>();
  private counter = 0;

  reset(): void {
    this.accounts.clear();
    this.operations = [];
    this.createdAccounts.clear();
    this.counter = 0;
    this.down = false;
    this.opsKey = fakeAccountId();
  }

  /** Registers an account. `balance: null` leaves it without the trustline. */
  addAccount(
    options: {
      publicKey?: string;
      balance?: string | null;
      xlm?: string;
    } = {},
  ): string {
    const publicKey = options.publicKey ?? fakeAccountId();
    const balance =
      options.balance === undefined ? '0.0000000' : options.balance;

    this.accounts.set(publicKey, {
      id: publicKey,
      account_id: publicKey,
      sequence: '1',
      subentry_count: balance === null ? 0 : 1,
      thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
      signers: [{ key: publicKey, weight: 1, type: 'ed25519_public_key' }],
      balances: [
        ...(balance === null
          ? []
          : [
              {
                balance,
                asset_type: 'credit_alphanum4' as const,
                asset_code: this.assetCode,
                asset_issuer: this.assetIssuer,
              },
            ]),
        { balance: options.xlm ?? '10.0000000', asset_type: 'native' as const },
      ],
    });
    return publicKey;
  }

  /** Puts a payment transaction in the ledger and moves the balances. */
  registerPayment(input: FakePaymentInput): {
    txHash: string;
    innerHash: string | null;
  } {
    const successful = input.successful ?? true;
    const assetCode = input.assetCode ?? this.assetCode;
    const assetIssuer = input.assetIssuer ?? this.assetIssuer;
    const txHash = fakeTxHash();
    const innerHash = input.feeBump ? fakeTxHash() : null;
    const createdAt = input.createdAt ?? new Date().toISOString();
    const native = assetCode === 'XLM';

    const transaction: HorizonTransaction = {
      hash: txHash,
      ledger: 1_000 + this.counter,
      created_at: createdAt,
      successful,
      source_account: input.from,
      fee_account: innerHash ? (this.opsKey ?? input.from) : input.from,
      memo_type: input.memo ? 'text' : 'none',
      ...(input.memo ? { memo: input.memo } : {}),
      ...(innerHash
        ? {
            inner_transaction: { hash: innerHash },
            fee_bump_transaction: { hash: txHash },
          }
        : {}),
    };

    for (const amount of input.amounts) {
      this.operations.push({
        id: this.nextToken(),
        paging_token: String(this.counter),
        type: 'payment',
        transaction_hash: txHash,
        transaction_successful: successful,
        source_account: input.from,
        created_at: createdAt,
        from: input.from,
        to: input.to,
        amount,
        ...(native
          ? { asset_type: 'native' as const }
          : {
              asset_type: 'credit_alphanum4' as const,
              asset_code: assetCode,
              asset_issuer: assetIssuer,
            }),
        transaction,
      });

      if (successful && !native) {
        this.adjustBalance(input.to, assetCode, assetIssuer, amount, 1n);
        this.adjustBalance(input.from, assetCode, assetIssuer, amount, -1n);
      }
    }

    return { txHash, innerHash };
  }

  getAccount(publicKey: string): Promise<HorizonAccount | null> {
    return this.answer(() => {
      const account = this.accounts.get(publicKey);
      return account ? structuredClone(account) : null;
    });
  }

  getTransactionOperations(txHash: string): Promise<HorizonOperation[] | null> {
    return this.answer(() => {
      const hash = txHash.trim().toLowerCase();
      const found = this.operations.filter(
        (operation) =>
          operation.transaction_hash === hash ||
          operation.transaction?.inner_transaction?.hash === hash,
      );
      if (found.length === 0) return null;

      // Like Horizon, the joined transaction echoes the hash asked for.
      return found.map((operation) => ({
        ...operation,
        transaction: operation.transaction && {
          ...operation.transaction,
          hash,
        },
      }));
    });
  }

  listAccountPayments(
    publicKey: string,
    options: ListPaymentsOptions,
  ): Promise<HorizonOperation[]> {
    return this.answer(() => {
      const cursor = options.cursor ? BigInt(options.cursor) : null;
      const records = this.operations.filter((operation) => {
        if (
          operation.to !== publicKey &&
          operation.from !== publicKey &&
          operation.source_account !== publicKey &&
          this.createdAccounts.get(operation.id) !== publicKey
        ) {
          return false;
        }
        // Horizon lists successful transactions unless asked otherwise.
        if (!operation.transaction_successful) return false;
        if (cursor === null) return true;

        const token = BigInt(operation.paging_token);
        return options.order === 'asc' ? token > cursor : token < cursor;
      });

      const ordered =
        options.order === 'asc' ? records : [...records].reverse();
      return ordered
        .slice(0, options.limit)
        .map((record) => structuredClone(record));
    });
  }

  createTreasuryAccount(
    input: CreateTreasuryInput,
  ): Promise<{ publicKey: string; txHash: string }> {
    return this.answer(() => {
      const ops = this.requireOps();
      if (input.threshold < 1 || input.threshold > input.signers.length) {
        throw new StellarInputError(
          'The threshold must be between 1 and the number of signers',
        );
      }

      const publicKey = fakeAccountId();
      const txHash = fakeTxHash();
      this.accounts.set(publicKey, {
        id: publicKey,
        account_id: publicKey,
        sequence: '1',
        subentry_count: 1 + input.signers.length,
        thresholds: {
          low_threshold: input.threshold,
          med_threshold: input.threshold,
          high_threshold: input.threshold,
        },
        signers: [
          ...input.signers.map((key) => ({
            key,
            weight: 1,
            type: 'ed25519_public_key',
          })),
          { key: publicKey, weight: 0, type: 'ed25519_public_key' },
        ],
        balances: [
          {
            balance: '0.0000000',
            asset_type: 'credit_alphanum4',
            asset_code: this.assetCode,
            asset_issuer: this.assetIssuer,
          },
          { balance: '5.0000000', asset_type: 'native' },
        ],
      });

      // The funding shows up in the treasury history, as on the network.
      const createdAt = new Date().toISOString();
      const id = this.nextToken();
      this.createdAccounts.set(id, publicKey);
      this.operations.push({
        id,
        paging_token: String(this.counter),
        type: 'create_account',
        transaction_hash: txHash,
        transaction_successful: true,
        source_account: ops,
        created_at: createdAt,
        transaction: {
          hash: txHash,
          ledger: 1_000 + this.counter,
          created_at: createdAt,
          successful: true,
          source_account: ops,
          fee_account: ops,
          memo_type: 'none',
        },
      });

      return { publicKey, txHash };
    });
  }

  sendFromOps(input: {
    destination: string;
    amount: string;
    memo?: string;
  }): Promise<{ txHash: string }> {
    return this.answer(() => {
      const ops = this.requireOps();
      const { txHash } = this.registerPayment({
        from: ops,
        to: input.destination,
        amounts: [input.amount],
        memo: input.memo ?? null,
      });
      return { txHash };
    });
  }

  opsPublicKey(): Promise<string | null> {
    return Promise.resolve(this.opsKey);
  }

  private requireOps(): string {
    if (!this.opsKey) {
      throw new StellarInputError(
        'The operations account is not configured (STELLAR_OPS_SECRET)',
      );
    }
    return this.opsKey;
  }

  private nextToken(): string {
    this.counter += 1;
    return String(this.counter);
  }

  private adjustBalance(
    publicKey: string,
    assetCode: string,
    assetIssuer: string,
    amount: string,
    sign: 1n | -1n,
  ): void {
    const holding = this.accounts
      .get(publicKey)
      ?.balances.find(
        (balance) =>
          balance.asset_code === assetCode &&
          balance.asset_issuer === assetIssuer,
      );
    if (!holding) return;

    const next = toStroops(holding.balance) + sign * toStroops(amount);
    holding.balance = fromStroops(next < 0n ? 0n : next);
  }

  private answer<T>(work: () => T): Promise<T> {
    if (this.down) {
      return Promise.reject(
        new StellarGatewayError('Could not reach Horizon: fake outage'),
      );
    }
    try {
      return Promise.resolve(work());
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
}
