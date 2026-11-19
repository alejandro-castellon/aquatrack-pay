"use client";

import { Logo } from "@/components/logo";
import Link from "next/link";
import { useEffect } from "react";

/**
 * Adonde vuelve la pestaña que Pollar abre para entrar con Google. La sesión
 * se completa en la pestaña del recibo, que consulta sola el resultado: esta
 * solo tiene que cerrarse. Si el navegador no la deja cerrarse, queda el aviso.
 */
export default function SignInReturn() {
  useEffect(() => {
    window.close();
  }, []);

  return (
    <div className="min-h-dvh bg-gradient-to-b from-sky-50 to-white">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pt-6 pb-10">
        <header className="mb-5">
          <Link
            href="/"
            aria-label="AquaTrack, ir al inicio"
            className="inline-block rounded-lg focus-visible:ring-2 focus-visible:ring-sky-700 focus-visible:outline-none"
          >
            <Logo w={32} h={32} />
          </Link>
        </header>

        <main>
          <section className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm sm:p-6">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Vuelve a la pestaña del recibo
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Tu inicio de sesión continúa allí. Esta pestaña ya se puede
              cerrar.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}
