/**
 * What the demo scripts need from the running API: a session that keeps its
 * cookies, and the two steps every demo building goes through (treasury, then
 * charges). The scripts never boot the app themselves, so they open no MQTT
 * client and can run against a deployed instance.
 */
import { boardKeypairs, loadDemoKeys } from './testnet';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class ApiSession {
  private readonly cookies = new Map<string, string>();
  readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}/api/v1${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Cookie: [...this.cookies]
          .map(([name, value]) => `${name}=${value}`)
          .join('; '),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0];
      const separator = pair.indexOf('=');
      this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }

    if (!response.ok) {
      const problem = (await response.json().catch(() => null)) as {
        message?: string | string[];
      } | null;
      const message = Array.isArray(problem?.message)
        ? problem.message.join('; ')
        : (problem?.message ?? response.statusText);
      throw new ApiError(response.status, `${method} ${path}: ${message}`);
    }

    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  /**
   * GET of a list. Several list endpoints of this API answer 404, not an
   * empty array, when there is nothing saved yet.
   */
  async list<T>(path: string): Promise<T[]> {
    try {
      return await this.request<T[]>('GET', path);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return [];
      throw error;
    }
  }

  /** Logs in and returns the account's id. */
  async login(email: string, password: string): Promise<string> {
    if (!password) {
      throw new Error(
        'Set DEMO_ADMIN_PASSWORD (in .env or the environment) to the password of the demo administrator',
      );
    }
    const { user } = await this.request<{ user: { id: string } }>(
      'POST',
      '/auth/login',
      { email, password },
    );
    return user.id;
  }
}

export interface DemoBuilding {
  id: string;
  name: string;
}

export interface DemoTreasury {
  publicKey: string;
  explorerUrl: string;
  threshold: number;
  signers: { publicKey: string; label: string }[];
}

export interface DemoCharge {
  apartmentNumber: string;
  month: string;
  amountBs: number;
  amountUsdc: string;
  status: string;
  publicCode: string;
}

/** Who signs for a demo building, in the order of the stored board keys. */
const BOARD_LABELS = [
  'Administración',
  'Presidencia de la directiva',
  'Tesorería',
];
const THRESHOLD = 2;

export const demoSettings = {
  apiUrl: process.env.DEMO_API_URL ?? 'http://localhost:4001',
  frontendUrl: (
    process.env.DEMO_FRONTEND_URL ?? 'http://localhost:3000'
  ).replace(/\/+$/, ''),
  adminEmail: process.env.DEMO_ADMIN_EMAIL ?? 'admin1@aquatrack.net',
  // No default on purpose: these scripts are published. Set it in .env.
  adminPassword: process.env.DEMO_ADMIN_PASSWORD ?? '',
  bsPerUsdc: process.env.DEMO_BS_PER_USDC
    ? Number(process.env.DEMO_BS_PER_USDC)
    : undefined,
};

/** Returns the building's treasury, creating a 2-of-3 one with the demo board when missing. */
export async function ensureTreasury(
  api: ApiSession,
  buildingId: string,
): Promise<{ treasury: DemoTreasury; created: boolean }> {
  const existing = await api.request<{ treasury: DemoTreasury | null }>(
    'GET',
    `/buildings/${buildingId}/treasury`,
  );
  if (existing.treasury) return { treasury: existing.treasury, created: false };

  const signers = boardKeypairs(loadDemoKeys(), BOARD_LABELS.length).map(
    (member, index) => ({
      publicKey: member.publicKey(),
      label: BOARD_LABELS[index],
    }),
  );
  const { treasury } = await api.request<{ treasury: DemoTreasury }>(
    'POST',
    `/buildings/${buildingId}/treasury`,
    { signers, threshold: THRESHOLD },
  );
  return { treasury, created: true };
}

/** Publishes the charges of a saved month. Repeating it changes nothing. */
export function publishMonth(
  api: ApiSession,
  buildingId: string,
  month: string,
): Promise<{ created: number; charges: DemoCharge[] }> {
  return api.request('POST', '/water-charges/publish', {
    buildingId,
    month,
    ...(demoSettings.bsPerUsdc ? { bsPerUsdc: demoSettings.bsPerUsdc } : {}),
  });
}

export function printPayLinks(charges: DemoCharge[], limit: number): void {
  const pending = charges.filter((charge) => charge.status === 'pending');
  for (const charge of pending.slice(0, limit)) {
    console.log(
      `  depto ${charge.apartmentNumber}, ${charge.month}, Bs ${charge.amountBs.toFixed(2)} = ${charge.amountUsdc}`,
    );
    console.log(`    ${demoSettings.frontendUrl}/pagar/${charge.publicCode}`);
  }
}
