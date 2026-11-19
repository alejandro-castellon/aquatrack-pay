/**
 * Returns to the operations account whatever the demo treasuries hold, so a
 * small float of test USDC can be paid in again and again.
 *
 * It is also the withdrawal the product is about: the treasury only lets the
 * funds out with two of the three board signatures. The script first tries
 * with one signature and shows the network refusing it, then signs with two.
 * The board keys are the demo ones in scripts/demo/.demo-keys.json; in a real
 * building they belong to the board, not to AquaTrack.
 *
 *   pnpm demo:recycle
 *
 * Needs the API running (it reads the treasuries of the demo admin's buildings).
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
import { ApiSession, DemoBuilding, demoSettings } from './lib/api-session';
import {
  boardKeypairs,
  explorerLinks,
  loadDemoKeys,
  requireTestnet,
  resultCodesOf,
  step,
  submit,
} from './lib/testnet';

interface TreasuryView {
  treasury: null | {
    publicKey: string;
    assetCode: string;
    assetIssuer: string;
    onChain: null | { balance: string };
  };
}

async function main(): Promise<void> {
  const config = loadStellarConfig();
  requireTestnet(config);
  const horizon = new Horizon.Server(config.horizonUrl);
  const links = explorerLinks(config);
  const keys = loadDemoKeys();
  if (!keys.ops)
    throw new Error('Falta la cuenta de operaciones: pnpm demo:ops-init');
  const ops = Keypair.fromSecret(keys.ops).publicKey();
  const board = boardKeypairs(keys);

  const api = new ApiSession(demoSettings.apiUrl);
  const adminId = await api.login(
    demoSettings.adminEmail,
    demoSettings.adminPassword,
  );
  const buildings = await api.list<DemoBuilding>(`/buildings/admin/${adminId}`);

  let recycled = 0;
  for (const building of buildings) {
    const { treasury } = await api.request<TreasuryView>(
      'GET',
      `/buildings/${building.id}/treasury`,
    );
    const balance = treasury?.onChain?.balance ?? '0';
    if (!treasury || Number(balance) <= 0) continue;

    step(`${building.name}: ${balance} ${treasury.assetCode}`);
    const asset = new Asset(treasury.assetCode, treasury.assetIssuer);
    const buildWithdrawal = async () =>
      new TransactionBuilder(await horizon.loadAccount(treasury.publicKey), {
        fee: '1000',
        networkPassphrase: config.networkPassphrase,
      })
        .addOperation(
          Operation.payment({ destination: ops, asset, amount: balance }),
        )
        .addMemo(Memo.text('Retiro de la demo'))
        .setTimeout(120)
        .build();

    const oneSignature = await buildWithdrawal();
    oneSignature.sign(board[0]);
    let refusal: string | undefined;
    try {
      await horizon.submitTransaction(oneSignature);
    } catch (error) {
      refusal = resultCodesOf(error)?.transaction;
    }
    console.log(
      refusal === 'tx_bad_auth'
        ? '  con una firma: la red lo rechaza (tx_bad_auth)'
        : `  con una firma: resultado inesperado (${refusal ?? 'aceptado'})`,
    );
    if (refusal !== 'tx_bad_auth') {
      // One signature moved the funds, or failed for another reason: stop and look.
      throw new Error('La caja no se comportó como una cuenta de 2 de 3');
    }

    const twoSignatures = await buildWithdrawal();
    twoSignatures.sign(board[0], board[1]);
    const result = await submit(horizon, twoSignatures);
    console.log(`  con dos firmas: retirado. ${links.tx(result.hash)}`);
    recycled += 1;
  }

  console.log(
    recycled === 0
      ? '\nNinguna caja tenía fondos.'
      : `\n${recycled} caja(s) vaciadas hacia la cuenta de operaciones.`,
  );
}

main().catch((error) => {
  console.error(
    `\n✗ ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
