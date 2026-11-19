import {
  buildSep7PayUri,
  formatUsdc,
  shortAddress,
} from "@/lib/utils/stellar-pay";
import { PublicWaterCharge } from "@/types";
import { ChevronDown } from "lucide-react";
import { CopyField } from "./copy-field";
import { QrCode } from "./qr-code";

/** "13.1000000" -> "13.10": el mismo monto, sin ceros de más, para pegarlo en otra billetera. */
function plainAmount(amount: string): string {
  return amount.replace(/(\.\d{2}\d*?)0+$/, "$1");
}

/**
 * Datos para pagar desde cualquier billetera de Stellar: destino, monto, activo
 * y la referencia que debe ir en el memo. La página se entera sola del pago.
 */
export function OtherWalletPay({ charge }: { charge: PublicWaterCharge }) {
  const { destination, assetCode, assetIssuer, memo } = charge.payment;
  const amount = plainAmount(charge.amountUsdc);
  const payUri = buildSep7PayUri({
    destination,
    amount,
    assetCode,
    assetIssuer,
    memo,
  });

  return (
    <details className="group rounded-2xl border border-sky-100 bg-white shadow-sm">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-5 text-sm font-semibold text-slate-900 focus-visible:ring-2 sm:px-6 focus-visible:ring-sky-700 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        Pagar con otra billetera de Stellar
        <ChevronDown
          className="size-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>

      <div className="space-y-4 px-5 pb-5 sm:px-6 sm:pb-6">
        <p className="text-sm text-slate-600">
          Envía el monto exacto a la caja del edificio y escribe la referencia
          en el memo. Sin la referencia no podemos asociar el pago a tu recibo.
        </p>

        <dl className="space-y-3">
          <CopyField
            label="Destino"
            value={destination}
            display={shortAddress(destination, 8)}
            hint="Es la caja del edificio."
          />
          <CopyField
            label={`Monto en ${assetCode}`}
            value={amount}
            hint={`${formatUsdc(charge.amountUsdc)} ${assetCode}. Emisor del activo: ${shortAddress(assetIssuer, 6)}.`}
          />
          <CopyField
            label="Memo de texto"
            value={memo}
            hint="Obligatorio. Es la referencia de este recibo."
          />
        </dl>

        <div className="hidden flex-col items-center gap-2 rounded-xl bg-sky-50 p-4 sm:flex">
          <QrCode
            value={payUri}
            label="Código QR con los datos de este pago"
          />
          <p className="text-center text-xs text-slate-600">
            Escanéalo con una billetera de Stellar que lea pagos por QR. Trae el
            destino, el monto y el memo.
          </p>
        </div>

        <a
          href={payUri}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-sky-200 bg-white px-5 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50 focus-visible:ring-2 focus-visible:ring-sky-700 focus-visible:outline-none sm:hidden"
        >
          Abrir en mi billetera
        </a>

        <p className="text-xs text-slate-500">
          Cuando el pago llegue a la red, esta página lo muestra sola en unos
          segundos.
        </p>
      </div>
    </details>
  );
}
