import { fetchBuildingTreasury } from "@/lib/api/building-treasury";
import { BuildingTreasury } from "@/types";
import { useCallback, useEffect, useState } from "react";

interface LoadedTreasury {
  buildingId: string;
  /** null: el edificio todavía no tiene caja. */
  treasury: BuildingTreasury | null;
  error: string | null;
}

/** Caja del edificio seleccionado, con su saldo y movimientos leídos de la red. */
export function useBuildingTreasury(buildingId: string | null) {
  const [loaded, setLoaded] = useState<LoadedTreasury | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  const current =
    buildingId !== null && loaded?.buildingId === buildingId ? loaded : null;

  useEffect(() => {
    if (!buildingId) return;
    let ignore = false;

    fetchBuildingTreasury(buildingId)
      .then(({ treasury }) => {
        if (!ignore) setLoaded({ buildingId, treasury, error: null });
      })
      .catch((error: unknown) => {
        if (ignore) return;
        setLoaded((previous) => ({
          buildingId,
          treasury:
            previous?.buildingId === buildingId ? previous.treasury : null,
          error:
            error instanceof Error
              ? error.message
              : "No se pudo cargar la caja del edificio.",
        }));
      });

    return () => {
      ignore = true;
    };
  }, [buildingId, reloadCount]);

  const refresh = useCallback(() => setReloadCount((count) => count + 1), []);

  return {
    treasury: current?.treasury ?? null,
    error: current?.error ?? null,
    loading: buildingId !== null && current === null,
    refresh,
  };
}
