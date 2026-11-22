# Bitácora de avance

Qué se hizo cada día de la hackathon, con lo que quedó verificado y lo que no.

## Miércoles 18 de noviembre

Punto de partida: la plataforma de AquaTrack calcula cuánto debe cada departamento, pero no tenía cobro, estado de pago ni una línea de Stellar.

Hecho y verificado:

- Tablas de cobros y de la caja del edificio, con su migración.
- Conversión de bolivianos a USDC con enteros (redondea hacia arriba al centavo), referencias de cobro y verificador de pagos, con pruebas.
- Acceso a Stellar: lectura de Horizon y creación de la caja en una sola transacción.
- En testnet: una caja de 2 de 3 firmas con la llave maestra desactivada, pagos con memo verificados, y un retiro que la red rechaza con una firma y acepta con dos.
- Las respuestas reales de Horizon quedaron guardadas como casos de prueba.

Verificado de punta a punta el mismo día, con base de datos y testnet:

- La migración se aplica sobre una base nueva y las pruebas con base de datos pasan: 145 de extremo a extremo (8 nuevas de cobros) y 49 de integración.
- Con la API levantada: se crearon las cajas de tres edificios, se publicaron los cobros y se cargó el edificio de ejemplo desde un CSV.
- Pagos reales en testnet contra la API: el grifo envía justo lo que falta; pago exacto y confirmación; pago sin confirmar, que el watcher liquidó en 9 segundos; un centavo menos, que no liquida; y un pago doble, que no cambia el cobro. La caja los muestra como conciliado, monto incompleto y duplicado.
- En el navegador, contra esa API: la caja con saldo y firmantes leídos de la red, el panel de cobros, el recibo del residente con su estado y su botón de pago, el PDF con el QR, y la página de pago, que pasó sola a "Pago recibido" cuando llegó un pago hecho desde otra billetera.

Hecho, pendiente de una prueba real:

- Pago con billetera Pollar: integrado contra los tipos de su SDK, pero sin probar con una clave real. Las pruebas de hoy pagaron desde otra billetera.
- Las pruebas locales usaron un activo de prueba propio, no el USDC de Circle: la cuenta de operaciones todavía no tiene USDC del grifo.
- La demo no está desplegada.

En números: 303 pruebas unitarias nuevas en la API (la suite completa no tiene fallos nuevos) y 14 en el frontend. El SDK de Pollar solo se descarga en la página de pago; el sitio público pesa lo mismo que antes.

Aprendido:

- Horizon devuelve un hash distinto según cómo se consulte una transacción con comisión patrocinada. El identificador estable es el de la operación.
- El SDK de Pollar acepta el memo como opción del envío, así que el pago puede llevar la referencia del recibo.
- Varios listados de la API responden 404 en vez de una lista vacía; los scripts de la demo lo asumían mal y se corrigieron al correrlos contra la API real.

## Jueves 19 de noviembre

Hecho y verificado:

- La demo local ya usa el USDC de prueba de Circle, no un activo propio: la cuenta de operaciones recibió 20 USDC del grifo de Circle y las cajas y los cobros se crearon de nuevo con ese activo.
- Dos comandos nuevos. `pnpm demo:pay <código>` paga un recibo desde otra billetera sin avisarle a la API. `pnpm demo:recycle` retira lo que hay en la caja hacia la cuenta de operaciones: primero con una firma, que la red rechaza, y después con dos.
- Recorrido completo de la guía `/demo` en el navegador, contra la API local: abrir un recibo, [pagarlo en testnet](https://stellar.expert/explorer/testnet/tx/2111f27be638f9e85a73e17bfead1e3d4d0cea5a00a1533bc91ca11d6052dac6) desde otra billetera, ver la página pasar sola a "Pago recibido" 6 segundos después, y entrar como administrador para verlo conciliado en la Caja. Después, el [retiro con dos firmas](https://stellar.expert/explorer/testnet/tx/491ac0933ef07ce3e648904d3a0b14b64dc94ef1ffbc5db6275478f770f1bb9a).
- Primer pago con billetera Pollar, hecho por una persona entrando con su correo en la página de pago local. Pollar creó la billetera con su reserva y su línea de confianza de USDC patrocinadas; el grifo de la demo le envió los 4,67 USDC del recibo; y el [pago llegó a la caja con el memo del recibo](https://stellar.expert/explorer/testnet/tx/bdaacbf5c89f189e20ed1b03512e4a4483aa088dca22b29a51b370c4b5aade1b), con la comisión de red pagada por Pollar. La API lo encontró en la red y marcó el recibo como pagado sin que nadie le avisara. Entre la creación de la billetera y el pago pasaron 55 segundos.
- Dos pagos más con la misma billetera, sin volver a iniciar sesión: Pollar recordó la sesión en el navegador y los pagos de [otro recibo](https://stellar.expert/explorer/testnet/tx/80da181e47111953e375bc4114ec480b6408d4da46e2a2354a4a64ad59b7198a), 27 minutos después del primero, y de [un tercero](https://stellar.expert/explorer/testnet/tx/c565c85aaf3828c13625e89574e6df7d9fe1425e127d8d55dc21105977453d95) se conciliaron igual. Como quien vuelve ya no pasa por el acceso, la página ahora dice con qué correo se entró y ofrece "Cambiar de cuenta". Después, [otro retiro de la caja](https://stellar.expert/explorer/testnet/tx/a9771c936c321d4f4d822e1daca936e52930032f4c5a8887a78df0f0a3fcf273) con dos firmas, rechazado antes con una.
- Pago entrando con Google, desde una billetera nueva: Pollar la creó y le habilitó USDC, el grifo le envió los fondos y el [pago](https://stellar.expert/explorer/testnet/tx/639c492455ad048af097f656f308c731ce1eec8fdf1a60ff5b32f1acbe0b42de) llegó a la caja con su memo y se concilió solo.
- Este repositorio se arma con un script que copia solo los archivos del módulo desde las dos ramas privadas y se niega a terminar si encuentra una clave. Desde la copia, sin la plataforma, corren 124 pruebas de las reglas de dominio y del acceso a Stellar, las 14 de las utilidades de pago y la verificación completa en testnet (`pnpm demo:smoke`).

Encontrado al recorrer la demo como lo haría un visitante, y corregido:

- La guía podía abrir un recibo más caro que el saldo del grifo (20,04 USDC con 20 disponibles): el visitante pedía fondos de prueba y recibía un error genérico. Ahora la guía prefiere los recibos que el grifo puede financiar y, si el grifo se queda sin fondos, la página lo dice.
- La guía mostraba la contraseña del administrador de la demo cortada: en un archivo `.env`, un valor sin comillas termina en el `#`.
- Sin broker MQTT configurado, la API reintentaba una conexión local cada segundo y llenaba los registros. Ahora no se conecta.
- Al primer intento con la clave real, Pollar respondió `ORIGIN_NOT_ALLOWED` hasta registrar el origen local en su panel. La página lo mostró como un aviso y siguió dejando pagar con otra billetera.
- En el primer pago con Pollar la página pidió un paso de más: Pollar habilita USDC por su cuenta unos 5 segundos después de crear la billetera, pero la página leyó el saldo antes y ofreció "Habilitar USDC", que en la red quedó como una segunda operación sin efecto. Ahora la página espera y vuelve a leer el saldo antes de ofrecer ese botón. Comprobado con la billetera nueva del pago con Google: en la red quedó una sola operación de línea de confianza, la de Pollar.

- El acceso con Google de Pollar se abre en otra pestaña. En el inicio de sesión real, Pollar la cerró por su cuenta y el recibo quedó en primer plano. Por si en otro navegador no la cierra, la dirección de retorno apunta a una página propia que se cierra sola (sin ella, la pestaña volvería a la portada del sitio); esa página se probó con una pestaña abierta igual que la abre el SDK.

Pendiente:

- La demo no está desplegada.

En números: 9 pruebas unitarias nuevas en la API, 8 en el módulo de cobros (311 con las de su acceso a Stellar) y una en el cliente MQTT de lecturas.

Aprendido:

- Pollar solo responde desde los orígenes registrados en su panel, y los comprueba por app: una clave válida desde un origen sin registrar recibe un 403, no un error de clave. El acceso con Google pide además una dirección de retorno registrada; el acceso con código por correo, no.

## Viernes 20 de noviembre

Hecho:

- Revisamos de dónde saldría la plata del vecino con dinero real y lo escribimos en el README: la ruta candidata es la rampa de Pollar con QR bancario, y la lista de lo que falta confirmar antes de prometerla.

## Domingo 22 de noviembre

Hecho y verificado:

- Ensayo del despliegue en local con Docker y los mismos `Dockerfile` del servidor: las dos imágenes se construyen, la API aplica sus 37 migraciones sobre una base nueva, la base de ejemplo se siembra dentro del contenedor y las cajas se crean en testnet desde esa imagen.
- Demo desplegada en [demo.aquatrack.net/demo](https://demo.aquatrack.net/demo): una instancia aparte de la plataforma en producción, con su propia base de datos de ejemplo, su propia API y su propia web, sin conexión a medidores.
- En la demo desplegada: cajas de 2 de 3 firmas para tres edificios de ejemplo y 31 cobros publicados. Un [pago hecho desde otra billetera](https://stellar.expert/explorer/testnet/tx/aeab86d80d84fd97f440330102d1a9c0b23581edf1aa8b59b378b75d8ce6a5b7), sin avisarle a la API, quedó conciliado por el servidor 10 segundos después y sus 4,67 USDC llegaron a la [caja del edificio de ejemplo](https://stellar.expert/explorer/testnet/account/GDKANI42SKX3E3ESDVV4OXZRMHHQE7REEKVBLRO2EDKVUNTOOPBVBTWF).

- Pago con billetera Pollar desde la demo desplegada: los [10,59 USDC del recibo 2B de octubre](https://stellar.expert/explorer/testnet/tx/b64f1ed14067f1cd8fa2b774e191420e943e8827f02b364c3dcdd4348ec81525) llegaron a la caja con el memo del recibo y la comisión de red pagada por Pollar, y el recibo quedó pagado.
- Retiro de esa caja en la demo desplegada: con una sola firma la red lo rechazó (`tx_bad_auth`) y [con dos firmas pasó](https://stellar.expert/explorer/testnet/tx/15bcbe3a512a3f54b4e6f372dac4538e307e2ce82bdb23366c178c5d2e255d6d). Los 15,26 USDC volvieron a la cuenta del grifo de la demo, para que los próximos visitantes puedan pagar.

Encontrado al desplegar, y corregido:

- La terminal del contenedor abre en otra carpeta y la siembra no encontraba su archivo. De paso, el comando de siembra ahora cuenta usuarios, edificios y lecturas y solo corre si la base está vacía, porque el nombre de la base no alcanza para saber cuál es.

Pendiente:

- Las entrevistas con administradores.
