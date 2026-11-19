import DemoGuide from "@/components/payments/demo-guide";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Demo de cobros",
  robots: { index: false, follow: false },
};

// Solo existe en la instancia de demostración (NEXT_PUBLIC_DEMO_MODE=true).
// En producción responde 404: el sitio público no anuncia cobros.
export default function DemoPage() {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "true") notFound();

  return (
    <DemoGuide
      adminEmail={process.env.NEXT_PUBLIC_DEMO_ADMIN_EMAIL ?? null}
      adminPassword={process.env.NEXT_PUBLIC_DEMO_ADMIN_PASSWORD ?? null}
    />
  );
}
