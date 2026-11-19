"use client";

import { ChargeStatusBadge } from "@/components/payments/charge-status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { publishWaterCharges } from "@/lib/api/water-charges";
import { useBuildingTreasury } from "@/lib/hooks/use-building-treasury";
import { useBuildingWaterCharges } from "@/lib/hooks/use-building-water-charges";
import { formatBs, formatUsdc } from "@/lib/utils/stellar-pay";
import { WaterCharge } from "@/types";
import { Copy, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface WaterChargesPanelProps {
  buildingId: string;
  /** "YYYY-MM" del prorrateo guardado. */
  month: string;
}

/** Cada cuánto se refresca la lista mientras queden cobros pendientes. */
const REFRESH_MS = 10_000;

function payLink(charge: WaterCharge): string {
  return `${window.location.origin}/pagar/${charge.publicCode}`;
}

/**
 * Cobros del mes de un prorrateo guardado: los publica y muestra quién pagó.
 * El estado lo marca la API al leer el pago en la red; nadie lo edita a mano.
 */
export default function WaterChargesPanel({
  buildingId,
  month,
}: WaterChargesPanelProps) {
  const { charges, loading, error, refresh, replace } = useBuildingWaterCharges(
    buildingId,
    month,
  );
  const { treasury, loading: treasuryLoading } =
    useBuildingTreasury(buildingId);
  const [rate, setRate] = useState("");
  const [rateError, setRateError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  const hasPending = charges.some((charge) => charge.status === "pending");

  useEffect(() => {
    if (!hasPending) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [hasPending, refresh]);

  const handlePublish = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const typed = rate.trim().replace(",", ".");
    const bsPerUsdc = typed === "" ? undefined : Number(typed);
    if (
      bsPerUsdc !== undefined &&
      (!Number.isFinite(bsPerUsdc) || bsPerUsdc <= 0)
    ) {
      setRateError("Escribe un tipo de cambio mayor que cero, por ejemplo 11,84.");
      return;
    }
    setRateError(null);

    setPublishing(true);
    try {
      const result = await publishWaterCharges({ buildingId, month, bsPerUsdc });
      replace(result.charges);
      toast.success(
        result.created === 1
          ? "Se publicó 1 cobro."
          : `Se publicaron ${result.created} cobros.`,
      );
    } catch (publishError) {
      toast.error(
        publishError instanceof Error
          ? publishError.message
          : "No se pudieron publicar los cobros.",
      );
    } finally {
      setPublishing(false);
    }
  };

  const handleCopy = async (charge: WaterCharge) => {
    try {
      await navigator.clipboard.writeText(payLink(charge));
      toast.success(
        `Enlace del departamento ${charge.apartmentNumber} copiado.`,
      );
    } catch {
      toast.error("No se pudo copiar el enlace.");
    }
  };

  const paid = charges.filter((charge) => charge.status === "paid");
  const totalBs = charges.reduce((sum, charge) => sum + charge.amountBs, 0);
  const paidBs = paid.reduce((sum, charge) => sum + charge.amountBs, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cobros de este mes</CardTitle>
        <CardDescription>
          Cada departamento paga su recibo con un enlace y el pago se marca solo
          cuando llega a la caja del edificio. Nadie tiene que revisar
          comprobantes.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {loading || treasuryLoading ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : charges.length === 0 ? (
          <>
            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                {error}
              </p>
            )}
            {treasury === null ? (
              <div className="space-y-3 rounded-lg border bg-muted/40 p-4">
                <p className="text-sm text-muted-foreground">
                  Para publicar cobros, el edificio necesita su caja: la cuenta
                  donde entran los pagos.
                </p>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/dashboard/caja">Ir a la caja</Link>
                </Button>
              </div>
            ) : (
              <form
                onSubmit={handlePublish}
                className="flex flex-col gap-3 sm:flex-row sm:items-end"
                noValidate
              >
                <div className="space-y-1.5">
                  <Label htmlFor="charges-rate">
                    Tipo de cambio (Bs por {treasury.assetCode})
                  </Label>
                  <Input
                    id="charges-rate"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="Tipo de cambio de referencia"
                    value={rate}
                    onChange={(event) => setRate(event.target.value)}
                    aria-invalid={rateError !== null}
                    aria-describedby="charges-rate-help"
                    className="sm:w-64"
                  />
                </div>
                <Button type="submit" disabled={publishing}>
                  {publishing ? "Publicando" : "Publicar cobros"}
                </Button>
              </form>
            )}
            {treasury !== null && (
              <p
                id="charges-rate-help"
                className={
                  rateError
                    ? "text-sm text-red-700 dark:text-red-300"
                    : "text-sm text-muted-foreground"
                }
              >
                {rateError ??
                  "Los recibos siguen en bolivianos. El tipo de cambio queda fijo para estos cobros; si lo dejas vacío se usa el de referencia."}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground tabular-nums">
              <span className="font-medium text-foreground">
                {paid.length} de {charges.length} pagados.
              </span>{" "}
              {formatBs(paidBs)} cobrados de {formatBs(totalBs)}.
            </p>

            {error && (
              <p className="text-sm text-amber-700 dark:text-amber-300">
                No se pudo actualizar la lista: {error}
              </p>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Departamento</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="text-right">Equivale a</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {charges.map((charge) => (
                  <TableRow key={charge.id}>
                    <TableCell className="font-medium">
                      {charge.apartmentNumber}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatBs(charge.amountBs)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatUsdc(charge.amountUsdc)} {charge.assetCode}
                    </TableCell>
                    <TableCell>
                      <ChargeStatusBadge status={charge.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      {charge.status === "paid" && charge.explorerUrl ? (
                        <Button variant="ghost" size="sm" asChild>
                          <a
                            href={charge.explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink aria-hidden />
                            Comprobante
                          </a>
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCopy(charge)}
                          disabled={charge.status !== "pending"}
                        >
                          <Copy aria-hidden />
                          Copiar enlace
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
