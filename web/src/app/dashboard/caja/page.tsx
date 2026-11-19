import Treasury from "@/components/treasury";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Caja",
};

export default function TreasuryPage() {
  return (
    <main className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Caja del edificio</h1>
        <p className="text-sm text-muted-foreground">
          Dónde está la plata del agua y quién puede moverla.
        </p>
      </div>
      <Treasury />
    </main>
  );
}
