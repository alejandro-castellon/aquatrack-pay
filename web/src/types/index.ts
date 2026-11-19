// Extracto de src/types/index.ts de la plataforma: solo los tipos que añade este módulo.
// Los tipos de la plataforma a los que hacen referencia no están en este repositorio.

export type WaterChargeStatus = "pending" | "paid" | "cancelled";

export type StellarNetworkName = "testnet" | "public";

/**
 * Cobro de agua de un departamento para un mes, pagable en Stellar. `payment`
 * en los consumos mensuales es el monto adeudado; lo que de verdad se recibió
 * vive aquí (`txHash`, `paidAmountUsdc`, `paidAt`). Los montos en USDC llegan
 * como texto de 7 decimales para no pasar por flotantes.
 */
export interface WaterCharge {
  id: string;
  apartmentId: string;
  apartmentNumber: string;
  apartmentFloor: number;
  buildingId: string;
  month: string;
  consumption: number;
  amountBs: number;
  exchangeRate: number;
  amountUsdc: string;
  /** Código del activo en que se paga, normalmente "USDC". */
  assetCode: string;
  status: WaterChargeStatus;
  publicCode: string;
  memo: string;
  txHash: string | null;
  payerAddress: string | null;
  paidAmountUsdc: string | null;
  paidAt: string | null;
  explorerUrl: string | null;
  createdAt: string;
}

export interface PublishWaterChargesResult {
  created: number;
  charges: WaterCharge[];
}

/** Lo que ve cualquiera con el enlace de pago: sin ids, sin personas, sin otros meses. */
export interface PublicWaterCharge {
  buildingName: string;
  apartmentNumber: string;
  month: string;
  periodStartDate: string | null;
  periodEndDate: string | null;
  consumption: number;
  amountBs: number;
  exchangeRate: number;
  amountUsdc: string;
  status: WaterChargeStatus;
  payment: {
    destination: string;
    assetCode: string;
    assetIssuer: string;
    memo: string;
    network: StellarNetworkName;
    networkPassphrase: string;
  };
  paid: null | {
    txHash: string;
    paidAt: string;
    paidAmountUsdc: string;
    payerAddress: string;
    explorerUrl: string;
  };
  demo: { faucetEnabled: boolean };
}

export type ConfirmWaterChargeOutcome =
  | "paid"
  | "already_paid"
  | "not_found_yet"
  | "not_a_payment"
  | "wrong_memo"
  | "underpaid";

export interface ConfirmWaterChargeResult {
  outcome: ConfirmWaterChargeOutcome;
  charge: PublicWaterCharge;
}

export interface DemoFundsResult {
  txHash: string | null;
  amount: string;
}

export interface TreasurySigner {
  publicKey: string;
  label: string;
}

export type TreasuryTransferStatus =
  | "matched"
  | "unmatched"
  | "underpaid"
  | "duplicate";

export interface TreasuryTransfer {
  txHash: string;
  createdAt: string;
  payerAddress: string;
  amountUsdc: string;
  memo: string | null;
  status: TreasuryTransferStatus;
  apartmentNumber: string | null;
  month: string | null;
  explorerUrl: string;
}

/** Caja del edificio: una cuenta de Stellar que solo mueven sus firmantes. */
export interface BuildingTreasury {
  publicKey: string;
  network: StellarNetworkName;
  assetCode: string;
  assetIssuer: string;
  threshold: number;
  signers: TreasurySigner[];
  setupTxHash: string;
  createdAt: string;
  explorerUrl: string;
  /** null cuando no se pudo leer la red; la caja sigue existiendo. */
  onChain: null | {
    balance: string;
    xlmBalance: string;
    masterWeight: number;
    thresholds: { low: number; med: number; high: number };
    signers: { publicKey: string; weight: number }[];
  };
  transfers: TreasuryTransfer[];
}

export interface BuildingTreasuryResponse {
  treasury: BuildingTreasury | null;
}
