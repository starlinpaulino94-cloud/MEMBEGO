# MEMBEGO — IMPLEMENTATION STATUS

> Memoria operativa del proyecto. Se escribe **contra el código**, no contra documentos: donde un documento y el código se contradicen, manda el código y la discrepancia queda en §14.
> Leyenda: ✅ COMPLETED · 🟡 PARTIAL · 🔵 IN PROGRESS · ⚪ NOT STARTED · 🔴 BLOCKED · 🟣 DEPRECATED · 🙈 HIDDEN
> **Aviso de alcance.** El «Plan Maestro» con fases F0–F7 (Commerce Core, `MembegoOrder`, Merchant Billing…) **no está en el repositorio ni en la sesión que produjo esta edición** (`grep` en `docs/`: solo existe `docs/transformacion-membego/03-plan-fases.md`, que es OTRO programa). Los estados de esas filas en §2 se derivaron del código; los criterios del plan no pudieron compararse. Si ese plan existe, hay que adjuntarlo y reconciliar §2.

---

## 1. Estado general

```text
Fecha de actualización:   2026-10-06
Branch:                   claude/relaxed-brahmagupta-1shtlc
Commit auditado:          2791c33  (origin/main = 2795490, PR #563). El commit de este documento es posterior
Estado general:           Supply 2.0 (Slices 1–9) completo y fusionado en main; rediseño visual Stitch en curso
Fase actual:              Rediseño visual Stitch de Supply 2.0 — pantalla 10 de 11 (Finanzas, esperando aprobación de propuesta)
Última fase completada:   Pantalla 9/11 «Fidelización» (2791c33, solo en la rama, sin PR)
Próxima fase:             Finanzas → Economía (ver §17)
```

- Supply 2.0 backend (S1–S9 + ofertas editables/precio/categorías de vehículo) está en `main` con 27 migraciones y 320 pruebas contra PostgreSQL en verde sobre una base creada con `migrate deploy`.
- El rediseño Stitch lleva **9 de 11 pantallas**: 7 ya en `main`; **Campañas (`5f65988`) y Fidelización (`2791c33`) están solo en esta rama**, sin PR.
- El rediseño no tocó dominio, servicios, permisos ni esquema: solo `queries.ts` (lecturas) y un valor en `core/estados.ts`.
- Pendientes de Stitch: Finanzas (mockups A/B enviados, sin aprobación) y Economía (sin empezar). Otras 26 páginas de Supply 2.0 (detalle `[id]`, altas/wizards, `operaciones/*`, `categorias`, `ofertas/ventas`) siguen con el diseño anterior (`PageHeader`) y **no tienen pantalla Stitch**.
- No hay pasarela de pago real conectada a Supply 2.0 (solo `TEST_GATEWAY`); WhatsApp es `NOT_CONFIGURED`; la Capa 2 de RLS está apagada.
- Estado en producción: **no verificable desde este entorno** (§7, §16).

---

## 2. Progreso por fases

**A · Fases del Plan Maestro solicitado** (estado derivado del código; ver aviso de alcance).

| Fase | Estado | Progreso | Objetivo | Resultado actual |
|---|---|---:|---|---|
| F0 Foundation Hardening | 🟡 | — | Seguridad base, aislamiento, calidad | Cabeceras, rate limit, RLS Capa 1 migrada, `rls:cobertura` 0 huecos. Capa 2 apagada, sin pentest (§9) |
| F1 Commerce Catalog | ⚪ | — | `CatalogItem`/`CatalogVariant` genéricos | No hay modelo genérico. Equivalentes por dominio: `SupplyV2CatalogItem`, servicios, excursiones |
| F2 Supply → Marketplace Bridge | 🟡 | — | Supply visible/vendible en marketplace | Ofertas V2 publicadas en `/promociones/membego/*` y checkout cliente (S2). Sin catálogo comercial común |
| F3 MembegoOrder + Attribution | ⚪ | — | Orden y atribución unificadas | No existe `MembegoOrder` ni `OrderAttribution`. Hay órdenes por dominio y atribución parcial (campañas V2, growth, excursiones) |
| F4 Economic Control / Merchant Billing | ⚪ | — | Cobro y estado de cuenta al comercio | No existe `MerchantLedger`/`MerchantStatement`. Existe lo del lado proveedor (S4/S5) |
| F5 Growth Engine | 🟡 | — | Referidos y crecimiento | `modules/growth`, referidos E6, ruleta; pruebas `growth-reglas`, `referidos-e6`. Criterios del plan no verificables |
| F6 Marketplace Discovery | 🟡 | — | Buscar/explorar/cerca | `descubrimiento`, `geo-*` con pruebas; páginas `/cliente/buscar`, `/explorar`, `/cerca`. Sin acta de cierre |
| F7 Analytics | 🟡 | — | Métricas y reportes | `modules/reportes` (25+ pruebas) y economía V2. Sin capa analítica separada |
| Inventory General | ⚪ | — | Inventario general | Solo inventario de Supply por lotes (ledger) |
| POS | 🟡 | — | Caja en sucursal | Caja Fase 1 (`docs/CAJA_POS.md`, `caja*.test.ts`); sin terminales/pasarelas |
| Marketplace Checkout | 🟡 | — | Pago en el marketplace | Checkout de Supply V2 con pago manual/`TEST_GATEWAY`; CardNET solo membresías de CARTOWN |
| Advanced Features | ⚪ | — | No definido en el repo | — |

**B · Programas que sí existen en el repositorio.**

| Programa / fase | Estado | Progreso | Objetivo | Resultado actual |
|---|---|---:|---|---|
| Supply V1 (releases A–G) | ✅ | 7/7 | Supply original (inventario patrocinado) | Doc `membego-supply-implementation-status.md`; migraciones `20260926…20261009` (10). Coexiste, no deprecado |
| Supply 2.0 · S1 Procurement | ✅ | 1/9 | Proveedores, acuerdos, órdenes, lotes, ledger | `20261010`; `db.test` S1 verde |
| · S2 Pool/Oferta/Checkout | ✅ | 2/9 | Asignación FEFO, ofertas, compra cliente | `20261011` |
| · S3 Voucher/QR/Redención | ✅ | 3/9 | Entrega, reversa, incidencias | `20261012` |
| · S4 Finanzas proveedor | ✅ | 4/9 | Facturas, depósitos, pagos, obligaciones, conciliación | `20261013` |
| · S5 Comisión/Liquidación | ✅ | 5/9 | Ventas a comisión y liquidaciones | `20261014–15`, `20261018` (parcial) |
| · S6 Beneficios | ✅ | 6/9 | Bonos y descuentos con presupuesto | `20261016–17` |
| · S7 Campañas y cupones | ✅ | 7/9 | Campañas, promociones, cupones | `20261019–20` |
| · S8 Fidelización | ✅ | 8/9 | Planes, referidos, puntos, recompensas | `20261021–23` |
| · S9 Integraciones/Operación | ✅ | 9/9 | Webhooks, outbox, conciliación, centro de operaciones | `20261024–30`; bloque 5 fusionado (#562) |
| Post-S9 · ofertas editables, precio %, gratis, categorías de vehículo (Fases 1–3) | ✅ | 3/3 | Editar oferta, modo de precio, catálogo de categorías | `524390b`, `49c22ba`, `4c16875`, `fd626a1`; migraciones `20261031–35` |
| **Rediseño Stitch de Supply 2.0** | 🔵 | **9/11 pantallas** | Aplicar el diseño Stitch (dirección blanca) pantalla por pantalla | Ver §3 |
| Transformación del cliente P0–F2c | ✅ | — | Retail del cliente | Acta en `docs/transformacion-membego/02-baseline-contratos.md` |
| · F2d (retirar Inicio anterior) | ✅ | — | Quitar `InicioPrevio` | El doc dice «en curso»; **el código ya no tiene `InicioPrevio`** (§14) |
| · F3–F8 | 🟡 | — | Descubrimiento … retirada | **No auditado**: docs congelados el 2026-09-17; rama fusionada (#459) |

---

## 3. Fase actual — Rediseño visual Stitch de Supply 2.0

### Objetivo
Reproducir con máxima fidelidad el diseño de Google Stitch (`stitch_membego_supply_2.0_redesign (1).zip`, raíz del repo) en las pantallas de lista de Supply 2.0, **sin cambiar lógica, cálculos, permisos, servicios, esquema ni migraciones**, con datos reales y dirección visual blanca. Flujo obligatorio por pantalla: analizar → mockups A/B → plan con plantilla → **esperar aprobación** → implementar → probar (typecheck, lint, build, e2e, 1440/1024/768/390) → informe → parar.

### Implementado (pantalla · commit · estado en main)
| # | Pantalla | Commit | En `main` |
|---|---|---|---|
| 1 | Resumen | `17d925f` | sí |
| 2 | Compras (B) | `5a2e7d1` | sí |
| 3 | Proveedores (A) | `ea607f5` | sí |
| 4 | Supply (A) | `5e26ea1` (+ `054f5be` fix de orden) | sí |
| — | Dirección blanca en todas | `c29fcb7` | sí |
| 5 | Ofertas (A) | `fb7c603` | sí |
| 6 | Redenciones (A) | `11d5fb9` | sí |
| 7 | Beneficios (A) | `7aef5bf` | sí (#563) |
| 8 | Campañas (A) | `5f65988` | **no, solo rama** |
| 9 | Fidelización (A) | `2791c33` | **no, solo rama** |

### Parcial
- **Finanzas**: mockups A (recomendada) y B enviados; plan presentado; **sin aprobación**. No hay código.

### Pendiente
- Finanzas: la raíz y sus 7 secciones (facturas, depósitos, pagos, obligaciones, conciliaciones, liquidaciones, incidencias) suman **17 páginas** bajo `/finanzas`, hoy con `PageHeader`; Stitch solo diseña la raíz.
- Economía (sin analizar).
- Fuera del Stitch (26 páginas, sin pantalla de diseño): detalle `[id]`, alta/wizards, `operaciones/*`, `categorias`, `ofertas/ventas`. Siguen con el diseño anterior.

### Bloqueadores
Ninguno. (Esperar aprobación del usuario no es un bloqueador.)

### Archivos principales
- Tokens: `src/app/globals.css` (`--sv2-*`, claro/oscuro).
- Marco/nav/primitivas: `src/components/supply-v2/{marco,nav,indicador,filtros,paginacion,selector-filas,acciones-cabecera,tarjeta-info,dialogo,fuentes}.tsx`, `resumen/superficie.tsx`.
- Por pantalla: `src/components/supply-v2/{resumen,compras,proveedores,supply,ofertas,redenciones,beneficios,campanas,fidelizacion}/`.
- Páginas: `src/app/(superadmin)/superadmin/supply-v2/{page,compras,proveedores,supply,ofertas,redenciones,beneficios,campanas,fidelizacion}/page.tsx`; ruta `redenciones/buscar/route.ts` (GET).
- Guardia: `tests/deuda-diseno.test.ts`, `scripts/auditar-diseno.mjs`.

### Entidades afectadas
Ninguna (solo lecturas).

### Migraciones
Ninguna.

### APIs / Server Actions
Ninguna nueva. Solo lecturas en `queries.ts`: `resumenSupplyV2`, `actividadRecienteSupplyV2`, `supplyPorProducto`, `verificacionesLotes` (pool); `buscarOrdenes`, `resumenCompras`, `proveedoresConOrdenes` (procurement); `buscarProveedores`, `resumenProveedores`, `categoriasDeProveedores` (suppliers); `buscarOfertas`, `resumenOfertas`, `proveedoresConOfertas` (offers); `buscarRedenciones`, `resumenRedenciones`, `sucursalesConRedenciones`, `redencionPorCodigo` (redemption); `buscarBeneficios`, `resumenBeneficios` (benefits); `listarCampanas`/`tableroCampanas` extendidos (campaigns); `tableroDeFidelizacion` extendido (loyalty). Más `ORDEN_POR_RECIBIR` en `core/estados.ts`.

### UI creada o modificada
9 pantallas de lista (arriba) y 6 componentes compartidos nuevos. Patrón de tabla única que se reacomoda en tarjetas con container queries (`@4xl`), para que cada `data-testid` exista una vez por fila.

### Eventos
Ninguno.

### Permisos / capabilities
Sin cambios. Se respetan los existentes (`SUPPLY_V2_LOYALTY_PROGRAM_CREATE`, `SUPPLY_V2_LOYALTY_FINANCE_VIEW`, `requireRole('SUPERADMIN')`).

### Tests
- No se agregó **ninguna prueba nueva** ni se editó ninguna existente. La cobertura de las consultas nuevas es indirecta (e2e de Slices 5–8 y `db.test`).
- Resultados reales en §8.

### Riesgos abiertos
Ver §15. Principales: consultas nuevas sin pruebas unitarias propias; Campañas (búsqueda rápida y paginación, techo 200 filas) y Fidelización (todos los filtros, techo 50 programas) filtran en memoria; dos pantallas sin PR; dark mode verificado a mano solo en 3 de 9.

### Criterios de aceptación
| Criterio | Resultado |
|---|---|
| Pantallas con la estructura, información y navegación de Stitch, en dirección blanca (#FFFFFF, sin fondo gris/lila/azulado) | **PASS** (9/9 hechas) · **PENDING** (Finanzas, Economía) |
| Sin cambios de lógica, cálculos, permisos, servicios, Prisma ni migraciones | **PASS** (los 11 commits solo tocan UI, `queries.ts` y `core/estados.ts`) |
| Datos reales, sin contenido de maqueta; lo que no existe se omite o se dice | **PASS** (cada ausencia quedó en el plan: ITBIS, CTR, NCF, cierre fiscal, descargas .xlsx, «Auto 98%»…) |
| typecheck, lint, build, unitarias | **PASS** (§8) |
| e2e de Supply 2.0 | **PENDING** (corrida completa de Slices 1–9 en ejecución al guardar esta versión) |
| Sin desborde horizontal a 1440/1024/768/390 | **PASS** al implementar cada pantalla (no se re-ejecutó en esta auditoría) |
| Modo oscuro legible | **PENDING** (revisado en Beneficios, Campañas, Fidelización; no re-verificado en las otras 6) |
| Un commit por pantalla | **PASS** |
| Finanzas y Economía implementadas | **PENDING** |

---

## 4. Módulos del sistema

| Módulo | Estado | Ubicación | Observación |
|---|---|---|---|
| Auth | ✅ | `src/lib/auth`, `src/modules/auth` | Supabase Auth + JWT, Google; rate limit en login |
| Multi-tenancy | ✅ | `src/lib/tenant.ts` (`conEmpresa`/`sinEmpresa`) | `rls:cobertura`: 540 archivos con contexto, 0 huecos (§8) |
| RLS | 🟡 | `prisma/migrations/20260771_*`, `prisma/migrations_manual/` | Capa 1 sí; Capa 2 apagada (§9) |
| Permissions | ✅ | `src/lib/auth/permissions.ts`, `src/modules/permisos` | `permisos:catalogo`: 93 funciones, guardia viva |
| Capabilities | ✅ | `src/modules/capacidades` | Comentario del catálogo dice «solo CAR_WASH operativa», pero hay paquetes base para BARBERIA, RESTAURANTE y GYM (§14) |
| Catalog | 🟡 | por dominio | Sin catálogo comercial genérico (§2 F1) |
| Inventory | 🟡 | `modules/supply-v2/{pool,procurement}` | Solo Supply, por lotes y ledger |
| Orders | 🟡 | `Transaction`, `ProductoCompra`, `Membership`, `SupplyV2CustomerOrder` | Sin orden unificada |
| Marketplace | 🟡 | `prisma/schema/marketplace.prisma`, `app/(public)/promociones/*` | 5 modelos + read model de Supply V2 |
| POS | 🟡 | `modules/caja` | Fase 1 entregada |
| Payments | 🟡 | `modules/pagos`, `supply-v2/finance` | CardNET (SAQ A, solo CARTOWN); Supply V2 sin pasarela real |
| Promotions | ✅ | `modules/promociones`, motor de reglas | `Promotion*`, `Rule*` |
| Deals | 🟡 | `modules/ofertas` | No existe entidad «Deal»; equivalentes `OfertaPrivada` y ofertas Supply |
| Coupons | ✅ | `supply-v2/campaigns` | `SupplyV2Coupon` (S7) |
| Benefits | ✅ | `lib/benefits`, `supply-v2/benefits` | Legacy E8 + `SupplyV2Benefit` (S6) |
| Memberships | ✅ | `modules/membresias`, `supply-v2/loyalty` | `Membership` + `SupplyV2MembershipPlan` |
| Loyalty | ✅ | `supply-v2/loyalty` | S8; puntos con ledger |
| Rewards | ✅ | `supply-v2/loyalty/rewards.ts`, `modules/growth` | |
| Referrals | ✅ | `modules/referidos`, `supply-v2/loyalty/referrals.ts` | |
| Campaigns | ✅ | `modules/campanas`, `supply-v2/campaigns` | |
| QR | ✅ | `modules/qr`, `supply-v2/redemption` | Sesiones con nonce de un solo uso |
| Redemptions | ✅ | `supply-v2/redemption` | Entrega, reversa, incidencias |
| Merchant Billing | ⚪ | — | No existe (§2 F4) |
| Revenue Attribution | 🟡 | `supply-v2/campaigns`, `growth`, `excursiones` | Sin atribución genérica |
| Membego Supply V1 | ✅ | `modules/supply`, `/superadmin/supply`, `/admin/supply` | Visible; coexiste con V2 |
| Membego Supply V2 | 🔵 | `modules/supply-v2` | Backend ✅; UI en rediseño (§3) |
| Supplier Finance | ✅ | `supply-v2/finance` | S4 |
| Settlements | ✅ | `supply-v2/finance/settlements*` | S5 + liquidación parcial |
| Reconciliation | ✅ | `finance/reconciliation.ts`, `operations/barrido-conciliacion.ts` | S4 + S9 |
| Analytics | 🟡 | `modules/reportes`, `supply-v2/economics` | |
| Notifications | ✅ | `modules/notificaciones`, `supply-v2/notifications` | WhatsApp no (§11) |
| Connect | ✅ | `modules/connect`, `/superadmin/connect` | Meta, Google Calendar, Zapier, webhooks; 29 archivos de prueba |
| Jobs | ✅ | `modules/jobs` | QStash con degradación en línea |
| Audit | ✅ | `modules/auditoria`, `supply-v2/core/auditoria.ts` | `AuditLog` insert-only |
| Observability | ✅ | `modules/observabilidad`, `/api/health`, `/api/metricas` | Sentry |
| Verticals | 🟡 | `modules/carwash`, `modules/excursiones`, `apps/restaurant` | Car wash y excursiones activos; restaurante es un satélite aparte, por HTTP |

---

## 5. Membego Supply

```text
Supply V1:               ✅ COMPLETED (7 releases) · visible · coexiste con V2 · sin retirada planificada en el código
Supply V2:               ✅ backend S1–S9 · 🔵 UI en rediseño Stitch
Procurement:             ✅ S1  (suppliers, catalog, agreements, procurement)
Agreements:              ✅ S1  versiones congeladas; resolución en S5
Purchase Orders:         ✅ S1  aprobación segregada (core/segregacion.ts)
Lots:                    ✅ S1
Ledger:                  ✅ S1  SupplyV2LedgerEntry, partida doble entre cubetas
FEFO:                    ✅ S2  core/fefo.ts (usado en allocations, offers, checkout)
Allocation:              ✅ S2  allocations/service.ts, reserva con bloqueo de fila
Customer Entitlements:   ✅ S2/S3  SupplyV2Entitlement
Vouchers:                ✅ S3
QR Redemption:           ✅ S3  QrSession con nonce; escáner admin y proveedor
Reversals:               ✅ S3  REDEEMED → ISSUED (asiento de reversa)
Supplier Finance:        ✅ S4  facturas, depósitos, obligaciones
Payments:                ✅ S4  quien registra no confirma
Settlements:             ✅ S5  + liquidación parcial (20261018)
Reconciliation:          ✅ S4 manual · ✅ S9 barrido automático
Benefits:                ✅ S6
Campaigns:               ✅ S7
Coupons:                 ✅ S7
Loyalty:                 ✅ S8  planes, referidos, puntos, recompensas
Operations:              ✅ S9  inbox/outbox, alertas, interruptores, health/ready, runbooks, smoke
Marketplace integration: 🟡 S2  read model + páginas públicas y de cliente; sin catálogo común (§2)
Payment gateway:         🟡 frontera genérica ✅ (HMAC, anti-replay, kill switch) · pasarela REAL: NOT INTEGRATED (solo TEST_GATEWAY). CardNET es otro flujo
```

Superficies: superadmin 53 páginas, admin 8 (`campanas, beneficios, escaner, fidelizacion, ventas, liquidaciones`), cliente 5 (`bonos, fidelizacion, compras, compras/[id], cupones`), públicas `/promociones/*`. Endpoints: `POST /api/webhooks/supply-v2/[provider]`, `/api/cron/supply-v2`.

---

## 6. Commerce Core

Estado derivado del código (§2). Ninguna de estas entidades genéricas existe tal cual; se indica el equivalente real.

| Entidad pedida | status | schema | service | UI | tests | integration |
|---|---|---|---|---|---|---|
| CatalogItem | ⚪ genérico · ✅ en Supply | `SupplyV2CatalogItem` | `supply-v2/catalog` | superadmin Supply | db S1 | solo Supply |
| CatalogVariant | ⚪ | — (variantes en excursiones) | — | — | — | — |
| Pricing | 🟡 | `priceMode`, `PlanPrecioCategoria`, categorías de vehículo | `offers/domain.ts` | Ofertas | unit + db | por dominio |
| Inventory | 🟡 | `SupplyV2Lot`, `LedgerEntry` | `pool/` | Supply | db S1–S2 | solo Supply |
| Customer | ✅ | `User`, `Cliente` | `modules/cliente` | /cliente | varias | global |
| MembegoOrder | ⚪ | — | — | — | — | — |
| OrderLine | 🟡 | `SupplyV2CustomerOrderLine` | `commerce/checkout.ts` | /cliente/compras | e2e S2 | solo Supply |
| OrderAttribution | ⚪ | (campaña congelada en pedido V2) | — | — | db S7 | parcial |
| PaymentEvidence | 🟡 | `Comprobante`, `SupplyV2SupplierPayment` | `finance/payments.ts` | pagos | db S4 | por dominio |
| Commission | 🟡 | `commission*` en V2/excursiones | `core/comision.ts` | liquidaciones | unit + db S5 | por dominio |
| MerchantLedger | ⚪ | — | — | — | — | — |
| MerchantStatement | ⚪ | — | — | — | — | — |
| Entitlement | ✅ | `SupplyV2Entitlement` | `redemption/` | /cliente | db S2–S3 | Supply |
| Voucher | ✅ | `SupplyV2Voucher` | `redemption/` | /cliente | db S3 | Supply |
| Redemption | ✅ | `SupplyV2Redemption` | `redemption/service.ts` | escáner + Redenciones | db + e2e S3 | Supply |

---

## 7. Migraciones

Total **190** directorios (`0_genesis` … `20261035`). Supply V1: 10 · Supply V2: 27. Todas verificadas el 2026-10-06 así: `prisma migrate deploy` sobre una base **vacía** aplicó las 190 (exit 0) y `prisma migrate diff` contra `prisma/schema` dio **«No difference detected»**. `SUMAS.txt` (sellos SHA-256) lo vigila `tests/migraciones-inmutables.test.ts` (dentro de Unit).

| Migración | Módulo | Estado | Riesgo | Verificada |
|---|---|---|---|---|
| `20260926_membego_supply` | Supply V1 (15 tablas) | ✅ | bajo (aditiva) | ✅ |
| `20261001`–`20261009` (avisos, coherencia, reserva, cobro, comprobante, capa financiera, operación) | Supply V1 | ✅ | bajo | ✅ |
| `20261010_supply_v2_slice1` | S1 | ✅ | bajo (CHECKs de ledger) | ✅ |
| `20261011`–`20261013` slice2–4 | S2–S4 | ✅ | bajo | ✅ |
| `20261014`–`20261015` slice5 (+enums) | S5 | ✅ | bajo | ✅ |
| `20261016`–`20261017` slice6 (+enums) | S6 | ✅ | bajo | ✅ |
| `20261018_…liquidacion_parcial` | S5 | ✅ | bajo | ✅ |
| `20261019`–`20261020` slice7 (+enums) | S7 | ✅ | bajo | ✅ |
| `20261021`–`20261023` slice8 (+enums, recompensa/entrega) | S8 | ✅ | bajo | ✅ |
| `20261024`–`20261030` slice9 (bloques 1–5, **8** directorios; el informe S9 §19 lista 7 y omite `20261024_…enums`) | S9 | ✅ | bajo | ✅ |
| `20261031_…oferta_editable` | Ofertas | ✅ | bajo (`ADD VALUE`) | ✅ |
| `20261032`–`20261033` precio_modo (+enums) | Ofertas | ✅ | bajo (default FIXED) | ✅ |
| `20261034`–`20261035` categorías de vehículo (+enums) | Ofertas | ✅ | bajo | ✅ |
| 153 anteriores | resto de la plataforma | ✅ | ver §14 | ✅ (aplican desde vacío) |

```text
Última migración en el repo:       20261035_supply_v2_categorias_vehiculo_enums
Última migración aplicada (prod):  NO VERIFICABLE desde este entorno (sin acceso a producción).
                                   La base LOCAL de desarrollo se creó con `db push` y NO tiene _prisma_migrations.
Migraciones pendientes:            no determinable en prod; usar `npm run migraciones:pendientes` contra la base real
Migraciones destructivas:          1 en todo el repo — 20260827_combo_horario_fijo_array (DROP COLUMN "horarioFijo", excursiones). Ninguna en Supply
Backfills pendientes:              no determinable. Scripts manuales existentes: scripts/backfill-placas.mjs, backfill-promotions-legacy-to-universal.sql
SQL manual fuera de migrate:       28 archivos en prisma/migrations_manual/ (incluye RLS Capa 2). Su estado en prod no es verificable
```

> **Trampa conocida.** `npm run test:db` contra una base creada con `db push` da **26 fallos falsos** (faltan CHECKs, índices únicos parciales y semillas que solo existen en las migraciones). Contra una base creada con `migrate deploy` da 320/320. Usar siempre una base migrada (`createdb` + `CREATE EXTENSION pg_trgm, unaccent, citext` + `migrate deploy`).

---

## 8. Calidad

Ejecutado el 2026-10-06 sobre `2791c33`, base Postgres 16 local.

```text
TypeScript:            PASS  (tsc --noEmit, 0 errores)
Lint:                  PASS  (eslint src tests: 0 errores, 15 warnings preexistentes)
Unit Tests:            3592/3598 PASS · 0 FAIL · 6 skipped        (npm test, 271 archivos)
Integration Tests:     NOT RUN en esta edición como suite aparte (cubiertas por Unit y PostgreSQL)
PostgreSQL Tests:      320/320 PASS  sobre base creada con `migrate deploy`   (13 archivos, tests/postgres)
                       294/320 sobre base `db push` → 26 FALSOS fallos (ver §7, trampa conocida)
E2E (Supply 2.0):      EN EJECUCIÓN al guardar esta versión (Slices 1–9, escritorio y móvil). Sin fallos hasta el test 35. Resultado final: ver §8 en el siguiente commit
E2E (resto):           NOT RUN (publico, cliente-flujos, excursiones, vehiculos, sidebar, comisiones, fase4…)
Build:                 PASS  (next build, exit 0)
RLS Checks:            PASS  rls:cobertura (540 archivos con contexto, 25 con prisma directo justificado — 82 sitios, 0 huecos)
                       NOT RUN  rls:probar / ensayo:rls / rls:preflight (piden base con roles Supabase)
Migration Checks:      PASS  migrate deploy desde vacío (190) + migrate diff sin diferencias
                       NOT RUN  migraciones:pendientes / db:doctor (piden la base real)
Permisos:              PASS  permisos:catalogo (93 funciones)
Diseño:                PASS  tests/deuda-diseno.test.ts (dentro de Unit) · auditar-diseno: 5 z-index arbitrarios (MapaCercaDeMi), 0 sombras/radios fuera de escala
Smoke / health:        NOT RUN  (requieren un despliegue)
```

---

## 9. Seguridad

| Área | Estado | Evidencia / pendiente |
|---|---|---|
| Tenant isolation | 🟡 | Capa de aplicación `conEmpresa`/`sinEmpresa` + `rls:cobertura` 0 huecos. Depende de la app mientras Capa 2 esté apagada |
| RLS | 🟡 | Capa 1 (REVOKE a `anon`/`authenticated` + RLS en todas las tablas de ese momento + privilegios por defecto) en `20260771`. Capa 2 (rol `membego_app`) **apagada** (`docs/RLS.md` §6). **Ninguna migración de Supply habilita RLS** en sus tablas (`grep` = 0): quedan protegidas por los REVOKE, no por RLS. Verificar en prod con las consultas de la migración `20260771` |
| Server authorization | ✅ | `requireRole('SUPERADMIN')` por página; `puedeSupplyV2` por acción |
| Permissions | ✅ | 93 funciones con guardia viva; segregación de funciones en `core/segregacion.ts` |
| QR anti-replay | ✅ | `SupplyV2QrSession.nonce` único y rotado; test «dos redenciones concurrentes del mismo voucher: solo una gana» PASS |
| Idempotency | ✅ | `idempotencyKey @unique` en 8 modelos de Supply; inbox `(provider, externalEventId, eventType)` único; outbox `dedupeKey` único. Impuesto por la base |
| Rate limiting | 🟡 | Upstash Redis distribuido si hay variables; si no, LRU local. **Fail-open** si Redis cae (decisión documentada) |
| Secrets | 🟡 | Validador de configuración en `/superadmin/supply-v2/operaciones`; rotación de secretos de webhook. Revisar `message_v4.rpmsg` versionado en la raíz (§14) |
| Payment security | ✅/⚪ | CardNET por tokens hospedados (SAQ A, sin PAN). Pasarela real de Supply V2 no conectada |
| Webhook validation | ✅ | HMAC, ventana anti-replay, kill switch, fail-closed (`supply-v2/operations/firma.ts`, `connect/webhooks*`) |
| Audit logs | ✅ | `AuditLog` insert-only; `supply-v2/core/auditoria.ts`; bitácoras por entidad |

Riesgos pendientes: sin pentest externo; Capa 2 de RLS apagada; `app.omnisciente` abrible por la propia app; RPO real desconocido; sin purgas de retención implementadas (§15).

---

## 10. Ledgers e invariantes

| Ledger | source of truth | append-only | reversal strategy | invariants | tests |
|---|---|---|---|---|---|
| Supply Ledger `SupplyV2LedgerEntry` | la suma de asientos; los contadores del lote son caché | por convención: **0** `update/delete` en `src` (sin trigger en BD) | asiento inverso (`REVERSAL`) | `quantityReceived = Σ cubetas`; CHECKs en `20261010` | db S1–S3 ✅ |
| Benefit Ledger `SupplyV2BenefitMovement` | movimientos; `budgetReserved/Consumed` son caché | convención: 0 mutaciones | `RELEASED`/`REVERSED` | reservado/consumido = Σ movimientos; CHECKs | db S6 ✅ |
| Points Ledger `SupplyV2PointsMovement` | movimientos con saldo resultante | **casi**: nunca se borra, pero `points.ts` modifica `consumedFromLot` (contabilidad FIFO de lotes) en 2 sitios | movimiento contrario | saldo ≥ 0; `idempotencyKey` único | db S8 ✅ |
| Deposit Ledger `SupplyV2SupplierDepositMovement` | movimientos del depósito | convención: 0 mutaciones | movimiento de reversa | disponible nunca negativo (probado bajo concurrencia) | db S4 ✅ |
| Economic Events `SupplyV2EconomicEvent` | eventos económicos por venta/entrega/vencimiento | convención: 0 mutaciones | evento compensatorio | margen = ingreso − costo | db S4–S5 ✅ |
| Obligations / Settlements | `SupplyV2SupplierObligation`, `Settlement` | estados, no borrado | cancelación con motivo | `outstanding = gross − paid` | db S4–S5 ✅ |
| Inventory (general) / Merchant Billing / Payment (general) | — | — | — | — | no existen como ledger propio |

**Hallazgo:** ningún ledger tiene append-only impuesto por la base (triggers); depende del código. Ver deuda §14.

---

## 11. Integraciones

| Integración | Estado | Uso | Pendiente |
|---|---|---|---|
| CardNET | 🟡 | Tokens hospedados para membresías de CARTOWN (`PAGO_CARDNET`) | **No integrado con Supply V2** (decisión de S9 §27); código SAQ D en pausa |
| Supabase | ✅ | Postgres, Auth, Storage | RLS Capa 2; Storage por empresa no cubierto |
| QStash | ✅ | Cola de trabajos | Sin token: ejecuta en línea (degradación honesta) |
| Sentry | ✅ | Errores | `SENTRY_DSN` opcional |
| Upstash Redis | 🟡 | Rate limit distribuido | fail-open |
| WhatsApp | ⚪ | Canal reservado; `estadoDeWhatsapp()` = `NOT_CONFIGURED` | Sin credenciales ni plantillas |
| Meta | ✅ | `connect/meta*` (mensajería, activos) | — |
| Google Calendar | ✅ | `connect/googleCalendar*` | — |
| Platform API | ✅ | `src/modules/plataforma`, `packages/platform-sdk`, `packages/contracts`; satélite `apps/restaurant` | — |
| Payment Provider Registry | 🟡 | Adaptadores de Supply V2 (`operations/adaptadores.ts`); `provider` es texto | Solo `TEST_GATEWAY` registrado |
| Correo (Resend) | ✅ | `lib/email.ts`, webhook `resend` | Duplicado posible en ventana de ms (S9 §11) |

---

## 12. Módulos ocultos / deprecated

**Resultado de la verificación: en el código no hay módulos 🙈 HIDDEN ni 🟣 DEPRECATED globales.** Lo que sigue contradice la premisa de que Supply V1, Gamificación, Blog y Home Builder estén ocultos.

| Módulo | Estado | Motivo | Cómo se oculta | Puede regresar |
|---|---|---|---|---|
| Supply V1 | ✅ visible | Coexiste con V2 («nuevo motor, en paralelo») | No se oculta: `/superadmin/supply` en `nav-config.ts`; `/admin/supply` solo con capacidad `MEMBEGO_SUPPLIER` | n/a (nunca salió) |
| Gamificación (ruleta) | ✅ visible por capacidad | — | Capacidad `RULETA` → sección `gamificacion` (`SECCIONES_POR_CAPACIDAD`); entrada en el hub Marketing | n/a |
| Blog | 🟡 público y vacío | Sin artículos (`ARTICULOS = []`); no se inventan | **No está oculto**: enlazado en `PublicFooter` y `sitemap.ts` | n/a |
| Home Builder (composición del Inicio) | ✅ visible | `home.prisma` (3 modelos); se administra en `/admin/personalizacion` | Sin bandera | n/a |
| Código de CardNET directo (SAQ D) | 🟣 en pausa | Reemplazado por tokens | Sin ruta activa (`cardnet-core.ts`, `cardnet.ts`, `cardnet3ds.ts`) | Sí |
| Primitivos `PromoBanner`/`FlashPromotion`/`Shine` (`packages/ui`) | 🟣 sin consumidor | Retiro previsto en F8 | — | Sí |
| Buscadores `BuscadorInicio/Unificado/Excursiones` | 🟣 sin consumidor (según plan F3) | — | — | Sí |

> Si la intención era ocultar alguno de los cuatro primeros, **hoy no está oculto** y hay que decidirlo (§16).

---

## 13. Decisiones arquitectónicas vigentes

Las de ADR (`docs/adr/0001–0009`) y las de esta sesión. No reabrir sin evidencia técnica fuerte.

- Monolito modular Next.js (App Router) + Prisma + Supabase Postgres; vertical slices con dominio **puro** separado de la base (`domain.ts` sin Prisma).
- Supply separado del inventario (ADR-0001); **ledger, no contador** (ADR-0002); «emitido ≠ redimido» (ADR-0004); concurrencia con bloqueo de fila (ADR-0005); FEFO configurable (ADR-0006); liquidación desde el ledger (ADR-0008); capa financiera en sublibros (ADR-0009).
- Supply V2 convive con V1 en paralelo; no se refactoriza V1.
- Migraciones **aditivas**, enums nuevos en migración aparte, ninguna editada tras aplicarse (sellos `SUMAS.txt`).
- El dinero cruza como texto formateado (`dineroSupplyV2`), nunca se recalcula en pantalla.
- Pasarelas: frontera genérica (`provider` = texto), dominio sin conocer a ningún proveedor; CardNET sigue aparte.
- Cola de trabajos única (la de Membego); sin motor tipo Zapier para dinero.
- **Rediseño Stitch:** dirección **blanca** obligatoria (fondo #FFFFFF; tarjetas blancas con borde #E8EAF0 y sombra mínima; gris solo dentro de componentes; color solo en detalles; estados solo en chips). **Prohibido** fondo general gris, lila o azulado. Una pantalla por vez, con aprobación previa; un commit por pantalla.
- Filtros en la URL (GET); paginación `pagina`/`filas` (10/25/50); la tabla única se reacomoda a tarjetas con container queries.
- Guardia de deuda de diseño: sin `text-[<12px]`, sin `shadow-[...]`.
- No se agrega backend para satisfacer un diseño: lo que no existe se informa y se omite o se dice con verdad.

---

## 14. Deuda técnica

| Severidad | Problema | Impacto | Acción recomendada |
|---|---|---|---|
| HIGH | Tablas de Supply (y toda tabla posterior a `20260771`) sin `ENABLE ROW LEVEL SECURITY` en migraciones | Protección solo por REVOKE/privilegios por defecto; si fallan, `anon` podría leer | Verificar en prod con las consultas de `20260771`; migración que habilite RLS en las tablas nuevas |
| HIGH | Ledgers sin append-only impuesto por la base | Un `UPDATE` ajeno corrompe la verdad contable | Triggers `BEFORE UPDATE/DELETE` en ledgers (salvo `consumedFromLot`) |
| MEDIUM | Consultas nuevas del rediseño sin pruebas unitarias propias | Regresión silenciosa en filtros/KPIs | Pruebas de `buscar*`/`resumen*` contra BD migrada |
| MEDIUM | Campañas (búsqueda `q` y paginación; `take: 200`) y Fidelización (todos los filtros y paginación; `take: 50`) trabajan **en memoria** | Se degrada y trunca con volumen | Mover filtro y paginación a SQL, como ya hacen Compras, Proveedores, Ofertas, Redenciones y Beneficios |
| MEDIUM | Campañas y Fidelización solo en la rama, sin PR | Se pierden si la rama se descarta | Abrir PR |
| MEDIUM | Archivos binarios versionados en la raíz: `stitch_…(1).zip` (7 MB), `ChatGPT Image….png` (2.4 MB), `message_v4.rpmsg` (1.5 MB, mensaje de correo protegido de Outlook; no se abrió) | Peso del repo; posible dato sensible | Revisar contenido; mover/retirar con aprobación |
| MEDIUM | Documentación desactualizada: `prisma/MIGRATIONS.md` dice «74» migraciones (hay 190); `docs/RLS.md` cubre «115 tablas» (hay 285 modelos); Slice 9 dice «bloque 5 no fusionado» (ya está en main, #562); `03-plan-fases.md` marca F2d «en curso» (ya hecho); `capacidades/catalogo.ts` dice «solo CAR_WASH operativa» (hay paquetes de otras categorías); la descripción de Supply 2.0 en `nav-config.ts` dice «Procurement… (nuevo motor, en paralelo)» | Decisiones sobre datos viejos | Actualizar al tocar cada área |
| MEDIUM | `docs/membego-supply-implementation-status.md` (V1) no es esta memoria | Dos fuentes de verdad | Enlazarlo desde aquí, no duplicar |
| LOW | `test:db` falla en bases `db push` (26 falsos) | Falsos rojos | Documentar en README de pruebas / script que cree base migrada |
| LOW | 5 `z-index` arbitrarios (`MapaCercaDeMi`) | Modal bajo mapa | Escala de z-index |
| LOW | 15 warnings de lint (`no-console`, `no-unused-vars`) | Ruido | Limpiar |
| LOW | Pipeline de mockups A/B (generadores `gen_*.py`, render con Playwright) vive solo en el scratchpad de la sesión | Se pierde | Documentarlo o versionarlo si se sigue con Stitch |

---

## 15. Riesgos abiertos

### Técnicos
- Estado real de producción desconocido: migraciones aplicadas, RLS y deriva de esquema sin verificar.
- Pantallas de detalle/alta de Supply 2.0 con diseño antiguo: la transición blanca/antigua es visible al navegar.
- Dev server local (`next dev`) escribe `AGENTS.md`/`CLAUDE.md` sin seguimiento en la raíz (se excluyeron localmente con `.git/info/exclude`).

### Comerciales
- Dos pantallas del rediseño sin PR ni revisión de producto.
- Elementos de Stitch que no existen y se omitieron (ITBIS, cierre fiscal, CTR/CPC, «Auto 98%», descargas .xlsx): el equipo de diseño debe saberlo.

### Financieros
- Sin pasarela real para Supply 2.0: los cobros externos solo están probados con `TEST_GATEWAY`.
- No existe Merchant Billing: no hay estado de cuenta al comercio.
- El costo potencial de puntos es **estimación** y debe seguir rotulado como tal.

### Seguridad
- Sin pentest externo; Capa 2 de RLS apagada; sin purgas de retención; borrado de cliente con compras V2 requiere decisión manual (S9 §20).
- Rate limit fail-open ante caída de Redis.

### Operacionales
- RPO real desconocido (`RECUPERACION.md` §1 sin rellenar).
- Cron diario del plan Hobby limita el barrido del inbox (100 eventos/día).
- WhatsApp inexistente; correo con posible duplicado en ventana de milisegundos.

---

## 16. Bloqueadores

Ninguno técnico. Decisiones que **necesitan al usuario** (no son bloqueadores):

| Qué | Impacto | Qué necesita | Responsable |
|---|---|---|---|
| Aprobar propuesta A/B de Finanzas | No se puede implementar Finanzas | Respuesta del usuario | Usuario |
| Adjuntar el Plan Maestro F0–F7 | §2 y §6 no se pueden reconciliar | El documento | Usuario |
| Decidir si Supply V1, Gamificación, Blog y Home Builder deben ocultarse | Hoy están visibles | Decisión y alcance | Usuario |
| Acceso a producción (migraciones, RLS, deriva) | §7 y §9 no verificables | Ejecutar `migraciones:pendientes` y `db:doctor` allí | Usuario / DevOps |

---

## 17. Próximo trabajo exacto

**Rediseño Stitch — Finanzas** (tras aprobación; propuesta A recomendada, plan ya presentado):

```text
1. Esperar la respuesta del usuario: A, B o combinación (mockups: finanzas-A/B, en el historial de la sesión).
2. Sincronizar: git fetch origin main && git merge --no-edit origin/main.
3. Leer finanzas/page.tsx y finance/queries.ts#resumenFinanzas (ya trae CxP, facturas, depósitos, pagos, economía y comisión).
4. Queries (solo lectura) en finance/queries.ts: conteo de conciliaciones abiertas; proveedor con mayor saldo vivo; reutilizar listarObligaciones(página 1) para la tabla.
5. Componentes en src/components/supply-v2/finanzas/: panel-comision.tsx, tarjetas-secciones.tsx, tabla-obligaciones.tsx (hoy hay otros 9 archivos en esa carpeta: no pisarlos).
6. Reescribir finanzas/page.tsx dentro de MarcoSupplyV2 conservando testids: kpi-cxp, kpi-facturas, kpi-depositos, kpi-pagos, kpi-gmv/revenue/cost/margen/vencido/breakage, finanzas-comision, kpi-comision-ingreso/neto, kpi-sin-liquidar, kpi-liq-por-pagar, economia-sin-datos, btn-nuevo-pago, btn-nueva-factura, seccion-<etiqueta>.
7. Conservar el bloque «Economía del mes» (Stitch no lo trae) como banda compacta; no perder Liquidaciones ni Economía como entradas.
8. NO inventar: ITBIS/retenciones, cierre fiscal, «Exportar .xlsx», «Auto 98%».
9. Probar: tsc, eslint src tests, npm test, next build, e2e slice4 y slice5 (escritorio y móvil), capturas 1440/1024/768/390 + oscuro + vacío.
10. Commit aparte (con atribución), push a claude/relaxed-brahmagupta-1shtlc, informe PANTALLA TERMINADA, parar.
```

Después, **Economía** (misma secuencia: mockups A/B → plan → aprobación → implementar → informe).

Cierre del rediseño: abrir PR con Campañas + Fidelización (+ Finanzas + Economía) hacia `main`; actualizar este archivo.

Hallazgos a atender cuando el usuario lo decida (no tocados): habilitar RLS en tablas de Supply; triggers append-only en ledgers; pruebas de las consultas nuevas; pasar a SQL los filtros en memoria.

---

# CONTEXTO PARA CONTINUAR EN UNA NUEVA SESIÓN

- **Qué construimos:** Membego (Next.js + Prisma + Supabase). El trabajo de esta sesión es el **rediseño visual Stitch de Supply 2.0**, pantalla por pantalla. El backend de Supply 2.0 (S1–S9) ya está terminado y en `main`.
- **Rama:** `claude/relaxed-brahmagupta-1shtlc`. Commits por pantalla en §3. Campañas (`5f65988`) y Fidelización (`2791c33`) **no están en main**.
- **Estado:** 9 de 11 pantallas hechas. **Finanzas**: mockups A/B enviados, plan presentado, **esperando aprobación**. **Economía**: sin empezar.
- **Reglas del usuario (innegociables):** una pantalla a la vez; flujo = analizar → mockups A/B (con etiquetas rosadas numeradas) → plan con la plantilla (PANTALLA, RUTA, IMAGEN, ARCHIVOS, DATOS, ELEMENTOS, CAMBIOS, COMPONENTES, FUNCIONALIDAD QUE NO TOCO, RIESGOS, RESPONSIVE, RESULTADO) → **parar y esperar aprobación** → implementar → probar → informe PANTALLA TERMINADA → parar. Un commit por pantalla. No cambiar lógica, servicios, permisos, Prisma ni migraciones. Datos reales; lo inexistente se informa. **Fondo blanco siempre; prohibido fondo general gris, lila o azulado.**
- **Imagen fuente:** `stitch_membego_supply_2.0_redesign (1).zip` en la raíz del repo (una carpeta por pantalla con `code.html` + `screen.png`).
- **Patrón de código:** `MarcoSupplyV2` + `TarjetaIndicador` + `BarraFiltrosSupplyV2` + `PaginacionSupplyV2` + `Tarjeta`; tabla única que se reacomoda en tarjetas (`@4xl`); tokens `--sv2-*` en `globals.css`; filtros por URL. Plantilla a copiar: `redenciones/`, `beneficios/`, `campanas/`, `fidelizacion/`.
- **Comandos de calidad:** `npx tsc --noEmit`, `npx eslint src tests` (no `eslint .`), `npm test`, `npx next build`, `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test tests/e2e/supply-v2-slice<N>.spec.ts --project=escritorio` (+`movil`). Postgres local: `pg_ctlcluster 16 main start`; dev: `npx next dev -p 3210`.
- **Trampa de pruebas:** `npm run test:db` solo es fiable sobre una base creada con `prisma migrate deploy` (la base local con `db push` da 26 falsos fallos).
- **Mockups:** se generaron con scripts en el scratchpad de la sesión (transforman el `code.html` de Stitch, compilan Tailwind v3 local, renderizan con Playwright a 1160 px). No están versionados.
- **Riesgos que no hay que olvidar:** RLS Capa 2 apagada y tablas de Supply sin RLS; ledgers sin append-only en BD; pasarela real de Supply no conectada; producción no verificada; Plan Maestro F0–F7 no está en el repo; Supply V1/Gamificación/Blog/Home Builder **no** están ocultos.
- **Antes de terminar una sesión:** actualizar este archivo (§1, §3, §8, §17 como mínimo).
