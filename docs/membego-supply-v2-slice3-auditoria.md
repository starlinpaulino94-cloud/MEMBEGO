# MEMBEGO SUPPLY 2.0 — Auditoría del Vertical Slice 3

Fecha: **2026-09-30** · Rama: `claude/inspiring-gates-2h8ew7`.
Alcance: ENTITLEMENT → VOUCHER → QR TEMPORAL → ESCÁNER DEL PROVEEDOR →
VALIDACIÓN SERVER-SIDE → CONFIRMACIÓN → REDEMPTION (ISSUED → REDEEMED) → REVERSA.

Método: **no se marca ✅ por existencia de código**. Cada criterio se comprobó
contra una fuente primaria: la salida de las suites (dominio, PostgreSQL,
Playwright en escritorio y móvil), consultas SQL sobre lo que el recorrido dejó
escrito, una base creada desde cero con `migrate deploy`, `git diff` sobre las
zonas prohibidas y las mismas puertas que corre CI.

Leyenda: ✅ verificado con evidencia · ⚠️ observación o riesgo (no bloquea) ·
⛔ fuera de alcance por decisión del prompt.

---

## 1 · BASE COMMIT

| Comprobación | Evidencia | Estado |
| --- | --- | --- |
| `main` remoto al iniciar | `origin/main` = `cadbc36` (merge del PR #529). | ✅ |
| Slices 1 y 2 presentes en la base | `git merge-base --is-ancestor` de `36b2c3c` (S1), `ffaaffc` (S2) y `c5d22d8` (fix S2) sobre `cadbc36`: los tres son ancestros. | ✅ |
| Rama reiniciada desde esa base | `git checkout -B claude/inspiring-gates-2h8ew7 origin/main` (la rama anterior ya estaba mezclada). | ✅ |
| Pruebas de S1/S2 antes de escribir código | `npm run test:db` sobre `cadbc36`: 65 pass · 0 fail; `tsc --noEmit` limpio. | ✅ |
| S1/S2 no reescritos | `git diff HEAD` sobre `suppliers/`, `catalog/`, `agreements/`, `procurement/`, `allocations/`, `offers/`, `marketplace/` y las migraciones `20261010`/`20261011`: **0 archivos**. Los 16 archivos de S2 tocados son ampliaciones (+215 −28): tipo de referencia del ledger, etiquetas, estados, DTO del cliente con la entrega, pool con «redimidas», cron. | ✅ |

## 2 · ARQUITECTURA

| Criterio | Evidencia | Archivo |
| --- | --- | --- |
| Todo dentro de `src/modules/supply-v2/**` | Nuevo `redemption/{domain,service,queries}.ts`, `actions-canje.ts`, guardia del proveedor en `permisos.ts`. | `src/modules/supply-v2/redemption/` |
| V2 no importa V1 | `grep "modules/supply/"` en `supply-v2`, `components/supply-v2`, `admin/supply-v2`, `superadmin/supply-v2`, `cliente/compras`: **0**. V1 se estudió como referencia (nonce, candados, índice parcial) y se corrigieron sus huecos: empresa desde la sesión, ownership del cliente, sucursal verificada, sesión revalidada al confirmar, clave de idempotencia por confirmación. | — |
| Reglas puras separadas de la base | `redemption/domain.ts`: nonce, estado derivado de la sesión, `motivoNoCanjeable`, mensajes. Sin Prisma. | `redemption/domain.ts` |
| Dos validaciones (§23) | La misma `motivoNoCanjeable` corre en el preview (sin cambios) y otra vez dentro de la transacción de confirmación con las filas bloqueadas. | `redemption/service.ts` (`previsualizarCanjeEnTx`, `confirmarEntregaEnTx`) |
| Portal del proveedor reutiliza el panel de empresa | `/admin/supply-v2` cuelga de la sección `supply` y la capacidad `MEMBEGO_SUPPLIER` (una línea en `SECCION_POR_PREFIJO`), igual que el portal de V1. | `src/lib/auth/permissions.ts`, `src/app/(admin)/admin/supply-v2/layout.tsx` |
| Cámara y QR con la infraestructura existente | Escáner: `components/scanner/QRScanner` (html5-qrcode) con fallback manual; QR: `lib/qr.ts` (`qrcode`). | `components/supply-v2/escaner-proveedor.tsx`, `usar-beneficio.tsx` |
| Rate limiting con lo existente (§54) | `createRateLimiter` de `lib/rate-limit.ts`: 30/min por empleado (resolver y confirmar), 10/min por cliente (generar QR). | `actions-canje.ts` |

## 3 · ENTIDADES

4 tablas nuevas (22 `supply_v2_*` en total; V1 sigue con sus 30 `supply_*`).

| Entidad | Tabla | Qué guarda | Estado |
| --- | --- | --- | --- |
| `SupplyV2Voucher` | `supply_v2_vouchers` | Un derecho → credencial opaca `code` (32 bytes base64url, única), estado ACTIVE/REDEEMED/EXPIRED/CANCELLED/REVOKED, `validFrom/validUntil`. **Un solo voucher ACTIVE por derecho** (índice único parcial). | ✅ |
| `SupplyV2QrSession` | `supply_v2_qr_sessions` | `nonce` único (24 bytes = 192 bits), `expiresAt`, `branchId?`, quién lo abrió y con qué dispositivo, `consumedAt/consumedByUserId/consumedDeviceInfo`. Estado **derivado** (§44). | ✅ |
| `SupplyV2Redemption` | `supply_v2_redemptions` | `number` (`MBG-RD-…`), derecho, voucher, sesión (única), cliente, proveedor, producto, lote, sucursal, empleado, `quantity = 1`, `unitCostSnapshot`, `customerUnitPriceSnapshot`, `customerPaysMerchant`, canal, dispositivo, `reversedAt/By/Reason`, `idempotencyKey` única. **Una sola redención viva por derecho** (índice único parcial). | ✅ |
| `SupplyV2RedemptionIncident` | `supply_v2_redemption_incidents` | Incidencia mínima desde el escáner (§41): tipo, notas, sesión o código visto, empleado, sucursal. | ✅ |

`SupplyV2EntitlementStatus` += `REDEEMED` (sin cambiar el significado de ISSUED en el
ledger); `SupplyV2ReferenceType` += `REDEMPTION`; 12 acciones nuevas en `AuditAccion`.
Sin `SupplyV2User/Company/Branch/Customer`: se referencia `users` y `sucursales`.

## 4 · MIGRACIÓN

| Comprobación | Evidencia | Estado |
| --- | --- | --- |
| Una migración nueva, ninguna aplicada se edita | `prisma/migrations/20261012_supply_v2_slice3/migration.sql`; `git status` no toca `20261010` ni `20261011`. | ✅ |
| Base vacía → `migrate deploy` | Base `auditoria` creada desde cero: «166 migrations found … successfully applied»; `_prisma_migrations`: 166 terminadas. | ✅ |
| Segunda pasada | «No pending migrations to apply». Además el SQL aplicado a mano dos veces sobre `membego_dev`: solo `NOTICE … already exists, skipping`. | ✅ |
| Solo crea | 4 `CREATE TABLE`, 3 enums, `ADD VALUE IF NOT EXISTS`, 12 FKs, 0 `DROP`/`DELETE`/`UPDATE`. | ✅ |
| Barreras fuera del modelo Prisma | Índices únicos parciales `supply_v2_vouchers_entitlement_activo` (`WHERE status='ACTIVE'`) y `supply_v2_redemptions_entitlement_viva` (`WHERE reversedAt IS NULL`); CHECK `supply_v2_redemptions_unit`, `supply_v2_redemptions_reversal` (reversa ⇒ motivo y quién), `supply_v2_qr_sessions_window`, `supply_v2_vouchers_window`. Presentes en la base nueva (2 índices parciales, 4 CHECK). | ✅ |
| Drift (gate de CI) | `prisma migrate diff --from-migrations … --shadow-database-url`: «No difference detected», exit 0; también contra la base recién creada: exit 0. | ✅ |
| Sello | SHA-256 del `migration.sql` (`e951adf4…`) = línea de `SUMAS.txt`. | ✅ |
| RLS Capa 2 preflight | «Ninguna tabla se quedaría denegada» (las 4 tablas llegan por FK NOT NULL a `supply_v2_suppliers`/`users`). | ✅ |

## 5 · VOUCHER

| Criterio | Evidencia | Test |
| --- | --- | --- |
| Se crea desde un derecho ACTIVE del cliente; idempotente (uno activo por derecho) | DB **A**: `emitirVoucherEnTx` dos veces devuelve el mismo id; `reemitido=false`. | `supply-v2-slice3.db.test.ts` A |
| No para cancelado / vencido / utilizado / ajeno | Dominio 1–2; DB **B** (`abrirQr` de un derecho REDEEMED → «ya fue utilizado»), **F2** (otro cliente → «no es tuyo»), **I** (vencido → «venció»). | dominio 1, 2, 18; DB B, F2, I |
| No es el QR ni un cupón | El `code` del voucher nunca viaja al navegador; el QR lleva solo el `nonce` de la sesión. `grep code` en `usar-beneficio.tsx` y en el DTO del cliente: no se expone. | `redemption/queries.ts`, `usar-beneficio.tsx` |
| Sobrevive a varias sesiones QR | DB **D**: QR expirado → `abrirQr` de nuevo → mismo `voucherId`, nonce distinto. | DB D |
| Historial: no se borra ni se reutiliza a ciegas | Tras la reversa el voucher vuelve a ACTIVE solo si sigue vigente; sesiones anteriores quedan consumidas. | DB G |

## 6 · QR SECURITY

| Criterio | Evidencia | Test |
| --- | --- | --- |
| Nonce ≥ 128 bits, `crypto.randomBytes`, único en base | 24 bytes → 32 caracteres base64url; 2 000 nonces sin repetición; `@unique` en la tabla. | dominio 3; `supply-v2.prisma` |
| El QR solo contiene el nonce | `toQrDataUrl(sesion.nonce)`; ni `customerId`, ni `lotId`, ni costo, ni `entitlementId`. | `usar-beneficio.tsx` |
| Un id de Prisma no vale como token | Formato exigido (`^[A-Za-z0-9_-]{32}$`); un cuid da `INVALID_QR`. | dominio 3; DB **D2** |
| TTL configurable en un solo sitio | `SUPPLY_V2_QR_TTL_MINUTES` leído únicamente en `core/config.ts`; 5 min por defecto; el cliente usa el `expiresAt` del servidor para la cuenta atrás. | dominio 18; `core/config.ts` |
| QR expirado falla aunque el voucher siga activo, sin efectos | DB **D**: preview `QR_EXPIRED`, confirmar rechaza, derecho ACTIVE, voucher ACTIVE, lote sin cambios. E2E: «Este código expiró» en el escáner tras adelantar el reloj. | DB D; E2E |
| QR consumido no se reutiliza (screenshot, reenvío) | `consumedAt` bloquea; DB **B** (mismo QR → «ya fue utilizado»), **G** (tras la reversa, el QR viejo da `QR_CONSUMED`). E2E doble escaneo. | DB B, G; dominio 5, 15; E2E |
| Ownership al generar (§46) | `abrirSesionQrEnTx` compara con el `customerId` de la sesión; la action toma el cliente de `exigirCliente()`, nunca del formulario. | DB F2; `actions-canje.ts` |
| Generar solo al pulsar (§11) | La página muestra «Usar beneficio»; la sesión se crea en la action. E2E: `qr-beneficio` no existe antes del clic. | E2E |
| Rate limit | 10 QR/min por cliente; 30 escaneos/min por empleado. | `actions-canje.ts` |

## 7 · SCANNER

| Criterio | Evidencia | Archivo / Test |
| --- | --- | --- |
| Portal del proveedor sin finanzas de Membego | `/admin/supply-v2`: Escanear, Entregas de hoy, Pendientes, Incidencias; filtros Hoy/7/30. Sin costos. | `(admin)/admin/supply-v2/page.tsx`; E2E `entregas-hoy` 0 → 1 |
| Cámara + código manual | `QRScanner` (html5-qrcode, `ssr:false`) y «Escribir el código a mano»; mensaje de permiso de cámara. E2E usa el camino manual (sin cámara en CI). | `escaner-proveedor.tsx` |
| Nunca valida localmente | El escáner solo manda el texto leído a `escanearBeneficioAction`. | `escaner-proveedor.tsx` |
| Dos pasos: preview y confirmación explícita | `preview-valido` → botón «Confirmar entrega» → `entrega-confirmada`. | E2E |
| Pantalla de validación (§19) | Cliente, producto, cantidad, proveedor, sucursal, «Cubierto por Membego: Sí», «Cliente debe pagar: RD$0.00», «Listo para entregar». | E2E (`preview-cliente`, `preview-producto`, `preview-paga`) |
| Nada interno llega al empleado (§20) | El HTML del preview no contiene `unitCost`, `actualUnitCost`, `LOT-`, `margen` (afirmado en el E2E); el DTO `RedeemPreview` no tiene esos campos (DB **A**). | E2E; DB A |
| Preview rechazado no filtra al cliente | DB **E**: `customerName === undefined` en un rechazo por otro comercio. | DB E |
| Mensajes claros (§67) | `MENSAJES_RECHAZO`: expiró / ya fue utilizado / otro comercio / esta sucursal / venció / no válido. | dominio 4, 10, 12 |
| Incidencia mínima (§41) | Formulario tras un rechazo: tipo + notas → `supply_v2_redemption_incidents` + auditoría. | `registrarIncidenciaEnTx` |

## 8 · REDEMPTION

| Criterio | Evidencia | Test |
| --- | --- | --- |
| Una sola transacción (§22) | `confirmarEntregaEnTx` dentro de `sinEmpresa(...)`: candados derecho → voucher → sesión (→ lote en `registrarAsientoEnTx`), revalidación, consumir sesión, voucher y derecho REDEEMED, redención, ledger, auditoría. | `redemption/service.ts` |
| Redención con quién/dónde/cuándo/qué y snapshots | DB **A**: `customerId`, `supplierId`, `branchId`, `employeeId`, `lotId`, `quantity=1`, costo 300.00, precio 399.00, paga 0.00. SQL tras el E2E: 5 redenciones con costo 300.00 / precio 399.00 / paga 0.00 / Bávaro / empleado / cliente. | DB A; SQL |
| Entitlement → REDEEMED, voucher → REDEEMED, sesión consumida | DB **A** (los tres estados + `consumedByUserId` = empleado). | DB A |
| Idempotencia de la confirmación (§70) | DB **A2**: misma `idempotencyKey` → misma redención, `repetida=true`, 1 fila; la clave de otro empleado se rechaza. | DB A2 |
| Numeración `MBG-RD-AAAA-NNNNNN` sin `count()+1` | `siguienteNumero(tx, 'MBG-RD', …)` con `pg_advisory_xact_lock`. `grep "count()\s*+\s*1"`: 0. | DB A |
| Canal y dispositivo | `channel` QR_SCAN/MANUAL_CODE (E2E deja `MANUAL_CODE`), `deviceInfo` = user-agent recortado a 200. | SQL |

## 9 · REVERSAL

| Criterio | Evidencia | Test |
| --- | --- | --- |
| Solo superadmin con permiso; motivo obligatorio | `exigirPermisoSupplyV2('SUPPLY_V2_REDEMPTION_REVERSE')`; motivo vacío rechazado en dominio y action; CHECK `supply_v2_redemptions_reversal`. | DB G; `actions-canje.ts` |
| REDEEMED → ISSUED, derecho ACTIVE, voucher utilizable | DB **G**: `reversedAt/By/Reason` puestos, derecho ACTIVE, voucher ACTIVE, lote issued 1 / redeemed 1, asiento REVERSAL. | DB G |
| El QR antiguo no revive; nuevo QR obligatorio | DB **G**: nonce viejo → `QR_CONSUMED`; `abrirQr` nuevo → mismo voucher → entrega otra vez. E2E: mismo recorrido por la interfaz. | DB G; E2E |
| Segunda reversa falla, sin duplicar ledger | DB **H**: «ya fue reversada»; 2 asientos (REDEMPTION + REVERSAL) por redención. | DB H |
| No reversar si hay inconsistencia | Derecho no REDEEMED o lote sin REDEEMED → `INCONSISTENTE` / `LEDGER_INCONSISTENT`; otra redención viva → rechazo. | `reversarRedencionEnTx` |
| Historial intacto | La redención reversada sigue en la tabla (`reversedAt` puesto); E2E: la lista muestra 2 redenciones del producto, una «Reversada». | E2E; SQL |

## 10 · LEDGER

| Criterio | Evidencia | Test |
| --- | --- | --- |
| ISSUED → REDEEMED al entregar, nunca desde AVAILABLE | `MOVIMIENTOS_PERMITIDOS.REDEMPTION` solo admite ISSUED → REDEEMED. | dominio 11, 17 |
| REDEEMED → ISSUED al reversar, con motivo obligatorio | `REVERSAL` exige `reason`. | dominio 13, 14 |
| Invariante tras entregar y tras reversar | SQL tras el E2E: `LOT-2026-000112`: 1 000 = 900 + 99 + 0 + 0 + 1 + 0, cuadra; ledger `RECEIPT 1000 · ALLOCATION 100 · RESERVATION 1 · ISSUE 1 · REDEMPTION 1 · REVERSAL 1 · REDEMPTION 1`. Todos los lotes de la base: 116/116 cuadran. | SQL; DB J |
| Pool muestra Redimidas | `/superadmin/supply-v2/supply`: Disponibles · Asignadas · Reservadas · Emitidas · **Redimidas**; E2E: 900 / 99 / 1 / 0 → 900 / 99 / 0 / 1 → (reversa) 1 / 0 → 0 / 1. | E2E `pool-redimidas` |

## 11 · CONCURRENCIA

| Riesgo | Mecanismo | Test |
| --- | --- | --- |
| Dos confirmaciones simultáneas del mismo derecho | `FOR UPDATE` sobre el derecho (primer candado) serializa; el segundo revalida y ve REDEEMED. Además el índice único parcial `redemptions_entitlement_viva`. | DB **C**: 1 éxito, 1 «ya fue utilizado», 1 redención viva, 2 asientos REDEMPTION en total (uno por prueba) |
| Dos escáneres con el mismo nonce | Preview concurrente no consume; el primero en confirmar gana; `updateMany({consumedAt: null})` con `count === 1`. | DB **C2** |
| Reenvío por timeout | `idempotencyKey` única. | DB A2 |
| Doble reversa | `FOR UPDATE` sobre la redención + `reversedAt` comprobado. | DB H |
| Numeración | `pg_advisory_xact_lock` por prefijo y año. | `core/numeracion.ts` |
| La base rechaza dos redenciones vivas del mismo derecho aunque el código fallara | DB **H** (inserción directa → violación de unicidad / FK). | DB H |

## 12 · AUTHORIZATION

| Criterio | Evidencia | Test |
| --- | --- | --- |
| Proveedor derivado de la sesión, nunca del formulario (§47) | `proveedorDeLaSesion()`: `requireSection('supply')` + `companyId` del JWT + `SupplyV2Supplier.companyId` único y ACTIVE. Las actions no aceptan `supplierId`. | `permisos.ts`, `actions-canje.ts` |
| Empleado de otro comercio | `WRONG_SUPPLIER` en preview y confirmación; el preview no enseña nada. | DB **E**; dominio 8 |
| Sucursal verificada contra la empresa del empleado (§48) | Se lee la sucursal por id y se compara `companyId` y `activa` dentro de la transacción; la del QR (elegida por el cliente) debe coincidir. | DB **F**; dominio 9 |
| Cliente: solo sus derechos, sesiones y vouchers | `customerId` de la sesión en `abrirSesionQrEnTx`, `misDerechos`, `sesionesQrVivasDelCliente`. | DB F2; E2E |
| Rutas | `/admin/supply-v2/*` detrás del layout (empresa + proveedor); `/superadmin/supply-v2/redenciones` con `requireRole('SUPERADMIN')`; reversa con `SUPPLY_V2_REDEMPTION_REVERSE`. | páginas |
| Permisos nuevos | `SUPPLY_V2_REDEEM`, `SUPPLY_V2_REDEMPTION_VIEW`, `SUPPLY_V2_REDEMPTION_REVERSE` con etiqueta. | `contracts/gateways.ts` |
| Tests del panel siguen en verde | `navegacion-espacios`, `navegacion-shell`, `permisos-empleado`, `ambito-empresa`, `aislamiento`, `bitacora-etiquetas`, `navegacion-cliente`: 118 pass. | `npm test` |

## 13 · AUDIT

| Acción | Cuándo | En la base local |
| --- | --- | --- |
| `SUPPLY_V2_VOUCHER_CREATED` / `REISSUED` / `EXPIRED` | emisión, reemisión, vencimiento por cron | 26 / — / (cron) |
| `SUPPLY_V2_QR_SESSION_CREATED` / `CONSUMED` | «Usar beneficio»; entrega | 114 / 60 |
| `SUPPLY_V2_REDEMPTION_CONFIRMED` / `REVERSED` / `REJECTED` / `INCIDENT` | entrega, reversa, rechazo (preview o confirmación), incidencia | 60 / 35 / 111 / (UI) |
| `SUPPLY_V2_ENTITLEMENT_EXPIRED` | cron | 11 |

Decisión (§55): los previews **válidos** no se auditan (ruido); los **rechazados** sí, con el
motivo y los 6 primeros caracteres del código, porque son la señal de abuso. `QR_SESSION_EXPIRED`
y `REDEMPTION_PREVIEWED` existen en el enum pero no se escriben en este slice. Etiquetas en
la bitácora (`tests/bitacora-etiquetas.test.ts` en verde).

## 14 · E2E

Playwright 1.62, Chromium del contenedor, `next start -p 3210`, sesiones firmadas
localmente (`supply-v2-sesion.ts`: compras, finanzas, cliente/cliente2, empleado/empleado2
con `companyId`). El arnés siembra: usuarios, cuenta de cobro, la empresa proveedora con
sucursal y capacidad `MEMBEGO_SUPPLIER`, y adelanta el reloj de UNA sesión QR.

| Recorrido | Resultado |
| --- | --- |
| **Escritorio** (`tests/e2e/supply-v2-slice3.spec.ts`): empresa registrada vinculada como proveedor → producto → acuerdo → PO 1 000 → aprobación → recepción → oferta 100 @ 399 → cliente compra y avisa → Finanzas confirma → «Usar beneficio» → QR con cuenta atrás → empleado: portal (0 entregas) → escáner → código a mano → BENEFICIO VÁLIDO (Ana, producto, RD$0.00, Bávaro; HTML sin costos) → Confirmar → ENTREGA CONFIRMADA → cliente «Utilizado · Bávaro» → Redenciones: fila Entregada, ficha con costo 300, timeline → pool 900/99/0/1 → **doble escaneo** «ya fue utilizado» → portal 1 entrega → **reversa** con motivo → pool 1/0 → cliente Disponible → nuevo QR → el viejo «ya se usó» → **QR expirado** (arnés) «expiró» → otro QR → entrega otra vez → pool 0/1 → 2 redenciones, 1 Reversada | ✅ 1 passed |
| **Móvil** (Pixel 7): mismo recorrido hasta el doble escaneo, con `cliente2`/`empleado2` en paralelo con escritorio | ✅ 1 passed |
| Regresión E2E Slice 1 + Slice 2 contra este build | ✅ 5 passed (4 S1 + 1 S2), 5 skipped por proyecto |

## 15 · REGRESSION SLICES 1-2

| Comprobación | Evidencia | Estado |
| --- | --- | --- |
| Suites de dominio S1/S2 | dentro de `npm test`: 0 fallos. | ✅ |
| Suites PostgreSQL S1/S2 | `npm run test:db`: 79 pass · 0 fail (V1 23 · S1 21 · S2 21 · S3 14). | ✅ |
| E2E S1/S2 | 5 passed contra el build del Slice 3. | ✅ |
| `ISSUED` conserva su significado | El ledger de S2 no cambia; S3 solo añade `REDEMPTION`/`REVERSAL`, ya declarados en S1. | ✅ |
| FEFO, checkout y pago intactos | 0 archivos cambiados en `allocations/`, `offers/`, `commerce/checkout.ts`. | ✅ |

## 16 · SUPPLY V1 INTACTO

| Comprobación | Evidencia | Estado |
| --- | --- | --- |
| `git diff HEAD -- src/modules/supply "superadmin/supply" "admin/supply" components/supply supply.prisma migración 20260926` | **vacío** | ✅ |
| Tablas V1 | 30 `supply_*` en la base nueva; la migración no las toca. | ✅ |
| Archivos compartidos tocados | `identidad.prisma` (+25: relaciones inversas en `User`/`Sucursal`, 12 valores de `AuditAccion`), `permissions.ts` (+3: prefijo `/admin/supply-v2` → sección `supply`), `nav-config.ts` (+13: un ítem «Entregas Membego» y su hub), `auditoria/queries.ts` (+12 etiquetas), `SUMAS.txt` (+1). | ✅ |

## 17 · DEFINITION OF DONE

| # | Criterio | Estado | Evidencia |
| --- | --- | --- | --- |
| 1 | Voucher se crea correctamente | ✅ | DB A |
| 2 | Voucher no es QR estático | ✅ | §5, §6 |
| 3 | QR temporal funciona | ✅ | E2E, DB A |
| 4 | Nonce seguro | ✅ | dominio 3 |
| 5 | TTL configurable | ✅ | dominio 18 |
| 6 | Cliente solo genera QR de sus derechos | ✅ | DB F2 |
| 7 | QR expirado falla | ✅ | DB D; E2E |
| 8 | QR consumido falla | ✅ | DB B, G; E2E |
| 9 | Scanner proveedor funciona | ✅ | E2E escritorio y móvil |
| 10 | Fallback manual funciona | ✅ | E2E (camino manual) |
| 11–14 | Backend valida proveedor, sucursal, entitlement, voucher | ✅ | DB E, F, D, I; dominio 6–9 |
| 15 | Preview no modifica estado | ✅ | DB A, C2 |
| 16 | Confirmación atómica | ✅ | `confirmarEntregaEnTx` en una `tx`; DB C |
| 17 | Ledger ISSUED → REDEEMED | ✅ | DB A; SQL |
| 18–21 | Redemption creada; entitlement, voucher y sesión en su estado | ✅ | DB A |
| 22 | Doble redención imposible | ✅ | DB B, C, H |
| 23 | Concurrencia scanner protegida | ✅ | DB C, C2 |
| 24 | Idempotencia confirmación | ✅ | DB A2 |
| 25 | Historial proveedor | ✅ | E2E `entregas-hoy`, lista con cliente/empleado/sucursal |
| 26 | Admin ve redenciones | ✅ | E2E lista + ficha |
| 27 | Cliente ve beneficio utilizado | ✅ | E2E `beneficio-utilizado` |
| 28–29 | Reversa funciona y requiere motivo | ✅ | DB G; E2E |
| 30 | Ledger REDEEMED → ISSUED | ✅ | DB G; SQL lote 112 |
| 31 | Entitlement vuelve ACTIVE | ✅ | DB G; E2E |
| 32 | QR antiguo no revive | ✅ | DB G; E2E |
| 33 | Nuevo QR permite redimir otra vez | ✅ | DB G; E2E |
| 34 | Auditoría | ✅ | §13 |
| 35 | Backend auth | ✅ | §12 |
| 36 | Ownership | ✅ | DB F2, A2 |
| 37 | Datos sensibles no se filtran | ✅ | DB A, E; E2E (HTML) |
| 38 | Unit tests | ✅ | `tests/supply-v2-slice3-dominio.test.ts`: 18/18 (los 18 de §71) |
| 39 | PostgreSQL tests | ✅ | `tests/postgres/supply-v2-slice3.db.test.ts`: 14/14 (A, A2, B, C, C2, D, D2, E, F, F2, G, H, I, J) |
| 40–42 | E2E cliente/proveedor, doble escaneo, reversa | ✅ | §14 |
| 43 | Mobile verificado | ✅ | proyecto `movil` (Pixel 7): 1 passed |
| 44–45 | Slice 1 y 2 verdes | ✅ | §15 |
| 46 | V1 intacto | ✅ | §16 |
| 47–49 | typecheck, lint, build | ✅ | `tsc --noEmit` 0 · `eslint src tests` 0 · `next build` exit 0 (lista `/admin/supply-v2`, `/admin/supply-v2/escaner`, `/superadmin/supply-v2/redenciones{,/[id]}`) |

## 18 · RIESGOS REALES

| Riesgo | Detalle | Decisión |
| --- | --- | --- |
| Quién puede escanear | Se reutiliza la sección `supply` + capacidad `MEMBEGO_SUPPLIER` de V1. Un `EMPLEADO` (rol) solo entra si su empresa le concede la sección en `users.permisos`; un `ADMINISTRADOR` entra directo. No hay relación empleado ↔ sucursal en Core: la sucursal la elige el empleado y se verifica que sea de su empresa. | Documentado; una asignación empleado→sucursal es de Core, no de este slice. |
| Derecho vencido: la unidad sigue ISSUED | El cron marca `EXPIRED` el derecho y su voucher, pero no mueve el ledger (ISSUED → CLOSED). Es contabilidad de Slice 4. | Documentado; el pool seguirá contando esa unidad como emitida. |
| Rate limit en memoria sin Redis | Sin `UPSTASH_REDIS_REST_URL`, el limitador es por proceso (LRU). En Vercel cada instancia cuenta aparte. | Igual que el resto de la plataforma; el nonce de 192 bits y el TTL de 5 min son la barrera real. |
| `router.refresh()` cada 5 s mientras el QR está en pantalla | Coste bajo (5 min máximo), pero es polling. | Aceptado para que «Utilizado» aparezca solo; un canal push es trabajo posterior. |
| Reversa sin efecto financiero | No hay obligaciones ni liquidación todavía; la redención reversada queda marcada para que Slice 4 la excluya. | ⛔ por diseño (§62). |
| Un cliente puede tener dos sesiones QR vivas | Al abrir una nueva, las vivas anteriores se marcan consumidas por el sistema; en el escáner un nonce «reemplazado» responde «ya se usó, pide uno nuevo». | Documentado. |

## 19 · PENDIENTE SLICE 4

No implementado a propósito (§62, §83): `SupplierObligation`, cuentas por pagar,
liquidación, pago al proveedor, conciliación, venta a comisión, split payments,
membresías/referidos/rewards/campañas. Queda como insumo para el Slice 4:

- `supply_v2_redemptions` con `supplierId`, `lotId`, `unitCostSnapshot`, `customerUnitPriceSnapshot`, `customerPaysMerchant`, `redeemedAt` y `reversedAt`: cada redención viva es una obligación de Membego con el proveedor pendiente de liquidar.
- Cierre contable de derechos vencidos (`ISSUED → CLOSED`).
- Asignación empleado ↔ sucursal en Core si el negocio la necesita.
- Escritura de `SUPPLY_V2_QR_SESSION_EXPIRED` / `REDEMPTION_PREVIEWED` si se quiere auditar el ruido.
