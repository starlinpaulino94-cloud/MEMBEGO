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
| 1 | Migración aditiva: `MetodoCobroTipo.TARJETA`, `Transaction.pagoIntentoId` único, backfill demostrable del cumplimiento | pendiente |
| 2 | Registrar la venta (`SALE`, método `TARJETA`, canal app/web/renovación) en el punto único de activación, dentro de la misma transacción; bitácora con método y ticket | pendiente |
| 3 | Comprobante visible e imprimible: Facturas/Registros con filtro «Tarjeta», ficha de la membresía, caja («cobros en línea del día», fuera del arqueo), recibo para el cliente (app y web) | pendiente |
| 4 | Conciliación accionable: lista de casos por hallazgo, «Generar comprobante», «Reintentar entrega», «Marcar entregada», cajas abiertas; regla de entrega que mire `FALLIDA`/`PROCESANDO` atascados y no cuente lo ya entregado | pendiente |
| 5 | Cron de reintento de entregas con aviso a administradores | pendiente |
| 6 | Backfill de comprobantes retroactivos (solo si se aprueba) y cierre | pendiente |

## Decisiones del usuario (abiertas)

1. Comprobantes retroactivos de los pagos con tarjeta anteriores: automáticos (evidencia inequívoca) o uno a uno.
2. ¿Un administrador puede cerrar la caja de otro empleado?
3. Sucursal del pago en línea en el cierre del día (¿`sucursalPagoId` o «En línea»?).
4. Numeración: mismo contador `TCK-` que la caja o serie aparte.
5. Datos de tarjeta en el comprobante: marca y últimos 4 + autorización, nunca el número completo.

## Reglas de la corrección

- Un solo libro: todo cobro, venga de donde venga, deja una `Transaction` `SALE` con su método real.
- La venta nace con la activación y es idempotente por intento (`pagoIntentoId` único).
- La conciliación señala y lleva a la acción; **no corrige dinero por su cuenta**.
- Nunca el número de tarjeta: marca, últimos 4, autorización y referencia de la pasarela.
