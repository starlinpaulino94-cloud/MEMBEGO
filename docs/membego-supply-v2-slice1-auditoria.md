# MEMBEGO SUPPLY 2.0 — Auditoría de aplicación del Slice 1

Fecha: **2026-09-29** · Commit auditado: `36b2c3c` en `claude/inspiring-gates-2h8ew7`
(local y remoto coinciden). Método: nada se dio por hecho por existir un
archivo. Cada punto se comprobó contra una fuente primaria: el commit, una
base de datos creada **desde cero** con `prisma migrate deploy`, la salida de
las suites y del navegador, y consultas SQL sobre lo que el recorrido dejó
escrito.

Leyenda: ✅ verificado · ⚠️ observación (no bloquea).

---

## 1 · Integridad del commit

| Comprobación | Evidencia | Estado |
| --- | --- | --- |
| Commit empujado y sin cambios pendientes | `git status` limpio; `HEAD` = `origin/claude/inspiring-gates-2h8ew7` = `36b2c3c` | ✅ |
| Base: la rama nace del último `main` mezclado (PR #526) | `HEAD~1` = `353651c` | ✅ |
| Supply V1 intacto | `git diff HEAD~1 HEAD` sobre `src/modules/supply`, `components/supply`, `superadmin/supply`, `admin/supply`, `supply.prisma`, migración `20260926_membego_supply`: **0 archivos** | ✅ |
| Archivos compartidos tocados | `identidad.prisma` (+26, solo relaciones inversas y enum), `carwash.prisma` (+4, relaciones inversas), `nav-config.ts` (+7, una entrada), `auditoria/queries.ts` (+12, etiquetas), `e2e.yml` (+13, dos variables), `package.json` (+1 script), `SUMAS.txt` (+1 sello) | ✅ |
| Supply 2.0 no importa código de V1 | `grep "modules/supply/"` en `supply-v2` y sus pantallas: 0 | ✅ |

## 2 · Esquema y migración (base creada desde cero)

Se creó una base vacía y se ejecutó el historial completo como lo hace CI.

| Comprobación | Evidencia | Estado |
| --- | --- | --- |
| `migrate deploy` aplica las 164 migraciones, incluida la nueva | `_prisma_migrations`: 164 terminadas | ✅ |
| Segunda pasada no hace nada | «No pending migrations to apply» | ✅ |
| Migración idempotente por dentro | enums en `DO … duplicate_object`, `CREATE TABLE IF NOT EXISTS`, índices `IF NOT EXISTS`, FKs y CHECK en bloques que tragan duplicados | ✅ |
| Solo crea | 0 sentencias `DROP`/`UPDATE`/`DELETE`/`ALTER … DROP` sobre tablas existentes | ✅ |
| Objetos creados | 11 tablas `supply_v2_*`, 16 enums `SupplyV2*`, 36 FKs, 21 índices únicos, 9 CHECK, 11 valores `SUPPLY_V2_*` en `AuditAccion` | ✅ |
| FKs hacia Core (referencia, no duplicado) | `companies` ×1, `users` ×9, `sucursales` ×1, `servicios` ×1, `productos_inventario` ×1 | ✅ |
| Tablas V1 siguen ahí | 30 tablas `supply_*` (sin `supply_v2_`) | ✅ |
| Drift esquema ↔ migraciones (gate de CI) | `prisma migrate diff --exit-code`: «No difference detected», exit 0 | ✅ |
| Sello de la migración | SHA-256 del `migration.sql` = línea de `SUMAS.txt` | ✅ |
| RLS Capa 2 preflight | «Ninguna tabla se quedaría denegada» | ✅ |

## 3 · Puertas de calidad (mismas que CI)

| Puerta | Resultado | Estado |
| --- | --- | --- |
| `npx tsc --noEmit` | exit 0 | ✅ |
| `npx eslint src tests` | 0 errores · 15 avisos, **ninguno** en archivos de Supply 2.0 (preexistentes) | ✅ |
| `npm test` | 3.253 pruebas · 3.247 pasan · 0 fallan · 6 saltadas preexistentes (ninguna de Supply 2.0) | ✅ |
| `npm run test:db` sobre la base recién migrada | 44 pruebas · 44 pasan (21 de Supply 2.0 + 23 de V1) | ✅ |
| `npm run build` | exit 0 | ✅ |
| Playwright (escritorio + móvil) sobre la base recién migrada | 4 pasan · 4 saltadas por proyecto (cada prueba corre en un solo viewport) | ✅ |
| Transacciones anidadas | «Ninguna transacción anidada» | ✅ |
| Cobertura de tenant (`sinEmpresa`) | «Todos los archivos con consultas usan conEmpresa/sinEmpresa» | ✅ |
| Catálogo de permisos | «93 funciones, guardia viva en las dos direcciones» | ✅ |

## 4 · Lo que el recorrido dejó en la base (consultado con SQL tras el E2E)

| Comprobación | Evidencia | Estado |
| --- | --- | --- |
| Orden creada por Compras y aprobada por Finanzas | `MBG-PO-2026-000007`, `createdById <> approvedById` = true | ✅ |
| Tres recepciones que suman lo comprado | 3 recepciones · 1.000 unidades | ✅ |
| Un lote por recepción, cuadrado | 3 lotes · recibido 1.000 · disponible 1.000 · invariante true en todos | ✅ |
| Ledger = verdad | 3 asientos `RECEIPT` · suma 1.000 · `balanceAfter − balanceBefore = quantity` en todos | ✅ |
| Historial derivado, no hardcodeado | eventos: CREATED → SUBMITTED → APPROVED → RECEIPT_CONFIRMED → RECEIPT_CONFIRMED → RECEIVED | ✅ |
| Bitácora con actor, IP y user-agent | `SUPPLY_V2_PO_CREATED`/`SUBMITTED` por compras, `APPROVED` por finanzas; 13/13 asientos de bitácora del navegador con IP o user-agent | ✅ |
| Seed solo V2 e idempotente | 1.ª pasada crea proveedor, ítem, acuerdo v1, orden APROBADA sin recibir; 2.ª pasada: «ya existe» y no crea nada | ✅ |

## 5 · Definition of Done (§55) con evidencia

| Criterio | Evidencia | Estado |
| --- | --- | --- |
| Proveedor externo funciona | E2E paso 1 · DB test 1 · `companyId` nulo y `source=EXTERNAL` | ✅ |
| Empresa existente funciona | DB test 2: vincula una `Company`, no crea otra, idempotente · UI: autocompletar en `form-proveedor.tsx` | ✅ |
| Catálogo funciona | E2E paso 2 · DB test 3 | ✅ |
| Producto reusable | El wizard lista los ítems del proveedor y el acuerdo/orden apuntan por `catalogItemId` (`orders.ts`) | ✅ |
| Agreement funciona | E2E paso 3 · DB test 5 | ✅ |
| Versionado funciona | DB test 6 (v1 al activar, sin duplicar) · test 7c (nueva versión no altera la orden histórica) | ✅ |
| PO funciona | E2E paso 6 · DB test 7 (total 300.000,00 con Decimal) | ✅ |
| Número concurrency-safe | `pg_advisory_xact_lock` en `numeracion.ts` · DB test 7b (dos altas simultáneas, números distintos) · 0 usos de `count()+1` | ✅ |
| Aprobación funciona | E2E (Finanzas aprueba) · DB test 9 | ✅ |
| Segregación funciona | Servidor: `puedeAprobar` en `estados.ts` + DB test 9 (el creador falla) · UI oculta el botón · E2E lo comprueba con dos sesiones | ✅ |
| Recepción parcial funciona | DB test 10 (500/1.000 → PARTIALLY_RECEIVED) · E2E | ✅ |
| Varias recepciones funcionan | DB tests 11–12 · E2E 500/300/200 | ✅ |
| Over-receipt bloqueado | Dominio `validarCantidadRecibida` · DB test 13 (201 falla sin dejar rastro) · CHECK `receivedQuantity <= quantity` (test 15) | ✅ |
| Lote creado | DB test 10 · SQL post-E2E: 3 lotes | ✅ |
| Ledger creado | DB test 14 (Σ asientos = cubetas) · SQL post-E2E | ✅ |
| Invariante garantizada | `invarianteCumplido` (dominio) · pruebas puras · CHECK `supply_v2_lots_buckets_balance` rechaza el descuadre (test 15) | ✅ |
| Dashboard actualizado | E2E: actividad reciente muestra «Orden recibida por completo»; cifras salen de `resumenSupplyV2()` | ✅ |
| Supply agregado por producto | `supplyPorProducto()` · E2E lee 500/800/1.000 en la tarjeta del producto | ✅ |
| Todo desde UI | El E2E no toca la base salvo para crear los dos usuarios de sesión | ✅ |
| Ningún ID manual | El wizard y los formularios trabajan con selects, autocompletar y campos ocultos | ✅ |
| Audit log | 11 acciones `SUPPLY_V2_*`, escritas con la misma transacción (`auditarEnTx`) | ✅ |
| Backend auth | Toda action llama `exigirPermisoSupplyV2` antes de abrir la transacción (11 de 11) · E2E: sin sesión redirige a login | ✅ |
| Unit tests | 18 pruebas puras en `tests/supply-v2-dominio.test.ts` | ✅ |
| PostgreSQL tests | 21 en `tests/postgres/supply-v2-slice1.db.test.ts` | ✅ |
| E2E Playwright | `tests/e2e/supply-v2-slice1.spec.ts`, verde en escritorio y móvil | ✅ |
| Typecheck limpio | exit 0 | ✅ |
| Lint limpio | 0 errores; 0 avisos en Supply 2.0 | ✅ |
| Build limpio | exit 0 | ✅ |
| Supply V1 intacto | 0 archivos de V1 en el commit · E2E abre `/superadmin/supply` y `/superadmin/supply/ordenes` con sesión y renderizan | ✅ |

## 6 · Observaciones (no bloquean)

- ⚠️ El aprobador también ve el formulario de recepción: en el Slice 1 los seis
  permisos los tiene el rol `SUPERADMIN`. Cuando existan roles distintos para
  comprar, aprobar y recibir, la política vive en un solo sitio
  (`contracts/adapters.ts:rolPuede`).
- ⚠️ El E2E se salta en cualquier entorno sin `SUPABASE_JWT_SECRET`,
  `DATABASE_URL` y `NEXT_PUBLIC_SUPABASE_URL`; en CI (`e2e.yml`) las tres
  existen. Si alguien las quita, la suite pasa a «saltada», no a «verde
  falso»: el motivo se imprime.
- ⚠️ `origin/main` local estaba en `09a289d` (por detrás de `353651c`); la
  rama parte del merge de PR #526, que es lo que había en el checkout de
  esta sesión. Al abrir el PR conviene confirmar que la base es `main`.
