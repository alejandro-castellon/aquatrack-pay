import { fetchWaterChargesByBuilding } from "@/lib/api/water-charges";
import { WaterCharge } from "@/types";
import { useCallback, useEffect, useState } from "react";

interface LoadedCharges {
  key: string;
  charges: WaterCharge[];
  error: string | null;
}

/**
 * Cobros de un edificio para un mes. Mientras lo guardado sea de otro edificio
 * u otro mes, el hook informa que está cargando.
 */
export function useBuildingWaterCharges(buildingId: string, month: string) {
  const [loaded, setLoaded] = useState<LoadedCharges | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  const key = `${buildingId}:${month}`;
  const current = loaded?.key === key ? loaded : null;

  useEffect(() => {
    let ignore = false;

    fetchWaterChargesByBuilding(buildingId, month)
      .then((charges) => {
        if (!ignore) setLoaded({ key, charges, error: null });
      })
      .catch((error: unknown) => {
        if (ignore) return;
        setLoaded((previous) => ({
          key,
          // Un refresco que falla conserva la lista que ya se ve.
          charges: previous?.key === key ? previous.charges : [],
          error:
            error instanceof Error
              ? error.message
              : "No se pudieron cargar los cobros.",
        }));
      });

    return () => {
      ignore = true;
    };
  }, [buildingId, month, key, reloadCount]);

  const refresh = useCallback(() => setReloadCount((count) => count + 1), []);

  /** Muestra de inmediato la lista que devolvió la API al publicar. */
  const replace = useCallback(
    (charges: WaterCharge[]) => setLoaded({ key, charges, error: null }),
    [key],
  );

  return {
    charges: current?.charges ?? [],
    error: current?.error ?? null,
    loading: current === null,
    refresh,
    replace,
  };
}
