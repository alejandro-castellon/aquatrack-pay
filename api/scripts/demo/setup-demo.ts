/**
 * Prepares the demo through the running API: logs in as the demo admin,
 * creates a 2-of-3 treasury for each of their buildings, publishes the
 * charges of every saved month and prints a few pay links.
 *
 * Run, with the API up against the seeded demo database:
 *   pnpm demo:setup
 *
 * Env (all optional):
 *   DEMO_API_URL         default http://localhost:4001
 *   DEMO_FRONTEND_URL    default http://localhost:3000
 *   DEMO_ADMIN_EMAIL     default admin1@aquatrack.net (seed account)
 *   DEMO_ADMIN_PASSWORD  required: that account's password (never kept in code)
 *   DEMO_BS_PER_USDC     rate to publish with; otherwise the API's reference rate
 *
 * Safe to repeat: an existing treasury is kept and publishing never duplicates
 * or changes a charge. The board keys come from scripts/demo/.demo-keys.json.
 */
import 'dotenv/config';
import {
  ApiError,
  ApiSession,
  DemoBuilding,
  DemoCharge,
  demoSettings,
  ensureTreasury,
  printPayLinks,
  publishMonth,
} from './lib/api-session';
import { step } from './lib/testnet';

const LINKS_PER_BUILDING = 3;

async function main(): Promise<void> {
  const api = new ApiSession(demoSettings.apiUrl);

  step(`Sesión como ${demoSettings.adminEmail} en ${api.baseUrl}`);
  const adminId = await api.login(
    demoSettings.adminEmail,
    demoSettings.adminPassword,
  );
  const buildings = await api.request<DemoBuilding[]>(
    'GET',
    `/buildings/admin/${adminId}`,
  );
  console.log(`  ${buildings.length} edificio(s)`);

  for (const building of buildings) {
    step(building.name);

    const { treasury, created } = await ensureTreasury(api, building.id);
    console.log(
      created
        ? `  caja creada (${treasury.threshold} de ${treasury.signers.length})`
        : '  la caja ya existía',
    );
    console.log(`  ${treasury.explorerUrl}`);

    const months = await api.list<{ month: string }>(
      `/building-consumption/monthly/${building.id}?months=12`,
    );
    if (months.length === 0) {
      console.log('  sin prorrateos guardados: no hay nada que publicar');
      continue;
    }

    const charges: DemoCharge[] = [];
    for (const { month } of months) {
      try {
        const result = await publishMonth(api, building.id, month);
        console.log(
          `  ${month}: ${result.charges.length} cobros (${result.created} nuevos)`,
        );
        charges.push(...result.charges);
      } catch (error) {
        // A month with no apartment rows is not an error for the demo.
        if (error instanceof ApiError && error.status === 404) {
          console.log(`  ${month}: sin consumos por departamento`);
          continue;
        }
        throw error;
      }
    }

    printPayLinks(charges, LINKS_PER_BUILDING);
  }

  console.log('\nDemo preparada.');
}

main().catch((error) => {
  console.error(
    `\n✗ ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
