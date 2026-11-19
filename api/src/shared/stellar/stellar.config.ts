import { registerAs } from '@nestjs/config';

export type StellarNetwork = 'testnet' | 'public';

export interface StellarConfig {
  network: StellarNetwork;
  networkPassphrase: string;
  horizonUrl: string;
  /** Block explorer base, e.g. https://stellar.expert/explorer/testnet */
  explorerUrl: string;
  /** Asset the charges are paid in. */
  assetCode: string;
  assetIssuer: string;
  /**
   * Secret key of the server account that creates treasuries and feeds the
   * demo faucet. Only honoured on testnet: on the public network the board
   * creates its own treasury and the server never signs.
   */
  opsSecret: string | null;
  /** Polling interval of the treasury watcher; null keeps it off. */
  watcherIntervalMs: number | null;
  /** Lets the public pay page ask for test funds. Testnet only. */
  demoFaucetEnabled: boolean;
  /** Bs per 1 USDC suggested when an admin publishes charges. */
  defaultBsPerUsdc: number | null;
  /** Limits the demo's "next pending charge" to one building. */
  demoBuildingId: string | null;
}

const NETWORKS: Record<
  StellarNetwork,
  Pick<
    StellarConfig,
    'networkPassphrase' | 'horizonUrl' | 'explorerUrl' | 'assetIssuer'
  >
> = {
  testnet: {
    networkPassphrase: 'Test SDF Network ; September 2015',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    explorerUrl: 'https://stellar.expert/explorer/testnet',
    // Circle's USDC issuer on testnet.
    assetIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  },
  public: {
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
    horizonUrl: 'https://horizon.stellar.org',
    explorerUrl: 'https://stellar.expert/explorer/public',
    // Circle's USDC issuer on the public network.
    assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  },
};

function positiveNumber(value: string | undefined): number | null {
  const parsed = Number(value);
  return value !== undefined && Number.isFinite(parsed) && parsed > 0
    ? parsed
    : null;
}

function withoutTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export function loadStellarConfig(
  env: Record<string, string | undefined> = process.env,
): StellarConfig {
  const network: StellarNetwork =
    env.STELLAR_NETWORK === 'public' ? 'public' : 'testnet';
  const defaults = NETWORKS[network];
  const isTestnet = network === 'testnet';

  return {
    network,
    networkPassphrase: defaults.networkPassphrase,
    horizonUrl: withoutTrailingSlash(
      env.STELLAR_HORIZON_URL || defaults.horizonUrl,
    ),
    explorerUrl: defaults.explorerUrl,
    assetCode: env.STELLAR_USDC_CODE || 'USDC',
    assetIssuer: env.STELLAR_USDC_ISSUER || defaults.assetIssuer,
    opsSecret: isTestnet ? env.STELLAR_OPS_SECRET || null : null,
    watcherIntervalMs: positiveNumber(env.STELLAR_WATCHER_INTERVAL_MS),
    demoFaucetEnabled: isTestnet && env.STELLAR_DEMO_FAUCET_ENABLED === 'true',
    defaultBsPerUsdc: positiveNumber(env.WATER_CHARGE_DEFAULT_BS_PER_USDC),
    demoBuildingId: env.STELLAR_DEMO_BUILDING_ID || null,
  };
}

/** Passphrase of a network by name; anything that is not "public" is testnet. */
export function networkPassphraseOf(network: string): string {
  return NETWORKS[network === 'public' ? 'public' : 'testnet']
    .networkPassphrase;
}

export default registerAs('stellar', () => loadStellarConfig());
