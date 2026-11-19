// Extracto de src/types/payloads.ts de la plataforma: solo los tipos que añade este módulo.
// Los tipos de la plataforma a los que hacen referencia no están en este repositorio.

export interface PublishWaterChargesPayload {
  buildingId: string;
  /** "YYYY-MM" */
  month: string;
  /** Bs por 1 USDC; si falta, la API usa su tipo de cambio de referencia. */
  bsPerUsdc?: number;
}

export interface CreateBuildingTreasuryPayload {
  signers: { publicKey: string; label: string }[];
  threshold: number;
}
