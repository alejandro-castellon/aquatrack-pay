/**
 * Prepares the operations account of the demo on testnet: creates it with
 * Friendbot when missing and adds the trustline of the charge asset, so it
 * can hold the test USDC the demo faucet hands out.
 *
 * Run:  pnpm demo:ops-init
 *
 * Then fund it at https://faucet.circle.com (Stellar Testnet, 20 USDC every
 * 2 hours per address) and copy the printed STELLAR_OPS_SECRET line to .env.
 */
import 'dotenv/config';
import {
  Asset,
  Horizon,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { loadStellarConfig } from '../../src/shared/stellar/stellar.config';
import {
  ensureFunded,
  explorerLinks,
  keypairFor,
  loadDemoKeys,
  requireTestnet,
  step,
  submit,
} from './lib/testnet';

async function main(): Promise<void> {
  const config = loadStellarConfig();
  requireTestnet(config);

  const horizon = new Horizon.Server(config.horizonUrl);
  const keys = loadDemoKeys();
  const { keypair: ops, created } = keypairFor(keys, 'ops');

  step('Cuenta de operaciones');
  console.log(
    created ? '  creada y guardada en .demo-keys.json' : '  ya existía',
  );
  await ensureFunded(horizon, ops.publicKey());

  let account = await horizon.loadAccount(ops.publicKey());
  const holdsAsset = (candidate: typeof account) =>
    candidate.balances.some(
      (balance) =>
        'asset_code' in balance &&
        balance.asset_code === config.assetCode &&
        balance.asset_issuer === config.assetIssuer,
    );

  if (!holdsAsset(account)) {
    step(`Línea de confianza de ${config.assetCode}`);
    const transaction = new TransactionBuilder(account, {
      fee: '1000',
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(
        Operation.changeTrust({
          asset: new Asset(config.assetCode, config.assetIssuer),
        }),
      )
      .setTimeout(120)
      .build();
    transaction.sign(ops);
    const result = await submit(horizon, transaction);
    console.log(`  ${explorerLinks(config).tx(result.hash)}`);
    account = await horizon.loadAccount(ops.publicKey());
  }

  step('Saldos');
  for (const balance of account.balances) {
    const code = 'asset_code' in balance ? balance.asset_code : 'XLM';
    console.log(`  ${code}: ${balance.balance}`);
  }

  console.log(`\nDirección para el faucet de Circle (Stellar Testnet):`);
  console.log(`  ${ops.publicKey()}`);
  console.log(`  ${explorerLinks(config).account(ops.publicKey())}`);
  console.log(`\nLínea para el .env de la API (llave solo de testnet):`);
  console.log(`  STELLAR_OPS_SECRET=${ops.secret()}`);
}

main().catch((error) => {
  console.error(
    `\n✗ ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
