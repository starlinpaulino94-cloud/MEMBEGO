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

## 2. Arquitectura (sin arquitectura paralela)

```
Company (una por organización)  ──┬── capacidades.overrides: MEMBEGO_SUPPLIER · CATALOGO_UNIFICADO · PEDIDOS_MEMBEGO · DEALS_MARKETPLACE
                                  ├── Sucursal[] · User[] (rol + permisos.secciones/funciones) · Invitacion[]
                                  ├── SupplyV2Supplier (companyId @unique) ── acuerdos · lotes · ledger · ofertas · derechos · vouchers · QR · redenciones
                                  ├── MembegoVisit[] ── AncillarySale[] ── AncillarySaleLine[] · VisitDispute[]
                                  ├── MerchantBillingConfig + MerchantLedgerEntry[]  (ANCILLARY_FEE / REFUND / ADJUSTMENT)
                                  └── SupplyV2MerchantApplication[]
```

- **Una sola organización.** `tipoDeOrganizacion(capacidadesActivas, esProveedor)` → `SUPPLIER_ONLY | MERCHANT_ONLY | MERCHANT_SUPPLIER | NONE` (`src/modules/supply-v2/suppliers/acceso-dominio.ts`). Nunca se crea una segunda `Company` para convertir un proveedor.
- **Supplier Lite** = `Company` con `type: 'proveedor'`, `isPublished: false`, overrides `OVERRIDES_SUPPLIER_LITE` (proveedor ON, todo lo demás OFF) y una sucursal «Principal». La crea `asegurarEmpresaSupplierLiteEnTx` al invitar al dueño de un proveedor externo.
- **Un solo sistema de permisos**: `requireSection('supply', funcion)`. Funciones del portal (`FUNCION_PORTAL`): `escanear`, `ventas_adicionales`, `inventario`, `liquidaciones`, `personal`, `configuracion`, `solicitud_merchant`. Presets de rol en `PRESETS_ROL_PROVEEDOR` (OWNER=ADMINISTRADOR, OPERATOR=CAJERO, FINANCE=GERENTE, VIEWER=SUPERVISOR) que viajan en `Invitacion.permisos`.
- **Un solo motor QR / redención** (`supply-v2/redemption`). La visita nace en la misma transacción que la redención (`confirmarEntregaAction` → `confirmarEntregaEnTx` + `abrirVisitaDeRedencionEnTx`).
- **Un solo libro comercial por empresa** (Merchant Billing). La comisión de extras es un asiento `ANCILLARY_FEE`; Supply Economics (costos, obligaciones, liquidaciones al proveedor) no se mezcla.
- **Un solo outbox** (`SupplyV2OutboxEvent`, `emitirEfectoEnTx`) y un solo registro de efectos (`EFECTOS` en `operations/worker.ts`) al que se suman `EFECTOS_DE_VISITA` y `EFECTOS_DE_SOLICITUD_MERCHANT`.

## 3. Ciclo de vida del proveedor (acceso operativo)

`SupplyV2Supplier.accessStatus`: `DRAFT → INVITED → ACTIVATION_PENDING → ACTIVE`, con `SUSPENDED` y `TERMINATED` laterales (`TRANSICIONES_ACCESO`). El estado **comercial** (`status`: ACTIVE/INACTIVE/BLOCKED) sigue siendo otro eje.

Lista de preparación (`evaluarPreparacion`): usuario activo · sucursal configurada · operador configurado · contrato aceptado (`termsAcceptedAt`) · escáner probado (`qrTestedAt`, código `TEST-…` generado desde Configuración y leído con el escáner real). Completarla marca `fulfillmentReadyAt` y pasa a `ACTIVE`. El superadmin puede **dispensar** con motivo (`readinessWaivedReason`), que es lo que recibieron los proveedores anteriores a esta fase en el backfill (`LEGACY_BACKFILL…`).

`exigirProveedorOperativoEnTx` protege activar acuerdos y publicar ofertas: con `SUPPLY_V2_READINESS_STRICT=1` un proveedor `DRAFT` tampoco pasa; sin la variable, `DRAFT` pasa (compatibilidad) y `INVITED/ACTIVATION_PENDING/SUSPENDED/TERMINATED` no.

Relevamiento (§60–§62): `clasificarProveedor` → `ACTIVE_WITH_ACCESS | ACTIVE_WITHOUT_ACCESS | LEGACY | INACTIVE`, pantalla `/superadmin/supply/proveedores/relevamiento`. Nada se migra solo: cada invitación es una decisión.

## 4. Supplier → Merchant (conversión sin segunda organización)

`SupplyV2MerchantApplication` (`SUBMITTED → UNDER_REVIEW → APPROVED | REJECTED | MORE_INFO_REQUIRED → SUBMITTED`, y `WITHDRAWN`), con `reviewerId`, `reviewedAt`, `decisionReason` (visible), `internalNotes` (interno), `capabilitiesGranted`. Índice único parcial: una solicitud viva por proveedor.

- Portal: `/admin/supply/solicitud-merchant` (función `solicitud_merchant`), formulario prellenado con `prellenarSolicitud` (empresa + ficha de proveedor + sucursales).
- Superadmin: `/superadmin/supply/proveedores/solicitudes` (`SUPPLY_V2_SUPPLIER_MANAGE`).
- **Aprobar** (`revisarSolicitudMerchantEnTx` → `encenderCapacidadesMerchantEnTx`): en la **misma** `Company` enciende `CATALOGO_UNIFICADO`, `PEDIDOS_MEMBEGO`, `DEALS_MARKETPLACE`, quita los apagados del Supplier Lite (la categoría vuelve a mandar), conserva `MEMBEGO_SUPPLIER`, cambia `type: 'proveedor'` por el tipo elegido y completa el perfil **solo donde estaba vacío**. `isPublished` sigue en `false`: la vitrina la publica la empresa al completar su onboarding (`/admin/perfil`, `publicarMiEmpresa`). Los acuerdos, lotes, ofertas de Membego y visitas no se tocan.
- Rechazar exige motivo; pedir más información exige la petición; el proveedor responde en el mismo formulario.

## 5. Seller ≠ Supplier ≠ Fulfillment (Marketplace)

`src/modules/comercio/modo-comercial.ts`: `modoComercial()` y `presentacionComercial()` devuelven `{ modo, vendedor, canje, financiadoPor, etiqueta, lineaVendedor, lineaCanje, lineaFinanciacion }` para los modos `MERCHANT_SALE`, `MEMBEGO_RESALE`, `MEMBEGO_GIFT`, `MEMBEGO_SPONSORED`, `MERCHANT_SUBSIDIZED`. Las tres proyecciones públicas (`catalog/publico-nucleo.ts`, `supply-v2/marketplace/read-model.ts`, `deals/publico-nucleo.ts`) exponen el bloque `comercial`; las tarjetas y fichas lo pintan (`data-modo-comercial`). El punto de canje de un Supplier Lite **no enlaza** a ninguna vitrina (no tiene). `Deal.sponsor` (MERCHANT / MEMBEGO / SHARED) distingue la promoción financiada por Membego. El copy vive en `COPY_COMERCIAL` (configurable; ver §16).

## 6. Separación económica

| Flujo | Dónde vive | Qué registra |
|---|---|---|
| Supply Economics | `SupplyV2LedgerEntry`, obligaciones, liquidaciones, `SupplyV2EconomicEvent` | Lo que Membego compró, canjeó, debe y pagó al proveedor. Costo congelado por redención. |
| Attributed Sales Billing | `MerchantLedgerEntry` (Merchant Billing) | Comisión **solo sobre extras**: `ANCILLARY_FEE` (> 0), reverso `REFUND` (< 0), ajuste `ADJUSTMENT` (≠ 0), referencia `ANCILLARY_SALE`, clave `ancillary:<venta>[...]`. |

La unidad que Membego compró (la pizza, el cappuccino) **nunca** entra en la base comisionable: el dominio (`resolverLineasDeExtra`) solo acepta ítems `sellableAsExtra` del propio proveedor y líneas personalizadas; `calcularComisionDeExtra` recibe únicamente el subtotal de extras. CHECKs en la base: `ancillary_sales_montos`, `_comision_libro`, `_evidencia`; trigger `ancillary_sales_reglas` (el asiento enlazado debe coincidir en tipo, monto y referencia; identidad inmutable); `ancillary_sale_lines_sin_cambios`; `visitas_membego_sin_borrar`.

## 7. Modelo de visita

`MembegoVisit` (`MBG-VI-…`): empresa, proveedor, sucursal, cliente, origen (`MEMBEGO_SUPPLY | MARKETPLACE_ORDER | DEAL_CLAIM`), documento fuente, `redemptionId @unique`, política congelada (`ancillaryCommissionEnabled`, `ancillaryCommissionRate`, `attributionWindowMinutes`, `requiresCustomerConfirmation`, `receiptRequiredAbove`), totales, `customerConfirmedAt/Total`, `idempotencyKey`. Estados `OPEN → CLOSED | CANCELLED`.

- Se abre al confirmar la entrega (misma transacción; candado `FOR UPDATE` sobre la redención: dos escáneres no abren dos visitas).
- La política sale del snapshot de la versión del acuerdo del lote/derecho → acuerdo vivo → cuenta de Merchant Billing → plataforma (8 %, 120 min).
- Ventana de atribución (§38): nada se atribuye después de `openedAt + attributionWindowMinutes`; el cron (`/api/cron/supply-v2`) cierra las vencidas (`cerrarVisitasVencidasEnTx`).
- Hoy solo el canje de Supply abre visitas. Abrirlas desde el cierre de un pedido del marketplace o de un reclamo de Deal (`origin` ya previsto) **queda documentado como parcial**: el modelo y las invariantes lo admiten; falta el enganche en `orders/service.ts` y `deals`.

## 8. Ventas adicionales

`AncillarySale` (`MBG-VA-…`) con líneas inmutables `CATALOG_ITEM` (precio releído del `SupplyV2CatalogItem` del proveedor dentro de la transacción; lo que mandó el navegador se ignora) o `CUSTOM_REPORTED_LINE` (precio del operador, marcada y auditada). Estados `REPORTED → CONFIRMED | DISPUTED → ADJUSTED | REVERSED`. Evidencia `MERCHANT_REPORTED → CUSTOMER_CONFIRMED → PAYMENT_VERIFIED → FISCALLY_RECONCILED`: el cliente sube a `CUSTOMER_CONFIRMED` y **nunca** a `PAYMENT_VERIFIED` (solo `verificarPagoDeVentaAdicionalEnTx` con referencia externa, desde la plataforma).

Mini catálogo (§26): ítems `SupplyV2CatalogItem.sellableAsExtra` del proveedor (`guardarExtraEnTx`), administrados en `/admin/supply/configuracion`; `catalogItemId` los mapea al catálogo unificado cuando el proveedor es Merchant, sin duplicar.

## 9. Comisión, confirmación y disputas

- `registrarVentaAdicionalEnTx` asienta la comisión al reportar salvo que la política exija confirmación del cliente (`requiresCustomerConfirmation`), en cuyo caso queda `PENDING` y se asienta al confirmar.
- Cliente: `/cliente/visitas/[id]` → «¿Es correcto?» (`confirmarVisitaComoClienteEnTx`, exige el **mismo total** que vio) o «Reportar un problema» (`disputarVisitaComoClienteEnTx` → `VisitDispute`).
- Superadmin: `/superadmin/supply/visitas/[id]` → en revisión / a favor del cliente (base reconocida → `correccionPorDisputa`: `REVERSO` total o `AJUSTE` por la diferencia, asientos nuevos) / a favor del negocio / desestimada. Las ventas vuelven a `CONFIRMED`/`REPORTED` según corresponda; nunca se edita ni se borra un asiento.
- Capas contra el subreporte (§43–§45): precio del servidor, línea personalizada auditada, aviso y confirmación del cliente, disputa con resolución documentada, señal de riesgo `PROVEEDOR_SUBREPORTE_VENTAS_ADICIONALES` (`riesgo-comercio`: pocas visitas con extras o muchas disputas perdidas) y scorecard. Ninguna puntúa ni sanciona sola (§49).

## 10. Seguridad

- Toda mutación pasa por una server action con guardia de servidor (`exigirProveedorSupplyV2(funcion)`, `exigirCliente()`, `exigirPermisoSupplyV2(permiso)`) **antes** de abrir la transacción; la empresa sale de la sesión, nunca del formulario.
- El cliente solo lee sus visitas (`miVisita(customerUserId, id)` filtra por su id); el proveedor solo las de su empresa (`conEmpresa`); nada de costos de Supply llega al escáner ni al cliente (probado en E2E).
- Límites de tasa con `createRateLimiter` (escáner, extras, cliente).
- RLS Capa 2: las tablas nuevas llevan `companyId` (`membego_visits`, `ancillary_sales`, `ancillary_sale_lines`, `visit_disputes`, `supply_v2_merchant_applications`); el preflight (`scripts/rls-capa2-preflight.mjs`) no deja ninguna sin decidir.
- Idempotencia: visita por redención; venta por `(companyId, idempotencyKey)`; asientos por clave `ancillary:…`; avisos por `dedupeKey`.

## 11. Pantallas

| Quién | Ruta | Qué |
|---|---|---|
| Proveedor | `/admin/supply` · `/inventario` · `/escaner` · `/canjes` · `/ventas-adicionales[/id]` · `/incidencias` · `/liquidaciones` · `/personal` · `/configuracion` · `/solicitud-merchant` | Espacio «Proveedor Membego» (`ESPACIO_PROVEEDOR`); único espacio si la empresa es solo proveedora. |
| Cliente | `/cliente/visitas[/id]` | Sus visitas; confirmar o reportar. |
| Superadmin | `/superadmin/supply/proveedores/[id]` (acceso + solicitud) · `/proveedores/solicitudes` · `/proveedores/relevamiento` · `/proveedores/scorecard` · `/supply/visitas[/id]` | Acceso, conversión, relevamiento, scorecard, visitas/disputas/evidencia, embudo. |

## 12. Migraciones (aditivas, idempotentes, selladas en `SUMAS.txt`)

`20261056_supplier_access_enums` / `20261057_supplier_access` (acceso + backfill clasificado) · `20261058_supply_item_fulfillment_enums` / `20261059_supply_item_fulfillment` · `20261060_deal_sponsor_enums` / `20261061_deal_sponsor` · `20261062_visitas_membego_enums` / `20261063_visitas_membego` (tablas, CHECKs, triggers, CHECK del libro ampliado) · `20261064_merchant_application_enums` / `20261065_merchant_application`. Ninguna destructiva; `prisma migrate diff` sin diferencias.

## 13. Pruebas

- Unit (`npm test`): `supply-v2-acceso-dominio`, `supply-v2-portal-nav`, `modo-comercial`, `visitas-membego-dominio`, `supply-v2-solicitud-merchant`, `riesgo-ventas-adicionales`, más las guardias existentes (navegación, rutas, permisos, RLS cobertura).
- PostgreSQL (`npm run test:db`): `supplier-access`, `supplier-inventario`, `display-modes`, `visitas-membego` (concurrencia, 400→32, confirmación, disputa −20, reverso, ventana vencida, aislamiento), `supplier-merchant-application` (misma empresa, sin segunda `Company`).
- E2E (`npm run e2e:limpio -- tests/e2e/supplier-fulfillment-commerce.spec.ts`): el recorrido del §86 en escritorio y la mitad operativa en móvil.

## 14. Despliegue y compatibilidad

1. `prisma migrate deploy` (aditivo). 2. El backfill deja a los proveedores anteriores con `ACTIVE` + dispensa `LEGACY_BACKFILL`: siguen operando igual. 3. `SUPPLY_V2_READINESS_STRICT` apagada hasta que los proveedores activos tengan acceso. 4. Relevamiento → invitar a los `ACTIVE_WITHOUT_ACCESS`. 5. Cron diario existente cierra visitas vencidas. 6. Ninguna capacidad nueva se enciende sola en empresas existentes.

## 15. Riesgos abiertos

- El cron de Vercel corre una vez al día: una visita puede quedar abierta hasta 24 h después de vencer su ventana (las ventas fuera de ventana se rechazan igual por `dentroDeVentana`).
- Confirmación del cliente opcional por contrato: sin ella, la evidencia se queda en `MERCHANT_REPORTED`.
- Visitas desde pedidos del marketplace y Deals: parcial (ver §7).
- El scorecard y la señal de riesgo usan umbrales por defecto no calibrados con negocio real.

## 16. USER DECISION REQUIRED (no inventado; estructuras configurables)

| Decisión | Dónde se configura | Valor por defecto actual |
|---|---|---|
| Copy legal «Vendido por» / «Ofrecido por» / «Regalo de» / «Canje en» | `COPY_COMERCIAL` en `src/modules/comercio/modo-comercial.ts` | Texto provisional (LEGAL / ACCOUNTING DECISION REQUIRED) |
| Porcentaje de comisión sobre extras y ventana de atribución | Por acuerdo (`SupplyV2Agreement.ancillaryCommissionRate`, `attributionWindowMinutes`) → cuenta Merchant Billing → plataforma | 8 % · 120 min · sin confirmación obligatoria · sin tope de recibo |
| Exigir confirmación del cliente o recibo por encima de un monto | `requiresCustomerConfirmation`, `receiptRequiredAbove` en el acuerdo | Apagados |
| Economía de la promoción financiada por Membego (`Deal.sponsor = MEMBEGO/SHARED`) | Solo se **muestra**; la liquidación del subsidio no existe | Sin liquidación (COMMERCIAL DECISION REQUIRED) |
| Comprobantes fiscales / DGII de las ventas adicionales | Nivel `FISCALLY_RECONCILED` solo como evidencia externa registrada a mano | Sin reglas fiscales (no se inventan) |
| Contrato marco del proveedor (texto) | `aceptarContratoDeProveedorEnTx` guarda fecha y quién; el texto no está en el código | LEGAL DECISION REQUIRED |
