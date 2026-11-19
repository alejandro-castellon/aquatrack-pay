import {
  loadStellarConfig,
  networkPassphraseOf,
} from '@/shared/stellar/stellar.config';
import { accountUrl, txUrl } from '@/shared/stellar/stellar-explorer';

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
const PUBLIC_PASSPHRASE = 'Public Global Stellar Network ; September 2015';
const TEST_SECRET = 'SA525UDTESTONLYSECRETKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

describe('stellar config', () => {
  it('defaults to testnet, Circle test USDC and everything optional off', () => {
    expect(loadStellarConfig({})).toEqual({
      network: 'testnet',
      networkPassphrase: TESTNET_PASSPHRASE,
      horizonUrl: 'https://horizon-testnet.stellar.org',
      explorerUrl: 'https://stellar.expert/explorer/testnet',
      assetCode: 'USDC',
      assetIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      opsSecret: null,
      watcherIntervalMs: null,
      demoFaucetEnabled: false,
      defaultBsPerUsdc: null,
      demoBuildingId: null,
    });
  });

  it('reads the demo settings on testnet', () => {
    const config = loadStellarConfig({
      STELLAR_NETWORK: 'testnet',
      STELLAR_HORIZON_URL: 'https://horizon.example.org/',
      STELLAR_USDC_CODE: 'TESTUSD',
      STELLAR_USDC_ISSUER: 'GISSUER',
      STELLAR_OPS_SECRET: TEST_SECRET,
      STELLAR_WATCHER_INTERVAL_MS: '10000',
      STELLAR_DEMO_FAUCET_ENABLED: 'true',
      STELLAR_DEMO_BUILDING_ID: '9f7b3a46-946e-4e75-a0f3-dce1c07e7f4a',
      WATER_CHARGE_DEFAULT_BS_PER_USDC: '11.84',
    });

    expect(config).toEqual(
      expect.objectContaining({
        horizonUrl: 'https://horizon.example.org',
        assetCode: 'TESTUSD',
        assetIssuer: 'GISSUER',
        opsSecret: TEST_SECRET,
        watcherIntervalMs: 10_000,
        demoFaucetEnabled: true,
        demoBuildingId: '9f7b3a46-946e-4e75-a0f3-dce1c07e7f4a',
        defaultBsPerUsdc: 11.84,
      }),
    );
  });

  it('never signs nor hands out funds on the public network', () => {
    const config = loadStellarConfig({
      STELLAR_NETWORK: 'public',
      STELLAR_OPS_SECRET: TEST_SECRET,
      STELLAR_DEMO_FAUCET_ENABLED: 'true',
    });

    expect(config.network).toBe('public');
    expect(config.networkPassphrase).toBe(PUBLIC_PASSPHRASE);
    expect(config.horizonUrl).toBe('https://horizon.stellar.org');
    expect(config.opsSecret).toBeNull();
    expect(config.demoFaucetEnabled).toBe(false);
  });

  it.each(['', '0', '-5', 'abc'])(
    'treats the interval and the rate %p as not set',
    (value) => {
      const config = loadStellarConfig({
        STELLAR_WATCHER_INTERVAL_MS: value,
        WATER_CHARGE_DEFAULT_BS_PER_USDC: value,
      });

      expect(config.watcherIntervalMs).toBeNull();
      expect(config.defaultBsPerUsdc).toBeNull();
    },
  );

  it('treats empty strings as not set, so tests can blank the local .env', () => {
    const config = loadStellarConfig({
      STELLAR_HORIZON_URL: '',
      STELLAR_USDC_CODE: '',
      STELLAR_USDC_ISSUER: '',
      STELLAR_OPS_SECRET: '',
      STELLAR_DEMO_BUILDING_ID: '',
    });

    expect(config).toEqual(loadStellarConfig({}));
  });

  it('knows the passphrase of each network', () => {
    expect(networkPassphraseOf('testnet')).toBe(TESTNET_PASSPHRASE);
    expect(networkPassphraseOf('public')).toBe(PUBLIC_PASSPHRASE);
    expect(networkPassphraseOf('anything-else')).toBe(TESTNET_PASSPHRASE);
  });
});

describe('stellar explorer links', () => {
  const config = { explorerUrl: 'https://stellar.expert/explorer/testnet' };

  it('links a transaction', () => {
    expect(txUrl(config, 'abc123')).toBe(
      'https://stellar.expert/explorer/testnet/tx/abc123',
    );
  });

  it('links an account', () => {
    expect(accountUrl(config, 'GABC')).toBe(
      'https://stellar.expert/explorer/testnet/account/GABC',
    );
  });
});
