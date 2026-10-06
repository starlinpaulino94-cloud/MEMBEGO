# MEMBEGO 2.0 - PLAN MAESTRO DE ARQUITECTURA E IMPLEMENTACION

**Fecha**: 2026-10-05
**Ultima revision**: 2026-10-05 (v2 - decisiones del fundador incorporadas)
**Autor**: Principal Software Architect
**Estado**: ✅ APROBADO por el fundador (2026-10-06) — ver aviso siguiente
**Repositorio auditado**: starlinpaulino94-cloud/membego

---

> ## Aviso de versionado (añadido el 2026-10-06; el resto de este archivo es el plan tal como se aprobó)
>
> - **Estado**: aprobado. La implementación empezó con F0 el mismo día. Este archivo se conserva **sin reescribir** como registro de lo aprobado; los únicos cambios sobre el original son este aviso, la línea de *Estado* y la última línea.
> - **El avance real vive en [`docs/IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md)**, no aquí. Si ambos difieren, manda el código y, después, ese archivo.
> - **Documentos de origen NO versionados** (cargados como adjuntos en la sesión de diseño; este plan los resume): estrategia de monetización (`reestructura_2`), verificación y facturación (`reestructura_3`), visión del Commerce OS (`reestrucutura_1`) y motor de atribución (`resdtructuracion4`).
>
> ### Erratas detectadas al ejecutar F0 (el código manda)
>
> 1. **§9 (riesgo «RLS incompleto») y §10 F0, punto 1.** No hay que escribir políticas RLS por tabla. La Capa 2 las **genera por introspección** del esquema (`prisma/migrations_manual/2026-07-rls-capa2-aislamiento.sql`): 139 tablas por `companyId` + 124 por clave foránea, con 21 excepciones decididas a mano; el chequeo estático y el ensayo conductual pasan. Escribir `CREATE POLICY membego_inquilino` en una migración choca con ese mecanismo (ya ocurrió: `20260914_home_rls`, revertida). Lo pendiente de verdad es el **corte en producción** (Capa 2 está construida, probada y apagada): decisión del usuario, según `docs/runbooks/rls-encender.md`.
> 2. **§10 F0, punto 2 y §12 (quick win 6).** El sistema de capacidades **ya era un catálogo formal en código** (`src/modules/capacidades/catalogo.ts`), no «strings mágicos». F0 solo añadió tres claves (`PUBLICACIONES`, `HOME_BUILDER`, `MENSAJERIA`).
> 3. **§5 «Extracción de commerce-primitives».** `estados.ts` y `ledger.ts` **no se movieron enteros**: están acoplados a los enums de Supply V2. Solo se extrajo la parte genérica (fábrica de máquinas de estado y aritmética de cubetas); las tablas de transición y las 6 cubetas siguen en `supply-v2/core`. Los archivos de `supply-v2/core` quedan como *shims*, no se eliminaron.
> 4. **§8.1 y §12 punto 1 (Supply V1).** No se oculta «con un flag»: el menú ya lo esconde *por accidente* (`MEMBEGO_SUPPLIER` ausente de `CAPACIDADES_DEL_MENU`), pero sus rutas, `/cliente/beneficios/*` y el cron siguen activos y proveedores externos reales dependen de él. **Decisión abierta.**
> 5. **§8.2 (Gamificación) — ampliado por decisión del usuario (2026-10-06).** La ruleta se apaga también para el **cliente** (página, acción de giro y menú), no solo en el panel. Puntos y niveles derivados siguen visibles.
> 6. **§2 (cifras de Supply V2).** Medido en el código: 113 archivos / 30 919 LOC (el plan decía ~31 211), 66 modelos, 88 enums (el plan decía 70+), 27 migraciones.

---

## 1. RESUMEN EJECUTIVO

### Que debe convertirse Membego

Membego debe evolucionar de una **plataforma de gestion de membresias y promociones para negocios locales** hacia un **ecosistema de comercio local** compuesto por tres pilares:

1. **Membego Business**: Sistema operativo comercial para empresas (catalogo, inventario, POS, ventas, clientes, promociones, operaciones)
2. **Membego Marketplace**: Aplicacion para consumidores (descubrir, comprar, canjear, ahorrar en negocios locales)
3. **Membego Supply**: Cadena de suministro B2B donde Membego compra inventario/servicios de proveedores para regalar, vender con descuento y adquirir clientes. **Prioridad estrategica de lanzamiento.**

### Modelo de monetizacion (RESUELTO)

- **CPA (fee fijo por redencion verificada)**: Para operaciones donde Membego NO tiene evidencia financiera suficiente (sin checkout propio, sin POS, sin pago procesado). Auditable, simple, inmediato.
- **8% sobre venta verificada**: Para operaciones donde Membego SI tiene evidencia financiera (checkout Membego, POS conectado, pago procesado). Se activa por tipo de operacion, no por fase temporal.
- **Ambos modelos coexisten desde el dia 1** en la arquitectura (`MerchantBillingConfig.feeModel: CPA_FIXED | PERCENTAGE | HYBRID`). Se activa CPA o 8% segun el nivel de verificacion de cada operacion.

### Separacion financiera estricta (RESUELTO)

```
MERCHANT BILLING / COMMISSION
  Dinero que una empresa debe a Membego
  por usar la plataforma para adquirir clientes
  
  Modelos: Commission, MerchantLedgerEntry, MerchantStatement, MerchantBillingConfig
  Dominio: src/modules/billing/

SUPPLY ECONOMICS / SUPPLIER SETTLEMENT  
  Dinero y costos asociados a productos/servicios
  que Membego compro a proveedores
  
  Modelos: SupplyV2SupplierInvoice, SupplyV2SupplierPayment, SupplyV2Settlement, SupplyV2EconomicEvent
  Dominio: src/modules/supply-v2/finance/
```

Estos dos flujos financieros NUNCA se mezclan. Distintas tablas, distintos ledgers, distintos modulos. Un `MerchantLedgerEntry` nunca referencia un `SupplyV2Settlement` y viceversa.

### Principio rector

```
Un catalogo (con variantes desde el dia 1)
Un inventario
Un cliente
Un pedido
Una redencion
Un ledger merchant
Un ledger supply (separado)
```

Multiples canales de venta consumen la misma fuente de verdad.

### Capa compartida: commerce-primitives (RESUELTO)

Las funciones verdaderamente genericas de Supply V2 (money, ledger, state machines, commission, FEFO) se extraen gradualmente a `src/lib/commerce-primitives/`. Commerce Core y Supply V2 consumen esa capa. No se duplica ni se reescribe logica probada.

```
src/lib/commerce-primitives/
  dinero.ts      (safe rounding, distribution)
  ledger.ts      (append-only ledger pattern, invariant validation)
  estados.ts     (state machine factory)
  comision.ts    (commission calculation: CPA + percentage)
  fefo.ts        (FEFO allocation algorithm)
  numeracion.ts  (sequential numbering)
```

Migracion gradual: primero se mueven las pure functions, luego Supply V2 actualiza sus imports, luego Commerce Core las consume. Sin big bang.

---

## 2. ESTADO ACTUAL

### Que existe realmente en el proyecto

| Dimension | Estado |
|---|---|
| **Framework** | Next.js 16 + React 19, App Router, Turbopack. VERIFICADO |
| **Base de datos** | Supabase PostgreSQL 17, Prisma 6 multi-file (28 archivos .prisma). VERIFICADO |
| **Modelos** | ~284 modelos, ~186 enums, ~190 migraciones. VERIFICADO |
| **Auth** | Supabase Auth + JWT local, 11 roles, 44 secciones admin con permisos granulares. VERIFICADO |
| **Multi-tenancy** | companyId en casi todos los modelos, RLS barrera global activa, RLS por dominio en rollout progresivo. VERIFICADO |
| **Frontend** | ~500 paginas en route groups (admin ~120, cliente ~45, superadmin ~60, empleado 2, vendedor 5, public ~20). VERIFICADO |
| **API** | 68+ route handlers REST + Platform API v1 con OAuth2 (25+ endpoints). VERIFICADO |
| **Engines** | 7 motores: Rule, Automation, Promotion, Membership, Benefit, Referral, Transaction. VERIFICADO |
| **Supply V1** | 30 modelos con ledger 6 cubetas. Funcional pero siendo reemplazado por V2. VERIFICADO |
| **Supply V2** | **MODULO MAS MADURO DEL SISTEMA (90-95% completo)**. 66 modelos, 70+ enums, 113 archivos fuente (~31,211 LOC), 27 migraciones, 26 archivos de tests (~21,569 LOC), 65 paginas UI. 9 slices verticales completos: Procurement, Commerce (checkout FEFO), Redemption (QR+reversals), Supplier Finance (facturas, depositos, pagos, obligaciones), Commissions/Settlements, Benefits (budget ledger, multi-party funding), Campaigns/Coupons (budget mgmt, audience targeting), Loyalty (memberships, referrals, points ledger con expiracion, rewards), Operations (outbox, inbox webhooks, health checks, alertas, reconciliacion, feature flags). Solo falta: integracion live con payment gateway (solo TEST_GATEWAY existe) y UI publica del marketplace. VERIFICADO |
| **POS** | Basico: CajaSesion + MovimientoCaja. No conectado a catalogo ni promotions. VERIFICADO |
| **QR** | Tokens criptograficos (192-bit), anti-replay con nonce, cola offline para scanner. VERIFICADO |
| **Pagos** | CardNET tokenizado (PCI SAQ A), auto-renovacion. Provider registry con solo Transferencia registrado. VERIFICADO |
| **Marketplace** | Descubrimiento basico: perfiles de empresas, promociones, categorias, ratings, follows. Sin carrito ni checkout general. VERIFICADO |
| **Verticales** | Car Wash (20 modelos, sub-app completa), Excursiones (22 modelos, sub-app completa), Restaurant (satelite con SDK propio). VERIFICADO |
| **CRM** | Prospectos, leads, pipeline, auto-reply. VERIFICADO |
| **Jobs** | QStash con 9 tipos idempotentes, dead letter queue, fan-out por lotes. VERIFICADO |
| **Eventos** | Strategy event bus, outbox pattern (Supply V2), EventoSaliente (Connect). VERIFICADO |
| **CI/CD** | 5 workflows: CI gate, migraciones, E2E, RLS rehearsal, backup verification. VERIFICADO |
| **PWA** | Service worker, manifest, shortcuts a scanner y caja, soporte offline. VERIFICADO |
| **Connect** | Framework de conectores (Meta, WhatsApp, Google Calendar, OAuth), credenciales cifradas AES-256-GCM. VERIFICADO |
| **Capability System** | Feature flags por empresa via JSON `capacidades`. VERIFICADO |

### Fortalezas arquitectonicas del sistema actual

1. **Supply V2 es un sistema de produccion completo (90-95%)**: 9 slices verticales con 113 archivos fuente (~31K LOC), 26 archivos de tests (~21K LOC), y 65 paginas de UI. Incluye: ledger inmutable 6 cubetas, FEFO, checkout completo, redemption con QR y reversals, finance completo (facturas, depositos, pagos, obligaciones, settlements, reconciliacion), commission calculation, benefits con budget ledger y multi-party funding, campaigns con budget management y audience targeting, loyalty completo (memberships, referrals, points con expiracion por lote, rewards), operations (outbox transaccional, inbox webhooks, health checks, alertas, feature flags). **Sus pure functions genericas se extraeran a commerce-primitives para compartirlas con Commerce Core.**

2. **Seguridad first**: Comparaciones timing-safe, fail-closed en middleware, JWT local sin round-trip, RLS barrera global, anti-replay en QR, CSP nonces, secret scanning.

3. **Idempotencia ubicua**: Los 9 tipos de jobs documentan su mecanismo de idempotencia. Outbox pattern en Supply V2 y Connect.

4. **Motores bien diseñados**: Rule Engine como base, Benefit Engine universal, Promotion Engine con state machine y versionamiento.

5. **Platform API madura**: OAuth2 client_credentials, scoped, rate-limited, con contracts package y SDK para satelites.

---

## 3. GAP ANALYSIS

### Lo que existe vs lo que necesitamos

| Capacidad Objetivo | Estado Actual | Gap |
|---|---|---|
| **CatalogItem unificado** (productos, servicios, bundles, membresias, vouchers) | Fragmentado: `Servicio`, `ProductoInventario`, `Plan`, `Promocion`, `Excursion`, `SupplyV2CatalogItem` - cada dominio tiene su propio concepto de "que se vende" | CRITICO - requiere nuevo modelo |
| **Variantes** (SKU, barcode, atributos, precio/inventario por variante) | No existe. Productos son planos sin variantes | CRITICO - incluir desde F1 con default variant |
| **Inventario unificado con ledger** | Dos sistemas: car wash (stock simple) y Supply (ledger 6 cubetas). No hay inventario general para retail | ALTO - extender patron via commerce-primitives |
| **Order Engine unificado** | 5 tipos de orden separados: `Transaction`, `ProductoCompra`, `SupplyV2CustomerOrder`, `ReservaExc`, `Cita` | ALTO - requiere consolidacion |
| **Membego Order (atribucion)** | No existe | CRITICO - es la base de monetizacion |
| **Cart + Checkout marketplace** | Solo existe en Supply V2 y Excursiones. No hay carrito general | ALTO |
| **Customer confirmation** (doble verificacion de montos) | No existe | MEDIO - necesario para billing |
| **Merchant Billing Ledger** | No existe. Supply V2 tiene su propio settlement SEPARADO (supplier economics) | CRITICO - necesario para monetizacion |
| **Commission calculation (merchant)** | Solo en excursiones (`ComisionEntrada`) y car wash (`Comision`). No hay comision marketplace | ALTO |
| **Payment Evidence** (registro de como pago el cliente) | No existe como concepto general | MEDIO |
| **Supply → Marketplace Bridge** | Supply V2 items no aparecen en el marketplace general. Sin UI publica para ofertas Supply | CRITICO - necesario para lanzamiento |
| **Commerce primitives compartidas** | Pure functions genericas viven solo en supply-v2/core/. No hay capa compartida | ALTO - extraer a commerce-primitives |
| **Marketplace discovery cross-company** | Solo storefronts por empresa. No hay feed general con busqueda, categorias y ofertas de multiples empresas | ALTO - necesario temprano |
| **Merchant Risk Engine** | No existe | BAJO (posterior) |
| **Revenue Attribution Dashboard** | No existe. Hay reportes por dominio pero no atribucion cross-canal | MEDIO |
| **Reconciliation general** | Solo en Supply V2. No hay reconciliacion merchant marketplace | MEDIO |
| **POS conectado a Commerce Core** | POS actual es registro de caja basico sin conexion a catalogo, inventario ni promotions | ALTO |
| **Promotions consolidadas** | Parcialmente separados pero con solapamientos: `Promocion`, `Promotion` (motor), `OfertaPrivada`, `SupplyV2Benefit`, `SupplyV2Coupon`, `Regalo`, `GiftCard`, `GrowthReward` | ALTO |
| **Loyalty consolidado** | Tres sistemas paralelos: gamificacion (puntos derivados), Growth Engine V3, Supply V2 Loyalty (puntos con ledger) | ALTO |
| **Pickup flow** (empresa prepara, cliente recoge con QR) | Existe para Supply V2 vouchers. No existe para marketplace general | MEDIO |
| **Ubicacion-centrico** (inventario, precios, disponibilidad por sucursal) | `Sucursal` existe y se usa en visitas y Supply. Car wash tiene `Bahia`. Pero no hay inventario por sucursal general | MEDIO |
| **Membego Supply** (B2B: Membego compra a proveedores) | Supply V2 completamente implementado. Supply V1 en proceso de deprecacion | OK - funcional |
| **Split payments / marketplace payments** | No implementado. CardNET actual no tiene split. Solo cobra directo | ALTO (posterior) |

---

## 4. CONFLICTOS ENCONTRADOS Y RESOLUCIONES

### Conflicto 1: Modelo de monetizacion — RESUELTO

| | |
|---|---|
| **Resolucion** | **CPA para operaciones sin evidencia financiera, 8% para operaciones verificadas via checkout/POS/pago**. Ambos modelos coexisten en la misma arquitectura desde el dia 1. `MerchantBillingConfig.feeModel` es configurable por empresa pero tambien por tipo de operacion. Una empresa puede tener CPA para deals de marketplace y 8% para ventas via POS Membego |
| **Impacto tecnico** | `Commission.type: CPA_FIXED | PERCENTAGE`. `MerchantBillingConfig` soporta ambos. El calculo usa `verificationLevel` del `MembegoOrder` para determinar modelo aplicable |

### Conflicto 2: Catalogo - variantes — RESUELTO

| | |
|---|---|
| **Resolucion** | **CatalogItem + CatalogVariant desde el dia 1**. Para productos/servicios simples, el sistema crea automaticamente una `CatalogVariant` default (name="Default", sku auto-generado) y la UI oculta la complejidad de variantes. Para productos con variantes reales (tallas, colores, sabores), la UI los muestra. No se diseña un modelo temporal sin variantes. Los verticales existentes (carwash, excursiones) NO se migran en F1 — coexisten |
| **Impacto tecnico** | F1 incluye CatalogVariant con auto-creation de default variant. UI admin muestra selector de variantes solo cuando hay mas de 1. Pedidos, inventario y promotions siempre referencian variante, nunca item directamente |

### Conflicto 3: Loyalty - tres sistemas paralelos

| | |
|---|---|
| **Decision A** (sistema actual) | Gamificacion (puntos derivados de hechos, no almacenados, 6 tiers) |
| **Decision B** (sistema actual) | Growth Engine V3 con `GrowthWallet`, `GrowthReward`, `GrowthRule` |
| **Decision C** (sistema actual, Supply V2) | Loyalty completo: `SupplyV2LoyaltyProgram`, `SupplyV2PointsAccount`, `SupplyV2PointsMovement` (ledger con expiracion por lote), `SupplyV2Reward`, `SupplyV2RewardClaim`, `SupplyV2ReferralProgram` |
| **Recomendacion** | El modelo de Supply V2 Loyalty es el mas robusto. Usarlo como base para el Loyalty unificado eventualmente. Por ahora coexisten |
| **Impacto tecnico** | No urgente. Postergar unificacion |

### Conflicto 4: Pedidos - cinco sistemas de orden

| | |
|---|---|
| **Estado actual** | `Transaction` (POS), `ProductoCompra` (compras de promociones), `SupplyV2CustomerOrder` (supply), `ReservaExc` (excursiones), `Cita` (citas) |
| **Resolucion** | Crear `MembegoOrder` como el pedido marketplace unificado. `SupplyV2CustomerOrder` puede crear un `MembegoOrder` como wrapper de atribucion via el Supply Bridge (F2.5). Los verticales existentes mantienen su flujo |

### Conflicto 5: Promociones - superposicion entre motor y entidades

| | |
|---|---|
| **Resolucion** | Mantener Promotion Engine como motor de reglas. Crear entidades de dominio separadas (Deal, Coupon) que USAN el motor. No mezclar "motor de calculo" con "entidad de negocio" |

### Conflicto 6: Wallet del consumidor

| | |
|---|---|
| **Resolucion** | Promotional credits, no wallet financiera. La regulacion dominicana 2025 para billeteras digitales lo hace arriesgado |

### Conflicto 7: Separacion financiera — RESUELTO

| | |
|---|---|
| **Resolucion** | **Merchant Billing** (empresa → Membego) y **Supply Economics** (Membego → proveedor) son dominios COMPLETAMENTE separados. Distintos modulos, distintos ledgers, distintas tablas. Un SupplyV2Settlement nunca aparece en MerchantLedger. Si un producto Supply se vende via marketplace, genera AMBAS entradas independientemente: una commission en MerchantLedger (si la empresa debe fee) y un economic event en Supply Economics (costo para Membego) |

---

## 5. ARQUITECTURA OBJETIVO

### Dominios y relaciones

```
MEMBEGO PLATFORM
|
+-- IDENTITY & ACCESS
|   |-- User (global)
|   |-- Organization (Company/tenant)
|   |-- Location (Sucursal)
|   |-- Role & Permission
|   +-- Capability (feature flags)
|
+-- COMMERCE PRIMITIVES (shared library, NOT a module)
|   |-- dinero.ts (safe money arithmetic)
|   |-- ledger.ts (append-only ledger pattern)
|   |-- estados.ts (state machine factory)
|   |-- comision.ts (commission calculation)
|   |-- fefo.ts (FEFO allocation)
|   +-- numeracion.ts (sequential numbering)
|
+-- COMMERCE CORE
|   |-- CatalogItem (productos, servicios, bundles, membresias, vouchers)
|   |-- CatalogVariant (SKU, atributos, precio por variante — siempre presente, default variant para items simples)
|   |-- Pricing (precios base, por ubicacion, por canal)
|   |-- Inventory (ledger por variante por ubicacion)
|   +-- Tax (ITBIS y reglas fiscales)
|
+-- CUSTOMER NETWORK
|   |-- Customer (per-tenant relationship)
|   |-- CustomerProfile (global user preferences)
|   |-- Vehicle (per-customer assets)
|   +-- CustomerSegment (audiencias)
|
+-- ORDER ENGINE
|   |-- MembegoOrder (pedido marketplace atribuido)
|   |-- OrderLine (lineas del pedido — siempre referencia CatalogVariant)
|   |-- OrderIntent (intencion pre-compra)
|   |-- Cart (carrito per-merchant)
|   +-- Fulfillment (pickup, preparacion, entrega QR)
|
+-- MERCHANT BILLING (empresa debe a Membego)
|   |-- MerchantBillingConfig (fee model, credit limit)
|   |-- Commission (calculo CPA o 8% por operacion)
|   |-- MerchantLedgerEntry (estado de cuenta — APPEND-ONLY)
|   |-- MerchantStatement (corte periodico)
|   +-- FiscalDocument (e-NCF, facturas)
|
+-- GROWTH ENGINE
|   |-- Promotion (regla economica con motor)
|   |-- Coupon (codigo que activa promocion)
|   |-- Deal (oferta destacada temporal)
|   |-- Campaign (estrategia de distribucion con budget)
|   |-- Benefit (beneficio universal)
|   |-- Entitlement (derecho adquirido)
|   +-- PromotionalCredit (creditos no-financieros)
|
+-- LOYALTY
|   |-- LoyaltyProgram (programa por empresa o plataforma)
|   |-- Membership (membresia con plan y beneficios)
|   |-- PointsAccount + PointsMovement (ledger de puntos)
|   |-- Reward + RewardClaim (catalogo y canje)
|   +-- Referral (programa de referidos)
|
+-- REDEMPTION ENGINE
|   |-- Voucher (credencial portadora)
|   |-- QrSession (sesion anti-replay)
|   |-- Redemption (registro de entrega/canje)
|   |-- CustomerConfirmation (confirmacion del monto)
|   +-- MerchantConfirmation (confirmacion del comercio)
|
+-- MEMBEGO SUPPLY (B2B — dominio independiente con finance propio)
|   |-- Supplier + Agreement
|   |-- PurchaseOrder + PurchaseReceipt
|   |-- Lot + LedgerEntry (6 cubetas)
|   |-- Allocation + Offer
|   |-- SupplierInvoice + SupplierPayment (SUPPLY ECONOMICS — separado de Merchant Billing)
|   |-- Settlement + Reconciliation (SUPPLY ECONOMICS)
|   +-- EconomicEvent (unit economics de Supply)
|
+-- SUPPLY → MARKETPLACE BRIDGE (nuevo, fase temprana)
|   |-- SupplyV2CatalogItem sync → CatalogItem + CatalogVariant
|   |-- SupplyV2Offer → visible en marketplace publico
|   |-- SupplyV2CustomerOrder → genera MembegoOrder para atribucion
|   +-- UI publica de ofertas Supply con checkout existente
|
+-- ATTRIBUTION & RISK
|   |-- OrderAttribution (origen del pedido)
|   |-- VerificationLevel (ATTRIBUTED → REDEEMED → CUSTOMER_VERIFIED → PAYMENT_VERIFIED → FISCALLY_RECONCILED)
|   |-- RiskSignal (senales de fraude)
|   +-- Reconciliation (conciliacion general)
|
+-- POS
|   |-- Register (terminal/caja)
|   |-- CashSession (sesion de caja)
|   |-- POSSale (venta en punto fisico)
|   +-- Receipt (recibo impreso)
|
+-- MARKETPLACE
|   |-- StoreFront (perfil publico del negocio)
|   |-- Search + Categories
|   |-- Discovery (cerca de mi, destacados, Supply patrocinado)
|   |-- MarketplaceFeed (experiencia cross-company)
|   |-- Review + Rating
|   +-- Follow
|
+-- ANALYTICS
|   |-- GMV tracking
|   |-- Revenue Attribution
|   |-- MerchantPerformance
|   |-- CampaignROI
|   +-- UnitEconomics
|
+-- VERTICALS (capability-gated)
|   |-- CarWash (cola, bahias, turnos, comisiones)
|   |-- Excursiones (reservas, vendedores, check-in, liquidaciones)
|   |-- Restaurant (satelite via Platform API)
|   +-- [Futuros: Beauty, Fitness, etc.]
|
+-- PLATFORM OPERATIONS
    |-- Connect (integraciones externas)
    |-- Notifications
    |-- Jobs (QStash)
    |-- AuditLog
    |-- Observability
    +-- Support (tickets)
```

### Extraccion de commerce-primitives (plan gradual)

```
PASO 1: Crear src/lib/commerce-primitives/ con copias de las pure functions
PASO 2: Supply V2 actualiza imports: import { dinero } from '@/lib/commerce-primitives/dinero'
PASO 3: Verificar que todos los tests de Supply V2 siguen pasando
PASO 4: Commerce Core importa desde commerce-primitives
PASO 5: Eliminar archivos originales en supply-v2/core/ (ahora son re-exports o se eliminan)

Archivos a extraer:
  supply-v2/core/dinero.ts    → commerce-primitives/dinero.ts    (103 LOC)
  supply-v2/core/ledger.ts    → commerce-primitives/ledger.ts    (177 LOC)
  supply-v2/core/estados.ts   → commerce-primitives/estados.ts   (210 LOC - factory generico)
  supply-v2/core/comision.ts  → commerce-primitives/comision.ts  (130 LOC)
  supply-v2/core/fefo.ts      → commerce-primitives/fefo.ts      (55 LOC)
  supply-v2/core/numeracion.ts → commerce-primitives/numeracion.ts (76 LOC)

Archivos que NO se extraen (son domain-specific de Supply):
  supply-v2/core/catalogo.ts   (Supply-specific catalog ops)
  supply-v2/core/precios.ts    (Supply-specific pricing)
  supply-v2/core/segregacion.ts (Supply-specific tenant isolation)
  supply-v2/core/config.ts     (Supply-specific config constants)
  supply-v2/core/financiacion.ts (Supply-specific financing splits)
  supply-v2/core/auditoria.ts  (Supply-specific audit helper)
```

### Principio de fuente unica de verdad

```
CatalogItem + CatalogVariant (con default variant para items simples)
    |
    +-- alimenta --> Marketplace (storefronts + feed cross-company)
    +-- alimenta --> POS (busqueda de productos)
    +-- alimenta --> Platform API (satelites)
    +-- sincronizado desde <-- Supply V2 CatalogItem (via Bridge)
    |
Inventory (per variante, per location)
    |
    +-- consultado por --> Marketplace (disponibilidad)
    +-- actualizado por --> POS (venta)
    +-- actualizado por --> Supply (recepcion de lote)
    +-- actualizado por --> Fulfillment (despacho)
    |
Customer (per tenant)
    |
    +-- referenciado por --> Orders
    +-- referenciado por --> Memberships
    +-- referenciado por --> Entitlements
    +-- referenciado por --> Loyalty
    +-- referenciado por --> Supply (derechos)
```

---

## 6. MODELO DE DATOS OBJETIVO

### Entidades principales y relaciones

```
Organization (Company)
    |-- 1:N --> Location (Sucursal)
    |-- 1:N --> CatalogItem
    |-- 1:N --> Customer (Cliente per-tenant)
    |-- 1:N --> Employee (User con rol)
    |-- 1:N --> MembegoOrder
    |-- 1:N --> Promotion
    |-- 1:N --> Campaign
    |-- 1:N --> MerchantLedgerEntry
    +-- 1:1 --> MerchantBillingConfig

CatalogItem
    |-- N:1 --> Organization
    |-- 1:N --> CatalogVariant (minimo 1: default variant auto-creada)
    |-- N:N --> Category (via CatalogItemCategory)
    |-- 1:N --> CatalogItemImage
    |-- 0:1 --> SupplyV2CatalogItem (FK opcional para bridge)
    +-- tipo: PHYSICAL_PRODUCT | SERVICE | BUNDLE | MEMBERSHIP | VOUCHER | DIGITAL_PRODUCT | GIFT_CARD
    +-- capabilities: trackInventory, requiresBooking, requiresRedemption, requiresPreparation, availableMarketplace, availablePOS
    +-- source: MERCHANT | SUPPLY (indica si viene del bridge)

CatalogVariant
    |-- N:1 --> CatalogItem
    |-- 1:N --> InventoryLevel (per location)
    |-- 1:N --> VariantPrice (per location/canal)
    +-- sku, barcode, cost, price, compareAtPrice
    +-- attributes JSON (color, size, etc.)
    +-- isDefault Boolean (true para la variante auto-creada de items simples)
    +-- status, position

InventoryLevel
    |-- N:1 --> CatalogVariant
    |-- N:1 --> Location
    +-- onHand, reserved, available (computed: onHand - reserved), incoming, damaged
    +-- 1:N --> InventoryMovement (ledger append-only via commerce-primitives)

InventoryMovement
    +-- tipo: PURCHASE | SALE | RETURN | TRANSFER_IN | TRANSFER_OUT | ADJUSTMENT | DAMAGE | RESERVATION | RESERVATION_RELEASE
    +-- quantity, reason, userId, orderId, date

MembegoOrder
    |-- N:1 --> Organization
    |-- N:1 --> Location
    |-- N:1 --> Customer
    |-- 1:N --> MembegoOrderLine
    |-- 1:1 --> OrderAttribution
    |-- 0:1 --> CustomerConfirmation
    |-- 0:1 --> PaymentEvidence
    |-- 0:1 --> Redemption
    |-- 1:N --> Commission (en MerchantBilling, NO en Supply Economics)
    +-- estado: CREATED | AWAITING_MERCHANT | IN_PROGRESS | READY | COMPLETED | CANCELLED | REFUNDED
    +-- origin: MARKETPLACE | POS | SUPPLY | EXCURSION | API
    +-- verificationLevel: ATTRIBUTED | REDEEMED | CUSTOMER_VERIFIED | PAYMENT_VERIFIED | FISCALLY_RECONCILED
    +-- qrToken, qrExpiresAt
    +-- customerConfirmedAt, merchantConfirmedAt

MembegoOrderLine
    |-- N:1 --> MembegoOrder
    |-- N:1 --> CatalogVariant (SIEMPRE variante, nunca item directo)
    +-- description, quantity, unitPrice, discount, lineTotal

Commission (MERCHANT BILLING — empresa debe a Membego)
    |-- N:1 --> MembegoOrder
    |-- N:1 --> Organization
    +-- type: CPA_FIXED | PERCENTAGE
    +-- baseAmount, rate, amount
    +-- 1:1 --> MerchantLedgerEntry

MerchantLedgerEntry (APPEND-ONLY, INMUTABLE — Merchant Billing)
    |-- N:1 --> Organization
    +-- type: REDEMPTION_FEE | ORDER_FEE | REFUND | ADJUSTMENT | PAYMENT | CREDIT | PROMOTIONAL_CREDIT
    +-- amount (positive = empresa debe, negative = empresa recibe credito)
    +-- referenceType, referenceId
    +-- balance (running balance via commerce-primitives/ledger)
    +-- INMUTABLE (reversals son nuevas entradas)

MerchantBillingConfig
    |-- 1:1 --> Organization
    +-- feeModel: CPA_FIXED | PERCENTAGE | HYBRID
    +-- cpaAmount, percentageRate
    +-- creditLimit
    +-- billingCycle: WEEKLY | BIWEEKLY | MONTHLY
    +-- status: ACTIVE | SUSPENDED | GRACE_PERIOD

OrderAttribution
    |-- 1:1 --> MembegoOrder
    +-- channel: MARKETPLACE_BROWSE | MARKETPLACE_SEARCH | PROMOTION_CLAIM | CAMPAIGN | REFERRAL | QR_SCAN | SUPPLY_OFFER | DIRECT

Campaign
    |-- N:1 --> Organization
    +-- budget, spent, maxRedemptions, audience, feePerRedemption
    +-- status: DRAFT | ACTIVE | PAUSED | BUDGET_EXHAUSTED | COMPLETED | ARCHIVED
```

### Supply (mantiene su propio subgrafo completo, ya implementado en V2)

```
SupplyV2Supplier
    |-- 1:N --> SupplyV2Agreement
    |-- 1:N --> SupplyV2PurchaseOrder --> SupplyV2Lot --> SupplyV2LedgerEntry
    |-- 1:N --> SupplyV2Allocation --> SupplyV2Offer
    +-- SupplyV2CustomerOrder --> SupplyV2Entitlement --> SupplyV2Voucher --> SupplyV2Redemption
    +-- SupplyV2SupplierInvoice --> SupplyV2SupplierPayment --> SupplyV2Settlement (SUPPLY ECONOMICS)
```

**Supply V2 ya esta construido (90-95% completo, ~31K LOC, ~21K LOC tests).** Su finance (invoices, deposits, payments, obligations, settlements, reconciliation, economic events) es exclusivamente **Supply Economics** — dinero entre Membego y proveedores. NUNCA se mezcla con Merchant Billing.

**Supply → Marketplace Bridge** (Fase 2.5): El bridge crea `CatalogItem` (source=SUPPLY) sincronizados desde `SupplyV2CatalogItem`, expone `SupplyV2Offer` en el marketplace publico, y cuando un `SupplyV2CustomerOrder` se completa, genera un `MembegoOrder` wrapper para atribucion (sin duplicar la order de Supply).

---

## 7. MATRIZ DE MODULOS

### KEEP (mantener sin cambios)

| Modulo | Ubicacion | Razon |
|---|---|---|
| Auth/JWT/Guards | `src/lib/auth/` | Maduro, seguro, fail-closed |
| Middleware/Proxy | `src/proxy.ts` | Funcional, role-based routing |
| QStash Jobs | `src/lib/jobs/`, `src/modules/jobs/` | 9 tipos idempotentes, dead letter queue |
| Sentry | `sentry.*.config.ts` | Observabilidad activa |
| Connect Framework | `src/modules/connect/` | 50+ archivos, Meta/WhatsApp/OAuth |
| Platform API v1 | `src/modules/plataforma/`, `src/app/api/platform/` | OAuth2, contracts, SDK |
| Geo/Segmentation | `src/modules/geo/` | Geocoding, consent, segmentos |
| **Supply V2 completo** | `src/modules/supply-v2/` (113 archivos, ~31K LOC) | 90-95% completo. Sus pure functions genericas se extraen a commerce-primitives; el resto del modulo no se toca |
| AuditLog | Modelo `AuditLog` | 150 acciones auditadas |
| CI/CD Workflows | `.github/workflows/` | Incluye verificacion RLS |
| Capability System | `capacidades` JSON en Company | Feature flags necesarios para rollout progresivo |

### KEEP + IMPROVE

| Modulo | Ubicacion | Mejora necesaria |
|---|---|---|
| Multi-tenancy/RLS | `src/lib/tenant.ts`, migraciones RLS | Completar rollout de RLS por dominio a TODAS las tablas |
| CardNET Payments | `src/lib/payments/cardnet-*` | Integrar al Payment Provider Registry. Preparar para split payments |
| Permission System | `src/lib/auth/permissions.ts` | Agregar secciones para nuevos modulos (catalog, orders, billing, supply-marketplace) |
| Sucursal/Location | Modelo `Sucursal` | Extender para soportar inventario y precios por ubicacion |
| Customer (Cliente) | Modelo `Cliente` | Agregar campos para merchant billing (credit limit, balance) |
| Marketplace UI | `src/components/marketplace/`, `(public)/` routes | Extender con feed cross-company, busqueda, categorias, supply patrocinado |
| Scanner QR | `src/components/scanner/` | Extender para soportar MembegoOrder redemption ademas de membership/supply |
| Notification system | `Notificacion` modelo, ~80 tipos | Agregar tipos para orders, billing, campaign budget |
| Reports | `src/modules/reportes/` | Agregar reportes de atribucion, billing, GMV |

### REFACTOR

| Modulo | Ubicacion | Que cambiar |
|---|---|---|
| Promotion Engine | `src/lib/promotions/`, modelo `Promotion` (motores) | Separar motor de calculo de entidades de negocio. Motor calcula efecto; Deal/Coupon son entidades que USAN el motor |
| Promotion Entity | `src/modules/promociones/`, modelo `Promocion` | Evolucionar `Promocion` para que pueda funcionar como Deal (oferta temporal marketplace) |
| Benefit Engine | `src/lib/benefits/` | Generalizar para que Entitlements del marketplace general usen el mismo motor |
| Transaction Engine | `src/lib/transactions/` | Extender para generar codigos de MembegoOrder (MBG-YYYYMMDD-NNNNNN) |
| POS (Caja) | `src/modules/caja/` | Conectar a CatalogItem, Promotion, Customer identification |

### EXTRACT (nuevo — mover a capa compartida)

| Archivo Supply V2 | Destino commerce-primitives | LOC | Consumido por |
|---|---|---|---|
| `supply-v2/core/dinero.ts` | `commerce-primitives/dinero.ts` | 103 | Supply V2, Commerce Core, Billing |
| `supply-v2/core/ledger.ts` | `commerce-primitives/ledger.ts` | 177 | Supply V2, MerchantLedger, InventoryMovement |
| `supply-v2/core/estados.ts` | `commerce-primitives/estados.ts` | 210 | Supply V2, MembegoOrder, Redemption |
| `supply-v2/core/comision.ts` | `commerce-primitives/comision.ts` | 130 | Supply V2, Merchant Commission |
| `supply-v2/core/fefo.ts` | `commerce-primitives/fefo.ts` | 55 | Supply V2, Inventory |
| `supply-v2/core/numeracion.ts` | `commerce-primitives/numeracion.ts` | 76 | Supply V2, MembegoOrder codes |

### MERGE

| Modulos a fusionar | Resultado | Razon |
|---|---|---|
| `Promocion` (promociones.prisma) + `Promotion` (motores.prisma) | Promotion unificado | Dos representaciones del mismo concepto. Motor debe servir a la entidad, no ser paralelo |

### REPLACE (crear nuevo, migrar datos)

| Viejo | Nuevo | Razon | Migracion |
|---|---|---|---|
| Supply V1 (30 modelos) | Supply V2 (66 modelos) | V2 es superior en todo: ledger, outbox, loyalty, finance | Migrar datos pendientes de V1 a V2, desactivar V1 |

### CREATE (nuevos modulos — consumiendo commerce-primitives)

| Modulo | Proposito | Prioridad | commerce-primitives usado |
|---|---|---|---|
| **CatalogItem + CatalogVariant** | Catalogo unificado con default variant | ALTA (F1) | `numeracion` (SKU auto), `estados` (lifecycle) |
| **InventoryLevel + InventoryMovement** | Inventario general con ledger | ALTA (F2) | `ledger`, `fefo` |
| **MembegoOrder + OrderLine** | Pedido marketplace con atribucion | CRITICA (F3) | `estados`, `numeracion`, `dinero` |
| **Supply → Marketplace Bridge** | Sincroniza Supply items al marketplace | CRITICA (F2.5) | — (orquesta Supply V2 + Catalog) |
| **Marketplace Discovery** | Feed cross-company con busqueda | CRITICA (F2.5) | — |
| **OrderAttribution** | Registro de origen del pedido | CRITICA (F3) | — |
| **CustomerConfirmation** | Confirmacion dual de montos | ALTA (F3) | `dinero` |
| **PaymentEvidence** | Registro de pago externo | ALTA (F3) | — |
| **Commission (Merchant)** | Calculo de comision Membego a empresa | CRITICA (F4) | `comision`, `dinero` |
| **MerchantLedgerEntry** | Estado de cuenta empresa → Membego | CRITICA (F4) | `ledger` |
| **MerchantBillingConfig** | Config de billing por empresa | ALTA (F4) | — |
| **MerchantStatement** | Corte periodico | MEDIA (F4) | `dinero` |
| **Deal** | Oferta temporal en marketplace | ALTA (F5) | `estados` |
| **Campaign (marketplace)** | Campanas con presupuesto prepago | ALTA (F5) | `dinero` |
| **Cart + CartLine** | Carrito per-merchant | MEDIA (F7) | — |

### HIDE (ocultar — estrategia moderada, RESUELTO)

Ver seccion 8 detallada.

**Principio**: Supply V1, Gamificacion, Blog, Home Builder se ocultan. CRM y Mensajeria se mantienen para empresas que ya los usan, pero se desactivan por defecto para nuevos tenants via capabilities.

### DEPRECATE

| Modulo | Razon | Timeline |
|---|---|---|
| Supply V1 | Reemplazado por Supply V2 | Migrar datos restantes, luego deprecar |
| `GrowthWallet` | Sera reemplazado por Promotional Credits o unificado con Loyalty | Post fase 5 |

---

## 8. MODULOS A OCULTAR (estrategia moderada — RESUELTO)

### 8.1 Supply V1

| | |
|---|---|
| **Nombre** | Supply V1 |
| **Ubicacion** | `prisma/schema/supply.prisma` (30 modelos), `src/modules/supply/`, routes admin/superadmin, `/api/cron/supply` |
| **Motivo** | Supply V2 lo reemplaza completamente |
| **Como ocultarlo** | Capability `SUPPLY_V1`. Remover de nav-config para empresas sin esa capability. Mantener cron para datos existentes |
| **Cuando deberia regresar** | NUNCA. Migrar a V2 y deprecar permanentemente |

### 8.2 Gamificacion / Ruleta

| | |
|---|---|
| **Nombre** | Gamificacion (Ruleta de premios) |
| **Ubicacion** | `src/modules/gamificacion/`, routes admin/cliente, modelos `RuletaPremio`, `RuletaJugada` |
| **Motivo** | No alineada con la estrategia marketplace. Entretenimiento, no motor de negocio |
| **Como ocultarlo** | Capability `GAMIFICACION`. Ocultar si no tiene esa capability |
| **Cuando deberia regresar** | Cuando el Growth Engine consolidado pueda incorporarla como tipo de Campaign |

### 8.3 Blog / Publicaciones

| | |
|---|---|
| **Nombre** | Publicaciones (CompanyPost) |
| **Ubicacion** | `src/app/(admin)/admin/publicaciones/`, modelo `CompanyPost` |
| **Motivo** | Red social ligera que no contribuye al ciclo transaccional |
| **Como ocultarlo** | Remover de nav-config. Los datos persisten |
| **Cuando deberia regresar** | Cuando marketplace tenga volumen suficiente para justificar contenido social |

### 8.4 Home Builder

| | |
|---|---|
| **Nombre** | Home page customization |
| **Ubicacion** | `prisma/schema/home.prisma`, modelos `HomeRevision`, `HomeBloque` |
| **Motivo** | Pagina personalizable es secundaria frente al marketplace |
| **Como ocultarlo** | Capability `HOME_BUILDER` |
| **Cuando deberia regresar** | Cuando el storefront por empresa sea una feature clave |

### 8.5 CRM (mantener para existentes, desactivar para nuevos)

| | |
|---|---|
| **Nombre** | CRM (Prospectos, Leads, Pipeline) |
| **Ubicacion** | `prisma/schema/crm.prisma`, `src/modules/crm/`, routes admin |
| **Motivo** | Funcionalidad B2B util pero no prioritaria para el ciclo marketplace |
| **Como ocultarlo** | Capability `CRM_AVANZADO`. **Empresas existentes que lo usan lo conservan. Nuevos tenants lo tienen desactivado por defecto** |
| **Cuando deberia regresar** | Activable en cualquier momento via capability. Cuando el enfoque pase a adquisicion empresarial escalada |

### 8.6 Mensajeria / WhatsApp avanzado (mantener para existentes, desactivar para nuevos)

| | |
|---|---|
| **Nombre** | Mensajeria interna + WhatsApp avanzado |
| **Ubicacion** | `prisma/schema/mensajeria.prisma`, routes admin whatsapp/comunicacion |
| **Motivo** | Canal de comunicacion secundario |
| **Como ocultarlo** | Capability `MENSAJERIA_AVANZADA`. **Empresas existentes que lo usan lo conservan. Nuevos tenants lo tienen desactivado por defecto.** Mantener notificaciones basicas (que son del sistema, no de este modulo) |
| **Cuando deberia regresar** | Activable en cualquier momento. Cuando exista un engagement layer consolidado |

---

## 9. RIESGOS CRITICOS

### Tecnicos

| Riesgo | Severidad | Mitigacion |
|---|---|---|
| **RLS incompleto**: No todas las tablas tienen politicas RLS per-domain | ALTA | Completar rollout en F0. CI verifica cobertura |
| **Supply V1/V2 coexistencia**: Dos sistemas paralelos | MEDIA | Migrar datos activos, desactivar V1 en F0 |
| **POS desconectado**: No sabe de catalogo ni promotions | ALTA | Fase 7 conecta POS a Commerce Core |
| **Cinco tipos de orden**: Inconsistencia en ventas/transacciones | ALTA | MembegoOrder como capa de atribucion |
| **commerce-primitives extraction risk**: Cambiar imports de Supply V2 puede romper tests | MEDIA | Extraccion gradual con re-exports temporales en supply-v2/core/ |
| **Supply Bridge complexity**: Sincronizar Supply items → CatalogItem puede crear inconsistencias | MEDIA | Sync unidireccional: Supply → Catalog. Supply es master |
| **CardNET fuera del Provider Registry** | BAJA | Integrar cuando sea necesario |
| **Server Action sprawl**: 80+ modulos sin enforcement uniforme | MEDIA | Documentar patron estandar |

### Comerciales

| Riesgo | Severidad | Mitigacion |
|---|---|---|
| **Sin billing, no hay revenue** | CRITICA | Prioridad maxima: Merchant Billing en F4 |
| **Sin marketplace commerce, no hay GMV** | CRITICA | MembegoOrder + Supply Bridge como prioridades tempranas |
| **Supply sin presencia publica**: Supply V2 esta listo pero los consumidores no pueden ver/comprar sus productos | ALTA | Supply → Marketplace Bridge en F2.5 |
| **Fraude por transacciones fuera de plataforma** | INHERENTE | Incentivos: beneficio depende de Membego. CustomerConfirmation |

---

## 10. PLAN MAESTRO POR FASES

### FASE 0: Foundation Hardening

| | |
|---|---|
| **Nombre** | Foundation Hardening + Commerce Primitives |
| **Objetivo** | Asegurar integridad de datos, ocultar modulos, y establecer la capa compartida commerce-primitives |
| **Dependencias** | Ninguna |
| **Modulos afectados** | tenant.ts, RLS policies, supply V1, nav-config, capabilities, supply-v2/core/ |

**Que hacer:**
1. Completar RLS rollout per-domain a TODAS las tablas con companyId
2. Formalizar capability system: enum en codigo, no solo strings magicos
3. Ocultar modulos (estrategia moderada): Supply V1, Gamificacion, Blog, Home Builder. CRM y Mensajeria desactivados por defecto para nuevos tenants
4. Extraer pure functions de supply-v2/core/ → src/lib/commerce-primitives/: dinero, ledger, estados, comision, fefo, numeracion
5. Actualizar imports de Supply V2 para consumir desde commerce-primitives
6. Verificar que TODOS los tests de Supply V2 siguen pasando (~21K LOC de tests)

| | |
|---|---|
| **Riesgos** | RLS policies mal escritas podrian bloquear queries. Cambio de imports puede romper Supply V2 |
| **Tests** | CI existente de RLS coverage. Correr full suite de Supply V2 despues de extraccion |
| **Criterios de aceptacion** | 100% tablas con companyId tienen RLS policy. Supply V1 oculto. Modulos secundarios ocultos via capabilities. CRM/Mensajeria desactivados por defecto en nuevos tenants. commerce-primitives funcional con Supply V2 consumiendolas. Todos los tests pasan |
| **Categoria** | FOUNDATION |
| **Duracion estimada** | 2 semanas |

---

### FASE 1: Commerce Core - Catalogo con Variantes

| | |
|---|---|
| **Nombre** | Commerce Core - Catalogo Unificado con Variantes desde el Dia 1 |
| **Objetivo** | Crear CatalogItem + CatalogVariant como fuente unica para lo que un negocio vende |
| **Dependencias** | Fase 0 (commerce-primitives disponibles) |
| **Modulos afectados** | Nuevo modulo `catalog`. Prisma schema. Admin UI. Marketplace UI |
| **Nuevas entidades** | `CatalogItem`, `CatalogVariant`, `CatalogItemCategory`, `CatalogItemImage`, `VariantAttribute` |

**CatalogItem + CatalogVariant schema:**
```
CatalogItem
  id, companyId, name, slug, description
  type: PHYSICAL_PRODUCT | SERVICE | BUNDLE | MEMBERSHIP | VOUCHER | DIGITAL_PRODUCT | GIFT_CARD
  status: DRAFT | ACTIVE | PAUSED | ARCHIVED
  capabilities JSON: {
    trackInventory, requiresBooking, requiresRedemption,
    requiresPreparation, availableMarketplace, availablePOS
  }
  source: MERCHANT | SUPPLY (para el bridge)
  supplyV2CatalogItemId (FK opcional — para items sincronizados desde Supply)
  images, position (ordering)
  
CatalogVariant
  id, catalogItemId, name
  sku (auto-generado si no se proporciona)
  barcode (opcional)
  price, cost, compareAtPrice
  attributes JSON (color, size, flavor, etc.)
  isDefault Boolean (true para variante auto-creada en items simples)
  status: ACTIVE | OUT_OF_STOCK | DISCONTINUED
  position
```

**Comportamiento de default variant:**
- Al crear un CatalogItem simple (ej: "Lavado basico"), el sistema crea automaticamente una CatalogVariant con `isDefault=true`, `name="Default"`, `sku=auto`
- La UI admin NO muestra el selector de variantes cuando solo existe la default
- Cuando el usuario agrega una segunda variante, la default deja de ser default y se muestra el selector
- Pedidos, inventario y promotions SIEMPRE referencian CatalogVariant, nunca CatalogItem directamente
- Esto evita migrar pedidos/inventario/promotions en el futuro cuando se agreguen variantes

| | |
|---|---|
| **Backend** | CRUD de CatalogItem + Variants con auto-creation de default. Server Actions en `src/modules/catalog/`. Validaciones Zod. Bulk import |
| **Frontend** | Admin: seccion "Catalogo" con lista, creacion, edicion. Variantes visibles solo cuando >1. Imagenes. Marketplace: CatalogItems en storefront de empresa + inicio del feed cross-company |
| **Permisos** | Nueva seccion `catalogo` con funciones: ver, crear, editar, eliminar, publicar |
| **Eventos** | `CatalogItemCreated`, `CatalogItemPublished`, `CatalogItemUpdated`, `CatalogVariantCreated` |
| **Integraciones** | Platform API: GET/POST /catalog-items, GET/POST /catalog-variants |
| **Riesgos** | Coexistencia con `Promocion.esComprable`. Ambos se muestran en marketplace temporalmente |
| **Tests** | Unit: CRUD, validaciones, slug uniqueness, auto default variant. DB: RLS isolation. E2E: crear item simple (default variant oculta), crear item con variantes, ver en marketplace |
| **Criterios de aceptacion** | Empresa crea CatalogItems. Items simples tienen default variant invisible en UI. Items con variantes muestran selector. Items publicados aparecen en marketplace (storefront + inicio de feed cross-company). Platform API expone catalogo |
| **Categoria** | FOUNDATION |
| **Duracion estimada** | 3 semanas |

---

### FASE 2: Commerce Core - Inventario

| | |
|---|---|
| **Nombre** | Commerce Core - Inventario con Ledger |
| **Objetivo** | Implementar inventario real por variante y ubicacion con movimientos inmutables |
| **Dependencias** | Fase 1 (CatalogVariant) |
| **Modulos afectados** | Nuevo modulo `inventory`. CatalogVariant (relacion). Location |
| **Nuevas entidades** | `InventoryLevel`, `InventoryMovement` |

**Schema (usando commerce-primitives/ledger):**
```
InventoryLevel
  id, catalogVariantId, locationId
  onHand, reserved, available (computed: onHand - reserved), incoming, damaged
  lowStockThreshold
  @@unique([catalogVariantId, locationId])
  
InventoryMovement (APPEND-ONLY — usa commerce-primitives/ledger pattern)
  id, inventoryLevelId
  type: PURCHASE | SALE | RETURN | TRANSFER_IN | TRANSFER_OUT |
        ADJUSTMENT | DAMAGE | RESERVATION | RESERVATION_RELEASE
  quantity (positive or negative)
  previousOnHand, newOnHand
  reason, userId, orderId, referenceType, referenceId
  createdAt
```

| | |
|---|---|
| **Backend** | Stock adjustment, reservations con TTL, transfers entre sucursales, low stock alerts. Invariante via commerce-primitives: available nunca negativo |
| **Frontend** | Admin: inventario por producto/variante, movimientos, ajustes. Dashboard: alertas low stock |
| **Permisos** | Seccion `inventario`: ver, ajustar, transferir |
| **Riesgos** | Concurrencia en reservations. SELECT FOR UPDATE o optimistic locking |
| **Tests** | Unit: movimientos, invariantes (no negativo). DB: concurrent reservations. E2E: ajustar stock |
| **Criterios de aceptacion** | Inventario por variante y ubicacion funcional. Ledger inmutable. Reservations con TTL |
| **Categoria** | FOUNDATION |
| **Duracion estimada** | 2 semanas |

---

### FASE 2.5: Supply → Marketplace Bridge + Marketplace Discovery

| | |
|---|---|
| **Nombre** | Supply Bridge y Experiencia de Descubrimiento Cross-Company |
| **Objetivo** | (1) Supply V2 items aparecen en el marketplace publico para que consumidores puedan descubrir y comprar productos/servicios que Membego adquirio. (2) El marketplace tiene una experiencia minima de descubrimiento cross-company |
| **Dependencias** | Fase 1 (CatalogItem), Supply V2 existente |
| **Modulos afectados** | Supply V2, Catalog, Marketplace UI, nuevo modulo `supply-bridge` |
| **Nuevas entidades** | No (reutiliza CatalogItem con source=SUPPLY) |

**Supply Bridge — que hace:**

```
SupplyV2CatalogItem (master)
        |
        v
  [sync unidireccional]
        |
        v
CatalogItem (source=SUPPLY, supplyV2CatalogItemId=FK)
  +-- CatalogVariant (isDefault=true, price from SupplyV2Offer)
        |
        v
  Visible en marketplace publico
        |
        v
  Cliente compra → SupplyV2 checkout existente
  (no se duplica el checkout — se usa el de Supply V2)
        |
        v
  SupplyV2CustomerOrder completada
        |
        v
  Se genera MembegoOrder (origin=SUPPLY, wrapper para atribucion)
```

**Sincronizacion:**
- Supply es MASTER. CatalogItem con source=SUPPLY es read-only para el admin de empresa
- Cuando SupplyV2CatalogItem cambia (nombre, precio, status), el bridge actualiza el CatalogItem
- Cuando SupplyV2Offer se activa/desactiva, el CatalogItem se publica/despublica
- La sincronizacion es event-driven (via outbox existente de Supply V2)

**Marketplace Discovery — que hace:**

```
/marketplace (o ruta equivalente)
  |
  +-- Busqueda por texto (nombre, categoria, empresa)
  +-- Filtro por categoria
  +-- Filtro por ubicacion / "cerca de mi"
  +-- Ofertas destacadas (deals de empresas + ofertas Supply)
  +-- Productos y servicios de multiples empresas
  +-- Supply patrocinado (productos que Membego regala/vende con descuento)
```

| | |
|---|---|
| **Backend** | Sync service: escucha outbox Supply V2 → crea/actualiza CatalogItem. Query de marketplace: busca CatalogItems publicados cross-company con filtros. MembegoOrder wrapper al completar SupplyV2CustomerOrder |
| **Frontend** | (1) Pagina de marketplace cross-company con busqueda, categorias, Supply patrocinado. (2) CatalogItems de Supply visibles en storefronts de empresa. (3) El flow de compra de Supply items usa el checkout existente de Supply V2 |
| **Permisos** | Supply bridge es interno (superadmin). Marketplace discovery es publico |
| **Eventos** | `SupplyCatalogSynced`, `SupplyOfferPublished`, `SupplyOrderAttributed` |
| **Riesgos** | Inconsistencia si sync falla. Supply V2 debe seguir siendo master. Checkout de Supply V2 no se duplica |
| **Tests** | Unit: sync logic, attribute mapping. DB: bridge creates correct CatalogItem. E2E: Supply item visible en marketplace, compra via Supply checkout, MembegoOrder generado |
| **Criterios de aceptacion** | (1) Supply V2 items aparecen automaticamente en marketplace publico. (2) Experiencia de descubrimiento cross-company funcional con busqueda y categorias. (3) Supply patrocinado destacado. (4) Compra de Supply items funciona (usa checkout Supply V2). (5) MembegoOrder de atribucion generado al completar compra Supply |
| **Categoria** | STRATEGIC (prioridad de lanzamiento) |
| **Duracion estimada** | 3 semanas |

---

### FASE 3: Membego Order + Attribution

| | |
|---|---|
| **Nombre** | Membego Order y Motor de Atribucion |
| **Objetivo** | Crear el pedido central del marketplace con atribucion de origen, confirmacion dual y base para comisiones |
| **Dependencias** | Fase 1 (CatalogVariant), Fase 2 (InventoryLevel para reservations cuando aplique) |
| **Modulos afectados** | Nuevo modulo `orders`. Inventory (reservations). QR (redemption). Customer |
| **Nuevas entidades** | `MembegoOrder`, `MembegoOrderLine`, `OrderAttribution`, `CustomerConfirmation`, `PaymentEvidence` |

**MembegoOrder schema (usa commerce-primitives):**
```
MembegoOrder
  id, code (MBG-YYYYMMDD-NNNNNN via commerce-primitives/numeracion)
  companyId, locationId, customerId
  status: CREATED | AWAITING_MERCHANT | IN_PROGRESS | READY | COMPLETED | CANCELLED | REFUNDED
    (state machine via commerce-primitives/estados)
  origin: MARKETPLACE | POS | SUPPLY | EXCURSION | API
  subtotal, discount, commissionableBase, tax, total
    (money via commerce-primitives/dinero)
  paymentMethod: CASH | CARD | TRANSFER | MEMBEGO_CHECKOUT | OTHER
  verificationLevel: ATTRIBUTED | REDEEMED | CUSTOMER_VERIFIED | PAYMENT_VERIFIED | FISCALLY_RECONCILED
  qrToken, qrExpiresAt
  
MembegoOrderLine
  id, orderId
  catalogVariantId (SIEMPRE variante, nunca item directo)
  description, quantity, unitPrice, discount, lineTotal
  
OrderAttribution
  id, orderId
  channel: MARKETPLACE_BROWSE | MARKETPLACE_SEARCH | PROMOTION_CLAIM | CAMPAIGN | REFERRAL | QR_SCAN | SUPPLY_OFFER | DIRECT
  campaignId, promotionId, referralCode, supplyV2OfferId
```

| | |
|---|---|
| **Backend** | Crear orden desde marketplace (claim oferta). Merchant view: ver pedido, ajustar monto, marcar listo. Customer: confirmar monto. Employee: escanear QR. State machine con transiciones validadas |
| **Frontend** | Admin: panel "Pedidos Membego". Cliente: mis pedidos, confirmar, QR. Scanner: tipo MEMBEGO_ORDER |
| **Permisos** | Seccion `pedidos_membego`: ver, gestionar, cancelar, reembolsar |
| **Eventos** | `OrderCreated`, `OrderConfirmed`, `OrderReady`, `OrderCompleted`, `OrderCancelled` |
| **Riesgos** | Complejidad del state machine. Race conditions en confirmacion dual. Supply Bridge tambien genera MembegoOrders |
| **Tests** | Unit: state machine, attribution, confirmation. DB: concurrent order completion. E2E: flow completo marketplace → claim → visit → scan → complete |
| **Criterios de aceptacion** | Empresa recibe pedido Membego. Puede ajustar monto. Cliente confirma. QR cierra operacion. Attribution registrada. Supply Bridge genera MembegoOrder correctamente |
| **Categoria** | FOUNDATION + STRATEGIC |
| **Duracion estimada** | 3 semanas |

---

### FASE 4: Merchant Billing

| | |
|---|---|
| **Nombre** | Merchant Billing - Comisiones y Estado de Cuenta |
| **Objetivo** | Facturacion de comisiones Membego a empresas basada en redenciones verificadas |
| **Dependencias** | Fase 3 (MembegoOrder completado) |
| **Modulos afectados** | Nuevo modulo `billing` (SEPARADO de Supply Economics). MembegoOrder (trigger). Company |
| **Nuevas entidades** | `MerchantBillingConfig`, `Commission`, `MerchantLedgerEntry`, `MerchantStatement` |

**SEPARACION ESTRICTA:**
```
src/modules/billing/          ← Merchant Billing (empresa → Membego)
src/modules/supply-v2/finance/ ← Supply Economics (Membego → proveedor)
```

Estos modulos NUNCA comparten tablas ni ledgers. Ambos usan commerce-primitives/ledger y commerce-primitives/dinero pero con entidades distintas.

**Schema (usa commerce-primitives):**
```
MerchantBillingConfig
  id, companyId (unique)
  feeModel: CPA_FIXED | PERCENTAGE | HYBRID
  cpaAmount (for CPA), percentageRate (for 8%)
  creditLimit
  billingCycle: WEEKLY | BIWEEKLY | MONTHLY
  status: ACTIVE | SUSPENDED | GRACE_PERIOD

Commission
  id, orderId, companyId
  type: CPA_FIXED | PERCENTAGE
    (CPA cuando verificationLevel < PAYMENT_VERIFIED)
    (PERCENTAGE cuando verificationLevel >= PAYMENT_VERIFIED o checkout/POS)
  baseAmount, rate, amount
    (calculo via commerce-primitives/comision)
  status: PENDING | CONFIRMED | REVERSED

MerchantLedgerEntry (APPEND-ONLY — via commerce-primitives/ledger)
  id, companyId
  type: REDEMPTION_FEE | ORDER_FEE | REFUND | ADJUSTMENT | PAYMENT | CREDIT | PROMOTIONAL_CREDIT
  amount (positive = empresa debe, negative = credito)
  referenceType, referenceId
  balance (running balance)

MerchantStatement
  id, companyId
  period, totalOrders, totalGMV, totalCommissions
  adjustments, credits, payments, amountDue
  generatedAt
```

| | |
|---|---|
| **Backend** | Al completar MembegoOrder: calcular comision segun config Y verificationLevel. CPA si sin evidencia financiera, 8% si con evidencia. Crear LedgerEntry. Verificar credit limit. Si excede: suspender campanas. Cron: generar statements |
| **Frontend** | Admin (empresa): "Mi cuenta Membego" con balance, historial, statements. Superadmin: cobros pendientes, pagos, aging |
| **Permisos** | Seccion `facturacion_membego` (superadmin), vista read-only para admin |
| **Riesgos** | Disputas sobre montos. Necesita proceso de adjustment |
| **Tests** | Unit: calculo CPA y %, ledger invariantes, credit limit. E2E: order → commission → ledger → statement |
| **Criterios de aceptacion** | Comision calculada automaticamente. CPA o 8% segun nivel de verificacion. Ledger inmutable. Statements. Credit limit enforced. Supply Economics NUNCA toca este ledger |
| **Categoria** | STRATEGIC (CRITICA para monetizacion) |
| **Duracion estimada** | 2-3 semanas |

---

### FASE 5: Growth Engine - Deals y Campaigns con Budget

| | |
|---|---|
| **Nombre** | Growth Engine - Ofertas Marketplace y Campanas con Presupuesto |
| **Objetivo** | Empresas crean ofertas atractivas con presupuesto definido y fee por redencion |
| **Dependencias** | Fase 3 (MembegoOrder), Fase 4 (Billing) |
| **Modulos afectados** | Refactorizar `promociones`. Nuevo concepto `Deal`. Campaign engine |

**Flujo:**
```
Empresa crea Deal
  "20% en primera visita"
  Presupuesto: RD$5,000
  Fee Membego: RD$100 por redencion (CPA)
  Max 50 clientes
    |
    v
Deal visible en Marketplace (storefront + feed cross-company)
    |
    v
Cliente "Obtener oferta"
    |
    v
MembegoOrder creado (status: CREATED)
Entitlement + Voucher con QR
    |
    v
Cliente visita negocio → QR → Redemption
    |
    v
MembegoOrder → COMPLETED
Commission (CPA) → MerchantLedger
CampaignBudget.spent += fee
    |
    v
Si spent >= budget: Deal desactivado automaticamente
```

| | |
|---|---|
| **Backend** | Deal CRUD con budget. "Obtener oferta" crea order + entitlement + voucher. Redemption conectado a billing. Budget exhaustion auto-pausa |
| **Frontend** | Admin: wizard de Deal. Dashboard performance. Cliente: deals en marketplace, obtener, mis vouchers. Marketplace: deals destacados junto a Supply patrocinado |
| **Riesgos** | Double-claim, double-redemption, budget race condition |
| **Tests** | Unit: budget tracking, double-claim prevention. DB: concurrent claims vs budget. E2E: create → claim → redeem → billing |
| **Criterios de aceptacion** | Empresa crea Deal con budget. Cliente obtiene y canjea. Billing automatico. Budget auto-pausa |
| **Categoria** | STRATEGIC |
| **Duracion estimada** | 3-4 semanas |

---

### FASE 6: Analytics y Revenue Attribution

| | |
|---|---|
| **Nombre** | Analytics, GMV y Revenue Attribution |
| **Objetivo** | Dashboards de GMV, atribucion, performance de campanas y Supply |
| **Dependencias** | Fases 3-5 (Orders, Billing, Deals, Supply Bridge) |

**Reports que construir:**
```
Para la empresa:
  - Membego Revenue Attribution: "Membego te produjo X clientes, Y pedidos, Z en ventas"
  - Comisiones pagadas vs ROI
  - Performance de cada Deal/Campaign
  - Clientes nuevos vs recurrentes via Membego

Para Membego (superadmin):
  - GMV total y por empresa
  - Take rate (comisiones / GMV)
  - Supply performance (redenciones, unit economics — datos de Supply Economics, separado de Merchant Billing)
  - Pedidos completados por canal (marketplace, supply, POS)
  - Ticket promedio
  - Conversiones oferta → compra
  - Marketplace discovery metrics (busquedas, clicks, conversiones)
```

| | |
|---|---|
| **Criterios de aceptacion** | Empresa ve cuanto le produce Membego. Superadmin ve GMV y health. Supply economics visibles pero separados de merchant billing en dashboards |
| **Categoria** | STRATEGIC |
| **Duracion estimada** | 2-3 semanas |

---

### FASE 7: POS Evolution

| | |
|---|---|
| **Nombre** | POS Conectado a Commerce Core |
| **Objetivo** | Conectar POS a CatalogItem, Promotions, Customer, Inventory |
| **Dependencias** | Fases 1-3 |

**Flujo POS mejorado:**
```
Cliente llega fisicamente → Empleado abre POS
    → Busca producto en CatalogItem (variantes)
    → Identifica cliente (QR Membego / telefono)
    → Membego detecta: "Cliente tiene cupon BIENVENIDO20"
    → Aplica descuento
    → Cobra (efectivo / CardNET / transferencia)
    → MembegoOrder(origin=POS, verificationLevel=PAYMENT_VERIFIED)
    → InventoryMovement(SALE)
    → Commission 8% (porque POS verifica pago)
```

Cuando el POS verifica el pago, la comision puede ser 8% en lugar de CPA fijo.

| | |
|---|---|
| **Criterios de aceptacion** | POS vende CatalogItems (variantes). Identifica clientes. Aplica promotions. Genera MembegoOrder con verificationLevel adecuado |
| **Categoria** | STRATEGIC |
| **Duracion estimada** | 4-5 semanas |

---

### FASE 8: Marketplace Checkout

| | |
|---|---|
| **Nombre** | Marketplace Cart + Checkout |
| **Objetivo** | Compra directa desde marketplace con carrito, checkout, pago y pickup |
| **Dependencias** | Fases 1-3, F4 (billing) |

**Flujo:**
```
Cliente busca en marketplace → Agrega al carrito (per-merchant, variantes)
    → Checkout: selecciona sucursal
    → Verifica inventario por variante en esa ubicacion
    → Reserva inventario (TTL 15 min)
    → Aplica cupon
    → Pago (CardNET o pago en establecimiento)
    → MembegoOrder(origin=MARKETPLACE, verificationLevel segun metodo de pago)
    → Empresa notificada → Prepara → READY
    → Cliente recoge → QR → COMPLETED
    → Commission: 8% si pago verificado, CPA si pago en establecimiento
```

| | |
|---|---|
| **Criterios de aceptacion** | Compra completa marketplace con pago y pickup. Commission ajustada al nivel de verificacion |
| **Categoria** | STRATEGIC |
| **Duracion estimada** | 4-5 semanas |

---

### FASE 9: Advanced Features

| | |
|---|---|
| **Nombre** | Features Avanzados |
| **Contenido** | Loyalty consolidado, Membership evolution, Merchant Risk Engine, Fiscal integration (e-NCF), CardNET split payments, Reconciliation avanzada |
| **Dependencias** | Fases 1-8 |
| **Categoria** | LATER |

---

## 11. DEPENDENCIAS ENTRE FASES (CAMINO CRITICO)

```
FASE 0: Foundation + Commerce Primitives
    |
    +---> FASE 1: Catalog con Variantes (necesita commerce-primitives)
    |         |
    |         +---> FASE 2: Inventory (necesita CatalogVariant)
    |         |
    |         +---> FASE 2.5: Supply Bridge + Marketplace Discovery
    |         |       (necesita CatalogItem + Supply V2 existente)
    |         |       |
    |         |       +---> [alimenta marketplace con contenido real]
    |         |
    |         +---> FASE 3: Orders (necesita CatalogVariant, opcional: Inventory)
    |                   |
    |                   +---> FASE 4: Billing (necesita Orders completed)
    |                   |         |
    |                   |         +---> FASE 5: Deals/Campaigns (necesita Orders + Billing)
    |                   |         |         |
    |                   |         |         +---> FASE 6: Analytics (necesita data Orders + Billing + Deals + Supply)
    |                   |         |
    |                   |         +---> FASE 8: Marketplace Checkout (necesita Orders + Billing + Catalog + Inventory)
    |                   |
    |                   +---> FASE 7: POS (necesita Catalog + Orders + opcional Inventory)
    |
    +---> FASE 9: Advanced (necesita todo lo anterior)
```

### Camino critico para monetizacion:

```
F0 → F1 → F2.5 → F3 → F4
(~13-14 semanas hasta revenue real)
```

F2 (Inventory) corre en PARALELO con F2.5 pero NO es bloqueante para Orders (F3) — muchas categorias iniciales son servicios que no necesitan inventario. Orders puede funcionar sin inventory reservations para servicios.

### Fases paralelizables:

- **F2 (Inventory)** y **F2.5 (Supply Bridge + Discovery)** son independientes, corren en paralelo despues de F1
- **F5 (Deals)** puede comenzar tan pronto como F4 este funcional
- **F7 (POS)** es independiente del camino critico despues de F3
- **F6 (Analytics)** puede comenzarse parcialmente durante F5

### Timeline detallado:

```
Semana 1-2:    F0 (Foundation + commerce-primitives extraction)
Semana 3-5:    F1 (Catalog con variantes + default variant)
Semana 6-7:    F2 (Inventory) ←→ F2.5 (Supply Bridge + Discovery) EN PARALELO
Semana 8:      F2.5 continua (marketplace UI)
Semana 9-11:   F3 (MembegoOrder + QR + attribution)
Semana 12-13:  F4 (Merchant Billing + Commission CPA/8%)
Semana 14-17:  F5 (Deals con budget)
Semana 18-19:  F6 (Analytics)
```

**En la semana 13**, Membego puede:
- Tener productos de Supply visibles en el marketplace publico
- Experiencia de descubrimiento cross-company con busqueda
- Supply patrocinado destacado para adquisicion de clientes
- Redenciones verificadas via QR
- Billing automatico: CPA para operaciones sin evidencia, 8% para operaciones verificadas
- Revenue real para Membego
- Merchant Billing y Supply Economics completamente separados

---

## 12. QUICK WINS

Cambios implementables en menos de una semana sin comprometer arquitectura:

1. **Ocultar Supply V1** via capability flag (si no hay datos activos)
2. **Ocultar modulos secundarios** (Gamificacion, Blog, Home Builder) via capabilities
3. **Desactivar CRM y Mensajeria por defecto** para nuevos tenants (existentes los conservan)
4. **Agregar secciones de permiso** vacias para modulos futuros
5. **Documentar patron estandar de Server Action**
6. **Crear enum de capabilities** formalizado en codigo
7. **Agregar MerchantBillingConfig** como modelo stub con campos basicos

---

## 13. FOUNDATION

Cambios fundamentales que deben hacerse correctamente antes de construir:

1. **commerce-primitives**: Extraer pure functions de Supply V2 a capa compartida. Sin esto, Commerce Core no puede usar los patrones probados
2. **RLS per-domain completo**: Cada tabla con companyId debe tener politica. CI verifica
3. **CatalogItem + CatalogVariant con default variant**: El catalogo unificado es prerequisito de TODO. La variante default evita migrar pedidos/inventario despues
4. **MembegoOrder**: El pedido como unidad de atribucion es prerequisito de billing
5. **MerchantLedger inmutable**: Nunca editar, solo append. Reversals como nuevas entradas. SEPARADO de Supply Economics

---

## 14. STRATEGIC CAPABILITIES

Capacidades que habilitan nuevas lineas comerciales:

1. **Supply → Marketplace Bridge**: Supply V2 items visibles para consumidores. Membego puede comprar productos/servicios para regalar, vender con descuento y adquirir clientes. **Prioridad de lanzamiento**
2. **Marketplace Discovery**: Experiencia cross-company con busqueda, categorias, Supply patrocinado. Necesario temprano para atraer consumidores
3. **Merchant Billing (CPA + 8%)**: Genera revenue. Coexistencia de modelos segun nivel de verificacion
4. **Marketplace con Deals**: Ofertas con budget y fee por redencion
5. **POS conectado**: Ventas con verificationLevel PAYMENT_VERIFIED → 8% automatico
6. **Marketplace Checkout**: Compras digitales con pago Membego → maximo nivel de verificacion
7. **Revenue Attribution**: Demuestra al merchant que Membego produce ventas reales

---

## 15. LATER

Funcionalidades con sentido pero que no deben distraer actualmente:

1. **Loyalty unificado**: Consolidar gamificacion + growth + supply loyalty. Complejo, puede esperar
2. **Merchant Risk Engine**: Deteccion de fraude automatica. Necesita volumen
3. **Fiscal Integration (e-NCF)**: Importante para compliance pero no critico para MVP
4. **CardNET Split Payments**: Necesario para checkout con settlement automatico
5. **Reconciliation avanzada**: Conciliacion cross-channel automatica
6. **Vertical extensions** (Beauty, Fitness): Commerce Core debe estabilizarse primero
7. **Multi-currency**: No necesario mientras operemos solo en RD
8. **Delivery**: Pickup funciona como primera fase
9. **Wallet financiera del consumidor**: Regulacion dominicana 2025 lo complica

---

## 16. ESTRATEGIA DE MIGRACIONES

### Principios

1. **Additive first**: Nuevas tablas, nuevas columnas. No eliminar ni renombrar existentes
2. **Feature flags para rollout**: Nuevos modulos via capabilities
3. **Backward compatible**: Cada migracion deployable sin breaking changes
4. **Test contra PostgreSQL real**: CI existente ejecuta contra shadow PostgreSQL
5. **Supply V2 intocable**: Sus tablas no se modifican. El bridge crea CatalogItems nuevos

### Secuencia de migraciones por fase

```
F0: RLS policies. CREATE commerce_primitives (solo archivos TS, no migraciones DB)
F1: CREATE TABLE catalog_items, catalog_variants (con isDefault), catalog_item_categories, catalog_item_images
    (catalog_variants tiene FK a catalog_items. MembegoOrderLine referenciara variante)
F2: CREATE TABLE inventory_levels, inventory_movements
F2.5: ALTER TABLE catalog_items ADD source, supplyV2CatalogItemId (FK opcional). Indices para marketplace search
F3: CREATE TABLE membego_orders, membego_order_lines (FK a catalog_variant_id), order_attributions, customer_confirmations, payment_evidences
F4: CREATE TABLE merchant_billing_configs, commissions, merchant_ledger_entries, merchant_statements
    (SEPARADO de supply-v2 finance tables)
F5: ALTER TABLE promociones ADD budget fields o CREATE TABLE deals. Campaign budget tracking
F7: ALTER TABLE pos tables ADD catalogVariantId, membegoOrderId
F8: CREATE TABLE carts, cart_lines (FK a catalog_variant_id)
```

### Datos existentes

- **Car wash `Servicio`**: NO migrar a CatalogItem en F1. Coexistencia. Migrar en fase posterior
- **`Promocion`**: NO migrar a Deal. Extender con campos de Deal. Backward compatible
- **Supply V2**: NO tocar tablas. El Bridge crea CatalogItems con source=SUPPLY y FK de referencia
- **`Plan` (membresias)**: NO migrar. Planes existentes funcionan. Nuevos tipos via CatalogItem

---

## 17. ESTRATEGIA DE TESTING

### Por nivel

| Nivel | Que testar | Herramienta |
|---|---|---|
| **Unit** | commerce-primitives (ledger invariants, money arithmetic, state machines, commission calc), catalog (default variant auto-creation), orders (state machine), billing (CPA vs 8% selection) | `tsx --test` (existente) |
| **DB Integration** | RLS isolation, concurrent operations (inventory reservation, budget exhaustion, double redemption), ledger invariants, Supply Bridge sync, Merchant vs Supply ledger separation | PostgreSQL real en CI |
| **E2E** | Flows criticos: Supply item → marketplace → compra → attribution. Deal → claim → redeem → billing. Marketplace discovery cross-company | Playwright (existente) |
| **Load** | Concurrent claims, concurrent redemptions, marketplace search | Scripts en `tests/carga/` |

### Tests criticos nuevos

1. **commerce-primitives**: Mismos tests de Supply V2 deben pasar con imports actualizados
2. **Default variant invariant**: Todo CatalogItem tiene al menos 1 CatalogVariant
3. **OrderLine always references variant**: Nunca item directo
4. **Merchant Billing vs Supply Economics isolation**: Un MerchantLedgerEntry NUNCA referencia un SupplyV2Settlement y viceversa
5. **Double redemption prevention**: Mismo QR no puede canjearse dos veces
6. **Campaign budget exhaustion**: Race condition bajo concurrencia
7. **Ledger balance consistency**: `current_balance = SUM(all entries)` siempre
8. **Cross-tenant isolation**: Order de empresa A no visible para B
9. **Commission type selection**: CPA cuando verificationLevel < PAYMENT_VERIFIED, 8% cuando >=
10. **Supply Bridge sync**: Cambio en SupplyV2CatalogItem se refleja en CatalogItem

---

## 18. ESTRATEGIA DE ROLLOUT

### Progressive rollout usando capabilities existentes

```
1. Desarrollar feature con UI oculta
2. Activar capability en empresa piloto (Car Town)
3. Validar con datos reales
4. Activar para 5-10 empresas seleccionadas
5. Activar por defecto para nuevas empresas
6. Migrar empresas existentes
```

### Por fase

| Fase | Rollout |
|---|---|
| F0 | Transparente. RLS y commerce-primitives no cambian comportamiento visible. Modulos ocultados con capabilities |
| F1 | Capability `CATALOGO_UNIFICADO`. Car Town primero |
| F2 | Se activa automaticamente con F1 para items con trackInventory |
| F2.5 | Supply Bridge: automatico (superadmin). Marketplace Discovery: abierto para todos los consumidores |
| F3 | Capability `PEDIDOS_MEMBEGO`. Empresas con F1 |
| F4 | Automatico para empresas con F3. CPA por defecto, 8% cuando POS/checkout verificado |
| F5 | Capability `DEALS_MARKETPLACE`. Rollout gradual |
| F6 | Visible en superadmin primero. Luego dashboard para merchants |
| F7 | Capability `POS_MEMBEGO`. Enterprises seleccionadas |
| F8 | Capability `CHECKOUT_MARKETPLACE`. Abierto para consumidores |

---

## 19. CRITERIO DE FINALIZACION DE CADA FASE

| Fase | Hecho cuando... |
|---|---|
| **F0** | 100% tablas con companyId tienen RLS. commerce-primitives funcional. Supply V2 tests pasan con imports nuevos. Modulos ocultados. CRM/Mensajeria desactivados para nuevos tenants |
| **F1** | Empresa crea CatalogItem. Items simples: default variant invisible en UI. Items con variantes: selector visible. Items en marketplace (storefront + feed cross-company inicial). Platform API funcional |
| **F2** | Inventario por variante/location funcional. Ledger append-only via commerce-primitives. Reservations con TTL |
| **F2.5** | Supply items visibles en marketplace publico automaticamente. Marketplace cross-company con busqueda y categorias. Supply patrocinado destacado. Compra de Supply items funciona (checkout Supply V2). MembegoOrder de atribucion generado |
| **F3** | Flow completo: claim → visit → QR → completed → attribution. Supply Bridge genera MembegoOrder correctamente |
| **F4** | Comision CPA o 8% segun verificationLevel. Ledger inmutable SEPARADO de Supply Economics. Statements. Credit limit |
| **F5** | Deal con budget creado. Claim y redeem funcional. Budget auto-pausa. Billing automatico |
| **F6** | Dashboard GMV funcional. Empresa ve ROI. Superadmin ve health. Supply economics separados en reporting |
| **F7** | POS vende CatalogItems (variantes). Identifica clientes. Aplica promotions. Commission 8% automatica |
| **F8** | Compra marketplace: browse → cart → checkout → pay → pickup QR → completed. Commission segun verificationLevel |

---

## 20. RECOMENDACION DEL PRIMER BLOQUE

### Implementar: Fases 0 + 1 + 2 + 2.5 + 3 + 4

**Justificacion**: El camino a monetizacion ahora incluye Supply como prioridad de lanzamiento. Membego necesita productos que regalar/vender con descuento para adquirir clientes. Supply V2 ya esta construido — solo falta el bridge al marketplace publico.

```
Semana 1-2:    F0 — Foundation + commerce-primitives extraction
Semana 3-5:    F1 — Catalog con variantes (default variant para items simples)
Semana 6-7:    F2 + F2.5 EN PARALELO
               F2: Inventory (2 sem)
               F2.5: Supply Bridge + Marketplace Discovery (3 sem, continua sem 8)
Semana 8:      F2.5 continua (marketplace UI cross-company)
Semana 9-11:   F3 — MembegoOrder + QR + attribution
Semana 12-13:  F4 — Merchant Billing (CPA + 8% ready)
```

**Total: ~13 semanas hasta revenue real con Supply en marketplace**

En la semana 13, Membego puede:
- Comprar productos/servicios a proveedores (Supply V2 existente)
- Esos productos aparecen automaticamente en el marketplace publico (Bridge)
- Consumidores descubren ofertas cross-company con busqueda y categorias
- Supply patrocinado destacado para adquisicion de clientes
- Empresas pueden publicar sus propios productos/servicios con variantes
- Redenciones verificadas via QR
- Billing automatico: CPA fijo o 8% segun verificacion
- Revenue real para Membego
- Merchant Billing y Supply Economics completamente separados
- Todo basado en commerce-primitives probadas (extraidas de Supply V2)

---

## 21. CONCURRENCIA E IDEMPOTENCIA

### Donde necesitamos proteccion especifica

| Operacion | Mecanismo | Prioridad |
|---|---|---|
| **Inventory reservation** | SELECT FOR UPDATE en InventoryLevel + check available >= quantity | ALTA (F2) |
| **Deal claim (obtener oferta)** | Unique constraint (customerId, dealId) + campaign budget atomic decrement | CRITICA (F5) |
| **QR redemption** | Atomic update: WHERE status = VALID AND id = X + returning. Anti-replay nonce ya existe | CRITICA (F3) |
| **Campaign budget exhaustion** | UPDATE campaign SET spent = spent + fee WHERE spent + fee <= budget RETURNING * | CRITICA (F5) |
| **Order completion** | State machine via commerce-primitives: UPDATE WHERE status = READY AND id = X | ALTA (F3) |
| **Commission creation** | Unique constraint (orderId). Idempotency key | ALTA (F4) |
| **Ledger entries** | Append-only via commerce-primitives/ledger. Balance como running balance | ALTA (F4) |
| **Customer confirmation** | Unique constraint (orderId). Only one confirmation per order | MEDIA (F3) |
| **Statement generation** | Unique constraint (companyId, period). Idempotent generation | MEDIA (F4) |
| **Supply Bridge sync** | Idempotent upsert: SupplyV2CatalogItem → CatalogItem by supplyV2CatalogItemId | ALTA (F2.5) |
| **Supply lot allocation** | SELECT FOR UPDATE en lot buckets. Ya implementado en Supply V2 | OK (existente) |

### commerce-primitives: funciones compartidas para concurrencia

| Primitiva | Archivo | LOC | Usado por |
|---|---|---|---|
| **Ledger inmutable** | `commerce-primitives/ledger.ts` | 177 | MerchantLedger, InventoryMovement, (Supply ya lo usa) |
| **Money arithmetic** | `commerce-primitives/dinero.ts` | 103 | Todos los calculos monetarios |
| **Commission calc** | `commerce-primitives/comision.ts` | 130 | CPA y 8% — seleccion automatica por verificationLevel |
| **State machines** | `commerce-primitives/estados.ts` | 210 | MembegoOrder, Redemption, Deal, Campaign |
| **Outbox** | Sigue en supply-v2/operations/outbox.ts | 192 | Supply V2 (Commerce Core puede crear su propio outbox si necesario, usando el mismo patron) |
| **FEFO** | `commerce-primitives/fefo.ts` | 55 | Inventory, Supply V2 |
| **Numbering** | `commerce-primitives/numeracion.ts` | 76 | MBG-YYYYMMDD-NNNNNN codes, SKU auto |

---

## 22. REPORTES EN EL ROADMAP

| Reporte | Fase | Fuente de datos |
|---|---|---|
| Ventas por MembegoOrder | F3 | MembegoOrder + OrderLine |
| Comisiones y billing (MERCHANT) | F4 | Commission + MerchantLedger |
| Supply Economics (SEPARADO) | Existente | SupplyV2EconomicEvent + SupplyV2Settlement |
| Performance de Deals | F5 | Deal + OrderAttribution + MembegoOrder |
| Campaigns ROI | F5 | Campaign + DealClaims + Redemptions |
| Supply en Marketplace | F2.5 | SupplyV2Offer publicadas + CatalogItems source=SUPPLY |
| Marketplace Discovery | F2.5 | Busquedas, clicks, conversiones cross-company |
| GMV (Gross Merchandise Value) | F6 | SUM(MembegoOrder.total) |
| Revenue Attribution | F6 | OrderAttribution + Commission (merchant) |
| Merchant Performance | F6 | Per-company: orders, GMV, redemptions, conversion |
| Unit Economics | F6 | Commission / orders, CAC, LTV |
| Inventory | F2 | InventoryLevel + InventoryMovement |
| Supply reconciliation | Existente | Supply V2 models (Supply Economics) |
| Supplier settlement | Existente | Supply V2 settlement (Supply Economics) |
| Membership analytics | Existente | Membership + Visit |
| Promotion analytics | Existente | Promocion + redenciones |
| Risk / Anomalias | F9 | RiskSignal (post-volume) |
| Reconciliation merchant | F9 | MembegoOrder vs PaymentEvidence vs FiscalDocument |

---

## DECISIONES RESUELTAS

Las siguientes decisiones fueron aprobadas por el fundador y estan incorporadas en el plan:

| # | Decision | Resolucion |
|---|---|---|
| 1 | **Supply como prioridad de lanzamiento** | Supply → Marketplace Bridge es Fase 2.5 (temprana), NO Fase 9. Membego comprara productos/servicios para regalar/vender/adquirir clientes |
| 2 | **commerce-primitives compartidas** | Pure functions genericas de Supply V2 se extraen a `src/lib/commerce-primitives/`. Commerce Core y Supply V2 consumen esa capa. No se duplica logica probada |
| 3 | **CatalogVariant desde el dia 1** | Default variant auto-creada para items simples, invisible en UI. Pedidos/inventario/promotions siempre referencian variante |
| 4 | **Separacion Merchant Billing vs Supply Economics** | Modulos, tablas y ledgers completamente separados. NUNCA se mezclan |
| 5 | **CPA + 8% coexistentes** | CPA para operaciones sin evidencia financiera, 8% para operaciones verificadas (checkout/POS/pago). Ambos desde dia 1 en arquitectura |
| 6 | **Ocultar modulos: estrategia moderada** | Supply V1, Gamificacion, Blog, Home Builder ocultos. CRM y Mensajeria conservados para existentes, desactivados por defecto para nuevos tenants |
| 7 | **Marketplace discovery temprano** | Storefronts para CatalogItems + feed cross-company con busqueda, categorias, Supply patrocinado. No posponer demasiado |

---

*Aprobado el 2026-10-06. La implementación comenzó con F0; ver `docs/IMPLEMENTATION_STATUS.md` para el estado real.*
