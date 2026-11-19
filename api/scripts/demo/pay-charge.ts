/**
 * Pays one pending charge from a brand-new test wallet, the way someone with
 * "another Stellar wallet" would: destination, amount and the charge memo.
 * The wallet gets its funds from the API's demo faucet.
 *
 * It does NOT tell the API about the payment: the watcher has to find it, and
 * a pay page left open on that charge turns to "Pago recibido" by itself.
 *
 *   pnpm demo:pay <código del enlace de pago>
 *
 * Needs the API running with the demo faucet on.
 */
import 'dotenv/config';
import {
  Asset,
  Horizon,
  Keypair,
  Memo,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { loadStellarConfig } from '../../src/shared/stellar/stellar.config';
import { ApiSession, demoSettings } from './lib/api-session';
import {
  ensureFunded,
  explorerLinks,
  requireTestnet,
  step,
  submit,
} from './lib/testnet';

interface PublicCharge {
  buildingName: string;
  apartmentNumber: string;
  month: string;
  amountUsdc: string;
  status: string;
  payment: {
    destination: string;
    assetCode: string;
    assetIssuer: string;
    memo: string;
    networkPassphrase: string;
  };
}

async function main(): Promise<void> {
  const code = process.argv[2];
  if (!code) throw new Error('Uso: pnpm demo:pay <código del enlace de pago>');

  const config = loadStellarConfig();
  requireTestnet(config);
  const horizon = new Horizon.Server(config.horizonUrl);
  const api = new ApiSession(demoSettings.apiUrl);

  const charge = await api.request<PublicCharge>(
    'GET',
    `/water-charges/public/${code}`,
  );
  step(
    `${charge.buildingName}, depto ${charge.apartmentNumber}, ${charge.month}: ${charge.amountUsdc} ${charge.payment.assetCode}`,
  );
  if (charge.status !== 'pending') {
    throw new Error(`Este cobro ya no está pendiente (${charge.status})`);
  }

  const { destination, assetCode, assetIssuer, memo, networkPassphrase } =
    charge.payment;
  const asset = new Asset(assetCode, assetIssuer);
  const payer = Keypair.random();
  const send = async (
    operation: ReturnType<typeof Operation.payment>,
    text?: string,
  ) => {
    const builder = new TransactionBuilder(
      await horizon.loadAccount(payer.publicKey()),
      { fee: '1000', networkPassphrase },
    ).addOperation(operation);
    if (text) builder.addMemo(Memo.text(text));
    const transaction = builder.setTimeout(120).build();
    transaction.sign(payer);
    return (await submit(horizon, transaction)).hash;
  };

  await ensureFunded(horizon, payer.publicKey());
  await send(Operation.changeTrust({ asset }));
  console.log(`  billetera de prueba: ${payer.publicKey()}`);

  const drip = await api.request<{ txHash: string | null; amount: string }>(
    'POST',
    `/water-charges/public/${code}/demo-funds`,
    { payerAddress: payer.publicKey() },
  );
  console.log(`  el grifo envió ${drip.amount} ${assetCode}`);

  const hash = await send(
    Operation.payment({ destination, asset, amount: charge.amountUsdc }),
    memo,
  );
  console.log(`  pagado con el memo ${memo}`);
  console.log(`  ${explorerLinks(config).tx(hash)}`);
  console.log(
    '\nNadie le avisó a la API: el watcher lo encuentra en unos segundos.',
  );
}

main().catch((error) => {
  console.error(
    `\n✗ ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
