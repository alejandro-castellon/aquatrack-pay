import { apiFetch } from "./client";
import { BuildingTreasuryResponse } from "@/types";
import { CreateBuildingTreasuryPayload } from "@/types/payloads";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL;

const treasuryUrl = (buildingId: string) =>
  `${BASE_URL}/api/v1/buildings/${buildingId}/treasury`;

/** `treasury` es null mientras el edificio no tenga caja. */
export async function fetchBuildingTreasury(
  buildingId: string,
): Promise<BuildingTreasuryResponse> {
  return apiFetch<BuildingTreasuryResponse>(treasuryUrl(buildingId));
}

export async function createBuildingTreasury(
  buildingId: string,
  data: CreateBuildingTreasuryPayload,
): Promise<BuildingTreasuryResponse> {
  return apiFetch<BuildingTreasuryResponse>(treasuryUrl(buildingId), {
    method: "POST",
    body: JSON.stringify(data),
  });
}
