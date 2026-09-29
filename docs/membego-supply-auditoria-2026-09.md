# MEMBEGO SUPPLY — Auditoría técnica y funcional (FASE 0)

Fecha: **2026-09-29** · Rama: `claude/membego-supply-audit-5woapt`
Método: lectura completa de `prisma/schema/supply.prisma`, las 8 migraciones
`*_supply_*`, los 26 módulos de `src/modules/supply/`, las 21 pantallas, los 12
componentes, el cron, la exportación, las 8 suites de prueba y la infraestructura
compartida (tenant/RLS, RBAC, auditoría, notificaciones, storage). **Nada se marcó
como implementado por existir una tabla, una pantalla o una función**: se
siguió cada flujo desde la acción hasta la escritura en base.

Línea base medida antes de tocar código: typecheck limpio · lint 0 errores ·
3.211 pruebas en verde.

Leyenda: ✅ implementado y verificado · ⚠️ parcial · ❌ no implementado ·
🔴 roto · ⚡ riesgo

---

## 1 · Matriz de requisitos

| # | Requisito (prompt maestro) | Estado | Evidencia | Acción requerida |
| --- | --- | --- | --- | --- |
| §1 | Separación inventario propio / supply / derechos / venta sin precompra / compromisos financieros | ⚠️ | Capas 1-3 separadas (`supply.prisma`, ADR-0001). La venta sin precompra y los compromisos financieros (CxP/CxC) **no existen** como capa | Añadir capa financiera y ventas directas |
| §3 A | Compra anticipada específica (proveedor, item, cantidad, precio, moneda, impuestos, vigencia, sucursales, restricciones, términos) | ✅ | `SupplyAcuerdo` + `SupplyOrden` + `SupplyLote.snapshot*`; `crearAcuerdo`, `crearOrden`, `generarLotes` | — |
| §3 B | **Depósito abierto** (saldo original/usado/disponible, movimientos, facturas relacionadas, apertura, cierre, estado, docs, responsable) | ❌ | `DEPOSITO` es solo un tipo de `SupplyPago` y un asiento. No hay entidad de depósito, ni saldo, ni aplicación a facturas | `SupplyDeposito` + `SupplyDepositoMovimiento` + aplicación a facturas/CxP |
| §4 | Agreement engine: comisión, descuento, plazo, frecuencia de cortes, devoluciones, SLA, método de liquidación, impuestos | ⚠️ | Existen vigencia, sucursales, precio negociado, precio público, subsidio, modalidad de pago, capacidad, reglas de texto. Faltan **comisión %, descuento %, plazo (días), frecuencia de corte, impuesto %, SLA, política de devoluciones, método de liquidación** | Añadir columnas |
| §4 | Estados DRAFT/PENDING/ACTIVE/**SUSPENDED**/EXPIRED/TERMINATED | ⚠️ | `SupplyAcuerdoEstado` sin `SUSPENDIDO` | Añadir estado y transiciones |
| §4 | Versionado sin alterar condiciones históricas | ⚠️ | Enmiendas (`SupplyEnmienda`) con antes/después; lotes congelan snapshot. No hay versión numerada ni snapshot completo del acuerdo | `SupplyAcuerdoVersion` + `version` en acuerdo; liquidaciones referencian la versión |
| §5 A | Proveedor = empresa registrada | ✅ | `Company` + capacidad `MEMBEGO_SUPPLIER` | — |
| §5 B | **Proveedor externo** sin cuenta completa, convertible después sin perder historial | ❌ | Solo aparecen como proveedoras las `Company` activas con la capacidad (`acuerdos/page.tsx`). No hay perfil de proveedor ni alta externa | `SupplyProveedor` (perfil) sobre una `Company` mínima inactiva; conversión = activar la empresa |
| §6 | Purchase order: flujo completo, estados, múltiples items, impuestos, documentos, facturas, pagos parciales | ⚠️ | Líneas múltiples, impuestos, aprobador ≠ creador ✅. `PARCIALMENTE_FONDEADA`/`FONDEADA` existen pero **solo se cambian a mano**; los pagos no fondean la orden; sin facturas ni documentos | Fondeo automático al confirmar pagos con `ordenId`; facturas de proveedor; documentos |
| §7 | Lotes con todas las cantidades, costo, vigencia, restricciones, sin contador mutable | ✅ | 6 cubetas caché + ledger como verdad; `CHECK` de cuadre en base | — |
| §8 | Supply ledger con **previous balance / new balance**, source, destination, actor, timestamp, reference, reason | ⚠️ | Traslado origen→destino, actor, fecha, referencia, motivo ✅. **No guarda saldo anterior ni posterior** | Columnas `saldoAntes`/`saldoDespues` escritas por `registrarMovimientos` |
| §9 | Asignaciones a 11 destinos con ORIGINAL/ALLOCATED/AVAILABLE/RESERVED/REDEEMED/EXPIRED | ✅ | `SupplyAsignacion` + `asignaciones.ts` + `reporteCampanas` | — |
| §10 | FEFO con override administrativo auditado | ⚠️ | `fefo.ts` puro, 4 estrategias; `entregar` la aplica. **No hay override desde la UI ni auditoría del override**; el único consumidor real (`reclamarOfertaAction`) siempre usa el lote de la asignación | Parámetro `estrategia` en emisión manual + bitácora cuando ≠ FEFO |
| §11 | Customer entitlement con usuario, origen, producto, lote, cantidad, fechas, estado, restricciones, sucursales, voucher, QR | ✅ | `SupplyDerecho`, `SupplyVoucher`, `SupplyQrSesion` | — |
| §12 | QR: identifica, valida en servidor, evita doble redención, firma/token, expira, dinámico, guarda dispositivo/empleado/sucursal/fecha | ⚠️ | Nonce 128 bits, 5 min, un solo uso, empleado y sucursal ✅. **No guarda el dispositivo** | Columna `dispositivo` en la sesión de QR (user-agent) |
| §13 | Redención transaccional, sin doble canje por concurrencia | ✅ | `redimir` en una transacción con `FOR UPDATE` sobre el lote + índice único parcial `supply_redenciones_voucher_viva` | — (se añade prueba real de concurrencia) |
| §14 | **Venta sin precompra** → Fulfillment → obligación → settlement | ❌ | `SupplyPedido` es el cobro de una unidad **precomprada**. No existe venta a comisión | `SupplyVentaDirecta` + acuerdo `COMISION` + entrega por escáner + CxP neta |
| §15 | **Cuentas por pagar** con estados OPEN/PARTIALLY_SETTLED/SETTLED/DISPUTED/CANCELLED | ❌ | Solo asientos `REDENCION_POR_PAGAR` en el ledger financiero; sin entidad, vencimiento ni estado | `SupplyCuentaPorPagar` |
| §16 | **Cuentas por cobrar** | ❌ | No existe | `SupplyCuentaPorCobrar` |
| §17 | **Liquidaciones** con estados, líneas y snapshot | ❌ | `proponerLiquidacion` calcula pero **nadie la llama** (código muerto); `SupplyPago` tipo LIQUIDACION es un pago suelto sin líneas ni snapshot | `SupplyLiquidacion` + `SupplyLiquidacionLinea` |
| §18 | **Conciliación Membego vs proveedor** con discrepancias tipadas, investigación, documentos, comentarios, resolución | ❌ | `conciliar()` solo contrasta Membego consigo mismo (contadores vs ledger). No compara con el proveedor, no persiste, no tiene estados | `SupplyConciliacion` + `SupplyDiscrepancia` + `SupplyDiscrepanciaNota` |
| §19 | Incidencias: 11 causas, 7 estados | ⚠️ | 8 tipos, 6 estados. Faltan QR inválido, cantidad incorrecta, derecho vencido, doble redención, fraude, error humano; faltan `ESPERANDO_PROVEEDOR`, `ESPERANDO_CLIENTE`, `RECHAZADA`. No aplican a ventas | Ampliar enums, transiciones y alcance |
| §20 | Vencimientos proactivos: lotes, derechos, depósitos, acuerdos; umbrales 90/60/30/15/7/1 configurables | ⚠️ | Solo lotes (30/14/7/3/1, no configurables) y aviso al cliente por derecho (7/3/1). Sin depósitos ni acuerdos | Umbrales configurables por entorno; alertas de derechos, depósitos y acuerdos |
| §21 | Supplier/Membego/Purchase/Settlement invoice, notas de crédito y débito | ❌ | Nada | `SupplyFacturaProveedor` con tipo (FACTURA/NOTA_CREDITO/NOTA_DEBITO); la liquidación es el documento de corte |
| §22 | Pagos por transferencia/depósito/manual; diseñado para split futuro | ✅ | `SupplyPago` con `metodo` libre; cobro a clientes por transferencia con revisión humana; `PuertoCobroMembego` declarado | — |
| §23 | Dashboard operacional con 16 KPIs + 7 bloques | ⚠️ | 4 KPI + cubetas + vencimientos + proveedores. Faltan depósitos, CxP, CxC, liquidaciones pendientes, incidencias abiertas, redenciones hoy/mes, por categoría, recientes, discrepancias, obligaciones | Ampliar `resumenPool` y la pantalla |
| §24 | 16 reportes con filtros y exportación | ⚠️ | 7 bloques CSV (overview, proveedores, lotes, campañas, redenciones, vencimientos, conciliación interna). Filtros: proveedor, lote, acuerdo, período | Añadir utilización, vencidos, derechos, CxP, CxC, liquidaciones, incidencias, depósitos, rentabilidad, unit economics; filtros de campaña, cliente, sucursal, estado |
| §25 | Unit economics: costó/vendió/regaló/expiró/ingreso/recibió proveedor/retuvo Membego/subsidio/margen | ⚠️ | `economiaUnidad`, `costosDeLote`, `desglosarSubsidio` cubren precompra y subsidio. Falta el modelo a comisión (recibió proveedor / retuvo Membego) y una vista agregada que responda las nueve preguntas | `economiaComision` + bloque de economía global |
| §26 | Auditoría con actor, rol, fecha, tenant, entidad, acción, antes/después, referencia, motivo | ⚠️ | `AuditLog` con 24 acciones `SUPPLY_*`, actor, IP, entidad y payload. Estado anterior solo en enmiendas | Payload con `antes`/`despues` en cambios de estado; acciones nuevas para depósitos, facturas, CxP/CxC, liquidaciones, conciliación, ventas |
| §27 | Autorización real en backend, permisos Supply.* | ✅/⚠️ | Toda action pasa por `exigirPlataforma` o `guardiaProveedor` (server). Los 9 permisos se resuelven contra el RBAC existente (plataforma = SUPERADMIN, proveedor = sección `supply`). Faltan nombres para Settlement/Reconciliation/Adjust/Audit | Ampliar vocabulario y guardias |
| §28 | Concurrencia e idempotencia: doble redención, doble pago, webhooks, escaneo simultáneo, lotes, entitlements, settlement doble | ⚠️ | Lote con `FOR UPDATE`; únicos parciales; `claveIdempotencia` en derechos, redenciones, pagos, pedidos ✅. **Sin prueba automática de carrera**; settlement no existe | Índices únicos en liquidaciones/depósitos; prueba real con dos transacciones contra PG |
| §29 | Integración con campañas, membresías, recompensas, referidos, cupones, pagos, notificaciones | 🔴 | `regalar`, `porMembresia`, `porRecompensa`, `porReferido`, `apartarParaCompra` **no los llama ningún módulo** (`grep` en `src/`). La única entrada real es `reclamarOfertaAction` (marketplace) y la emisión manual | Documentar como puertos; cablear lo que el resto del código ya puede consumir (ver §4 del reporte final) |
| §30 | UX: loading/empty/error, filtros, búsqueda, paginación, acciones, detalle, confirmaciones | ⚠️ | `loading.tsx`/`error.tsx` a nivel de `(superadmin)`. Empty states en todas. Filtros solo en Derechos y Vencimientos. **Sin paginación** (`take: N` fijo). Pestaña «Cobros» ambigua | Finanzas como sección con sub-navegación; filtros/paginación en listados largos |
| §31 | 14 casos de prueba obligatorios | ⚠️ | Cubiertos con aritmética pura: 1, 2, 3, 4, 5, 7, 13. Sin cubrir: 6 (vencido), 8, 9, 10, 11, 12, 14 (concurrencia real) | Pruebas puras nuevas + suite contra PostgreSQL |

## 2 · Hallazgos de código (ROTO / RIESGO)

| # | Hallazgo | Gravedad | Dónde | Efecto |
| --- | --- | --- | --- | --- |
| H1 | El asiento de `REEMBOLSO` lleva signo **negativo** (a favor de Membego) cuando un reembolso es dinero que el proveedor **devuelve**: debe subir el saldo hacia cero, no bajarlo | 🔴 | `finanzas.ts:139` (`signo = tipoAsiento === 'CREDITO' ? 1 : -1`) | Un depósito de 100k reembolsado dejaba el saldo en −200k |
| H2 | `proponerLiquidacion` no se usa desde ninguna pantalla ni action | ⚡ | `finanzas.ts:250`, `grep` en `src/app` | La «liquidación propuesta» de la documentación no existe para el usuario |
| H3 | Los canales de distribución (`regalar`, `porMembresia`, `porRecompensa`, `porReferido`, `porSoporte`, `apartarParaCompra`) no tienen consumidor | ⚡ | `distribucion.ts` | La integración con membresías/recompensas/referidos está declarada, no cableada |
| H4 | Estados de orden `PARCIALMENTE_FONDEADA`/`FONDEADA` solo cambian por acción manual; un pago confirmado no toca la orden | ⚡ | `moverOrden`, `confirmarPago` | La orden puede decir FONDEADA sin un peso pagado y viceversa |
| H5 | `crearOrden` numera con `count()+1`: con dos altas simultáneas la segunda choca con el índice único y **no reintenta** | ⚡ | `procurement.ts:173` | Error esporádico en alta concurrente (poco probable en plataforma, documentado) |
| H6 | `conciliar()` recorre lotes de uno en uno con `take: 200` | ⚡ | `conciliacion.ts:160` | Con miles de lotes habrá que paginar (deuda ya documentada) |
| H7 | Umbrales de vencimiento y de riesgo son constantes; «configurables» del prompt no cumplido | ⚡ | `catalogo.ts:389`, `avisos.ts:395` | — |
| H8 | El listado de proveedores del formulario de acuerdo exige `isActive: true`: un proveedor externo (sin cuenta) no podría contratarse | ⚡ | `acuerdos/page.tsx:60` | Bloquea §5 B |

## 3 · Lo que sí se verificó de extremo a extremo (y se conserva)

`crearAcuerdo` → `moverAcuerdo` → `crearOrden` → `moverOrden(APROBADA, aprobador ≠ creador)` →
`generarLotes` (asiento `COMPRA` + `COMPROMISO_COMPRA`) → `asignar` → `entregar`/`emitirDerecho`
(bloqueo, elegibilidad, ledger, derecho, voucher) → `abrirSesionQr` → `escanearSupplyAction` →
`redimir` (voucher, derecho, sesión, ledger, reserva, `REDENCION_POR_PAGAR` si aplica) →
`reversarRedencion` → `cerrarVencidos` (cron) → `conciliar` (interna) → `resumenPool` /
`reporteCampanas` / `economiaCampana`.

Todo esto queda **intacto**: la implementación nueva extiende el ledger y el
ledger financiero existentes en vez de reescribirlos.

## 4 · Decisión sobre la pestaña «Cobros»

Se sustituye por una sección **Finanzas** con sub-navegación explícita:
**Pagos** (Membego → proveedor) · **Depósitos** · **Facturas de proveedor** ·
**Cuentas por pagar** · **Cuentas por cobrar** · **Liquidaciones** ·
**Cobros a clientes** (cliente → Membego). Cada dominio conserva su entidad y su
signo; la interfaz solo los agrupa. `/superadmin/supply/cobros` redirige.

## 5 · Plan de implementación (fases 1-9)

Ver `docs/membego-supply-final-report.md` (actualizado al cierre) para el
detalle de lo implementado, corregido, agregado, migraciones, pruebas y riesgos.

---

## 6 · Cierre de la auditoría (FASES 1-9) · 2026-09-29

### IMPLEMENTADO

- **Capa financiera** (ADR-0009): depósitos con saldo y movimientos, facturas de
  proveedor (factura / nota de crédito / nota de débito), cuentas por pagar y por
  cobrar con cinco estados, liquidaciones con líneas y snapshot, pago con
  neteo y aplicación planificada de depósitos, conciliación Membego vs proveedor
  con seis tipos de discrepancia, investigación, notas, ajuste y aprobación.
- **Venta sin precompra**: acuerdo a `COMISION`, `SupplyVentaDirecta`, cobro por
  el flujo de pedidos existente, entrega por el escáner con código al portador,
  cuenta por pagar por el neto al entregar. Ningún lote se mueve.
- **Agreement engine**: comisión %, descuento %, impuesto %, plazo de pago,
  frecuencia de corte, método de liquidación, política de devoluciones, SLA;
  estado `SUSPENDIDO` con motivo; versionado (`SupplyAcuerdoVersion`) al aprobar
  y en cada enmienda.
- **Proveedor externo**: `SupplyProveedor` sobre una `Company` inactiva;
  conversión = activar la misma empresa (mismo id, mismo historial).
- **Ledger de unidades** con saldo anterior y posterior por movimiento.
- **QR**: dispositivo del cliente y del escáner guardados.
- **FEFO con override auditado** (`SUPPLY_FEFO_OVERRIDE`) desde la emisión manual.
- **Órdenes**: `montoPagado` y fondeo automático al confirmar pagos; documentos.
- **Incidencias**: 15 causas, 9 estados; aplican a ventas.
- **Vencimientos**: umbrales 90/60/30/15/7/1 configurables
  (`SUPPLY_UMBRALES_VENCIMIENTO`); alertas de lotes, derechos, depósitos y
  acuerdos; tres avisos nuevos en la campanita.
- **Dashboard**: 16 KPIs + bloques (cubetas, categoría, redenciones recientes,
  obligaciones vencidas, vencimientos de depósitos/acuerdos).
- **Reportes**: 16 bloques CSV con filtros de campaña, cliente, sucursal y
  estado; unit economics con las nueve preguntas y el modelo a comisión.
- **Auditoría**: 23 acciones nuevas; `antes`/`despues` en cada cambio de estado.
- **Permisos**: `MEMBEGO_SUPPLIER_MANAGE`, `MEMBEGO_SETTLEMENT_MANAGE`,
  `MEMBEGO_RECONCILIATION_MANAGE`, `MEMBEGO_SUPPLY_ADJUST`, `MEMBEGO_SUPPLY_AUDIT`
  sobre el RBAC existente.
- **UI**: sección **Finanzas** con sub-navegación (Pagos · Depósitos · Facturas ·
  CxP · CxC · Liquidaciones · Cobros a clientes), Ventas, Conciliación con
  fichas, perfil de proveedor, portal del proveedor con lo que se le debe, sus
  liquidaciones y sus ventas por entregar; vitrina y «Mis compras» del cliente.
  `/superadmin/supply/cobros` y `/superadmin/supply/liquidaciones` redirigen.

### CORREGIDO

| Hallazgo | Corrección |
| --- | --- |
| H1 · `REEMBOLSO` con signo invertido | `dinero.ts:signoDeAsiento`; prueba pura + caso 9 contra PostgreSQL |
| H2 · `proponerLiquidacion` muerto | Sustituido por `liquidaciones.ts` (calcular → revisar → aprobar → pagar → conciliar) |
| H4 · Fondeo manual de órdenes | `fondearOrdenEnTx` al confirmar un pago con `ordenId` |
| H7 · Umbrales constantes | `parsearUmbrales` + variable de entorno |
| H8 · Proveedor externo invisible | `proveedoresElegibles()` (registrados y externos) en acuerdos y finanzas |
| Nuevo · Código de acuerdo por proveedor con unicidad global | Correlativo por sigla y año, con búsqueda de hueco (lo destapó el caso 8) |
| Nuevo · Deduplicación de proveedores externos nunca coincidía | El slug se compara con su prefijo `prov-` (lo destapó el caso 16) |
| `Cobros` ambiguo | Sección Finanzas |

H3 (canales de distribución sin consumidor), H5 (numeración de órdenes) y H6
(paginación de `conciliar`) quedan documentados como riesgos pendientes.

### AGREGADO (archivos)

Dominio: `dinero.ts`, `cuentas.ts`, `depositos.ts`, `facturas.ts`,
`liquidaciones.ts`, `conciliacion-cifras.ts`, `conciliacion-proveedor.ts`,
`proveedores.ts`, `ventas.ts`, `tablero.ts`, `opciones.ts`, `actions-util.ts`,
`actions-finanzas.ts`, `actions-ventas.ts`. Componentes: `form-accion.tsx`,
`filtros-finanzas.tsx`, `variantes.ts`, `tarjeta-venta.tsx`, `mis-ventas.tsx`.
Páginas: `finanzas/*` (10), `ventas`, `conciliacion/[id]`. Pruebas:
`tests/supply-finanzas.test.ts`, `tests/postgres/supply-flujos.db.test.ts`
(+ `scripts/supply-db/` para ejecutarla fuera de Next). CI: paso «Flujos de
Membego Supply contra PostgreSQL» en el trabajo *Esquema*.

### MIGRACIONES

`prisma/migrations/20261008_supply_capa_financiera/migration.sql`
(idempotente; 12 tablas nuevas, 20+ columnas, 8 enums ampliados, 10 `CHECK`,
índices parciales de unicidad para liquidaciones vivas y de consulta para
depósitos/CxP/acuerdos; repara la deriva previa del índice de pedidos).
Verificada con `migrate deploy` en base limpia, re-ejecución y `migrate diff
--exit-code` (sin diferencias). Sellada en `SUMAS.txt`.

### TESTS

| Suite | Casos | Qué cubre |
| --- | --- | --- |
| `tests/supply-finanzas.test.ts` (puro) | 18 | Signos, depósito 100k→80k, saldar, reparto de venta, neteo, máquinas de estado, contrato a comisión, los seis tipos de discrepancia, umbrales, códigos |
| `tests/postgres/supply-flujos.db.test.ts` (PostgreSQL) | 16 | Los 14 obligatorios: compra 1.000 · asignación 100 · entitlement · redención por QR · doble redención · vencido · FEFO · venta sin precompra → CxP · depósito 100k/20k · factura pagada por fuera · liquidación (snapshot inmutable ante enmienda) · conciliación con discrepancia · reversión · **carrera real de tres redenciones concurrentes** (+ carrera de entregas de venta, + proveedor externo convertido) |
| Suites existentes | 3.211 → 3.229 | Contratos actualizados (PUROS, rutas, `server-only` en `actions-*`) |

### RIESGOS PENDIENTES

1. **Integración con membresías/recompensas/referidos (H3)**: los canales de
   `distribucion.ts` siguen sin consumidor; el marketplace y la emisión manual
   son las únicas entradas. Cablearlos es trabajo de los módulos consumidores.
2. **Numeración de órdenes y pedidos por `count()+1` (H5)**: sin reintento en
   colisión. Improbable en plataforma; documentado.
3. **`conciliar()` interna con `take: 200` (H6)**: paginar cuando haya miles de lotes.
4. **Permisos finos**: los nueve permisos existen como vocabulario y guardias,
   pero todos los de plataforma resuelven a `SUPERADMIN` (no hay roles
   intermedios en el RBAC actual).
5. **Documentos** (facturas, depósitos, conciliación) se guardan como rutas o
   referencias; no hay subida al storage desde estas pantallas.
6. **Paginación**: los listados usan límites (200-300 filas) con filtros por
   estado y proveedor, no paginación real.
7. **`npx eslint .`** falla por una regla `react-hooks` sin plugin en la
   configuración raíz; es previo a este trabajo y CI usa `eslint src tests`,
   que está limpio.

### VERIFICACIÓN FINAL

| Comprobación | Resultado |
| --- | --- |
| `npx tsc --noEmit` | limpio |
| `npx eslint src tests` | 0 errores · 15 avisos (previos) |
| `npm test` | 3.229 / 3.229 |
| `npm run test:db` (PostgreSQL 16, base migrada) | 16 / 16, dos ejecuciones consecutivas |
| `npm run build` | correcto |
| `prisma migrate diff --exit-code` | sin diferencias |
| `transacciones-anidadas` · `rls-cobertura` · `permisos-catalogo` · `rls-capa2-preflight` | ✓ |

### Estado por requisito

| Requisito | Estado | Evidencia |
| --- | --- | --- |
| §1 Separación de capas (inventario / supply / derechos / venta directa / finanzas) | ✅ | ADR-0009; `SupplyVentaDirecta` sin lote; sub-libros |
| §3 A Compra anticipada | ✅ | caso 1 |
| §3 B Depósito abierto | ✅ | `depositos.ts`; casos 9-10 |
| §4 Agreement engine + estados + versionado | ✅ | `contrato.ts`, `SupplyAcuerdoVersion`; caso 11 |
| §5 Proveedor registrado / externo convertible | ✅ | `proveedores.ts`; caso 16 |
| §6 Orden de compra con pagos parciales, facturas, documentos | ✅ | `montoPagado`, `fondearOrdenEnTx`, `SupplyFacturaProveedor.ordenId`, `documentos` |
| §7 Lotes | ✅ | sin cambios; invariante comprobado en cada caso |
| §8 Ledger con saldo anterior/posterior | ✅ | `saldoAntes`/`saldoDespues`; caso 4 |
| §9 Asignaciones | ✅ | caso 2 |
| §10 FEFO + override auditado | ✅ | `emitirDerechoAction` + `SUPPLY_FEFO_OVERRIDE`; caso 7 |
| §11 Entitlement | ✅ | caso 3 |
| §12 QR con dispositivo | ✅ | caso 4 |
| §13 Redención sin doble canje | ✅ | casos 5 y 14 (carrera real) |
| §14 Venta sin precompra → CxP → liquidación | ✅ | casos 8, 11, 14b |
| §15 Cuentas por pagar | ✅ | `cuentas.ts`; casos 8-11 |
| §16 Cuentas por cobrar | ✅ | caso 11 |
| §17 Liquidaciones con snapshot | ✅ | caso 11 |
| §18 Conciliación con discrepancias | ✅ | caso 12; seis tipos en prueba pura |
| §19 Incidencias 11 causas / 7 estados | ✅ | enums ampliados, `resuelveIncidencia` |
| §20 Vencimientos 90/60/30/15/7/1 configurables | ✅ | `vencimientosProximos`, cron, avisos |
| §21 Facturación (factura, NC, ND) | ✅ | `facturas.ts`; caso 10 |
| §22 Pagos (transferencia/depósito/manual; split futuro) | ✅ | `finanzas.ts`; `PuertoCobroMembego` intacto |
| §23 Dashboard 16 KPIs + bloques | ✅ | `tablero.ts:resumenFinanciero`; Resumen y Finanzas |
| §24 16 reportes con filtros y exportación | ✅ | `exportar/route.ts` |
| §25 Unit economics (nueve preguntas) | ✅ | `rentabilidad()`, `economiaComision` |
| §26 Auditoría con antes/después | ✅ | `actions-util.ts:auditar`; 23 acciones nuevas |
| §27 Permisos en backend | ✅ (⚠️ roles intermedios) | `permisos.ts` |
| §28 Concurrencia e idempotencia | ✅ | `FOR UPDATE`, claims atómicos, claves; casos 14 y 14b |
| §29 Integración con el resto de Membego | ⚠️ | cobro, notificaciones, auditoría, RBAC, storage reutilizados; canales de membresías/recompensas siguen sin consumidor (H3) |
| §30 UX por pantalla | ✅ (⚠️ paginación) | estados vacíos, filtros por estado/proveedor, confirmaciones en lo irreversible, sin botones decorativos |
| §31 14 casos de prueba | ✅ | `tests/postgres/supply-flujos.db.test.ts` |
