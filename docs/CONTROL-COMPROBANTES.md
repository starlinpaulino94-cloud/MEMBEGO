# Control total de registros, comprobantes y caja — Investigación

> Qué existe hoy, qué falta y cómo cerrarlo, para que **todo lo que pasa en la
> app deje un registro y un comprobante imprimible y reimprimible**: ventas,
> pagos (transferencia o sucursal), promociones, regalos, ofertas VIP, ruleta,
> y el **cuadre de caja** por turno/día con sus reportes.

Fecha: 2026-07-20 · Solo investigación — **no se implementó nada todavía**.

---

## 1. Resumen ejecutivo

La buena noticia: **la base ya está construida y es sólida**. Existe un
**libro mayor de transacciones** (`Transaction`) que registra operaciones con
código único, ticket, monto, método de cobro, empleado, sucursal, cliente,
"foto" congelada de la operación (snapshot), historial de estados e **historial
de impresiones** (original vs copia). Existe **caja por turno** (`CajaSesion`)
con apertura, cierre y arqueo de efectivo. Y existe impresión en **térmica
(58/80 mm) y hoja (Carta/A4)** con plantilla configurable por empresa.

El problema no es la cañería, es la **cobertura**: hay flujos que **entregan
algo a un cliente pero NO generan comprobante ni registro en el libro mayor**
(Regalos VIP, Ruleta, regalos gratis), el **cierre de caja no es imprimible ni
se guarda como documento**, y **no hay un "libro de registros" único** donde el
admin vea y reimprima *todo* (no solo las ventas).

**Los 10 huecos** (detalle en §3), de mayor a menor prioridad:

| # | Hueco | Impacto | Prioridad |
|---|-------|---------|-----------|
| **G1** | Regalos VIP no generan comprobante ni registro en el libro mayor | Alto | **P0** |
| **G2** | Ruleta de premios no genera comprobante ni registro | Alto | **P0** |
| **G3** | No hay "comprobante de entrega" para regalos/beneficios **gratis** (monto 0) | Alto | **P0** |
| **G4** | El **cierre de caja (cuadre) no es imprimible** ni se guarda para reimprimir | Alto | **P0** |
| **G5** | El arqueo solo cuenta EFECTIVO y solo lo de la sesión: los pagos por transferencia confirmados en el panel **no entran al cuadre** | Alto | **P1** |
| **G6** | No hay **recibo de pago** enfocado en el pago (banco, referencia, quién validó) — solo factura de venta | Medio | **P1** |
| **G7** | No hay un **"Registros/Comprobantes" único** en el panel para ver y reimprimir *todo* (hoy Facturas solo muestra ventas `SALE`) | Alto | **P1** |
| **G8** | Falta **numeración por tipo de documento** (factura vs comprobante de entrega vs recibo de pago vs cierre) y decisión sobre comprobante fiscal (NCF) | Medio | **P2** |
| **G9** | **Movimientos de caja** intra-turno (retiro/sangría, ingreso de fondo) no existen → el cuadre real de efectivo es incompleto | Medio | **P2** |
| **G10** | **Reportes imprimibles/exportables** (ventas por día/turno/empleado/método/sucursal, histórico de cierres) | Medio | **P2** |

Extras que también faltan y conviene decidir (§4): anulaciones con **nota de
anulación** imprimible, **devoluciones/reembolsos**, **pago mixto**
(efectivo + transferencia en una venta), **propinas**, y que el **cliente**
pueda ver/descargar sus comprobantes.

---

## 2. Qué YA existe (para no reconstruir)

### 2.1 Libro mayor de transacciones — `Transaction`
Fuente: `prisma/schema.prisma` (model `Transaction`), `src/lib/transactions/*`.

- `codigo` (TX-YYYYMMDD-NNNNNN) + `ticketNumero` (TCK-000123) secuenciales.
- `tipo`: `MEMBERSHIP_REDEMPTION`, `PROMOTION_USE`, `BENEFIT_USE`,
  `REWARD_REDEMPTION`, `COUPON_USE`, `POINTS_SPEND`, `REFERRAL`, `SALE`,
  `PURCHASE`, `OTHER`. **Ya contempla regalos y beneficios** (aunque no se usan).
- `estado` (PENDING…APPLIED/CANCELLED/REVERTED), `monto`, `metodoCobro`
  (EFECTIVO/TRANSFERENCIA/OTRO).
- `snapshot` (Json): etiquetas congeladas (cliente, servicio, líneas, totales…)
  → el comprobante no cambia aunque cambien los datos maestros.
- `empleadoId`, `sucursalId`, `clienteId`, `cajaSesionId`.
- `transiciones` (historial de estados) + `impresiones` (**`ReceiptImpresion`**:
  cada impresión, original vs copia, numerada, con empleado y motivo).

### 2.2 Impresión de comprobantes
- `src/components/facturas/FacturaSheet.tsx` — factura hoja **Carta/A4** (logo,
  datos, líneas, totales, QR).
- `src/components/scanner/ReceiptTicket.tsx` — ticket **térmico 58/80 mm**.
- `src/components/scanner/ComprobanteReceipt.tsx` — comprobante de visita (QR).
- `src/components/admin/ReceiptTemplateEditor.tsx` + `src/lib/receipts` —
  **plantilla configurable por empresa** (encabezado/pie, formato).
- `FacturaPrintDialog` — vista previa + reimpresión sin generar documento nuevo.

#### Un solo canal de impresión: `AreaDeImpresion` (16-10-2026)
Auditoría del mostrador: los tickets "se veían bien en la vista previa pero
salían mal impresos", y a veces **3 o 4 páginas** por un solo toque. Medido con
la app real en papel de 80 mm (`tests/e2e/zz-impresion-diagnostico`, PDFs):

| Superficie | Antes | Causa medida |
|---|---|---|
| Ticket del escáner (reimpresión TX) | 3 páginas; recortado por la derecha (x=41 px, borde 343 > 302 px) | `body * { visibility: hidden }` deja el panel ocupando 1 672 px de alto; la región `position: absolute` se anclaba al envoltorio `animate-scale-in` (conserva `transform`) |
| Factura 80 mm desde caja | 3 páginas **idénticas**; cortada por abajo | vive dentro de `DialogContent` (`position: fixed` → se repite en cada página); `overflow-y: auto` del diálogo recorta; `overflow: hidden` del bloqueo de scroll |
| Cuadre del día / cierre de caja | 3 páginas | mismo patrón que la factura |
| Todos | columna derecha perdida en el papel | se pintaba a 80 mm; una térmica de 80 mm imprime **72 mm** útiles (58 → 48 mm) |
| Reimpresión del escáner | copia sin «COPIA #N» | `window.print()` con `setTimeout(0)`: el banner aún no estaba pintado |

Ahora **todo ticket pasa por `src/components/impresion/AreaDeImpresion.tsx`**:
- Portal colgado directamente de `<body>` (fuera de diálogos, `transform` y
  `overflow`); al imprimir, el resto de hijos de `<body>` pasa a
  `display: none` (sin altura → **una página**), solo mientras dura la
  impresión (`body[data-imprimiendo]`). En pantalla el área nunca se ve.
- Imprime cuando se incrementa `solicitud`, **después** del commit de React y
  con QR/logo decodificados: lo que sale es exactamente lo que hay en el DOM.
- Ancho del contenido = ancho útil del papel (`ANCHO_IMPRIMIBLE_MM`: 80→72,
  58→48). Las vistas previas enseñan el rollo con sus márgenes y el contenido
  mide lo mismo que en el papel.
- Rollos: `@page { size: auto; margin: 0 }` (manda el driver); Carta/A4 fijan
  tamaño y 12 mm de margen.
- `COPIA #N` sale del número que devuelve `registrarImpresionTx` (servidor), no
  de un contador local.

Guardas: `tests/impresion-tickets.test.ts` (nadie más llama a `window.print`
ni escribe su `@media print`) y `tests/e2e/impresion-tickets.spec.ts` (mide en
el navegador: una página, ticket en el origen, 72 mm, QR cargado). Los reportes
A4 del panel (`ReporteImprimible`) son otro producto y siguen su propio camino.

#### Pagos con tarjeta dejan recibo, y el cliente lo imprime (16-10-2026)
El negocio reportaba «el comprobante de pago no me aparece». Causa: los pagos
con tarjeta (CardNET desde la web y la app, y la renovación automática con
tarjeta guardada) activaban la membresía o la compra **sin crear la
`Transaction`** —solo la caja y la confirmación manual del panel llamaban a
`registrarVentaConfirmada`—, así que no existía nada que imprimir en Facturas
ni en el escáner, y el cliente tampoco tenía recibo.

- **Un solo camino para la venta del cobro.** La escribe `asegurarVentaDelIntento`
  (`src/modules/pagos/venta-tarjeta.ts`): venta `SALE` con método `TARJETA`,
  **única por `pagoIntentoId`** (índice único del libro), con canal, autorización
  y, en una renovación inmediata, marca y últimos cuatro. Se llama tras cada
  entrega: `intentos.ts` (al entregar, al repetir y al reintentar) y la
  renovación automática en `cardnetTokenGuardado.ts`. Webhook + retorno del
  navegador = una sola venta. Nunca lanza. Las transferencias no pasan por ahí
  (las confirma el admin y ese camino ya deja recibo). Diseño completo en
  `docs/PAGO_TARJETA_COMPROBANTE.md`.
- *Historia.* Una primera versión (`reciboPasarela.ts`, venta `OTRO` con el
  intento en el snapshot) se retiró al fusionarla con el libro de tarjeta:
  dos caminos para el mismo cobro serían dos ventas del mismo dinero. Una venta
  que aquel camino ya hubiera escrito se **adopta** (se le enlaza el cobro y pasa
  a `TARJETA`), no se duplica.
- **El cliente imprime su comprobante.** `getClientePagos` devuelve
  `comprobantes` (todas sus ventas aplicadas) y enlaza cada pago aprobado del
  historial con su venta (`transaccionId`: exacta por el cobro si fue con tarjeta,
  por membresía y cercanía de fecha en los demás pagos). Web: «Mis pagos → Comprobantes de
  pago → Imprimir» (`/cliente/pagos/comprobante/[id]`, con sesión y propiedad
  verificada por `ticketParaCliente`). App: pide un **enlace firmado y caduco**
  (`GET /api/v1/cliente/comprobantes/[id]/enlace`, HMAC en
  `enlaceComprobante.ts`, 20 min) y lo abre en el navegador del teléfono
  (`/comprobante/[token]`), que es quien imprime o guarda el PDF. Ambas vistas
  usan `FacturaSheet` por `AreaDeImpresion` (una página Carta).
- Pruebas: `tests/comprobante-cliente.test.ts` (firma/caducidad del enlace,
  guardas estructurales), `tests/postgres/comprobante-cliente.db.test.ts`
  (una venta por cobro, adopción del recibo anterior, «Mis pagos» enlazado por
  el cobro, propiedad) y
  `tests/e2e/comprobante-cliente.spec.ts` (web con sesión y app con enlace;
  una página Carta; enlace manipulado → 404).

### 2.3 Caja por turno — `CajaSesion`
Fuente: `src/modules/caja/*`, `src/components/caja/CajaForms.tsx`, `/empleado/caja`.
- `abrirCaja` (balance inicial, turno, sucursal, responsable).
- `cobrarOrden` (cobra membresías/compras pendientes → crea `Transaction` SALE
  ligada a la sesión, imprime ticket/factura).
- `cerrarCaja` (**arqueo**: esperado = inicial + cobros en efectivo; diferencia
  faltante/sobrante; queda en `AuditLog`).
- `getResumenSesion`: totales por método (efectivo/transferencia/otro) + últimos
  cobros del turno, con estado "ya impresa → siguiente sale COPIA".

### 2.4 Pagos confirmados desde el panel
`src/modules/pagos/venta.ts` (`registrarVentaConfirmada`): cuando el admin
confirma un pago / aprueba una compra fuera de caja, **sí crea una
`Transaction` SALE** con factura reimprimible. (Pero con `cajaSesionId: null`
— ver G5.)

### 2.5 Otros
- `Comprobante` (model aparte): comprobante **de visita** (escaneo QR), con
  número e impresiones. Convive con `ReceiptImpresion` (herencia histórica).
- `AuditLog`: bitácora **técnica** inmutable (quién hizo qué, IP, user-agent).
- `/admin/facturas`: buscar y **reimprimir**, pero **solo transacciones
  `tipo: SALE`**.
- `/admin/reportes`: resumen del mes + "empleados con más operaciones"
  (en pantalla, no imprimible).

---

## 3. Los huecos, en detalle

### G1 · Regalos VIP no dejan comprobante ni registro (P0)
`src/modules/ofertas/actions.ts` → `registrarUsoOferta` solo hace
`ofertaUso.create`. **No** crea `Transaction`, **no** genera comprobante
imprimible y **no** aparece en el libro mayor. Un "12 lavados gratis" se
entrega sin papel ni rastro contable.
**Cierre propuesto:** al registrar un uso de oferta VIP, crear una
`Transaction` (`tipo: BENEFIT_USE`, `monto: 0` o valor del regalo) + emitir un
**comprobante de entrega** imprimible y reimprimible.

### G2 · Ruleta de premios no deja comprobante ni registro (P0)
`src/modules/gamificacion/ruletaActions.ts` → `girarRuleta` solo hace
`ruletaJugada.create`. Un premio ganado/canjeado no produce comprobante.
**Cierre propuesto:** al ganar/canjear un premio, crear `Transaction`
(`tipo: REWARD_REDEMPTION`) + comprobante de entrega.

### G3 · Falta el "comprobante de entrega" para lo GRATIS (P0)
Hoy solo las ventas pagadas (`SALE`) generan factura, y las visitas QR generan
su `Comprobante`. Los **regalos, beneficios y promos gratis** (monto 0) no
tienen un documento imprimible/guardado. El pedido del negocio es explícito:
*"todo lo que se le dé a un cliente debe generar un comprobante que se pueda
imprimir y quede guardado por si hay que reimprimir"*.
**Cierre propuesto:** una plantilla de **"Comprobante de entrega / beneficio"**
(sin precio, con lo entregado, cliente, empleado, fecha, folio y QR) reutilizando
`ReceiptImpresion` para el control de reimpresión. Sirve para G1, G2 y promos
gratis / regalos de bienvenida.

### G4 · El cierre de caja no es imprimible ni se guarda (P0)
`cerrarCaja` calcula la diferencia y la manda a `AuditLog`, pero **no hay
reporte de cierre imprimible** (estilo "Reporte Z") ni un documento de cierre
que se pueda **reimprimir** después. El arqueo se ve en pantalla y se pierde.
**Cierre propuesto:** persistir el cierre (ya está `CajaSesion` con los
totales) y generar un **reporte de cierre imprimible**: apertura, cobros por
método, por tipo, **por empleado**, esperado vs contado, diferencia,
observaciones y firma. Reimprimible desde caja y desde el panel.

### G5 · El arqueo ignora transferencias del panel y no separa por empleado (P1)
- `getResumenSesion`/`cerrarCaja` filtran por `cajaSesionId` y el esperado solo
  suma **EFECTIVO**. Los pagos por **transferencia confirmados en el panel**
  (`venta.ts`, `cajaSesionId: null`) **no entran a ninguna sesión** → el
  "cuadre de todo lo que hizo esa persona ese día/turno" los omite.
- El arqueo no desglosa por **empleado** (un turno puede tener varios) ni por
  **tipo** de operación.
**Cierre propuesto:** (a) un **reporte por empleado / por día** independiente de
la caja que incluya **todas** las transacciones (efectivo + transferencia +
panel); (b) opción de **atar** las confirmaciones de transferencia del panel a
la sesión de caja abierta, o mostrarlas en una sección "transferencias del día"
del cierre.

### G6 · Falta un "recibo de pago" enfocado en el pago (P1)
La transferencia genera una factura `SALE`, pero no un **recibo de pago** con
los campos del pago: banco, **número de referencia**, comprobante que subió el
cliente, y **quién lo validó**. El negocio lo pide para transferencias y pagos
en sucursal.
**Cierre propuesto:** plantilla **"Recibo de pago"** que la persona que aplicó
el pago pueda imprimir, con esos campos (parte ya vive en el snapshot).

### G7 · No hay un "Registros/Comprobantes" único en el panel (P1)
`/admin/facturas` solo lista `tipo: SALE`. No existe una vista que muestre
**todas** las transacciones (ventas, canjes, regalos, beneficios, referidos,
visitas) filtrable por cliente/fecha/tipo/empleado/sucursal, con **reimpresión**
de cada comprobante.
**Cierre propuesto:** módulo **"Registros"** (o ampliar Facturas) sobre `Transaction`
de todos los tipos + reimpresión unificada.

### G8 · Numeración por tipo de documento y comprobante fiscal (P2)
Hoy hay `TCK-xxx`/`TX-xxx`, pero mezcla conceptos. Conviene **series por tipo**
(Factura, Comprobante de entrega, Recibo de pago, Cierre) y **decidir** si hace
falta **NCF / comprobante fiscal** (RD) o basta con folios internos.
→ **Necesita decisión del negocio** (ver §5).

### G9 · Movimientos de caja intra-turno (P2)
`CajaSesion` solo tiene balance inicial y final; **no hay retiros/sangrías ni
ingresos de efectivo** a mitad de turno. Sin eso, el arqueo de efectivo real es
incompleto (si sacan efectivo para un gasto, el esperado no cuadra).
**Cierre propuesto:** modelo `MovimientoCaja` (RETIRO/INGRESO, monto, motivo,
empleado) y ajustar el esperado del arqueo.

### G10 · Reportes imprimibles/exportables (P2)
`/admin/reportes` es del mes y en pantalla. El negocio pide **imprimir los
reportes correspondientes**: ventas por **día/turno/empleado/método/sucursal**,
histórico de **cierres de caja**, entregas de regalos.
**Cierre propuesto:** reportes con rango de fechas, imprimibles y exportables
(CSV/PDF), reutilizando la plantilla de impresión.

---

## 4. Funciones que "se estaban dejando fuera"

- **Nota de anulación / reverso imprimible.** `Transaction` ya soporta
  CANCELLED/REVERTED, pero no hay documento de anulación ni ajuste visible en el
  arqueo cuando se anula un cobro.
- **Devoluciones / reembolsos** (con su comprobante y su efecto en caja).
- **Pago mixto** (parte efectivo, parte transferencia en una sola venta): hoy
  `Transaction.metodoCobro` es único.
- **Propinas** (si aplica al rubro).
- **Cliente puede ver/descargar sus comprobantes** en `/cliente/historial`
  (hoy no los muestra).
- **Copia por correo/WhatsApp** del comprobante (además de imprimir).

---

## 5. Decisiones que necesito de ti (antes de implementar)

1. **Comprobante fiscal:** ¿necesitas **NCF** (comprobante fiscal DGII, RD) en
   las facturas, o basta con **folios internos** por ahora? (Afecta G8 y el
   diseño de las plantillas.)
2. **Regalos gratis:** el comprobante de entrega, ¿lo imprime el **empleado al
   entregar** (en el mostrador) y/o queda disponible para el **cliente**?
3. **Transferencias del panel:** ¿prefieres que se **aten a la caja abierta**
   de la sucursal, o que vivan en un **reporte por persona/día** aparte del
   cuadre físico de efectivo?
4. **Alcance de "todo genera comprobante":** ¿incluimos también las **visitas
   normales** (uso de membresía por QR) que ya tienen su `Comprobante`, o solo
   unificamos ventas + pagos + regalos/beneficios?
5. **Anulaciones y devoluciones:** ¿entran en esta ronda o las dejamos para una
   fase posterior?

---

## 6. Propuesta de implementación por fases (para cuando aprons)

**Fase 1 — "Todo deja comprobante" (P0)** ✅ aplicada
- Emitir `Transaction` + comprobante de entrega en **Regalos VIP** (G1),
  **Ruleta** (G2) y regalos/promos gratis (G3).
- Plantilla **"Comprobante de entrega / beneficio"** (sin precio) reutilizando
  `ReceiptImpresion`.

> **✅ Fase 1 aplicada — con una precisión de la investigación:** al implementar
> se confirmó que los premios de **Ruleta** y los **regalos de bienvenida** van
> al *wallet* del cliente y su **entrega real se canjea en el mostrador vía
> `confirmarCanjePromocion`, que YA crea una `Transaction` con recibo**
> (`PROMOTION_USE`). Es decir, G2 y G3 ya estaban cubiertos *en el momento de la
> entrega* — emitir otro comprobante al ganar/otorgar habría duplicado. El único
> hueco real de "entrega sin comprobante" era **G1: el uso de un Regalo VIP**
> (`registrarUsoOferta`, que usa `OfertaUso` y no pasa por ese camino).
>
> Lo implementado:
> - Helper reutilizable `registrarEntregaBeneficio`
>   (`src/modules/transacciones/entrega.ts`): registra la entrega gratuita en el
>   libro mayor (`Transaction`, tipo `BENEFIT_USE`/`REWARD_REDEMPTION`, monto 0,
>   sin método de cobro) y nunca bloquea la operación si falla.
> - **Regalo VIP** (`registrarUsoOferta`): al registrar el uso, emite la
>   transacción y devuelve su id.
> - **Comprobante de entrega**: nuevo modo `esEntrega` en el motor de recibos
>   (banner "COMPROBANTE DE ENTREGA · Sin valor comercial", sin importes),
>   propagado por `TicketPayload`/`obtenerTicket`/`ReceiptTicket`.
> - **Impresión al entregar**: botón "Imprimir comprobante" en el canje VIP,
>   reimprimible con la misma maquinaria (`ReceiptImpresion` marca original vs
>   copia). Verificado con tsc, eslint y `next build`.
>
> Queda como mejora opcional (decisión de producto) una **"constancia de premio
> ganado/regalo otorgado"** en el momento del *otorgamiento* (no de la entrega),
> si el negocio quiere un papel también al ganar la ruleta.

**Fase 2 — Caja completa (P0/P1)** — ✅ *Completa.*
- ✅ **Reporte de cierre imprimible y reimprimible** (Z-report) con desglose por
  método/tipo/empleado (G4).
- ✅ **Reporte por empleado/día** que incluye transferencias del panel (G5).
- ✅ **Recibo de pago** para transferencias y pagos en sucursal (G6).

> **✅ G4 implementado.** El cierre de caja ahora es un reporte imprimible y
> reimprimible (arqueo "Z"):
> - **Consultas** (`src/modules/caja/queries.ts`): `getCierreReporte()` arma el
>   reporte de una sesión (datos del turno + cobros de la sesión desglosados por
>   método, por tipo de operación y por empleado, más el arqueo de efectivo);
>   `getCierresRecientes()` lista los últimos cierres para reimprimir.
> - **Acción** (`src/modules/caja/actions.ts`): `obtenerCierre()` (protegida con
>   `staffAutorizado`) devuelve el reporte serializado.
> - **UI** (`src/components/caja/CierreCajaDialog.tsx`): vista previa 80 mm
>   (idéntica a la impresión); desde el 16-10-2026 imprime por
>   `AreaDeImpresion` (ver §2.2), ya no con un `@media print` propio.
>   Se ofrece en **Caja** (`/empleado/caja`) como lista **"Cierres recientes"**,
>   que sobrevive a la revalidación tras cerrar el turno (imprimir al cerrar y
>   reimprimir cuando se necesite). Verificado con tsc, eslint y `next build`.
>
> **✅ G5 implementado.** Cuadre del día **por empleado**, imprimible y
> reimprimible, que suma TODOS los cobros que aplicó ese día —con o sin caja
> abierta—, **incluidas las transferencias/pagos confirmados desde el panel**
> (que no pasan por una `CajaSesion`):
> - `getReporteEmpleadoDia()` (`src/modules/caja/queries.ts`) agrega los cobros
>   del empleado en el día (rango calculado en la zona horaria de la empresa) por
>   método, por tipo y **por origen** (caja vs panel/transferencia). Helpers
>   `hoyLocal()` y cálculo de rango con offset de zona horaria (sin dependencias).
> - `obtenerReporteDia()` (`src/modules/caja/actions.ts`, `staffAutorizado`)
>   devuelve el cuadre del empleado autenticado para hoy (o una fecha dada).
> - `ReporteDiaDialog` (`src/components/caja/ReporteDiaDialog.tsx`): botón
>   **"Mi cuadre del día"** en `/empleado/caja` (con y sin caja abierta), vista
>   previa 80 mm e impresión aislada (`.reporte-dia-print`).
>
> **✅ G6 implementado.** El comprobante ahora funciona como **recibo de pago**:
> muestra la forma de pago y su **referencia/banco** además de quién validó.
> - El builder (`src/lib/receipts/domain/builder.ts`) imprime un bloque de pago
>   (`Pago` + `Referencia`) cuando hay datos; `ReceiptTransaccionInfo` gana los
>   campos `metodoPago`/`referenciaPago`, propagados por `obtenerTicket`.
> - `registrarVentaConfirmada` acepta `referenciaPago` y lo guarda en el snapshot;
>   `confirmarPago` (membresías) lo arma con el nombre del método/banco + la nota
>   del comprobante del cliente, y `aprobarCompra` (promociones) con la nota de
>   referencia. La factura Carta/A4 (`FacturaSheet`) añade la fila "Referencia".
>
> Con esto la **Fase 2 queda completa** (G4 + G5 + G6). Sigue la Fase 3
> (registros/comprobantes unificados y reportes exportables).

**Fase 3 — Registros y reportes (P1/P2)** — ✅ *Completa.*
- ✅ Módulo **"Registros/Comprobantes"** unificado con reimpresión (G7).
- ✅ **Reportes imprimibles/exportables** (G10).

> **✅ G7 + G10 implementados.** Nueva sección **Registros y comprobantes**
> (`/admin/registros`, nav en *Ingresos* → "Registros"; sección `registros` en
> `permissions.ts`, accesible a admin pleno y SUPERVISOR):
> - **Vista unificada** de TODAS las transacciones del ledger (ventas, usos de
>   membresía, promociones, beneficios, canjes, referidos…), no solo ventas como
>   `/admin/facturas`. `getRegistros()` (`src/modules/registros/queries.ts`)
>   aplica filtros por **texto** (nº/código/cliente), **tipo**, **estado**,
>   **método** y **rango de fechas** (calculado en la zona horaria de la empresa)
>   y devuelve además un **resumen** agregado (ingresos aplicados, conteo, por
>   método y por tipo).
> - **Reimpresión** de cualquier comprobante desde la tabla con la misma
>   maquinaria (`FacturaPrintDialog` → `obtenerTicket`, marca original/COPIA).
> - **Exportar CSV (G10):** ruta `/admin/registros/export` (route handler con
>   auth admin + aislamiento por companyId) que respeta los mismos filtros y
>   descarga `registros-YYYY-MM-DD.csv` (BOM para Excel es-DO), vía
>   `registrosToCsv()`.
> - **Imprimir reporte (G10):** bloque imprimible con resumen + listado, aislado
>   por `@media print` (`ImprimirReporteButton`).
>
> Sobre la **Decisión §4 (¿incluir visitas normales por QR?)**: se resolvió
> mostrándolo TODO por defecto pero **filtrable por tipo** — las visitas
> (`MEMBERSHIP_REDEMPTION`) aparecen y se pueden ocultar filtrando a
> ventas/pagos; nadie pierde información y el que quiere el cuadre financiero
> filtra. Verificado con tsc, eslint y `next build`.

**Fase 4 — Precisión contable (P2)** — ✅ *Completa (sin NCF).*
- ✅ Numeración por folios internos (G8) — **sin NCF fiscales** (decisión del
  negocio): se mantiene TCK-###### (ticket) + TX-YYYYMMDD-###### (transacción),
  secuenciales y únicos por empresa/día.
- ✅ **Movimientos de caja** intra-turno (G9).
- ✅ **Anulaciones/devoluciones** (§4).
- ✅ **Pago mixto** (efectivo + transferencia en un solo cobro).

> **✅ Pago mixto implementado.** En el cobro de caja hay un cuarto método,
> **Mixto**: el cajero escribe la parte en efectivo y la parte por
> transferencia se deriva del total (las partes siempre suman exacto; se
> valida también en el servidor contra el monto real de la orden, antes de
> activar). Se registra **una transacción SALE por cada parte** — misma
> orden, mismo instante, con `pagoMixto`, el total real y referencia cruzada
> al comprobante de la otra parte en el snapshot — de modo que el arqueo de
> efectivo, el cierre Z, los Registros y el cuadre por empleado cuadran sin
> reglas especiales, y cada parte se puede reimprimir o anular por separado.

> **✅ G8 (folios internos).** El negocio **no emite NCF fiscales**, así que la
> numeración interna existente es la definitiva: cada comprobante lleva
> `TCK-######` y su transacción `TX-YYYYMMDD-######` (contadores atómicos, nunca
> se reutilizan). No hizo falta cambio de esquema.
>
> **✅ G9 (movimientos de caja intra-turno).** Entradas (aporte de fondo) y
> salidas (retiro, gasto, pago a proveedor) dentro del turno, que **no son
> cobros** pero afectan el efectivo:
> - Esquema: modelo `MovimientoCaja` + enum `MovimientoCajaTipo (ENTRADA/SALIDA)`
>   ligado a `CajaSesion` (migración `20260751_movimientos_caja`, idempotente).
> - Acción `registrarMovimientoCaja` (caja abierta, monto/concepto, auditado).
> - **Arqueo corregido:** `cerrarCaja` ahora calcula
>   `esperado = inicial + cobros efectivo + entradas − salidas`; el efectivo
>   esperado en pantalla también incluye el neto de movimientos.
> - UI `MovimientosCaja` en `/empleado/caja` (form + lista con neto) y el bloque
>   **MOVIMIENTOS DE EFECTIVO** en el reporte de cierre imprimible.
>
> **✅ Anulaciones/devoluciones.** `anularTransaccion(id, motivo)` (admin, motivo
> obligatorio) pasa una transacción APLICADA a **CANCELLED** con transición y
> auditoría; al salir de APPLIED deja de sumar en cierres, cuadres y reportes.
> Botón **Anular** en cada registro aplicado de `/admin/registros`. No revierte
> automáticamente efectos de negocio (p. ej. activación de membresía) — esa
> corrección es una acción aparte, a propósito.
>
> **Pago mixto** (parte efectivo + parte transferencia en un mismo cobro) queda
> como mejora **opcional**: es invasiva a `cobrarOrden` y de baja frecuencia; se
> hará si el negocio lo pide. Con lo demás, **las 4 fases del Control de
> comprobantes quedan completas.**

Recomendación: **empezar por la Fase 1** — es la que cumple literalmente el
pedido ("todo lo que se le dé a un cliente debe generar un comprobante") y se
apoya al 100% en la maquinaria que ya existe (`Transaction` + `ReceiptImpresion`
+ plantillas de impresión).

---

## Actualización (2026-10): los pagos con tarjeta de la pasarela también dejan comprobante

Hasta ahora el comprobante solo nacía en la caja y en el panel (`registrarVentaConfirmada`); un pago con tarjeta aprobado en la app
activaba la membresía pero no dejaba ticket, ni factura, ni rastro en Comprobantes/Registros. Ahora la venta nace con la entrega del
cobro (`asegurarVentaDelIntento`): idempotente por `pagoIntentoId`, con la fecha del cobro y la etiqueta «Tarjeta … (en la app)».
Se ve y se imprime en Comprobantes («Pagos con tarjeta»), Registros, la caja, el cuadre, el cierre, la ficha del cliente y, para
el cliente, en «Mis pagos». Un cron diario repara los que falten y avisa de lo que no se pueda entregar. Ver
`docs/PAGO_TARJETA_COMPROBANTE.md`.

