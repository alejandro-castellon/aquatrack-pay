"use client";

import { Logo } from "@/components/logo";
import { fetchNextDemoCharge } from "@/lib/api/water-charges";
import { ArrowRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CopyField } from "./copy-field";

interface DemoGuideProps {
  adminEmail: string | null;
  adminPassword: string | null;
}

const card = "rounded-2xl border border-sky-100 bg-white p-5 shadow-sm sm:p-6";
const primaryButton =
  "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-sky-700 px-6 text-base font-semibold text-white shadow-lg shadow-sky-700/25 transition-colors hover:bg-sky-800 focus-visible:ring-2 focus-visible:ring-sky-700 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton =
  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-sky-200 bg-white px-5 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50 focus-visible:ring-2 focus-visible:ring-sky-700 focus-visible:outline-none";

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className={card}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sky-700 text-sm font-bold text-white tabular-nums"
        >
          {number}
        </span>
        <h2 className="pt-0.5 text-lg font-bold tracking-tight text-slate-900">
          {title}
        </h2>
      </div>
      <div className="mt-3 space-y-4 text-sm text-slate-600">{children}</div>
    </section>
  );
}

/** Guía de tres pasos para probar el cobro sin que nadie del equipo esté presente. */
export default function DemoGuide({ adminEmail, adminPassword }: DemoGuideProps) {
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleOpenCharge = async () => {
    setOpening(true);
    setMessage(null);
    try {
      const { code } = await fetchNextDemoCharge();
      router.push(`/pagar/${code}`);
    } catch (error) {
      const status = (error as { status?: number }).status;
      setMessage(
        status === 404
          ? "Ahora no quedan recibos pendientes. La demo se reinicia cada noche."
          : "No pudimos abrir un recibo. Revisa tu conexión e inténtalo de nuevo.",
      );
      setOpening(false);
    }
  };

  return (
    <div className="min-h-dvh bg-gradient-to-b from-sky-50 to-white">
      <div className="mx-auto w-full max-w-md px-4 pt-6 pb-10">
        <header className="mb-5 flex items-center justify-between">
          <Link
            href="/"
            aria-label="AquaTrack, ir al inicio"
            className="rounded-lg focus-visible:ring-2 focus-visible:ring-sky-700 focus-visible:outline-none"
          >
            <Logo w={32} h={32} />
          </Link>
          <span className="text-xs font-medium text-slate-500">Demo</span>
        </header>

        <main className="flex flex-col gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Prueba el cobro del agua en tres pasos
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              AquaTrack reparte la factura de agua del edificio según el consumo
              medido de cada departamento. Aquí ese recibo se paga, se concilia
              solo y llega a una caja que solo mueve la directiva.
            </p>
          </div>

          <p
            role="note"
            className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <strong className="font-semibold">Demo con datos de ejemplo.</strong>{" "}
            Funciona en la red de prueba de Stellar: nada de lo que pagues tiene
            valor real.
          </p>

          <Step number={1} title="Paga un recibo como vecino">
            <p>
              Entra con tu correo, recibe USDC de prueba y paga. No necesitas
              instalar nada ni tener una billetera.
            </p>
            <button
              type="button"
              className={primaryButton}
              onClick={handleOpenCharge}
              disabled={opening}
            >
              {opening ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              Abrir un recibo pendiente
              {!opening && <ArrowRight className="size-4" aria-hidden />}
            </button>
            <p aria-live="polite" className="min-h-5 text-slate-700">
              {message}
            </p>
          </Step>

          <Step number={2} title="Mira la caja como administrador">
            <p>
              Entra al panel y abre <strong>Caja</strong> en el menú: verás el
              saldo, los firmantes y el pago que acabas de hacer, ya conciliado.
              En <strong>Prorrateo</strong> está el detalle de cada mes con sus
              cobros.
            </p>
            {adminEmail && adminPassword ? (
              <dl className="space-y-3">
                <CopyField label="Correo" value={adminEmail} />
                <CopyField label="Contraseña" value={adminPassword} />
              </dl>
            ) : (
              <p>Pide el acceso de administrador al equipo de AquaTrack.</p>
            )}
            <Link href="/login" className={secondaryButton}>
              Entrar al panel
            </Link>
          </Step>

          <Step number={3} title="Compruébalo en la red">
            <p>
              Cada pago y la propia caja abren su registro en el explorador de
              Stellar. Ahí se ve que la caja exige dos de tres firmas y que su
              llave maestra está desactivada: AquaTrack no puede mover esos
              fondos.
            </p>
          </Step>
        </main>
      </div>
    </div>
  );
}
