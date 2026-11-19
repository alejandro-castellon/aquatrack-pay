"use client";

import { Logo } from "@/components/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { useWaterCharge } from "@/lib/hooks/use-water-charge";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect } from "react";
import { ChargeSummary } from "./charge-summary";
import { OtherWalletPay } from "./other-wallet-pay";
import { PaymentSuccess } from "./payment-success";

// El SDK de Pollar solo se descarga cuando esta página lo necesita.
const PollarPay = dynamic(() => import("./pollar-pay"), {
  ssr: false,
  loading: () => <Skeleton className="h-12 w-full rounded-full" />,
});

const pollarEnabled = Boolean(process.env.NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY);

/** Cada cuánto se vuelve a consultar un cobro pendiente, por si lo pagan desde otra billetera. */
const REFRESH_MS = 4000;

const card = "rounded-2xl border border-sky-100 bg-white p-5 shadow-sm sm:p-6";

function Notice({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className={card}>
      <h1 className="text-xl font-bold tracking-tight text-slate-900">
        {title}
      </h1>
      <div className="mt-2 space-y-4 text-sm text-slate-600">{children}</div>
    </section>
  );
}

/** Página pública de pago de un recibo de agua, abierta con el enlace o el QR del recibo. */
export default function PayCharge({ code }: { code: string }) {
  const { charge, error, loading, refetch, replace } = useWaterCharge(code);
  const pending = charge?.status === "pending";

  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refetch();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [pending, refetch]);

  return (
    <div className="min-h-dvh bg-gradient-to-b from-sky-50 to-white">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pt-6 pb-10">
        <header className="mb-5 flex items-center justify-between">
          <Link
            href="/"
            aria-label="AquaTrack, ir al inicio"
            className="rounded-lg focus-visible:ring-2 focus-visible:ring-sky-700 focus-visible:outline-none"
          >
            <Logo w={32} h={32} />
          </Link>
          <span className="text-xs font-medium text-slate-500">
            Pago de recibo
          </span>
        </header>

        <main className="flex flex-1 flex-col gap-4">
          {loading && (
            <div className={card} aria-busy="true" aria-label="Cargando el recibo">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-3 h-7 w-3/4" />
              <Skeleton className="mt-6 h-4 w-full" />
              <Skeleton className="mt-3 h-4 w-full" />
              <Skeleton className="mt-3 h-4 w-2/3" />
              <Skeleton className="mt-6 h-20 w-full rounded-xl" />
            </div>
          )}

          {!loading && error === "not_found" && (
            <Notice title="No encontramos este recibo">
              <p>
                Revisa que el enlace esté completo o pide uno nuevo a la
                administración de tu edificio.
              </p>
            </Notice>
          )}

          {!loading && error === "unavailable" && (
            <Notice title="No pudimos cargar el recibo">
              <p>Revisa tu conexión e inténtalo de nuevo.</p>
              <button
                type="button"
                onClick={refetch}
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-sky-700 px-6 text-sm font-semibold text-white transition-colors hover:bg-sky-800 focus-visible:ring-2 focus-visible:ring-sky-700 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                Reintentar
              </button>
            </Notice>
          )}

          {charge && (
            <>
              {charge.payment.network === "testnet" && (
                <p
                  role="note"
                  className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                >
                  <strong className="font-semibold">
                    Demo con datos de ejemplo.
                  </strong>{" "}
                  Funciona en la red de prueba de Stellar: los{" "}
                  {charge.payment.assetCode} son de prueba y no tienen valor
                  real.
                </p>
              )}

              <ChargeSummary charge={charge} />

              {charge.status === "paid" && <PaymentSuccess charge={charge} />}

              {charge.status === "cancelled" && (
                <section className={card}>
                  <h2 className="text-lg font-bold tracking-tight text-slate-900">
                    Este cobro fue anulado
                  </h2>
                  <p className="mt-2 text-sm text-slate-600">
                    La administración lo anuló y ya no se puede pagar. Si crees
                    que es un error, consulta con el administrador de tu
                    edificio.
                  </p>
                </section>
              )}

              {charge.status === "pending" && (
                <>
                  {pollarEnabled && (
                    <section
                      aria-labelledby="pollar-pay-title"
                      className={card}
                    >
                      <h2
                        id="pollar-pay-title"
                        className="text-lg font-bold tracking-tight text-slate-900"
                      >
                        Paga con tu correo
                      </h2>
                      <div className="mt-3">
                        <PollarPay
                          code={code}
                          charge={charge}
                          onCharge={replace}
                        />
                      </div>
                    </section>
                  )}
                  <OtherWalletPay charge={charge} />
                </>
              )}
            </>
          )}
        </main>

        <footer className="mt-8 space-y-1 text-center text-xs text-slate-500">
          <p>
            El pago va de tu billetera a la caja del edificio, una cuenta que
            solo mueve su directiva.
          </p>
          <p>
            ¿Dudas sobre el monto? Consulta con la administración de tu
            edificio.
          </p>
        </footer>
      </div>
    </div>
  );
}
