# Evidencia fechada

Lo que se puede comprobar sin creerle a la bitácora. Cada transacción de la red de prueba de Stellar lleva su fecha en el ledger, y cada enlace abre el explorador. Las horas están en UTC; Bolivia va cuatro horas por detrás.

## Qué cuenta es cuál

En esta entrega aparecen cuatro cuentas de testnet:

| Cuenta | Qué es | Creada (UTC) |
|---|---|---|
| [GAKQZF…5SST](https://stellar.expert/explorer/testnet/account/GAKQZFNHCK3DGMXN4VOPBGGPYTN67VJF47V5T6FPU3WOCWIUG3B75SST) | Cuenta de operaciones de la demo: crea las cajas y hace de grifo de USDC de prueba. No es firmante de ninguna caja | 19 nov, 01:24 |
| [GCV2O6…63MD](https://stellar.expert/explorer/testnet/account/GCV2O6LDJUNPSRBWMUHIPJOSRETVTVEYSAZLU5YKJU24EXFZXZAA63MD) | Caja de ejemplo del README. La creó `pnpm demo:smoke` con un activo de prueba propio, antes de tener USDC de prueba de Circle | 19 nov, 01:26 |
| [GBT35G…2SJN](https://stellar.expert/explorer/testnet/account/GBT35G4OKQH5BQ7BOYNIMRDDCPJJAANFK5LAGTJLJKCFW5CW6HSH2SJN) | Caja del edificio de ejemplo en la demo local. Recibió los cinco pagos del 19 de noviembre, cuatro de ellos con billetera Pollar | 19 nov, 18:32 |
| [GDKANI…BTWF](https://stellar.expert/explorer/testnet/account/GDKANI42SKX3E3ESDVV4OXZRMHHQE7REEKVBLRO2EDKVUNTOOPBVBTWF) | Caja del edificio de ejemplo en la demo desplegada, [demo.aquatrack.net/demo](https://demo.aquatrack.net/demo) | 22 nov, 15:09 |

Las tres cajas tienen tres firmantes de prueba, umbral 2 y la llave maestra en peso 0.

## Transacciones, por día

### 18 de noviembre en Bolivia (19 de noviembre en UTC)

| Hora UTC | Qué es | Transacción |
|---|---|---|
| 01:27:00 | Pago con el memo de un recibo | [cce693a4](https://stellar.expert/explorer/testnet/tx/cce693a4c66c1579b2523d91b99fdd2fdd649647149814cfc1b2a560a5013f93) |
| 01:27:30 | Pago con la comisión patrocinada | [7250bf7b](https://stellar.expert/explorer/testnet/tx/7250bf7b4d589389a1dfd2dcfa3d8f85a1824384adb86fbcc13156c2fd96697b) |
| 01:27:35 | Retiro de la caja con dos firmas | [d789f374](https://stellar.expert/explorer/testnet/tx/d789f3747428b2eb7507f7f57b71d4b281bb03fca7ad7517ca143d7370e46a49) |

### 19 de noviembre, en la demo local

| Hora UTC | Qué es | Transacción |
|---|---|---|
| 19:35:15 | Pago de 10,14 USDC desde otra billetera, siguiendo la guía de la demo | [2111f27b](https://stellar.expert/explorer/testnet/tx/2111f27be638f9e85a73e17bfead1e3d4d0cea5a00a1533bc91ca11d6052dac6) |
| 19:36:10 | Retiro con dos firmas | [491ac093](https://stellar.expert/explorer/testnet/tx/491ac0933ef07ce3e648904d3a0b14b64dc94ef1ffbc5db6275478f770f1bb9a) |
| 21:36:50 | Primer pago con billetera Pollar, entrando con correo: 4,67 USDC | [bdaacbf5](https://stellar.expert/explorer/testnet/tx/bdaacbf5c89f189e20ed1b03512e4a4483aa088dca22b29a51b370c4b5aade1b) |
| 22:03:40 | Segundo pago con Pollar: 7,75 USDC | [80da181e](https://stellar.expert/explorer/testnet/tx/80da181e47111953e375bc4114ec480b6408d4da46e2a2354a4a64ad59b7198a) |
| 22:05:45 | Retiro con dos firmas | [a9771c93](https://stellar.expert/explorer/testnet/tx/a9771c936c321d4f4d822e1daca936e52930032f4c5a8887a78df0f0a3fcf273) |
| 22:08:55 | Tercer pago con Pollar: 10,59 USDC | [c565c85a](https://stellar.expert/explorer/testnet/tx/c565c85aaf3828c13625e89574e6df7d9fe1425e127d8d55dc21105977453d95) |
| 22:15:40 | Pago con Pollar entrando con Google, desde una billetera nueva: 13,10 USDC | [639c4924](https://stellar.expert/explorer/testnet/tx/639c492455ad048af097f656f308c731ce1eec8fdf1a60ff5b32f1acbe0b42de) |

### 22 de noviembre, en la demo desplegada

| Hora UTC | Qué es | Transacción |
|---|---|---|
| 15:11:26 | Pago de 4,67 USDC desde otra billetera, sin avisarle a la API. El servidor lo concilió 10 segundos después | [aeab86d8](https://stellar.expert/explorer/testnet/tx/aeab86d80d84fd97f440330102d1a9c0b23581edf1aa8b59b378b75d8ce6a5b7) |
| 15:24:01 | Pago con billetera Pollar: 10,59 USDC | [b64f1ed1](https://stellar.expert/explorer/testnet/tx/b64f1ed14067f1cd8fa2b774e191420e943e8827f02b364c3dcdd4348ec81525) |
| 15:27:26 | Retiro con dos firmas; el intento con una sola fue rechazado | [15bcbe3a](https://stellar.expert/explorer/testnet/tx/15bcbe3a512a3f54b4e6f372dac4538e307e2ce82bdb23366c178c5d2e255d6d) |
| 15:46:01 | Pago con billetera Pollar: 14,12 USDC | [a5a2a51e](https://stellar.expert/explorer/testnet/tx/a5a2a51e1895cad69074099a9ec4a5285a209ce77afbc8150c1c29e4b95efd81) |

### Quién pagó

Los seis pagos con billetera Pollar los hizo una sola persona del equipo, con dos billeteras: una creada con correo y otra con Google. Los otros dos pagos salieron de billeteras de prueba creadas por los scripts de la demo. Todavía no hay pagos de personas ajenas al equipo.

## Código

Este repositorio es una copia de los archivos del módulo. El trabajo se hizo en la rama `feature/hackathon-aquatrack-pay` de dos repositorios privados, a partir de la plataforma que ya existía:

| Repositorio privado | Commit | Fecha | Autor | Mensaje | Tamaño |
|---|---|---|---|---|---|
| `aquatrack-api` | `2820c60` | 22 nov 2026, 10:49 (hora de Bolivia) | Alejandro Castellon | Add water charges paid on Stellar with a multisig building treasury | 99 archivos, 13.466 líneas añadidas |
| `aquatrack-frontend` | `e76f425` | 22 nov 2026, 10:50 (hora de Bolivia) | Alejandro Castellon | Add the pay page, charges panel and treasury screen for AquaTrack Pay | 36 archivos, 3.579 líneas añadidas |

Cada rama tiene un solo commit porque el trabajo se subió de una vez el día de la entrega. Por eso el avance durante la hackathon se apoya en lo de arriba: transacciones fechadas desde el 18 de noviembre, hechas con este código. La migración de base de datos del módulo lleva esa fecha en su nombre: `20261118120000_water_charges_and_building_treasuries`. Este repositorio público tiene commits del 19 y del 22 de noviembre.

## Pruebas

| Qué | Cuántas | Dónde corren |
|---|---|---|
| Pruebas unitarias del módulo en la API | 311 | 124 desde este repositorio; las otras 187 necesitan la plataforma |
| Pruebas de las utilidades de pago en la web | 14 | Desde este repositorio |
| Pruebas de extremo a extremo de cobros, con base de datos | 8 | Solo con la plataforma |
