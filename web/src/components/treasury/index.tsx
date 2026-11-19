"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useBuildingContext } from "@/lib/contexts/building-context";
import { useBuildingTreasury } from "@/lib/hooks/use-building-treasury";
import {
  formatChargeMonth,
  formatUsdc,
  shortAddress,
} from "@/lib/utils/stellar-pay";
import { cn } from "@/lib/utils";
import { BuildingTreasury, TreasuryTransferStatus } from "@/types";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Copy, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const transferLabels: Record<TreasuryTransferStatus, string> = {
  matched: "Conciliado",
  unmatched: "Sin referencia",
  underpaid: "Monto incompleto",
  duplicate: "Pago duplicado",
};

const transferStyles: Record<TreasuryTransferStatus, string> = {
  matched:
    "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  unmatched: "border-transparent bg-muted text-muted-foreground",
  underpaid:
    "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  duplicate:
    "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
};

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function TreasuryDetail({
  treasury,
  onRefresh,
}: {
  treasury: BuildingTreasury;
  onRefresh: () => void;
}) {
  const { onChain, assetCode, signers, threshold } = treasury;
  // Lo que dice la red manda; la foto guardada al crear la caja es el respaldo.
  const requiredSignatures = onChain?.thresholds.med ?? threshold;
  const signerCount = onChain?.signers.length ?? signers.length;
  const labelOf = (publicKey: string) =>
    signers.find((signer) => signer.publicKey === publicKey)?.label ??
    "Firmante";
  const shownSigners =
    onChain?.signers.map((signer) => signer.publicKey) ??
    signers.map((signer) => signer.publicKey);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(treasury.publicKey);
      toast.success("Cuenta de la caja copiada.");
    } catch {
      toast.error("No se pudo copiar la cuenta.");
    }
  };

  return (
    <div className="space-y-4">
      {onChain === null && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          No pudimos leer la red de Stellar ahora. La caja sigue ahí: vuelve a
          intentarlo en un momento.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Stat
          label="Saldo en caja"
          value={
            onChain ? `${formatUsdc(onChain.balance)} ${assetCode}` : "Sin datos"
          }
          hint="Leído de la red, no de una planilla."
        />
        <Stat
          label="Firmas para mover fondos"
          value={`${requiredSignatures} de ${signerCount}`}
          hint="Una sola firma no alcanza: la red rechaza el retiro."
        />
        <Stat
          label="Llave maestra"
          value={
            onChain
              ? onChain.masterWeight === 0
                ? "Desactivada"
                : "Activa"
              : "Sin datos"
          }
          hint="Sin ella, solo los firmantes mueven la caja. AquaTrack no puede."
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cuenta de la caja</CardTitle>
            <CardDescription>
              Es una cuenta de Stellar del edificio. Aquí entran los pagos del
              agua.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="break-all rounded-lg bg-muted px-3 py-2 font-mono text-sm">
              {treasury.publicKey}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleCopy}>
                <Copy aria-hidden />
                Copiar
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a
                  href={treasury.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink aria-hidden />
                  Ver en Stellar
                </a>
              </Button>
              {treasury.network === "testnet" && (
                <Badge variant="outline">Red de prueba</Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Firmantes</CardTitle>
            <CardDescription>
              Las personas de la directiva que pueden firmar un retiro.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {shownSigners.map((publicKey) => (
                <li
                  key={publicKey}
                  className="flex items-center justify-between gap-3 py-2.5 text-sm"
                >
                  <span className="font-medium">{labelOf(publicKey)}</span>
                  <span
                    className="font-mono text-muted-foreground"
                    title={publicKey}
                  >
                    {shortAddress(publicKey, 6)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle>Pagos recibidos</CardTitle>
            <CardDescription>
              Los últimos pagos que llegaron a la caja, leídos de la red.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw aria-hidden />
            Actualizar
          </Button>
        </CardHeader>
        <CardContent>
          {treasury.transfers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Todavía no llegó ningún pago a esta caja.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Departamento</TableHead>
                  <TableHead>Mes</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Comprobante</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {treasury.transfers.map((transfer) => (
                  <TableRow key={transfer.txHash}>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {format(new Date(transfer.createdAt), "d MMM yyyy, HH:mm", {
                        locale: es,
                      })}
                    </TableCell>
                    <TableCell className="font-medium">
                      {transfer.apartmentNumber ?? "—"}
                    </TableCell>
                    <TableCell>
                      {transfer.month ? formatChargeMonth(transfer.month) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatUsdc(transfer.amountUsdc)} {assetCode}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(transferStyles[transfer.status])}
                      >
                        {transferLabels[transfer.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <a
                          href={transfer.explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Ver en Stellar el pago de ${formatUsdc(transfer.amountUsdc)} ${assetCode}`}
                        >
                          <ExternalLink aria-hidden />
                          Ver
                        </a>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Caja del edificio: saldo, quién firma y qué pagos llegaron, todo leído de Stellar. */
export default function Treasury() {
  const { currentBuilding } = useBuildingContext();
  const buildingId = currentBuilding?.id ?? null;
  const { treasury, loading, error, refresh } = useBuildingTreasury(buildingId);

  if (!buildingId) {
    return <p className="text-muted-foreground">Selecciona un edificio</p>;
  }

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-36 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (error && !treasury) {
    return (
      <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
        <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        <Button variant="outline" size="sm" onClick={refresh}>
          Reintentar
        </Button>
      </div>
    );
  }

  if (!treasury) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Este edificio todavía no tiene caja</CardTitle>
          <CardDescription>
            La caja es una cuenta del edificio en Stellar donde entran los pagos
            del agua. Para mover fondos hacen falta las firmas de la directiva,
            así que ninguna persona sola, ni AquaTrack, puede retirarlos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Se crea una sola vez, con las personas que la directiva elija como
            firmantes. Escríbenos y la preparamos contigo.
          </p>
        </CardContent>
      </Card>
    );
  }

  return <TreasuryDetail treasury={treasury} onRefresh={refresh} />;
}
