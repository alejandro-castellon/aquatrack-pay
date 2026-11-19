import { formatPeriod } from "@/lib/utils/period";
import {
  formatBs,
  formatChargeMonth,
  formatRate,
  formatUsdc,
} from "@/lib/utils/stellar-pay";
import { PublicWaterCharge } from "@/types";

/** "12.4" -> "12,40 m³" */
function formatCubicMeters(value: number): string {
  return `${value.toFixed(2).replace(".", ",")} m³`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="text-right text-sm font-medium text-slate-900 tabular-nums">
        {children}
      </dd>
    </div>
  );
}

/** Qué se cobra: edificio, departamento, mes, consumo y monto en Bs y en el activo de pago. */
export function ChargeSummary({ charge }: { charge: PublicWaterCharge }) {
  const period = formatPeriod(charge.periodStartDate, charge.periodEndDate);
  const { assetCode } = charge.payment;

  return (
    <section
      aria-labelledby="charge-summary-title"
      className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm sm:p-6"
    >
      <p className="text-sm font-medium text-sky-700">{charge.buildingName}</p>
      <h1
        id="charge-summary-title"
        className="mt-1 text-2xl font-bold tracking-tight text-slate-900"
      >
        Recibo de agua del departamento {charge.apartmentNumber}
      </h1>

      <dl className="mt-4 divide-y divide-sky-100">
        <Row label="Mes">{formatChargeMonth(charge.month)}</Row>
        {period && <Row label="Periodo">{period}</Row>}
        <Row label="Consumo medido">
          {formatCubicMeters(charge.consumption)}
        </Row>
        <Row label="Monto del recibo">{formatBs(charge.amountBs)}</Row>
      </dl>

      <div className="mt-4 rounded-xl bg-sky-50 p-4">
        <p className="text-sm text-slate-600">Total a pagar</p>
        <p className="mt-1 text-3xl font-extrabold tracking-tight text-slate-900 tabular-nums">
          {formatUsdc(charge.amountUsdc)}{" "}
          <span className="text-lg font-semibold text-slate-600">
            {assetCode}
          </span>
        </p>
        <p className="mt-1 text-xs text-slate-600 tabular-nums">
          {formatBs(charge.amountBs)} al tipo de cambio de Bs{" "}
          {formatRate(charge.exchangeRate)} por {assetCode}, fijado al emitir el
          cobro.
        </p>
      </div>
    </section>
  );
}
