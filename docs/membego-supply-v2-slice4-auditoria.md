# MEMBEGO SUPPLY 2.0 — Auditoría del Vertical Slice 4

Fecha: **2026-09-30** · Rama: `claude/jolly-brahmagupta-dmhml9`.
Alcance: SUPPLIER FINANCE + SUPPLY ECONOMICS — factura → pago / depósito →
aplicación → obligación → saldo → recepción / venta → redención / vencimiento
→ reconocimiento de costo → unit economics → conciliación.

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
| `main` remoto al iniciar | `origin/main` = `7fcd58d` (merge del PR #530). | ✅ |
| Slices 1, 2 y 3 presentes | `git log origin/main`: `36b2c3c` (S1), `ffaaffc` (S2), `c5d22d8` (fix S2), `b7e2663` (S3) son ancestros. | ✅ |
| Rama creada desde esa base | `git checkout -B claude/jolly-brahmagupta-dmhml9 origin/main`. | ✅ |
| Pruebas de S1–S3 antes de escribir código | Sobre `7fcd58d`: `npm run test:db` 79 pass · 0 fail; `tsc --noEmit` exit 0; `migrate deploy` en base nueva: 166 migraciones. | ✅ |
| S1–S3 no reescritos | Archivos de slices anteriores tocados: 12 (+317 −22), todos ampliaciones: política en el acuerdo y su snapshot, hooks de una línea en recepción/checkout/redención, cron, prefijos de numeración, etiquetas, permisos, referencia `LOT` del ledger. `allocations/`, `offers/`, `catalog/`, `suppliers/`, `marketplace/` y las migraciones `20261010`–`20261012`: **0 archivos**. | ✅ |
| Cambio de comportamiento en S3, justificado | `expirarDerechosEnTx` ahora cierra la unidad (ISSUED → CLOSED, §27): era la deuda declarada del Slice 3. El fixture de la prueba I de S3 forzaba un derecho REDIMIDO a ACTIVE (inconsistente con el ledger); se cambió por un derecho nuevo y coherente (+asertos ISSUED −1 / CLOSED +1). | ✅ |

## 2 · ARQUITECTURA

| Criterio | Evidencia | Archivo |
| --- | --- | --- |
| Dos subdominios separados (§4) | `finance/` (facturas, depósitos, pagos, aplicaciones, obligaciones, conciliación, adjuntos) y `economics/` (eventos, agregación, timeline). Tablas por familia, no una tabla financiera única. | `src/modules/supply-v2/{finance,economics}/` |
| No es un ERP (§5) | Sin plan de cuentas, sin partida doble, sin impuestos corporativos, sin conciliación bancaria. Los CHECK garantizan solo los saldos del subledger. | `supply-v2.prisma` (cabecera Slice 4) |
| Reglas puras separadas de la base | `finance/domain.ts` (totales, aplicación, saldos, SoD, política de la versión, conciliación) y `economics/domain.ts` (agregación, snapshot de venta, ventanas). 22 pruebas sin Prisma. | `tests/supply-v2-slice4-dominio.test.ts` |
| Las aplicaciones son la verdad; los saldos son caché | `recalcularObligacion/Factura/Deposito/PagoEnTx` reconstruyen desde aplicaciones vivas (`reversedAt IS NULL AND type <> 'REVERSAL'`). Reversar = crear fila REVERSAL + recalcular. | `finance/applications.ts` |
| V2 no importa V1 | `grep "modules/supply/"` en `supply-v2`, `components/supply-v2`, `superadmin/supply-v2`: **0**. Único punto compartido: el bucket privado de comprobantes (tipo `supply-v2`, +5 −2 líneas en `storage/`). | — |
| Dinero con Decimal (§52) | Todos los campos `Decimal(14,2)`/`(12,2)`; cálculos con `Prisma.Decimal`; los DTO viajan como texto con dos decimales. `grep "count()\s*+\s*1"`: solo el comentario de prohibición. | `core/dinero.ts`, `finance/domain.ts` |
| Numeración serializada | `MBG-SI`, `MBG-SD`, `MBG-SP`, `MBG-OB`, `MBG-RN` por `siguienteNumero` (`pg_advisory_xact_lock`). | `core/numeracion.ts` |

## 3 · ENTIDADES

10 tablas nuevas (32 `supply_v2_*` en total; V1 sigue con sus 30 `supply_*`).

| Entidad | Tabla | Qué guarda | Estado |
| --- | --- | --- | --- |
| `SupplyV2SupplierInvoice` | `supply_v2_supplier_invoices` | Documento del proveedor: PO opcional, número del proveedor, fechas, subtotal/impuestos/total, `amountApplied` (depósito) / `amountPaid` (pagos) / `amountDue`, adjunto, quién registró/aprobó, idempotencyKey. | ✅ |
| `SupplyV2SupplierInvoiceLine` | `…_invoice_lines` | Línea con `descriptionSnapshot`, cantidad, costo, subtotal, impuestos, total; enlaza a la línea de la PO. | ✅ |
| `SupplyV2SupplierDeposit` | `…_deposits` | Original / disponible / aplicado / reembolsado; `paymentId` único (un pago financia a lo sumo un depósito). | ✅ |
| `SupplyV2SupplierDepositMovement` | `…_deposit_movements` | DEPOSIT_CREATED / APPLIED / RELEASED / REFUNDED / ADJUSTMENT con `amount` firmado y `balanceAfter`. Σ movimientos = saldo. | ✅ |
| `SupplyV2SupplierPayment` | `…_payments` | Método, monto, `appliedAmount`, referencia, comprobante, PENDING → CONFIRMED (por otra persona) → aplica a lo declarado (`intendedInvoiceId` / `intendedObligationId` / `intendedDeposit`). | ✅ |
| `SupplyV2PaymentApplication` | `supply_v2_payment_applications` | Dinero ↔ deuda: PAYMENT/DEPOSIT_TO_INVOICE/OBLIGATION, PAYMENT_TO_DEPOSIT, REVERSAL (`reversalOfId` único). Nunca se borra. | ✅ |
| `SupplyV2SupplierObligation` | `…_obligations` | Lo que se debe y por qué: `sourceType + sourceId` único, `recognitionBasis`, `agreementVersionId`, gross/paid/outstanding, vencimiento. | ✅ |
| `SupplyV2EconomicEvent` | `supply_v2_economic_events` | SALE_REVENUE / BREAKAGE / EXPIRATION_COST (REDEMPTION_COST, REVERSAL, ADJUSTMENT reservados) con gmv/revenue/cost/margin, `units`, metadata congelada. Único por `type + referenceType + referenceId`. | ✅ |
| `SupplyV2Reconciliation` / `…Line` | `supply_v2_reconciliations`, `…_lines` | Periodo, `internalAmount`, `supplierAmount?`, diferencia, OPEN/MATCHED/DISCREPANCY/RESOLVED; líneas por fuente. Único por proveedor + periodo. | ✅ |

Acuerdo (§20): `payableRecognition` (ON_INVOICE por defecto / ON_RECEIPT / ON_REDEMPTION),
`allowDepositApplication`, `settlementFrequency`; los tres van en el `snapshot` de la
versión y las obligaciones apuntan a `agreementVersionId` (§21).

## 4 · MIGRACIÓN

| Comprobación | Evidencia | Estado |
| --- | --- | --- |
| Una migración nueva, ninguna aplicada se edita | `prisma/migrations/20261013_supply_v2_slice4/migration.sql` (847 líneas); `git diff` sobre `20261010`–`20261012` y `20260926_membego_supply`: 0. | ✅ |
| Solo crea | 10 `CREATE TABLE IF NOT EXISTS`, 14 enums, 19 `ADD VALUE IF NOT EXISTS` (AuditAccion + `LOT`), 3 `ADD COLUMN IF NOT EXISTS` con default en `supply_v2_agreements`, 42 FKs, 16 índices únicos, 28 índices; **0** `DROP`/`DELETE`/`UPDATE`. | ✅ |
| Base vacía → `migrate deploy` | Base `fresca2` creada desde cero: «167 migrations found … All migrations have been successfully applied»; `_prisma_migrations`: 167 terminadas; 32 tablas `supply_v2_*`, 30 `supply_*` de V1. | ✅ |
| Segunda pasada | «No pending migrations to apply». El SQL aplicado a mano dos veces sobre `membego_dev`: solo `NOTICE … already exists, skipping`. | ✅ |
| Barreras fuera del modelo Prisma | Índice único parcial `supply_v2_supplier_invoices_numero_proveedor` (`WHERE supplierInvoiceNumber IS NOT NULL AND status <> 'CANCELLED'`); 10 CHECK: `invoices_money` (due = total − paid − applied, ≥ 0), `invoice_lines_money`, `deposits_money` (available = original − applied − refunded, ≥ 0), `deposit_movements_balance`, `payments_money` (applied ≤ amount), `payments_status`, `payment_applications_shape` (un origen, un destino, reversa con original y motivo), `obligations_money`, `economic_events_margin`, `reconciliations_period`. Los 10 presentes en la base nueva. | ✅ |
| Drift | `prisma migrate diff --from-migrations … --shadow-database-url … --exit-code`: exit 0; contra la base recién creada (`--from-url`): exit 0. | ✅ |
| Sello | SHA-256 del `migration.sql` (`0c2e76ca…`) = línea de `SUMAS.txt`. | ✅ |
| RLS Capa 2 preflight (base nueva) | «Ninguna tabla se quedaría denegada» (las 10 tablas llegan por FK NOT NULL a `supply_v2_suppliers` / `users`). | ✅ |

## 5 · SUPPLIER INVOICES

| Criterio | Evidencia | Test |
| --- | --- | --- |
| Totales en el servidor con Decimal, impuesto por línea, las líneas suman el total | dominio 1 (`calcularTotalesFactura`: 1000 × 300 = 300 000,00; 3 × 33,33 + 0,10 al 18 % = 118,11). | dominio 1 |
| Factura → PO (prioridad §9); no factura más de lo comprado, ni sumando facturas previas | dominio 2; DB **E**: segunda factura de la misma línea → «solo quedan 0 unidades por facturar». Candado `FOR UPDATE` sobre la PO. | dominio 2; DB E |
| Duplicado bloqueado (§10) | DB **E**: mismo `supplierInvoiceNumber` → «ya está registrada como MBG-SI-…»; índice único parcial en la base; E2E: el formulario muestra el error. DB **L**: tras cancelar, el número queda libre. | DB E, L; E2E |
| Idempotencia al registrar | DB **E**: misma `idempotencyKey` → misma factura (`repetida = true`). | DB E |
| Aprobación por otra persona (§41) crea o enlaza la obligación | DB **E** (1 obligación INVOICE 300 000, `invoiceId` puesto; aprobar dos veces no duplica); DB **M** (el creador no aprueba: «no la aprueba la misma persona»). | DB E, M |
| Estados | PENDING_APPROVAL → APPROVED → PARTIALLY_PAID → PAID; CANCELLED solo sin aplicaciones vivas. | dominio 7; DB L |
| Adjunto (§42) | Bucket privado `comprobantes` existente con tipo `supply-v2` (ruta firmada por el servidor para ESA factura, `rutaValida` antes de guardar). | `finance/attachments.ts`, `components/supply-v2/finanzas/adjunto.tsx` |
| SQL tras el E2E | `MBG-SI-2026-000037` LP-…-001: PAID · total 300 000,00 · aplicado 0,00 · pagado 300 000,00 · pendiente 0,00. | SQL |

## 6 · DEPOSITS

| Criterio | Evidencia | Test |
| --- | --- | --- |
| Nace de un pago CONFIRMADO marcado como anticipo (nunca de la nada) | DB **A**: pago 100 000 `asDeposit` → confirmar → depósito ACTIVE 100 000 con movimiento DEPOSIT_CREATED. | DB A |
| Σ movimientos = saldo (§12) | DB **A**, **K**, **C**: `saldoDeMovimientos` = `availableAmount` en cada paso; ficha del depósito muestra la suma; SQL tras el E2E: disponible 85 000,00 = Σ movimientos 85 000,00. | DB A, K, C; SQL |
| Pago directo no toca el depósito (§16) | DB **B**: factura 20 000 pagada por transferencia → depósito sigue en 85 000, sin movimientos nuevos. | DB B |
| Excedente → depósito EXPLÍCITO (§56) | DB **D**: `crearDepositoDesdePagoEnTx` con lo no aplicado (6 000); un pago financia a lo sumo un depósito (`repetido`). UI: «Convertir en depósito». | DB D |
| Estados | ACTIVE / EXHAUSTED / CANCELLED / REFUNDED derivados del saldo. | dominio 3, 18 |

## 7 · PAYMENTS

| Criterio | Evidencia | Test |
| --- | --- | --- |
| Métodos | BANK_TRANSFER, CASH, OTHER (DEPOSIT reservado como asiento). | `finance/payments.ts` |
| PENDING → CONFIRMED por otra persona; un pago sin confirmar no cubre nada ni se aplica | DB **E** (PENDING no baja el pendiente), DB **M** («todavía no está confirmado»). | DB E, M |
| Al confirmarse se aplica a lo declarado hasta lo que quepa; lo demás queda «sin aplicar» a la vista | DB **E** (300 000 → factura), **A** (anticipo → depósito), **D** (8 000 sobre 2 000 pendientes → 2 000 aplicados, 6 000 sin aplicar). | DB E, A, D |
| Idempotencia | DB **E**: misma clave → mismo pago; confirmar dos veces → `repetido`. | DB E |
| Cancelar solo sin aplicaciones vivas, con motivo | DB **L**. | DB L |
| SQL tras el E2E | `bool_and(createdById <> confirmedById)` sobre pagos CONFIRMED: **true**. | SQL |

## 8 · PAYMENT APPLICATIONS

| Criterio | Evidencia | Test |
| --- | --- | --- |
| Un origen (pago o depósito) y un destino (factura → sus obligaciones, o una obligación) | CHECK `payment_applications_shape`; `aplicarEnTx` rechaza dos orígenes o dos destinos. | `finance/applications.ts` |
| Depósito + transferencia sobre la misma factura (§15) | DB **A**: 15 000 depósito + 5 000 pago → PAID, aplicado 15 000, pagado 5 000, 2 aplicaciones vivas, ninguna duplicada; E2E idéntico. | DB A; E2E |
| No sobrepagar (§55–§56) | dominio 4, 8; DB **D**; CHECK `invoices_money` rechaza `amountDue` negativo aunque el código fallara. | dominio 4, 8; DB D |
| Idempotencia | DB **A**: misma clave → mismas aplicaciones (`repetida`). | DB A |
| Reversa (§57): no borra, crea REVERSAL y restaura saldos | DB **K**: reversar el pago → factura vuelve a PARTIALLY_PAID, pago recupera su saldo; reversar el depósito → APPROVED, depósito 100 000 (movimiento DEPOSIT_RELEASED); 4 filas (2 originales + 2 reversas); segunda reversa rechazada; se vuelve a aplicar. | DB K; dominio 18, 19 |
| Mismo proveedor y misma moneda | DB **M** («proveedores distintos»). | DB M |
| SQL tras el E2E | 46 aplicaciones vivas, 46 distintas. | SQL |

## 9 · OBLIGATIONS

| Criterio | Evidencia | Test |
| --- | --- | --- |
| NO TODA REDENCIÓN CREA CxP (§2) | DB **E2**: PREPAID → recibir y redimir no crean obligación; pendiente del proveedor 0,00; E2E: obligaciones del proveedor = 1 (Pagada). | DB E2; E2E |
| La política sale de la VERSIÓN del acuerdo (§19–§21), nunca del acuerdo actual | `politicaDeVersion(snapshot)`; versiones anteriores al Slice 4 → ON_INVOICE / depósito permitido; obligaciones con `agreementVersionId`. | dominio 9–11; DB F |
| PAY_LATER ON_RECEIPT (§64) | DB **F**: recepción 100 → obligación 30 000 (RECEIPT, vence +30 d); la factura se ENLAZA (sigue habiendo 1); pago 10 000 → pendiente 20 000. | DB F |
| PAY_LATER ON_REDEMPTION | DB **F2**: recibir/vender no deben nada; entregar → 300 (REDEMPTION); reversa → CANCELLED; nueva entrega → nueva obligación. | DB F2 |
| Única por hecho (`sourceType + sourceId`) | `reconocerObligacionEnTx` devuelve la existente; aprobar dos veces no duplica. | DB E |
| Estados sin negativos (§39) | CHECK `obligations_money`; `estadoObligacionSegunSaldo`. | dominio 19 |
| PO refleja el pago | DB **E**: PO → PAID al pagar la factura (solo si la máquina de estados lo admite; tras recibir queda RECEIVED). | DB E |

## 10 · ECONOMIC EVENTS · 11 · COST RECOGNITION · 12 · MARGIN

**Modelo de costo elegido (§29), tras auditar S2/S3:** el costo de la unidad vendida se
reconoce **una sola vez, al emitir el derecho** (pago del cliente confirmado), porque en
ese instante ya se comprometió una unidad concreta de un lote concreto (`actualUnitCost`).
Redimir, reversar y vencer son operacionales y no escriben dinero. `REDEMPTION_COST` y
`REVERSAL` quedan declarados en el enum para el modelo por comisión del Slice 5.

| Criterio | Evidencia | Test |
| --- | --- | --- |
| SALE_REVENUE al confirmar el pago, idempotente (§24) | DB **E2**: 1 evento (399 / 300 / 99, gmv 399); `reconocerVentaEnTx` de nuevo → `repetido`; índice único `type+referenceType+referenceId`. | DB E2 |
| Snapshot reconstruible sin precios actuales (§30) | metadata: `customerPaid 399.00`, `publicPrice 600.00`, `discount 201.00`, `actualUnitCost 300.00`, `grossMargin 99.00`; página de la venta lo enseña. | DB E2; dominio 12; E2E |
| Costo nunca desde `publicPrice` (§51) | `snapshotDeVenta` toma `actualUnitCost` del derecho; `EXPIRATION_COST` usa `lot.unitCost`. | `economics/service.ts` |
| Costo exactamente una vez; redimir/reversar/redimir no duplica (§26, §67) | DB **H** y **F2**: tras redimir, reversar y redimir, 1 evento, Σ costo 300. | DB H, F2; dominio 13, 14 |
| Margen | `calcularEconomia`: revenue 399 · cost 300 · margin 99 (E2), 24,81 % (dominio 17). | DB E2; dominio 17 |
| Ventas anteriores sin evento | `proyectarVentasSinEventoEnTx` en el cron (idempotente). | `commerce/barrido.ts` |

## 13 · BREAKAGE · 14 · EXPIRATIONS

| Criterio | Evidencia | Test |
| --- | --- | --- |
| Derecho vencido: EXPIRED, ISSUED → CLOSED, nunca a AVAILABLE (§27) | DB **G**: issued −1, closed +1, available igual; asiento EXPIRATION ISSUED→CLOSED con referencia ENTITLEMENT; segunda pasada no repite. | DB G; dominio 15 |
| BREAKAGE sin duplicar costo; el ingreso se conserva (§28, §66) | DB **G**: eventos = {SALE_REVENUE, BREAKAGE}, Σ ingreso 399, Σ costo 300; compra sigue PAID. | DB G; dominio 14, 16 |
| Cron tolerante | Cada derecho en su transacción; uno inconsistente se cuenta en `derechosConError` y se registra, sin bloquear a los demás. | `commerce/barrido.ts` |
| Lote vencido (§49): AVAILABLE/ALLOCATED → CLOSED; RESERVED/ISSUED intactos | DB **J**: [5,3,1,1] → [0,0,1,1, closed 8]; la asignación libera 3 (la oferta deja de venderlas); segunda pasada = nada. | DB J |
| Valor de Supply vencido a costo histórico (§50) | DB **J**: EXPIRATION_COST 8 × 300 = 2 400 en el reporte y el tablero. | DB J |
| Tasa de breakage | DB **G**: 2 vendidas, 1 vencida → 50 %. | DB G; dominio 16 |
| E2E | Cliente 2 compra y no usa; el arnés adelanta el reloj y dispara `/api/cron/supply-v2` → «Vencido», emitidas 1→0, lote issued −1 / closed +1, reporte: vendidas 2, vencidas 1, ingreso 798, costo 600; venta con «breakage» en el timeline. SQL: derecho EXPIRED, lote issued 0 / closed 1 / redeemed 1. | E2E; SQL |

## 15 · RECONCILIATION

| Criterio | Evidencia | Test |
| --- | --- | --- |
| Fuentes internas (§46): facturas, pagos, depósitos, obligaciones, aplicaciones de depósito; redenciones solo como obligaciones REDEMPTION | `fuentesInternasEnTx`. | DB I (≥ 6 líneas) |
| Sin estado del proveedor NO hay MATCHED (§45) | DB **I**: OPEN, «Sin información del proveedor»; periodo vacío → OPEN con 0 líneas; resolver sin monto → rechazado. | DB I; dominio 20 |
| Discrepancia | DB **I**: interno + 1 500 → DISCREPANCY (−1 500,00); mismo monto → MATCHED; resolver exige notas; líneas → RESOLVED. | DB I |
| Idempotente por proveedor + periodo | DB **I** (`repetida`). Líneas paginadas en la ficha (§47). | DB I |

## 16 · CONCURRENCY

| Riesgo | Mecanismo | Test |
| --- | --- | --- |
| Dos aplicaciones de 8 000 sobre un depósito de 10 000 (§54) | Candado `FOR UPDATE` en orden fijo pago → depósito → factura → obligaciones; el segundo relee y ve 2 000. CHECK `deposits_money` como última red (rechaza −6 000). | DB **C**: 1 éxito, 1 «solo tiene 2000.00 disponible», saldo 2 000, nunca negativo |
| Dos pagos de 8 000 sobre una factura de 10 000 (§55) | Mismo orden de candados; `validarAplicacion` contra el pendiente REAL. CHECK `invoices_money` rechaza pendiente negativo. | DB **D**: 1 éxito, 1 «No se permite sobrepagar», pagado 8 000 / pendiente 2 000 |
| Doble clic | `idempotencyKey` en factura, pago, aplicación, depósito, conciliación (clave generada en el servidor al pintar el formulario). | DB E, A |
| Doble aprobación / confirmación | Candado + estado; segunda llamada devuelve `repetida/repetido`. | DB E |

## 17 · AUTHORIZATION

| Criterio | Evidencia |
| --- | --- |
| Seis permisos separados (§40) | `SUPPLY_V2_FINANCE_VIEW`, `INVOICE_MANAGE`, `DEPOSIT_MANAGE`, `PAYMENT_CREATE`, `PAYMENT_APPROVE`, `RECONCILE` en `contracts/gateways.ts`; cada action exige el suyo (`actions-finanzas.ts`). Hoy todos los resuelve el rol SUPERADMIN (misma política que S1–S3). |
| Segregación en el servidor (§41) | `puedeConfirmarPago` / `puedeAprobarFactura`: creador ≠ confirmador cuando hay más de una persona autorizada (`count(SUPERADMIN)`). DB **M** y dominio 21. E2E: Compras registra, Finanzas confirma. |
| Rutas | `/superadmin/supply-v2/finanzas/**` y `/economia` con `requireRole('SUPERADMIN')`; acciones visibles solo con `puedeSupplyV2(...)`. |
| Adjuntos | Solo SUPERADMIN sube (`puedeSubir('supply-v2')`); URL de lectura firmada 5 min por `urlComprobante`. |
| Catálogo de permisos y RLS (CI) | `permisos-catalogo.mjs`, `rls-cobertura.mjs`, `transacciones-anidadas.mjs`: exit 0. |

## 18 · AUDIT

19 acciones nuevas en `AuditAccion`, todas con etiqueta (`tests/bitacora-etiquetas.test.ts` en verde) y
todas escritas dentro de la misma transacción: INVOICE_CREATED/APPROVED/CANCELLED,
DEPOSIT_CREATED/APPLIED/REVERSED, PAYMENT_CREATED/CONFIRMED/APPLIED/REVERSED/CANCELLED,
OBLIGATION_RECOGNIZED/PAID/CANCELLED, ECONOMIC_EVENT_CREATED, RECONCILIATION_CREATED/RESOLVED,
ENTITLEMENT_EXPIRED (ahora con `ledger: ISSUED→CLOSED`), LOT_EXPIRED. DB **M** comprueba que las 19
aparecen; SQL tras el E2E: 19 acciones distintas. Nada financiero se borra (§60): estados y reversas.

## 19 · UI

| Pantalla | Ruta | Evidencia |
| --- | --- | --- |
| Tablero de finanzas (§33) | `/superadmin/supply-v2/finanzas` | CxP, facturas pendientes, depósitos, pagos del mes, GMV, ingreso, costo, margen, supply vencido, breakage; sin datos → «Sin datos todavía»; nunca «todo cuadra». |
| Facturas (§35) | `/finanzas/facturas`, `/nueva`, `/[id]` | Lista paginada (`TablaPaginacion`) con Total/Aplicado/Pagado/Pendiente/Estado; nueva factura contra PO con líneas precargadas; ficha con aprobar, aplicar depósito, registrar/aplicar pago, reversar, cancelar, adjunto y timeline. |
| Depósitos (§36) | `/finanzas/depositos`, `/[id]` | Original/Disponible/Aplicado/Estado; ficha con el libro de movimientos y la suma. |
| Pagos (§37) | `/finanzas/pagos`, `/nuevo`, `/[id]` | Pago/Proveedor/Método/Monto/Fecha/Referencia/Aplicaciones/Estado; confirmar en línea; convertir excedente en depósito; comprobante. |
| Obligaciones (§38) | `/finanzas/obligaciones` | Proveedor/Origen/Monto/Pagado/Pendiente/Vence/Estado, paginado. |
| Conciliaciones (§43) | `/finanzas/conciliaciones`, `/nueva`, `/[id]` | Membego vs proveedor; «Sin información del proveedor»; líneas paginadas; resolver con notas. |
| Economía (§68) | `/superadmin/supply-v2/economia` | Hoy/7/30/Mes/Rango, proveedor y producto en el servidor; definiciones. |
| Perfil financiero del proveedor (§34) | `/proveedores/[id]` | Saldo a pagar, facturas pendientes, depósito disponible, pagado histórico, supply adquirido y timeline (depósito → factura → aplicación → transferencia → pagada). |
| Timeline financiero de la PO (§61) | `/compras/[id]` | PO creada → aprobada → factura → pago/depósito → factura pagada → recepción. |
| Timeline económico de la venta (§62) | `/ofertas/ventas/[id]` | Venta → derecho → costo → margen → redención / breakage, desde el snapshot. |
| Acuerdo (§20) | `form-acuerdo.tsx` | «Cuándo nace la deuda» y «cubrir facturas con depósito». |
| Paginación real (§47) | facturas, pagos, depósitos, obligaciones, conciliaciones y sus líneas: `{ filas, total }` + `leerPaginacion`. Sin `take: 200` silencioso. |

## 20 · E2E

Playwright 1.62, Chromium preinstalado, `next start -p 3210`, sesiones firmadas localmente
(`supply-v2-sesion.ts`). El arnés toca la base solo para usuarios, cuenta de cobro, empresa
proveedora con sucursal, adelantar el reloj de un derecho y leer el ledger del lote.

| Recorrido | Resultado |
| --- | --- |
| **Escritorio · PREPAID + VENCIMIENTO** (`tests/e2e/supply-v2-slice4.spec.ts`): empresa vinculada → producto → acuerdo (política ON_INVOICE visible) → PO 1 000 × 300 → aprobación → «+ Factura» desde la PO (líneas precargadas, subtotal 300 000) → factura pendiente de aprobación → duplicado rechazado en pantalla → Finanzas aprueba (obligación; perfil del proveedor: saldo 300 000, 1 factura) → Compras registra el pago (300 000 sugerido) → Finanzas lo confirma → factura **Pagada** 300 000 / 0 → PO «Pagada» y timeline «pagada» → recepción → oferta 100 @ 399 → cliente compra → redención por el escáner → pool 900/99/0/1 → perfil: **saldo 0**, 0 facturas pendientes, pagado 300 000 → economía: **399 / 300 / 99**, 1 vendida, 1 redimida, 0 vencidas → venta: cliente pagó 399, costo 300, margen 99, «Redención» → obligaciones: 1, Pagada → cliente 2 compra → reloj → cron → «Vencido», emitidas 0, lote issued −1 / closed +1, economía 2 vendidas / 1 vencida / 798 / 600, venta con «breakage», saldo del proveedor 0 | ✅ 1 passed (51,7 s) |
| **Escritorio · DEPÓSITO**: proveedor externo por la interfaz → anticipo 100 000 (Compras) → confirmado (Finanzas) → depósito Activo 100 000 → factura 20 000 sin PO → aprobada → aplicar depósito 15 000 (Parcialmente pagada, pendiente 5 000) → pago 5 000 (Compras) → confirmado (Finanzas) → **Pagada**, aplicado 15 000, pagado 5 000, pendiente 0, 2 aplicaciones, «Factura pagada» → depósitos: **85 000**; ficha: suma de movimientos 85 000, 2 movimientos → perfil: saldo 0, depósito 85 000, pagado 105 000, timeline con Depósito / Factura / Transferencia | ✅ 1 passed (19,2 s) |
| **Móvil (Pixel 7)**: anticipo confirmado → resumen (KPIs visibles, sin scroll horizontal) → facturas (título y «Nueva factura» visibles) → perfil financiero visible con depósito 1 000 | ✅ 1 passed (9,4 s) |
| Regresión E2E Slices 1–3 contra este build (`supply-v2-slice{1,2,3}.spec.ts`) | ✅ 7 passed (4 S1 + 1 S2 + 2 S3), 7 skipped por proyecto · 2,2 min |

Capturas: `test-results/shots/supply-v2-s4-{orden-pagada,economia,factura-deposito,movil-finanzas,movil-proveedor}.png`.

## 21 · REGRESSION SLICES 1–3

| Comprobación | Evidencia | Estado |
| --- | --- | --- |
| Suites de dominio S1–S4 y guardias del panel | `npm test`: **3 309 tests · 3 303 pass · 0 fail · 6 skipped** (incluye `bitacora-etiquetas`, `permisos-empleado`, `navegacion-*`). | ✅ |
| Suites PostgreSQL | `npm run test:db`: **95 pass · 0 fail** (V1 23 · S1 21 · S2 21 · S3 14 · S4 16). | ✅ |
| E2E S1–S3 | ver § 20. | ✅ |
| Ledger S1–S3 intacto | Solo se añade el uso de `EXPIRATION` (ya declarado en S1) y la referencia `LOT`; SQL: 48/48 lotes cuadran. | ✅ |
| `tsc --noEmit` / `eslint src tests` / `next build` | exit 0 / 0 errores (15 avisos preexistentes en otros módulos) / exit 0. | ✅ |

## 22 · SUPPLY V1 INTACTO

| Comprobación | Evidencia | Estado |
| --- | --- | --- |
| `git diff` sobre `src/modules/supply`, `components/supply`, `superadmin/supply`, `admin/supply`, `supply.prisma`, migración `20260926_membego_supply` | **0 archivos** | ✅ |
| V2 no importa V1 | `grep "modules/supply/"` en V2: 0 | ✅ |
| Tablas V1 en la base nueva | 30 `supply_*` (sin cambios) | ✅ |
| Archivos compartidos tocados | `identidad.prisma` (+30: relaciones inversas en `User`, 19 valores de `AuditAccion`), `auditoria/queries.ts` (+19 etiquetas), `storage/{tipos,comprobantes}.ts` (+5 −2: tipo `supply-v2`), `SUMAS.txt` (+1). | ✅ |

## 23 · DEFINITION OF DONE

| Criterio | Estado | Evidencia |
| --- | --- | --- |
| Supplier Invoice funciona | ✅ | DB E; E2E |
| Duplicate invoice bloqueada | ✅ | DB E, L; E2E |
| Invoice partial / full payment | ✅ | DB A, D, E |
| Supplier Deposit funciona; saldo reconstruible | ✅ | DB A, K; ficha del depósito |
| Deposit + transfer mix | ✅ | DB A; E2E |
| Direct payment does not consume deposit | ✅ | DB B |
| Payment applications; reversals | ✅ | DB A, K |
| No overpayment | ✅ | DB D; CHECK |
| Concurrency deposit / invoice protegida | ✅ | DB C, D |
| Supplier obligations correctas; PREPAID no crea AP duplicada; PAY_LATER crea obligación; la versión del acuerdo decide | ✅ | DB E2, F, F2; dominio 9–11 |
| Revenue / cost snapshot; cost no se duplica; gross margin | ✅ | DB E2, G, H; dominio 12–14, 17 |
| Entitlement expiration ISSUED → CLOSED; breakage; lot expiry segura | ✅ | DB G, J; E2E |
| Finance dashboard real; provider financial profile; invoices/deposits/payments/obligations/economics UI; reconciliation | ✅ | § 19; E2E |
| No fake «todo cuadra» | ✅ | tablero: «Sin datos todavía»; conciliación: OPEN sin monto del proveedor |
| Pagination real | ✅ | § 19 |
| Audit log; server authorization; segregation of duties | ✅ | § 17–18; DB M |
| Decimal en dinero; idempotencia | ✅ | § 2; DB E, A |
| Unit tests (22) · PostgreSQL tests (16) · E2E prepaid · deposit · expiration · mobile | ✅ | § 20 |
| Slice 1 · 2 · 3 verde; Supply V1 intacto | ✅ | § 21–22 |
| typecheck · lint · build | ✅ | § 21 |

## 24 · RIESGOS REALES

- **Permisos = rol SUPERADMIN.** Los seis permisos existen y cada action exige el suyo, pero `rolPuede` sigue resolviéndolos todos al rol de plataforma (política de S1). La segregación real hoy es «dos superadmins distintos». Repartirlos por persona es trabajo del RBAC, no de este slice.
- **ON_RECEIPT con factura menor que lo recibido.** La factura enlaza obligaciones de recepción completas mientras quepan en su total; una factura que cubra parte de una recepción deja esa obligación sin enlazar (sigue debiéndose por recepción, sin duplicar). No hay prorrateo por línea.
- **ON_REDEMPTION + factura.** La factura enlaza obligaciones de redención del proveedor (más antiguas primero). La liquidación periódica de verdad (statement por redenciones) es del Slice 5.
- **Reversa de una entrega ya pagada al proveedor** (ON_REDEMPTION): la obligación pagada se conserva con nota; no se genera crédito automático.
- **Reembolsos al cliente**: `REFUNDED` existe en la orden del cliente pero no hay flujo; `REVERSAL` económico queda reservado.
- **Cron diario** (Vercel Hobby): los vencimientos de derechos y lotes se procesan una vez al día; `derechosConError` avisa en el log si un derecho no se puede cerrar por inconsistencia del ledger.
- **Concurrencia probada con dos procesos**, no bajo carga; los CHECK son la última red.

## 25 · PENDIENTE SLICE 5

No implementado a propósito (§81): catálogo del proveedor sin precompra, acuerdo por COMISIÓN,
oferta sin supply comprado, fulfillment, obligación con el proveedor por lo vendido, comisión de
Membego y liquidación/settlement periódico; beneficios parciales, subsidios, venta híbrida.
Preparado para ello: `REDEMPTION_COST`/`REVERSAL` en el enum económico, `gmvAmount` separado de
`revenueAmount`, `PAYMENT_TO_OBLIGATION` para pagar obligaciones sin factura y el enlace de
obligaciones de redención a una factura.
