import { fetchWaterChargesByApartment } from "@/lib/api/water-charges";
import { WaterCharge } from "@/types";
import { useEffect, useMemo, useState } from "react";

const NO_CHARGES: WaterCharge[] = [];

/**
 * Cobros de un departamento, por mes ("YYYY-MM"). Si la consulta falla, el
 * mapa queda vacío: los recibos se siguen viendo, solo sin su estado de pago.
 */
export function useApartmentWaterCharges(
  apartmentId: string,
): Map<string, WaterCharge> {
  const [loaded, setLoaded] = useState<{
    apartmentId: string;
    charges: WaterCharge[];
  } | null>(null);

  useEffect(() => {
    let ignore = false;

    fetchWaterChargesByApartment(apartmentId)
      .then((charges) => {
        if (!ignore) setLoaded({ apartmentId, charges });
      })
      .catch(() => {
        if (!ignore) setLoaded({ apartmentId, charges: NO_CHARGES });
      });

    return () => {
      ignore = true;
    };
  }, [apartmentId]);

  const charges =
    loaded?.apartmentId === apartmentId ? loaded.charges : NO_CHARGES;

  return useMemo(
    () => new Map(charges.map((charge) => [charge.month, charge])),
    [charges],
  );
}
