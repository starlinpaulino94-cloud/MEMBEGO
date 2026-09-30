# MEMBEGO SUPPLY 2.0 — Auditoría del Vertical Slice 2

Fecha: **2026-09-30** · Rama: `claude/inspiring-gates-2h8ew7`.
Alcance del slice: SUPPLY DISPONIBLE → ASIGNACIÓN (FEFO, multi-lote) → OFERTA →
MARKETPLACE → CHECKOUT (reserva con TTL) → PAGO (transferencia con confirmación
manual) → ENTITLEMENT (un derecho por unidad, con el costo real del lote).

Método: **no se marca ✅ por existencia de código**. Cada criterio se comprobó
contra una fuente primaria: la salida de las suites (unitarias, PostgreSQL,
Playwright), consultas SQL sobre lo que el recorrido dejó escrito, `git diff`
sobre las zonas prohibidas, y las mismas puertas que corre CI.

Leyenda: ✅ verificado con evidencia · ⚠️ observación o riesgo (no bloquea) ·
⛔ fuera de alcance por decisión del prompt.

---

## 1 · BASE COMMIT

| Comprobación | Evidencia | Estado |
| --- | --- | --- |
| `main` remoto al iniciar el slice | `origin/main` = `353651c` (merge del PR #526, auditoría de Supply V1) | ✅ |
| Slice 1 en `origin/main` | `git merge-base --is-ancestor 36b2c3c origin/main` → **no**. El prompt pedía partir del `main` «que ya contiene Slice 1», pero Slice 1 aún no se ha mezclado. | ⚠️ |
| Base efectiva del Slice 2 | Rama `claude/inspiring-gates-2h8ew7` = `353651c` + `36b2c3c` (Slice 1) + `b6575e3` (auditoría Slice 1). El Slice 2 se apila sobre ella, que es exactamente `main` + Slice 1. | ✅ |
| Slice 1 no se modifica | `git diff HEAD` sobre `src/modules/supply-v2/**` toca solo archivos extendidos (enum de referencia, catálogo, estados, numeración, permisos, adaptadores, consultas del pool); ninguna regla de Slice 1 cambia de comportamiento y su suite completa sigue en verde (§12). | ✅ |

## 2 · ARQUITECTURA

| Criterio | Evidencia | Archivo |
| --- | --- | --- |
| Módulo propio, en paralelo a V1 | Todo el slice vive en `src/modules/supply-v2/{allocations,offers,commerce,marketplace}` y `core/{fefo,precios,config}.ts`; 1 993 líneas nuevas de dominio + migración. | `src/modules/supply-v2/**` |
| Supply 2.0 no importa código de V1 | `grep "modules/supply/"` en `supply-v2`, sus pantallas y componentes: **0** coincidencias. | — |
| Identidad del cliente = `User` (rol `CLIENTE`) | `Cliente` de Core es por empresa; la compra Membego es de plataforma. `customerGateway.current()` exige rol `CLIENTE`. Sin `SupplyV2Customer`. | `contracts/adapters.ts`, `permisos.ts` (`exigirCliente`) |
| Cuenta de cobro de Membego leída de V1, solo lectura | `paymentAccountGateway` lee `supply_cuentas_cobro`; la orden guarda un **snapshot** (`paymentAccountSnapshot`) y el id sin FK. | `contracts/adapters.ts`, `supply-v2.prisma` |
| Único escritor del ledger | Todos los movimientos pasan por `registrarAsientoEnTx` (bloquea el lote `FOR UPDATE`); `ReferenciaAsiento.referenceType` ampliado a ALLOCATION / CUSTOMER_ORDER / ENTITLEMENT / OFFER. | `pool/lotes.ts:28` |
| Sin `count()+1`, sin flotantes en dinero | Numeración `MBG-OF` y `MBG-SO` por `pg_advisory_xact_lock` (`core/numeracion.ts:47`); precios con `Decimal` (`core/dinero.ts`, `core/precios.ts`). `grep "count()\s*+\s*1"`: 0. | `core/numeracion.ts`, `core/precios.ts` |
| Cron con el mismo mecanismo que el resto | `GET /api/cron/supply-v2` con `autorizarCron`; entrada horaria en `vercel.json`. | `src/app/api/cron/supply-v2/route.ts`, `vercel.json:30` |

## 3 · ENTIDADES NUEVAS

7 tablas `supply_v2_*` nuevas (18 tablas `supply_v2_*` en total; V1 sigue con sus 30 `supply_*`).

| Entidad | Tabla | Qué guarda | Estado |
| --- | --- | --- | --- |
| `SupplyV2Allocation` | `supply_v2_allocations` | Cuánto se aparta de un producto, para qué (OFFER / MANUAL), contadores asignado/reservado/emitido/liberado. | ✅ |
| `SupplyV2AllocationLine` | `supply_v2_allocation_lines` | Reparto por lote (FEFO), `@@unique([allocationId, lotId])`. | ✅ |
| `SupplyV2Offer` | `supply_v2_offers` | Precio público y Membego, límite por persona, vigencia, estados DRAFT → SCHEDULED/ACTIVE → PAUSED/SOLD_OUT → ENDED/CANCELLED, `slug` único, quién publicó. | ✅ |
| `SupplyV2CustomerOrder` | `supply_v2_customer_orders` | Orden del cliente (`MBG-SO`), totales congelados, `expiresAt`, pago (método, referencia, snapshot de cuenta, monto visto, quién confirmó), `idempotencyKey` único. | ✅ |
| `SupplyV2CustomerOrderLine` | `supply_v2_customer_order_lines` | Título y precios congelados por línea. | ✅ |
| `SupplyV2OrderReservation` | `supply_v2_order_reservations` | Reserva por lote y línea de asignación (ACTIVE / RELEASED / ISSUED). | ✅ |
| `SupplyV2Entitlement` | `supply_v2_entitlements` | **Una fila por unidad** (`quantity = 1`), `actualUnitCost` del lote real, `customerUnitPrice`, referencia a oferta, orden, asignación, línea y lote. | ✅ |

Enums nuevos: `SupplyV2AllocationPurpose`, `SupplyV2AllocationStatus`, `SupplyV2OfferSource`,
`SupplyV2OfferStatus`, `SupplyV2CustomerOrderStatus`, `SupplyV2PaymentStatus`,
`SupplyV2PaymentMethod`, `SupplyV2ReservationStatus`, `SupplyV2EntitlementOrigin`,
`SupplyV2EntitlementStatus`. Sin `SupplyV2User`, `SupplyV2Company`, `SupplyV2Branch`
ni `SupplyV2Customer` (`grep`: 0).

## 4 · MIGRACIÓN

| Comprobación | Evidencia | Estado |
| --- | --- | --- |
| Una migración nueva, ninguna aplicada se edita | `prisma/migrations/20261011_supply_v2_slice2/migration.sql` (nueva); `git status` no muestra cambios en migraciones anteriores. | ✅ |
| Aplicada y registrada | `_prisma_migrations`: `20261011_supply_v2_slice2` con `finished_at` no nulo; 165 migraciones terminadas. | ✅ |
| Idempotente | Enums en `DO … EXCEPTION WHEN duplicate_object`, `ADD VALUE IF NOT EXISTS`, `CREATE TABLE/INDEX IF NOT EXISTS`; aplicada dos veces sin error. | ✅ |
| Solo crea | 7 `CREATE TABLE`; 0 `DROP`/`DELETE`/`UPDATE` sobre tablas existentes. | ✅ |
| Invariantes en la base (CHECK) | `supply_v2_allocations_counters`, `supply_v2_allocation_lines_counters`, `supply_v2_offers_prices` (Membego ≤ público, límites > 0, `endsAt > startsAt`), `supply_v2_customer_orders_amounts` (total = subtotal − descuento), `supply_v2_customer_order_lines_amounts`, `supply_v2_order_reservations_quantity`, `supply_v2_entitlements_unit` (`quantity = 1`). Consulta `pg_constraint`: las 7 presentes. | ✅ |
| Drift esquema ↔ migraciones (gate de CI) | `prisma migrate diff --from-migrations … --exit-code` con base sombra: exit 0. | ✅ |
| Sello | `npm run migraciones:sellar -- --check`: exit 0; `SUMAS.txt` con la línea nueva. | ✅ |
| RLS Capa 2 preflight | `node scripts/rls-capa2-preflight.mjs`: exit 0. | ✅ |
| Relaciones inversas en Core | `identidad.prisma` +24 líneas: 6 relaciones en `User` y 16 valores `SUPPLY_V2_*` en `AuditAccion`. Nada más de Core cambia. | ✅ |

## 5 · INTEGRACIÓN MARKETPLACE

| Criterio | Evidencia | Archivo / Test |
| --- | --- | --- |
| Read model sin costos | DTO `MarketplaceSupplyOffer` expone id, slug, título, proveedor, producto, precios público/Membego, ahorro, %, vigencia, `available`, `remaining`, `perCustomerLimit`, `href`. **No** contiene `unitCost`, `actualUnitCost`, margen, lotes ni asignación (los contadores de asignación se leen dentro solo para calcular `remaining`). | `marketplace/read-model.ts` |
| Portada pública | `/promociones` muestra la sección `ofertas-membego` (12 ofertas comprables) cuando no hay filtros; el resto de la página no cambia (+28 −1 líneas). | `src/app/(public)/promociones/page.tsx` |
| Ficha pública por slug | `/promociones/membego/[slug]` con precio regular tachado, precio Membego, ahorro y botón de compra (o de login si es anónimo). | `src/app/(public)/promociones/membego/[slug]/page.tsx` |
| El HTML público no filtra datos internos | El E2E lee el HTML de la ficha y afirma que **no** contiene `unitCost`, códigos `LOT-` ni `allocation`. | `tests/e2e/supply-v2-slice2.spec.ts` |
| Ofertas futuras/pausadas/agotadas no se venden | `motivoNoComprable` cubre futura, vencida, pausada, agotada, sin unidades; el read model marca `available=false` y una oferta SOLD_OUT deja de listarse. | `core/estados.ts`; dominio «no comprable si…»; DB **H**, **J**, **L** |

## 6 · INTEGRACIÓN PAYMENTS

Auditoría previa de la infraestructura existente: `PaymentContext`, `MetodoPago` y
`Transaction` de Core son **por empresa** (carwash / merchant); el `SupplyPedido` de V1
acopla el pago a tablas V1. Ninguna sirve para que un cliente le pague a Membego
sin arrastrar V1 o inventar una empresa ficticia. Lo único reutilizable era la cuenta
de cobro de la plataforma (`supply_cuentas_cobro`), que se lee sin escribirla.

| Criterio | Evidencia | Archivo / Test |
| --- | --- | --- |
| Flujo real mínimo: transferencia + confirmación manual | Cliente ve la cuenta (snapshot), avisa el pago con referencia (`PENDING → AWAITING_PAYMENT`, `UNPAID → SUBMITTED`); Finanzas confirma con el monto visto (`→ PAID / CONFIRMED`) o rechaza (`→ CANCELLED / REJECTED`, reserva liberada). | `commerce/checkout.ts` (`avisarPagoEnTx`, `confirmarPagoEnTx`, `rechazarPagoEnTx`); DB **D**, **F2** |
| Monto cuadra | `montoCuadra` con tolerancia de un centavo; un monto distinto rechaza la confirmación. | `core/precios.ts`; dominio «monto visto» |
| Confirmación idempotente | Segunda confirmación (incluso concurrente) no emite un segundo derecho. | DB **D2** |
| Un pago avisado no expira | El barrido solo expira `PENDING`; `AWAITING_PAYMENT` aguanta hasta que Membego revise. | `commerce/barrido.ts:31`; DB **F2** |
| Pantalla de ventas para Finanzas | `/superadmin/supply-v2/ofertas/ventas` lista pagos por revisar con confirmar/rechazar. | `ofertas/ventas/page.tsx`, `form-confirmar-pago.tsx` |
| Fuera de alcance | Pasarelas, tarjetas, webhooks, reembolsos, conciliación (§ del prompt). `REFUNDED` existe en el enum pero no hay transición que lo produzca. | ⛔ |

## 7 · MOVIMIENTOS LEDGER

Invariante `quantityReceived = AVAILABLE + ALLOCATED + RESERVED + ISSUED + REDEEMED + CLOSED`
por lote. Consulta SQL sobre los 45 lotes de la base local: **45/45 cuadran**.

| Movimiento | Tipo de asiento | Cuándo | Evidencia |
| --- | --- | --- | --- |
| AVAILABLE → ALLOCATED | `ALLOCATION` | Publicar la oferta (por lote, FEFO). | DB **A** (900/100), **G** (dos lotes) |
| ALLOCATED → RESERVED | `RESERVATION` | Checkout del cliente. | DB **B** (99/1) |
| RESERVED → ALLOCATED | `RELEASE_RESERVATION` | Cancelar, expirar o rechazar el pago. Nunca vuelve a AVAILABLE. | DB **C**, **F**, **F2** |
| RESERVED → ISSUED | `ISSUE` | Confirmar el pago; nace un derecho por unidad. | DB **D** (99/0/1) |
| ALLOCATED → AVAILABLE | `RELEASE_ALLOCATION` | Finalizar o cancelar la oferta; solo lo libre, nunca lo emitido. | DB **I** (finalizar), **M** (cancelar) |
| Ledger del recorrido E2E | `RECEIPT 1000 · ALLOCATION 100 · RESERVATION 1 · ISSUE 1 · RESERVATION 1 · RELEASE_RESERVATION 1`; lote 1000 recibidas = 900 + 99 + 0 + 1. | SQL tras el E2E |
| Contadores por encima de lo asignado | La base rechaza (`CHECK`). | DB **K** |

## 8 · CONCURRENCIA

| Riesgo | Mecanismo | Test |
| --- | --- | --- |
| Overselling (dos clientes por la última unidad) | `SELECT … FOR UPDATE` sobre la fila de la oferta al abrir la orden (`checkout.ts:58`); el segundo espera y ve 0 libres. | DB **E** |
| Límite por persona con dos pestañas | Mismo candado; `validarLimitePorCliente` cuenta pagadas y reservas vivas. | DB **E2**; dominio «límite por cliente» |
| Doble clic en comprar | `idempotencyKey` único: la misma clave devuelve la misma orden; una clave ajena se rechaza. | DB **B2** |
| Confirmar pago dos veces | Candado sobre la orden (`checkout.ts:198`) + estado ya `PAID` → no-op. | DB **D2** |
| Publicar mientras se recibe / dos publicaciones | Lotes del producto `FOR UPDATE` antes de repartir (`allocations/service.ts:34`); publicar es idempotente. | DB **A**, **A2** |
| Barrido en paralelo | Cada orden se expira bajo su propio candado y solo si sigue `PENDING`; una segunda pasada no repite. | DB **F** |
| Numeración | `pg_advisory_xact_lock(hashtext(prefijo))` para `MBG-OF` y `MBG-SO`. | `core/numeracion.ts:47` |

## 9 · SEGURIDAD

| Criterio | Evidencia | Archivo / Test |
| --- | --- | --- |
| Permisos nuevos | `SUPPLY_V2_OFFER_MANAGE`, `SUPPLY_V2_OFFER_PUBLISH` en el catálogo del módulo; `scripts/permisos-catalogo.mjs` exit 0. | `contracts/gateways.ts:47-60` |
| Cliente solo ve lo suyo | `misCompras`, `miCompra`, `misDerechos` filtran por el `customerId` de la sesión; `miCompra` de otro devuelve `null` → `notFound()`. Cancelar o avisar pago de una orden ajena falla con `ORDEN_AJENA`. | `commerce/queries.ts:97-125`, `checkout.ts:259,299`; DB **C**; E2E (cliente2 no ve la compra de cliente) |
| DTOs del cliente sin costos | `CompraCliente` y `DerechoCliente` no llevan `actualUnitCost`, lote ni margen (`grep` en `commerce/queries.ts` y componentes de cliente: 0). | `commerce/queries.ts`, `checkout-cliente.tsx` |
| Cron protegido | Sin `CRON_SECRET` → 401 (afirmado en el E2E). | `api/cron/supply-v2/route.ts:23` |
| Admin solo para SUPERADMIN | Todas las páginas `supply-v2` llaman `requireRole('SUPERADMIN')`; las acciones exigen permiso además del rol. | `actions-ofertas.ts`, páginas |
| Auditoría | 16 acciones nuevas; en la base local tras las suites: ALLOCATION_CREATED 33, RELEASED 7, OFFER_CREATED 33, PUBLISHED 33, PAUSED 4, RESUMED 4, ENDED 7, ORDER_CREATED 39, RESERVED 39, PAYMENT_SUBMITTED 10, CANCELLED 8, EXPIRED 7, PAID 18, PAYMENT_REJECTED 4, ENTITLEMENT_ISSUED 30. Etiquetas en la bitácora (`tests/bitacora-etiquetas.test.ts` 6/6). | `audit_logs`, `modules/auditoria/queries.ts` |
| Sin valores de demostración en la UI | Todo sale de consultas; la portada solo muestra la sección si hay ofertas comprables. | páginas `supply-v2`, `promociones` |

## 10 · E2E

Playwright 1.62, Chromium del contenedor, `next start -p 3210`, sesiones firmadas
localmente (`tests/e2e/supply-v2-sesion.ts`: roles compras, finanzas, cliente, cliente2).

| Recorrido | Resultado |
| --- | --- |
| **Admin**: Slice 1 por UI (proveedor → producto → acuerdo → orden → aprobación → recepción de 1 000) → wizard de oferta (100 u., 600 → 399) → publicar → ficha muestra 100 asignadas / 100 disponibles → pool 900 / 100. | ✅ pasa |
| **Marketplace**: anónimo ve la tarjeta en `/promociones` y la ficha; el HTML no contiene `unitCost`, `LOT-` ni `allocation`. | ✅ pasa |
| **Cliente**: compra 1 → checkout con cuenta de cobro y cuenta atrás → avisa el pago → Finanzas confirma en `/ofertas/ventas` → la compra queda `PAGADA` con 1 derecho → ficha de la oferta 99 / 0 / 1 → pool 900 / 99 / 0 / 1. cliente2 no ve esa compra. | ✅ pasa |
| **Expiración (determinista)**: segunda compra de cliente → el arnés adelanta `expiresAt` al pasado → `GET /api/cron/supply-v2` con `CRON_SECRET` → la compra aparece `EXPIRADA` y la unidad vuelve a la oferta; sin secreto → 401. | ✅ pasa |
| Ejecución | `tests/e2e/supply-v2-slice2.spec.ts`: **1 passed** (proyecto `escritorio`; en móvil se salta a propósito). | ✅ |
| CI | `.github/workflows/e2e.yml` recibe `CRON_SECRET` y `SUPPLY_V2_RESERVATION_TTL_MINUTES=5`. No se ha ejecutado en GitHub desde esta rama (no hay PR). | ⚠️ |

## 11 · DEFINITION OF DONE

| # | Criterio | Estado | Evidencia |
| --- | --- | --- | --- |
| 1 | Asignación FEFO multi-lote desde supply disponible | ✅ | dominio FEFO ×3; DB **A**, **G**, **G2** |
| 2 | Oferta con precio público y Membego, límite por persona, vigencia, estados completos | ✅ | dominio «oferta ·» ×5; DB **H**, **I**, **J** |
| 3 | Marketplace sin costos ni lotes | ✅ | §5; E2E |
| 4 | Checkout atómico sin overselling, TTL configurable, idempotente | ✅ | DB **B**, **B2**, **E**, **E2**; dominio «TTL» |
| 5 | Pago real mínimo (transferencia + confirmación manual) | ✅ | §6; DB **D**, **F2** |
| 6 | Entitlement por unidad con costo real del lote y precio del cliente | ✅ | DB **D** (costo 300), **G2** (costo 280 del segundo lote), **D3** (precio congelado); SQL: 30 derechos, `quantity` min = max = 1 |
| 7 | Cron idempotente: expira reservas, activa programadas, cierra vencidas | ✅ | DB **F**, **J**; E2E expiración |
| 8 | Pausar / reanudar / finalizar / cancelar liberando lo no usado sin tocar lo emitido | ✅ | DB **H**, **I**, **M**; cancelar con checkouts en curso se rechaza (**M**) |
| 9 | Pool muestra disponible / asignado / reservado / emitido | ✅ | `supply/page.tsx`, `supply/[catalogItemId]/page.tsx`; E2E `producto-*` |
| 10 | Rutas admin `/superadmin/supply-v2/ofertas` + pestaña «Ofertas» | ✅ | `ofertas/{page,nueva,[id],ventas}`, `nav.tsx`; `next build` las lista |
| 11 | Área del cliente `/cliente/compras` + entrada de menú | ✅ | `(cliente)/cliente/compras`, `nav-config.ts`; `tests/navegacion-cliente.test.ts` |
| 12 | Ownership del cliente | ✅ | §9 |
| 13 | Auditoría de las 16 acciones | ✅ | §9 |
| 14 | Permisos `SUPPLY_V2_OFFER_MANAGE` / `PUBLISH` | ✅ | §9 |
| 15 | Tests de dominio (los 18 casos de §55) | ✅ | Puros en `tests/supply-v2-slice2-dominio.test.ts` (16/16) y, cuando el caso necesita base, en la suite PostgreSQL. Mapa: 1 asignar 100 → **A** · 2 asignar 1 001 falla → FEFO puro + **A2** · 3 FEFO reparte → FEFO puro + **G** · 4 publicar crea asignación consistente → **A** · 5 precio/descuento → «precio ·» ×3 · 6 futura no comprable → «oferta · no comprable» + **J** · 7 vencida no comprable → ídem + **J** · 8 reserva ALLOCATED → RESERVED → «ledger» + **B** · 9 cancelación → **C** · 10 expiración → **F** · 11 pago RESERVED → ISSUED → **D** · 12 derecho creado → **D** · 13 límite por cliente → «límite» + **E2** · 14 sold out → **L** · 15 cancelar oferta sin tocar emitido → **M** · 16 invariante → «ledger» + **K** · 17 idempotencia checkout → **B2** · 18 idempotencia pago → **D2** |
| 16 | Journeys PostgreSQL A–F | ✅ | `tests/postgres/supply-v2-slice2.db.test.ts`: 20/20 (A, A2, B, B2, C, D, D2, D3, E, E2, F, F2, G, G2, H, I, J, L, M, K) |
| 17 | Playwright admin + cliente + expiración | ✅ | §10 |
| 18 | Migración idempotente, sin editar aplicadas, sellada, sin drift | ✅ | §4 |
| 19 | Sin `count()+1`, sin flotantes, sin `SupplyV2User/Company/Branch/Customer` | ✅ | §2, §3 |
| 20 | Puertas de CI en verde sobre el código final | ✅ | `tsc --noEmit` 0 · `eslint src tests` 0 · `npm test` 3 269 tests, 3 263 pass, 0 fail, 6 skipped · `npm run test:db` 64/64 · `next build` exit 0 · transacciones-anidadas, rls-cobertura, permisos-catalogo, rls-capa2-preflight: 0 |

## 12 · REGRESIÓN SLICE 1

| Comprobación | Evidencia | Estado |
| --- | --- | --- |
| Suite de dominio Slice 1 | Dentro de `npm test` (0 fallos). | ✅ |
| Suite PostgreSQL Slice 1 | 21 casos dentro de los 64 de `npm run test:db`, 0 fallos. | ✅ |
| E2E Slice 1 | `tests/e2e/supply-v2.spec.ts`: 4 passed, 4 skipped (móvil, a propósito). | ✅ |
| El E2E de Slice 2 reconstruye el recorrido de Slice 1 por la interfaz | Proveedor → producto → acuerdo → orden → aprobación por otra persona → recepción; luego sigue con la oferta. | ✅ |
| Cambios en archivos de Slice 1 | Solo ampliaciones: `SupplyV2ReferenceType` (+4 valores), relaciones inversas, prefijos de numeración, etiquetas, permisos, `pool/queries.ts` (asignadas/reservadas/emitidas), `pool/lotes.ts` (tipo de referencia). Ninguna regla ni transición de Slice 1 cambia. | ✅ |

## 13 · SUPPLY V1 INTACTO

| Comprobación | Evidencia | Estado |
| --- | --- | --- |
| `git diff HEAD -- src/modules/supply "src/app/(superadmin)/superadmin/supply" src/components/supply prisma/schema/supply.prisma` | **vacío** | ✅ |
| Tablas V1 | 30 tablas `supply_*` (sin `supply_v2_`) siguen en la base; la migración no las toca. | ✅ |
| `supply_cuentas_cobro` | Solo `SELECT` desde `paymentAccountGateway`; ninguna escritura. | ✅ |
| Suite PostgreSQL de V1 | 23 casos dentro de los 64, 0 fallos. | ✅ |
| Archivos compartidos tocados | `identidad.prisma` (+24), `nav-config.ts` (+9, una entrada del menú del cliente), `auditoria/queries.ts` (+17, etiquetas), `e2e.yml` (+6, dos variables), `vercel.json` (+4, un cron), `promociones/page.tsx` (+28 −1, una sección). | ✅ |

## 14 · RIESGOS REALES

| Riesgo | Detalle | Mitigación / decisión |
| --- | --- | --- |
| Slice 1 no está en `main` | Si se mezcla otra cosa en `main` antes que esta rama, habrá que rebasar dos slices juntos. | Mezclar Slice 1 + Slice 2 en un solo PR desde esta rama, o Slice 1 primero. |
| Cron cada hora | Una reserva vencida puede tardar hasta 60 min en liberarse; mientras tanto `motivoNoComprable` ya la trata como caducada en el checkout del mismo cliente, pero la unidad sigue `RESERVED` para los demás. | Bajar la frecuencia en `vercel.json` si el volumen lo pide (el barrido es idempotente). |
| Pago avisado que nunca se revisa | Una orden `AWAITING_PAYMENT` retiene su unidad indefinidamente hasta que Finanzas confirme o rechace. | Decisión explícita del slice (no perder pagos reales). La pantalla de ventas los lista; conviene una alerta en Slice 3. |
| Cuenta de cobro única | El checkout usa la primera cuenta activa de `supply_cuentas_cobro`; sin ninguna, no se puede comprar (mensaje claro). | Seed/alta de cuenta es responsabilidad operativa; el E2E la siembra por arnés. |
| Monto visto manual | La confirmación depende del monto tecleado por Finanzas (tolerancia 1 centavo). | Conciliación bancaria es Slice 3+. |
| CI de GitHub no ejecutado | Las puertas se corrieron localmente con el mismo comando; el workflow E2E no ha corrido en GitHub porque no hay PR. | Abrir el PR y revisar `e2e.yml`. |
| `REFUNDED` sin transición | Existe en el enum para no migrar después; ninguna acción lo produce. | Documentado; Slice 3. |

## 15 · PENDIENTE SLICE 3

Excluido a propósito por el prompt y **no** implementado: QR, vouchers, canje /
redención, escáner, ventas a comisión, obligaciones del proveedor, cuentas por pagar,
liquidación, conciliación, campañas, membresías, referidos, recompensas y bonos.
Además quedan como trabajo natural del siguiente slice:

- Canje del derecho (`ISSUED → REDEEMED`) con el proveedor y el ledger correspondiente.
- Reembolso (`REFUNDED`) y cancelación de un derecho ya emitido.
- Alertas de pagos avisados sin revisar y de reservas próximas a vencer.
- Varias cuentas de cobro y selección por método.
- Imagen de la oferta (el campo `imagePath` existe; el wizard no sube archivos).
- Ejecutar el workflow E2E en GitHub desde el PR de esta rama.
