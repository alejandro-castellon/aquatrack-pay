/**
 * Pays real charges on testnet against a RUNNING API and checks what the API
 * concludes, end to end (database, Horizon and the ledger):
 *
 *   1. exact payment, then confirm         -> paid, with the ledger hash
 *   2. exact payment, nobody confirms      -> the watcher settles it
 *   3. one cent short, then confirm        -> underpaid, still pending
 *   4. paying charge 1 again, then confirm -> already_paid; the treasury lists a duplicate
 *
 * The first payer is funded by the API's demo faucet, so that is tested too.
 *
 * Needs the API with STELLAR_DEMO_FAUCET_ENABLED=true and
 * STELLAR_WATCHER_INTERVAL_MS set, and at least three pending charges
 * (pnpm demo:setup or pnpm demo:import create them).
 *
 *   pnpm demo:e2e
 *
 * It settles two charges for good; reseed the demo database to start over.
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
import {
  fromStroops,
  toStroops,
} from '../../src/shared/stellar/stellar-amount';
import { ApiSession, DemoBuilding, demoSettings } from './lib/api-session';
import {
  check,
  ensureFunded,
  loadDemoKeys,
  requireTestnet,
  step,
  submit,
} from './lib/testnet';

const FEE = '1000';
const WATCHER_TIMEOUT_MS = 90_000;

interface PublicCharge {
  buildingName: string;
  apartmentNumber: string;
  month: string;
  amountBs: number;
  amountUsdc: string;
  status: 'pending' | 'paid' | 'cancelled';
  payment: {
    destination: string;
    assetCode: string;
    assetIssuer: string;
    memo: string;
    networkPassphrase: string;
  };
  paid: null | { txHash: string; paidAmountUsdc: string; payerAddress: string };
  demo: { faucetEnabled: boolean };
}

interface ConfirmResult {
  outcome: string;
  charge: PublicCharge;
}

interface TreasuryView {
  treasury: null | {
    publicKey: string;
    transfers: { txHash: string; memo: string | null; status: string }[];
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const config = loadStellarConfig();
  requireTestnet(config);
  const horizon = new Horizon.Server(config.horizonUrl);
  const api = new ApiSession(demoSettings.apiUrl);
  const keys = loadDemoKeys();
  if (!keys.ops)
    throw new Error('Falta la cuenta de operaciones: pnpm demo:ops-init');
  const ops = Keypair.fromSecret(keys.ops);

  const getCharge = (code: string) =>
    api.request<PublicCharge>('GET', `/water-charges/public/${code}`);

  step(`Cobros pendientes en ${api.baseUrl}`);
  const codes = new Set<string>();
  for (let attempt = 0; attempt < 60 && codes.size < 3; attempt++) {
    const { code } = await api.request<{ code: string }>(
      'GET',
      '/water-charges/public/demo/next',
    );
    codes.add(code);
  }
  check(codes.size === 3, 'hay al menos tres cobros pendientes distintos');
  const [codeA, codeB, codeC] = [...codes];
  const [chargeA, chargeB, chargeC] = await Promise.all(
    [codeA, codeB, codeC].map(getCharge),
  );
  for (const charge of [chargeA, chargeB, chargeC]) {
    console.log(
      `  ${charge.buildingName}, depto ${charge.apartmentNumber}, ${charge.month}: ${charge.amountUsdc} ${charge.payment.assetCode} (${charge.payment.memo})`,
    );
  }
  check(chargeA.demo.faucetEnabled, 'el grifo de fondos de prueba está activo');

  const asset = new Asset(
    chargeA.payment.assetCode,
    chargeA.payment.assetIssuer,
  );
  const passphrase = chargeA.payment.networkPassphrase;

  step('Pagador');
  const payer = Keypair.random();
  await ensureFunded(horizon, payer.publicKey());
  console.log(`  ${payer.publicKey()}`);

  // Without a trustline the faucet must refuse, with a message the page can show.
  let refused = '';
  try {
    await api.request('POST', `/water-charges/public/${codeA}/demo-funds`, {
      payerAddress: payer.publicKey(),
    });
  } catch (error) {
    refused = error instanceof Error ? error.message : String(error);
  }
  check(
    refused.includes('Log in first'),
    'sin línea de confianza, el grifo se niega y explica por qué',
  );

  const trust = new TransactionBuilder(
    await horizon.loadAccount(payer.publicKey()),
    { fee: FEE, networkPassphrase: passphrase },
  )
    .addOperation(Operation.changeTrust({ asset }))
    .setTimeout(120)
    .build();
  trust.sign(payer);
  await submit(horizon, trust);

  /** Pays a charge from the payer and returns the transaction hash. */
  const pay = async (charge: PublicCharge, amount: string): Promise<string> => {
    const transaction = new TransactionBuilder(
      await horizon.loadAccount(payer.publicKey()),
      { fee: FEE, networkPassphrase: passphrase },
    )
      .addOperation(
        Operation.payment({
          destination: charge.payment.destination,
          asset,
          amount,
        }),
      )
      .addMemo(Memo.text(charge.payment.memo))
      .setTimeout(120)
      .build();
    transaction.sign(payer);
    return (await submit(horizon, transaction)).hash;
  };

  /** Tops the payer up straight from the operations account. */
  const fund = async (amount: string): Promise<void> => {
    const transaction = new TransactionBuilder(
      await horizon.loadAccount(ops.publicKey()),
      { fee: FEE, networkPassphrase: passphrase },
    )
      .addOperation(
        Operation.payment({ destination: payer.publicKey(), asset, amount }),
      )
      .setTimeout(120)
      .build();
    transaction.sign(ops);
    await submit(horizon, transaction);
  };

  /** Asks the API to read the transaction, as the pay page does. */
  const confirm = async (
    code: string,
    txHash: string,
  ): Promise<ConfirmResult> => {
    for (let attempt = 0; attempt < 15; attempt++) {
      const result = await api.request<ConfirmResult>(
        'POST',
        `/water-charges/public/${code}/confirm`,
        { txHash },
      );
      if (result.outcome !== 'not_found_yet') return result;
      await wait(2_000);
    }
    throw new Error(`La API nunca encontró la transacción ${txHash}`);
  };

  step('1. Pago exacto con fondos del grifo y confirmación');
  const drip = await api.request<{ txHash: string | null; amount: string }>(
    'POST',
    `/water-charges/public/${codeA}/demo-funds`,
    { payerAddress: payer.publicKey() },
  );
  check(
    drip.txHash !== null && drip.amount === chargeA.amountUsdc,
    `el grifo envió justo lo que faltaba (${drip.amount})`,
  );
  const again = await api.request<{ txHash: string | null; amount: string }>(
    'POST',
    `/water-charges/public/${codeA}/demo-funds`,
    { payerAddress: payer.publicKey() },
  );
  check(
    again.txHash === null && toStroops(again.amount) === 0n,
    'pedir de nuevo con saldo suficiente no envía nada',
  );
  const hashA = await pay(chargeA, chargeA.amountUsdc);
  const confirmedA = await confirm(codeA, hashA);
  check(confirmedA.outcome === 'paid', 'la confirmación responde "paid"');
  check(
    confirmedA.charge.status === 'paid' &&
      confirmedA.charge.paid?.txHash === hashA &&
      confirmedA.charge.paid?.payerAddress === payer.publicKey(),
    'el cobro quedó pagado con el hash del ledger y el pagador correcto',
  );
  const repeated = await confirm(codeA, hashA);
  check(
    repeated.outcome === 'already_paid',
    'confirmar otra vez responde "already_paid"',
  );
  console.log(`  ${config.explorerUrl}/tx/${hashA}`);

  step('2. Pago exacto sin confirmar: lo liquida el watcher');
  await fund(chargeB.amountUsdc);
  const hashB = await pay(chargeB, chargeB.amountUsdc);
  const started = Date.now();
  let settledB: PublicCharge | null = null;
  while (Date.now() - started < WATCHER_TIMEOUT_MS) {
    const charge = await getCharge(codeB);
    if (charge.status === 'paid') {
      settledB = charge;
      break;
    }
    await wait(3_000);
  }
  check(
    settledB?.paid?.txHash === hashB,
    `el watcher lo marcó pagado en ${Math.round((Date.now() - started) / 1000)} s, sin que nadie confirmara`,
  );

  step('3. Un centavo menos');
  const short = fromStroops(toStroops(chargeC.amountUsdc) - 100_000n);
  await fund(short);
  const hashC = await pay(chargeC, short);
  const confirmedC = await confirm(codeC, hashC);
  check(
    confirmedC.outcome === 'underpaid',
    `pagar ${short} de ${chargeC.amountUsdc} responde "underpaid"`,
  );
  check(
    (await getCharge(codeC)).status === 'pending',
    'el cobro sigue pendiente',
  );

  step('4. Pagar dos veces el mismo cobro');
  await fund(chargeA.amountUsdc);
  const hashA2 = await pay(chargeA, chargeA.amountUsdc);
  const confirmedA2 = await confirm(codeA, hashA2);
  check(
    confirmedA2.outcome === 'already_paid' &&
      confirmedA2.charge.paid?.txHash === hashA,
    'el segundo pago no cambia el cobro: sigue con el primer hash',
  );

  step('La caja lo cuenta igual que la red');
  const adminId = await api.login(
    demoSettings.adminEmail,
    demoSettings.adminPassword,
  );
  const buildings = await api.list<DemoBuilding>(`/buildings/admin/${adminId}`);
  const statuses = new Map<string, string>();
  for (const building of buildings) {
    const { treasury } = await api.request<TreasuryView>(
      'GET',
      `/buildings/${building.id}/treasury`,
    );
    for (const transfer of treasury?.transfers ?? []) {
      statuses.set(transfer.txHash, transfer.status);
    }
  }
  check(statuses.get(hashA) === 'matched', 'primer pago: conciliado');
  check(statuses.get(hashB) === 'matched', 'pago del watcher: conciliado');
  check(statuses.get(hashC) === 'underpaid', 'pago corto: monto incompleto');
  check(statuses.get(hashA2) === 'duplicate', 'segundo pago: duplicado');

  console.log('\nFlujo completo verificado contra la API y testnet.');
}

main().catch((error) => {
  console.error(
    `\n✗ ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
