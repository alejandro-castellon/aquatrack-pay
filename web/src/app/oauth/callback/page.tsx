import SignInReturn from "@/components/payments/sign-in-return";
import type { Metadata } from "next";

// Retorno del acceso con Google de la página de pago (ver pollar-pay.tsx). La
// ruta coincide con la registrada en Pollar como "Allowed redirect URI".
export const metadata: Metadata = {
  title: "Inicio de sesión",
  robots: { index: false, follow: false },
};

export default function OAuthCallbackPage() {
  return <SignInReturn />;
}
