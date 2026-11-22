# AquaTrack Pay

El recibo de agua de cada departamento se paga, se concilia solo y llega a una caja que solo mueve la directiva del edificio. Construido sobre Stellar durante la National Startups Hackathon by Stellar (noviembre de 2026).

> **Versión del 22 de noviembre.** Lo marcado como *pendiente* todavía no está hecho o no está verificado. Este repositorio contiene el módulo construido en la hackathon; la plataforma de AquaTrack en la que se integra es privada.

**In English.** AquaTrack meters water per apartment in Bolivian buildings and splits the building's single utility bill by measured consumption. AquaTrack Pay, built during this hackathon, turns each apartment's share into a charge that is paid in USDC on Stellar with a reference memo, reconciled automatically by reading the ledger, and received in a building treasury that needs two of three board signatures to move. AquaTrack never holds the money. Everything here runs on testnet, and there is a [live demo](https://demo.aquatrack.net/demo) with example data. Residents cannot pay in bolivianos yet: the candidate route, a bank-QR on-ramp, is part of the 30-day plan.

## 1. Problema y usuario

En muchos edificios de Bolivia llega una sola factura de agua para todo el edificio. AquaTrack ya resuelve la primera mitad: un medidor en la entrada de agua de cada departamento envía una lectura cada 15 minutos y la plataforma reparte la factura según el consumo medido. La otra mitad sigue igual que antes: el recibo le dice al vecino "Pago: Bs 155" y ahí termina la plataforma. Cobrar esa plata, saber quién pagó y responder por ella sigue siendo trabajo manual del administrador.

**Usuario.** El administrador que cobra el agua de un edificio y la directiva que responde por esa plata ante los copropietarios.

**Evidencia.** Durante la hackathon conversamos con administradores de edificios. *Pendiente:* publicar aquí el resumen de esas conversaciones (cuántos fueron, cómo cobran hoy, cuánto tardan en cuadrar pagos, en qué cuenta entra la plata), con el tamaño de la muestra e incluidas las respuestas que nos contradigan.

**Lo que no afirmamos.** No decimos que los vecinos prefieran pagar en dólares digitales ni que esto sea más barato que el QR del banco, que es gratis y funciona. El recibo sigue en bolivianos. Lo que el QR no da es lo que pasa después del pago: referencia, conciliación y control compartido de la caja.

## 2. Producto funcionando

**Demo.** [demo.aquatrack.net/demo](https://demo.aquatrack.net/demo): una guía de tres pasos para pagar un recibo de ejemplo y verlo conciliado. Es una instancia aparte de la plataforma en producción, con su propia base de datos de ejemplo y en testnet.

Qué se puede hacer:

1. El administrador guarda el prorrateo del mes y publica los cobros.
2. Cada departamento recibe un enlace (y un QR en su recibo PDF). El vecino entra con su correo, sin instalar nada, y paga.
3. La API lee la transacción en la red y marca el recibo como pagado. Nadie revisa comprobantes.
4. El administrador ve quién pagó y la caja del edificio: saldo, firmantes y pagos recibidos, todo leído de Stellar.

Estado al 22 de noviembre:

| Pieza | Estado |
|---|---|
| Caja multifirma, verificación de pagos y conciliación | Hecho y verificado en testnet |
| API de cobros y caja | Hecho y verificado con base de datos y pagos reales en testnet, en USDC de prueba de Circle |
| Página de pago, panel de cobros y pantalla de la caja | Hecho y verificado en navegador contra la API |
| Pago desde cualquier billetera de Stellar | Hecho y verificado: la página pasa sola a "Pago recibido" |
| Pago con billetera Pollar, entrando con correo o con Google | Hecho y verificado con pagos reales en testnet, en local y en la demo desplegada |
| Demo desplegada | Hecho: base, API y web propias. Un [pago de prueba](https://stellar.expert/explorer/testnet/tx/aeab86d80d84fd97f440330102d1a9c0b23581edf1aa8b59b378b75d8ce6a5b7) hecho desde otra billetera quedó conciliado por el servidor en 10 segundos, y un [pago con billetera Pollar](https://stellar.expert/explorer/testnet/tx/b64f1ed14067f1cd8fa2b774e191420e943e8827f02b364c3dcdd4348ec81525) llegó a la caja con el memo de su recibo y la comisión patrocinada |

**Pruebas.** El módulo tiene 325 pruebas automáticas: 311 en la API y 14 en la web. Desde este repositorio corren 138 (124 y 14); las otras 187 dependen de la plataforma. Aparte hay 8 pruebas de extremo a extremo de cobros, con base de datos.

## 3. Uso de Stellar

Stellar no hace falta para medir agua. Para este módulo sí: sin la red, el producto vuelve a ser un recibo que dice cuánto se debe.

| Qué hace el producto | Con qué de Stellar | Evidencia en testnet |
|---|---|---|
| El pago llega con la referencia de su recibo | Memo de texto en la transacción (`AQT-` y 10 caracteres) | [Pago con memo](https://stellar.expert/explorer/testnet/tx/cce693a4c66c1579b2523d91b99fdd2fdd649647149814cfc1b2a560a5013f93) |
| El recibo se marca pagado sin intervención | Lectura de la transacción en Horizon: destino, activo, monto y memo | [`transfer-matcher.ts`](api/src/modules/water-charge/domain/services/transfer-matcher.ts) y sus pruebas con respuestas reales de la red |
| La plata no pasa por AquaTrack ni por una cuenta personal | Cuenta del edificio con tres firmantes, umbral 2 y llave maestra en peso 0 | [Caja de ejemplo](https://stellar.expert/explorer/testnet/account/GCV2O6LDJUNPSRBWMUHIPJOSRETVTVEYSAZLU5YKJU24EXFZXZAA63MD) |
| Una sola persona no puede retirar | Multifirma nativa: con una firma la red responde `tx_bad_auth` | [Retiro con dos firmas](https://stellar.expert/explorer/testnet/tx/d789f3747428b2eb7507f7f57b71d4b281bb03fca7ad7517ca143d7370e46a49) |
| El vecino no paga comisión de red | Transacción con comisión patrocinada (fee bump) | [Pago patrocinado](https://stellar.expert/explorer/testnet/tx/7250bf7b4d589389a1dfd2dcfa3d8f85a1824384adb86fbcc13156c2fd96697b) |
| El vecino entra con su correo y no tiene que conseguir XLM | Billetera embebida de [Pollar](https://pollar.xyz): reserva, línea de confianza de USDC y comisión patrocinadas | [Pago de un recibo desde la página de pago](https://stellar.expert/explorer/testnet/tx/bdaacbf5c89f189e20ed1b03512e4a4483aa088dca22b29a51b370c4b5aade1b), con su memo y la comisión a cargo de Pollar |

Qué es cada cuenta de testnet que aparece en esta entrega, y todas las transacciones con su fecha en la red, están en [docs/evidencia.md](docs/evidencia.md).

La caja se crea en una sola transacción: cuenta, línea de confianza del activo, firmantes, umbrales y llave maestra desactivada. La llave temporal se descarta, así que ni el servidor puede firmar por ella.

Lo que no hacemos: no hay contrato inteligente propio, no se guardan lecturas ni consumos en la red, y la referencia del pago no dice el edificio ni el departamento.

Todo lo anterior se reproduce desde este repositorio con `pnpm demo:smoke` (ver [Cómo correrlo](#cómo-correrlo)), que crea una caja nueva en testnet y recorre los casos: pago exacto, un centavo menos, sin memo, dos pagos en una transacción, pago de más, otro activo, comisión patrocinada y retiro con una y con dos firmas. `pnpm demo:e2e` hace lo mismo contra la API de la plataforma levantada: grifo, confirmación, watcher, pago incompleto y pago duplicado.

## 4. Plan de 30 días

| Entregable | Qué se construye | Criterio de éxito |
|---|---|---|
| 1. Ciclo completo de cobro con un edificio real, en testnet (días 1 a 10) | Montos del prorrateo medido o cargados por el administrador; conciliación de pagos de menos, de más, sin referencia y duplicados | Un edificio real con 10 cobros emitidos, 5 pagados por vecinos o directiva, ninguna corrección manual, mediana de 60 s entre abrir el recibo y el pago confirmado |
| 2. Caja con retiros y libro público (días 8 a 20) | Proponer, firmar entre dos y enviar un retiro desde la plataforma; cambio de firmantes; página de totales sin nombres | Tres personas distintas como firmantes, un retiro con dos firmas, un intento con una firma rechazado, un cambio de firmante, totales iguales al ledger |
| 3. Primer cobro con dinero real, con tope (días 18 a 30) | Configuración de mainnet con límites; una ruta de bolivianos a la caja y de vuelta, probada y medida | 5 pagos reales de 3 pagadores, un retiro con dos firmas, tope de USD 100, opinión legal entregada antes del primer pago. Si la opinión dice esperar, se entrega el despliegue y la consulta presentada |

**De dónde sale la plata del vecino.** En la demo, de un grifo de USDC de prueba. Con dinero real el vecino no debería tener que conseguir dólares digitales, y eso es lo que resuelve el tercer entregable. La ruta que probaremos primero es la rampa de Pollar: el vecino entra con su correo, paga un QR bancario desde la app de su banco y recibe USDC en su billetera; desde ahí paga el recibo con su referencia, igual que hoy. La documentación de Pollar lista un [proveedor para bolivianos](https://docs.pollar.xyz/docs/operator-guide/ramps/providers), Stereum, con compra por QR bancario y venta a una cuenta bancaria, y pone como [ejemplo de ruta](https://docs.pollar.xyz/docs/operator-guide/ramps/routes) una que va de bolivianos a USDC sobre Stellar.

Lo que falta confirmar antes de prometerla:

- Que esa ruta esté disponible para nuestra aplicación hasta Stellar. El proveedor liquida en Polygon y el ejemplo añade un cambio a USDC y un puente.
- Que se pueda probar sin dinero real.
- Su costo de punta a punta y sus límites, de ida y de vuelta. La vuelta importa: la factura de agua del edificio se paga en bolivianos.
- Qué verificación de identidad le pide al vecino.

Mientras tanto, quien ya tenga USDC en Stellar puede pagar desde su billetera con destino, monto y memo.

Después: postular al Integration Track de SCF Build, con el USDC cobrado en las cajas como métrica.

## 5. Equipo y avance

AquaTrack es una startup de Cochabamba: 21 medidores vendidos a cinco clientes en Cochabamba, Sacaba, Santa Cruz y Sucre. El primer edificio con un medidor por departamento (10 departamentos, en Sacaba) está vendido y pendiente de instalación.

**Equipo.** Alejandro Castellón, Founder & CEO, construyó este módulo. Rodrigo Altamirano está a cargo del hardware y la manufactura de los medidores.

**Reconocimientos, con su fuente.** [Ganadores del Track Corporativo de MCPJam en COCHATECH 2026](https://cba.ucb.edu.bo/estudiantes-de-mecatronica-y-sistemas-ganan-premio-de-1000-usd-en-el-track-corporativo/), con un premio de USD 1.000. [Puesto 51 de los 500 Mejores Proyectos de Premios Verdes 2026](https://500-mejores.premiosverdes.org/es/proyecto-500-mejores?proyecto=aquatrack-alejandro-mauricio-castellon-fernandez).

| Antes de la hackathon | Construido en la hackathon |
|---|---|
| Medidor, central y plataforma en producción | Cobros publicados desde el prorrateo |
| Lecturas cada 15 minutos | Pago con billetera embebida o con cualquier billetera de Stellar |
| Prorrateo de la factura por consumo medido | Verificación y conciliación leyendo la red |
| Recibo en PDF por departamento | Caja multifirma del edificio |
| Ninguna forma de cobrar ni estado de pago | Estado de pago, comprobante en la red y QR de pago en el recibo |

El avance día por día está en [docs/bitacora.md](docs/bitacora.md), y la evidencia con fecha (transacciones, cuentas, commits y pruebas) en [docs/evidencia.md](docs/evidencia.md).

## Qué hay en este repositorio

Los archivos del módulo, copiados sin cambios de las ramas de la hackathon de los dos repositorios privados de AquaTrack.

- `api/`: el módulo NestJS `water-charge` (cobros y caja), el acceso a Stellar (`src/shared/stellar`), los scripts de testnet (`scripts/demo`), la migración y las pruebas. Las lecturas van a Horizon; el servidor solo firma en testnet, para crear cajas y para el grifo de fondos de prueba.
- `web/`: la página pública de pago, el panel de cobros, la pantalla de la caja y la guía de la demo (Next.js).
- `docs/`: la [bitácora](docs/bitacora.md) y [cómo se integra en la plataforma](docs/integracion.md), con la lista de los archivos de la plataforma que el módulo tocó y que no se publican.

## Cómo correrlo

El módulo completo necesita la plataforma, así que el producto funcionando se ve en la demo. Lo que sí corre desde aquí, solo con Node 22.12 o superior:

```bash
cd api
pnpm install
pnpm test        # 124 pruebas: monto, referencia, verificador de pagos y acceso a Stellar
pnpm demo:smoke  # en testnet: caja 2 de 3, pagos con memo, comisión patrocinada y retiro con una y con dos firmas
```

```bash
cd web
pnpm install
pnpm test:payments  # 14 pruebas de las utilidades de pago
```

`pnpm demo:smoke` crea sus propias cuentas con Friendbot y usa un activo de prueba, así que no necesita fondos ni claves; al terminar imprime los enlaces de cada transacción en el explorador. Las demás pruebas del módulo (casos de uso, controladores y repositorios) dependen de la plataforma y están aquí para leerse.

## Límites que conocemos

- Todo corre en testnet. No hay dinero real ni lo habrá antes de una opinión legal.
- La entrada y salida en bolivianos no está resuelta: es el tercer entregable, y su ruta candidata está sin confirmar (ver el [plan de 30 días](#4-plan-de-30-días)).
- Un pago parcial no liquida el cobro; se muestra como monto incompleto.
- En la demo, las llaves de la directiva del edificio de ejemplo son de prueba y las guarda el equipo.
- Si alguien no paga, aquí no se corta el agua: el acceso al agua es un derecho y la válvula no se usa para eso.
