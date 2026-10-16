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

**Qué NO se sabe sin mirar producción:** cuántos de esos 9 son de H5 y cuántos entregas atascadas reales. Se
distinguen con una consulta de solo lectura (membresía activa + `fechaPago ≥ activadoAt` ⇒ H5; membresía sin
activar ⇒ atascado real).

## Plan por fases

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Pruebas de caracterización (H1–H7) | ✅ |
| 1 | Migración aditiva (`20261053`, `20261054`): `MetodoCobroTipo.TARJETA`, `Transaction.pagoIntentoId` único con CHECK y disparador, `PagoIntento.canal`, backfill demostrable del cumplimiento, módulo puro del comprobante | ✅ (`tests/postgres/pagos-tarjeta-modelo.db.test.ts`, `tests/comprobante-tarjeta.test.ts`) |
| 2 | Registrar la venta (`SALE`, método `TARJETA`, canal app/web/renovación) justo después de entregar; idempotente y autorreparable; bitácora `PAGO_APROBADO` con método, canal e intento | ✅ (`tests/postgres/pagos-venta-tarjeta.db.test.ts`; H1 y H4 invertidos) |
| 3 | Comprobante visible e imprimible: Facturas/Registros con filtro «Tarjeta», ficha del cliente, caja («cobros en línea del día», fuera del arqueo), cuadre y cierre, recibo para el cliente (app, web y BFF) | ✅ (pruebas PG, unitarias y E2E; ver abajo) |
| 4 | Conciliación accionable: lista de casos por hallazgo, «Generar comprobante», «Reintentar entrega», «Marcar entregada», cajas abiertas; regla de entrega que mire `FALLIDA`/`PROCESANDO` atascados y no cuente lo ya entregado | pendiente |
| 5 | Cron de reintento de entregas con aviso a administradores | pendiente |
| 6 | Backfill de comprobantes retroactivos (solo si se aprueba) y cierre | pendiente |

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

## Decisiones del usuario (abiertas)

1. Comprobantes retroactivos de los pagos con tarjeta anteriores: automáticos (evidencia inequívoca) o uno a uno.
2. ¿Un administrador puede cerrar la caja de otro empleado?
3. Sucursal del pago en línea en el cierre del día (¿`sucursalPagoId` o «En línea»?).
4. Numeración: mismo contador `TCK-` que la caja o serie aparte.
5. Datos de tarjeta en el comprobante: marca y últimos 4 + autorización, nunca el número completo.
6. Doble conteo anterior de ventas de mostrador y del panel en «Total cobrado»: ¿se corrige con la misma guarda? (ver fase 3).

## Reglas de la corrección

- Un solo libro: todo cobro, venga de donde venga, deja una `Transaction` `SALE` con su método real.
- La venta nace con la activación y es idempotente por intento (`pagoIntentoId` único).
- La conciliación señala y lleva a la acción; **no corrige dinero por su cuenta**.
- Nunca el número de tarjeta: marca, últimos 4, autorización y referencia de la pasarela.
