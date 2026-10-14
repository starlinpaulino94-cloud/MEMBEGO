# MEMBEGO — Supplier & Fulfillment Commerce

> Documento vivo de la evolución «proveedores → Supplier Lite → canje → ventas adicionales → comisión → conversión en empresa activa». Se escribe **contra el código**: donde este documento y el código se contradigan, manda el código. Rama `claude/adoring-mayer-xumnur`.

## 0. Resumen

Membego tiene dos formas de generar oferta: **empresas afiliadas** (venden lo suyo en el Marketplace) y **Supply Membego** (Membego compra unidades/derechos a un proveedor y los revende, regala o usa como incentivo). Esta fase hace que **todo proveedor tenga acceso operativo** (Supplier Lite), que el Marketplace distinga **quién vende de quién entrega**, que el canje abra una **visita atribuida a Membego** en la que el proveedor registra **ventas adicionales** comisionables, y que el proveedor pueda **solicitar convertirse en empresa activa** sin crear otra organización.

Nada de esto es una arquitectura paralela: reutiliza `Company`, `Sucursal`, `User`+`permisos`, `Invitacion`, capacidades, secciones, Supply V2 (proveedor, acuerdos, lotes, ledger, derechos, vouchers, QR, redenciones, liquidaciones, outbox, avisos), Merchant Billing (ledger inmutable por empresa) y el catálogo unificado.

## 1. Mapping: concepto solicitado → entidad actual → extensión

| Concepto solicitado | Entidad actual (fuente de verdad) | Extensión necesaria |
|---|---|---|
| Organization (MERCHANT / MEMBEGO_SUPPLIER / ambas) | `Company` (`prisma/schema/identidad.prisma`) con `capacidades.overrides` y `isPublished` | Ninguna tabla nueva. «Supplier Lite» = `Company` con `MEMBEGO_SUPPLIER` encendida, comercio apagado y `isPublished=false`. Helper puro `tipoDeOrganizacion()` deriva SUPPLIER_ONLY / MERCHANT_ONLY / MERCHANT_SUPPLIER de las capacidades. |
| Supplier | `SupplyV2Supplier` (`companyId @unique`, `source`, `status`) | Campos de **acceso**: `accessStatus` (DRAFT→INVITED→ACTIVATION_PENDING→ACTIVE / SUSPENDED / TERMINATED), `invitedAt/invitedEmail`, `termsAcceptedAt`, `qrTestedAt`, `fulfillmentReadyAt`, `readinessWaivedAt/Reason`. `status` sigue siendo el estado **comercial** (ACTIVE/INACTIVE/BLOCKED ≈ ACTIVE/SUSPENDED/TERMINATED del documento). |
| Supplier Lite / Supplier Portal | Portal existente `/admin/supply/*` (sección `supply`, capacidad `MEMBEGO_SUPPLIER`, `proveedorDeLaSesion()`) | Menú propio cuando la empresa es solo proveedora; páginas nuevas (inventario Membego, canjes, ventas adicionales, incidencias, personal, convertirme, configuración). |
| Supplier invitation | `Invitacion` + `aceptarInvitacion` (`src/modules/admin/invitacionActions.ts`) | `Invitacion.permisos` (preset del rol de proveedor) y `Invitacion.origen`. La invitación del superadmin crea la `Company` Supplier Lite, vincula el proveedor y manda el correo. |
| SUPPLIER_OWNER / OPERATOR / FINANCE / VIEWER | `AppRole` + `User.permisos` (secciones/funciones) | Presets: OWNER=ADMINISTRADOR; OPERATOR=CAJERO+`supply`; FINANCE=GERENTE+`supply`; VIEWER=SUPERVISOR+`supply` solo lectura. Funciones nuevas de la sección `supply` en `src/lib/auth/funciones.ts`. Sin segundo sistema de permisos. |
| Supplier Agreement / Contract Item | `SupplyV2Agreement` (+`SupplyV2AgreementVersion`) / `SupplyV2CatalogItem` | Política de ventas adicionales en el acuerdo (`additionalSalesCommissionEnabled`, `additionalSalesCommissionRate`, `attributionWindowMinutes`, `requiresCustomerConfirmation`, `receiptRequiredAboveAmount`), congelada en la versión. `SupplyV2CatalogItem.fulfillmentBacking` y `dailyCapacity`. |
| Purchase Order / lots / backing | `SupplyV2PurchaseOrder`, `SupplyV2Lot` (cubetas caché del ledger) | Ninguna. Backing explícito en el ítem (`ON_DEMAND`, `PHYSICAL_RESERVED_STOCK`, `SERVICE_CAPACITY`, `SCHEDULED_CAPACITY`). |
| Ledger append-only | `SupplyV2LedgerEntry` vía `registrarAsientoEnTx` | Ninguna. Se reutiliza tal cual (REDEMPTION/REVERSAL/EXPIRATION…). |
| CustomerEntitlement → Voucher → QR → Redemption | `SupplyV2Entitlement`, `SupplyV2Voucher`, `SupplyV2QrSession`, `SupplyV2Redemption` | Ninguna en el motor QR. La confirmación de entrega abre además la visita (misma transacción). |
| Seller ≠ Supplier ≠ Fulfillment / Display mode | Proyecciones públicas `catalog/publico-nucleo.ts`, `supply-v2/marketplace/read-model.ts`, `deals/publico-nucleo.ts` | Resolutor puro `modoComercial()` (MERCHANT_SALE, MEMBEGO_RESALE, MEMBEGO_GIFT, MEMBEGO_SPONSORED, MERCHANT_SUBSIDIZED) y bloque `comercial {vendedor, canje, financiadoPor}` en las proyecciones. `Deal.sponsor` para la promoción financiada por Membego. Copy configurable. |
| Marketplace Listing / Offer vs CatalogItem | `CatalogItem` (ítem) y `SupplyV2Offer` (oferta de Membego, puente `CatalogItem.supplyV2OfferId`) | Ninguna tabla. Un mismo producto puede tener listing de la empresa (`source=MERCHANT`) y oferta Membego (`source=SUPPLY`) sin duplicar la base. |
| MembegoVisit | No existe (`modules/visitas` es la visita de membresía) | **Nuevo** `MembegoVisit` (`membego_visits`): empresa de canje, sucursal, cliente, origen, atribución, documento fuente, ventana, política congelada, estado. |
| Ancillary Sale | No existe | **Nuevo** `AncillarySale` + `AncillarySaleLine` (`CATALOG_ITEM` con precio releído del servidor / `CUSTOM_REPORTED_LINE` auditada), niveles de evidencia MERCHANT_REPORTED → CUSTOMER_CONFIRMED → PAYMENT_VERIFIED → FISCALLY_RECONCILED. |
| Mini catálogo del proveedor | `SupplyV2CatalogItem` | `sellableAsExtra`, y `catalogItemId` para mapearlo al catálogo unificado cuando sea Merchant (sin duplicar). |
| VisitDispute | No existe | **Nuevo** `VisitDispute` (OPEN, UNDER_REVIEW, RESOLVED_MERCHANT, RESOLVED_CUSTOMER, DISMISSED). Resolución por asientos, nunca editando. |
| Attributed Sales Billing (comisión de extras) | Merchant Billing: `MerchantBillingConfig`, `MerchantLedgerEntry` (`src/modules/billing`) | Asientos `ANCILLARY_FEE` con `referenceType='ANCILLARY_SALE'` y clave `ancillary:<id>`; reversal `REFUND`, ajuste `ADJUSTMENT`. Mismo libro, misma cuenta por empresa, sin segundo ledger. Supply Economics no se toca. |
| Supply Economics | `SupplyV2EconomicEvent`, obligaciones, liquidaciones | Ninguna. |
| Supplier → Merchant application | `SolicitudEmpresa` existe para empresas **nuevas** (crea la empresa); no sirve: aquí la empresa YA existe | **Nuevo** `SupplyV2MerchantApplication` (SUBMITTED, UNDER_REVIEW, MORE_INFO_REQUIRED, APPROVED, REJECTED) con revisor, fecha, motivo y notas. Aprobar = encender capacidades de comercio en la **misma** `Company`. |
| Notificaciones | `Notificacion` (`crearNotificacion`, `dedupeKey`), `supply-v2/notifications` (AVISOS + outbox) | Avisos nuevos en el registro `AVISOS` y `NotifTipo` existentes. |
| Outbox / eventos de dominio | `SupplyV2OutboxEvent` (`emitirEfectoEnTx`) | Eventos `supplier.*`, `visit.*`, `ancillary_sale.*`, `commission.created` emitidos dentro de la transacción. |
| Risk signals | `modules/riesgo-comercio` (`TipoDeSenal`, `UMBRALES`) | Señal `PROVEEDOR_SUBREPORTE_VENTAS_ADICIONALES`. Sin bloqueo automático. |
| Supplier Scorecard | Consultas de `supply-v2/suppliers/queries.ts` y `redemption/queries.ts` | Consulta agregada nueva y pantalla de superadmin. |
| RLS | Políticas deducidas por `companyId` / FK NOT NULL (`prisma/migrations_manual/2026-07-rls-capa2-aislamiento.sql`) | Toda tabla nueva lleva `companyId`. |

Las secciones siguientes se completan slice a slice (ver `IMPLEMENTATION_STATUS.md` para el estado).
