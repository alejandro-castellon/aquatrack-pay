import * as fs from 'fs';
import * as path from 'path';
import {
  FeeBumpTransaction,
  Horizon,
  Keypair,
  Transaction,
} from '@stellar/stellar-sdk';
import { StellarConfig } from '../../../src/shared/stellar/stellar.config';

/**
 * Testnet keys the demo scripts create and reuse. Gitignored. They only ever
 * hold test funds; never put a public-network key here.
 */
export interface DemoKeys {
  /** Operations account: creates treasuries and feeds the demo faucet. */
  ops?: string;
  /** Issuer of the throwaway asset the smoke test uses instead of USDC. */
  issuer?: string;
  /** Board members of the demo building, in order: admin, presidenta, tesorero. */
  board?: string[];
}

export const DEMO_KEYS_FILE = path.join(__dirname, '..', '.demo-keys.json');

export function loadDemoKeys(): DemoKeys {
  if (!fs.existsSync(DEMO_KEYS_FILE)) return {};
  return JSON.parse(fs.readFileSync(DEMO_KEYS_FILE, 'utf8')) as DemoKeys;
}

export function saveDemoKeys(keys: DemoKeys): void {
  fs.writeFileSync(DEMO_KEYS_FILE, JSON.stringify(keys, null, 2) + '\n', {
    mode: 0o600,
  });
}

export function requireTestnet(config: StellarConfig): void {
  if (config.network !== 'testnet') {
    throw new Error(
      'The demo scripts only run on testnet (STELLAR_NETWORK is "public")',
    );
  }
}

/** Creates the account with 10,000 test XLM if it does not exist yet. */
export async function ensureFunded(
  horizon: Horizon.Server,
  publicKey: string,
): Promise<void> {
  try {
    await horizon.loadAccount(publicKey);
    return;
  } catch {
    // Not found: ask Friendbot.
  }

  const response = await fetch(
    `https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`,
  );
  if (!response.ok) {
    throw new Error(
      `Friendbot could not fund ${publicKey}: ${response.status} ${await response.text()}`,
    );
  }
}

export interface SubmitFailure {
  transaction?: string;
  operations?: string[];
}

/** Horizon's result codes of a rejected submission, when it carries them. */
export function resultCodesOf(error: unknown): SubmitFailure | null {
  const codes = (
    error as {
      response?: { data?: { extras?: { result_codes?: SubmitFailure } } };
    }
  )?.response?.data?.extras?.result_codes;
  return codes ?? null;
}

export async function submit(
  horizon: Horizon.Server,
  transaction: Transaction | FeeBumpTransaction,
): Promise<{ hash: string; ledger: number }> {
  try {
    const result = await horizon.submitTransaction(transaction);
    return { hash: result.hash, ledger: result.ledger };
  } catch (error) {
    const codes = resultCodesOf(error);
    if (codes) {
      throw Object.assign(
        new Error(`Stellar rejected it: ${JSON.stringify(codes)}`),
        { resultCodes: codes },
      );
    }
    throw error;
  }
}

export function explorerLinks(config: StellarConfig) {
  return {
    tx: (hash: string) => `${config.explorerUrl}/tx/${hash}`,
    account: (publicKey: string) =>
      `${config.explorerUrl}/account/${publicKey}`,
  };
}

/** Loads the keypair stored under `name`, creating and saving it when missing. */
export function keypairFor(
  keys: DemoKeys,
  name: 'ops' | 'issuer',
): { keypair: Keypair; created: boolean } {
  const existing = keys[name];
  if (existing)
    return { keypair: Keypair.fromSecret(existing), created: false };

  const keypair = Keypair.random();
  keys[name] = keypair.secret();
  saveDemoKeys(keys);
  return { keypair, created: true };
}

export function boardKeypairs(keys: DemoKeys, size = 3): Keypair[] {
  if (!keys.board || keys.board.length !== size) {
    keys.board = Array.from({ length: size }, () => Keypair.random().secret());
    saveDemoKeys(keys);
  }
  return keys.board.map((secret) => Keypair.fromSecret(secret));
}

export function step(title: string): void {
  console.log(`\n▸ ${title}`);
}

export function check(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`Check failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}
