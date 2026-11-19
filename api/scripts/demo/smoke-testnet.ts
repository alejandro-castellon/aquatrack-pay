/**
 * End-to-end check of the Stellar pieces against testnet, without the API:
 *
 *   1. creates a 2-of-3 treasury with the gateway and reads it back;
 *   2. pays it in several ways (exact, short, no memo, two payments in one
 *      transaction, wrong asset, fee bump) and runs the same verifier the API
 *      uses on what Horizon reports;
 *   3. shows the treasury refuses one signature and accepts two.
 *
 * Run:  pnpm demo:smoke            (throwaway test asset, no faucet needed)
 *       pnpm demo:smoke --capture  (also saves Horizon's answers as fixtures)
 *
 * Keys live in scripts/demo/.demo-keys.json (gitignored, testnet only).
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  Asset,
  Horizon,
  Keypair,
  Memo,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { HorizonStellarGateway } from '../../src/shared/stellar/horizon-stellar.gateway';
import { HorizonOperation } from '../../src/shared/stellar/horizon.types';
import {
  StellarConfig,
  loadStellarConfig,
} from '../../src/shared/stellar/stellar.config';
import { convertBsToUsdc } from '../../src/modules/water-charge/domain/services/charge-amount';
import { generateChargeMemo } from '../../src/modules/water-charge/domain/services/charge-reference';
import {
  collectIncomingTransfers,
  judgeTransfer,
} from '../../src/modules/water-charge/domain/services/transfer-matcher';
import { fromStroops } from '../../src/shared/stellar/stellar-amount';
import {
  boardKeypairs,
  check,
  ensureFunded,
  explorerLinks,
  keypairFor,
  loadDemoKeys,
  requireTestnet,
  resultCodesOf,
  step,
  submit,
} from './lib/testnet';

const FEE = '1000';
const TEST_ASSET_CODE = 'TESTUSD';
const CAPTURE_DIR = path.join(
  __dirname,
  '..',
  '..',
  'test',
  'unit',
  'water-charge',
  '__fixtures__',
  'testnet',
);

async function main(): Promise<void> {
  const capture = process.argv.includes('--capture');
  const baseConfig = loadStellarConfig();
  requireTestnet(baseConfig);

  const horizon = new Horizon.Server(baseConfig.horizonUrl);
  const keys = loadDemoKeys();

  step('Cuentas de prueba');
  const ops = keypairFor(keys, 'ops').keypair;
  const issuer = keypairFor(keys, 'issuer').keypair;
  const payer = Keypair.random();
  await Promise.all([
    ensureFunded(horizon, ops.publicKey()),
    ensureFunded(horizon, issuer.publicKey()),
    ensureFunded(horizon, payer.publicKey()),
  ]);
  console.log(`  operaciones: ${ops.publicKey()}`);
  console.log(`  emisor de prueba: ${issuer.publicKey()}`);
  console.log(`  pagador: ${payer.publicKey()}`);

  // A throwaway asset stands in for USDC, so the check needs no faucet.
  const config: StellarConfig = {
    ...baseConfig,
    assetCode: TEST_ASSET_CODE,
    assetIssuer: issuer.publicKey(),
    opsSecret: ops.secret(),
  };
  const asset = new Asset(config.assetCode, config.assetIssuer);
  const gateway = new HorizonStellarGateway(config);
  const links = explorerLinks(config);

  step('Caja 2 de 3');
  const board = boardKeypairs(keys);
  const treasury = await gateway.createTreasuryAccount({
    signers: board.map((member) => member.publicKey()),
    threshold: 2,
  });
  console.log(`  caja: ${links.account(treasury.publicKey)}`);
  console.log(`  alta: ${links.tx(treasury.txHash)}`);

  const account = await gateway.getAccount(treasury.publicKey);
  check(account, 'la cuenta existe en testnet');
  const master = account!.signers.find(
    (signer) => signer.key === treasury.publicKey,
  );
  check(master?.weight === 0, 'la llave maestra quedó con peso 0');
  check(
    board.every((member) =>
      account!.signers.some(
        (signer) => signer.key === member.publicKey() && signer.weight === 1,
      ),
    ),
    'los tres firmantes de la directiva tienen peso 1',
  );
  check(
    account!.thresholds.low_threshold === 2 &&
      account!.thresholds.med_threshold === 2 &&
      account!.thresholds.high_threshold === 2,
    'los tres umbrales exigen 2 firmas',
  );
  check(
    account!.balances.some(
      (balance) =>
        balance.asset_code === config.assetCode &&
        balance.asset_issuer === config.assetIssuer,
    ),
    'tiene la línea de confianza del activo de cobro',
  );

  step('Fondos del pagador');
  await submit(
    horizon,
    signed(
      new TransactionBuilder(await horizon.loadAccount(payer.publicKey()), {
        fee: FEE,
        networkPassphrase: config.networkPassphrase,
      })
        .addOperation(Operation.changeTrust({ asset }))
        .setTimeout(120)
        .build(),
      payer,
    ),
  );
  await submit(
    horizon,
    signed(
      new TransactionBuilder(await horizon.loadAccount(issuer.publicKey()), {
        fee: FEE,
        networkPassphrase: config.networkPassphrase,
      })
        .addOperation(
          Operation.payment({
            destination: payer.publicKey(),
            asset,
            amount: '500',
          }),
        )
        .setTimeout(120)
        .build(),
      issuer,
    ),
  );
  console.log(`  500 ${config.assetCode} en la cuenta del pagador`);

  const target = {
    destination: treasury.publicKey,
    assetCode: config.assetCode,
    assetIssuer: config.assetIssuer,
  };
  const due = convertBsToUsdc(155, 11.84);
  console.log(`\n  Cobro de ejemplo: Bs 155,00 a 11,84 = ${due.amountUsdc}`);

  /** Pays the treasury from the payer and returns the transaction hash. */
  const pay = async (
    amounts: string[],
    memo: string | null,
    paymentAsset: Asset = asset,
  ): Promise<string> => {
    const builder = new TransactionBuilder(
      await horizon.loadAccount(payer.publicKey()),
      { fee: FEE, networkPassphrase: config.networkPassphrase },
    );
    for (const amount of amounts) {
      builder.addOperation(
        Operation.payment({
          destination: treasury.publicKey,
          asset: paymentAsset,
          amount,
        }),
      );
    }
    if (memo) builder.addMemo(Memo.text(memo));
    const transaction = builder.setTimeout(120).build();
    transaction.sign(payer);
    return (await submit(horizon, transaction)).hash;
  };

  /** What the API does on confirm: read the transaction and judge it. */
  const verify = async (
    name: string,
    txHash: string,
    memo: string,
  ): Promise<{ verdict: string; operations: HorizonOperation[] }> => {
    let operations: HorizonOperation[] | null = null;
    for (let attempt = 0; attempt < 10 && !operations; attempt++) {
      operations = await gateway.getTransactionOperations(txHash);
      if (!operations) await new Promise((r) => setTimeout(r, 1_500));
    }
    if (!operations) throw new Error(`Horizon no conoce ${txHash}`);

    const transfers = collectIncomingTransfers(operations, target);
    const verdict =
      transfers.length === 0
        ? 'ignored'
        : judgeTransfer(transfers[0], { memo, dueStroops: due.stroops });

    if (capture) {
      fs.mkdirSync(CAPTURE_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(CAPTURE_DIR, `${name}.json`),
        JSON.stringify(
          {
            description: name,
            target,
            charge: { memo, dueStroops: due.stroops.toString() },
            expected: verdict,
            lookedUpBy: txHash,
            operations: operations.map(slim),
          },
          null,
          2,
        ) + '\n',
      );
    }
    return { verdict, operations };
  };

  step('Pagos y verificación');
  const memoExact = generateChargeMemo();
  const exactHash = await pay([due.amountUsdc], memoExact);
  const exact = await verify('exact', exactHash, memoExact);
  check(
    exact.verdict === 'settles',
    `monto exacto con memo ${memoExact}: liquida`,
  );
  console.log(`    ${links.tx(exactHash)}`);

  const memoShort = generateChargeMemo();
  const shortAmount = fromStroops(due.stroops - 100_000n);
  const short = await verify(
    'underpaid',
    await pay([shortAmount], memoShort),
    memoShort,
  );
  check(
    short.verdict === 'underpaid',
    `un centavo menos (${shortAmount}): no liquida`,
  );

  const memoNone = generateChargeMemo();
  const noMemo = await verify(
    'no-memo',
    await pay([due.amountUsdc], null),
    memoNone,
  );
  check(noMemo.verdict === 'wrong_memo', 'monto exacto sin memo: no liquida');

  const memoSplit = generateChargeMemo();
  const half = fromStroops(due.stroops / 2n);
  const rest = fromStroops(due.stroops - due.stroops / 2n);
  const split = await verify(
    'two-payments',
    await pay([half, rest], memoSplit),
    memoSplit,
  );
  check(
    split.verdict === 'settles',
    `dos pagos en una transacción (${half} + ${rest}): liquida`,
  );

  const memoOver = generateChargeMemo();
  const over = await verify(
    'overpaid',
    await pay([fromStroops(due.stroops + 50_000_000n)], memoOver),
    memoOver,
  );
  check(over.verdict === 'settles', 'pago de más: liquida');

  const memoXlm = generateChargeMemo();
  const wrongAsset = await verify(
    'wrong-asset',
    await pay([due.amountUsdc], memoXlm, Asset.native()),
    memoXlm,
  );
  check(wrongAsset.verdict === 'ignored', 'mismo monto en XLM: se ignora');

  step('Transacción con comisión patrocinada (fee bump)');
  const memoBump = generateChargeMemo();
  const inner = new TransactionBuilder(
    await horizon.loadAccount(payer.publicKey()),
    { fee: FEE, networkPassphrase: config.networkPassphrase },
  )
    .addOperation(
      Operation.payment({
        destination: treasury.publicKey,
        asset,
        amount: due.amountUsdc,
      }),
    )
    .addMemo(Memo.text(memoBump))
    .setTimeout(120)
    .build();
  inner.sign(payer);
  const bump = TransactionBuilder.buildFeeBumpTransaction(
    ops,
    String(Number(FEE) * 2),
    inner,
    config.networkPassphrase,
  );
  bump.sign(ops);
  const bumpResult = await submit(horizon, bump);
  const innerHash = Buffer.from(inner.hash()).toString('hex');
  console.log(`  hash exterior: ${bumpResult.hash}`);
  console.log(`  hash interior: ${innerHash}`);

  const byOuter = await verify('fee-bump', bumpResult.hash, memoBump);
  check(
    byOuter.verdict === 'settles',
    'consultada por el hash exterior: liquida',
  );
  const byInner = await verify('fee-bump-inner-hash', innerHash, memoBump);
  check(
    byInner.verdict === 'settles',
    'consultada por el hash interior: liquida',
  );
  const outerTransfer = collectIncomingTransfers(byOuter.operations, target)[0];
  const innerTransfer = collectIncomingTransfers(byInner.operations, target)[0];
  check(
    outerTransfer.txHash === bumpResult.hash &&
      innerTransfer.txHash === bumpResult.hash,
    `ambas consultas dan el hash del ledger (${bumpResult.hash.slice(0, 8)}…)`,
  );
  check(
    outerTransfer.payerAddress === payer.publicKey(),
    'el pagador es el vecino, no quien patrocina la comisión',
  );

  step('Lectura tipo watcher');
  const all = await gateway.listAccountPayments(treasury.publicKey, {
    order: 'asc',
    limit: 200,
  });
  const transfers = collectIncomingTransfers(all, target);
  check(
    transfers.length === 6,
    `la caja recibió 6 transferencias en el activo de cobro (hay ${transfers.length})`,
  );
  check(
    transfers[0].memo === memoExact && transfers[0].txHash === exactHash,
    'la primera es el pago exacto, con su memo',
  );
  const next = await gateway.listAccountPayments(treasury.publicKey, {
    order: 'asc',
    limit: 200,
    cursor: transfers[transfers.length - 1].pagingToken,
  });
  check(
    collectIncomingTransfers(next, target).length === 0,
    'desde el último cursor no hay nada nuevo',
  );
  if (capture) {
    fs.writeFileSync(
      path.join(CAPTURE_DIR, 'account-payments.json'),
      JSON.stringify(
        {
          description: 'account-payments',
          target,
          expectedTransfers: transfers.length,
          operations: all.map(slim),
        },
        null,
        2,
      ) + '\n',
    );
  }

  step('Retiro: una firma no alcanza, dos sí');
  const buildWithdrawal = async () =>
    new TransactionBuilder(await horizon.loadAccount(treasury.publicKey), {
      fee: FEE,
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: payer.publicKey(),
          asset,
          amount: '1',
        }),
      )
      .addMemo(Memo.text('Retiro de prueba'))
      .setTimeout(120)
      .build();

  const oneSignature = await buildWithdrawal();
  oneSignature.sign(board[0]);
  let rejected: string | undefined;
  try {
    await horizon.submitTransaction(oneSignature);
  } catch (error) {
    rejected = resultCodesOf(error)?.transaction;
  }
  check(
    rejected === 'tx_bad_auth',
    `con una firma la red la rechaza (${rejected ?? 'sin rechazo'})`,
  );

  const twoSignatures = await buildWithdrawal();
  twoSignatures.sign(board[0], board[1]);
  const withdrawal = await submit(horizon, twoSignatures);
  check(withdrawal.hash, 'con dos firmas el retiro pasa');
  console.log(`    ${links.tx(withdrawal.hash)}`);

  console.log('\nTodo verificado en testnet.');
  console.log(`Caja: ${links.account(treasury.publicKey)}`);
  if (capture) console.log(`Fixtures guardados en ${CAPTURE_DIR}`);
}

/**
 * Keeps only the Horizon fields the API reads, so a captured fixture stays
 * small and shows exactly what the verifier depends on.
 */
function slim(operation: HorizonOperation): HorizonOperation {
  const transaction = operation.transaction;
  return {
    id: operation.id,
    paging_token: operation.paging_token,
    type: operation.type,
    transaction_hash: operation.transaction_hash,
    transaction_successful: operation.transaction_successful,
    source_account: operation.source_account,
    created_at: operation.created_at,
    from: operation.from,
    to: operation.to,
    amount: operation.amount,
    asset_type: operation.asset_type,
    asset_code: operation.asset_code,
    asset_issuer: operation.asset_issuer,
    transaction: transaction && {
      hash: transaction.hash,
      ledger: transaction.ledger,
      created_at: transaction.created_at,
      successful: transaction.successful,
      source_account: transaction.source_account,
      fee_account: transaction.fee_account,
      memo_type: transaction.memo_type,
      memo: transaction.memo,
      inner_transaction: transaction.inner_transaction && {
        hash: transaction.inner_transaction.hash,
      },
      fee_bump_transaction: transaction.fee_bump_transaction && {
        hash: transaction.fee_bump_transaction.hash,
      },
    },
  };
}

/** Signs a transaction and hands it back, so it can be built and sent in one expression. */
function signed<T extends { sign(...keypairs: Keypair[]): void }>(
  transaction: T,
  ...keypairs: Keypair[]
): T {
  transaction.sign(...keypairs);
  return transaction;
}

main().catch((error) => {
  console.error(
    `\n✗ ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
