# Pago con tarjeta → comprobante y conciliación (plan y estado)

Origen: un pago de RD$ 500 con tarjeta dentro de la app activó la membresía, pero `/admin/conciliacion` lo
mostró como «Cobros sin transacción registrada», sin comprobante imprimible y con botones «Revisar» que no
llevaban a ningún caso. Este documento recoge el diagnóstico verificado, el plan por fases y el estado.

## Diagnóstico (verificado con pruebas PostgreSQL reales — `tests/postgres/pagos-comprobante.db.test.ts`)

| # | Hallazgo | Prueba | Fase que lo corrige |
|---|---|---|---|
| H1 | Un pago con tarjeta aprobado (app, 3DS web) activa la membresía y entrega, pero **no crea `Transaction`**: sin ticket, sin factura, fuera de Facturas/Registros/cierre. La conciliación lo ve como cobro sin transacción (el RD$ 500 de la captura) | H1 | 2 |
| H2 | `MetodoCobroTipo` solo tiene `EFECTIVO · TRANSFERENCIA · OTRO`: no existe «tarjeta» en el libro | H2 | 1 |
| H3 | Contraste: el panel de administración **sí** registra la venta (`registrarVentaConfirmada`); es el patrón a reutilizar | H3 | — |
| H4 | La renovación automática con tarjeta guardada cobra, renueva y entrega (cierra `fulfillment`), pero tampoco deja `Transaction` | H4 | 2 |
| H5 | **Falso positivo.** `pago_intentos.fulfillmentEstado` se añadió con `DEFAULT 'PENDIENTE'` y **sin backfill** (`20260912_p1b`): todo cobro aprobado antes de esa migración cuenta como «cobrado sin entregar» para siempre, aunque la membresía esté activa | H5 | 1 (backfill) y 4 |
| H6 | **Punto ciego.** La regla solo mira `PENDIENTE`: un cobro con entrega `FALLIDA` y un cliente sin su membresía **no aparece**; el panel dice «Todo cuadra» | H6 | 4 |
| H7 | Los «Revisar» no llevan a una lista de casos: `/admin/pagos` solo lista colas de validación; `/admin/reportes/finanzas` enseña una cifra sin acción; la caja abierta lleva a una pantalla del vertical car wash que exige la capacidad `TURNOS` | `tests/conciliacion-admin-enlaces.test.ts` | 4 |

**Corrección de una hipótesis inicial.** Se sospechó que la renovación automática dejaba `fulfillmentEstado =
PENDIENTE`. La prueba H4 la **descarta**: `renovarMembresiaPorTarjeta` llama `marcarEntrega(…, true)` y queda
`COMPLETADA`. Los «9 pagos / RD$ 14,400» salen de H5 (cobros anteriores a la columna) y, en menor medida, de
la ventana en que una función serverless muere entre el cobro y `marcarEntrega`.

**Qué NO se sabe sin mirar producción** (la fase 4 los separa en pantalla; sigue sin consultarse producción): cuántos de esos 9 son de H5 y cuántos entregas atascadas reales. Se
distinguen con una consulta de solo lectura (membresía activa + `fechaPago ≥ activadoAt` ⇒ H5; membresía sin
activar ⇒ atascado real).

## Plan por fases

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Pruebas de caracterización (H1–H7) | ✅ |
| 1 | Migración aditiva (`20261053`, `20261054`): `MetodoCobroTipo.TARJETA`, `Transaction.pagoIntentoId` único con CHECK y disparador, `PagoIntento.canal`, backfill demostrable del cumplimiento, módulo puro del comprobante | ✅ (`tests/postgres/pagos-tarjeta-modelo.db.test.ts`, `tests/comprobante-tarjeta.test.ts`) |
| 2 | Registrar la venta (`SALE`, método `TARJETA`, canal app/web/renovación) justo después de entregar; idempotente y autorreparable; bitácora `PAGO_APROBADO` con método, canal e intento | ✅ (`tests/postgres/pagos-venta-tarjeta.db.test.ts`; H1 y H4 invertidos) |
| 3 | Comprobante visible e imprimible: Facturas/Registros con filtro «Tarjeta», ficha del cliente, caja («cobros en línea del día», fuera del arqueo), cuadre y cierre, recibo para el cliente (app, web y BFF) | ✅ (pruebas PG, unitarias y E2E; ver abajo) |
| 4 | Conciliación accionable: lista de casos por hallazgo, «Generar comprobante», «Reintentar entrega», «Marcar entregada» (con nota), cajas abiertas que llevan a su caja; la regla de entrega distingue «cliente esperando» de «registro sin cerrar» y mira `FALLIDA`/`PROCESANDO` atascados | ✅ (H5, H6 y H7 invertidos; ver abajo) |
| 5 | Cron diario `/api/cron/entregas-pago`: reintenta entregas, repara comprobantes recientes y avisa a los administradores | ✅ (ver abajo) |
| 6 | Comprobantes retroactivos como **acción explícita en lote** (nunca automática), SQL de diagnóstico de producción y cierre | ✅ (ver abajo) |

## Fase 2: cómo queda registrada la venta

- **Dónde.** `asegurarVentaDelIntento` (`src/modules/pagos/venta-tarjeta.ts`) se llama tras cada cumplimiento en
  `confirmarIntento`, `resultadoIntentoActual` y `reintentarEntrega`, y en la renovación con tarjeta guardada.
  Cubre los tres canales: app (sesión Expo), web (3DS y token en iframe) y renovación automática.
- **Canal.** `pago_intentos.canal` (`APP`, `WEB`, `RENOVACION_AUTOMATICA`) se escribe al crear el intento y es el
  dato que el comprobante imprime como «dentro de la app».
- **Decisión de diseño (se aparta del plan inicial).** La venta se escribe **después** de entregar y no dentro de
  la misma transacción de activación. Motivo: un fallo de facturación no puede dejar a un cliente que ya pagó sin
  su membresía. A cambio se garantiza que (1) es idempotente por `pagoIntentoId` único, (2) se repara sola en la
  siguiente pasada, también cuando la repetición encuentra el cobro ya entregado, y (3) la fase 4 ofrece
  «Generar comprobante» para los casos que aun así queden sin venta.
- **Solo se factura un cobro APROBADO con entrega COMPLETADA.**
- **Bitácora.** `PAGO_APROBADO` lleva `metodo: 'TARJETA'`, `canal` e `intentoId` cuando el cobro vino de pasarela.

## Fase 3: dónde se ve y se imprime

| Superficie | Qué muestra | Quién |
|---|---|---|
| Caja del empleado (`/empleado/caja`) | Lista «Cobros con tarjeta en línea de hoy», **fuera de la gaveta** (el efectivo esperado no cambia), cada cobro con su botón de imprimir | Personal de caja |
| «Mi cuadre del día» (impreso) | Sección «Cobros en línea (tarjeta)» con ticket, cliente, canal y total; **no suma** al total del empleado | Personal de caja |
| Cierre de caja (impreso) | Bloque informativo «Cobros en línea durante el turno» por canal; el arqueo de efectivo no cambia | Personal de caja |
| Comprobantes (`/admin/facturas`) | Filtro «Pagos con tarjeta» y la forma de pago completa («Tarjeta VISA ••••4242 (en la app)») | Administración |
| Registros (`/admin/registros`) | Subtotal «Tarjeta» y filtro por método | Administración |
| Ficha del cliente → Historial | «Pagos con tarjeta en línea», reimprimibles | Administración |
| «Mis pagos» (web) y app Expo | Forma de pago, recibo Nº, autorización, negocio; **Imprimir recibo** (web) y **Compartir recibo** (app) | Cliente |
| `GET /api/v1/cliente/pagos` | `formaDePago` y `recibo` en cada pago del historial (campos nuevos, opcionales para apps antiguas) | App |

- Los cobros en línea se identifican por `SALE` + `TARJETA` + `pagoIntentoId`: así no se confunden con un cobro con
  datáfono en el mostrador (ese se guarda como `OTRO`, sin cambios).
- El recibo del cliente es el **mismo ticket** que imprime el personal (`recibo-cliente.ts` lee el snapshot de la venta).
  Un recibo solo se entrega al dueño del cobro: la consulta filtra por las fichas de la persona.
- El comprobante nunca lleva el número de tarjeta: lo garantizan los sanadores del snapshot y del recibo.

**Verificación de la fase 3:** suite PostgreSQL completa 676/676; pruebas unitarias nuevas (`cobros-en-linea-resumen`,
`recibo-cliente`) y de base (`pagos-tarjeta-caja`, `pagos-tarjeta-reportes`, `pagos-tarjeta-cliente`); E2E de interfaz
`tests/e2e/tarjeta-comprobante.spec.ts` (caja, Comprobantes, Registros, ficha del cliente y «Mis pagos») estable en tres
corridas. La app Expo no se pudo ejecutar en un dispositivo aquí: su tipado se comprobó con sus dependencias instaladas (sin
errores en los dos archivos tocados; los errores que quedan son de otros archivos y ya existían).

### Hallazgo: doble conteo en Reportes (corregido solo para tarjeta) y uno anterior sin corregir

`Total cobrado` (Finanzas y Reporte de la empresa) suma la caja (`transactions`) y los cobros de membresía
(`montoPagado`). Con la venta de la fase 2, un pago con tarjeta de una membresía estaba en los dos y el total mostraba
**RD$ 1,000 por un pago de RD$ 500** (reproducido con la base real). Se corrigió: el flujo de membresías deja fuera las
que ya tienen venta de pasarela en el periodo.

**Hallazgo anterior, NO corregido (necesita decisión):** una membresía cobrada en el mostrador o confirmada desde el panel
ya dejaba venta + membresía, y por tanto ya contaba doble en `Total cobrado`. Se fijó con una prueba (la caracterización
del caso 3 de `pagos-tarjeta-reportes.db.test.ts`) para que cambiarlo sea una decisión y no un efecto lateral, porque
modifica cifras que ya se publicaron. Propuesta: aplicar la misma guarda a toda venta con `membershipId`.

### Nota sobre la fecha de una venta tardía

La venta lleva la fecha en que se **registra**. Si la autorreparación o «Generar comprobante» (fase 4) la escribe más tarde
que el pago, caerá en el día en que se escribe. Los reportes por periodo ya quedan sin doble conteo aun así (cada mes
cuenta lo suyo), pero el cuadre de un día pasado no la verá. Por eso la fase 4 debe fechar la venta con `activadoAt` del
cobro, o dejarlo escrito como decisión.

## Fase 4: conciliación accionable

`/admin/conciliacion` es ahora una lista de casos con su acción. Ninguna acción recobra dinero, todas se comprueban otra
vez en el servidor, son idempotentes y dejan un asiento en la bitácora (migración `20261055`, tres acciones nuevas).

| Hallazgo | Casos que lista | Acción |
|---|---|---|
| Cobros sin transacción registrada | Cobros con tarjeta ya entregados sin venta, y membresías cobradas sin venta ni pasarela | **Generar comprobante** (tarjeta; se imprime ahí mismo) · Abrir ficha (el resto: el método y quién cobró no se inventan) |
| Pagos cobrados con entrega pendiente | El cliente pagó y su producto **no** está activo: entrega `FALLIDA`, `PENDIENTE` o `PROCESANDO` atascada | **Reintentar entrega** (vuelve a activar, no recobra) |
| Cobros entregados que quedaron sin cerrar *(nuevo)* | El producto **sí** está activo (se activó a partir del cobro) pero el cobro nunca se marcó entregado | **Marcar entregada**: exige nota (5 a 300 caracteres), usa la fecha de la activación y genera el comprobante |
| Cajas abiertas de días anteriores | Sucursal, quién abrió, desde cuándo, cuántos cobros | **Abrir caja** → `/empleado/caja?caja=<id>` (se cierra contando el efectivo) |
| Turnos con faltante o sobrante | Sucursal, quién cerró, diferencia | **Ver cierre** (el reporte imprimible del turno) |

**La regla de entrega** (`conciliacion-entrega.ts`, pura y probada): un cobro cuyo producto se activó a partir del cobro
está entregado aunque el registro no lo diga; uno cuyo producto no está activo es un cliente esperando. Un pago anterior de
la misma membresía no prueba nada sobre el cobro nuevo. Una entrega `PENDIENTE` o `PROCESANDO` de menos de 2 minutos es el
cobro en curso y no se muestra. Con esto, pagos como los 9 de RD$ 14,400 de la captura se reparten según su causa real en vez de
contarse todos como clientes esperando (cuántos son de cada tipo solo se sabrá al abrir la pantalla con los datos de
producción), y un cobro con la entrega fallida deja de salir como «Todo cuadra».

**Permisos.** Los botones usan la misma función que confirmar un pago (`pagos` · `confirmar_pago`); la empresa sale de la
sesión, nunca del formulario. «Marcar entregada» solo se permite con evidencia: nunca sobre un cliente que no tiene su producto.

**Venta tardía.** La venta se fecha con el momento del **cobro** (`crearTransaccionAplicada({ fecha })`), no con el de su
escritura: «Generar comprobante» o la autorreparación la dejan en el día en que el cliente pagó. El número de ticket sigue el
contador de la empresa, así que un comprobante tardío lleva un número mayor que sus vecinos de ese día.

**Decisión 2 resuelta por cómo ya funciona la caja:** cerrar una caja no exige ser quien la abrió; la acción de cierre solo pide
ser personal de la misma empresa con la caja activada. La conciliación no añade un cierre propio porque el cierre necesita el
efectivo contado: lleva a la caja, donde se hace.

## Fase 5: el cron de entregas

`GET /api/cron/entregas-pago` (CRON_SECRET, diario a las 12:30 UTC = 08:30 hora de Santo Domingo, `vercel.json`) es la red de
seguridad de un cobro con tarjeta. Hace tres cosas, ninguna recobra dinero, y todo es idempotente:

1. **Reintenta la entrega** de los clientes que pagaron y siguen sin su producto (`reintentarEntrega`, la misma función de siempre,
   que reclama el cobro con un candado: correrlo a la vez que un clic de la conciliación no activa dos veces). Solo cobros de los
   últimos 7 días, hasta 5 reintentos (cuenta también los manuales) y con espera creciente (15 min, 30 min, 1 h… hasta un día).
   Nunca insiste para siempre y nunca toca un cobro viejo que debe mirar una persona. Si entrega, deja un asiento en la bitácora
   con `origen: 'AUTOMATICO'`.
2. **Repara los comprobantes que faltan** de cobros ya entregados y recientes (14 días), **solo los que ya nacen con canal**: no
   escribe nada retroactivo (eso es la fase 6).
3. **Avisa a los administradores** de cada empresa que sigue con clientes esperando (más de 30 minutos): una notificación por
   empresa y día (clave estable), con cuántos son, cuánto suman y si ya hace falta una persona. Lleva a `/admin/conciliacion`.

Tiene presupuesto de tiempo (45 s) y tope de 50 reintentos por pasada; si no alcanza lo dice (`incompleto`) y la siguiente pasada
sigue. Las reglas (`barrido-entregas-reglas.ts`) son puras y están probadas aparte.

**Frecuencia.** La programación es diaria porque el proyecto documenta que el plan solo admite crons diarios (una programación más
frecuente haría fallar el despliegue; una prueba estática lo vigila). Un cliente que no recibe su producto espera como mucho hasta el
siguiente barrido **si ninguna otra vía lo reintenta antes** (el retorno del navegador, el webhook y el botón de la conciliación sí
lo hacen al momento). Con un plan que admita más frecuencia basta subirla en `vercel.json`: el barrido respeta su espaciado y su
aviso es uno por día.

## Fase 6: ponerse al día con los pagos anteriores y verificar en producción

**Comprobantes retroactivos: acción explícita, nunca automática.** Escribir ventas con fecha pasada mueve los reportes de esos
meses, así que no hay migración ni cron que lo haga. En `/admin/conciliacion` se elige el periodo (7 días, 30, 90 o 1 año) y, cuando
hay más de un cobro con tarjeta entregado sin comprobante, aparece **«Generar los N comprobantes»**: la confirmación enseña cuántos
son y cuánto suman, y dice que no se cobra nada. Cada comprobante lleva la fecha en que el cliente pagó y el texto honesto
«Tarjeta» (los cobros viejos no guardaron el canal), queda en la bitácora a nombre de quien pulsó (`origen: 'LOTE'`) y repetir no
duplica nada. Hasta 200 por pulsación; si hay más, se vuelve a pulsar. Para uno solo sigue existiendo «Generar comprobante».
Con esto la decisión 1 puede resolverse como se prefiera —de golpe o caso por caso— sin tocar código.

**El reporte de un mes viejo no cuenta el pago dos veces.** Como la venta cae en el día del cobro y los reportes dejan fuera del flujo
de membresías las que ya tienen venta de pasarela en el mismo periodo, escribir un comprobante viejo deja el total de ese periodo igual
(pasa de «por la membresía» a «por la caja») y no cambia el periodo actual. Lo prueba `pagos-comprobantes-retroactivos.db.test.ts`.

**Mirar producción antes de actuar.** `scripts/diagnostico-pagos-con-tarjeta.sql` (solo SELECT, ejecutado contra la base local;
una prueba vigila que siga siendo solo lectura) clasifica los cobros sin entregar con la misma regla de la pantalla:

| Situación | Qué significa | Qué hacer |
|---|---|---|
| `CLIENTE_ESPERANDO` | El producto no está activo | «Reintentar entrega» (o lo hace el cron si es reciente) |
| `REGISTRO_SIN_CERRAR` | El producto ya está activo desde el cobro | «Marcar entregada» con nota |
| `EN_CURSO` | Menos de 2 minutos: es el cobro ocurriendo | Nada |

y cuenta cuántos cobros entregados no tienen comprobante (recientes con canal y anteriores sin canal). Es lo que responde, con datos
reales, cuántos de los 9 pagos de la captura eran falsos positivos y cuántos eran clientes esperando. **No se ha ejecutado contra
producción**: eso solo puede hacerlo quien tenga acceso a esa base.

## Revisión independiente (2026-10-17)

Después de cerrar las seis fases, un revisor que no había escrito el código leyó todo lo que mueve dinero. Encontró diez cosas.
Se comprobó cada una contra el código antes de tocar nada; nueve eran reales y se corrigieron, y una es una decisión de
política. Cada corrección tiene su prueba en `tests/postgres/pagos-revision-independiente.db.test.ts`, que falla si vuelve el defecto.

| # | Qué pasaba | Qué se hizo |
|---|---|---|
| 1 | Una **renovación automática** cobrada cuya extensión fallaba quedaba fallando para siempre: el reintento llamaba a `activarMembresia`, que rechaza una membresía ya activa. El barrido y la conciliación gastaban sus reintentos en vano. | La extensión vive en `modules/pagos/renovacion-extension.ts` y la usan el cobro y el reintento. Cierra la entrega en la misma transacción que extiende, fecha el pago al cobro y nunca recobra. Además, una renovación aprobada sin entregar **bloquea otro cobro del mismo periodo** (antes, pasadas 12 horas, el cron podía cobrar dos veces). |
| 1b | Un **cambio de plan** pagado con tarjeta nunca se puede entregar por la pasarela (la membresía ya está activa y el cambio lo aplica una persona), pero se reintentaba sin fin. | No se reintenta (ni el botón ni el barrido). El caso en la conciliación dice qué hacer: aplicar el cambio desde Pagos y luego cerrar el cobro con «Marcar entregada». El barrido lo cuenta aparte y avisa que hace falta una persona. **Sigue sin haber entrega automática de un cambio de plan por tarjeta**: es una función que falta, no un error. |
| 2 | El barrido leía solo las 500 filas más antiguas y filtraba después: con 500 registros viejos sin cerrar, los clientes recientes que esperaban no entraban nunca. | Lee por páginas, lo más reciente primero, con tope de 10 páginas; si no cabe, lo dice (`incompleto`). |
| 3 | «Marcar entregada» daba por entregado el producto con cualquier activación posterior al cobro, aunque hubiera tardado días. | El caso enseña **qué activación se usó y cuánto tardó** («Se activó 3 días después del cobro. Tardó mucho: comprueba…»), y la bitácora guarda esa evidencia. No se bloquea: puede ser la entrega perdida de verdad. |
| 4 | El comprobante pegaba la tarjeta **guardada** de la membresía a cualquier cobro, aunque se hubiera pagado con otra. | Marca y últimos 4 solo en renovaciones automáticas y si la venta se escribe enseguida. En los demás casos dice «Tarjeta» y la autorización. |
| 5 | La fecha de pago de la membresía era la de la **entrega**, y la de la venta, la del cobro. Con una entrega tardía al otro lado de un cambio de mes, el dinero se contaba en dos periodos. Además, el reporte de Clientes y el detalle de Finanzas seguían sumando membresía y venta. | `fechaPago` de un cobro de pasarela es `activadoAt`. La guarda de doble conteo se aplicó también a «valor de clientes» y al detalle de Finanzas. |
| 6 | Un proceso **automático** podía escribir una venta fechada en un mes ya cerrado. | Lo automático solo escribe ventas de cobros de hasta 14 días; más viejos solo los escribe una persona con la acción explícita de la conciliación. |
| 7 | La lista de cobros en línea cortaba a 500 filas y el **total** del cuadre se calculaba con la lista cortada. | El total y la cuenta son los del día completo; la lista avisa cuando está recortada. |
| 8 | Todos los roles que ven la caja ven la lista de cobros en línea de **toda la empresa**, no solo la de su sucursal. | **No se cambió: es una decisión de política.** Ver decisión 7. |
| 9 | El cron no contaba como error un comprobante que no se pudo escribir (la función devuelve `null`, no lanza), así que decía «todo bien». | Se cuenta en `errores`; y la reparación recorre primero lo más reciente. |
| 10 | La migración `20261054` se **modificó después de haberse publicado** (se le añadió el relleno). | **No se puede deshacer.** Una base que ya hubiera aplicado la primera versión no tiene el relleno: hay que correrlo a mano (marcado `-- BACKFILL:INICIO/FIN`). Las bases creadas de cero están bien. |

## Verificación de cierre (2026-10-16)

| Comprobación | Resultado |
|---|---|
| Tipos (`tsc --noEmit`) y ESLint | Sin errores (12 avisos de archivos que este trabajo no tocó) |
| Pruebas unitarias | 3,968 de 3,976 pasan; las 2 que fallan fijan el 14 de octubre de 2026 (ya pasó) y no tienen relación con este trabajo |
| Suite PostgreSQL completa (contra la base real) | 698 de 698 |
| Suite E2E completa de navegador (con reconstrucción) | 176 pasan, 0 fallan; 205 omitidas por diseño (proyecto móvil o credenciales externas) |
| Migraciones | `20261053`, `20261054`, `20261055` aplicadas; sin deriva de esquema; sellos al día |
| App Expo | Solo tipos de los archivos tocados (sin dispositivo) |

## Estado final y lo que queda

Entregado (fases 0 a 6): el pago con tarjeta deja su venta y su comprobante en el libro (app, web y renovación), visible e
imprimible para el personal (caja, cuadre, cierre, Comprobantes, Registros, ficha) y para el cliente (app, web y API), fuera del
arqueo de efectivo y sin doble conteo en reportes; la conciliación enseña cada caso con su acción auditada; y un cron diario
reintenta, repara y avisa.

Queda, y no depende de código:

- **Decisiones abiertas** de abajo (1, 3, 4, 5, 6).
- **Probar con un pago real** (`docs/PILOT_FIELD_TEST.md`, sección 6): hace falta CardNET y una impresora térmica.
- **Mirar producción** con el SQL de arriba, y recién entonces decidir si se generan los comprobantes viejos.
- La app **Expo** se comprobó solo por tipos (sin dispositivo).
- **Aviso al cliente** cuando su entrega queda atascada: no se hizo (hoy solo se avisa a los administradores).

## Decisiones del usuario (abiertas)

1. Comprobantes retroactivos de los pagos con tarjeta anteriores: **ya se pueden generar de golpe o uno a uno desde la conciliación** (acción explícita con vista previa); falta decidir si se hace, y cuándo, tras mirar producción.
2. ~~¿Un administrador puede cerrar la caja de otro empleado?~~ Ya puede: el cierre no exige ser quien abrió (ver fase 4).
3. Sucursal del pago en línea en el cierre del día (¿`sucursalPagoId` o «En línea»?).
4. Numeración: mismo contador `TCK-` que la caja o serie aparte.
5. Datos de tarjeta en el comprobante: marca y últimos 4 + autorización, nunca el número completo.
6. Doble conteo anterior de ventas de mostrador y del panel en «Total cobrado»: ¿se corrige con la misma guarda? (ver fase 3).
7. Cobros en línea en la caja: ¿los ve toda la empresa o solo la sucursal de quien mira? (hallazgo 8 de la revisión independiente).
8. Cambio de plan pagado con tarjeta: ¿se construye la entrega automática (aplicar el plan con su prorrateo al aprobar el cobro) o se deja a una persona? (hallazgo 1b).

## Reglas de la corrección

- Un solo libro: todo cobro, venga de donde venga, deja una `Transaction` `SALE` con su método real.
- La venta nace con la activación y es idempotente por intento (`pagoIntentoId` único).
- La conciliación señala y lleva a la acción; **no corrige dinero por su cuenta**.
- Nunca el número de tarjeta: marca, últimos 4, autorización y referencia de la pasarela.
