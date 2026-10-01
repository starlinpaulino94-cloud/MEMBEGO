# MEMBEGO SUPPLY 2.0 — Auditoría del Vertical Slice 5

Fecha: **2026-10-01** · Rama: `claude/jolly-brahmagupta-dmhml9`.
Alcance: VENTA SIN PRECOMPRA / COMISIÓN + SETTLEMENT — acuerdo a comisión
(ITEM > CATEGORY > CATALOG) → oferta sin lote → marketplace y checkout
unificados → derecho sin lote → entrega = cumplimiento → obligación por el
neto → liquidación → pago (motor del Slice 4) → conciliación de comisión →
economía separada → portal del proveedor.

Método: **no se marca ✅ por existencia de código**. Cada criterio se comprobó
contra una fuente primaria: la salida de las suites (dominio, PostgreSQL,
Playwright escritorio y móvil), consultas SQL sobre lo que las pruebas
dejaron escrito, una base creada desde cero con `migrate deploy`, `git diff`
sobre las zonas prohibidas y las mismas puertas que corre CI.

Leyenda: ✅ verificado con evidencia · ⚠️ observación o riesgo (no bloquea) ·
⛔ fuera de alcance por decisión del prompt.

---

## 1 · BASE COMMIT

| Comprobación | Evidencia | Estado |
| --- | --- | --- |
| `main` remoto al iniciar | `origin/main` = `9aa693a` al empezar; el Slice 4 todavía no estaba integrado, así que se mergeó `origin/main` sobre la rama que lo traía (`956a65a`). | ✅ |
| Slice 4 integrado durante el slice | `origin/main` pasó a `947a2dc` (merge del PR #532 = esta rama con el Slice 4). Se volvió a mergear: `c8dc31a`, sin conflictos, `tsc` exit 0. **Base efectiva del Slice 5: `947a2dc`.** | ✅ |
| Slices 1–4 presentes | `aaf3693` (S4 código), `327359c` (S4 informe) y los commits de S1–S3 son ancestros de `HEAD`; `git diff origin/main` no toca ninguna migración `20261010`–`20261013`. | ✅ |
| Pruebas de S1–S4 antes de escribir código | Sobre la base mergeada: `npm run test:db` **95 pass · 0 fail**; `tsc --noEmit` exit 0. | ✅ |
| S1–S4 no reescritos | 45 archivos previos tocados (+… ampliaciones, −211 líneas), todos ramas «si es COMISIÓN» o lecturas nuevas: checkout, redención, obligaciones, economía, aplicaciones, pagos, conciliación, read-model, consultas y pantallas. `allocations/`, `pool/`, `procurement/`, `catalog/`, `suppliers/service.ts`, `core/ledger.ts`, `core/fefo.ts`: **0 cambios**. | ✅ |
| Cambios de comportamiento en slices previos, justificados | (1) `validarAcuerdo` acepta `COMMISSION` (antes lo rechazaba como «fuera del Slice 1»): es el objeto del slice; la prueba de dominio de S1 se actualizó para seguir rechazando `HYBRID`. (2) La reversa de una entrega ya pagada ahora abre una `SupplyV2FinanceIncident` además de conservar la obligación (S4 solo anotaba). (3) `enlazarObligacionesAFacturaEnTx` excluye obligaciones de comisión (se liquidan, nunca se facturan). (4) La conciliación de S4 lleva `kind = SUPPLY` y su clave única pasa a `(supplierId, kind, periodStart, periodEnd)`. | ✅ |

## 2 · ARCHITECTURE

| Criterio | Evidencia | Archivo |
| --- | --- | --- |
| MEMBEGO NO ES DUEÑO DEL INVENTARIO (regla principal) | Una oferta `COMMISSION` no crea PO, recepción, lote ni asignación; ningún asiento del ledger se escribe por checkout, pago, entrega, reversa ni vencimiento. Verificado por SQL en cada recorrido (`sinInventario()`): `supply_v2_lots = 0`, `supply_v2_allocations = 0`, `purchase_order_lines = 0`, `ledger_entries` por orden/derecho/redención = 0. | `tests/postgres/supply-v2-slice5.db.test.ts` (A, C, D, I, J, DEMO) · `tests/e2e/supply-v2-slice5.spec.ts` |
| Un solo modelo de oferta, dos fuentes | `SupplyV2Offer.sourceType` += `COMMISSION`; campos propios (`agreementId`, `agreementVersionId`, `commissionPercentage`, `commissionScope`, `availabilityMode`, `availabilityQuantity`) con CHECK `supply_v2_offers_source_shape` (comisión ⇒ acuerdo + versión + % + disponibilidad; precompra ⇒ sin acuerdo ni disponibilidad). | `prisma/schema/supply-v2.prisma` · `20261015_supply_v2_slice5/migration.sql` |
| Reutiliza Slices 1–4 sin duplicar | Mismo `SupplyV2CustomerOrder`/`Line`, mismo `SupplyV2Entitlement`, mismo voucher/QR/redención (Slice 3), mismas `SupplyV2SupplierObligation`, `SupplyV2SupplierPayment` y `SupplyV2PaymentApplication` (Slice 4). Las liquidaciones **apuntan** a obligaciones; no crean otra deuda. | `commerce/checkout.ts`, `redemption/service.ts`, `finance/{obligations,payments,applications}.ts` |
| Motor de precios central | `SupplyV2PricingEngine` (`core/comision.ts`): `repartirComision`, `calcularLineaComision`, `repartirEnUnidades`, `validarPorcentajeComision`. Checkout lo usa al abrir la orden y **lo vuelve a comprobar** al confirmar el pago (`ORDEN_INCONSISTENTE` si la foto no cuadra). | `core/comision.ts`, `commerce/checkout.ts` |
| Reglas puras separadas de la base | `core/comision.ts`, `agreements/domain.ts` (resolver), `offers/domain.ts` (validación y disponibilidad), `finance/settlements-domain.ts` (elegibles, totales, estado, SoD, reparto, periodos, transiciones), `economics/domain.ts` (agregación separada). **22 pruebas sin Prisma.** | `tests/supply-v2-slice5-dominio.test.ts` |
| Numeración serializada | `MBG-ST` por `siguienteNumero` (`pg_advisory_xact_lock`). | `core/numeracion.ts` |
| V2 no importa V1 | `grep "modules/supply/"` en `supply-v2`, `components/supply-v2`, `superadmin/supply-v2`, `admin/supply-v2`: **0**. | — |

Tablas nuevas (4): `supply_v2_commission_reservations`, `supply_v2_settlements`,
`supply_v2_settlement_lines`, `supply_v2_finance_incidents`. Enums nuevos (7):
`SupplyV2AvailabilityMode`, `…CommissionReservationStatus`, `…SettlementStatus`,
`…SettlementFrequency`, `…ReconciliationKind`, `…ResolutionType`,
`…FinanceIncidentType/Status`; valores añadidos: `SupplyV2OfferSource.COMMISSION`,
`SupplyV2EconomicEventType.COMMISSION_REVENUE`, `SupplyV2ReconciliationLineType.SETTLEMENT`.

## 3 · AGREEMENT RESOLUTION

| Criterio | Evidencia | Archivo / Prueba |
| --- | --- | --- |
| Agreement COMMISSION funciona | `crearAcuerdoEnTx` con `type: 'COMMISSION'`: exige `commissionPercentage` (0–100, 2 decimales), rechaza costo negociado, fuerza `payableRecognition = ON_REDEMPTION` y lo congela en la **versión 1** (`snapshot.payableRecognition = 'ON_REDEMPTION'`). | DB **B**; dominio 7, 8 |
| ITEM scope | Acuerdo por producto (10 %) gana para «Saona». | DB **B** (precedencia), **A**; E2E escritorio (override) |
| CATEGORY scope | Acuerdo por categoría «Tours» (8 %) cubre «Hoyo Azul» con categoría `tours` (comparación sin mayúsculas). | DB **B**, **C**; dominio 10 |
| CATALOG scope | Acuerdo de catálogo (5 %) cubre «Gorra» (categoría Merch, sin regla propia). | DB **B**, **D**; E2E escritorio y móvil |
| Precedencia ITEM > CATEGORY > CATALOG | `resolverAcuerdoComision` (puro): filtra ACTIVE + vigente + COMMISSION, ordena por precedencia, luego `startsAt` más reciente, luego código. Demo §92: catálogo 10 / categoría 12 / Premium 15 → venta 1 000 ⇒ comisión **150**, neto **850**. | dominio 10, 11; DB **B**, **DEMO precedencia** |
| Resuelto en el servidor, nunca en el formulario | `resolverAcuerdoComisionDeItemEnTx` se ejecuta al crear la oferta **y otra vez al publicarla** (si el acuerdo dejó de estar vigente: `SIN_ACUERDO_COMISION`). El wizard solo muestra lo que el servidor resolvió. | `agreements/service.ts`, `offers/service.ts` |
| Versión del acuerdo congelada | La oferta, la orden, cada derecho y cada obligación guardan `agreementId` + `agreementVersionId`; la redención guarda `commissionPercentageSnapshot` / `commissionAmountSnapshot` / `supplierNetSnapshot`. Cambiar el acuerdo después no cambia nada ya vendido (los importes salen del derecho, no del acuerdo). | DB **A** (`agreementVersionId != null`), **E**, **J redondeo** |
| Un acuerdo PREPAID/PAY_LATER sigue igual | `acuerdoCompatible` (PO) sigue limitado a `AGREEMENT_TYPES_SLICE1`; un acuerdo COMMISSION no sirve para comprar. | dominio 9, 11; DB **G** (prepago intacto) |

## 4 · COMMISSION OFFERS

| Criterio | Evidencia | Archivo / Prueba |
| --- | --- | --- |
| Oferta a comisión sin lote | `crearOfertaComisionEnTx`: sin `asignarEnTx`, `allocationId = null`; `publicarOfertaEnTx` rama COMMISSION no aparta nada. | DB **A** (`sinInventario`), E2E (`oferta-sin-lotes`) |
| Snapshot de acuerdo/versión/% en la oferta | Columnas `agreementId`, `agreementVersionId`, `commissionPercentage`, `commissionScope`; CHECK `supply_v2_offers_source_shape`. | DB **A** |
| Wizard pide la fuente | `/ofertas/nueva` → «Supply adquirido» / «Vender a comisión» (`elegir-fuente`); el wizard de comisión enseña la regla resuelta (`comision-regla`: «10.00 % · MBG-AG-… (regla por producto)»). | E2E escritorio (override) y móvil (catálogo) |
| Detalle de oferta con comisión | Tarjeta `oferta-comision`: %, acuerdo y alcance, disponibilidad, vendidas/entregadas/pendientes/vencidas, GMV/comisión/neto, neto devengado/pagado/pendiente. Lotes: «Ninguno: a comisión el inventario es del proveedor». Ledger: «nunca escribe». | `offers/queries.ts` (`fichaOferta.comision`); E2E |
| Columna «Modelo» en ofertas y ventas | `ChipModelo` en `/ofertas` y `/ofertas/ventas` (+ reparto comisión/neto por venta). | E2E (`chip-modelo`, `venta-reparto`) |
| Cerrar oferta a comisión | `cerrarOfertaEnTx` cuenta reservas de comisión vivas (bloquea cancelar con checkouts en curso) y libera 0 unidades. | DB **J vencimiento** |

## 5 · AVAILABILITY

| Criterio | Evidencia | Prueba |
| --- | --- | --- |
| UNLIMITED | `availabilityQuantity = null`, `quantityLimit = 0` (CHECK `supply_v2_offers_prices` reemplazado para admitirlo solo en ese caso); el DTO público dice `unlimited: true`; la ficha pública no limita por unidades, solo por persona. | DB **D**; E2E catálogo |
| FIXED_QUANTITY / CAPACITY | Misma mecánica: libres = tope − Σ(reservas ACTIVE + CONSUMED). | DB **A** (100 → 99), **C** (1) |
| Reserva comercial | `SupplyV2CommissionReservation` ACTIVE al abrir la orden (bajo `FOR UPDATE` de la oferta) → CONSUMED al confirmar el pago → RELEASED al cancelar/rechazar → EXPIRED al expirar. Sin lote, sin ledger. | DB **A**, **C** |
| Capacity release | Cancelar devuelve el cupo (1 → 0 → 1); expirar también; una oferta SOLD_OUT por capacidad vuelve a ACTIVE al liberarse un cupo. | DB **C** |
| SOLD_OUT derivado | `marcarAgotadaSiCorrespondeEnTx` rama COMMISSION: libres = 0 ⇒ SOLD_OUT; nadie más compra («agotó»). | DB **C** |
| No overselling | Dos clientes por la última unidad en paralelo: **1 pasa, 1 rechazada** (`queda|agotó`); Σ reservas = 1. | DB **C** (§76) |

## 6 · CHECKOUT

| Criterio | Evidencia | Prueba |
| --- | --- | --- |
| Marketplace unificado | `ofertasPublicas` / `ofertaPublicaPorSlug` devuelven las dos fuentes con el mismo DTO; disponibilidad de comisión calculada en el read-model. | DB **A**, **C**, **D** |
| DTO público no expone comisión/neto/acuerdo/costo | `Object.keys(dto)` no contiene `commission|supplierNet|agreement|cost`; la ficha pública móvil no muestra la palabra «comisión». | DB **A**; E2E móvil |
| Checkout unificado | `abrirOrdenClienteEnTx` bloquea la oferta, idempotencia, expira caducadas y **luego** bifurca por `sourceType`; la orden guarda `sourceType`, acuerdo, versión, `commissionPercentage`, `commissionAmount`, `supplierNet`; la línea guarda lo mismo por unidad y total. | DB **A**, **E** |
| Customer limit | Dos checkouts simultáneos del mismo cliente con límite 1: **1 pasa**. Pagadas + reservas vivas cuentan igual que en prepago. | DB **D** (§76) |
| Idempotencia del checkout | Misma `idempotencyKey` ⇒ misma orden (código de S2 compartido). | S2 (sin cambios) |
| Pago confirmado | Reservas de comisión → CONSUMED; un derecho por unidad; `SUPPLY_V2_COMMISSION_ORDER_PAID` auditado con GMV / comisión / neto; doble confirmación ⇒ un solo juego de derechos y un solo evento por derecho. | DB **E** (§76) |

## 7 · ENTITLEMENTS

| Criterio | Evidencia | Prueba |
| --- | --- | --- |
| Entitlement commission sin lot | `allocationId`, `allocationLineId`, `lotId` nulos **solo** si `sourceType = COMMISSION` (CHECK `supply_v2_entitlements_source_shape`); `actualUnitCost = 0`; `commissionPercentage/Amount`, `supplierNet` por unidad. | DB **A**; SQL en E2E (`sinInventario`) |
| El reparto por unidad cuadra | 3 × 10.00 al 33.33 % ⇒ comisiones 3.34 / 3.33 / 3.33 (= 10.00), netos = precio − comisión (= 20.00); cada unidad suma su precio. | DB **J redondeo**; dominio 4, 6 |
| Vigencia | `expiresAt` = fin de la oferta (sin fin ⇒ no vence). ⚠️ ver riesgos. | `commerce/checkout.ts` |
| Vencimiento sin lote | EXPIRED + voucher EXPIRED + evento BREAKAGE con metadata de comisión; **sin asiento** y **sin obligación** (no se entregó). El barrido lo tolera (`derechosConError = 0`). | DB **J vencimiento** |

## 8 · REDEMPTION

| Criterio | Evidencia | Prueba |
| --- | --- | --- |
| QR/redeem reutiliza Slice 3 | Mismo `abrirSesionQrEnTx` / `previsualizarCanjeEnTx` / `confirmarEntregaEnTx`; único cambio: `lotIssued: null` cuando no hay lote (`motivoNoCanjeable` no consulta el ledger) y la redención copia las fotos de comisión. | dominio 14; DB **A**; E2E (escáner real) |
| No ledger de lot commission | `if (e.lotId)` alrededor de los tres asientos (entrega, reversa, vencimiento); contador de asientos = 0 en todos los recorridos. | DB **A**, **I**, **J** |
| Redemption crea la obligación correcta | `reconocerObligacionDeComisionEnTx`: `grossAmount = supplierNetSnapshot` (900 sobre 1 000 al 10 %), `sourceType = REDEMPTION`, `recognitionBasis = REDEMPTION`, acuerdo/versión del derecho, `dueAt` por `paymentTermsDays` de la foto. Sin foto ⇒ `REDENCION_SIN_FOTO` (nunca se inventa). | DB **A**, **DEMO** |
| Obligation idempotente | `sourceType + sourceId` único; segunda llamada ⇒ `repetida: true`; dos redenciones simultáneas del mismo QR ⇒ 1 entrega, 1 obligación. | DB **A**, **F** (§76) |
| Reversa sin pagar | Obligación CANCELLED (`outstanding = 0`), sale de su liquidación (línea borrada, totales recalculados a 0, `settlementId = null`); el derecho vuelve a ACTIVE y una nueva entrega crea **otra** obligación. | DB **I** |
| Reversa ya pagada | La obligación PAID se conserva y nace `SupplyV2FinanceIncident` (`REDEMPTION_REVERSED_AFTER_PAYMENT`, 900) OPEN; resolverla exige explicación; auditado. | DB **I** |
| Ficha de redención | «Sin lote · venta a comisión», comisión y neto congelados. | E2E (`redencion-sin-lote`, `redencion-neto`) |

## 9 · COMMISSION ECONOMICS

| Criterio | Evidencia | Prueba |
| --- | --- | --- |
| GMV correcto | `COMMISSION_REVENUE.gmvAmount = customerUnitPrice × q` = 1 000. | DB **A**, **E**, **J economía** |
| Revenue Membego correcto | `revenueAmount = commissionAmount` = 100; `costAmount = 0`; `grossMargin = 100`; `lotId = null`; `costModel = COMMISSION_NO_INVENTORY`. | DB **A** |
| Supplier money no contado como revenue | `supplierNet` solo en metadata del evento y en `Economia.commission.supplierNet`; `revenue` total = Σ comisiones. Nunca «ingreso 1 000 / costo 900». | DB **J economía**; dominio 21 |
| Separación prepago / comisión | `agregarEconomia` devuelve `prepurchase {gmv, revenue, cost, unitsSold}` y `commission {gmv, revenue, supplierNet, unitsSold}`; la pizza prepago (399/300) y Saona (1 000/100) no se mezclan. | DB **J economía**; dominio 21 |
| Reconocido una vez | Pago ⇒ 1 evento por derecho; entrega, reversa y vencimiento no crean ingreso ni costo; `proyectarVentasSinEventoEnTx` también cubre `COMMISSION_REVENUE`. | DB **A**, **E**, **J vencimiento** |
| Pantallas | `/economia`: tarjetas «Supply adquirido» y «Venta a comisión» (`eco-comision-*`, `eco-prepago-*`); `/finanzas`: «Ventas a comisión» (`kpi-comision-ingreso`, `kpi-comision-neto`, `kpi-sin-liquidar`, `kpi-liq-por-pagar`). | E2E escritorio |

## 10 · SUPPLIER OBLIGATIONS

| Criterio | Evidencia | Prueba |
| --- | --- | --- |
| Commission amount / supplier net correctos | Orden 2 × 1 000 ⇒ comisión 200, neto 1 800; Σ derechos = línea. Demo §92: 1 000 ⇒ 100 / 900; precedencia ⇒ 150 / 850. | DB **E**, **DEMO** ×2 |
| Redondeo 2 decimales ROUND_HALF_UP | 33.33 % de 10 ⇒ 3.33 / 6.67; 1.25 al 10 % ⇒ 0.13; comisión + neto = GMV exacto para cualquier combinación. | dominio 2, 3 |
| Supplier outstanding | `Σ outstanding` de obligaciones vivas del proveedor = 0 tras pagar la liquidación. | DB **DEMO** |
| Lista de obligaciones | «Pendiente 900 · Entrega …» tras entregar; «Pagada» tras liquidar. | E2E escritorio |

## 11 · SETTLEMENTS

| Criterio | Evidencia | Prueba |
| --- | --- | --- |
| Settlement funciona | `generarLiquidacionEnTx`: proveedor + frecuencia (DAILY/WEEKLY/BIWEEKLY/MONTHLY ⇒ periodo calculado; MANUAL ⇒ fechas) ⇒ `MBG-ST-…`, `PENDING_APPROVAL`, bruto/comisión/neto. Idempotente por `idempotencyKey`. | DB **A**; dominio 19 |
| Solo elegibles | OPEN / PARTIALLY_PAID, `settlementId IS NULL`, misma moneda, `recognizedAt` en [inicio, fin), y **solo redenciones COMMISSION**. | dominio 15; DB **A**, **G** |
| No settlement de prepago | Obligaciones de un lote real (PAY_LATER ON_REDEMPTION o prepago) nunca entran: `obligacionesLiquidablesEnTx` = 0 y «No hay entregas a comisión». | DB **G** |
| Settlement lines (foto) | `descriptionSnapshot`, bruto, comisión, neto por línea; única por `(settlementId, obligationId)`; `redemptionId` sin FK. | DB **A** (`lineas = 1`), E2E (`liq-linea`) |
| No obligation en dos settlements | `obligations.settlementId` es la barrera: `SELECT … FOR UPDATE` sobre las obligaciones vivas + `updateMany WHERE settlementId IS NULL` (si no marca todas ⇒ `CONCURRENCIA`). Dos generaciones simultáneas ⇒ **1 liquidación, la otra falla**. Segunda generación del mismo periodo ⇒ «No hay entregas…». | DB **G** (§76), **A**; E2E (`preview-vacia`) |
| Approval settlement (SoD) | `puedeAprobarLiquidacion`: quien generó no aprueba si hay más de una persona autorizada (`AUTOAPROBACION`); aprobar dos veces es idempotente. En E2E: compras genera y recibe «misma persona»; finanzas aprueba. | DB **A**; dominio 17; E2E |
| Cancelar | Solo sin dinero aplicado y sin pagos PENDING; libera `settlementId` de sus obligaciones. | DB **I** (cancelar vacía), **A** (rechazo con pagos) |
| Estado derivado | `recalcularLiquidacionEnTx` = Σ `paidAmount` de sus obligaciones: APPROVED → PARTIALLY_PAID → PAID (y vuelta al reversar una aplicación). Se dispara desde `recalcularObligacionEnTx` (cualquier aplicación o reversa). | DB **A**, **H**; dominio 16, 20 |
| Snapshot inmutable | Las líneas no se recalculan desde el acuerdo ni el catálogo; solo salen si su obligación se cancela sin pagar (reversa). | `finance/settlements.ts` |

## 12 · PAYMENTS

| Criterio | Evidencia | Prueba |
| --- | --- | --- |
| Pago vía Slice 4 | `crearPagoEnTx` admite `settlementId` (uno solo entre factura/obligación/liquidación/depósito); valida proveedor, estado APPROVED/PARTIALLY_PAID, moneda y **no sobrepago** del saldo de la liquidación. | DB **A** (901 rechazado) |
| Segregación | Quien registra no confirma (`puedeConfirmarPago`, S4). E2E: finanzas registra, compras confirma. | DB **A**; E2E |
| Distribución más antigua primero | Al confirmar: candado de la liquidación → obligaciones `FOR UPDATE` ordenadas por `recognizedAt` → `repartirPagoMasAntiguoPrimero` → `aplicarEnTx` por obligación (`idempotencyKey = pago:…:liquidacion:…:obligacion`). | DB **H**: 1 000 ⇒ 900 (vieja) + 100 (nueva) |
| Partial / full payment | 1 700 ⇒ PARTIALLY_PAID; 1 800 ⇒ PAID, `paidAt`; reversar una aplicación de 100 ⇒ vuelve a PARTIALLY_PAID; reaplicar ⇒ PAID. | DB **H** |
| Dos pagos sobre el mismo saldo | Dos pagos de 1 000 confirmados a la vez sobre 1 800: aplicado total **1 800**, ninguna obligación sobrepagada, el resto queda «sin aplicar» en el pago. | DB **H** (§76) |
| Obligations quedan PAID | Tras el pago: obligación PAID, `outstanding = 0`, `SUPPLY_V2_OBLIGATION_PAID` auditado. | DB **A**, **DEMO** |
| Formulario | `FormPago` con destino «La liquidación MBG-ST-…» (prellenado desde la ficha de la liquidación con el saldo). | E2E (`pago-destino = LIQUIDACION`, `pago-monto = 900.00`) |

## 13 · RECONCILIATION

| Criterio | Evidencia | Prueba |
| --- | --- | --- |
| Reconciliation commission | `crearConciliacionComisionEnTx` (`kind = COMMISSION`): interno = bruto / comisión / neto (obligaciones de entregas COMMISSION del periodo) / pagos aplicados / liquidaciones; reclamado = bruto / comisión / neto del proveedor. La cifra conciliada es el **neto**. Idempotente por proveedor + COMMISSION + periodo. | DB **J conciliación** |
| Discrepancy funciona | Sin cifra del proveedor ⇒ OPEN («Sin información»); neto reclamado = interno + 50 ⇒ DISCREPANCY con diferencia −50; nunca MATCHED solo. | DB **J conciliación**; E2E |
| Resolution type | Resolver una conciliación de comisión exige `resolutionType` (ACCEPT_INTERNAL / ACCEPT_SUPPLIER / ADJUSTED / OTHER) además de las notas; la de supply (S4) no cambia. | DB **J conciliación**; E2E (`tipo-resolucion`) |
| S4 separada | La conciliación de supply excluye obligaciones de comisión; las dos conviven en la misma lista con su tipo. | `finance/reconciliation.ts` |

## 14 · PROVIDER PORTAL

| Criterio | Evidencia | Prueba |
| --- | --- | --- |
| Ownership proveedor | El proveedor sale de la **sesión** (`proveedorDeLaSesion`, `SupplyV2Supplier.companyId` único); todas las consultas filtran por `supplierId`; `liquidacionDelProveedor(supplierId, id)` devuelve `null` para una liquidación ajena. | `redemption/queries.ts`, `(admin)/admin/supply-v2/layout.tsx` |
| Ventas Membego | `/admin/supply-v2/ventas`: pendientes de entregar, entregadas, monto pendiente de pago, pagado; lista con bruto (lo que pagó el cliente), neto, estado de entrega y de cobro; filtros Todas / Pendientes / Entregadas. El portal principal enlaza y resume. | E2E escritorio y móvil |
| Sin comisión como cifra de Membego | La fila de venta no contiene la comisión (100); en la liquidación sí se ve «Comisión de Membego» porque es la cuenta que se le rinde (§64). | E2E (`not.toContainText(RD$100.00)`) |
| Provider portal settlements | `/admin/supply-v2/liquidaciones` y `/[id]`: periodo, vendido, comisión, neto, pagado/pendiente, entregas incluidas, pagos confirmados. | E2E (`liq-prov-neto = 900`, `liq-prov-pagado = 900`) |
| Móvil | Ficha pública y checkout sin scroll horizontal; portal de ventas sin scroll horizontal; capturas en `test-results/shots/supply-v2-s5-movil-*.png`. | E2E móvil |

## 15 · CONCURRENCY (§76)

| Caso | Resultado | Prueba |
| --- | --- | --- |
| Última capacidad (dos clientes) | 1 pasa, 1 «queda/agotó»; Σ reservas = 1 | DB **C** |
| Límite por cliente (dos checkouts) | 1 pasa, 1 «máximo de 1 por persona» | DB **D** |
| Doble confirmación de pago | 2 derechos (orden de 2), 2 eventos, no 4 | DB **E** |
| Doble redención (mismo QR) | 1 entrega, 1 obligación | DB **F** |
| Doble obligación | `reconocerObligacionPorRedencionEnTx` × 2 ⇒ `repetida` | DB **A**, **F** |
| Dos liquidaciones, mismas obligaciones | 1 generada, 1 rechazada; cada obligación en una sola viva | DB **G** |
| Dos pagos, mismo saldo | 1 800 de 2 000 aplicados; sin sobrepago | DB **H** |

Candados usados: oferta (`FOR UPDATE`) para reservas y límite; orden; derecho → voucher → sesión QR (S3);
pago → liquidación → obligaciones ordenadas (`FOR UPDATE`) para pagar; obligaciones vivas del
proveedor (`FOR UPDATE`) + `updateMany … WHERE settlementId IS NULL` para generar. Sin transacciones
anidadas (`scripts/transacciones-anidadas.mjs` ✓).

## 16 · AUTHORIZATION

| Criterio | Evidencia | Archivo |
| --- | --- | --- |
| 6 permisos nuevos | `SUPPLY_V2_COMMISSION_OFFER_MANAGE`, `SETTLEMENT_VIEW`, `SETTLEMENT_CREATE`, `SETTLEMENT_APPROVE`, `SETTLEMENT_PAY`, `COMMISSION_RECONCILE` en `SUPPLY_V2_PERMISSIONS` con etiqueta; `scripts/permisos-catalogo.mjs` ✓ (93 funciones). | `contracts/gateways.ts`; dominio 22 |
| Backend auth | Cada server action nueva empieza por `exigirPermisoSupplyV2(...)`: crear oferta a comisión (`COMMISSION_OFFER_MANAGE`), generar/cancelar (`SETTLEMENT_CREATE`), aprobar + resolver incidencias (`SETTLEMENT_APPROVE`), pagar liquidación (`PAYMENT_CREATE` + `SETTLEMENT_PAY` en la ficha), conciliación de comisión (`COMMISSION_RECONCILE`). Las páginas solo deciden qué botón pintar. | `actions-ofertas.ts`, `actions-finanzas.ts` |
| SoD en el servidor | Aprobación de liquidación y confirmación de pago: `createdById !== actorId` cuando hay > 1 autorizado. Probado por API (DB **A**) y por UI (E2E: compras no puede aprobar lo que generó). | `finance/settlements-domain.ts`, `finance/domain.ts` |
| Cliente | El checkout exige rol CLIENTE (S2); el DTO público no filtra nada interno. | `permisos.ts`, `marketplace/read-model.ts` |

## 17 · AUDIT

12 acciones nuevas en `AuditAccion` con etiqueta en `auditoria/queries.ts`
(`tests/bitacora-etiquetas` ✓): `SUPPLY_V2_COMMISSION_OFFER_CREATED`,
`COMMISSION_ORDER_PAID`, `COMMISSION_OBLIGATION_CREATED`, `SETTLEMENT_CREATED`,
`SETTLEMENT_APPROVED`, `SETTLEMENT_PAYMENT_APPLIED`, `SETTLEMENT_PAID`,
`SETTLEMENT_CANCELLED`, `COMMISSION_RECONCILIATION_CREATED`,
`COMMISSION_RECONCILIATION_RESOLVED`, `FINANCE_INCIDENT_CREATED`,
`FINANCE_INCIDENT_RESOLVED`. Verificado por consulta: la liquidación del viaje A deja exactamente
`CREATED, APPROVED, PAYMENT_APPLIED, PAID` (DB **A**); la obligación de comisión deja
`COMMISSION_OBLIGATION_CREATED` (DB **A**); la incidencia deja `CREATED` + `RESOLVED` (DB **I**).
Todo dentro de la misma transacción que el cambio (`auditarEnTx`).

## 18 · IDEMPOTENCIA (§75)

| Operación | Mecanismo | Prueba |
| --- | --- | --- |
| Checkout | `idempotencyKey` de la orden (S2) | S2 |
| Confirmar pago | orden ya PAID ⇒ devuelve lo emitido | DB **E** |
| Evento económico | único `type + referenceType + referenceId` | DB **E** (`repetido`) |
| Obligación | único `sourceType + sourceId` | DB **A**, **F** |
| Liquidación | `idempotencyKey` único + barrera `settlementId` | DB **A**, **G** |
| Aprobación | ya aprobada ⇒ `repetida` | DB **A** |
| Pago | `idempotencyKey` (S4); aplicaciones `pago:…:liquidacion:…:obligacion` | DB **A** |
| Conciliación | única por proveedor + tipo + periodo | DB **J** |
| UI | claves generadas en el servidor al pintar (`ui-liq-…`, `ui-pago-liq-…`) | páginas `nueva` / `[id]` |

## 19 · E2E (Playwright, Chromium real, servidor `next start`)

| Recorrido | Qué cubre | Resultado |
| --- | --- | --- |
| escritorio · COMISIÓN completa | proveedor → 2 productos → acuerdo CATÁLOGO 5 % → acuerdo PRODUCTO 10 % (override; el wizard muestra «10.00 % · regla por producto») → oferta Saona 1 000 × 10 → oferta Gorra 250 sin tope (5 %, «de todo el catálogo») → cliente compra Saona → finanzas ve «comisión RD$100.00 · neto RD$900.00» y confirma → **SQL: sin lote / asignación / PO / ledger** → portal: 1 pendiente, neto 900, pendiente de pago 0 → QR + escáner → obligación 900 → ficha de redención sin lote → economía 1 000 / 100 / 0 / 900 → compras genera liquidación (vista previa 900), **no puede aprobarla**, segunda generación vacía → finanzas aprueba → finanzas registra pago 900 → compras confirma → liquidación PAGADA, obligación Pagada → portal: pagado 900, liquidación Pagada con el pago → conciliación de comisión reclamando 950 ⇒ «Con diferencia» −50 ⇒ resuelta ACCEPT_INTERNAL → cliente 2 compra la gorra (12.50 / 237.50) sin inventario | ✅ 1 passed (1.4 min) |
| móvil (Pixel 7) · cliente + proveedor | ficha pública sin «comisión» y sin scroll horizontal → checkout 1 000 → aviso → confirmación → portal del proveedor en teléfono: 1 pendiente, neto 900, sin scroll horizontal; liquidaciones vacías | ✅ 1 passed (27 s) |
| Regresión E2E S1–S5 (escritorio + móvil) | `supply-v2-slice1..5.spec.ts` contra el mismo servidor, una sola corrida | ✅ **12 passed · 0 failed** (7.3 min): S1 4, S2 1, S3 2, S4 3, S5 2 |

Capturas: `test-results/shots/supply-v2-s5-{acuerdos,oferta-comision,portal-ventas,economia,liquidacion,portal-liquidacion,movil-checkout,movil-portal}.png`.

## 20 · REGRESSION SLICES 1–4

| Puerta | Resultado |
| --- | --- |
| `npm run test:db` (S1–S5, PostgreSQL real) | **114 pass · 0 fail** (95 de S1–S4 + 19 de S5) |
| `npm test` (dominio) | **3 325 pass · 0 fail** (incluye los 22 de S5 y `bitacora-etiquetas` con las 12 acciones nuevas) |
| `tsc --noEmit` | exit 0 |
| `eslint src tests` | 0 errores (15 avisos preexistentes, ninguno en archivos del slice) |
| `next build` | ✓ Compiled successfully (2.0 min), exit 0 |
| `scripts/permisos-catalogo.mjs` | ✓ 93 funciones, guardia viva |
| `scripts/rls-cobertura.mjs` | ✓ |
| `scripts/transacciones-anidadas.mjs` | ✓ ninguna |
| Migración nueva (dos archivos) | `20261014_supply_v2_slice5_enums` (solo `CREATE TYPE` / `ADD VALUE IF NOT EXISTS`: PostgreSQL no permite usar un valor de enum nuevo en la misma transacción) + `20261015_supply_v2_slice5` (tablas, columnas, índices, 9 CHECK, todo idempotente). Base nueva: `migrate deploy` ⇒ **169 aplicadas**; segunda pasada ⇒ «No pending migrations»; `migrate diff --from-migrations --to-schema-datamodel` ⇒ **sin diferencias** (exit 0); `sellar-migraciones` ⇒ 169 selladas; `rls-capa2-preflight` ⇒ ✓. Migraciones previas: sin cambios. |
| Fixtures de slices previos tocados | `supply-v2-slice2.db.test.ts` (3 `!` por `allocationId` ahora opcional), `supply-v2-slice4.spec.ts` (2 `!` por `lotId` opcional), `supply-v2-dominio.test.ts` (COMMISSION ya es válido; se prueba `HYBRID`), `supply-v2-slice2.spec.ts` (selectores del cliente filtrados por `visible: true`, ver nota). Ninguna aserción de comportamiento previa se relajó. |
| ⚠️ Nota E2E S2 | En la primera corrida de regresión el E2E del Slice 2 falló por «strict mode violation» (dos `estado-compra` / `mis-derechos`). Se reprodujo con una sonda: Next 16.3 (subido por `origin/main`) deja unos instantes la página anterior **oculta** (`hidden`) en el DOM al navegar, y Playwright la cuenta. Los arneses de S3 y S4 ya filtraban por visible; se aplicó lo mismo a S2. No es un cambio de comportamiento de la aplicación: la sonda sobre `/cliente/compras` muestra **una** lista. |

## 21 · SUPPLY V1 INTACT

`git diff origin/main --stat -- src/modules/supply src/app/(superadmin)/superadmin/supply src/app/(admin)/admin/supply src/components/supply` ⇒ **vacío**.
Tablas `supply_*` de V1: sin cambios en el esquema ni en las migraciones. ✅

## 22 · DEFINITION OF DONE (§91)

| Criterio | Estado | Evidencia |
| --- | --- | --- |
| Agreement COMMISSION funciona | ✅ | DB B; dominio 7–8 |
| ITEM scope | ✅ | DB B, A; E2E override |
| CATEGORY scope | ✅ | DB B, C; dominio 10 |
| CATALOG scope | ✅ | DB B, D; E2E catálogo |
| Precedencia ITEM > CATEGORY > CATALOG | ✅ | dominio 10–11; DB B; DEMO precedencia |
| Agreement version snapshot | ✅ | DB B (`snapshot.payableRecognition`), A (`agreementVersionId`) |
| Commission offer sin lot | ✅ | DB A; E2E SQL |
| Marketplace unificado | ✅ | DB A, C, D; E2E |
| Checkout unificado | ✅ | DB A, E; E2E |
| Fixed capacity | ✅ | DB A, C |
| Unlimited capacity | ✅ | DB D; E2E |
| Concurrencia capacidad | ✅ | DB C |
| No overselling | ✅ | DB C |
| Customer limit | ✅ | DB D |
| Entitlement commission sin lot | ✅ | DB A; CHECK |
| QR/redeem reutiliza Slice 3 | ✅ | E2E escáner; DB A |
| No ledger de lot commission | ✅ | DB A, I, J; E2E SQL |
| Redemption crea obligación correcta | ✅ | DB A, DEMO |
| Obligation idempotente | ✅ | DB A, F |
| Commission amount correcto | ✅ | DB E, J, DEMO |
| Supplier net correcto | ✅ | DB E, J, DEMO |
| GMV correcto | ✅ | DB A, J economía |
| Revenue Membego correcto | ✅ | DB A, J economía |
| Supplier money no contado como revenue | ✅ | DB J economía; dominio 21 |
| Settlement funciona | ✅ | DB A; E2E |
| Settlement lines | ✅ | DB A; E2E |
| No obligation en dos settlements | ✅ | DB G |
| Approval settlement | ✅ | DB A; E2E (SoD) |
| Partial payment settlement | ✅ | DB H |
| Full payment settlement | ✅ | DB A, H, DEMO; E2E |
| Obligations quedan PAID | ✅ | DB A, DEMO; E2E |
| Provider portal ventas | ✅ | E2E escritorio y móvil |
| Provider portal settlements | ✅ | E2E escritorio |
| Reconciliation commission | ✅ | DB J; E2E |
| Discrepancy funciona | ✅ | DB J; E2E |
| Historical agreement unchanged | ✅ | importes desde el derecho/redención; DB J redondeo (acuerdo nuevo no toca ventas previas) |
| Audit log | ✅ | §17 |
| Backend auth | ✅ | §16 |
| Ownership proveedor | ✅ | §14 |
| Decimal | ✅ | `core/comision.ts`; columnas `Decimal(14,2)` |
| Idempotencia | ✅ | §18 |
| Concurrency tests | ✅ | §15 (7 casos) |
| Unit tests | ✅ | 22 (dominio S5) |
| PostgreSQL tests | ✅ | 19 (S5) |
| E2E commission | ✅ | escritorio |
| E2E catalog-wide | ✅ | escritorio (Gorra 5 %) y móvil |
| E2E override | ✅ | escritorio (Saona 10 % sobre catálogo 5 %) |
| E2E mobile | ✅ | móvil |
| Slices 1–4 verdes | ✅ | §20 |
| Supply V1 intacto | ✅ | §21 |
| typecheck | ✅ | exit 0 |
| lint | ✅ | 0 errores |
| build | ✅ | exit 0 |

Demo §92 reproducida tal cual en PostgreSQL (`DEMO · Little Pizza` y `DEMO · precedencia`):
GMV 1 000 · Membego 100 · proveedor 900 · obligación 900 · liquidación 900 · pago 900 ⇒
Settlement PAID · Obligation PAID · outstanding 0; catálogo 10 / Pizzas 12 / Premium 15 ⇒ 150 / 850;
No Purchase Order · No Receipt · No Supply Lot · No fake allocation (consultas `count = 0`).

## 23 · REAL RISKS

| Riesgo | Detalle | Mitigación / decisión |
| --- | --- | --- |
| ⚠️ Vigencia del derecho a comisión | `expiresAt` = fin de la oferta. Quien compra el último día tiene poco margen; sin fecha de fin no vence nunca. | Es explícito en el wizard. Un «validez N días» es un campo futuro (no estaba en el prompt). |
| ⚠️ Liquidación con obligación parcialmente pagada | La línea lleva bruto y comisión completos y el neto = **saldo pendiente**: los totales de esa liquidación no son proporcionales. | Documentado en el código; el caso solo ocurre si se pagó una obligación suelta antes de liquidar. |
| ⚠️ Conciliación de comisión por fecha de entrega | «Interno» agrupa por `recognizedAt` de la obligación (fecha de entrega), no por fecha de venta. | Es coherente con «la deuda nace al entregar»; la pantalla lo dice. |
| ⚠️ CHECK `supply_v2_offers_prices` sustituido | Se dropea y recrea en la migración nueva para admitir `quantityLimit = 0` solo en comisión sin tope. | Ninguna migración previa se editó; la regla anterior se mantiene para el resto. |
| ⚠️ `enlazarObligacionesAFacturaEnTx` | Ahora excluye obligaciones de comisión y las que ya están en una liquidación. Afecta a PAY_LATER ON_REDEMPTION solo si alguien liquidara una entrega de lote (imposible: no son elegibles). | Prueba F2 de S4 sigue verde. |
| ⚠️ Un solo rol | Como en S4, todos los permisos resuelven a SUPERADMIN (`rolPuede`); la segregación se apoya en «otra persona», no en roles distintos. | Igual que S4; el catálogo de permisos ya está separado para cuando haya roles. |
| ⚠️ Capacidad y SOLD_OUT | SOLD_OUT se marca al pagar (no al reservar): con la última unidad reservada la oferta sigue ACTIVE pero el checkout la rechaza por `libres = 0`. | Mismo criterio que S2 para prepago. |

## 24 · PENDING SLICE 6 (§94, no implementado)

PARTIAL BENEFITS · SUBSIDIES · HYBRID PAYMENT · COUPONS · MEMBERSHIPS · REFERRALS ·
REWARDS · CAMPAIGNS. En particular «pedido 1 000, bono 500, cliente paga 500»: hoy
`customerUnitPrice` es lo que paga el cliente y el reparto de comisión se calcula sobre
ese importe; un subsidio necesitará separar «precio del pedido» de «pagado por el
cliente» y «pagado por Membego» en la orden, el derecho y el evento económico. Nada de
eso se tocó.
