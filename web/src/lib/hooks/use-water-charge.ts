import { fetchPublicWaterCharge } from "@/lib/api/water-charges";
import { PublicWaterCharge } from "@/types";
import { useCallback, useEffect, useState } from "react";

export type WaterChargeError = "not_found" | "unavailable";

interface LoadedCharge {
  code: string;
  charge: PublicWaterCharge | null;
  error: WaterChargeError | null;
}

interface UseWaterChargeReturn {
  charge: PublicWaterCharge | null;
  error: WaterChargeError | null;
  loading: boolean;
  /** Vuelve a pedir el cobro; lo que ya se muestra se queda mientras llega. */
  refetch: () => void;
  /** Pone en pantalla un cobro que la API acaba de devolver (p. ej. al confirmar). */
  replace: (charge: PublicWaterCharge) => void;
}

/** Cobro público por el código del enlace de pago. No necesita sesión. */
export function useWaterCharge(code: string): UseWaterChargeReturn {
  const [loaded, setLoaded] = useState<LoadedCharge | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  // Lo cargado solo vale para el código con el que se pidió.
  const current = loaded?.code === code ? loaded : null;

  useEffect(() => {
    let ignore = false;

    const load = async () => {
      try {
        const charge = await fetchPublicWaterCharge(code);
        if (!ignore) setLoaded({ code, charge, error: null });
      } catch (error) {
        if (ignore) return;
        const status = (error as { status?: number }).status;
        const notFound = status === 404 || status === 400;
        setLoaded((previous) =>
          // Un refresco que falla no borra el cobro que ya está en pantalla.
          previous?.code === code && previous.charge && !notFound
            ? previous
            : {
                code,
                charge: null,
                error: notFound ? "not_found" : "unavailable",
              },
        );
      }
    };

    load();

    return () => {
      ignore = true;
    };
  }, [code, reloadCount]);

  const refetch = useCallback(() => setReloadCount((count) => count + 1), []);

  const replace = useCallback(
    (charge: PublicWaterCharge) => setLoaded({ code, charge, error: null }),
    [code],
  );

  return {
    charge: current?.charge ?? null,
    error: current?.error ?? null,
    loading: current === null,
    refetch,
    replace,
  };
}
