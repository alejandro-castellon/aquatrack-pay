# Cómo se integra en la plataforma

Este repositorio contiene los archivos del módulo, copiados sin cambios de las ramas de la hackathon de los dos repositorios privados de AquaTrack. Se genera con un script: no se edita a mano.

- `api/`: 85 archivos del módulo.
- `web/`: 25 archivos del módulo.

Además de esos archivos nuevos, el módulo añadió líneas a archivos de código y de configuración que ya existían en la plataforma. Esos archivos no se publican; esta tabla dice cuáles son y qué se les añadió.

## API

| Archivo de la plataforma | Líneas añadidas | Líneas quitadas | Qué se añadió |
|---|---|---|---|
| `.gitignore` | 3 | 0 | Las llaves de testnet de la demo no se versionan. |
| `package.json` | 9 | 1 | Dependencia `@stellar/stellar-sdk` y los comandos `demo:*`. |
| `pnpm-lock.yaml` | 162 | 4 | Lo que arrastra esa dependencia. |
| `prisma/schema.prisma` | 82 | 1 | Los modelos `BuildingTreasury` y `WaterCharge`, el enum `WaterChargeStatus` y sus relaciones. Los modelos están en `api/prisma/water-charge.models.prisma`. |
| `prisma/seed/index.ts` | 2 | 0 | El seed limpia también las dos tablas nuevas. |
| `src/app.module.ts` | 2 | 0 | Registro del módulo de cobros. |
| `src/modules/water-reading/infrastructure/mqtt/water-reading.mqtt.service.ts` | 5 | 0 | Corrección aparte, encontrada al preparar la demo: sin broker configurado, el cliente de lecturas ya no reintenta una conexión local. |
| `src/shared/swagger/swagger.config.ts` | 8 | 0 | Etiquetas de la documentación de la API para cobros y caja. |
| `test/unit/water-reading/infrastructure/mqtt/water-reading.mqtt.service.spec.ts` | 16 | 0 | Prueba de esa corrección. |
| `test/utils/db.ts` | 5 | 0 | Las pruebas con base de datos limpian las dos tablas nuevas. |
| `test/utils/test-app.ts` | 21 | 1 | La app de pruebas usa un acceso a Stellar simulado (`api/test/utils/fake-stellar-gateway.ts`). |
| `tsconfig.build.json` | 1 | 1 | Los scripts de la demo quedan fuera del build de producción. |
| `tsconfig.json` | 7 | 1 | Los scripts de la demo entran en la revisión de tipos. |

## Web

| Archivo de la plataforma | Líneas añadidas | Líneas quitadas | Qué se añadió |
|---|---|---|---|
| `Dockerfile` | 8 | 0 | Variables de build de la clave publicable de Pollar y del modo demo. |
| `package.json` | 5 | 0 | Dependencias `@pollar/react`, `@pollar/core` y `qrcode`, y el comando `test:payments`. |
| `pnpm-lock.yaml` | 552 | 0 | Lo que arrastran esas dependencias. |
| `src/components/apartments/apartment/consumption-receipts.tsx` | 33 | 11 | Estado de pago y botón "Pagar" en cada recibo del departamento. |
| `src/components/billing/billing-detail-client.tsx` | 2 | 0 | El detalle del prorrateo muestra el panel de cobros. |
| `src/components/sidebar/navlinks.tsx` | 6 | 0 | Enlace "Caja" en el menú del administrador. |
| `src/lib/api/client.ts` | 33 | 0 | Mensajes de error de la API de cobros, en español. |
| `src/lib/utils/export-individual-pdf.tsx` | 104 | 6 | QR en el recibo PDF, generado en local: enlace de pago mientras está pendiente y comprobante en la red una vez pagado. |
| `src/types/index.ts` | 136 | 0 | Tipos de cobros y caja. Están en `web/src/types/index.ts`. |
| `src/types/payloads.ts` | 13 | 0 | Cuerpos de las peticiones nuevas. Están en `web/src/types/payloads.ts`. |
