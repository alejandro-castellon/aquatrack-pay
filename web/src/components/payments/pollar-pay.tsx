"use client";

// Único archivo que carga el SDK de Pollar (casi 1 MB con su núcleo). Se
// importa con next/dynamic desde la página de pago, así que no entra en el
// sitio público ni en el panel.
import "@pollar/react/styles.css";

import { PollarProvider, usePollar } from "@pollar/react";
import { confirmWaterCharge, requestDemoFunds } from "@/lib/api/water-charges";
import {
  assetTypeOf,
  coversAmount,
  formatUsdc,
  missingAmount,
  shortAddress,
} from "@/lib/utils/stellar-pay";
import { PublicWaterCharge } from "@/types";
import { Loader2 } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";
import { toast } from "sonner";

interface PollarPayProps {
  code: string;
  charge: PublicWaterCharge;
  /** La API confirmó el pago: muestra el cobro actualizado. */
  onCharge: (charge: PublicWaterCharge) => void;
}

type Phase =
  | { step: "idle" }
  | { step: "enabling" }
  | { step: "funding" }
  | { step: "paying" }
  | { step: "confirming" }
  | { step: "submitted" }
  | { step: "error"; message: string };

const CONFIRM_ATTEMPTS = 12;
const CONFIRM_WAIT_MS = 2000;

/**
 * El acceso con Google se abre en otra pestaña, que al terminar vuelve a esta
 * ruta (src/app/oauth/callback): una página que se cierra sola. Sin esto
 * volvería a la portada del sitio. Tiene que estar en Pollar, en "Allowed
 * redirect URIs", con el origen de cada entorno.
 */
const SIGN_IN_RETURN_PATH = "/oauth/callback";

/**
 * Pollar habilita por su cuenta los activos de la app unos segundos después de
 * crear la billetera. Antes de ofrecer "Habilitar" se vuelve a leer el saldo
 * estas veces: en la primera prueba real (19 de noviembre de 2026) el activo
 * apareció 5 s después de la billetera, y el botón era un paso de más.
 */
const TRUSTLINE_RECHECKS = 5;
const TRUSTLINE_RECHECK_MS = 2500;

type LoadedBalances = Extract<
  ReturnType<typeof usePollar>["walletBalance"],
  { step: "loaded" }
>["data"]["balances"];

const primaryButton =
  "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-sky-700 px-6 text-base font-semibold text-white shadow-lg shadow-sky-700/25 transition-colors hover:bg-sky-800 focus-visible:ring-2 focus-visible:ring-sky-700 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton =
  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-sky-200 bg-white px-5 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50 focus-visible:ring-2 focus-visible:ring-sky-700 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60";

const wait = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** El usuario cerró o rechazó la confirmación de Pollar: no es un fallo. */
function wasCancelled(code?: string, message?: string): boolean {
  return /cancel|reject|declin|denied|dismiss/i.test(`${code} ${message}`);
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function Busy({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm text-slate-600" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {children}
    </p>
  );
}

function PollarPayFlow({ code, charge, onCharge }: PollarPayProps) {
  const {
    isAuthenticated,
    verified,
    wallet,
    getClient,
    openLoginModal,
    logout,
    walletBalance,
    refreshWalletBalance,
    setTrustline,
    runTx,
    configStatus,
    retryConfig,
  } = usePollar();
  const [phase, setPhase] = useState<Phase>({ step: "idle" });

  const { destination, assetCode, assetIssuer, memo } = charge.payment;
  const address = wallet?.address ?? null;
  const provisioning = wallet?.provisioning;
  const walletReady =
    isAuthenticated &&
    address !== null &&
    (provisioning === undefined || provisioning === "READY");
  // Pollar recuerda la sesión en el navegador: quien vuelve ya no pasa por el
  // acceso, así que la página dice con qué cuenta está y cómo cambiarla.
  const accountEmail = isAuthenticated
    ? (getClient().getUserProfile()?.mail ?? "")
    : "";

  // Lee el saldo al entrar y cuando la billetera queda lista.
  const loadBalance = useEffectEvent(() => {
    void refreshWalletBalance();
  });
  useEffect(() => {
    if (walletReady) loadBalance();
  }, [walletReady, address]);

  // Cada lectura del saldo pasa por "loading": se conserva la última respuesta
  // de esta billetera para que la página no parpadee al volver a leer.
  const [known, setKnown] = useState<{
    address: string;
    balances: LoadedBalances;
  } | null>(null);
  if (
    address !== null &&
    walletBalance.step === "loaded" &&
    (known?.address !== address ||
      known.balances !== walletBalance.data.balances)
  ) {
    setKnown({ address, balances: walletBalance.data.balances });
  }
  const balances =
    known !== null && known.address === address ? known.balances : null;
  const assetBalance =
    balances?.find(
      (record) =>
        record.code === assetCode &&
        record.issuer === assetIssuer &&
        (record.chain === undefined || record.chain === "STELLAR"),
    ) ?? null;
  const available = assetBalance?.available ?? assetBalance?.balance ?? null;
  const hasTrustline = assetBalance !== null && !assetBalance.trustlineRemoved;
  const enough = hasTrustline && coversAmount(charge.amountUsdc, available);
  const missing = missingAmount(charge.amountUsdc, available);
  const busy =
    phase.step === "enabling" ||
    phase.step === "funding" ||
    phase.step === "paying" ||
    phase.step === "confirming";

  // Mientras el activo no aparece, se vuelve a leer el saldo unas veces antes
  // de pedirle al vecino que lo habilite a mano.
  const [recheck, setRecheck] = useState<{
    address: string | null;
    count: number;
  }>({ address: null, count: 0 });
  const rechecks = recheck.address === address ? recheck.count : 0;
  const awaitingTrustline =
    walletReady &&
    balances !== null &&
    !hasTrustline &&
    phase.step === "idle" &&
    rechecks < TRUSTLINE_RECHECKS;
  const recheckBalance = useEffectEvent(() => {
    setRecheck({ address, count: rechecks + 1 });
    void refreshWalletBalance();
  });
  useEffect(() => {
    if (!awaitingTrustline) return;
    const timer = window.setTimeout(recheckBalance, TRUSTLINE_RECHECK_MS);
    return () => window.clearTimeout(timer);
  }, [awaitingTrustline, rechecks]);

  const refreshSoon = async () => {
    // Un pago tarda unos 5 s en cerrarse en la red; se vuelve a leer dos veces.
    await wait(3000);
    await refreshWalletBalance();
    await wait(4000);
    await refreshWalletBalance();
  };

  const handleEnableAsset = async () => {
    setPhase({ step: "enabling" });
    try {
      const outcome = await setTrustline({
        code: assetCode,
        issuer: assetIssuer,
      });
      if (outcome.status === "error") {
        setPhase({
          step: "error",
          message: `No pudimos habilitar ${assetCode} en tu billetera. Inténtalo de nuevo.`,
        });
        return;
      }
      await refreshWalletBalance();
      setPhase({ step: "idle" });
    } catch (error) {
      setPhase({
        step: "error",
        message: describeError(
          error,
          `No pudimos habilitar ${assetCode} en tu billetera. Inténtalo de nuevo.`,
        ),
      });
    }
  };

  const handleDemoFunds = async () => {
    if (!address) return;
    setPhase({ step: "funding" });
    try {
      const result = await requestDemoFunds(code, address);
      if (result.txHash) {
        toast.success(
          `Te enviamos ${formatUsdc(result.amount)} ${assetCode} de prueba.`,
        );
      }
      await refreshSoon();
      setPhase({ step: "idle" });
    } catch (error) {
      setPhase({
        step: "error",
        message: describeError(
          error,
          "No pudimos enviarte los fondos de prueba. Inténtalo de nuevo.",
        ),
      });
    }
  };

  /** Pide a la API que lea la transacción hasta que la red la tenga. */
  const confirm = async (txHash: string) => {
    setPhase({ step: "confirming" });
    for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt++) {
      let result;
      try {
        result = await confirmWaterCharge(code, txHash);
      } catch (error) {
        if ((error as { status?: number }).status === 409) {
          setPhase({
            step: "error",
            message: describeError(
              error,
              "Este cobro ya no se puede pagar. Consulta con la administración de tu edificio.",
            ),
          });
          return;
        }
        // La red o la API no respondieron: el pago ya salió, se vuelve a preguntar.
        await wait(CONFIRM_WAIT_MS);
        continue;
      }
      switch (result.outcome) {
        case "paid":
        case "already_paid":
          onCharge(result.charge);
          return;
        case "not_found_yet":
          await wait(CONFIRM_WAIT_MS);
          continue;
        case "underpaid":
          setPhase({
            step: "error",
            message:
              "El pago llegó, pero no cubre el monto del recibo. Consulta con la administración de tu edificio.",
          });
          return;
        default:
          setPhase({
            step: "error",
            message:
              "La transacción no corresponde a este recibo. No se marcó como pagado.",
          });
          return;
      }
    }
    // La red aún no la muestra: la página sigue consultando el estado sola.
    setPhase({ step: "submitted" });
  };

  const handlePay = async () => {
    setPhase({ step: "paying" });
    try {
      const outcome = await runTx(
        "payment",
        {
          destination,
          amount: charge.amountUsdc,
          asset: {
            type: assetTypeOf(assetCode),
            code: assetCode,
            issuer: assetIssuer,
          },
        },
        // La referencia del recibo viaja como memo: con ella se concilia sola.
        { memo: { type: "text", value: memo } },
      );

      if (outcome.status === "success" || outcome.status === "pending") {
        await confirm(outcome.hash);
        return;
      }
      if (outcome.status === "cosign_pending") {
        setPhase({
          step: "error",
          message:
            "Tu billetera pide aprobar el pago en otro dispositivo. Apruébalo y esta página se actualiza sola.",
        });
        return;
      }
      setPhase(
        wasCancelled(outcome.code, outcome.message)
          ? {
              step: "error",
              message: "Cancelaste el pago. No se movió ningún fondo.",
            }
          : {
              step: "error",
              message:
                "No pudimos completar el pago. No se movió ningún fondo. Inténtalo de nuevo.",
            },
      );
    } catch (error) {
      setPhase({
        step: "error",
        message: describeError(
          error,
          "No pudimos conectar con la red. Revisa tu conexión e inténtalo de nuevo.",
        ),
      });
    }
  };

  if (configStatus === "error") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          No pudimos cargar el acceso con correo. Puedes reintentar o pagar con
          otra billetera.
        </p>
        <button type="button" className={secondaryButton} onClick={retryConfig}>
          Reintentar
        </button>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          Entra con tu correo o tu cuenta de Google para pagar. No necesitas
          instalar nada.
        </p>
        <button
          type="button"
          className={primaryButton}
          onClick={openLoginModal}
          disabled={configStatus !== "ready"}
        >
          Entrar para pagar
        </button>
      </div>
    );
  }

  if (!walletReady) {
    return provisioning === "FAILED" ? (
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          No pudimos preparar tu billetera. Sal y vuelve a entrar para
          reintentar.
        </p>
        <button type="button" className={secondaryButton} onClick={logout}>
          Salir
        </button>
      </div>
    ) : (
      <Busy>Estamos preparando tu billetera. Tarda unos segundos.</Busy>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 text-sm text-slate-600">
          {accountEmail ? (
            <>
              Entraste como{" "}
              <span className="font-medium break-all text-slate-900">
                {accountEmail}
              </span>
            </>
          ) : (
            "Ya habías entrado desde este navegador."
          )}
        </p>
        <button
          type="button"
          onClick={logout}
          disabled={busy}
          className="min-h-11 shrink-0 rounded-full px-2 text-sm font-semibold text-sky-700 underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-sky-700 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cambiar de cuenta
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl bg-sky-50 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs text-slate-600">Tu billetera</p>
          <p
            className="truncate font-mono text-sm font-medium text-slate-900"
            title={address ?? undefined}
          >
            {address ? shortAddress(address, 6) : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-600">Saldo</p>
          <p className="text-sm font-semibold text-slate-900 tabular-nums">
            {balances !== null
              ? `${formatUsdc(available ?? "0")} ${assetCode}`
              : walletBalance.step === "error"
                ? "Sin datos"
                : "Consultando"}
          </p>
        </div>
      </div>

      {walletBalance.step === "error" && (
        <button
          type="button"
          className={secondaryButton}
          onClick={() => void refreshWalletBalance()}
        >
          Volver a leer el saldo
        </button>
      )}

      {awaitingTrustline && (
        <Busy>
          Preparando tu billetera para recibir {assetCode}. Tarda unos segundos.
        </Busy>
      )}

      {balances !== null && !hasTrustline && !awaitingTrustline && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Tu billetera todavía no tiene habilitado {assetCode}. Habilítalo
            para poder recibirlo y pagar.
          </p>
          <button
            type="button"
            className={secondaryButton}
            onClick={handleEnableAsset}
            disabled={busy}
          >
            Habilitar {assetCode}
          </button>
        </div>
      )}

      {balances !== null && hasTrustline && !enough && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600 tabular-nums">
            Te faltan {formatUsdc(missing)} {assetCode} para pagar este recibo.
          </p>
          {charge.demo.faucetEnabled && (
            <button
              type="button"
              className={secondaryButton}
              onClick={handleDemoFunds}
              disabled={busy}
            >
              Recibir {assetCode} de prueba
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        className={primaryButton}
        onClick={handlePay}
        disabled={busy || !verified || !enough || phase.step === "submitted"}
      >
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
        <span className="tabular-nums">
          Pagar {formatUsdc(charge.amountUsdc)} {assetCode}
        </span>
      </button>

      <div aria-live="polite" className="min-h-5">
        {phase.step === "enabling" && (
          <Busy>Habilitando {assetCode} en tu billetera.</Busy>
        )}
        {phase.step === "funding" && (
          <Busy>Enviando fondos de prueba a tu billetera.</Busy>
        )}
        {phase.step === "paying" && <Busy>Enviando tu pago.</Busy>}
        {phase.step === "confirming" && (
          <Busy>Esperando la confirmación de la red.</Busy>
        )}
        {phase.step === "submitted" && (
          <p className="text-sm text-slate-600">
            Tu pago está en camino. Esta página se actualiza sola cuando se
            confirme.
          </p>
        )}
        {phase.step === "error" && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {phase.message}
          </p>
        )}
      </div>
    </div>
  );
}

/** Pago con una billetera Pollar: se entra con correo o Google, sin instalar nada. */
export default function PollarPay(props: PollarPayProps) {
  // El proveedor fija el cliente en su primer render: la configuración no cambia después.
  const [client] = useState(() => ({
    apiKey: process.env.NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY ?? "",
    stellarNetwork:
      props.charge.payment.network === "public"
        ? ("mainnet" as const)
        : ("testnet" as const),
    // Este archivo solo se carga en el navegador (next/dynamic con ssr: false).
    oauthRedirectUri: `${window.location.origin}${SIGN_IN_RETURN_PATH}`,
  }));

  return (
    <PollarProvider client={client}>
      <PollarPayFlow {...props} />
    </PollarProvider>
  );
}
