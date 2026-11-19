import { apiFetch } from "./client";
import {
  ConfirmWaterChargeResult,
  DemoFundsResult,
  PublicWaterCharge,
  PublishWaterChargesResult,
  WaterCharge,
} from "@/types";
import { PublishWaterChargesPayload } from "@/types/payloads";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL;
const CHARGES_URL = `${BASE_URL}/api/v1/water-charges`;

/** Convierte en cobros el prorrateo guardado de un mes. Repetirlo no duplica nada. */
export async function publishWaterCharges(
  data: PublishWaterChargesPayload,
): Promise<PublishWaterChargesResult> {
  return apiFetch<PublishWaterChargesResult>(`${CHARGES_URL}/publish`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function fetchWaterChargesByBuilding(
  buildingId: string,
  month: string,
): Promise<WaterCharge[]> {
  return apiFetch<WaterCharge[]>(
    `${CHARGES_URL}/by-building/${buildingId}?month=${encodeURIComponent(month)}`,
  );
}

export async function fetchWaterChargesByApartment(
  apartmentId: string,
): Promise<WaterCharge[]> {
  return apiFetch<WaterCharge[]>(`${CHARGES_URL}/by-apartment/${apartmentId}`);
}

// Los tres siguientes son públicos: funcionan con el código del enlace, sin sesión.

export async function fetchPublicWaterCharge(
  code: string,
): Promise<PublicWaterCharge> {
  return apiFetch<PublicWaterCharge>(
    `${CHARGES_URL}/public/${encodeURIComponent(code)}`,
  );
}

/** Pide a la API que lea la transacción en la red y, si corresponde, marque el cobro como pagado. */
export async function confirmWaterCharge(
  code: string,
  txHash: string,
): Promise<ConfirmWaterChargeResult> {
  return apiFetch<ConfirmWaterChargeResult>(
    `${CHARGES_URL}/public/${encodeURIComponent(code)}/confirm`,
    { method: "POST", body: JSON.stringify({ txHash }) },
  );
}

/** Solo en la demo de testnet: envía al pagador los USDC de prueba que le faltan. */
export async function requestDemoFunds(
  code: string,
  payerAddress: string,
): Promise<DemoFundsResult> {
  return apiFetch<DemoFundsResult>(
    `${CHARGES_URL}/public/${encodeURIComponent(code)}/demo-funds`,
    { method: "POST", body: JSON.stringify({ payerAddress }) },
  );
}

/** Solo en la demo: código de un cobro pendiente para que alguien pruebe pagar. */
export async function fetchNextDemoCharge(): Promise<{ code: string }> {
  return apiFetch<{ code: string }>(`${CHARGES_URL}/public/demo/next`);
}
