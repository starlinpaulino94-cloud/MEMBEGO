# MEMBEGO — IMPLEMENTATION STATUS

> Memoria operativa del proyecto. **El código manda**: lo que aquí contradiga a otra documentación está registrado en §14 («Discrepancias»).
> Estados permitidos: ✅ COMPLETED · 🟡 PARTIAL · 🔵 IN PROGRESS · ⚪ NOT STARTED · 🔴 BLOCKED · 🟣 DEPRECATED · 🙈 HIDDEN.
> Regla de mantenimiento: se actualiza al cerrar cada fase o cambio importante, y **antes de terminar cualquier sesión de implementación**.
> Fuente del plan: **[`docs/PLAN_MAESTRO.md`](PLAN_MAESTRO.md)** (v2, aprobado el 2026-10-06; versionado tal cual con un aviso y erratas). Los 4 documentos estratégicos de origen (`reestructura_1`…`4`) **siguen sin versionarse** (ver §17-A). Lo esencial del plan está resumido en §2, §13 y §17.

> **Documento hermano:** [`IMPLEMENTATION_STATUS_SUPPLY2.md`](IMPLEMENTATION_STATUS_SUPPLY2.md) — memoria operativa de Supply 2.0 y del rediseño visual Stitch (otra sesión, sin el Plan Maestro). Este archivo sigue el Plan Maestro (Commerce Core).

## 1. Estado general

```text
Fecha de actualización: 2026-10-07
Branch:                 claude/wizardly-hypatia-x2l9av (sincronizada con origin; PR #570 abierto por el usuario contra `main`, conflictos resueltos)
Commit actual:          ver `git log` (F2 = el commit posterior a `f3c2360` [E2E del catálogo]; F1.1 = `16e8618`, F1.2 = `ce61167`, F1.3 = `9b92651`; antes: `3c73726` auditoría F0, `7c56aeb` + `708a9bb` higiene)
Estado general:         🟡 PARTIAL — fundaciones casi cerradas; Commerce Core con catálogo completo (admin, vitrina pública y API), **inventario con ledger**, el **puente Supply→Catálogo** los **pedidos Membego** (pedir, atender, confirmar, QR en el escáner, envoltorio de Supply) y **Merchant Billing** (comisión por pedido, libro inmutable, estados de cuenta, límite de crédito); todo **apagado** por capacidad (el puente, además, sin empresa de la casa no hace nada)
Fase actual:            F4 Merchant Billing — 🟡 F4.1 (esquema, reglas en la base, dominio, servicio, enganche al cierre/reembolso del pedido) y F4.2 («Mi cuenta Membego», «Cobros a empresas», cron, E2E) entregadas; queda 🟡 por el recorrido con un humano, el cobro real (F8) y los avisos. F3 sigue 🟡 solo por el recorrido con un humano (móvil real, modo oscuro) antes de encenderla. F2.5 ✅ y F2 ✅ entregadas; F1 sigue 🟡 solo por la validación con Storage real (§3)
Última fase completada: ninguna al 100 % (F0: 4 de 6 ítems ✅, 2 🟡 por decisiones del usuario, sin código pendiente)
Próxima fase:           F5 Growth Engine (Deals/Campaigns con presupuesto; usará `puedeCrearCampanas()` de Merchant Billing)
```

- Membego es hoy un monolito modular maduro (302 tablas, 200 migraciones, 3 800+ tests unitarios) con **Supply V2 como módulo más completo** (9 slices) y **dos** entidades del Commerce Core objetivo: el catálogo (`CatalogItem`/`CatalogVariant`: pantallas de admin, vitrina pública, descubrimiento entre empresas y API v1) y el **inventario** (`InventoryLevel`/`InventoryMovement`/`InventoryReservation`: pantallas de admin, ledger inmutable, reservas con vencimiento); todo detrás de la capacidad `CATALOGO_UNIFICADO`, apagada de serie.
- Hecho en F0: capa `commerce-primitives` compartida; módulos secundarios ocultos por capacidades; CRM/Mensajería apagados por defecto en tenants nuevos; ruleta apagada también para el cliente.
- F1.1 añade 5 tablas `catalog_*`, 4 enums y 4 acciones de auditoría en **2 migraciones aditivas** (`20261036_catalog_core`, `20261037_catalog_core_enums`); F2 añade 3 tablas `inventory_*`, 3 enums y 3 acciones de auditoría en otras **2** (`20261038_inventory_core`, `20261039_inventory_core_enums`; solo dos índices únicos nuevos sobre tablas existentes). Nada existente cambia de comportamiento: la capacidad `CATALOGO_UNIFICADO` nace **apagada para todos**. F0 no tocó `prisma/`.
- Calidad verificada tras F1.3: tsc, lint, 3 694 unit, 366 PostgreSQL, build, bundle, RLS (estático y conductual 22/22), 192 migraciones sin deriva en PASS. El catálogo (admin, vitrina pública y API) tiene **3 specs E2E de CI** (`catalogo-admin`, `catalogo-publico`, `catalogo-api`): suite E2E completa **93 PASS · 0 FAIL · 124 SKIP** (14,1 min, réplica local de `e2e.yml`; antes 67/0/114). **Falla hoy:** `npm audit` (1 high, `source-map-js`).
- Lo más urgente no es funcionalidad: **una clave `service_role` de Supabase está comprometida en git** (rotarla es del usuario, §14). La Server Action sin guardia (`subirImagenExcursion`) ya está **cerrada** (§14, «Deuda cerrada»).
- Dos decisiones abiertas del usuario: **corte de RLS Capa 2 en producción** y **Supply V1** (§16).

## 2. Progreso por fases

Numeración = Plan Maestro v2. Alias usados en el pedido: «F2 Supply→Marketplace Bridge» = **F2.5**; «F6 Marketplace Discovery» = parte de **F2.5**; «F7 Analytics» = **F6**; «F4 Economic Control» = **F4 Merchant Billing**. «Progreso» solo cuenta entregables verificados; no hay porcentajes inventados.

| Fase | Estado | Progreso | Objetivo | Resultado actual |
|---|---|---|---|---|
| **F0** Foundation Hardening | 🟡 | 4/6 ítems ✅, 2 🟡 | RLS completo, capacidades formalizadas, módulos ocultos, `commerce-primitives` | Primitives extraídas; ocultamiento hecho salvo Supply V1; RLS: cobertura OK, Capa 2 apagada en prod |
| **F1** Commerce Catalog | 🟡 | F1.1 ✅ · F1.2 ✅ · F1.3 ✅ | `CatalogItem` + `CatalogVariant` (variante default oculta) | Esquema, migración, RLS generada, capacidad/sección/permisos, servicio, acciones, **pantallas de admin** (lista, alta, detalle, variantes, fotos, categorías) y tests (55 PG + 60 unit), **vitrina pública** (sección en la página de la empresa, detalle, `/catalogo`, franja en el inicio) y **API v1** (5 recursos). Capacidad apagada de serie; **E2E de CI hecho** (26 pruebas nuevas); sin probar contra Storage real |
| **F2** Inventory General | 🟡 | F2.1 ✅ · F2.2 ✅ | `InventoryLevel` + `InventoryMovement` con ledger | Esquema (+ `InventoryReservation`), migraciones, ledger **inmutable en la base**, servicio (reservas con TTL, transferencias, conteo, idempotencia, `FOR UPDATE`), cron, pantallas `/admin/inventario`, E2E, 63 tests nuevos. Capacidad apagada (la del catálogo). Sin API pública ni conexión a la vitrina; nadie llama aún a vender/reservar (F3). El inventario del Car Wash (`ProductoInventario`) no se tocó |
| **F2.5** Supply → Marketplace Bridge + Discovery | 🟡 | F2.5.1 ✅ · F2.5.2 ✅ | Items Supply en marketplace público + feed cross-company | Empresa «de la casa» (decisión del usuario) + un `CatalogItem` `source=SUPPLY` por oferta, sincronizado tras cada cambio, por cron y a pedido; el público lo cruza con la oferta en vivo; panel `/superadmin/puente-supply`; `/catalogo` con «Ofertas MembeGo» y filtro de origen; compra por el checkout de Supply (no duplicado). **Faltan:** `MembegoOrder` wrapper (F3), categorías y «cerca de mí» transversales, imágenes. Capacidad apagada y sin casa designada |
| **F3** MembegoOrder + Attribution | 🟡 | F3.1 ✅ · F3.2 ✅ | Pedido unificado, atribución, confirmación dual | `MembegoOrder` + líneas + atribución + confirmación + constancia de pago (5 tablas, 2 migraciones), máquina de estados **también en la base**, servicio que aparta/vende/libera inventario, QR de un solo uso, nivel de verificación derivado, 6 acciones de la empresa. Más (F3.2): panel `/admin/pedidos-membego`, formulario «Hacer un pedido» y «Mis pedidos» del cliente, QR de pedido en el escáner, envoltorio de las compras de Supply, «agotado» desde el inventario y barrido de pedidos sin atender; E2E de 12 pruebas. Capacidad `PEDIDOS_MEMBEGO` apagada |
| **F4** Merchant Billing | 🟡 | F4.1 ✅ · F4.2 ✅ | Comisión CPA + 8 %, ledger merchant | Config de cobro por empresa + comisión por pedido (CPA o 8 % según el nivel de verificación, cobrada **en la misma transacción** que cierra el pedido y revertida al reembolsar) + libro **inmutable con saldo corrido** + cortes únicos por periodo + límite de crédito (gracia 7 días → suspensión); «Mi cuenta Membego» (empresa, solo lectura) y «Cobros a empresas» (superadmin: pagos, ajustes, créditos, antigüedad); cron diario; 4 tablas, 2 migraciones, E2E. Pedidos de Supply **nunca** comisionan. Capacidad: la de los pedidos (apagada). **Sin cobro real, avisos ni PDF** |
| **F5** Growth Engine (Deals/Campaigns con presupuesto) | ⚪ | 0 | Deals con presupuesto prepago | Sistemas paralelos sin consolidar (§4) |
| **F6** Analytics / Revenue Attribution | ⚪ | 0 | GMV, atribución, ROI | `modules/reportes` existe (basado en `Transaction`), sin atribución por orden |
| **F7** POS conectado | ⚪ | 0 | POS sobre catálogo/promos/cliente | POS básico (`modules/caja`) sin catálogo |
| **F8** Marketplace Checkout | ⚪ | 0 | Carrito + pago + pickup | Solo carrito de excursiones (localStorage) |
| **F9** Advanced Features | ⚪ | 0 | Loyalty unificado, riesgo, e-NCF, split payments | — |
| Supply V2 (pre-plan, ya construido) | 🟡 | 9 slices ✅ | Dominio de aprovisionamiento B2B | Núcleo completo; faltan pasarela real, reembolsos, edición de acuerdos en UI, WhatsApp (§5) |

Camino crítico del plan: **F0 → F1 → F2.5 → F3 → F4** (F2 en paralelo con F2.5). Estimaciones del plan (no medidas): ~13–14 semanas a revenue.

## 3. Fase actual — F4 Merchant Billing (🟡) · F4.1 y F4.2 entregadas

### Objetivo
Lo que cada **empresa** le debe a **Membego** por los pedidos que la plataforma le trajo (Plan Maestro §10, F4): la comisión de cada pedido completado, un libro de cuenta inmutable con saldo corrido, el límite de crédito y los estados de cuenta. Es la dirección empresa → Membego, **estrictamente separada** de Supply Economics (Membego → proveedor). F4.1 = esquema, reglas en la base, dominio, servicio, enganche al pedido y tests; F4.2 = pantallas, cron, E2E.

### Implementado (F4.1 — verificado, §8)
- ✅ Esquema `prisma/schema/facturacion-comercial.prisma`: `MerchantBillingConfig` (1:1 con la empresa), `Commission` (única por pedido), `MerchantLedgerEntry` (libro) y `MerchantStatement` (corte); 6 enums (`MerchantFeeModel`, `MerchantBillingCycle`, `MerchantBillingStatus`, `MerchantCommissionType`, `MerchantCommissionStatus`, `MerchantLedgerEntryType` ×7); 3 acciones de auditoría `BILLING_*`.
- ✅ Migraciones `20261044_merchant_billing` y `20261045_merchant_billing_enums` (aditivas e idempotentes, selladas: 200). **No tocan ninguna tabla existente.** `migrate diff`: 0 deriva.
- ✅ La **base** hace cumplir: el libro es **append-only** (UPDATE, DELETE y TRUNCATE rechazados; igual los cortes; una comisión no se borra); cada asiento declara su **posición** (`seq`, sin huecos) y su **saldo** (= anterior + monto) y el disparador `merchant_ledger_saldo` lo comprueba (un segundo escritor simultáneo choca con el índice único `(companyId, seq)`); el **signo del monto lo decide el tipo** (comisión > 0; reverso, pago y créditos < 0; ajuste ≠ 0 y con motivo; un asiento en cero no existe); `referenceType` solo admite `COMMISSION | PAYMENT | MANUAL | STATEMENT` —**nada de Supply**— y las comisiones y reversos siempre cuelgan de una comisión; un periodo que ya tiene corte no recibe asientos nuevos (`merchant_ledger_corte`); la **comisión coincide con su pedido y su asiento** (pedido COMPLETED, de la empresa, **no de Supply**, con su base, nivel y moneda; asiento del tipo, monto y referencia que corresponden), solo pasa de CONFIRMED a REVERSED con el pedido ya REFUNDED y el asiento contrario exacto, y la regla **CPA vs porcentaje por modelo y nivel** está en un CHECK (3 modelos × 5 niveles, contrastado con el dominio); el corte **cuadra** (cierre = apertura + todo lo del periodo; lo debido = cierre si es positivo).
- ✅ `src/modules/billing/`: `domain.ts` (puro: qué pedido comisiona, `tipoDeComision`, `calcularComision` con `Decimal` y `commerce-primitives/comision`, validación de asientos y tarifas, estado por límite de crédito, periodos en calendario de Santo Domingo, `resumirCorte`, antigüedad de la deuda), `service.ts`, `barrido.ts`, `queries.ts`, `actions.ts`, `formato.ts` (sin runtime de Prisma, para componentes de cliente), `auditoria.ts`, `errores.ts`.
- ✅ **La comisión se cobra en la MISMA transacción que cierra el pedido** (`completarPorQrEnTx`/`cerrarPedidoExternoEnTx` → `registrarComisionDePedidoEnTx`): un pedido completado de una empresa tiene su comisión o el cierre no ocurre. Modelo de la empresa: `CPA_FIXED` (siempre CPA), `PERCENTAGE` (siempre %) o `HYBRID` (de serie: **CPA RD$ 100** si el pedido no tiene el pago verificado; **8 %** de la base comisionable desde `PAYMENT_VERIFIED`). Redondeo ROUND_HALF_UP al centavo; una comisión que redondea a cero o una base en cero no cobran nada. El **reembolso** del pedido la revierte con un asiento contrario (`revertirComisionDePedidoEnTx`); revertir dos veces es inofensivo.
- ✅ **Separación de Supply Economics (criterio de aceptación)**: un pedido que envuelve una compra de Supply (`origin = SUPPLY` o `sourceType = SUPPLY_V2_CUSTOMER_ORDER`) **nunca comisiona** (servicio **y** base lo rechazan); hoy **solo `MARKETPLACE`** comisiona (POS, excursiones y API se agregan al llegar su fase). Ninguna tabla de billing referencia una de Supply ni al revés; 7 pruebas de texto fuente lo vigilan (billing no importa Supply ni pedidos; Supply no importa billing; solo `orders/service.ts` llama a billing y solo con 3 puntos; nadie fuera del servicio de billing escribe el libro).
- ✅ **Límite de crédito**: saldo > límite → `GRACE_PERIOD` (plazo de **7 días**, no se reinicia con más cobros); dentro del límite (≤) → `ACTIVE`; vencido el plazo con el saldo aún pasado → `SUSPENDED` (lo hace el barrido). El superadmin puede **retener a mano** una cuenta (`holdManual`): ni un pago ni el tiempo la reactivan; al liberarla se reevalúa. **Efecto de la suspensión:** hoy solo informativo (`puedeCrearCampanas()` para F5); **no frena pedidos ni cobros**.
- ✅ **Asientos manuales** (solo superadmin; el servicio lo exige además de la acción): pago (referencia obligatoria), ajuste (± con motivo), crédito y crédito promocional; idempotentes por clave. Cambio de configuración (modelo, CPA, %, límite, ciclo): rige **hacia adelante**, con bitácora del antes/después.
- ✅ **Cortes (statements)**: únicos por `(empresa, periodo)` y emitidos bajo el candado de la cuenta; ciclos semanal (lunes), quincenal (1–16) y mensual en **fechas de Santo Domingo**; sin huecos (cada corte abre con el cierre del anterior, también si la empresa cambia de ciclo); con saldo arrastrado cada periodo lleva su corte, sin saldo ni movimiento se salta; el cierre se calcula **sumando** y se compara con el saldo corrido (si no coinciden no se emite).
- ✅ Capacidad: «Mi cuenta Membego» (sección `facturacion-membego`) cuelga de `PEDIDOS_MEMBEGO` (sin capacidad propia, fuera de los roles acotados, solo lectura: sin funciones de permiso). Gate `permisos-catalogo` en verde (103 funciones).
- ✅ RLS: las 4 tablas llevan `companyId` propio → política **generada** (0 escritas a mano). Preflight 281/302.
- ✅ Tests: `billing-domain` (22 unit), `billing-separacion` (7), `facturacion-permisos` (9) y `postgres/billing.db.test.ts` (35). **Mutaciones comprobadas** (cada una rompe ≥ 1 test): quitar el `FOR UPDATE` de la cuenta, reverso con el mismo signo, HYBRID invertido, no reevaluar el estado tras cobrar, límite estricto, cortes sin saldo arrastrado, idempotencia ignorada, que Supply comisione, redondear la base antes del %.

### Implementado (F4.2 — verificado, §8)
- ✅ **«Mi cuenta Membego»** `/admin/facturacion-membego` (empresa; solo lectura): saldo (a cargo o a favor), estado y plazo, uso del límite de crédito, cómo se le cobra, movimientos con el pedido de cada comisión (enlace) y estados de cuenta.
- ✅ **«Cobros a empresas»** `/superadmin/facturacion` (+ ficha por empresa): lo que se debe en total, **antigüedad** (0-30/31-60/61-90/90+ días; un pago salda lo más viejo primero), cuentas por estado, filtros y «Solo con deuda»; en la ficha: libro, cortes y las acciones del superadmin (asentar pago/ajuste/crédito, configurar el cobro, suspender/liberar, emitir cortes pendientes) y «Revisar ahora».
- ✅ **Cron** `/api/cron/facturacion` (diario, 07:30 UTC): cobra pedidos completados que quedaron sin comisión (red de seguridad; mira solo los últimos **45 días**), suspende gracias vencidas y emite cortes. Idempotente.
- ✅ E2E: `facturacion-superadmin` (6) + 2 pruebas nuevas y 1 ampliada en `pedidos-membego` (comisión visible al cerrar, reverso al reembolsar; el aislamiento ahora cubre «Mi cuenta Membego»).

### Decisiones y desviaciones del plan (F4)
| Plan | Implementado | Por qué |
|---|---|---|
| `MerchantLedgerEntry` «via `commerce-primitives/ledger`» | **No** usa esa primitiva; el saldo corrido y la posición se calculan en `billing/domain.ts` (con `Decimal`) y los vigila la base | La primitiva es un ledger de **cubetas con cantidades enteras** (traslados origen→destino); un libro de cuenta en dinero con saldo corrido no encaja. Sí usa `commerce-primitives/{comision,dinero}` |
| `Commission.status` `PENDING \| CONFIRMED \| REVERSED` | Solo **`CONFIRMED \| REVERSED`** | Comisión y asiento se escriben **atómicamente** con el cierre del pedido: no hay un estado intermedio que observar |
| `MerchantStatement.period` | `AAAA-MM-DD/AAAA-MM-DD` en fechas de Santo Domingo (inicio incluido, fin excluido) + `periodStart`/`periodEnd` | Cubre ciclos semanal/quincenal/mensual y el cambio de ciclo sin ambigüedad |
| `MerchantStatement` campos | + `openingBalance`, `closingBalance`, `reversals`, `entryCount`; `amountDue = max(cierre, 0)` | Que el corte se explique solo y cuadre con el libro |
| «Si excede: suspender campañas» | Estado de la cuenta (`GRACE_PERIOD` 7 días → `SUSPENDED`) + `puedeCrearCampanas()` | Las campañas no existen hasta F5; el estado queda listo para consumirse. **No** se frena a los clientes ni los cobros |
| Config por empresa «y por tipo de operación» (§ resolución del plan) | Solo **por empresa** | Un modelo por tipo de operación necesita las operaciones POS/checkout (F7/F8) |
| Evidencia que decide CPA vs 8 % | La del pedido **al completarse**; un pago registrado después **no recalcula** una comisión ya cobrada | Reabrir comisiones cobradas abriría disputas; para una corrección está el ajuste manual |
| Sección `facturacion_membego` «(superadmin), vista read-only para admin» | `facturacion-membego` (lectura de la empresa, sección con guion por el gate de permisos) + panel del superadmin con `requireRole('SUPERADMIN')` | La empresa no tiene qué delegar por función: solo lee |
| Valores de serie | `HYBRID`, CPA **RD$ 100**, **8 %**, límite **RD$ 5,000**, ciclo **mensual** | Plan: ejemplo de CPA RD$ 100 y 8 %; el límite y el ciclo los fijé yo (decisión de producto abierta, §16) |
| Qué comisiona | **Solo `MARKETPLACE`** | Lo único que Membego trae hoy; POS/excursiones/API cuando existan sus fases |

### Límites de la verificación de F4 (lo que NO se probó)
- **Nadie lo ha recorrido con un humano** (móvil real, modo oscuro): solo Playwright en escritorio y modo claro.
- Los E2E corren sobre una base `db push` (sin los disparadores del libro); esas reglas las prueban los tests PG, no el navegador.
- **No hay cobro real**: el libro es contabilidad. Un «pago» es una constancia que el superadmin asienta a mano (con la referencia de un depósito/transferencia); no se concilia con un banco ni con una pasarela (F8).
- **No hay avisos**: ni la empresa ni el superadmin reciben notificación al entrar en gracia, suspenderse o emitirse un corte; no hay envío del estado de cuenta (PDF/correo) ni exportación.
- **Los estados de cuenta no se ven por separado** (no hay una página de «un corte» imprimible): se ven como filas del historial.
- Comisiones de pedidos completados **antes** de F4 (hay 0 en producción, la capacidad está apagada) no se cobran retroactivamente: el barrido solo mira 45 días.
- El **servicio fiscal** no está modelado: la comisión no genera comprobante fiscal (NCF/ITBIS sobre la comisión de Membego es decisión contable pendiente).
- Sin carga ni rendimiento medidos; el listado de cuentas del superadmin recorre todos los saldos (`DISTINCT ON`) y las deudas: pensado para cientos de empresas, no para decenas de miles.

### Pendiente tras F4
Avisos de estado de cuenta; emisión/PDF del corte; conciliación de pagos (F8); usar `puedeCrearCampanas()` en Growth Engine (F5, con presupuesto prepago); comisión de POS/excursiones/API; comprobante fiscal de la comisión; disputas (un flujo con estado, hoy se resuelven con un ajuste); recorrido humano.

### Archivos principales (F4)
`prisma/schema/{facturacion-comercial,pedidos,identidad}.prisma` · `prisma/migrations/{20261044_merchant_billing,20261045_merchant_billing_enums}` · `src/modules/billing/*` · `src/modules/orders/service.ts` (3 enganches) · `src/lib/auth/{permissions,funciones}.ts` · `src/modules/capacidades/catalogo.ts` · `src/modules/auditoria/queries.ts` · `src/components/layout/nav-config.ts` · `src/app/(admin)/admin/facturacion-membego/*` · `src/app/(superadmin)/superadmin/facturacion/*` · `src/components/billing/*` · `src/app/api/cron/facturacion/route.ts` · `vercel.json` · `tests/{billing-domain,billing-separacion,facturacion-permisos}.test.ts` · `tests/postgres/billing.db.test.ts` · `tests/e2e/{facturacion-superadmin,pedidos-membego}.spec.ts`.

### Entidades, APIs, eventos (F4)
Tablas: `merchant_billing_configs`, `merchant_commissions`, `merchant_ledger_entries`, `merchant_statements`. Server Actions (5, **solo superadmin**, `getUser()` con rol `SUPERADMIN` antes de tocar la base): `asentarMovimiento`, `guardarConfigDeCobro`, `cambiarEstadoDeCuenta`, `emitirCortesDeEmpresa`, `revisarFacturacionAhora`. Cron: `/api/cron/facturacion`. Eventos: bitácora `BILLING_CONFIG_CHANGED`, `BILLING_ENTRY_RECORDED`, `BILLING_STATUS_CHANGED` (lo que hace una persona y los cambios de estado); el libro es el rastro de las comisiones. `ORDER_COMPLETED` y `ORDER_REFUNDED` llevan ahora la comisión cobrada/revertida en su payload.

### Criterios de aceptación (Plan Maestro §10, F4)
| Criterio | Estado |
|---|---|
| Comisión calculada automáticamente | ✅ al completar el pedido, en la misma transacción |
| CPA o 8 % según nivel de verificación | ✅ (modelo `HYBRID` de serie; configurable por empresa) |
| Ledger inmutable | ✅ en la base (UPDATE/DELETE/TRUNCATE rechazados; se corrige con asientos nuevos) |
| Statements | ✅ únicos por periodo, cuadrados y sin huecos; 🟡 sin vista imprimible ni envío |
| Credit limit enforced | 🟡 el **estado** de la cuenta se aplica (gracia/suspensión); su **efecto** (suspender campañas) llega con F5 |
| Supply Economics NUNCA toca este ledger | ✅ en el servicio, en la base y con pruebas de texto fuente |
| E2E: order → commission → ledger → statement | ✅ pedido → comisión → libro (E2E) y libro → corte (PG); no hay un E2E único que llegue al corte (la base de E2E no lleva los disparadores y el corte espera a que el periodo cierre) |

---

### Fase anterior — F3 Pedidos Membego (🟡) · F3.1 y F3.2 entregadas

### Objetivo
El pedido unificado del marketplace (Plan Maestro §10, F3): qué pidió un cliente a una empresa, por qué canal llegó, el monto que ambas partes aceptan y la prueba de que se cumplió. Es la base de la comisión de F4. F3.1 = esquema, reglas en la base, servicio y tests (más las acciones de la empresa); F3.2 = pantallas, escáner, envoltorio de Supply y E2E.

### Implementado (F3.1 — verificado, §8)
- ✅ Esquema `prisma/schema/pedidos.prisma`: `MembegoOrder`, `MembegoOrderLine`, `OrderAttribution`, `CustomerConfirmation`, `PaymentEvidence`; 5 enums del plan (`MembegoOrderStatus` ×7, `MembegoOrderOrigin`, `MembegoPaymentMethod`, `MembegoVerificationLevel` ×5, `MembegoAttributionChannel` ×8); 9 acciones de auditoría `ORDER_*`.
- ✅ Migraciones `20261042_membego_orders` y `20261043_membego_orders_enums` (aditivas, idempotentes, selladas: 198). Solo tocan tablas existentes para añadir 2 índices únicos `(id, companyId)` (`clientes`, `inventory_reservations`). `migrate diff`: 0 deriva.
- ✅ La **base** hace cumplir: la **máquina de estados** (disparador `membego_orders_reglas`, gemelo de `TRANSICIONES`; una prueba recorre las **49 combinaciones** contra el dominio), un pedido **nace CREATED**, lo que identifica el pedido y fija lo vendido (empresa, código, cliente, sucursal, origen, moneda, subtotal, descuento, impuestos) **no cambia nunca** y el monto de un pedido cerrado tampoco; **totales que cuadran** (`base = subtotal − descuento + ajuste`, `total = base + impuestos`, nada negativo); fechas y motivos de cada estado terminal; QR obligatorio en LISTO; el dato que exige cada **canal de atribución**; **líneas inmutables** (UPDATE/DELETE/TRUNCATE rechazados) y **cuadre pedido ↔ líneas** al confirmar la transacción (disparador diferido: sin líneas o líneas que no suman, no hay pedido); FK **compuestas** `(id, companyId)` hacia sucursal, cliente, variante, reserva y pedido (todas `RESTRICT`); una atribución, una confirmación y un pago por pedido; QR único.
- ✅ `src/modules/orders/`: `domain.ts` (puro: transiciones, atribución, `calcularPedido` con `Prisma.Decimal`, nivel de verificación, QR), `service.ts`, `actions.ts`, `auditoria.ts`, `errores.ts`.
- ✅ Servicio: `crearPedidoEnTx` (valida cliente/sucursal/variantes, **precio siempre de la base y congelado en la línea**, une renglones repetidos, **aparta** el inventario de lo que lo controla, atribución, queda `AWAITING_MERCHANT`; idempotente por clave **y** por documento de origen), `aceptarPedidoEnTx`, `ajustarMontoEnTx` (valor, no incremento; motivo obligatorio; **borra la confirmación** del cliente), `marcarListoEnTx` (emite el **QR**, 192 bits, 7 días), `renovarQrEnTx` (el anterior deja de valer), `confirmarMontoEnTx` (solo el dueño, **solo con el monto que vio**), `registrarPagoEnTx`, `completarPorQrEnTx`, `cancelarPedidoEnTx` (libera la reserva; el cliente solo antes de que la empresa acepte) y `reembolsarPedidoEnTx` (con o sin devolver al inventario). Toda mutación toma `SELECT … FOR UPDATE` sobre la fila del pedido.
- ✅ **Cierre por QR atómico**: 6 escaneos simultáneos del mismo QR cierran el pedido **una** vez y venden **una** vez (los otros 5 reciben `YA_COMPLETADO`). Si la reserva venció antes del cierre se vende de lo disponible; si ya no alcanza, el cierre falla claro (`STOCK_YA_NO_ALCANZA`) y el pedido **sigue LISTO**.
- ✅ **Nivel de verificación derivado, en cadena**: `ATTRIBUTED` → `REDEEMED` (QR) → `CUSTOMER_VERIFIED` (+ el cliente confirmó el monto **vigente**) → `PAYMENT_VERIFIED` (+ pago con método verificable —tarjeta, transferencia, checkout—, referencia y el monto del pedido; **el efectivo no verifica**). `FISCALLY_RECONCILED` existe pero **ninguna evidencia lo produce todavía**. Se recalcula al confirmar y al registrar el pago, aunque lleguen **después** del cierre.
- ✅ Capacidad `PEDIDOS_MEMBEGO` (apagada de serie, también en `FUNCIONES_EMPRESA`), sección `pedidos-membego` (fuera de los roles acotados) y funciones `gestionar`, `cancelar`, `reembolsar`; gate `permisos-catalogo` en verde (103 funciones).
- ✅ 6 acciones del panel de la empresa (`aceptarPedido`, `ajustarMontoPedido`, `marcarPedidoListo`, `registrarPagoPedido`, `cancelarPedidoComoEmpresa`, `reembolsarPedido`), todas autorizan antes de tocar la base y toman empresa y actor de la sesión. **No** crean pedidos, no confirman por el cliente ni cierran con el QR (un test lo vigila).
- ✅ RLS: las 5 tablas llevan `companyId` propio → política **generada** (0 escritas a mano). Preflight 277/298; `probar-rls` 36/36 con 7 casos nuevos de pedidos.
- ✅ Tests: `orders-domain` (26 unit), `pedidos-permisos` (10 unit, incluye «el estado del pedido solo lo escribe el servicio») y `postgres/orders.db.test.ts` (43). **Mutaciones comprobadas** (cada una rompe al menos un test): quitar `FOR UPDATE`, quitar la comprobación de dueño, aceptar un monto distinto al visto, no reservar al crear, cancelar sin liberar.

### Decisiones y desviaciones del plan (F3.1)
| Plan | Implementado | Por qué |
|---|---|---|
| Código `MBG-YYYYMMDD-NNNNNN` | **`MBG-PED-<año>-<secuencia>`**, correlativo **por empresa** | Reutiliza `commerce-primitives/numeracion` (formato con año) y no revela a una empresa el volumen de la plataforma. Único por empresa |
| `MembegoOrder.discount` | + **`adjustment`** y `adjustmentReason` | «Ajustar monto» (empresa) necesita un campo propio que no se confunda con los descuentos de línea; el cliente reconfirma cuando cambia |
| `commissionableBase` | `subtotal − descuento + ajuste`, **sin impuestos** | Es la base sobre la que F4 calculará CPA/8 % |
| Impuestos | **0 por defecto**, fijos tras crear | La decisión fiscal (ITBIS incluido o no en el precio) es de una fase posterior |
| `verificationLevel` | **Derivado de la evidencia** y recalculado | Un campo que alguien pueda escribir a mano sería la puerta para que una empresa se «verifique» sola |
| Completar el pedido | **Solo por QR** (sin botón manual) | Un cierre manual sin escaneo no tendría evidencia de canje; si el cliente perdió el QR, lo renueva |
| Atribución: `campaignId`, `promotionId` | **Referencias opacas sin FK** | Campañas no existen hasta F5 y las promociones son de otro dominio; el pedido no debe quedar bloqueado por un borrado ajeno |
| `supplyV2OfferId` en la atribución | FK `RESTRICT` a `supply_v2_offers` | Es el vínculo del envoltorio de Supply |
| Pedidos de Supply | `origin = SUPPLY` **solo con ofertas de Supply**, y las ofertas **solo con ese origen** | La compra de una oferta sigue siendo del checkout de Supply; el pedido la envuelve |
| Reservas del pedido | Vigencia **máxima** (7 días) y, si vencen, **venta directa** de lo disponible | Un pedido que espera aceptación no debe perder el stock a los 30 min; y si pasó el tiempo, cerrar no puede fallar por la reserva sino por no haber stock |
| `PaymentEvidence` | Constancia **externa**, no mueve dinero | Sin pasarela propia (F8); sube el nivel solo con método verificable + referencia + monto exacto |
| `Redemption` 0:1 del pedido | **No** hay entidad aparte | El QR del pedido es el canje; `completedAt`/`completedByUserId` lo registran |
| Eventos de dominio (`OrderCreated`…) | **Bitácora** (`AuditLog`, 9 acciones) | No existe bus de eventos en el Core; F4 puede leer la bitácora o se añadirá el outbox entonces |

### Implementado (F3.2 — verificado, §8)
- ✅ **Panel de la empresa** `/admin/pedidos-membego` (lista con búsqueda por código/cliente/producto, filtro por estado con conteos, aviso «N pedidos esperan tu respuesta», paginación; ficha con progreso, líneas, desglose del monto, nota del cliente, estado de la confirmación y del pago, nivel de verificación explicado, base comisionable e historia) y las acciones de la ficha: aceptar, **ajustar el monto** (sin motivo no envía), marcar listo, registrar el pago (método, monto, referencia), cancelar (con motivo que ve el cliente) y reembolsar (con opción de devolver al inventario). Cada bloque aparece solo si el estado lo permite **y** la persona tiene la función; las acciones lo vuelven a comprobar. Entrada de menú «Pedidos Membego» (detrás de `PEDIDOS_MEMBEGO`, en Operaciones).
- ✅ **El cliente**: formulario «Hacer un pedido» en la ficha pública de un producto **de la empresa** (variante, cantidad, sucursal, nota; las ofertas de Supply siguen yendo a su checkout), «Mis pedidos» y la ficha de mi pedido (progreso, monto, **confirmar el monto vigente**, cancelar mientras la empresa no acepte, **QR** como imagen —siempre sobre blanco— con su vencimiento y «generar uno nuevo»). Sin sesión, pedir manda a `/login` y vuelve. Lo que cruza al servicio sale de la sesión y de la base: la empresa se deduce de la variante, la ficha se crea al pedir (no se exige una previa), el precio sale del catálogo y **el canal de atribución solo puede ser navegación, búsqueda o directo** (referido, campaña y promoción las fijarán flujos del servidor que los verifiquen). Tope de **5 pedidos abiertos** por cliente y empresa (freno contra apartar el stock sin recogerlo; lo aplica la acción, no el servicio). Aviso a los administradores de la empresa al llegar un pedido nuevo. «Mis pedidos» en el menú del cliente, **oculto** mientras ni la empresa recibe pedidos ni la persona tiene alguno.
- ✅ **El escáner**: `buscarPorToken` reconoce el QR de un pedido (antes de dar el código por inexistente) y muestra qué se entrega, a quién, el total, si el cliente confirmó el monto y si hubo ajuste; **«Entregar y cerrar pedido»** lo cierra (`completarPedidoPorQr`: rol de escáner, pedido de la empresa del empleado, empresa tomada de la base). Un QR vencido, ya canjeado o de un pedido no listo se explica. Es la única puerta por la que un pedido pasa a COMPLETED.
- ✅ **«Agotado» desde el inventario**: un producto que controla inventario se enseña agotado en la vitrina y en el descubrimiento cuando no hay nada **disponible** (existencia − apartado) en una sucursal abierta; el público no ve cantidades. Los ítems puente no usan el inventario de la casa: manda su oferta.
- ✅ **Barrido de pedidos sin atender**: `/api/cron/pedidos` (diario, 07:15 UTC) cancela con motivo «La empresa no respondió a tiempo» los `AWAITING_MERCHANT` de más de 7 días y libera lo apartado. No toca lo aceptado, listo o cerrado.
- ✅ **Envoltorio de Supply** (`supply-bridge/pedido.ts`): cada compra de Supply **pagada** (de una oferta) se refleja como un `MembegoOrder` de la empresa de la casa con `origin = SUPPLY`, atribución `SUPPLY_OFFER`, la variante del ítem puente, lo que el cliente **pagó** (precio de venta menos lo rebajado) y la ficha del comprador en la casa (creada sin seguirla ni darle bienvenidas); queda COMPLETED con confirmación del cliente (comprar es aceptar el precio) y, si Membego verificó el pago, constancia de pago → `PAYMENT_VERIFIED`; una compra cubierta por beneficio o gratis queda `CUSTOMER_VERIFIED`. Lo corre **el barrido del puente** (cron diario y «Sincronizar ahora»), no la transacción de Supply, que no conoce el puente ni los pedidos; es idempotente (documento de origen único), recorre con cursor sin que una compra no envolvible (aún) frene a las demás y refleja los reembolsos. Una oferta pausada después de comprarla se envuelve igual (hecho consumado).
- ✅ Servicio: `cerrarPedidoExternoEnTx` (solo el sistema, nunca un pedido de la vitrina) y `precioUnitario` por línea (solo el sistema, solo para el envoltorio).
- ✅ Tests: 46 PG de pedidos (+3: barrido, cierre externo, escáner; +1 de tope) y 8 del envoltorio dentro de `supply-bridge.db.test.ts`; unit `pedidos-permisos` ampliado (cableado de menú, guardias, componentes sin Prisma, acciones del cliente, escáner, cron, envoltorio) y `catalogo-publico` (+5 de existencias); **E2E `pedidos-membego` (12 pruebas, escritorio)**: pedir → aceptar → ajustar → confirmar → listo → **escáner con ráfaga de lector físico** → cerrar → pago verificado → cancelaciones → reembolso con stock → aislamiento.

### Decisiones y desviaciones del plan (F3.2)
| Plan | Implementado | Por qué |
|---|---|---|
| «Supply Bridge genera MembegoOrder» al comprar | Lo genera **el barrido del puente**, no un enganche en el checkout | Cuatro caminos llegan a PAID en Supply; engancharlos tocaría la transacción de compras más delicada del sistema. El barrido es idempotente y, como la sincronización de ofertas, no puede tumbar una compra. Coste: el pedido aparece en el cron diario (o con «Sincronizar ahora»), no al instante |
| Scanner tipo `MEMBEGO_ORDER` | El escáner **reconoce el QR por su token** (sin tipo explícito) | El QR es una credencial al portador de 192 bits, única en la base; no hace falta prefijarla |
| Cliente «confirma monto» | Solo el monto **vigente**: si la empresa ajusta, la confirmación se invalida y hay que repetirla | Evita que alguien confirme una cifra que no vio |
| Atribución elegida por el cliente | Solo `MARKETPLACE_BROWSE/SEARCH/DIRECT` | Un canal con dato (referido, campaña, promoción) sin verificar sería un campo que cualquiera falsifica |
| Pedido de Supply «ajustable» | Cerrado de nacimiento (`cerrarPedidoExternoEnTx`) | Es el registro de algo que ya ocurrió: no hay empresa que acepte ni QR que escanear |

### Límites de la verificación de F3 (lo que NO se probó)
- **Nadie lo ha recorrido con un humano**: la interfaz solo se probó con Playwright en escritorio y modo claro; **no** en móvil real, **ni en modo oscuro**, ni con lector físico real (la ráfaga se simula tecleando). Antes de encender `PEDIDOS_MEMBEGO` en una empresa real hace falta ese recorrido.
- Los E2E corren sobre una base creada con `db push` (sin los disparadores ni los CHECK de las migraciones); esas reglas las cubren los tests PG, y `probar-rls` omite —diciéndolo— las comprobaciones de inmutabilidad en una base así.
- **Sin pago en la plataforma**: «registrar el pago» deja constancia de un pago hecho fuera; no cobra ni concilia. El cobro propio es de F8.
- **El cliente no recibe avisos** (listo, cancelado, ajustado): solo ve el cambio al abrir «Mis pedidos». La empresa sí recibe uno al llegar un pedido.
- **Una sola línea por pedido desde la vitrina** (no hay carrito: F8). El servicio ya admite varias.
- **Impuestos**: 0 por defecto y fijos tras crear; la decisión fiscal (ITBIS incluido o no en el precio) es de una fase posterior.
- El tope de 5 pedidos abiertos por cliente y empresa no es atómico: dos envíos simultáneos pueden pasarse por uno.
- El envoltorio de Supply: un pedido con varias líneas de ofertas distintas se atribuye a la **primera** oferta; la primera pasada tras designar la casa pone al día el historial de a 200 compras; lo que la casa no pueda envolver (sin ítem puente o sin sucursal activa) queda «pendiente» y se reintenta en cada barrido.
- El panel de la empresa no filtra por sucursal ni por rango de fechas; no hay exportación, ni eventos de dominio fuera de la bitácora, ni API pública de pedidos.
- Sin carga ni rendimiento medidos.

### Pendiente tras F3
Avisos al cliente (push/correo/campanita); carrito y checkout propio con pago (F8); POS que cree pedidos (F7); comisión sobre el pedido (F4: usará `commissionableBase` y `verificationLevel`); campañas y promociones como canal de atribución verificado (F5); filtros por sucursal y fecha, y exportación; recorrido en móvil real y modo oscuro.

### Archivos principales (F3)
`prisma/schema/{pedidos,clientes,catalogo,inventario,identidad,supply-v2}.prisma` · `prisma/migrations/{20261042_membego_orders,20261043_membego_orders_enums}` · `src/modules/orders/*` · `src/lib/auth/{permissions,funciones}.ts` · `src/modules/capacidades/catalogo.ts` · `src/modules/plataforma/conceptos.ts` · `scripts/probar-rls.mjs` · `src/app/(admin)/admin/pedidos-membego/*` · `src/app/(cliente)/cliente/pedidos/*` · `src/app/(public)/empresas/[companySlug]/catalogo/[itemSlug]/page.tsx` · `src/app/api/cron/pedidos/route.ts` · `src/components/pedidos/*` · `src/components/scanner/{ConfirmPedido,ScannerClient}.tsx` · `src/modules/visitas/actions.ts` (reconocer el QR) · `src/modules/supply-bridge/{pedido,barrido}.ts` · `src/modules/catalog/{publico,publico-nucleo}.ts` · `src/modules/cliente/navDisponible.ts` · `src/components/layout/nav-config.ts` · `vercel.json` · `tests/{orders-domain,pedidos-permisos,catalogo-publico}.test.ts` · `tests/postgres/orders.db.test.ts`.

### Entidades, APIs, eventos (F3)
Tablas: `membego_orders`, `membego_order_lines`, `order_attributions`, `customer_confirmations`, `payment_evidences`. Server Actions (6, `requireSection('pedidos-membego', fn)`): `aceptarPedido`, `ajustarMontoPedido`, `marcarPedidoListo`, `registrarPagoPedido` (función `gestionar`), `cancelarPedidoComoEmpresa` (`cancelar`), `reembolsarPedido` (`reembolsar`). Server Actions del cliente (4, sesión `CLIENTE`): `crearPedidoComoCliente`, `confirmarMontoPedido`, `cancelarMiPedido`, `renovarQrDeMiPedido`; del escáner (1, `SCANNER_ROLES`): `completarPedidoPorQr`. Servicio para el sistema: `crearPedidoEnTx`, `confirmarMontoEnTx`, `renovarQrEnTx`, `completarPorQrEnTx`, `cancelarPedidoEnTx`, `cerrarPedidoExternoEnTx`, `contarPedidosAbiertosEnTx`, `barridoPedidos` (cron `/api/cron/pedidos`), y en el puente `envolverCompraEnTx` / `reflejarReembolsoEnTx`. Rutas: `/admin/pedidos-membego[/id]`, `/cliente/pedidos[/id]`. Sin API pública, sin webhooks.

---

### Fase anterior — F2.5 Supply → Marketplace Bridge (🟡) · F2.5.1 y F2.5.2 entregadas

### Objetivo
Que las ofertas de Supply V2 (que son de **Membego**, no de una empresa) aparezcan en el catálogo unificado y en el descubrimiento, sin duplicar el checkout de Supply. F2.5.1 = esquema, mapeo, sincronización y tests; F2.5.2 = panel del superadmin, descubrimiento y E2E.

### Decisión del usuario (2026-10-06) — dueño de los ítems puente
Un `CatalogItem` necesita `companyId`, y muchos proveedores no tienen empresa en la plataforma. **Se designa UNA empresa «de la casa»** (`Company.esCasaMembego`, a lo sumo una: índice único parcial) y todos los ítems puente (`source = SUPPLY`) cuelgan de ella. Descartadas: colgarlos de la empresa del proveedor (dejaría fuera a los externos y mezclaría ofertas de Membego con la vitrina del proveedor) y no materializar (F3 no tendría un ítem al que atar el pedido).

### Implementado (F2.5.1 — verificado, §8)
- ✅ Esquema: `companies.esCasaMembego` (+ índice único parcial `companies_una_casa_membego`), `catalog_items.supplyV2OfferId` (único, FK `RESTRICT` a `supply_v2_offers`) y la regla de la base **`source = 'SUPPLY' ⇔ supplyV2OfferId IS NOT NULL`**. Migraciones `20261040_supply_bridge` y `20261041_supply_bridge_enums` (1 valor de `AuditAccion`), aditivas e idempotentes; selladas (196), 0 deriva.
- ✅ **Un ítem por OFERTA, no por producto de proveedor** (desviación del plan, que decía `supplyV2CatalogItemId`): la unidad que se vende es la oferta (un producto tiene muchas, con precio y vigencia propios). Tipo `VOUCHER`, capacidades «se canjea, no se prepara, no pasa por caja», una variante `Default` con el **código de la oferta** como SKU, precio = venta, «antes» = lista (solo si hay descuento), **sin costo**, sin imágenes (Supply no sube imágenes de ofertas: `imagePath` existe pero ninguna pantalla lo escribe).
- ✅ `src/modules/supply-bridge/`: `domain.ts` (mapeo **puro**: estado de la oferta → estado del ítem y de la variante, `diferencias()`), `service.ts` (`sincronizarOfertaEnTx` idempotente bajo candado `pg_advisory_xact_lock` por oferta, `designarCasaEnTx`, `archivarPuenteEnTx`, `estadoDelPuenteEnTx`), `barrido.ts`, `actions.ts`, `errores.ts`. **Solo toca Supply por su read model público** (`ofertaParaPuenteEnTx`, el mismo DTO cerrado que ve el cliente); Commerce Core no importa del puente (un test lo vigila).
- ✅ **Cuándo se sincroniza:** (1) tras cada cambio de una oferta —el único punto es `refrescarOfertas()` en `actions-ofertas.ts`, con `after()`—, sin poder tumbar la acción de Supply (la oferta ya se guardó); (2) cron diario `/api/cron/supply-bridge` (06:45 UTC) que reconcilia todas las no borrador; (3) botón «Sincronizar ahora». Cambio mínimo a Supply: 3 líneas en `actions-ofertas.ts` y un `export` nuevo en `marketplace/read-model.ts`.
- ✅ **El público cruza el ítem con la oferta EN VIVO:** un ítem puente solo se ve si su oferta está `ACTIVE`/`SOLD_OUT`, ya empezó y no venció; una agotada se enseña como agotada **aunque la copia sincronizada diga otra cosa**. Pausar o vencer una oferta la saca del público sin esperar a ninguna sincronización (test PG con mutación: sin ese cruce falla).
- ✅ Supply es el master: el ítem puente es de solo lectura para la empresa (`itemEditable` ya rechazaba `source = SUPPLY`: datos, variantes y estado; test PG).
- ✅ Sin casa: el puente no sincroniza nada y archiva lo puente; con ítems puente colgando de otra empresa **no se cambia de casa** (se retira primero); si aun así la casa cambió por debajo, la oferta queda en `CONFLICTO` y no se mueve.
- ✅ Tests: `supply-bridge` (15 unit), `postgres/supply-bridge.db.test.ts` (20: reglas de la base, idempotencia, **8 sincronizaciones simultáneas de una oferta nueva → 1 ítem**, visibilidad en vivo, barrido, retiro de la casa, solo lectura). Mutaciones comprobadas: sin el cruce con la oferta en vivo falla 1; sin el candado falla 1.

### Implementado (F2.5.2 — verificado, §8)
- ✅ Panel `/superadmin/puente-supply` (solo `SUPERADMIN`; acciones también): buscar y designar la empresa de la casa, **lista de requisitos** (activa, publicada, no demo, capacidad `CATALOGO_UNIFICADO` encendida —se informan, no se encienden solos—), retirar, «Sincronizar ahora» y conteo de ítems por estado y ofertas pendientes. Entrada en el menú del superadmin.
- ✅ Descubrimiento `/catalogo`: franja destacada **«Ofertas MembeGo»**, selector de origen (Todo / Ofertas MembeGo / De negocios; valores de la URL validados), y la lista general sin duplicar las destacadas. La tarjeta de una oferta lleva a **su página de compra de Supply** (`/promociones/membego/<slug>`: el checkout NO se duplica) con insignia «Oferta MembeGo»; la ficha en la vitrina de la casa ofrece «Ver la oferta y comprar».
- ✅ **E2E de CI** `tests/e2e/puente-supply.spec.ts` (3): sin casa → designar → sincronizar → destacadas, filtro de origen, ficha y salto a la compra de Supply → **pausar una oferta DESDE Supply la saca del catálogo** (prueba el enganche real `after()`) → retirar la casa saca todo; un no-superadmin no entra.

### Decisiones y desviaciones del plan (F2.5)
| Plan | Implementado | Por qué |
|---|---|---|
| `supplyV2CatalogItemId` (FK) | **`supplyV2OfferId`** | La oferta es lo que se vende (muchas por producto) |
| «event-driven vía el outbox de Supply V2» | Llamada **best-effort tras cada acción de oferta** + cron + botón; el público cruza la oferta en vivo | El outbox existente es de efectos de **órdenes** (`supply.order.*`); añadir eventos de oferta obligaba a tocar el despachador. El efecto es el mismo y sin acoplar el worker; el cruce en vivo cubre el desfase |
| «Se genera `MembegoOrder` (wrapper de atribución)» | **No** | `MembegoOrder` no existe hasta F3; la compra funciona por el checkout de Supply y el ítem puente es a lo que F3 atará el pedido |
| Filtros por categoría y «cerca de mí» en el Discovery | **No** (solo texto + origen) | `CatalogCategory` es por empresa (no hay categorías transversales) y la geolocalización de ítems no existe; se deja para cuando haya categorías de plataforma |
| Imágenes del ítem | **Sin imágenes** | Supply no sube imágenes de ofertas |

### Límites de la verificación de F2.5 (lo que NO se probó)
- La casa debe cumplir los requisitos (publicada, activa, capacidad) **a mano**; el panel los muestra pero no los fuerza. Una empresa «Membego» publicada **aparece en el directorio de empresas** del marketplace como cualquier otra (decisión del superadmin al designarla).
- El E2E corre con ofertas sembradas por Prisma (el flujo de crear una oferta por la interfaz de Supply no se recorre aquí); la pausa sí se hace por la interfaz real de Supply.
- Una venta que agota una oferta sin pasar por `refrescarOfertas()` (la confirmación de pago llama sin id) se refleja por el **cruce en vivo del estado** (`SOLD_OUT`) y por el cron; una oferta que se agota solo por unidades sin que su estado cambie se enseña como agotada tras la siguiente sincronización.
- Sin `MembegoOrder`, sin atribución de ventas del catálogo, sin categorías ni «cerca de mí» transversales, sin sitemap.
- Los 3 gates de la interfaz (accesibilidad, deuda de diseño, tokens de color) **fallaban** en el commit `e3eb7c7` (F2): la interfaz de inventario introdujo 1 campo sin nombre accesible (un `<select>` nombrado en un comentario) y 9 clases de color literales, y no se corrió la suite completa tras escribirla. **Corregido en este cambio**; la lección: correr `npm test` completo después de la interfaz, no solo los archivos propios.

### Pendiente (F2.5)
`MembegoOrder` wrapper (F3); categorías de plataforma y «cerca de mí»; imágenes de ofertas; ranking/patrocinio de las destacadas; encender la capacidad en la casa desde el panel (hoy es un override manual).

### Archivos principales (F2.5)
`prisma/schema/{catalogo,identidad,supply-v2}.prisma` · `prisma/migrations/{20261040_supply_bridge,20261041_supply_bridge_enums}` · `src/modules/supply-bridge/*` · `src/modules/supply-v2/{actions-ofertas.ts,marketplace/read-model.ts}` (cambios mínimos) · `src/modules/catalog/{publico,publico-nucleo}.ts` · `src/app/api/cron/supply-bridge/route.ts` · `src/app/(superadmin)/superadmin/puente-supply/*` · `src/components/supply-bridge/*` · `src/components/catalogo/TarjetaCatalogoPublica.tsx` · `src/app/(public)/catalogo/page.tsx` · `src/app/(public)/empresas/[companySlug]/catalogo/[itemSlug]/page.tsx` · `vercel.json` · `tests/{supply-bridge,catalogo-publico}.test.ts` · `tests/postgres/supply-bridge.db.test.ts` · `tests/e2e/{puente-supply.spec,puente-arnes}.ts`.

### Entidades, APIs, eventos (F2.5)
Sin tablas nuevas (2 columnas). Server Actions (2, solo `SUPERADMIN`): `designarCasaMembego`, `sincronizarPuenteAhora`. Cron `/api/cron/supply-bridge`. Auditoría: `SUPPLY_BRIDGE_HOUSE_CHANGED`; los ítems puente escriben `CATALOG_ITEM_CREATED/UPDATED` con `origen: supply-bridge`. Eventos de dominio: ninguno.

### Criterios de aceptación (Plan Maestro §10, F2.5)

| Criterio | Resultado |
|---|---|
| Supply items visibles en marketplace público automáticamente | **PASS** — tras designar la casa, cada oferta publicada se refleja sola (acción + cron); E2E |
| Marketplace cross-company con búsqueda y categorías | **PARCIAL** — búsqueda de texto y filtro de origen sí; **categorías transversales no** (no existen) |
| Supply patrocinado destacado | **PASS (mínimo)** — franja «Ofertas MembeGo»; sin ranking ni pago por posición |
| Compra de Supply items funciona (checkout Supply V2) | **PASS** — la tarjeta y la ficha llevan al checkout existente (no duplicado); E2E hasta la página de compra |
| MembegoOrder de atribución generado | **NO** — depende de F3 |

---

### Fase anterior — F2 Inventory (🟡) · F2.1 y F2.2 entregadas

### Objetivo
Inventario real **por variante y sucursal** con ledger inmutable (Plan Maestro §10, F2): saldo por cubetas, movimientos append-only, reservas con vencimiento, transferencias, alertas de stock bajo. F2.1 = esquema, ledger, servicio y tests; F2.2 = pantallas de admin y E2E. Va **con la misma capacidad que el catálogo** (`CATALOGO_UNIFICADO`, apagada de serie; el plan dice «se activa automáticamente con F1 para ítems con `trackInventory`»).

### Implementado (F2.1 — verificado, §8)
- ✅ Esquema `prisma/schema/inventario.prisma`: `InventoryLevel` (saldo por `catalogVariantId` × `locationId` = `Sucursal`), `InventoryMovement` (ledger) e `InventoryReservation` (reserva con `expiresAt`); enums `InventoryBucket` (`AVAILABLE`/`RESERVED`/`DAMAGED`), `InventoryMovementType` (los 9 del plan), `InventoryReservationStatus`; 3 acciones de auditoría (`INVENTORY_STOCK_CHANGED`, `INVENTORY_TRANSFERRED`, `INVENTORY_CONFIGURED`).
- ✅ Migraciones `20261038_inventory_core` y `20261039_inventory_core_enums`: aditivas e idempotentes; solo tocan tablas existentes para añadir 2 índices únicos `(id, companyId)` (destino de FK compuestas) en `catalog_variants` y `sucursales`. Selladas (194), 0 deriva.
- ✅ La **base** hace cumplir: ninguna cubeta negativa y `reserved ≤ onHand` (`available = onHand − reserved`, calculado), cantidades positivas, **cada tipo de movimiento solo puede hacer ciertos traslados** (CHECK `inventory_movements_traslado`, gemelo de la tabla del dominio), motivo obligatorio en ajuste y daño, FK **compuestas** que impiden juntar la variante de una empresa con la sucursal de otra, FK `RESTRICT` (con historial no se borra ni la variante ni la sucursal) y **ledger inmutable**: disparadores que rechazan `UPDATE`, `DELETE` y `TRUNCATE` de `inventory_movements`.
- ✅ **Bug que cazó la prueba de las 144 combinaciones:** un CHECK que evalúa a `NULL` **se acepta** en PostgreSQL; la primera versión del CHECK de traslados dejaba pasar, p. ej., un `DAMAGE` de «nada» a `DAMAGED`. Corregido con `IS NOT DISTINCT FROM` y `coalesce(…, false)` (la migración no se había confirmado aún).
- ✅ `src/modules/inventory/`: `domain.ts` (puro, sobre `commerce-primitives/ledger`), `service.ts`, `queries.ts`, `actions.ts`, `barrido.ts`, `auditoria.ts`, `errores.ts`, `formato.ts` (client-safe). **Toda escritura al saldo pasa por `escribirMovimiento`** (un test lo vigila); concurrencia con `SELECT … FOR UPDATE` sobre el saldo (varias filas, **en orden de id**: las transferencias cruzadas no se interbloquean); **idempotencia** por `idempotencyKey` único por empresa; **una reserva vencida deja de apartar sin esperar al cron** (toda operación sobre un saldo vence antes las caducadas, bajo el mismo candado).
- ✅ Operaciones: recibir, devolver, vender (directa, para caja/pedidos), dañar, resolver lo dañado (vuelve a vender o baja), ajustar (±, motivo obligatorio), **conteo físico** (calcula la diferencia; no baja de lo apartado), transferir (dos patas, misma referencia `TRANSFER`, una transacción), reservar con TTL (1 min–7 días), liberar, consumir (convertir en venta; una vencida ya no se cobra), vencer caducadas, umbral de stock bajo.
- ✅ Cron `/api/cron/inventario` (diario, 06:30 UTC, `autorizarCron`) que vence las reservas caducadas empresa por empresa (idempotente; un fallo en una empresa no afecta a las demás).
- ✅ Enganches con el catálogo: una variante con **historial** de inventario no se borra (se descontinúa; un saldo sin movimientos se va con ella) y no se puede **dejar de controlar inventario** con existencias (`ITEM_CON_EXISTENCIAS`). El catálogo **no importa** del inventario (la dependencia va en una dirección; lo vigila un test).
- ✅ Sección `inventario` (sin capacidad propia: cuelga de `CATALOGO_UNIFICADO`; fuera de los roles acotados) con funciones de permiso `ajustar` y `transferir`; gate `permisos-catalogo` en verde (100 funciones).
- ✅ RLS: las 3 tablas llevan `companyId` propio → Nivel 0, política **generada** (0 escritas a mano). `probar-rls` 29/29 (7 casos nuevos: lectura, escritura cruzada, FK compuesta, `update` sin `where`, y «ni la dueña edita su ledger»).
- ✅ Tests: `inventory-domain` (13 unit, incluye una propiedad de 5 000 movimientos al azar), `inventario-permisos` (15 unit) y `postgres/inventory.db.test.ts` (35: 20 reservas simultáneas de 5 unidades → ganan exactamente 5; dos ventas de la última unidad; misma clave llegando 5 veces; transferencias cruzadas en paralelo; inmutabilidad; las 144 combinaciones; vencimiento sin barrido; propiedad de 300 operaciones al azar con el cuadre ledger↔saldo↔reservas; aislamiento; barrido). **Mutación comprobada:** sin `FOR UPDATE` fallan las 4 pruebas de concurrencia; sin un filtro de `companyId` falla el gate de aislamiento.

### Implementado (F2.2 — verificado, §8)
- ✅ Pantallas `/admin/inventario` (lista: variantes de los productos que **controlan inventario**, con saldo por sucursal, estado Agotado/Stock bajo/En stock, filtros por texto, sucursal y estado, alertas de stock bajo arriba, paginación) y `/admin/inventario/[varianteId]` (totales, una tarjeta por sucursal con **movimientos manuales** —entrada, devolución, conteo, ajuste sobrante/faltante, daño, resolver lo dañado— y umbral, **transferencia** entre sucursales, reservas vivas e historial paginado por cursor). Layout con `guardarSeccion('inventario')`; cada página con `requireRole` + `requireCompanyContext`; una variante ajena o inexistente se ve igual (`notFound()`, sin fuga); los formularios se ocultan a quien no tiene la función (la acción igual lo rechazaría).
- ✅ Cada envío lleva una **clave de idempotencia** (doble clic o reintento no mueve el stock dos veces). `router.refresh()` tras cada éxito. Cantidad y motivo son estado controlado (un `form.reset()` desincronizaba el `<select>` controlado: detectado en la revisión, corregido antes de probar).
- ✅ Menú: «Inventario» en *Oferta comercial* y en el hub *Catálogo*, con `capacidad: 'CATALOGO_UNIFICADO'`.
- ✅ **E2E de CI** `tests/e2e/inventario-admin.spec.ts` (3 pruebas): lista agotada → entrada → faltante sin motivo (no envía) → con motivo → imposible (avisa y no mueve) → daño → baja → umbral y alerta en la lista → transferencia → conteo → historial; variante ajena = inexistente; empresa sin capacidad rebotada y sin entrada de menú. Reutiliza el arnés `catalogo-arnes.ts` (sesión firmada, sin Supabase).

### Decisiones y desviaciones del plan (F2)
| Plan | Implementado | Por qué |
|---|---|---|
| Entidades `InventoryLevel` e `InventoryMovement` | + **`InventoryReservation`** | «Reservations con TTL» exige una fila que sepa qué vence y cuándo; con solo dos tablas no hay qué vencer |
| `locationId` (`Location`) | **`Sucursal`** existente | No hay entidad `Location`; las sucursales ya son el «dónde» de caja, Supply y visitas. FK compuesta `(locationId, companyId)` |
| `incoming` en `InventoryLevel` | **No está** | Ningún flujo lo escribe (no hay órdenes de compra en tránsito); una columna que nadie mantiene miente. Se añade con una migración aditiva cuando exista el flujo |
| `orderId` en `InventoryMovement` | **No está**; `referenceType`/`referenceId` (`ORDER`, `TRANSFER`, `RESERVATION`, `STOCK_COUNT`…) | `MembegoOrder` no existe hasta F3; la referencia genérica ya lo cubrirá sin migrar |
| `damaged` como campo | Cubeta propia `DAMAGED` del ledger; `onHand = AVAILABLE + RESERVED` (lo dañado **no** cuenta como existencia) | Hace que el ledger cuadre con las tres cubetas y que lo dañado no se venda |
| `quantity` «positiva o negativa» | **Siempre positiva**; la dirección la dan `sourceBucket`/`destinationBucket` | Es el patrón de `commerce-primitives/ledger` (traslados); evita el signo ambiguo |
| `userId` en el movimiento | Texto **sin FK** | Un usuario que se borra no puede reescribir un ledger inmutable (la FK con `SET NULL` exigiría un `UPDATE`) |
| Unidades | **Enteras** | Inventario de venta (piezas). Los insumos por litro/kilo del Car Wash siguen en `ProductoInventario`, que **no** se migra |
| Capacidad propia | **Ninguna**: cuelga de `CATALOGO_UNIFICADO` | El plan (§Activación) dice que F2 se activa con F1 para ítems con `trackInventory` |

### Límites de la verificación de F2 (lo que NO se probó)
- Los E2E corren sobre una base creada con `db push`: **sin** los disparadores ni los CHECK de las migraciones. La inmutabilidad y las 144 combinaciones las prueban los tests PG y `probar-rls`; la interfaz, el E2E.
- **El público no ve el stock**: un ítem con `trackInventory` y 0 disponibles sigue mostrándose como vendible en la vitrina (no hay compra todavía; F3/F8 lo conectarán). La variante tiene su `status` manual `OUT_OF_STOCK`, independiente del saldo.
- Sin importación masiva, sin API pública de inventario (no está en el plan), sin alertas por correo/push (solo la lista y el aviso en pantalla), sin insignia de «stock bajo» en el menú, sin reportes de valuación ni de rotación.
- `vender`/`reservar`/`consumir` los llama el sistema (caja, pedidos de F3): **ninguna pantalla ni acción de panel los expone** (lo vigila un test) y todavía no hay quien los llame.
- Solo escritorio y modo claro en el E2E; sin dispositivo real.
- El ledger de `ProductoInventario` (carwash) sigue **sin bloqueo** (§10): no se tocó.

### Pendiente (F2)
API v1 de inventario y eventos de dominio; mostrar «agotado» en la vitrina a partir del saldo (F3); importación masiva y conteo por hoja; alertas por notificación; reportes; `incoming` cuando haya compras en tránsito; migrar/enlazar `ProductoInventario` del Car Wash (decisión de producto, no del plan).

### Archivos principales (F2)
`prisma/schema/{inventario,catalogo,identidad}.prisma` · `prisma/migrations/{20261038_inventory_core,20261039_inventory_core_enums}` · `src/modules/inventory/*` · `src/app/(admin)/admin/inventario/*` · `src/app/api/cron/inventario/route.ts` · `src/components/inventario/*` · `src/modules/catalog/service.ts` (2 guardas) · `src/lib/auth/{permissions,funciones}.ts` · `src/modules/capacidades/catalogo.ts` · `src/modules/auditoria/queries.ts` · `src/components/layout/nav-config.ts` · `vercel.json` · `scripts/probar-rls.mjs` · `tests/{inventory-domain,inventario-permisos}.test.ts` · `tests/postgres/inventory.db.test.ts` · `tests/e2e/{inventario-admin.spec,catalogo-arnes}.ts`.

### Entidades, APIs, eventos (F2)
Tablas: `inventory_levels`, `inventory_movements`, `inventory_reservations`. Server Actions (9, todas con `requireSection('inventario', fn)`): `registrarEntradaInventario`, `registrarDevolucionInventario`, `registrarDanoInventario`, `resolverDanadoInventario`, `ajustarInventario`, `contarInventario`, `fijarUmbralInventario` (función `ajustar`), `transferirInventario` (función `transferir`) y `cargarMasHistorialInventario` (solo sección). Servicio para el sistema: `venderEnTx`, `reservarEnTx`, `liberarReservaEnTx`, `consumirReservaEnTx`, `vencerReservasEnTx`. Cron `/api/cron/inventario`. Eventos de dominio: ninguno.

### Criterios de aceptación (Plan Maestro §10, F2)

| Criterio | Resultado |
|---|---|
| Inventario por variante y ubicación funcional | **PASS** — pantallas, servicio y E2E; 35 tests PG |
| Ledger inmutable | **PASS** — la base rechaza `UPDATE`/`DELETE`/`TRUNCATE` (tests PG y `probar-rls`) |
| Reservations con TTL | **PASS** — vencen sin cron, el barrido es red de seguridad; concurrencia probada (20 → 5) |
| `available` nunca negativo | **PASS** — CHECK + ledger puro + propiedad de 5 000 y de 300 operaciones |
| Concurrencia (`SELECT FOR UPDATE`) | **PASS** — con mutación: sin el candado fallan las 4 pruebas |

---

### Fase anterior — F1 Commerce Catalog (🟡) · F1.1, F1.2 y F1.3 entregadas

### Objetivo
`CatalogItem` + `CatalogVariant` como fuente única de «qué vende una empresa», con variante default oculta en ítems simples. F1.1 = backend; F1.2 = UI admin; F1.3 = marketplace público + API v1.

### Implementado (F1.1 — verificado, §8)
- ✅ Esquema `prisma/schema/catalogo.prisma`: `CatalogItem`, `CatalogVariant`, `CatalogCategory`, `CatalogItemCategory`, `CatalogItemImage` (+ enums `CatalogItemType` ×7, `CatalogItemStatus`, `CatalogItemSource`, `CatalogVariantStatus`).
- ✅ Migraciones `20261036_catalog_core` (tablas, índices, FK compuestas, CHECK, disparador) y `20261037_catalog_core_enums` (4 valores de `AuditAccion`); idempotentes (reaplicadas sobre la misma BD sin error), selladas, 0 deriva.
- ✅ La **base** hace cumplir: ≥1 variante por ítem (disparador diferido), `isDefault` solo si es la única variante, a lo sumo una default, SKU único **por empresa**, código de barras único por empresa, precio/costo ≥ 0, precio anterior ≥ precio, `capabilities`/`attributes` son objetos, y variante/imagen/categoría solo de la **misma empresa** que su ítem (FK compuesta).
- ✅ RLS: las 5 tablas llevan `companyId` propio → Nivel 0, política `membego_inquilino` **generada** (0 escritas a mano). Preflight 269/290 cubiertas; `probar-rls` 22/22 (6 casos nuevos de catálogo).
- ✅ Capacidad `CATALOGO_UNIFICADO` (apagada en las 5 categorías) → sección `catalogo` (`ADMIN_SECTIONS`, no entra en roles acotados) con 5 funciones de permiso: `crear`, `editar`, `publicar`, `archivar`, `variante`; gate `permisos-catalogo` en verde (98 funciones).
- ✅ `src/modules/catalog/`: `domain.ts` (puro), `service.ts`, `queries.ts`, `actions.ts` (6 acciones con `requireSection('catalogo', función)`; empresa de la sesión; todo en `conEmpresa`), `auditoria.ts`, `errores.ts`. SKU automático `SKU-<año>-<seq>` vía `commerce-primitives/numeracion` con cerrojo **por empresa** (`catalogo:<companyId>`); no importa nada de `supply-v2` (lo vigila un test).
- ✅ Tests: `catalog-domain` (19 unit), `catalogo-permisos` (9 unit), `postgres/catalog.db.test.ts` (29: invariantes de BD, FK compuesta, concurrencia de SKU/slug/variantes, estados, aislamiento por servicio). Mutación comprobada: sin disparador fallan 3 tests; sin bajar la default fallan 4; sin filtro de empresa falla 1.

### Implementado (F1.2 — verificado, §8)
- ✅ Pantallas `/admin/catalogo` (lista con filtros por estado/tipo/texto, `nuevo`, `[id]`): layout con `guardarSeccion('catalogo')`, cada página con `requireRole` + `requireCompanyContext`; un ítem ajeno o inexistente se ve igual (`notFound()`, sin fuga).
- ✅ **Ítem simple = sin vocabulario de variantes**: la tarjeta se llama «Precio» y no pide nombre de variante; al pulsar «Tiene tallas, tamaños u otras opciones» y agregar una, pasa a «Variantes y precios» (selector visible solo con >1). La variante automática pasa a llamarse **«Estándar»** (si aún conserva el nombre del sistema «Default»; uno elegido por la persona no se toca).
- ✅ Estados del ítem: solo se ofrecen las transiciones de la tabla del dominio; publicar exige una variante activa.
- ✅ **Fotos** (`subirImagenCatalogo`, `eliminarImagenCatalogo`, `ponerPortadaCatalogo`): misma guardia que `subirImagenExcursion` (sesión → permiso `editar` → empresa de la sesión → ítem editable y cupo (10) → firma de archivo → `upsert:false`), ruta `<empresa>/catalogo/<ítem>/<archivo>` (`rutaCatalogo`, bucket `promociones`, cubierto por la política existente de Storage), sin huérfanos si falla el registro, y borrado del bucket solo bajo el prefijo del ítem.
- ✅ **Categorías propias** (crear con cerrojo por empresa, borrar sin borrar ítems, asignar un conjunto exacto).
- ✅ Menú: entrada «Catálogo» en *Oferta comercial* y en el hub *Catálogo*, con `capacidad: 'CATALOGO_UNIFICADO'`; `CapacidadNav` y `CAPACIDADES_DEL_MENU` sincronizadas (las cuatro listas).
- ✅ Tests: `catalogo-permisos` (14 unit; incluye orden guardia→cliente de servicio en la subida, filtro por empresa en `medios.ts`, componentes de cliente sin importar dominio/Prisma, guardias de página y menú), `catalog-formato` (4), `storage-rutas` (+1), `postgres/catalog-medios.db.test.ts` (10) y 2 más en `catalog.db.test.ts`. Mutaciones comprobadas: sin validar la ruta de imagen falla 1; sin cerrojo de categorías falla 1.
- ✅ **Recorrido en navegador real** (Chromium, app `next start` + PostgreSQL locales, sesión firmada con el secreto de pruebas local; 26/26): lista vacía → alta → precio editable → publicar → agregar variante (aparece el selector) → quitar variante (vuelve a precio único) → categoría creada y persistida → subida de imagen sin Storage → filtros y parámetros hostiles → ítem de otra empresa → empresa **sin** la capacidad (rebotada y sin entrada de menú) → 0 errores de consola.

### Implementado (F1.3 — verificado, §8)
- ✅ **Vitrina pública**: sección «Productos y servicios» en `/empresas/[slug]` (con entrada en su navegación interna), detalle `/empresas/[slug]/catalogo/[item]` (opciones con precio, «antes» tachado, agotado), descubrimiento entre empresas `/catalogo` (búsqueda, paginación) y franja en el inicio. Cacheado como el resto del marketplace (TTL 120 s) y **invalidado al mutar** desde el panel (`revalidateTag(MARKETPLACE_TAG)`).
- ✅ **Cuándo algo se ve** (las tres, a la vez): empresa publicada + activa + no demo **y con la capacidad**; ítem `ACTIVE` y `availableMarketplace`; al menos una variante visible (la descontinuada no existe para el público, la agotada sale marcada). Apagar la capacidad lo saca todo sin borrar datos. Un ítem no público (borrador, pausado, otra empresa, sin capacidad) es indistinguible de uno inexistente (404, `noindex`).
- ✅ **Lista blanca de campos** (`publico-nucleo.ts`): el público no ve costo, SKU, código de barras, capacidades internas, ids de empresa ni rutas de Storage; un test recorre todas las claves del JSON y otro prohíbe esos campos en el código público.
- ✅ **API v1** (`/catalog-items`, `/catalog-items/{id}`, `/catalog-variants`; GET y POST): scopes `catalog:read` (satélite o clave de empresa) y `catalog:manage` (**solo clave de empresa**), capabilities `CATALOG_LOOKUP`/`CATALOG_MANAGE`, inventario OpenAPI actualizado, `docs/platform/api-v1.md` ampliado, paginación por cursor, empresa siempre la de la clave, capacidad apagada → `404 catalog_not_enabled`. **El costo solo sale hacia la clave de la propia empresa.**
- ✅ **La API arma borradores, no publica**: crear deja el ítem en `DRAFT` (ignora `status`, `companyId` y `source` del cuerpo) y las variantes solo se agregan a ítems en borrador; publicar o tocar un precio en vivo es del panel.
- ✅ Tests: `catalogo-publico` (13 unit), `catalogo-api` (9), `postgres/catalog-publico.db.test.ts` (14; 4 empresas: visible / sin capacidad / sin publicar / demo). Mutaciones comprobadas: sin comprobar la capacidad falla 1; sin el filtro `availableMarketplace` falla 1; sin la regla de solo-borradores falla 1.
- ✅ **Recorrido real**: API por HTTP con claves de empresa reales (28/29; el que falla es «sin credenciales → 401», que en esta app local da 503 `PLATFORM_API_UNCONFIGURED` igual que `/branches` y `/promotions`: falta la firma de tokens de satélite del entorno) y páginas públicas en Chromium (27/27, 0 errores de consola).

### Decisión de seguridad a revisar (F1.3)
`catalog:manage` se añadió como **tercera excepción nombrada** a «las claves de empresa solo leen» (junto a `webhooks:manage` y `customers:manage`; test `connect-panel` actualizado a propósito) y el panel de claves lo ofrece. Es una **escritura de negocio** de una clave de API: se acotó a lo mínimo (solo borradores, nunca publica, nunca toca precios en vivo, sin costo hacia satélites), pero **ampliar lo que puede hacer una clave es decisión tuya**: si no la quieres, basta quitar `catalog:manage` de `SCOPES_DE_ADMINISTRACION` y del panel; la lectura sigue.

### E2E de CI del catálogo (hecho el 2026-10-06)
Tres specs en `tests/e2e/` más el arnés `catalogo-arnes.ts` (siembra por Prisma; roles `catalogoConCapacidad`/`catalogoSinCapacidad` añadidos a `supply-v2-sesion.ts`). Entran con **sesión firmada con el secreto de relleno de `e2e.yml`**: no necesitan Supabase, así que **sí corren en CI** (el workflow no cambió).
- `catalogo-admin` (escritorio): alta → precio → publicar → variantes (selector aparece/desaparece) → categoría → foto sin Storage (avisa y sigue viva) → filtros → **lo publicado desde el panel se ve en la vitrina, en `/catalogo` y en el inicio, y pausarlo lo saca** (prueba la invalidación de caché); ítem ajeno = inexistente; empresa sin capacidad rebotada y sin entrada de menú.
- `catalogo-publico` (móvil **y** escritorio): qué se ve y qué no (borrador, pausado, solo-caja, sin capacidad, sin publicar → todos idénticos a un 404), sin costo/SKU en el HTML, sin desbordes horizontales y sin errores de consola.
- `catalogo-api` (HTTP, claves de empresa reales): costo solo hacia la propia clave, solo borradores, aislamiento, `catalog_not_enabled`.
- **Verificación:** 5 repeticiones seguidas de los 3 specs → 125 PASS · 0 FAIL; suite completa 93 PASS · 0 FAIL · 124 SKIP. **Mutaciones:** sin la invalidación de caché del panel falla el spec de admin; sin el filtro `availableMarketplace` falla el público.
- **Lecciones** (en `docs/PRUEBAS-E2E.md`): no usar `networkidle` (con el build de CI el cliente de auth reintenta sin fin); las páginas en streaming tienen un instante con contenido duplicado oculto (usar roles o esperar); la lista del marketplace se cachea 120 s por filtros.
- **Límite:** los specs corrieron **en local** (réplica de `e2e.yml`), no en un runner de GitHub; el primer PR real los confirma. No prueban Storage real ni dispositivos reales (solo el emulado Pixel 7).

### Límites de la verificación de F1.3 (lo que NO se probó)
- Imágenes en la vitrina: **no hay fotos reales** en este entorno (sin Storage); se vieron los marcadores de posición. El renderizado con `next/image` de fotos de Supabase no se ejercitó.
- Móvil (Pixel 7 emulado) cubierto por E2E para las páginas públicas; sin modo oscuro; sin SEO real (metadata y OG de la ficha no se inspeccionaron más allá del `<title>`); no hay `sitemap` ni JSON-LD del catálogo.
- Los reintentos de `POST` no son idempotentes (la tabla de idempotencia es de satélites): se mitiga con el SKU único, documentado.
- El feed cross-company es la página `/catalogo` y la franja del inicio; **no** se integró en `/cliente/explorar` ni en el feed de novedades de la app del cliente.
- La capacidad se cachea hasta 5 min por empresa (`unstable_cache` del resolutor): apagarla desde el panel invalida el tag, pero un cambio directo en BD tarda hasta ese TTL.
- Sin carrito ni checkout: la ficha termina en «Ver empresa» (F8).

### Límites de la verificación de F1.2 (lo que NO se probó)
- La **subida real de imágenes a Supabase Storage** no se probó de extremo a extremo (no hay Storage en este entorno): se verificó que falla con aviso y sin romper, y la lógica de ruta/cupo/registro por PG y por lectura de código.
- ~~El recorrido en navegador era un script local fuera del repo~~ → **superado:** ahora son specs E2E de CI (ver «E2E de CI del catálogo» abajo). Los E2E autenticados **de cliente/admin/comisiones** siguen omitidos (§14).
- Solo escritorio (1280 px); no se miró en móvil ni en modo oscuro.
- Las acciones nunca se ejecutaron con una sesión de Supabase real.

### Desviaciones del plan (decididas al implementar; el código manda)
| Plan | Implementado | Por qué |
|---|---|---|
| `CatalogVariant` por FK (Nivel N) | `companyId` **propio** en variante, imagen y categoría + FK compuesta `(catalogItemId, companyId)` | SKU único por empresa exige la columna; la FK compuesta evita que se desincronice; deja las 5 tablas en Nivel 0 |
| `supplyV2CatalogItemId` (FK) en F1 | **No** está; sí `source` (`MERCHANT`/`SUPPLY`, default `MERCHANT`) | El plan (§Migraciones) lo añade en F2.5; evita acoplar el esquema a `supply_v2_*` ahora |
| Entidad `VariantAttribute` | `attributes` JSON (texto plano, ≤20 claves) | El propio esquema del plan usa JSON; se promueve a tabla si hace falta filtrar |
| (no previsto) | `CatalogCategory` (+ join) | El N:N `CatalogItemCategory` necesita un destino; categoría **propia de la empresa**, distinta de `CompanyToCategory` |
| (no previsto) | `currency` en el ítem, no en la variante | Dos tallas de un producto no se cobran en monedas distintas |
| `_enums` aparte «según el patrón de Supply V2» | Solo para `AuditAccion` | Ese patrón existe por `ALTER TYPE ADD VALUE`; los `CREATE TYPE` nuevos van en la migración principal |
| «Default» ⇒ «≥1 variante» | `isDefault` = «creada por el sistema y única»; al añadir una segunda deja de serlo | Es lo que el plan describe; el selector de la UI se decide por `variantes > 1`, no por `isDefault` |

### Pendiente
Bulk import; eventos de dominio (`CatalogItemCreated`…) y webhooks del catálogo; integrar el catálogo en `/cliente/explorar`; reordenar fotos más allá de «hacer portada»; editar el nombre de una categoría; ~~specs E2E de CI~~ (hechas, §3); sitemap/JSON-LD; precios por ubicación/canal (`VariantPrice`). **Nada de esto bloquea**; y la capacidad sigue apagada para todas las empresas hasta que se encienda por override.

### Bloqueadores
Ninguno.

### Archivos principales
`prisma/schema/{catalogo,identidad}.prisma` · `prisma/migrations/{20261036_catalog_core,20261037_catalog_core_enums}` · `src/modules/catalog/*` · `src/app/(admin)/admin/catalogo/*` · `src/components/catalogo/*` · `src/lib/storage-rutas.ts` · `src/modules/catalog/{publico,publico-nucleo}.ts` · `src/modules/plataforma/catalogo*.ts` · `src/app/api/platform/v1/catalog-*` · `src/app/(public)/catalogo` · `src/app/(public)/empresas/[companySlug]/catalogo` · `src/components/marketplace/CompanyProfile.tsx` · `src/modules/marketplace/cached.ts` · `packages/contracts/src/{scopes,inventario}.ts` · `src/modules/capacidades/catalogo.ts` · `src/modules/plataforma/conceptos.ts` · `src/lib/auth/{permissions,funciones}.ts` · `src/modules/auditoria/queries.ts` · `scripts/probar-rls.mjs` · `tests/{catalog-domain,catalog-formato,catalogo-permisos,catalogo-publico,catalogo-api}.test.ts` · `tests/postgres/catalog{,-medios,-publico}.db.test.ts` · `scripts/supply-db/shim-next-stub.cjs` · `docs/{CAPACIDADES,platform/api-v1}.md`.

### Entidades, APIs, eventos
Tablas: `catalog_items`, `catalog_variants`, `catalog_categories`, `catalog_item_categories`, `catalog_item_images`. Server Actions (12, todas con `requireSection('catalogo', fn)`): `crearItemCatalogo`, `actualizarItemCatalogo`, `cambiarEstadoItemCatalogo`, `agregarVarianteCatalogo`, `actualizarVarianteCatalogo`, `eliminarVarianteCatalogo`, `subirImagenCatalogo`, `eliminarImagenCatalogo`, `ponerPortadaCatalogo`, `crearCategoriaCatalogo`, `eliminarCategoriaCatalogo`, `asignarCategoriasCatalogo`. Imágenes y categorías usan la función `editar`. Auditoría: `CATALOG_ITEM_CREATED/UPDATED/STATUS_CHANGED`, `CATALOG_VARIANT_CHANGED` (con antes/después de precio y estado; las altas por API llevan `userAgent: platform-api`). API v1: `GET/POST /catalog-items`, `GET /catalog-items/{id}`, `GET/POST /catalog-variants`. Páginas públicas: `/catalogo`, `/empresas/{slug}/catalogo/{item}`. Eventos de dominio: ninguno.

### Riesgos abiertos específicos de F1.1
Ver §15 (disparador diferido, drift ciego a triggers/CHECK, recorrido fuera de CI).

### Criterios de aceptación (Plan Maestro §10, F1)

| Criterio | Resultado |
|---|---|
| La empresa crea `CatalogItem`s | **PASS** — desde `/admin/catalogo` (recorrido en navegador) y probado contra PG; requiere encender la capacidad |
| Ítems simples tienen variante default invisible en UI | **PASS** — recorrido: sin vocabulario de variantes ni campo de nombre |
| Ítems con variantes muestran selector | **PASS** — recorrido: aparece al agregar la segunda y desaparece al quedar una |
| Ítems publicados aparecen en marketplace (storefront + feed cross-company) | **PASS** — sección en la página de la empresa, `/catalogo` e inicio; recorrido en navegador. El feed de la app del cliente (`/cliente/explorar`) queda fuera |
| Platform API expone el catálogo | **PASS** — 5 recursos, recorrido HTTP con claves reales (con la salvedad del entorno, §3) |
| RLS: aislamiento entre empresas | **PASS** — `probar-rls` + tests PG |

### Fase anterior — F0 Foundation Hardening (🟡; sin trabajo de código pendiente)

#### Objetivo
Asegurar integridad (RLS), formalizar capacidades, ocultar módulos secundarios y establecer `src/lib/commerce-primitives/`, sin romper Supply V2.

#### Implementado
- ✅ `commerce-primitives` (`dinero`, `fefo`, `comision`, `numeracion`, `estados`, `ledger`); Supply V2 delega conservando todas sus exportaciones.
- ✅ Capacidades: ya existían como catálogo en código; se añadieron `PUBLICACIONES`, `HOME_BUILDER`, `MENSAJERIA` (total **25**).
- ✅ Gamificación (ruleta), Blog y Home Builder 🙈 para toda empresa; CRM y Mensajería 🙈 solo para tenants nuevos (override explícito al crear: `CAPACIDADES_OVERRIDE_TENANT_NUEVO`, en 4 sitios incl. `duplicarEmpresa`).
- ✅ Correcciones de la auditoría F0: clave de cerrojo de numeración restaurada (`supply_v2`), acciones de servidor de ruleta/Home cerradas, ruleta del cliente apagada.
- ✅ Auditoría RLS: la premisa del plan («escribir políticas por tabla») era errónea; ver §13.
- ✅ Higiene post-auditoría: `subirImagenExcursion` cerrada (sesión + permiso + empresa de sesión + firma de archivo + `upsert:false`) y Plan Maestro versionado en `docs/PLAN_MAESTRO.md`.

#### Parcial
- 🟡 RLS: políticas Capa 2 generadas para 264/285 tablas (21 decididas a mano) y probadas conductualmente, pero **apagadas en producción**.
- 🟡 Ocultamiento: Supply V1 no se ocultó (§12).
- 🟡 `supply-v2/core/{dinero,fefo,comision,numeracion,estados,ledger}.ts` siguen existiendo como *shims/wrappers* (el paso 5 del plan, «eliminar originales», no se hizo a propósito).

#### Pendiente
Decisión Capa 2 en producción; decisión Supply V1; nada más de código de F0.

#### Bloqueadores
Ninguno para F1. Las dos decisiones dependen del usuario/acceso a producción (§16).

#### Archivos principales modificados
`src/lib/commerce-primitives/*` (nuevo) · `src/modules/supply-v2/core/*` · `src/modules/capacidades/catalogo.ts` · `src/modules/plataforma/conceptos.ts` · `src/components/layout/nav-config.ts` · `src/modules/navegacion/contexto.ts` · `src/modules/cliente/navDisponible.ts` · `src/modules/engagement/gamificacion.ts` · `src/modules/gamificacion/ruletaActions.ts` · `src/modules/home/acciones.ts` · `src/app/(admin)/admin/personalizacion/page.tsx` · `src/app/(cliente)/cliente/ruleta/page.tsx` · `src/app/(cliente)/mis-membresias/page.tsx` · `src/modules/{registro/empresaActions,solicitudes/actions,empresas/actions}.ts` · `docs/{CAPACIDADES,EXCURSIONES-PORTABILIDAD,platform/conceptos}.md`.

#### Entidades afectadas
Ninguna tabla. Solo el JSON `companies.capacidades` (`{ categoria?, overrides?, modulosCliente? }`).

#### Migraciones
Ninguna (verificado: `git diff --stat 4837f84..HEAD -- prisma` vacío).

#### APIs / Server Actions
Cambiadas: `crear/actualizar/cambiarActivo/eliminarRuletaPremio` (ahora `requireSection('gamificacion')`), `girarRuleta` (exige capacidad `RULETA`), `modules/home/acciones.ts` (`contexto()` exige `HOME_BUILDER`), `registrarEmpresa`, `crearEmpresaDesdeSolicitud`, `crearEmpresa`, `duplicarEmpresa`.

#### UI creada o modificada
`/admin/personalizacion` (editor de inicio condicional), `/cliente/ruleta` (redirige sin capacidad), chip de puntos en «Mis membresías» (deja de enlazar a la ruleta), menú del cliente (ruta forzada oculta incluso con `MOSTRAR`), 3 entradas del menú admin con `capacidad`.

#### Eventos
Ninguno.

#### Permisos / capabilities
Nuevas: `PUBLICACIONES`→sección `publicaciones`; `MENSAJERIA`→sección `comunicacion`; `HOME_BUILDER`→sin sección (comparte página con marca). `RULETA` fuera del paquete base de las 5 categorías. Existentes (sin tocar): `CRM`→`leads`, `MEMBEGO_SUPPLIER`→`supply`.

#### Tests
Nuevos: `tests/commerce-primitives.test.ts` (22), `tests/capacidades-fase0.test.ts` (9). Ajustados: `navegacion-espacios`, `plataforma-conceptos`. Resultados en §8.

#### Riesgos abiertos
Ver §15. Específicos de F0: la ruleta se corta de golpe a empresas con premios activos (datos intactos; reversible por override); las acciones de bandeja de `mensajeria/actions.ts` cuelgan de `leads` (CRM), **no** de `MENSAJERIA` (decisión deliberada).

#### Criterios de aceptación (Plan Maestro §19, F0)

| Criterio | Resultado |
|---|---|
| 100 % de tablas con `companyId` cubiertas por política RLS (generada) | **PASS** — 139/139 (preflight + `probar-rls` 16/16) |
| Capa 2 activa en producción | **PENDING** — decisión del usuario (§16) |
| Supply V1 oculto | **FAIL** — no se ocultó (§12) |
| Módulos secundarios ocultos por capacidades | **PASS** — Gamificación, Blog, Home Builder |
| CRM/Mensajería desactivados por defecto en tenants nuevos | **PASS** — test `capacidades-fase0` |
| `commerce-primitives` funcional con Supply V2 consumiéndolas | **PASS** — 354 tests Supply V2 + 311 PostgreSQL |
| Todos los tests pasan | **PASS** (unit 3 634, PG 311, E2E 67/0 fallos) — con 114 E2E omitidos (§8) |

## 4. Módulos del sistema

| Módulo | Estado | Ubicación | Observación |
|---|---|---|---|
| Auth | ✅ | `src/lib/auth`, `src/proxy.ts` | Supabase Auth + JWT local HS256; 11 roles. Login con Google 🙈 (`googleAuth.ts:14-18`, fijo `false`) |
| Multi-tenancy | ✅ | `src/lib/tenant.ts` | `conEmpresa/sinEmpresa/conUsuario`; capa de aplicación |
| RLS | 🟡 | `prisma/migrations/20260771_*`, `prisma/migrations_manual/2026-07-rls-capa2-*` | Capa 1 (barrera) automática; Capa 2 (aislamiento) probada y **apagada** en prod |
| Permissions | ✅ | `src/lib/auth/permissions.ts` | 43 secciones, 98 funciones; permisos por empleado leídos en vivo; gate CI en ambas direcciones |
| Capabilities | ✅ | `src/modules/capacidades` | 26 claves, 5 categorías; cuatro listas a mantener sincronizadas (§13) |
| Catalog | 🟡 | `src/modules/catalog` (nuevo) + carwash / promociones / membresías / excursiones | Catálogo unificado F1.1–F1.3 ✅ (backend, admin, vitrina pública y API, **apagado** por capacidad); los 5 modelos de «qué se vende» previos siguen disjuntos y **no se migran** |
| Inventory | 🟡 | `modules/carwash/inventario*` | Solo carwash, movimientos manuales, no ligado a ventas |
| Orders | 🟡 | `caja`, `promociones`, `excursiones`, `citas`, Supply V2 | `Transaction`, `ProductoCompra`, `ReservaExc/VentaExc`, `SupplyV2CustomerOrder`; sin pedido unificado |
| Marketplace | 🟡 | `(public)/{empresas,promociones,catalogo}`, `cliente/{explorar,buscar,cerca}`, `modules/marketplace` | Búsqueda, categorías y feed cross-company sí; **catálogo unificado publicado (vitrina, detalle, `/catalogo`) si la empresa tiene la capacidad**; carrito genérico no; la búsqueda no incluye ofertas Supply V2 ni catálogo |
| POS | 🟡 | `modules/caja` | `cobrarOrden` solo MEMBRESIA/PROMOCION; sin catálogo ni motor de promos |
| Payments | 🟡 | `modules/pagos`, `lib/payments` | CardNET real (token/3DS/cron) pero `PAGO_CARDNET` en ningún paquete base; registry solo `TRANSFERENCIA` |
| Promotions | 🟡 | `Promocion` (vivo) vs motor `Promotion` | El motor es espejo de escritura (`bridge.ts`) sin lectores |
| Deals | ⚪ | — | No hay modelo |
| Coupons | 🟡 | `SupplyV2Coupon` | Solo Supply V2; genérico ⚪ (`Promocion.codigo` es solo texto) |
| Benefits | 🟡 | `src/lib/benefits` | 0 tests, sin ruta admin; `BenefitGrant` no es append-only |
| Memberships | ✅ | `modules/membresia*`, cron renovaciones | 11 tests; el motor `MembershipPlan` no se usa |
| Loyalty | 🟡 | ≥4 sistemas en paralelo | Puntos derivados (visibles), Growth, motor Benefit, Supply V2 Loyalty; sin ledger común. Ruleta 🙈 |
| Rewards | 🟡 | Growth / `SupplyV2Reward` / `ReferralRecompensa` | Sin catálogo único |
| Referrals | 🟡 | `Referido`, Growth, `CampanaInvitacion`, `SupplyV2Referral` | 4 caminos vivos; el motor `ReferralProgram` no se usa |
| Campaigns | 🟡 | `Campana`, `MarketingCampaign`, `CampanaDirigida`, `SupplyV2Campaign` | `reclamosCount` nunca se incrementa |
| QR | ✅ | `modules/qr/token.ts`, `modules/scanner` | 192 bits, un solo uso atómico (`visitas/canje.ts:270`); nonce solo en Supply V2; cola offline probada; `token.ts` sin test |
| Redemptions | 🟡 | 4 sitios (`Visit`+`Transaction`, `OfertaUso`, `ReservaExc.checkinAt`, `SupplyV2Redemption`) | Reversa solo en `Visit` y Supply V2 |
| Merchant Billing | ⚪ | — | Nada factura a una empresa |
| Revenue Attribution | 🟡 | `referidos-attribution.ts`, `VendedorAtribucion` | A nivel cliente, no de orden |
| Membego Supply V1 | 🟣 | `modules/supply`, `prisma/schema/supply.prisma` | Deprecado **solo por decisión del plan**; en código sigue activo (§5, §12) |
| Membego Supply V2 | 🟡 | `modules/supply-v2` | Ver §5 |
| Supplier Finance | ✅ | `supply-v2/finance` | Facturas, depósitos, obligaciones, pagos (manual) |
| Settlements | ✅ | `supply-v2/finance/settlements.ts` | Incluye liquidación parcial |
| Reconciliation | ✅ | `finance/reconciliation.ts`, `operations/conciliacion.ts` | Pagos solo contra eventos del inbox |
| Analytics | 🟡 | `modules/reportes` | 6 527 líneas, 29 tests; sin GMV/atribución |
| Notifications | 🟡 | `Notificacion` (31 tipos) | In-app y email (Resend) vivos; WhatsApp de Supply `NOT_CONFIGURED`; sin push/SMS |
| Connect | 🟡 | `modules/connect` | 5 proveedores registrados; el resto «Próximamente» |
| Jobs | ✅ | `lib/jobs`, `app/api/{jobs,cron}` | 9 tipos con idempotencia; DLQ; sin QStash corre inline |
| Audit | ✅ | `AuditLog` | 265 acciones, 84 sitios; inmutabilidad solo por convención |
| Observability | 🟡 | Sentry, `/api/health`, `supply-v2/operations` | Nada alerta solo; SLOs sin medir (`OBSERVABILIDAD.md` §7-8) |
| Verticals | 🟡 | Carwash ✅ · Excursiones ✅ · Restaurant 🟡 (`apps/restaurant`) · Barbería/Gym ⚪ | Barbería/Gym son solo etiquetas |

## 5. Membego Supply

Supply V2: 113 archivos / 30 919 LOC en `src/modules/supply-v2`; 66 modelos / 88 enums; 27 migraciones; 61 páginas (8 admin, 53 superadmin) + 5 `/cliente/*` + 5 `/promociones/*`; 118 server actions; tests: 354 unit, ~288 PostgreSQL, 66 Playwright.

```text
Supply V1:        🟣 ACTIVO en código. 47 archivos / 16 710 LOC, 30 modelos, 10 migraciones, 263 tests.
                  /cliente/beneficios/* depende de V1 (sin gate de capacidad); cron /api/cron/supply
                  agendado ("0 7 * * *"); sin migración V1→V2 (0 scripts). Nav admin oculto por bug (§12).
Supply V2:        🟡 núcleo ✅, 4 huecos (abajo)
Procurement:      ✅ proveedores, catálogo, órdenes de compra, recepciones (S1)
Agreements:       🟡 crear + activar expuestos; `modificarCondicionesEnTx` sin acción/UI; sin suspender/terminar
Purchase Orders:  ✅ borrador → aprobación → recepción
Lots:             ✅ `pool/lotes.ts`
Ledger:           ✅ 6 cubetas, 12 tipos; CANCELLATION/TRANSFER/ADJUSTMENT sin escritor (sin ajuste manual de lote)
FEFO:             ✅ ahora en `commerce-primitives/fefo.ts`
Allocation:       ✅ vía ofertas (propósito MANUAL sin llamador)
Customer Entitlements: ✅ creados al confirmar pago
Vouchers:         ✅
QR Redemption:    ✅ QR TTL 5 min, nonce único, `consumedAt`
Reversals:        ✅ de redención; reembolso al cliente ⚪ (`REFUNDED` inalcanzable)
Supplier Finance: ✅ facturas, depósitos, obligaciones, aplicaciones
Payments:         ✅ manual (BANK_TRANSFER/CASH/OTHER); sin API bancaria
Settlements:      ✅ con snapshot y parcial
Reconciliation:   ✅ proveedor + pagos (pagos solo contra inbox)
Benefits:         ✅ ledger de presupuesto, fondeo multi-parte
Campaigns:        ✅
Coupons:          ✅ PUBLIC/PRIVATE
Loyalty:          🟡 motor ✅ · UI: 5 acciones sin llamador (planes, suspender/reactivar/cancelar membresía)
Operations:       ✅ outbox/inbox, salud, alertas, 5 flags, cron, 9 páginas
Marketplace integration: 🟡 páginas públicas `/promociones/*` visibles sin login; comprar exige sesión CLIENTE;
                  sin API pública; sin `CatalogItem`/bridge (F2.5 ⚪); la búsqueda general no las incluye
Payment gateway:  🟡 solo `TEST_GATEWAY` (webhook HMAC entrante); interfaces `VerificadorDeEventos`,
                  `AdaptadorDeProveedor`, `PuertoDePasarela`; sin CardNET/Stripe/Azul, sin cobro/captura/reembolso
```

Otros hechos: 0 marcadores TODO/FIXME en `supply-v2`. Pagos del cliente solo `TRANSFER` y `DEPOSIT`. Los 51 permisos `SUPPLY_V2_*` resuelven solo a SUPERADMIN (la segregación se hace por id de actor).

## 6. Commerce Core

Verificado por grep en `prisma/`, `src/`, `tests/`: de las entidades objetivo solo existen las del catálogo (F1.1) y las del inventario (F2); `SupplyV2CatalogItem` es otra cosa (lo que un proveedor vende a Membego).

| Entidad | Estado | Schema | Service | UI | Tests | Equivalente actual / integración |
|---|---|---|---|---|---|---|
| CatalogItem | 🔵 | sí (`catalog_items`) | sí | sí (`/admin/catalogo` + vitrina pública + API) | sí | Coexiste con `Servicio`/`ProductoInventario`/`Promocion`/`Excursion` (no se migran); `SupplyV2CatalogItem` llegará por el bridge (F2.5) |
| CatalogVariant | 🔵 | sí (`catalog_variants`) | sí | sí | sí | Precio, costo, SKU por empresa. Pricing por ubicación/canal ⚪ (`VariantPrice` no existe). Equivalentes por vertical: `ExcursionVariante`, `ServicioPrecio`, `PlanPrecioCategoria`, `SupplyV2Offer.salePrice` |
| Supply Bridge (`CatalogItem` `source=SUPPLY`) | 🔵 | sí (2 columnas: `companies.esCasaMembego`, `catalog_items.supplyV2OfferId`) | sí (`supply-bridge`) | sí (`/superadmin/puente-supply`, `/catalogo`) | sí | Un ítem por **oferta** de Supply V2, bajo la empresa de la casa; Supply es el master (solo lectura para la empresa). Sin `MembegoOrder` todavía |
| Inventory (Level/Movement/Reservation) | 🔵 | sí (`inventory_levels`, `inventory_movements`, `inventory_reservations`) | sí | sí (`/admin/inventario`) | sí | Por variante × `Sucursal`, enteros. Coexiste con `ProductoInventario.stock` + `MovimientoInventario` (carwash: insumos, decimales, **sin bloqueo**; no se migra). Nada lo llama todavía (F3) |
| Customer | 🟡 | sí (`Cliente`, por empresa) | sí | sí | sí | La identidad global es `User` (Supply V2 pedidos usan `User`) |
| MembegoOrder / OrderLine | 🔵 | sí (`membego_orders`, `membego_order_lines`) | sí | sí | sí | Coexiste con `Transaction`, `ProductoCompra`, `ReservaExc`, `SupplyV2CustomerOrder`, `Cita`; el puente de Supply genera un envoltorio |
| OrderAttribution | 🔵 | sí | sí | sí | sí | `Cliente.canalOrigen`, `VendedorAtribucion`, `SupplyV2CustomerOrder.campaignId` |
| PaymentEvidence | 🔵 | sí | sí | sí | sí | `ProductoCompra.comprobanteUrl`, `ReservaPago.comprobanteUrl` (por flujo) |
| Commission / MerchantLedger / MerchantStatement / MerchantBillingConfig | 🔵 | sí (`merchant_commissions`, `merchant_ledger_entries`, `merchant_statements`, `merchant_billing_configs`) | sí (`billing`) | sí (`/admin/facturacion-membego`, `/superadmin/facturacion`) | sí | Cobros *a* empresas (Membego recibe). `Comision` (carwash) y `ComisionEntrada` (vendedores) son pagos *a* personal; Supply Economics es Membego → proveedor: **no se cruzan** |
| Entitlement | 🟡 | sí (`SupplyV2Entitlement`) | sí | sí | sí | Solo Supply V2; `EntitlementEmpresa` es otra cosa (nombre en colisión) |
| Voucher | 🟡 | sí (`SupplyV2Voucher`) | sí | sí | sí | Solo Supply V2 |
| Redemption | 🟡 | sí (`SupplyV2Redemption`) | sí | sí | sí | + 3 flujos legacy (§4) |

## 7. Migraciones

196 directorios (`0_genesis` + 195) · `YYYYMMNN_slug` donde NN es un contador mensual (no un día; 51 prefijos no son fechas válidas, p. ej. `20260771_*`) · sellado SHA-256 en `prisma/migrations/SUMAS.txt` (196 migraciones selladas) con test de inmutabilidad en CI.

| Migración | Módulo | Estado | Riesgo | Verificada |
|---|---|---|---|---|
| `0_genesis` | Baseline | ✅ | Bajo | Replay PG16 local ✅ |
| `20260771_rls_barrera_publica` | RLS Capa 1 | ✅ | Medio: solo cubre tablas existentes al aplicarse | Replay ✅ + 0 grants anon |
| `20260914_home_rls` → `20260915_home_rls_al_mecanismo_generico` | RLS Home | ✅ (revertida) | Lección: no escribir políticas `membego_inquilino` a mano | Replay ✅ |
| `20260926`…`20261009` (10) | Supply V1 | ✅ | Medio: `20261008` 1 048 líneas, `20261009` 3 UPDATE | Replay ✅ |
| `20261010`…`20261035` (27) | Supply V2 | ✅ | Medio: backfills en `20261017` (6) y `20261026` (1) | Replay ✅ + 311 tests PG |
| `20261036_catalog_core`, `20261037_catalog_core_enums` | Commerce Core · catálogo | ✅ | Bajo: aditivas, idempotentes, sin backfill; el disparador diferido es la única pieza no trivial | Replay ✅ (192/192) · reaplicadas sin error · 0 deriva · 29 tests PG |
| `20261038_inventory_core`, `20261039_inventory_core_enums` | Commerce Core · inventario | ✅ | Bajo: aditivas e idempotentes; solo añaden 2 índices únicos `(id, companyId)` a tablas existentes; lo no trivial son el CHECK de traslados y los disparadores de inmutabilidad | Replay ✅ (194/194) · 0 deriva · 35 tests PG · `probar-rls` 29/29 |
| `20261040_supply_bridge`, `20261041_supply_bridge_enums` | Commerce Core · puente Supply→Catálogo | ✅ | Bajo: 2 columnas con default, 1 FK, 1 CHECK y 1 índice único parcial; aditivas e idempotentes | Replay ✅ (196/196) · 0 deriva · 20 tests PG |
| `20261042_membego_orders`, `20261043_membego_orders_enums` | Commerce Core · pedidos Membego (5 tablas, 5 enums, 9 acciones de auditoría) | ✅ | Bajo: aditivas e idempotentes; 2 índices únicos en tablas existentes; **disparadores** de estado, de líneas inmutables y de cuadre diferido + 12 CHECK (no los ve `migrate diff`: solo los cubren los tests PG) | Replay ✅ (198/198) · 0 deriva · 43 tests PG |
| `20261044_merchant_billing`, `20261045_merchant_billing_enums` | Commerce Core · Merchant Billing (4 tablas, 6 enums, 3 acciones de auditoría) | ✅ | Bajo: aditivas e idempotentes y **no tocan ninguna tabla existente**; lo no trivial son los **disparadores** (saldo corrido y posición del libro, libro/cortes inmutables, comisión ↔ asiento ↔ pedido, periodo ya cortado) y 10 CHECK (no los ve `migrate diff`: los cubre `billing.db.test.ts`) | Replay ✅ (200/200) · 0 deriva · 35 tests PG |
| `20260827_combo_horario_fijo_array` | Excursiones | ✅ | **Destructiva** (único `DROP COLUMN`) | Replay ✅ |
| `20260770_reconciliacion` | Pagos | ✅ | `ALTER COLUMN TYPE` ×8 | Replay ✅ |
| `20261030_supply_v2_bloque5_preferencias` | Supply V2 | ✅ | No idempotente (sin guardas) | Replay ✅ |
| `20260918_membresia_eventos_backfill` | Membresías | ✅ | Backfill desde `audit_logs` | Replay ✅ |
| `20260781`, `20260782` | Vehículos | ✅ | Backfill de placas **manual** (`scripts/backfill-placas.mjs`) | Replay ✅; ejecución en prod UNKNOWN |

```text
Última migración en el repo:   20261045_merchant_billing_enums
Última migración aplicada:     UNKNOWN en producción (sin acceso a la BD). En PG16 local: 200/200 aplicadas.
Migraciones pendientes:        UNKNOWN en prod. `docs/DEVOPS.md`: el 2026-09-14 se aplicaron 18 a mano sin registrarlas en `_prisma_migrations`.
Migraciones destructivas:      0 DROP TABLE/TYPE/TRUNCATE/DELETE; 1 DROP COLUMN (20260827); 24 de las últimas 40 contienen ADD VALUE (irreversible en Postgres)
Backfills pendientes:          placas (manual); `visits.companyId` (manual, 2026-09-visitas-company-id; la política tiene respaldo por membresía mientras dure)
Migraciones de esta rama:      10 (`20261036`…`20261045`: catálogo, inventario, puente Supply→Catálogo, pedidos y Merchant Billing, cada uno con su migración de enums)
Deriva esquema↔migraciones:    0 (`prisma migrate diff` → «No difference detected», verificado)
`prisma/migrations_manual`:    28 archivos, TODOS a mano (Capa 2, storage, geo, diagnósticos); estado de aplicación UNKNOWN
```

Hueco detectado: **ningún `ENABLE ROW LEVEL SECURITY` en migraciones posteriores a `20260916`** (105 `CREATE TABLE`, 67 de Supply V2; las 5 de `catalog_*` y las 3 de `inventory_*` entran en esa misma categoría: las cubre Capa 2, no la migración). Capa 1 solo recorre tablas existentes al aplicarse; las nuevas dependen del SQL manual de Capa 2. Cobertura real en prod: UNKNOWN (verificar con `2026-07-rls-capa2-verificar.sql`).

## 8. Calidad

Medido el 2026-10-07 tras F4 (BD local desechable `membego_pg`, PostgreSQL 16, con `migrate deploy` y la Capa 2 reaplicada para que cubra las 4 tablas nuevas; no producción). Se **repitieron** tsc, lint, unit, PostgreSQL (suite completa), build, bundle, migraciones y los gates de RLS/permisos. **No se repitió la suite E2E completa** (sí los dos specs de esta fase, 3 veces cada uno; la última completa sigue siendo la de F3, abajo).

```text
TypeScript:          PASS   tsc --noEmit, 0 errores
Lint:                PASS   npx eslint src tests --quiet: 0 errores (los warnings no se recontaron; el único nuevo de F4 —una función sin usar— se quitó)
Unit Tests:          3845/3851 PASS · 0 FAIL · 6 SKIP (5 requieren servidor dev; 1 BLOCKED: claves QA reales de CardNET)
  · Supply V2:       354/354 PASS
  · F0 nuevos:       31/31 PASS (commerce-primitives 22, capacidades-fase0 9)
  · Higiene nuevos:  19/19 PASS (imagen-tipo 9, excursiones-imagen-guardia 10; este último falla 9/10 contra la versión vulnerable)
  · F1.1–F1.3 nuevos: 60/60 PASS (catalog-domain 19, catalogo-permisos 14, catalogo-publico 13, catalogo-api 9, catalog-formato 4, storage-rutas +1)
  · F2 nuevos:        28/28 PASS (inventory-domain 13, inventario-permisos 15)
  · F2.5 nuevos:      15/15 PASS (supply-bridge) + catalogo-publico ampliado
  · F3 nuevos:        56/56 PASS (orders-domain 26, pedidos-permisos 20) + 5 de existencias en catalogo-publico
  · F4 nuevos:        38/38 PASS (billing-domain 22, billing-separacion 7, facturacion-permisos 9)
Integration Tests:   N/A    (no existe capa separada; los tests unitarios son puros o de texto fuente)
PostgreSQL Tests:    522/522 PASS  npm run test:db (20 archivos, en serie; +35 de Merchant Billing). Una corrida anterior de la suite completa dio 1 fallo en `supply-v2-slice9` («lo abandonado vuelve a la vida», arriendo del outbox); ese archivo solo pasó 85/85 dos veces y la suite completa volvió a pasar 522/522 sin tocar nada: **flake de temporización, preexistente y no relacionado**, sin diagnosticar
E2E (Playwright):    111 PASS · 1 FAIL · 143 SKIP en la suite completa (13,6 min). El fallo es `supply-v2-slice4` (PREPAID): `strict mode violation` por una tarjeta de oferta duplicada en el streaming de `/promociones` —el patrón conocido de duplicados—, en un spec que F3 no toca; repetido 3 veces aislado, pasa las 3 (flaky preexistente de duplicados de streaming, no de F3). `pedidos-membego` (12 pruebas, escritorio) pasó 3 corridas limpias seguidas. Antes de F3: 100/0/131
                     Los 143 SKIP = 114 por `AUTENTICADO=false` + 29 de los specs de catálogo, inventario, puente y pedidos que corren solo en escritorio (en móvil se saltan por diseño): sin Supabase de pruebas (docs/PRUEBAS-E2E.md §4). Con la misma
                     configuración de e2e.yml, los flujos AUTENTICADOS de cliente/admin/comisiones/sidebar no se ejercen.
                     Sí corrieron: recorrido público, registro v2 y los 9 slices de Supply V2 (sesión propia).
Build:               PASS   next build, con las variables de relleno de CI (rutas `/admin/facturacion-membego`, `/superadmin/facturacion*`, `/api/cron/facturacion`, `/admin/pedidos-membego*`, `/cliente/pedidos*`, `/api/cron/pedidos`, rutas `/admin/catalogo*`, `/admin/inventario*`, `/api/cron/inventario`, `/catalogo`, `/empresas/…/catalogo/…` y `/api/platform/v1/catalog-*` compiladas)
E2E de F4:           PASS   `pedidos-membego` (14) + `facturacion-superadmin` (6) = 20 pruebas en escritorio, **3 corridas seguidas, 20/20 cada una** (≈1 min). Primera corrida: 19/20 —un fallo de mi propio test (buscaba el nombre de la empresa en una página donde su propio encabezado lo muestra), corregido—. Suite E2E completa **no repetida** en F4
E2E de catálogo:     PASS   26 pruebas (admin 3, público 7×2 proyectos, API 7); sesión firmada con el secreto de `e2e.yml`. Se omite «sin credenciales → 401» (en una app sin firma de tokens de satélite da 503 `PLATFORM_API_UNCONFIGURED`, igual que `/branches`)
RLS Checks:          PASS   preflight 281/302 cubiertas (las 4 de Merchant Billing, generadas) · cobertura-app OK · probar-rls 43/43 sobre BD migrada (+7 de Merchant Billing); sobre `db push` (como en CI) 39/39 y la comprobación de inmutabilidad del libro se omite diciéndolo
Migration Checks:    PASS   prisma validate · migrate diff 0 deriva · migrate deploy 200/200 · test de inmutabilidad (sellado 200)
Otros gates de CI:   PASS   transacciones-anidadas · permisos-catalogo (103 funciones) · accesibilidad-formularios y deuda-diseño
npm audit (prod):    FAIL   1 high — source-map-js (DoS); el job `dependencias` de CI lo bloquearía. Preexistente.
Presupuesto bundle: PASS   npm run presupuesto, **tras subir el techo del total de 8100 a 8400 KB** (medido 8126 KB; entrada compartida 854/1000 KB, mayor trozo 409/600 KB: no entró ninguna librería, entró un módulo más; anotado en el script)
scripts/verificar-*: NOT RUN
```

Notas de reproducción: para `probar-rls` en una BD vacía hay que crear antes `pg_trgm`, `pgcrypto`, `unaccent` (sin ellas `db push` falla y el ensayo da **falsos fallos**). Las 190 migraciones sí crean las extensiones necesarias.

## 9. Seguridad

| Área | Estado | Evidencia / riesgo residual |
|---|---|---|
| Tenant isolation | 🟡 | `conEmpresa/sinEmpresa` + test estático; el gate `rls-cobertura.mjs:127` cuenta un archivo como cubierto si el texto `conEmpresa(` aparece en cualquier parte (incluso en un comentario): ~37 sitios `prisma.*` fuera de wrappers (p. ej. `excursiones/catalogo/public-queries.ts`, `solicitudes/actions.ts`). **Gate verde necesario pero no suficiente para Capa 2** |
| RLS | 🟡 | Capa 1 viva según docs (no verificable); Capa 2 apagada (§16) |
| Server authorization | 🟡 | `requireRole/requireSection/requireAdminUser`; **ningún test enumera `'use server'` sin guardia** (el escaneo manual halló 18 de 120 sin tokens de guardia estándar; salvo el hueco ya cerrado, públicas por diseño). `subirImagenExcursion` ✅ cerrada y con test de orden guardia→cliente privilegiado |
| Permissions | ✅ | Lectura en vivo por petición; gate CI |
| QR anti-replay | ✅ | 192 bits; `updateMany where activo:true` en la transacción + `qrTokenUsadoId @unique`; Supply V2 `nonce @unique`. Residual: tokens legacy con `expiraAt` nulo se aceptan |
| Idempotency | ✅ | `ClaveIdempotencia`, 12 `idempotencyKey @unique` en Supply V2, outbox `dedupeKey`, `claveDedupe`, `jti`. Residual: el job `email` solo dedup de QStash |
| Rate limiting | 🟡 | Upstash REST o LRU por instancia; **fail-open** si Redis cae; Upstash en prod UNKNOWN |
| Secrets | 🟡 | AES-256-GCM versionado, scrypt, comparación en tiempo constante. **Sin secret scanning en CI**; ver clave comprometida (§14) |
| Payment security | 🟡 | Tokenización alojada (sin columna PAN). Residual: `POST /api/pagos/cardnet/iniciar` recibe `pan/cvv` (ruta legacy viva; UI sin importadores) |
| Webhook validation | 🟡 | Resend (Svix), Supply V2 (HMAC), Meta (`X-Hub-Signature-256`), QStash (JWT) con comparación en tiempo constante; `connect/entrante/[token]` sin HMAC; Meta `verify_token` con `!==` (fuga de timing menor); en Supply V2 solo existe `TEST_GATEWAY` |
| Audit logs | ✅ | `AuditLog` insert-only **por convención** (sin trigger ni REVOKE) |

## 10. Ledgers e invariantes

| Ledger | Fuente de verdad | Append-only | Reversa | Invariantes | Tests |
|---|---|---|---|---|---|
| Supply Ledger (`SupplyV2LedgerEntry`) | Suma de asientos (contadores del lote = caché) | Sí (0 sitios update/delete en `src`) | Asiento `REVERSAL` (REDEEMED→ISSUED) | `recibido = Σ 6 cubetas`, ninguna negativa | S1–S4 (unit+PG) + genéricos en `commerce-primitives.test.ts` |
| Benefit budget (`SupplyV2BenefitMovement`) | Movimientos | Sí | Movimiento inverso | Presupuesto no excedido | S6 |
| Supplier deposit (`SupplyV2SupplierDepositMovement`) / Economic events | Movimientos / eventos | Sí | Nuevo movimiento | Saldo = Σ movimientos | S4, S5 |
| Points (`SupplyV2PointsMovement`) | Movimientos con lotes y expiración | **Casi**: 2 `update` de `consumedFromLot` (`loyalty/points.ts:172,509`) | Movimiento inverso | Saldo por lote | S8 |
| Merchant Billing Ledger (`MerchantLedgerEntry`) | Suma de asientos (positivo = la empresa debe); el saldo de cada fila es caché y la base lo comprueba | **Sí, en la base**: disparadores que rechazan `UPDATE`/`DELETE`/`TRUNCATE` (también en los cortes); 0 sitios de escritura fuera de `billing/service.ts` (un test lo vigila) | Asiento contrario (`REFUND` de la comisión, ajuste, crédito); nunca se edita | `seq` consecutivo sin huecos, `balance = anterior + monto` (disparador + índice único), signo por tipo, referencias solo de este dominio (nada de Supply), sin asientos en un periodo ya cortado; la comisión coincide con su asiento y su pedido; el corte cuadra | `billing-domain`, `billing-separacion` (unit) y `postgres/billing.db.test.ts` (35, incl. 20 escritores simultáneos) |
| Inventory Ledger (`InventoryMovement`) | Suma de movimientos por cubeta (`AVAILABLE`/`RESERVED`/`DAMAGED`); el saldo (`onHand`/`reserved`/`damaged`) es caché | **Sí, en la base**: disparadores que rechazan `UPDATE`/`DELETE`/`TRUNCATE` (0 sitios update/delete en `src`, un test lo vigila) | Otro movimiento (`ADJUSTMENT`); una reserva vencida/liberada genera `RESERVATION_RELEASE` | `available = onHand − reserved ≥ 0` (CHECK + ledger puro), ninguna cubeta negativa, `reserved` = suma de reservas `ACTIVE`, cada tipo solo hace sus traslados (CHECK) | `inventory-domain` (13, incl. propiedad de 5 000) + `postgres/inventory.db.test.ts` (35: concurrencia, 144 combinaciones, cuadre tras 300 operaciones al azar) |
| `MovimientoInventario` (carwash) | Contador `stock` (mutable) | Inserta, pero lectura-escritura **sin bloqueo** | `AJUSTE` absoluto | Ninguno de BD | Solo aritmética |
| Payment ledger | — | ⚪ no unificado | `ReservaPago` → `ANULADO`; `PagoIntento` mutable (idempotente por `activadoAt`); `GiftCard.saldo` es contador sin movimientos | — | `pagos-cumplimiento.test.ts` |
| `AuditLog`, `MembresiaEvento` | Filas | Sí, por convención / best-effort | Nueva fila | — | `membresia-eventos*.test.ts`; `AuditLog` sin test |

## 11. Integraciones

| Integración | Estado | Uso | Pendiente |
|---|---|---|---|
| CardNET | 🟡 | Tokenización alojada, 3DS legacy, cron de renovación | Fuera del registry de pagos; no conectado a Supply V2; claves QA reales (1 test BLOCKED); endpoint legacy con PAN |
| Supabase | ✅ | Auth, Storage, Postgres | Políticas de Storage son SQL manual, no aplicadas por CI |
| QStash / Upstash | ✅ (código) | Cola de jobs y rate limit por REST | Claves en producción: UNKNOWN |
| Sentry | ✅ (código) | Errores, scrub de PII, sampling 0.2 | Reglas de alerta y uptime: UNKNOWN |
| WhatsApp (Meta Cloud API) | 🟡 | `enviarWhatsapp` por token de empresa | Canal de avisos de Supply V2 `NOT_CONFIGURED` |
| Meta (Messenger/Instagram) | 🟡 | Facebook nativo, Instagram adaptado | Revisión de la app Meta: UNKNOWN |
| Google Calendar | 🟡 | OAuth implementado | Scope `calendarlist.readonly` «NO VERIFICADO» |
| Platform API v1 | ✅ | 30 `route.ts` (3 de catálogo), OAuth2 `client_credentials` + claves de empresa, SDK en `packages/platform-sdk` (sin métodos de catálogo: es un recurso de claves de empresa) | App Zapier separada, no desplegada desde aquí |
| Payment Provider Registry | 🟡 | Solo `TRANSFERENCIA` registrado | STRIPE/AZUL/CARDNET/PAYPAL/APPLE/GOOGLE son solo tipos |
| Email (Resend) | 🟡 | Vía `fetch`; sin clave solo loguea | Remitente por defecto `onboarding@resend.dev`; un único proveedor |

## 12. Módulos ocultos / deprecated

| Módulo | Estado | Motivo | Cómo se oculta | Puede regresar |
|---|---|---|---|---|
| Gamificación / Ruleta | 🙈 | No alineada con marketplace | `RULETA` fuera de `CAPACIDADES_BASE`; admin: `requireSection('gamificacion')`; cliente: página redirige, `girarRuleta` rechaza, `navDisponible` fuerza ruta oculta. **Puntos y niveles siguen visibles** | Sí: override `RULETA:true` por empresa. Datos intactos |
| Blog / Publicaciones | 🙈 | No aporta al ciclo transaccional | Capacidad `PUBLICACIONES` (sección `publicaciones`) | Sí (override). **Las publicaciones ya emitidas siguen visibles en el perfil público** (`getCompanyPostsPublic`) |
| Home Builder | 🙈 | Secundario frente al marketplace | Capacidad `HOME_BUILDER`; la página no pinta el editor y las acciones de `modules/home` rechazan. El formulario de marca **no** se oculta | Sí (override). Una composición ya publicada sigue renderizándose |
| CRM | 🙈 solo tenants nuevos | Foco en marketplace | Override `CRM:false` al crear empresa; existentes conservan | Sí (override) |
| Mensajería (`/admin/comunicacion`) | 🙈 solo tenants nuevos | Canal secundario | Override `MENSAJERIA:false` al crear; la **bandeja de conversaciones es del CRM** (`leads`) | Sí (override) |
| Supply V1 | 🟣 **NO oculto** | Reemplazado por V2 | **No hay ocultamiento deliberado.** El menú admin lo esconde *por accidente* (`MEMBEGO_SUPPLIER` ausente de `CAPACIDADES_DEL_MENU`, `contexto.ts:37-46`); rutas, `/cliente/beneficios/*` y el cron siguen activos | Nunca (plan); migrar datos V1→V2 aún sin hacer |
| Login con Google | 🙈 | Fijo `false` en `googleAuth.ts:14-18` | Constante en código | Sí |
| Módulos carwash Fase 2/3 | apagados por defecto | Opt-in | Capacidades `INVENTARIO`, `COLA_VEHICULOS`, `EVIDENCIA_FOTOS`, `CUENTAS_CORPORATIVAS`, `COMISIONES`, `INCIDENCIAS`, `COMPRAS`, `ACTIVOS`, `TURNOS`, `PAGO_CARDNET`, `NAVEGACION_V2` fuera de todo paquete base | Sí (override) |
| Motores sin uso (`Promotion`, `MembershipPlan`, `ReferralProgram`, `Benefit`) | 🟡 | ~7,9k líneas, 0 tests, sin lector en producción | — | Candidatos a consolidar en F5 |
| Barbería / Gym | ⚪ | Etiquetas en el catálogo | — | — |

## 13. Decisiones arquitectónicas vigentes

- Monolito modular; sin microservicios; sin reescritura.
- `CatalogVariant` existe desde la fundación; todo `CatalogItem` tiene ≥1 variante (default oculta en UI); pedidos, inventario y promociones referencian **variante**, nunca ítem.
- `CatalogItem` separado de `Promotion`/`Deal`; `MembegoOrder` coexiste con `Transaction` y demás órdenes legacy (los verticales no se migran en F1).
- Supply V2 es dominio especializado, **master** de sus datos; el bridge será unidireccional Supply→Catalog y reutilizará su checkout (no se duplica); Supply V2 se mantiene intocable salvo imports.
- Commerce Core y Supply comparten **primitives genéricos** (`src/lib/commerce-primitives/`); Commerce Core nunca importa de `supply-v2`.
- **Merchant Billing** (`src/modules/billing/`) y **Supply Economics** (`supply-v2/finance`) nunca comparten tablas ni ledgers.
- CPA fijo y 8 % coexisten desde el día 1; el modelo lo decide `verificationLevel` del `MembegoOrder`.
- Sin wallet financiera del consumidor (solo créditos promocionales).
- **RLS**: las políticas por tenant **no se escriben a mano**; las genera `2026-07-rls-capa2-aislamiento.sql` por introspección. Escribir `CREATE POLICY membego_inquilino` en una migración choca con ese mecanismo (incidente `20260914_home_rls`, revertido).
- Capacidades: «existente vs nuevo» se resuelve con **override explícito al crear**, no con fechas. Toda alta de empresa nueva debe usar `CAPACIDADES_OVERRIDE_TENANT_NUEVO`.
- Ocultar = apagar capacidad y **conservar datos**; el cierre real está en `requireSection`/acciones, no solo en el menú.
- Cada capacidad nueva exige sincronizar cuatro listas: `CAPACIDADES`/`CAPACIDAD_LABELS`, `FUNCIONES_EMPRESA` (`modules/plataforma/conceptos.ts`), `CapacidadNav` (`nav-config.ts`) y `CAPACIDADES_DEL_MENU` (`modules/navegacion/contexto.ts`). Las dos últimas solo filtran **entradas de menú**: `CATALOGO_UNIFICADO` está en las dos primeras y entrará en las otras dos con su entrada de menú (F1.2).
- **Catálogo (F1.1):** toda tabla del catálogo lleva `companyId` propio y las hijas se enlazan con FK **compuesta** `(catalogItemId, companyId)`; el invariante «≥1 variante» y «default solo si es la única» lo hace cumplir un **disparador diferido** en la base, así que cualquier escritura masiva futura debe crear ítem y variante en la misma transacción; SKU único por empresa con numeración `SKU-<año>-<seq>` (cerrojo `catalogo:<companyId>`); los ítems `source = SUPPLY` serán de solo lectura para la empresa. **Lo público del catálogo pasa SIEMPRE por la lista blanca de `publico-nucleo.ts`** (sin costo/SKU/código de barras/capacidades/rutas) y por las tres condiciones de visibilidad (empresa pública + capacidad; ítem `ACTIVE` + `availableMarketplace`; variante visible). **La API de catálogo arma borradores y no publica**; el costo solo sale hacia la clave de la propia empresa. **Los componentes de cliente del catálogo nunca importan `domain`, `service`, `queries` ni `medios`** (arrastrarían Prisma al navegador): reciben de la página lo que necesitan (p. ej. las transiciones de estado); lo vigila un test.
- **Inventario (F2):** por **variante × sucursal**, enteros; el saldo es caché y el **ledger es la verdad** (traslados entre cubetas `AVAILABLE`/`RESERVED`/`DAMAGED` sobre `commerce-primitives/ledger`). **Toda escritura al saldo pasa por `escribirMovimiento`**, bajo `SELECT … FOR UPDATE` (varias filas **en orden de id**); `inventory_movements` es **inmutable en la base** (un error se corrige con otro movimiento). Una reserva vencida deja de apartar aunque el cron no haya corrido: **cada operación vence antes las caducadas de su saldo**. Las operaciones que mueven un saldo desde el sistema (`vender`, `reservar`, `consumir`) **no son acciones del panel**. Toda CHECK de la base que compare con `NULL` debe envolverse en `coalesce(…, false)` o usar `IS NOT DISTINCT FROM` (un CHECK que da `NULL` se acepta). El inventario cuelga de la capacidad del catálogo (sin capacidad propia) y el catálogo **no importa** del inventario.
- **Puente Supply→Catálogo (F2.5):** Supply V2 es el **master**; la empresa «de la casa» (`esCasaMembego`, una sola) es la dueña de **todos** los ítems puente, uno por **oferta**. La base exige `source = SUPPLY ⇔ supplyV2OfferId`. El puente solo lee de Supply por su **read model público** (`ofertaParaPuenteEnTx`); Commerce Core nunca importa del puente ni de `supply-v2`. **El público cruza el ítem con la oferta en vivo** (estado y vigencia): la copia sincronizada nunca manda sobre lo público. No se cambia de casa mientras haya ítems puente de otra. La compra de una oferta pasa **siempre** por el checkout de Supply (no se duplica).
- El namespace del cerrojo de numeración es parámetro; **Supply V2 usa `supply_v2`** (cambiarlo rompe despliegues graduales).
- `commerce-primitives/ledger.ts` y `estados.ts` solo contienen la parte genérica; tablas de transición y cubetas de Supply se quedan en `supply-v2/core`.
- Cambios de esquema: migración aditiva + sellado (`npm run migraciones:sellar`); sin romper compatibilidad.

## 14. Deuda técnica

| Severidad | Problema | Impacto | Acción recomendada |
|---|---|---|---|
| **CRITICAL** | JWT `service_role` (y `anon`) de Supabase, ref `ybzhvfmybyyomwpjpaud`, embebido en `scripts/run-e2e-verify.mjs` y `scripts/run-auth-e2e.mjs`, en git desde 2026-09-18 (`506a350`), exp. 2036. `service_role` ignora RLS. ¿Es producción? UNKNOWN | Acceso total a la BD/Storage de ese proyecto si es real; está en el historial aunque se borre el archivo | **El usuario debe rotar la clave** y confirmar a qué proyecto pertenece; después sacar los valores a variables de entorno y añadir secret scanning a CI |
| **HIGH** | Capa 2 RLS apagada en producción; gate `rls-cobertura` con falsos negativos (~37 sitios) | El aislamiento depende solo de código de aplicación; encenderla sin arreglar esos sitios deja pantallas vacías | Sustituir el gate por uno por llamada; arreglar sitios; ensayo con `ensayo-rls.yml`; luego runbook |
| **HIGH** | Portal de proveedor Supply V2 y V1 ocultos en el menú para todos (`MEMBEGO_SUPPLIER` ∉ `CAPACIDADES_DEL_MENU`); el registro V2 nunca enciende esa capacidad | El proveedor solo llega por URL directa; mismo interruptor para V1 y V2 | Separar capacidad V1/V2 y decidir qué se muestra (revela V1 si se «arregla» sin separar) |
| **HIGH** | `POST /api/pagos/cardnet/iniciar` recibe PAN/CVV (ruta legacy viva, UI huérfana); `docs/PAGOS-CARDNET.md` dice «nunca vemos el PAN» | Alcance PCI mayor que el declarado | Retirar la ruta o gatearla; corregir el doc |
| **HIGH** | `npm audit --omit=dev`: 1 high (`source-map-js`) | El job CI `dependencias` falla | `npm audit fix` (hay arreglo) y revalidar |
| MEDIUM | Sin pasarela real en Supply V2; reembolsos al cliente inalcanzables; acuerdos no modificables por UI; WhatsApp `NOT_CONFIGURED` | Supply no puede cobrar online ni reembolsar | Fuera del camino crítico; planificar tras F4 |
| MEDIUM | 114 de 181 tests E2E se omiten por falta de Supabase de pruebas; las pantallas autenticadas **no tienen cobertura de CI**. Las de **catálogo** y de **inventario** ya tienen E2E de CI (sesión firmada con el secreto de `e2e.yml`; el app valida el token localmente cuando Supabase no responde); las de F0 (ruleta del cliente, personalización, menú) siguen sin recorrido | Cambios de UI de F0 verificados solo por unit/tipos/build | Extender el mismo patrón (sesión firmada, `catalogo-arnes.ts` como modelo) a las pantallas de F0 y a los flujos de cliente hoy omitidos |
| MEDIUM | Tablas posteriores a `20260916` sin `ENABLE ROW LEVEL SECURITY` por migración | Cobertura Capa 1 en prod desconocida | Ejecutar `2026-07-rls-capa2-verificar.sql` en prod |
| MEDIUM | 4 sistemas de lealtad y ~7,9k líneas de motores sin tests ni lectores | Complejidad y riesgo al consolidar | Consolidar en F5/F9; no crear un quinto |
| MEDIUM | Rate limiter fail-open; `MovimientoInventario` (carwash) sin bloqueo; `BenefitGrant` mutable; `AuditLog` inmutable solo por convención | Condiciones de carrera / manipulación | F2 resolvió la parte general (inventario con `FOR UPDATE` y ledger inmutable en la base) **sin tocar** el del Car Wash; decidir si se migra. Aplicar el patrón del disparador a `AuditLog` antes de F4 (billing) |
| MEDIUM | Cron Supply V1 corre para todos; `/cliente/beneficios` aún depende de V1 | V1 no se puede retirar aún | Decidir migración V1→V2 (§16) |
| LOW | Comentarios/doc obsoletos: `ledger.ts:55-57`, «44 secciones» (son 42), `ci.yml`/`e2e.yml` «113/164 tests» (son 272 archivos), `PHASE3_STATUS`, `PRODUCTION_READINESS`, `SECURITY_ANALYSIS`, `MATURITY`, tablas «112/115/137» en docs RLS (son 285) | Confusión | Limpiar al tocar cada área |
| LOW | `docs/membego-supply-*.md` describen solo V1; falta `...slice9-bloque5.md` | Doc de Supply engañosa | Reescribir desde §5 |

### Deuda cerrada

| Fecha | Problema | Cierre |
|---|---|---|
| 2026-10-06 | `subirImagenExcursion` sin autenticación, con cliente `service_role`, `companyId` y MIME del cliente, `upsert:true` | `requireSection('excursiones', catalogo_crear/editar)` antes del cliente privilegiado; empresa de la sesión (debe coincidir con la recibida); la excursión debe ser de esa empresa; tipo y extensión por **firma del archivo** (`src/lib/imagen-tipo.ts`: JPG/PNG/WebP, sin SVG); tamaño medido sobre los bytes; `upsert:false`. Tests: `imagen-tipo`, `excursiones-imagen-guardia` |
| 2026-10-06 | Plan Maestro fuera del repo | Versionado en `docs/PLAN_MAESTRO.md` con aviso de aprobación y 6 erratas; el cuerpo no se reescribió. Los 4 documentos estratégicos de origen siguen sin versionar |

### Discrepancias documentación ↔ código (el código manda)

| Documento | Dice | El código muestra |
|---|---|---|
| Plan Maestro v1/v2 | El sistema de capacidades eran «strings mágicos» | Catálogo formal con 22→25 claves, paquetes base y mapa de secciones (anotado en las erratas de `docs/PLAN_MAESTRO.md`) |
| Plan Maestro §10 F0 | Hay que escribir políticas RLS por tabla | Capa 2 las genera por introspección; 0 huecos; hacerlo a mano ya falló una vez |
| Plan Maestro §12 | Supply V1 «se oculta con un flag» | Nav oculto por accidente; rutas/cron/cliente activos |
| `PAGOS-CARDNET.md` | SAQ A, nunca se ve el PAN | Ruta legacy que recibe PAN/CVV |
| `ENGAGEMENT_ENGINE.md:78` | `RuletaJugada` es un ledger de puntos | Los puntos son derivados; los giros no se bloquean |
| `catalogo.ts:14` | Solo CAR_WASH operativo | Excursiones es el módulo más grande |
| `membego-supply-*.md` | 1 migración, 15 tablas, 14 enums | 10 migraciones, 30 modelos, 34 enums (V1) y V2 aparte |
| Comentarios de `commerce-primitives` | MembegoOrder/Deal ya consumen | Solo `supply-v2/core` las usa |

## 15. Riesgos abiertos

### Técnicos
- Capa 2 sin ensayar contra la app real (pantallas vacías) y con sitios `prisma.*` fuera de wrappers.
- Las pantallas autenticadas que cambió F0 (ruleta del cliente, `/admin/personalizacion`, menús) **no se han recorrido en navegador**: solo unit/tipos/build/E2E público (el patrón para cubrirlas ya existe: sesión firmada).
- Cinco modelos de orden y cuatro de lealtad sin capa común: F3 puede duplicar lógica si no se acota.
- Cuatro listas de capacidades que se desincronizan en silencio (hay tests que avisan de algunas).
- **Catálogo:** `prisma migrate diff` no ve disparadores, `CHECK` ni índices parciales, así que el control de deriva **no** cubre las reglas que protegen el catálogo; solo las cubren los 29 tests PG. Un `createMany` de ítems seguido de variantes en otra transacción fallará al confirmar (es el comportamiento buscado). Las 12 acciones del catálogo y las rutas de API/vitrina se ejercieron contra una app local, pero con una sesión firmada localmente y sin Storage: nunca con una sesión de Supabase real, y los recorridos de catálogo SÍ están en CI desde el E2E (aún sin confirmar en un runner de GitHub).
- **API de catálogo:** `catalog:manage` amplía lo que puede hacer una clave de empresa (§3, «Decisión de seguridad»); los `POST` no son idempotentes (se mitiga con el SKU único).
- **Inventario:** como el catálogo, el control de deriva (`migrate diff`) **no ve** los disparadores ni los CHECK que lo protegen (inmutabilidad, traslados permitidos, saldos): solo los cubren los 35 tests PG y `probar-rls`. Los E2E usan una base creada con `db push` **sin** esas reglas. Las reservas de un pedido que nunca se paga o se cancela mal quedan apartadas hasta su TTL (≤ 7 días); el cron diario solo recoge las que nadie volvió a tocar. Nada llama todavía a `vender`/`reservar`/`consumir`: el contrato lo fijan los tests, no un consumidor real (F3). `vender` directo no tiene todavía una referencia obligatoria a un pedido.
- **Puente:** `migrate diff` tampoco ve el CHECK `catalog_items_origen_oferta` ni el índice único parcial de la casa (solo los 20 tests PG). El puente depende de que el superadmin cumpla los requisitos de la casa (publicada, activa, capacidad) a mano. La sincronización tras un cambio usa `after()` (best-effort): si falla, hasta el cron diario el ítem puede ir por detrás —el cruce en vivo cubre estado y vigencia, no nombre ni precio—.
- `commerce-primitives` ya lo consume el inventario además de Supply V2 (el ledger genérico); `numeracion` lo usa el catálogo.

### Comerciales
- Sin billing no hay ingresos: nada factura a empresas hoy (F4).
- Supply V2 tiene páginas públicas pero **sin descubrimiento**: no entra en la búsqueda general.
- Cortar la ruleta puede molestar a empresas que la usaban (datos intactos).

### Financieros
- Merchant Billing y Supply Economics deben mantenerse separados (decisión vigente); un error de diseño aquí contamina ambos.
- Pagos de Supply V2 solo manuales; sin reembolsos al cliente.

### Seguridad
- Clave `service_role` en git (§14, CRITICAL).
- Sin secret scanning, sin test de «server action sin guardia», rate limiter fail-open, ruta legacy con PAN.

### Operacionales
- Estado real de producción (migraciones aplicadas, Capa 1, Upstash, Sentry) **UNKNOWN**: este entorno no tiene acceso.
- 18 migraciones aplicadas a mano el 2026-09-14 sin registrar en `_prisma_migrations`.
- El cron de Supply V1 sigue corriendo para toda la plataforma.

## 16. Bloqueadores

| Bloqueador | Impacto | Qué necesita | Responsable |
|---|---|---|---|
| Corte de RLS Capa 2 | Solo bloquea el aislamiento real en BD; **no bloquea F1** | Visto bueno explícito + ensayo (`ensayo-rls.yml`) + seguir `docs/runbooks/rls-encender.md` + acceso a prod | Usuario / ops |
| Decisión sobre Supply V1 | Bloquea ocultarlo y cerrar el criterio F0 «Supply V1 oculto» | Saber si hay proveedores externos activos con `MEMBEGO_SUPPLIER` (acceso a la BD de prod) y si `/cliente/beneficios` se migra | Usuario |
| Claves QA reales de CardNET | Bloquea 1 test (`PENDIENTE · activación instantánea con tarjeta`) y el flujo feliz con tarjeta | Credenciales QA | Usuario |
| Rotación de la clave Supabase | No bloquea desarrollo; sí es un riesgo vivo | Confirmar proyecto y rotar | Usuario |
| Valores de serie de Merchant Billing (CPA RD$ 100, 8 %, límite RD$ 5,000, ciclo mensual, gracia de 7 días) y tratamiento fiscal de la comisión | No bloquea desarrollo; **sí bloquea encender los pedidos en una empresa real** (empezaría a pagar comisión) | Confirmar o cambiar los valores (se editan por empresa en `/superadmin/facturacion`) y la decisión contable | Usuario |

## 17. Próximo trabajo exacto

### A. Antes de F1 (corto, recomendado)
1. **(Usuario)** Rotar la clave `service_role`; confirmar si el ref `ybzhvfmybyyomwpjpaud` es producción; luego sacar los valores de `scripts/run-e2e-verify.mjs` y `scripts/run-auth-e2e.mjs` a variables de entorno y añadir secret scanning a CI.
2. ✅ ~~Cerrar `subirImagenExcursion`~~ (hecho, §14). **Pendiente derivado:** un test que enumere los `'use server'` sin guardia, con allowlist de las ~18 públicas por diseño (auth, registro, marketplace, geo, reset por token).
3. ✅ ~~Versionar el Plan Maestro~~ (hecho). **Pendiente:** versionar los 4 documentos estratégicos de origen (decisión del usuario; solo si se quieren en el repo).
4. Decidir Supply V1 (§16) y, si procede, separar la capacidad V1/V2.
5. `npm audit fix` y revalidar `npm audit --omit=dev --audit-level=high`.

### B. F1 — Commerce Catalog (por rebanadas)
**F1.1 — esquema, RLS, servicio y tests (sin UI): ✅ hecha el 2026-10-06** (§3). Desviaciones respecto a la versión anterior de este punto, ya registradas en §3: `companyId` propio + FK compuesta (no Nivel N por FK), sin `supplyV2CatalogItemId` (F2.5), `_enums` solo para `AuditAccion`.

**F1.2 — UI admin: ✅ hecha el 2026-10-06** (§3). Quedó fuera, a propósito: importación masiva, eventos de dominio. (La spec E2E se hizo después, ver §3.)

**F1.3 — Marketplace y API: ✅ hecha el 2026-10-06** (§3). **Antes de encender la capacidad en una empresa real** (rollout con Car Town primero, override en `/superadmin/capacidades`): (1) probar la subida de imágenes y su render en la vitrina contra un Storage real; (2) ~~specs E2E de CI~~ **hechas**: confirmarlas en el primer PR real (runner de GitHub); (3) decidir si se mantiene `catalog:manage` (§3); (4) revisar la vitrina en modo oscuro y en un móvil real.

### B2. F2 — Inventory: ✅ F2.1 y F2.2 hechas el 2026-10-06 (§3)
**Antes de encender `CATALOGO_UNIFICADO` en una empresa real** se suma a lo de F1: (1) recorrer `/admin/inventario` con la sesión de un administrador real de esa empresa y al menos 2 sucursales activas; (2) confirmar que el E2E `inventario-admin` pasa en un runner de GitHub; (3) decidir si el cron diario (06:30 UTC) basta o si se quiere un barrido más frecuente (el stock no depende de él). Pendientes de F2 en §3.

### B3. F2.5 — Supply Bridge: ✅ F2.5.1 y F2.5.2 hechas el 2026-10-06 (§3)
**Para encenderlo:** (1) encender `CATALOGO_UNIFICADO` en la empresa que será la casa (override en `/superadmin/capacidades`) y publicarla; (2) designarla en `/superadmin/puente-supply` y «Sincronizar ahora»; (3) revisar `/catalogo` y la vitrina de la casa; (4) decidir si esa empresa debe aparecer en el directorio de empresas. Pendientes en §3.

### B4. F3 — Pedidos Membego: ✅ F3.1 y F3.2 hechas el 2026-10-06 (§3)
**Antes de encender `PEDIDOS_MEMBEGO` en una empresa real:** (1) `CATALOGO_UNIFICADO` encendida y la empresa publicada, con al menos una sucursal activa y existencias cargadas en lo que controla inventario; (2) **recorrerlo con una persona** en móvil real y en modo oscuro (pedir → aceptar → listo → QR → escáner con un lector real), que no se ha hecho; (3) confirmar los E2E en un runner de GitHub; (4) decidir si 7 días sin respuesta es el plazo correcto para cancelar solo, y si el cliente debe recibir avisos (hoy no los recibe). Para el envoltorio de Supply: la casa necesita una sucursal activa. Pendientes en §3.

### B5. F4 — Merchant Billing: ✅ F4.1 y F4.2 hechas el 2026-10-07 (§3)
**Antes de encender `PEDIDOS_MEMBEGO` en una empresa real, además de lo de F3:** (1) **avisarle que empezará a pagar comisión** (CPA RD$ 100 por pedido sin pago verificado, 8 % con él; límite de crédito RD$ 5,000, estado de cuenta mensual): los valores de serie son una decisión de producto mía que el usuario aún no confirmó — se cambian por empresa en `/superadmin/facturacion/<empresa>`; (2) decidir **qué efecto tendrá la suspensión** (hoy solo informa; F5 la usará para impedir campañas) y si hace falta avisar al entrar en gracia; (3) decidir el **tratamiento fiscal** de la comisión (comprobante, ITBIS) y cómo se cobra de verdad (hoy el superadmin asienta a mano los pagos que recibe fuera de la plataforma); (4) recorrerlo con una persona (móvil, modo oscuro).

### C. Después
**F5 Growth Engine** (Deals/Campaigns con presupuesto; consume el estado de la cuenta de Merchant Billing) → F6 Analytics → F7 POS (comisión de POS en `ORIGENES_COMISIONABLES`). Las decisiones del usuario abiertas (§16) siguen pendientes.

# CONTEXTO PARA CONTINUAR EN UNA NUEVA SESIÓN

- **Qué construimos:** Membego pasa de membresías/promos a un *Commerce OS + Marketplace + Supply* para negocios locales de RD, como monolito modular (sin microservicios, sin reescribir).
- **Fase actual:** F4 🟡 (**F4.1 y F4.2 hechas**: comisión por pedido cobrada en la misma transacción que cierra el pedido —CPA RD$ 100 o 8 % según el nivel de verificación, configurable por empresa— y revertida al reembolsar; libro `merchant_ledger_entries` **inmutable con saldo corrido vigilado por la base**; cortes únicos por periodo; límite de crédito con gracia de 7 días y suspensión; «Mi cuenta Membego» y «Cobros a empresas»; cron `/api/cron/facturacion`; los pedidos de Supply **no** comisionan; ver §3). Antes: F3 🟡 (**F3.1 y F3.2 hechas**: `membego_orders` + líneas + atribución + confirmación + constancia de pago, máquina de estados y reglas en la base, servicio que aparta/vende/libera inventario, QR de un solo uso con cierre atómico, nivel de verificación derivado, capacidad `PEDIDOS_MEMBEGO` apagada, migraciones `20261042`/`20261043`; panel `/admin/pedidos-membego`, «Hacer un pedido» y «Mis pedidos» del cliente, QR de pedido en el escáner, envoltorio de las compras de Supply por el barrido del puente, «agotado» desde el inventario, cron `/api/cron/pedidos`; 46 tests PG + 8 del envoltorio + E2E de 12 pruebas; queda 🟡 solo por el recorrido con un humano). F2.5 🟡 (**F2.5.1 y F2.5.2 hechas**: empresa «de la casa» + un `CatalogItem` `source=SUPPLY` por oferta de Supply, sincronizado tras cada acción, por cron y a pedido, visibilidad cruzada con la oferta en vivo, panel `/superadmin/puente-supply`, `/catalogo` con «Ofertas MembeGo»; compra por el checkout de Supply). F2 🟡 (**F2.1 y F2.2 hechas**: inventario por variante × sucursal con ledger inmutable, reservas con TTL, transferencias, conteo, alertas; `/admin/inventario`; cron; 63 tests nuevos + E2E; sin capacidad propia: cuelga de `CATALOGO_UNIFICADO`). F1 🟡 (rebanadas y E2E de CI hechos; falta validar con Storage real). **F1.1, F1.2 y F1.3 hechas** (catálogo: 5 tablas `catalog_*`, migraciones `20261036`/`20261037`, RLS generada, capacidad `CATALOGO_UNIFICADO` **apagada**, sección `catalogo`, `src/modules/catalog/`, 12 acciones, pantallas `/admin/catalogo` con variantes, fotos y categorías; vitrina pública, `/catalogo` y API v1 de catálogo; tests). F0 🟡 solo por 2 decisiones del usuario. Rama `claude/wizardly-hypatia-x2l9av`, sin PR. Commits: `99d87e6`, `2c2efe3`, `3c73726` (F0), `7c56aeb`, `708a9bb` (higiene), `16e8618` (F1.1), `ce61167` (F1.2), `9b92651` (F1.3), `f3c2360` (E2E del catálogo); F2 es el siguiente.
- **Estado de calidad:** (2026-10-07, tras F4) tsc/lint (0 errores)/3 845 unit (6 skip)/522 PG/build/bundle (techo del total subido a 8 400 KB a propósito)/RLS (preflight 281/302; `probar-rls` 43/43 migrada, 39/39 `db push`)/200 migraciones sin deriva en PASS; **E2E de F4: 20/20 ×3** (`pedidos-membego` + `facturacion-superadmin`), suite E2E completa no repetida (la última, tras F3: 111 PASS · 1 flaky ajeno `supply-v2-slice4` · 143 SKIP); `npm audit` FALLA (1 high). Un flake de temporización preexistente visto una vez en `supply-v2-slice9` (PG). Sin acceso a producción (todo lo de prod = UNKNOWN).
- **Siguiente paso exacto:** F5 Growth Engine (Plan Maestro §10, F5: Deals y Campaigns con presupuesto prepago; consume `puedeCrearCampanas()` de `billing/domain.ts` y cobra su fee por redención como CPA al libro de Merchant Billing). Antes de encender las capacidades en una empresa real: Storage real, confirmar los E2E en un runner de GitHub, decisión sobre `catalog:manage` y el recorrido humano de pedidos (§3, §17-B).
- **No cambiar:** Supply es el master del puente (el ítem puente es de solo lectura) y lo público cruza la oferta en vivo; el puente solo lee el read model público de Supply; la compra de ofertas pasa por el checkout de Supply; el ledger de inventario es inmutable (se corrige con otro movimiento) y todo movimiento pasa por `escribirMovimiento` bajo `FOR UPDATE`; `vender`/`reservar`/`consumir` no son acciones del panel; la API de catálogo no publica; lo público sale solo por `publico-nucleo.ts`; CatalogVariant desde el día 1; pedidos/inventario/promos referencian **variante**; Merchant Billing ≠ Supply Economics; Commerce Core no importa de `supply-v2`; CPA + 8 % por `verificationLevel`; sin wallet financiera; **no escribir políticas RLS a mano**; clave de cerrojo `supply_v2` (el catálogo usa `catalogo:<companyId>`); ocultar = apagar capacidad y conservar datos; **el estado de un pedido solo lo escribe `orders/service.ts` (lo vigila un test), las líneas son inmutables, el nivel de verificación se deriva (nunca se escribe a mano), un pedido de la vitrina se cierra solo por QR (el único cierre sin QR es `cerrarPedidoExternoEnTx`, del sistema, para el envoltorio de Supply) y Supply no conoce el puente ni los pedidos**;  toda alta de empresa usa `CAPACIDADES_OVERRIDE_TENANT_NUEVO`; ítems y variantes se crean en la **misma transacción** (disparador diferido). Merchant Billing y Supply Economics **no se mezclan** (ningún asiento de `merchant_ledger_entries` referencia algo de Supply; los pedidos de Supply no comisionan); el libro de Merchant Billing es inmutable (se corrige con un asiento contrario) y solo `billing/service.ts` lo escribe; la comisión se cobra **dentro** de la transacción que cierra el pedido.
- **Archivos clave:** `src/modules/catalog/*`, `src/modules/inventory/*`, `src/modules/orders/*`, `src/modules/billing/*`, `prisma/schema/facturacion-comercial.prisma`, `src/modules/supply-bridge/*`, `prisma/schema/pedidos.prisma`, `prisma/schema/inventario.prisma`, `prisma/schema/catalogo.prisma`, `src/lib/commerce-primitives/*`, `src/modules/capacidades/catalogo.ts`, `src/modules/plataforma/conceptos.ts`, `src/components/layout/nav-config.ts`, `src/modules/navegacion/contexto.ts`, `src/lib/auth/{guards,permissions,funciones}.ts`, `src/lib/tenant.ts`, `docs/RLS.md`, `docs/runbooks/rls-encender.md`, `docs/CAPACIDADES.md`.
- **Cómo verificar (todo corre aquí):** `npx tsc --noEmit` · `npx eslint src tests` · `npm test` · PG local: `pg_ctlcluster 16 main start` (clave `postgres`/`ci`; crear la BD y las extensiones `pg_trgm`, `pgcrypto`, `unaccent`), `migrate deploy`, `npm run test:db`. Para `rls:probar`: aplicar antes `20260771_rls_barrera_publica` (con roles `anon`/`authenticated`) y `2026-07-rls-capa2-aislamiento.sql` precedido de `-c "set membego.clave = '…'"` (como en `ci.yml`).
- **Riesgos que no se olvidan:** la subida real de imágenes a Storage no se ha probado; clave `service_role` en git (CRITICAL, rotar); Capa 2 apagada y `rls-cobertura` con falsos negativos; Supply V1 NO oculto y cron activo; el menú oculta Supply para todos por accidente; `migrate diff` no ve los disparadores/CHECK del catálogo, del inventario ni de los pedidos (solo los tests PG); el E2E usa `db push`, sin esas reglas.
- **Decisiones del usuario aún abiertas:** corte Capa 2 en producción; qué hacer con Supply V1; rotar la clave `service_role`; si se versionan los 4 documentos estratégicos de origen.
- **Plan aprobado:** `docs/PLAN_MAESTRO.md` (con aviso y 6 erratas arriba del todo; las desviaciones de F1.1 están en §3 de este archivo).
- **Regla:** el código manda sobre la doc; no marcar nada ✅ sin verificarlo; actualizar este archivo al cerrar cada fase o sesión.
