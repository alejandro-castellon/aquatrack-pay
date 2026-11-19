import { formatUsdc, shortAddress } from "@/lib/utils/stellar-pay";
import { PublicWaterCharge } from "@/types";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { ArrowUpRight, CircleCheck } from "lucide-react";

/** El cobro ya está pagado: qué se recibió, cuándo y dónde comprobarlo. */
export function PaymentSuccess({ charge }: { charge: PublicWaterCharge }) {
  const paid = charge.paid;
  if (!paid) return null;

  const { assetCode, memo } = charge.payment;
  const paidAt = format(new Date(paid.paidAt), "d 'de' MMMM 'de' yyyy, HH:mm", {
    locale: es,
  });

  return (
    <section
      aria-labelledby="payment-success-title"
      className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <CircleCheck className="size-5" aria-hidden />
        </span>
        <div>
          <h2
            id="payment-success-title"
            className="text-xl font-bold tracking-tight text-slate-900"
          >
            Pago recibido
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Este recibo quedó pagado. No tienes que enviar ningún comprobante a
            la administración.
          </p>
        </div>
      </div>

      <dl className="mt-5 space-y-2.5 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-slate-600">Recibido</dt>
          <dd className="font-medium text-slate-900 tabular-nums">
            {formatUsdc(paid.paidAmountUsdc)} {assetCode}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-600">Fecha</dt>
          <dd className="text-right font-medium text-slate-900 tabular-nums">
            {paidAt}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-600">Referencia</dt>
          <dd className="font-mono font-medium text-slate-900">{memo}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-600">Pagado desde</dt>
          <dd
            className="font-mono font-medium text-slate-900"
            title={paid.payerAddress}
          >
            {shortAddress(paid.payerAddress, 6)}
          </dd>
        </div>
      </dl>

      <a
        href={paid.explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-sky-200 bg-white px-5 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50 focus-visible:ring-2 focus-visible:ring-sky-700 focus-visible:outline-none"
      >
        Ver comprobante en Stellar
        <ArrowUpRight className="size-4" aria-hidden />
      </a>
      <p className="mt-2 text-center text-xs text-slate-500">
        Es el registro público de la transacción. Cualquiera puede comprobarlo
        con este enlace.
      </p>
    </section>
  );
}
