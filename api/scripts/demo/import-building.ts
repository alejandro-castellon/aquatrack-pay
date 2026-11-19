/**
 * Loads a building into the running API from a CSV and makes one month
 * payable: the building, its apartments, the month's split, the treasury and
 * the charges. Everything goes through the public endpoints.
 *
 * It creates the example building of the demo, and it is how a real building
 * without meters can try the collection flow: its administrator supplies the
 * split they already use.
 *
 *   pnpm demo:import --csv scripts/demo/data/edificio-de-ejemplo.csv \
 *     --name "Edificio de ejemplo" --month 2026-10 --bill 1240 --m3 92 \
 *     --start 2026-09-09 --end 2026-10-08
 *
 * CSV columns: departamento,piso,consumo_m3,monto_bs
 *   - monto_bs empty: the bill (--bill, --m3) is split by consumption exactly
 *     as the platform does, common areas apart.
 *   - monto_bs filled: that amount is charged as is (consumo_m3 may be empty).
 *
 * Other options: --address, --municipality, --department (default Cochabamba).
 * Safe to repeat: existing apartments, monthly records and charges are kept.
 * Env: the same DEMO_* variables as setup-demo.ts.
 */
import 'dotenv/config';
import * as fs from 'fs';
import {
  ApiSession,
  DemoBuilding,
  demoSettings,
  ensureTreasury,
  printPayLinks,
  publishMonth,
} from './lib/api-session';
import { step } from './lib/testnet';

interface CsvRow {
  apartmentNumber: string;
  floor: number;
  m3: number;
  amountBs: number | null;
}

interface SplitRow extends CsvRow {
  amountBs: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Falta el valor de ${key}`);
    }
    args[key.slice(2)] = value;
    index++;
  }
  return args;
}

function required(args: Record<string, string>, name: string): string {
  const value = args[name];
  if (!value) throw new Error(`Falta --${name}`);
  return value;
}

function parseNumber(text: string, what: string): number {
  const value = Number(text.trim().replace(',', '.'));
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${what} no es un número válido: "${text}"`);
  }
  return value;
}

function readCsv(path: string): CsvRow[] {
  const lines = fs
    .readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const [header, ...rows] = lines;
  if (
    !/^departamento\s*,\s*piso\s*,\s*consumo_m3\s*,\s*monto_bs$/i.test(header)
  ) {
    throw new Error(
      'La primera línea del CSV debe ser: departamento,piso,consumo_m3,monto_bs',
    );
  }

  const seen = new Set<string>();
  return rows.map((line, index) => {
    const [number = '', floor = '', m3 = '', amount = ''] = line
      .split(',')
      .map((cell) => cell.trim());
    const where = `fila ${index + 2}`;
    if (!number) throw new Error(`${where}: falta el departamento`);
    if (seen.has(number)) throw new Error(`${where}: ${number} está repetido`);
    seen.add(number);

    return {
      apartmentNumber: number,
      floor: Math.trunc(parseNumber(floor || '1', `${where}: el piso`)),
      m3: m3 ? parseNumber(m3, `${where}: el consumo`) : 0,
      amountBs: amount ? parseNumber(amount, `${where}: el monto`) : null,
    };
  });
}

/**
 * Same split as the API (calculate-building-monthly-consumption): cost per m³
 * from the utility bill, common areas = billed m³ minus the sum of the
 * apartments (never negative), and the rest in proportion to each consumption.
 */
function splitByConsumption(
  rows: CsvRow[],
  billBs: number,
  billM3: number,
): { rows: SplitRow[]; commonM3: number; commonBs: number } {
  const measuredM3 = rows.reduce((total, row) => total + row.m3, 0);
  if (billM3 <= 0 || measuredM3 <= 0) {
    throw new Error(
      'Para repartir por consumo hacen falta --m3 y un consumo_m3 mayor que cero',
    );
  }
  const costPerM3 = billBs / billM3;
  const commonM3 = Math.max(0, billM3 - measuredM3);
  const commonBs = commonM3 * costPerM3;
  const apartmentsBs = billBs - commonBs;

  return {
    rows: rows.map((row) => ({
      ...row,
      amountBs: round2((row.m3 / measuredM3) * apartmentsBs),
    })),
    commonM3: round2(commonM3),
    commonBs: round2(commonBs),
  };
}

function periodDays(start?: string, end?: string): number {
  if (!start || !end) return 30;
  const days =
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
      86_400_000 +
    1;
  return Number.isFinite(days) && days > 0 ? days : 30;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const csvPath = required(args, 'csv');
  const name = required(args, 'name');
  const month = required(args, 'month');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error('--month debe tener el formato AAAA-MM');
  }
  const { start, end } = args;

  const csvRows = readCsv(csvPath);
  if (csvRows.length === 0) throw new Error('El CSV no tiene departamentos');

  const loaded = csvRows.every((row) => row.amountBs !== null);
  const partlyLoaded = csvRows.some((row) => row.amountBs !== null);
  if (partlyLoaded && !loaded) {
    throw new Error(
      'monto_bs debe venir en todas las filas o en ninguna: no se mezclan los dos repartos',
    );
  }

  const measuredM3 = round2(csvRows.reduce((total, row) => total + row.m3, 0));
  let rows: SplitRow[];
  let billBs: number;
  let billM3: number;
  let commonM3 = 0;
  let commonBs = 0;

  if (loaded) {
    rows = csvRows.map((row) => ({ ...row, amountBs: row.amountBs as number }));
    const total = round2(rows.reduce((sum, row) => sum + row.amountBs, 0));
    billBs = args.bill ? parseNumber(args.bill, '--bill') : total;
    billM3 = args.m3 ? parseNumber(args.m3, '--m3') : measuredM3;
    commonBs = round2(Math.max(0, billBs - total));
    commonM3 = round2(Math.max(0, billM3 - measuredM3));
  } else {
    billBs = parseNumber(required(args, 'bill'), '--bill');
    billM3 = parseNumber(required(args, 'm3'), '--m3');
    ({ rows, commonM3, commonBs } = splitByConsumption(
      csvRows,
      billBs,
      billM3,
    ));
  }

  step(`Reparto de ${month}`);
  for (const row of rows) {
    console.log(
      `  ${row.apartmentNumber.padEnd(6)} ${row.m3.toFixed(2).padStart(7)} m³  Bs ${row.amountBs.toFixed(2).padStart(8)}`,
    );
  }
  console.log(
    `  áreas comunes: ${commonM3.toFixed(2)} m³, Bs ${commonBs.toFixed(2)}`,
  );
  console.log(`  factura: Bs ${billBs.toFixed(2)} por ${billM3.toFixed(2)} m³`);

  const api = new ApiSession(demoSettings.apiUrl);
  step(`Sesión como ${demoSettings.adminEmail} en ${api.baseUrl}`);
  const adminId = await api.login(
    demoSettings.adminEmail,
    demoSettings.adminPassword,
  );

  step(name);
  const buildings = await api.request<DemoBuilding[]>(
    'GET',
    `/buildings/admin/${adminId}`,
  );
  let building = buildings.find((candidate) => candidate.name === name);
  if (building) {
    console.log('  el edificio ya existía');
  } else {
    building = await api.request<DemoBuilding>('POST', '/buildings', {
      name,
      address: args.address ?? 'Dirección de ejemplo',
      department: args.department ?? 'Cochabamba',
      municipality: args.municipality ?? 'Cochabamba',
      totalApartments: rows.length,
      floors: Math.max(...rows.map((row) => row.floor), 1),
    });
    console.log('  edificio creado');
  }
  const buildingId = building.id;

  // The endpoint wraps each apartment with its owner, tenant and valve state.
  const existingApartments = await api.list<{
    apartment: { id: string; apartmentNumber: string };
  }>(`/apartments/building/${buildingId}`);
  const apartmentIds = new Map(
    existingApartments.map(({ apartment }) => [
      apartment.apartmentNumber,
      apartment.id,
    ]),
  );
  let createdApartments = 0;
  for (const row of rows) {
    if (apartmentIds.has(row.apartmentNumber)) continue;
    const apartment = await api.request<{ id: string }>('POST', '/apartments', {
      apartmentNumber: row.apartmentNumber,
      floor: row.floor,
      buildingId,
    });
    apartmentIds.set(row.apartmentNumber, apartment.id);
    createdApartments++;
  }
  console.log(`  ${rows.length} departamentos (${createdApartments} nuevos)`);

  const days = periodDays(start, end);
  const period = {
    ...(start ? { periodStartDate: start } : {}),
    ...(end ? { periodEndDate: end } : {}),
  };

  const saved = await api.list<{ month: string }>(
    `/building-consumption/monthly/${buildingId}?startMonth=${month}&endMonth=${month}`,
  );
  if (saved.some((record) => record.month === month)) {
    console.log(`  el registro de ${month} ya existía`);
  } else {
    const avgDaily = round2(measuredM3 / days);
    await api.request('POST', '/building-consumption', {
      buildingId,
      month,
      payment: billBs,
      consumption: measuredM3,
      inputConsumption: billM3,
      commonAreasConsumption: commonM3,
      commonAreasPayment: commonBs,
      avgDailyUsage: avgDaily,
      peakDayUsage: avgDaily,
      ...period,
    });
    console.log(`  registro de ${month} guardado`);
  }

  const savedRows = await api.list<{ apartmentId: string }>(
    `/apartments-consumption/monthly/by-building/${buildingId}?month=${month}`,
  );
  const alreadySaved = new Set(savedRows.map((row) => row.apartmentId));
  const missing = rows.filter(
    (row) => !alreadySaved.has(apartmentIds.get(row.apartmentNumber) as string),
  );
  if (missing.length > 0) {
    await api.request('POST', '/apartments-consumption', {
      apartments: missing.map((row) => {
        const avgDaily = round2(row.m3 / days);
        return {
          apartmentId: apartmentIds.get(row.apartmentNumber),
          month,
          payment: row.amountBs,
          consumption: row.m3,
          avgDailyUsage: avgDaily,
          peakDayUsage: avgDaily,
          ...period,
        };
      }),
    });
  }
  console.log(
    `  ${rows.length} consumos por departamento (${missing.length} nuevos)`,
  );

  const { treasury, created } = await ensureTreasury(api, buildingId);
  console.log(
    created
      ? `  caja creada (${treasury.threshold} de ${treasury.signers.length})`
      : '  la caja ya existía',
  );
  console.log(`  ${treasury.explorerUrl}`);

  const published = await publishMonth(api, buildingId, month);
  console.log(
    `  ${published.charges.length} cobros (${published.created} nuevos)`,
  );
  printPayLinks(published.charges, rows.length);

  console.log(`\nEdificio listo. Su id: ${buildingId}`);
  console.log(
    'Para que la guía /demo reparta solo recibos de este edificio, define en la API:',
  );
  console.log(`  STELLAR_DEMO_BUILDING_ID=${buildingId}`);
}

main().catch((error) => {
  console.error(
    `\n✗ ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
