import QRCode from "qrcode";
import { useMemo } from "react";

interface QrCodeProps {
  value: string;
  /** Texto para lectores de pantalla: qué abre el código. */
  label: string;
  size?: number;
}

/**
 * Código QR dibujado como SVG en el propio navegador. No pide la imagen a un
 * servicio externo, así que el enlace de pago no sale de la página.
 */
export function QrCode({ value, label, size = 176 }: QrCodeProps) {
  const { path, modules } = useMemo(() => {
    const { modules: matrix } = QRCode.create(value, {
      errorCorrectionLevel: "M",
    });
    let d = "";
    for (let row = 0; row < matrix.size; row++) {
      for (let column = 0; column < matrix.size; column++) {
        if (matrix.get(row, column)) d += `M${column} ${row}h1v1h-1z`;
      }
    }
    return { path: d, modules: matrix.size };
  }, [value]);

  // Margen de 2 módulos: el mínimo que los lectores necesitan alrededor.
  const margin = 2;
  const box = modules + margin * 2;

  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`${-margin} ${-margin} ${box} ${box}`}
      shapeRendering="crispEdges"
      className="rounded-lg bg-white"
    >
      <rect
        x={-margin}
        y={-margin}
        width={box}
        height={box}
        fill="#ffffff"
      />
      <path d={path} fill="#0c4a6e" />
    </svg>
  );
}
