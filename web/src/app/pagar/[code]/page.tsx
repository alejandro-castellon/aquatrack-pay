import PayCharge from "@/components/payments";
import type { Metadata } from "next";

// Página pública (se abre con el enlace o el QR del recibo), pero fuera de los
// buscadores: cada enlace es de un recibo concreto.
export const metadata: Metadata = {
  title: "Pagar recibo de agua",
  robots: { index: false, follow: false },
};

type PageProps = {
  params: Promise<{ code: string }>;
};

export default async function PayChargePage({ params }: PageProps) {
  const { code } = await params;

  return <PayCharge code={code} />;
}
