# MembeGo · Caja (POS) y pagos presenciales

Sistema de cobros en sucursal con trazabilidad completa, construido SOBRE la
arquitectura existente (no en paralelo): órdenes = `Membership` /
`ProductoCompra` con sus transiciones inmutables; cobros = `Transaction`
(código TX + ticket únicos, snapshot congelado, transiciones); auditoría =
`AuditLog` (insert-only). Preparado para pasarelas y terminales futuras
(`MetodoCobroTipo.OTRO`, `TransactionTipo.SALE`).

## Fase 1 (entregada)

### Esquema (`scripts/supabase-20260747-caja-pos.sql`)
| Pieza | Qué añade |
|---|---|
| `caja_sesiones` | Sesión de caja por sucursal: estado ABIERTA/CERRADA, responsable (abre/cierra), turno, balance inicial/final/esperado, **diferencia** de arqueo, observaciones, fechas. Nunca se elimina. |
| `transactions` | `cajaSesionId`, `monto`, `metodoCobro` (EFECTIVO/TRANSFERENCIA/OTRO) → arqueo y reportes. |
| `memberships` / `producto_compras` | `referencia` única (ORD-XXXXXX) + `sucursalPagoId` (dónde pagará el cliente). |
| `AuditAccion` | `CAJA_ABIERTA`, `CAJA_CERRADA`, `COBRO_REGISTRADO`. |

### Flujo del cliente
1. Elige **"Pagaré en la sucursal"** al pagar un plan (o cambio de plan).
2. Si hay varias sucursales, elige en cuál pagará.
3. Recibe una **referencia única** (`ORD-XXXXXX`) para mostrar en caja.
4. No recibe el beneficio hasta que el cobro se confirme.

### Flujo del empleado (`/empleado/caja`)
1. **Abrir caja**: sucursal + efectivo inicial + turno. Una caja abierta por
   sucursal; sin caja abierta **no se puede cobrar**.
2. **Buscar la orden**: referencia, nombre, teléfono o correo (cola de
   pendientes si no busca nada). Une membresías, cambios de plan y compras
   de promoción.
3. **Cobrar en 2 toques**: forma de pago (efectivo/transferencia/otro) +
   observaciones → confirma el monto.
4. Al confirmar, automáticamente:
   - activa la membresía o la promoción (punto de activación único:
     `activarMembresia` / `activarCompraPromocion` → genera el QR, aplica
     cambio de plan, registra historial y recompensas de referidos);
   - crea la **Transaction SALE** (empleado, sucursal, caja, monto, método,
     observaciones, IP/dispositivo, snapshot congelado, ticket);
   - registra `COBRO_REGISTRADO` en la auditoría;
   - notifica al cliente ("Pago recibido en sucursal").
5. **Resumen del turno**: cobros, efectivo, transferencias, total y últimos
   cobros en vivo.
6. **Cerrar caja**: cuenta el efectivo → el sistema congela el esperado
   (inicial + efectivo del turno) y la **diferencia** (faltante/sobrante).

### Seguridad
- Solo staff `SCANNER_ROLES` de la MISMA empresa (multi-tenant en cada query).
- Cobros bloqueados con caja cerrada; cierre con guard atómico.
- Anti doble-cobro: la activación rechaza estados ya activos.
- Nada se borra: sesiones, transacciones, transiciones y auditoría son
  permanentes; los cambios son solo de estado.

## Fases siguientes (diseñadas, pendientes)

- **F2 · Reportes admin**: ventas por sucursal/caja/empleado/fecha/plan/
  promoción, pagos y transferencias pendientes, exportación. Fuente:
  `Transaction` (SALE) agregada por `cajaSesionId`/`sucursalId`/`empleadoId`.
- **F3 · Timeline del cliente**: línea de tiempo cronológica en la ficha
  (cliente creado → compró → pagó → QR generado → escaneado → consumido →
  renovó → invitó → ganó). Fuente: unión de `AuditLog` + `Transaction` +
  `ProductoCompraTransicion` + `ReferralEvent` — los datos YA existen.
- **F4 · Estados extendidos del QR**: el ciclo actual (generado/activo/
  usado + regeneración) ya queda auditado vía `QrToken` + `Transaction` +
  `AuditAccion.QR_*`; se añadirán BLOQUEADO/FRAUDE con reglas del
  anti-abuso y registro de escaneos rechazados.
- **F5 · Cancelación de cobros con permisos** (REVERTED en Transaction) y
  reembolsos.
- **F6 · Compras de promoción con pago presencial** desde la app del cliente
  (hoy la promo se cobra en caja buscándola; falta el botón "pagaré en
  sucursal" en el flujo de compra de promos, análogo al de planes).

## Operativa para el negocio

1. Ejecutar `scripts/supabase-20260747-caja-pos.sql` en Supabase (idempotente).
2. Crear las sucursales en **Admin → Sucursales** (ya existía).
3. El empleado abre su caja en **Empleado → Caja** cada turno.

## Facturación e impresión (fase actual)

### El documento

Cada cobro de caja **ya es una factura**: la `Transaction` tipo SALE guarda el
número secuencial por empresa (`ticketNumero`, ej. `TCK-000123`), el código
único global (`codigo`, ej. `TX-20260716-000045`), el snapshot congelado con
cliente, **nombre** del empleado, sucursal, caja, método de pago, observaciones
y las **líneas** de detalle (`lineas: [{ descripcion, cantidad, precioUnitario,
descuento, total }]` + `subtotal`/`total`/`metodoCobroLabel`). El snapshot no
se recalcula jamás: reimprimir años después produce el mismo documento.

### Reglas de oro

- **Nunca se elimina una factura** — solo cambian estados
  (APPLIED → Pagada · CANCELLED · REVERTED) y todo queda en `AuditLog`.
- **Documentos comerciales muestran el NOMBRE del empleado, nunca su correo.**
  `staffAutorizado()` (caja), `confirmarVisita` y `confirmarCanjePromocion`
  resuelven `User.name` (fallback: email solo si no hay nombre).
- **Reimprimir reutiliza el documento original**: `registrarImpresionTx`
  marca COPIA #N y audita; no se genera una factura nueva.

### Impresión multi-formato

`FacturaPrintDialog` (usado en **Admin → Facturas**) ofrece:

- **Térmica 58 mm / 80 mm**: mismo motor `buildDocFromPayload` de
  `src/lib/receipts` (reflow por columnas de papel, nada se corta).
- **Carta / A4**: `FacturaSheet` — factura profesional con logo, datos de la
  empresa, RNC, grid cliente/empleado/caja/método, tabla de líneas con
  descuentos, totales, observaciones, QR del código TX y mensaje de pie.
- **Vista previa idéntica a la impresión** antes de imprimir; el bloque
  `.factura-print` aísla el documento con `@page` (size A4/letter o margen 0
  para térmicas).
- Corrección global del recorte: en CSS de impresión se usa
  `position: absolute` + `html,body{height:auto;overflow:visible}` —
  `position: fixed` recorta a UNA página (bug de "facturas cortadas").

### Historial

**Admin → Facturas** (`/admin/facturas`): búsqueda por número de factura,
código TX o cliente; estado, número de impresiones, empleado, total y fecha;
vista previa + impresión/reimpresión auditada por fila. 

### Listo para el futuro

`TicketPayload` ya transporta líneas y método de pago: exportar a **PDF,
correo o WhatsApp** solo requiere renderizar `FacturaSheet`/`ReceiptDoc` en el
canal nuevo — sin tocar datos ni flujo de cobro.

## Caja conectada a Commerce Core (Fase 7)

Con la capacidad `POS_MEMBEGO` (apagada de serie), la caja del turno suma dos bloques que usan el catálogo, las
existencias y los pedidos Membego en vez de órdenes sueltas. El resto de la caja (abrir, cobrar membresías y
promociones, movimientos, arqueo, cierre, tickets) **no cambia**: los cobros nuevos entran al mismo turno, al mismo
arqueo y a la misma lista de «Últimos cobros» con su impresión.

- **Cobrar un pedido Membego.** Quien cobra escanea (o teclea) el QR del cliente. Se ve el pedido y si el cliente
  confirmó el monto; se elige efectivo, transferencia o tarjeta; el pago, el cierre del pedido y el cobro de la caja
  ocurren juntos. Solo en la sucursal del pedido. Un pedido de la vitrina se cierra **solo** con su QR.
- **Venta de mostrador.** Se buscan productos y servicios del catálogo (los que se venden en caja), se arma el
  carrito, se elige al cliente por nombre, teléfono o correo (o queda «sin registro») y se cobra. Las existencias
  bajan; el precio sale siempre del catálogo; pulsar «Cobrar» dos veces no vende dos veces.
- **Referencia.** La transferencia y la tarjeta (número de autorización) la exigen: es el comprobante. El efectivo
  admite «recibido» para calcular el cambio.
- **Qué no hay (todavía):** descuentos manuales, promociones del motor, pago mixto, devolución con reverso del cobro
  en la caja, integración con CardNET. Un reembolso desde `/admin/pedidos-membego` devuelve las existencias pero no
  toca el cobro de la caja.
- **Comisión.** El pedido del marketplace cobrado aquí comisiona como siempre; la venta de mostrador pura no.

Detalle y decisiones: `docs/IMPLEMENTATION_STATUS.md` §3 (F7).
