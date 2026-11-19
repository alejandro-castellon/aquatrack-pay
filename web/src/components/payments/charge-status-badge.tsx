import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { WaterChargeStatus } from "@/types";

const labels: Record<WaterChargeStatus, string> = {
  paid: "Pagado",
  pending: "Pendiente",
  cancelled: "Anulado",
};

// Verde para lo resuelto y ámbar para lo pendiente, como el resto del panel.
const styles: Record<WaterChargeStatus, string> = {
  paid: "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  pending:
    "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  cancelled: "border-transparent bg-muted text-muted-foreground",
};

export function ChargeStatusBadge({
  status,
  className,
}: {
  status: WaterChargeStatus;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn(styles[status], className)}>
      {labels[status]}
    </Badge>
  );
}
