# MEMBEGO SUPPLY 2.0 — Auditoría de aplicación del Slice 2

Fecha: **2026-09-30** · Commit auditado: `ffaaffc` en `claude/inspiring-gates-2h8ew7`
(local y remoto coinciden). Complementa al reporte del slice
(`membego-supply-v2-slice2-auditoria.md`): aquel documenta lo entregado; este
comprueba, **después del push**, que lo entregado es lo que está en el commit y que
funciona sobre una base creada desde cero.

Método: nada se dio por hecho por existir un archivo. Cada punto se comprobó
contra una fuente primaria: el commit, una base de datos **vacía** llevada al día con
`prisma migrate deploy`, la salida de las suites y del navegador contra esa base, y
consultas SQL sobre lo que el recorrido dejó escrito.

Leyenda: ✅ verificado · ⚠️ observación (no bloquea).

---

## 1 · Integridad del commit

| Comprobación | Evidencia | Estado |
| --- | --- | --- |
| Commit empujado y sin cambios pendientes | `git status` limpio; `HEAD` = `origin/claude/inspiring-gates-2h8ew7` = `ffaaffc` | ✅ |
| Base de la rama | `origin/main` = `353651c`; la rama es `353651c` → `36b2c3c` (Slice 1) → `b6575e3` (auditoría S1) → `ffaaffc` (Slice 2). Slice 1 sigue sin mezclarse en `main`. | ⚠️ |
| Supply V1 intacto | `git diff HEAD~1 HEAD` sobre `src/modules/supply`, `components/supply`, `superadmin/supply`, `admin/supply`, `supply.prisma`, migración `20260926_membego_supply`: **0 archivos** | ✅ |
| Slice 1 no reescrito | `git diff HEAD~1 HEAD` sobre `supply-v2/{suppliers,catalog,agreements,procurement}` y la migración `20261010_supply_v2_slice1`: **0 archivos** | ✅ |
| Archivos compartidos tocados | 7 archivos, +88 −1: `identidad.prisma` (+24: 6 relaciones inversas en `User`, 16 valores de `AuditAccion`), `nav-config.ts` (+9, una entrada del menú del cliente), `auditoria/queries.ts` (+17, etiquetas), `e2e.yml` (+6, dos variables), `vercel.json` (+4, un cron), `promociones/page.tsx` (+28 −1, una sección), `SUMAS.txt` (+1 sello) | ✅ |
| Supply 2.0 no importa código de V1 | `grep "modules/supply/"` en `supply-v2`, sus pantallas, componentes y el cron: 0 | ✅ |
| V1 no conoce a V2 | `grep "supply-v2"` en `src/modules/supply`, `components/supply`, `superadmin/supply`: 0 | ✅ |
| Escrituras de V2 sobre tablas V1 | Único acceso a un modelo V1: `supplyCuentaCobro.findMany` / `findFirst` en `contracts/adapters.ts` (lectura de la cuenta de cobro). Ninguna escritura. | ✅ |

## 2 · Esquema y migración (base creada desde cero)

Se creó la base `auditoria` vacía y se ejecutó el historial completo como lo hace CI.

| Comprobación | Evidencia | Estado |
| --- | --- | --- |
| `migrate deploy` aplica las 165 migraciones, incluida la nueva | «165 migrations found … All migrations have been successfully applied»; `_prisma_migrations`: 165 terminadas | ✅ |
| Segunda pasada no hace nada | «No pending migrations to apply» | ✅ |
| Solo crea | 0 sentencias `DROP`/`DELETE`/`UPDATE`/`ALTER … DROP` en `20261011_supply_v2_slice2/migration.sql` | ✅ |
| Objetos creados | 7 tablas (`supply_v2_allocations`, `_allocation_lines`, `_offers`, `_customer_orders`, `_customer_order_lines`, `_order_reservations`, `_entitlements`), 10 enums `SupplyV2*`, 25 FKs, 13 índices únicos, 27 índices, 7 CHECK, 16 valores `SUPPLY_V2_*` nuevos en `AuditAccion`, `SupplyV2ReferenceType` ampliado a 7 valores | ✅ |
| FKs hacia Core | 6 FKs a `users` (creador de asignación, creador y publicador de oferta, cliente de la orden, quien confirma el pago, cliente del derecho). Sin `SupplyV2User/Company/Branch/Customer`. | ✅ |
| CHECK de Slice 1 sigue | `supply_v2_lots_buckets_balance` presente | ✅ |
| Tablas | 18 `supply_v2_*` (11 de S1 + 7 de S2); las 30 `supply_*` de V1 siguen ahí | ✅ |
| Drift contra la base recién creada | `prisma migrate diff --from-url <auditoria> --to-schema-datamodel`: exit 0 | ✅ |
| Sello | SHA-256 del `migration.sql` (`95fbe4f7…`) = línea de `SUMAS.txt` | ✅ |
| RLS Capa 2 preflight sobre la base nueva | «Ninguna tabla se quedaría denegada» | ✅ |

## 3 · Puertas de calidad (mismas que CI, sobre el commit)

| Puerta | Resultado | Estado |
| --- | --- | --- |
| `tsc --noEmit` | exit 0 | ✅ |
| `eslint src tests` | exit 0 | ✅ |
| `npm test` | 3 269 tests · 3 263 pass · 0 fail · 6 skipped | ✅ |
| `npm run test:db` contra la base **nueva** | 64 pass · 0 fail (V1 23 · Slice 1 21 · Slice 2 20) | ✅ |
| `next build` | exit 0; lista `/superadmin/supply-v2/ofertas{,/nueva,/[id],/ventas}`, `/promociones/membego/[slug]`, `/cliente/compras{,/[id]}`, `/api/cron/supply-v2` | ✅ |
| `transacciones-anidadas`, `rls-cobertura`, `permisos-catalogo` | exit 0 | ✅ |
| Playwright Slice 2 contra la base nueva | 1 passed (escritorio), 1 skipped (móvil, a propósito) · 34,5 s | ✅ |
| Playwright Slice 1 contra la base nueva (regresión) | 4 passed · 4 skipped (móvil) · 28,9 s | ✅ |

## 4 · Lo que el recorrido dejó en la base (SQL tras el E2E, base nueva)

| Consulta | Resultado | Estado |
| --- | --- | --- |
| Oferta creada por Compras | `MBG-OF-2026-000011` · ACTIVE · público 600.00 · Membego 399.00 · límite 100 · 2 por persona | ✅ |
| Asignación de la oferta | asignadas 100 · reservadas 0 · emitidas 1 · liberadas 0 · ACTIVE | ✅ |
| Lote que la financia | `LOT-2026-000007`: recibidas 1 000 · disponibles 900 · asignadas 99 · reservadas 0 · emitidas 1 · costo 300.00 · **cuadra = true** | ✅ |
| Ledger del lote, en orden | `RECEIPT 1000 · ALLOCATION 100 · RESERVATION 1 · ISSUE 1 · RESERVATION 1 · RELEASE_RESERVATION 1` | ✅ |
| Compras del cliente | `MBG-SO-2026-000013` PAID / CONFIRMED · 399.00 · TRANSFER · ref `TRX-E2E-001` · snapshot de cuenta · confirmada por alguien · `paidAt` puesto. `MBG-SO-2026-000014` EXPIRED / UNPAID · `expiredAt` puesto | ✅ |
| Reservas del cliente | 1 ISSUED (la pagada) · 1 RELEASED (la expirada) | ✅ |
| Derecho emitido | quantity 1 · costo real 300.00 · precio 399.00 · ACTIVE · PURCHASE · lote `LOT-2026-000007` | ✅ |
| Quien confirma el pago ≠ quien creó la oferta | `true` (Finanzas confirma lo que Compras publicó) | ✅ |
| cliente2 | 0 órdenes (y en el navegador no vio la compra de cliente) | ✅ |
| Todos los lotes de la base cuadran | 7/7 | ✅ |
| Derechos de toda la base (suites + E2E) | 11, todos con `quantity` = 1 | ✅ |
| Auditoría | Las 16 acciones aparecen en `audit_logs` con actor (S2 suites + E2E): ALLOCATION_CREATED 11, RELEASED 3, OFFER_CREATED 11, PUBLISHED 11, PAUSED 1, RESUMED 1, ENDED 2, CANCELLED 1, ORDER_CREATED 14, RESERVED 14, PAYMENT_SUBMITTED 5, CANCELLED 3, EXPIRED 2, PAID 7, PAYMENT_REJECTED 1, ENTITLEMENT_ISSUED 11 | ✅ |

## 5 · Seguridad, comprobada contra el servidor (base nueva)

| Comprobación | Evidencia | Estado |
| --- | --- | --- |
| Cron sin secreto | `GET /api/cron/supply-v2` → **401**; con `CRON_SECRET` el E2E lo llamó y expiró la reserva | ✅ |
| Área del cliente sin sesión | `GET /cliente/compras` → 307 a `/login?redirect=…` | ✅ |
| Admin de ofertas sin sesión | `GET /superadmin/supply-v2/ofertas` → 307 a `/login?redirect=…` | ✅ |
| Ficha pública anónima | `GET /promociones/membego/<slug>` → 200; muestra RD$600 / RD$399 / ahorro RD$201; el HTML completo contiene **0** veces `unitCost`, `actualUnitCost`, `LOT-2026`, `allocation`, `ledger`, `margen`, `300.00`, `RD$300` | ✅ |
| DTOs del cliente | `commerce/queries.ts`: 0 referencias a `actualUnitCost`, `unitCost`, `lotId` o `lot` | ✅ |
| Páginas protegidas | Las 4 páginas de `/superadmin/supply-v2/ofertas` y las 2 de `/cliente/compras` exigen rol o cliente en servidor | ✅ |
| Acciones | `actions-ofertas.ts`: 8 acciones, 9 comprobaciones de permiso; `actions-cliente.ts`: 3 acciones, 4 comprobaciones de identidad del cliente | ✅ |
| Ownership en dominio | `cancelarOrdenClienteEnTx` y `avisarPagoEnTx` rechazan con `ORDEN_AJENA`; `abrirOrdenClienteEnTx` rechaza `CLAVE_AJENA` (DB **B2**, **C**) | ✅ |

## 6 · Reglas de construcción

| Regla | Evidencia | Estado |
| --- | --- | --- |
| Sin `count()+1` | `grep` en `supply-v2`: 0 (solo el comentario que lo prohíbe); numeración `MBG-OF` / `MBG-SO` con `pg_advisory_xact_lock` | ✅ |
| Sin flotantes en dinero | `parseFloat` en `supply-v2`: 0; `Decimal` en `core/precios.ts` y `core/dinero.ts` | ✅ |
| TTL en un solo sitio | `SUPPLY_V2_RESERVATION_TTL_MINUTES` solo se lee en `core/config.ts`; el único consumidor es `commerce/checkout.ts`; 0 «15 × 60» sueltos | ✅ |
| `RESERVED` nunca vuelve a `AVAILABLE` | Cancelar, expirar y rechazar pago usan `RELEASE_RESERVATION` hacia `ALLOCATED` (DB **C**, **F**, **F2**); solo finalizar/cancelar la oferta libera `ALLOCATED → AVAILABLE` (DB **I**, **M**) | ✅ |
| Lo emitido no se toca al cerrar la oferta | DB **I** y **M**: `ISSUED` igual antes y después; el derecho sigue `ACTIVE` | ✅ |
| Un derecho por unidad, con el costo del lote real | CHECK `supply_v2_entitlements_unit`; DB **D** (300 del LOT-A) y **G2** (280 del LOT-B); SQL: 11/11 con `quantity` = 1 | ✅ |

## 7 · Observaciones (no bloquean)

- **Slice 1 no está en `main`.** El prompt suponía que sí. La rama contiene ambos slices; conviene mezclarlos juntos o Slice 1 primero.
- **La portada `/promociones` solo muestra la sección Membego cuando hay ofertas comprables.** Al probarlo, la base ya tenía 6 ofertas ACTIVE de las suites, así que la sección apareció; el E2E cubre el caso «después de publicar, el anónimo ve la tarjeta». No se probó la portada con cero ofertas.
- **`pkill -x next-server` no mata al servidor de Next 16** (su nombre de proceso es `next-server (v16.3.4)`); durante la auditoría un servidor viejo apuntando a `membego_dev` siguió vivo hasta matarlo por PID. Ninguna evidencia de este documento se tomó de ese servidor: las consultas y el E2E se hicieron contra `auditoria` tras confirmar el PID nuevo.
- **El workflow E2E de GitHub no ha corrido** en esta rama porque no hay PR; las puertas se ejecutaron localmente con los mismos comandos y variables (`CRON_SECRET`, `SUPPLY_V2_RESERVATION_TTL_MINUTES`).
