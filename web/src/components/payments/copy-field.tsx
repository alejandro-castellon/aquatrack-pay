"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface CopyFieldProps {
  label: string;
  /** Lo que se copia al portapapeles. */
  value: string;
  /** Lo que se muestra; por defecto, el mismo valor. */
  display?: string;
  hint?: string;
}

/** Un dato para copiar tal cual en otra billetera: destino, monto o memo. */
export function CopyField({ label, value, display, hint }: CopyFieldProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("No pudimos copiar. Selecciona el texto y cópialo a mano.");
    }
  };

  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 flex items-center gap-2">
        <span
          className="min-w-0 flex-1 break-all rounded-lg bg-sky-50 px-3 py-2 font-mono text-sm text-slate-900 select-all"
          title={value}
        >
          {display ?? value}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={`Copiar ${label.toLowerCase()}`}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-sky-100 bg-white text-sky-700 transition-colors hover:bg-sky-50 focus-visible:ring-2 focus-visible:ring-sky-700 focus-visible:outline-none"
        >
          {copied ? (
            <Check className="size-4" aria-hidden />
          ) : (
            <Copy className="size-4" aria-hidden />
          )}
        </button>
      </dd>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
