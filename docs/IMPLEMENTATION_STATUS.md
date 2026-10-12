# MEMBEGO — estado de implementación

> Fuente operativa vigente. Revisada el **2026-10-12** sobre `origin/main` en `ab5c1711fe1a033115a64c9ef37d056ccefaae9f`, que incluye los PR #588, #589 y #596. El código y las verificaciones fechadas mandan sobre los informes históricos. La existencia de una función no prueba su configuración ni su uso en producción.

## ESTADO ACTUAL

### Base y alcance

Los PR [#583](https://github.com/starlinpaulino94-cloud/MEMBEGO/pull/583) (experiencia comercial), [#584](https://github.com/starlinpaulino94-cloud/MEMBEGO/pull/584), [#585](https://github.com/starlinpaulino94-cloud/MEMBEGO/pull/585) (onboarding/foundation cleanup), [#588](https://github.com/starlinpaulino94-cloud/MEMBEGO/pull/588) y [#589](https://github.com/starlinpaulino94-cloud/MEMBEGO/pull/589) (primera rebanada de Growth Commerce y atribución directa), y [#596](https://github.com/starlinpaulino94-cloud/MEMBEGO/pull/596) (build Vercel con Turbopack) están fusionados.

El producto es un monolito modular Next.js/React/TypeScript, Prisma y Supabase, con una app Expo y un satélite de restaurante que consumen HTTP. Commerce Core ya existe: no es una propuesta pendiente. **La primera rebanada de Growth Commerce está fusionada**: Promotion condiciona la elegibilidad de reclamos nuevos de Deal y MarketingCampaign distribuye Deals. La atribución se asigna desde la campaña que origina el reclamo y se miden reclamos/canjes; no hay tracking de impresiones/clics. Supply y `Promocion` legacy siguen separados. El inventario del Car Wash y las compras/membresías legacy siguen siendo dominios distintos. PR #596 sustituyó el build de webpack por Turbopack para evitar el OOM de Vercel; Vercel pasó en el merge `ab5c1711`.

### Capacidades y acceso

- **ON por defecto en los cinco paquetes de categoría:** `CATALOGO_UNIFICADO`, `PEDIDOS_MEMBEGO`, `DEALS_MARKETPLACE` (`CAPACIDADES_COMERCIO`, `src/modules/capacidades/catalogo.ts`). Un override puede apagarlas. Inventario, facturación y resultados comerciales cuelgan de esas capacidades.
- **No incluidas en esos paquetes:** `POS_MEMBEGO`, `PAGO_CARDNET`, `MEMBEGO_SUPPLIER`. Su activación requiere configuración. El puente necesita empresa de la casa, catálogo público y sucursal activa.
- El menú agrupa **Comercio**: Catálogo, Inventario, Pedidos, Ofertas y Promociones, Beneficios y regalos, Planes y Excursiones (`src/components/layout/nav-config.ts`). El menú facilita navegación; las acciones siguen exigiendo permisos del servidor.
- La autorización combina sesión, rol, sección/función, empresa y capacidad (`src/lib/auth/guards.ts`, `permissions.ts`, `src/modules/capacidades/resolver.ts`). El resolutor tiene fallback al paquete base ante errores de lectura: no describir toda la resolución como fail-closed.
- Las consultas usan filtros `companyId` y contexto transaccional (`src/lib/tenant.ts`). RLS Capa 2 tiene SQL de instalación y pruebas; **su activación en producción no está verificada**. Una conexión con privilegios de bypass no queda aislada por declarar el contexto.

### Módulos existentes y límites

| Área | Comportamiento comprobable en código | Evidencia principal / límites |
|---|---|---|
| Catálogo | Ítems con variantes desde el alta; precios, imágenes, categorías, administración, vitrina y API v1 | `modules/catalog`, `schema/catalogo.prisma`; pruebas `catalog*.test.ts`, `postgres/catalog*.db.test.ts`. Falta validar Storage real en piloto. |
| Inventario | Variante × sucursal, movimientos inmutables, reservas con TTL, entradas, salidas, devolución y transferencias | `modules/inventory/service.ts`, migración `20261038`; consumidores reales en pedidos, checkout y POS. Separado del inventario de Supply y del Car Wash. |
| Experiencia comercial | Ficha con inventario/ofertas/pedidos/historial, dashboard, disponibilidad pública sin cantidad, productos/servicios/ofertas | `modules/comercio`, componentes del catálogo; `comercio-experiencia.test.ts`, `postgres/comercio-experiencia.db.test.ts`, `e2e/comercio-experiencia.spec.ts`. |
| Pedidos | `MembegoOrder`, snapshots de líneas, atribución, confirmación del cliente, evidencia de pago y cierre atómico por QR | `modules/orders/service.ts`, `schema/pedidos.prisma`; `postgres/orders.db.test.ts`. El nivel de verificación se deriva, no se recibe del cliente. |
| Revenue Attribution | Snapshot de atribución al crear el pedido; determina elegibilidad de comisión junto al origen y evidencia de verificación | `modules/orders/atribucion.ts`, `orders/domain.ts`, `billing/domain.ts`; no representa tracking de impresiones/clicks ni analítica de embudo. |
| Checkout | Carrito por negocio en el navegador; revalida precio y stock en servidor; crea un pedido multilínea atómico | `modules/checkout`; pago al recoger o intención de transferencia. **Sin CardNET de MembegoOrder, cupones en carrito ni agenda/cupos.** |
| Merchant Billing | Cuenta por empresa, comisión al cierre, ledger inmutable, cortes, pagos manuales, límite y suspensión | `modules/billing`, `schema/facturacion-comercial.prisma`; pruebas de dominio, separación y `postgres/billing.db.test.ts`. No es facturación fiscal ni una pasarela de cobro automático. |
| Deals | Oferta sobre variante; reserva de presupuesto/cupo y pedido READY con QR; canje cobra la cuota congelada. MarketingCampaign distribuye Deals y atribuye el reclamo originado por su enlace | `modules/deals`, `schema/ofertas-marketplace.prisma`, módulos de campañas; `postgres/deals.db.test.ts`. Presupuesto es un tope, no dinero prepagado. No existe todavía un Coupon Engine común. |
| Marketplace | Catálogo, ofertas y perfiles públicos con disponibilidad agregada; usa proyecciones públicas y categorías de negocio | `modules/catalog/publico-nucleo.ts`, `modules/comercio/vitrina.ts`, rutas `/catalogo`, `/ofertas`, `/empresas`, `/cliente/explorar`. No mide impresiones y no implementa Discovery 2.0. |
| Promotions | Reglas universales y vigencia de `Promotion` condicionan reclamos nuevos de Deals; Deal conserva la autoridad del descuento y la economía. Promociones legacy y Supply siguen separados | `modules/deals/promotion-gate.ts`, `lib/promotions/application/promotion-engine.ts`, migración `20261053`; decisión y límites en `adr/ADR-GROWTH-COMMERCE-UNIFICATION.md`. Coupon, `Promocion` legacy y Supply no están unificados con este flujo. |
| Analytics | Ventas, pedidos, atribución, comisiones y resultados por producto/oferta/empresa; Supply Economics separado | `modules/analytics`, `modules/comercio`; `postgres/analytics.db.test.ts`. Sin impresiones/vistas ni embudo instrumentado de descubrimiento. |
| POS | Cobra pedidos con QR y ventas directas del catálogo, con turno, pago, stock y cierre en una transacción | `modules/pos/service.ts`; `postgres/pos.db.test.ts`. Mostrador DIRECT no comisiona; falta prueba de lector/térmica y devolución física de dinero. |
| Conciliación y riesgo | 27 reglas de conciliación y nueve señales de riesgo, consultas de solo lectura | `modules/conciliacion`, `modules/riesgo-comercio`; pruebas de dominio y PostgreSQL. No corrigen saldos ni bloquean automáticamente; umbrales no calibrados con negocio real. |
| Notificaciones/eventos | Avisos de pedido y stock con dedupe; eventos `pedido.*`, `inventario.*`, `oferta.*` | `orders/avisos.ts`, `inventory/avisos.ts`, `estrategias/eventos.ts`. **RISK:** `transaction committed → process crashes → notification/event may never persist`. Una vez persistido, el bus tiene worker y barrido de pendientes. El Outbox transaccional de Supply V2 podría reutilizarse tras diseñar el alcance Commerce/tenant. Sin entrega multicanal comercial garantizada. |
| Promociones legacy | `Promocion` y motor universal `Promotion` conviven mediante bridge legacy → universal | `modules/promociones/bridge.ts`, `lib/promotions`. Los Deals comerciales y las campañas/cupones de Supply son otros dominios. No declarar hecha su unificación. |
| Supply V2 | Procurement, lotes/FEFO, derechos/vouchers/QR, finanzas de proveedor, liquidaciones, beneficios, campañas, loyalty y operación | `modules/supply-v2`, esquemas `supply-v2*`, pruebas S1–S9. Conserva sus motores económicos y checkout. Pasarela externa real pendiente; `TEST_GATEWAY` es de pruebas. |
| Supply bridge | Proyección de ofertas como ítems de la casa y envoltorio idempotente de compras pagadas como pedidos `origin=SUPPLY` | `modules/supply-bridge/service.ts` y `pedido.ts`; `postgres/supply-bridge.db.test.ts`. Sincronización eventual, no segunda compra ni segundo cobro. |
| Separación landing / app / paneles | La landing informa y descubre y no opera; la app del cliente (`/cliente`) opera, con un solo carrito; los paneles no cambian. Traspaso por tipo de sesión, sesión ligera sin volver dinámica la landing, destinos de retorno validados, `/registro` en `(auth)` | `modules/comercio/rutas.ts` (mapa único), `components/public/TraspasoALaApp.tsx`, `lib/auth/destino-seguro.ts`, `lib/auth/sesion-ligera.ts`; guardias `tests/separacion-*.test.ts`. Tabla de rutas por espacio generada y verificada: [SEPARACION_LANDING_APP.md](SEPARACION_LANDING_APP.md). No toca datos, permisos, API ni reglas de negocio. El corte físico por dominios (F7) **no está hecho**; `/mis-membresias` y `/membresia/[id]` se quedan fuera de `/cliente` por la app móvil. |
| Supply V1 | Código, cron y pantallas retirados; esquema histórico conservado | 30 modelos en `schema/supply.prisma`. `SupplyCuentaCobro` y `SupplyPedido` aún tienen consumidores; **no borrar tablas** como limpieza documental. |
| CardNET | Flujo tokenizado web y BFF móvil para membresías/compras de promociones; importe y activación del servidor. Rutas antiguas de PAN/CVV devuelven 410 sin leer el body | `modules/pagos/cardnetToken.ts`, `cardnetClienteObjetivo.ts`, `/api/pagos/cardnet-token/*`, `/api/v1/cliente/pagos/cardnet/*`, `modules/pagos/cardnet3ds.ts`. Helpers legacy directos aún existen, pero no tienen consumidores internos. Pruebas locales sin operación real de pasarela. |

### Reglas financieras vigentes

La autoridad detallada es [REGLAS_FINANCIERAS.md](REGLAS_FINANCIERAS.md), contrastada con `billing/domain.ts`, `orders/domain.ts` y la migración `20261051`.

- La configuración inicial es HYBRID: CPA **RD$100** hasta tener pago verificado externamente; **8%** desde ese nivel; crédito **RD$5.000**, ciclo mensual y siete días de gracia. Es configurable. Que comercio venga encendido exige avisar y acordar las condiciones antes de operar con empresas reales.
- Una referencia escrita por el negocio es **MERCHANT_REPORTED**, no verificación externa. Se exige fuente admitida, fecha y referencia externa, junto con las condiciones de confirmación del pedido.
- Si la verificación llega después del cierre, se agrega `VERIFICATION_ADJUSTMENT` idempotente; puede ser negativo. No se reescribe la comisión original. El reembolso revierte ambos asientos.
- El origen de adquisición no es el lugar de cumplimiento: MARKETPLACE comisiona; otros orígenes pueden comisionar por atribución demostrable a Membego. POS/DIRECT no comisiona. Supply queda excluido tanto por origen como por documento fuente.
- Las ofertas mantienen su CPA congelada. Su presupuesto limita cuotas futuras; no es wallet. La suspensión de billing impide nuevas operaciones de oferta según sus guards; no debe impedir cumplir derechos existentes.

### Invariantes que se conservan

1. Monolito modular; reglas de dominio separadas de UI y acceso a datos. `modules/comercio` compone lecturas sin invertir las dependencias del catálogo.
2. Ítem y variante se crean en la misma transacción; pedidos, stock y ofertas referencian variantes. Precio y descuentos autorizados salen del servidor; las líneas son snapshots inmutables.
3. Orden de candados: **pedido → oferta → inventario → cuenta de billing**. `orders/service.ts` controla las transiciones; el canje vende stock y registra comisión dentro de la misma transacción.
4. `deals/reclamos.ts` no importa pedidos ni billing; solo el módulo de Deals escribe sus tablas. El reclamo es un pedido, sin voucher comercial paralelo.
5. Inventario y Merchant Billing se corrigen con movimientos compensatorios, nunca editando su ledger. Mantener CHECK, índices parciales, FK compuestas y triggers de las migraciones.
6. Merchant Billing **no comparte** tablas/ledgers con Supply Economics. Commerce Core no importa Supply V2; el bridge compone ambos. Supply es master de sus proyecciones de catálogo.
7. Superficies públicas pasan por sus proyecciones `publico-nucleo.ts`; no exponer existencias exactas ni entidades de otras empresas. `sinEmpresa` requiere una razón y filtros adecuados al consumidor.
8. RLS se genera por introspección con excepciones justificadas y se prueba entre tenants; no agregar políticas improvisadas. Ocultar capacidades conserva los datos.
9. Migraciones aplicadas son inmutables y selladas; `db push` no sustituye probar migraciones, triggers ni CHECK. No resetear bases reales.
10. No registrar PAN/CVV. Las rutas directas retiradas devuelven 410 antes de leer la petición; no reactivarlas. El importe compartido `montoDeObjetivo` aún se importa desde `cardnet3ds.ts` por el flujo tokenizado.

### Calidad de esta revisión

Resultados y comandos reproducibles en [CODEX_ONBOARDING_AUDIT.md](CODEX_ONBOARDING_AUDIT.md), con separación entre pruebas locales y checks históricos de GitHub. No reutilizar cifras de auditorías anteriores como evidencia del árbol actual.

- Esquema actual: **209 migraciones**, hasta `20261052_supply_v2_derechos_por_linea`; **305 modelos/tablas de aplicación**. No se añadió ni editó ninguna migración.
- Producción, secretos vigentes, overrides reales, Storage, CardNET real y equipos físicos: **NO VERIFICADOS** en esta sesión.
- Replay oculta texto, inputs y multimedia por defecto; no se envían breadcrumbs de consola. `request.data` se elimina y URLs/cookies/identificadores personales se filtran. Consultar `CODEX_ONBOARDING_AUDIT.md` para evidencia y límites.
- `COMMERCE_EXPERIENCE_AUDIT.md` fue restaurado desde su versión versionada en `3d958bb8` (PR #583) y eliminado en `126c2e47`. Es un registro histórico, no prueba de estado ni ejecución de la rama actual.

### Pendientes prioritarios

1. **CI del PR #596:** Vercel pasó y el build de producción de CI pasó; el job de tipos/lint/pruebas falló en una prueba de excursiones que usaba como futura una salida a las 09:00 en una fecha que ya era hoy. TypeScript y lint pasaron; 4.028 tests pasaron, uno falló y siete se omitieron. La corrección de fecha determinista ya pasa en la suite local completa (4.029 pasan, cero fallan, siete omitidas); falta que los checks remotos la ejecuten en una rama/PR.
2. **Producción no auditada:** operaciones debe confirmar la rotación de credenciales expuestas históricamente, especialmente la contraseña de BD, y el estado de RLS Capa 2/migraciones/overrides de capacidades. Esta revisión no accedió a secretos ni producción.
3. **Piloto y operación:** acordar tarifas y fiscalidad; probar [PILOT_FIELD_TEST.md](PILOT_FIELD_TEST.md), Storage, lector, térmica, móvil y modo oscuro con usuarios reales. Validar también atribución directa de campaña y utilidad de los reportes.
4. **Pagos:** validar CardNET tokenizado con credenciales QA aprobadas. No extenderlo al checkout comercial ni Supply sin diseño y pruebas específicas. No hubo cobros reales; helpers directos no deben reactivarse.
5. **Cierre de negocio y consistencia:** definir devoluciones monetarias POS/Supply y fiscalidad/e-CF; diseñar emisión atómica de eventos para evitar perder notificaciones tras el commit; mantener margen del bundle. Replay oculta texto e inputs por defecto, pero revisar logs de aplicación y retención histórica con operaciones.
6. **Alcance funcional pendiente:** no hay tracking de impresiones/clics ni conversión de exposición a reclamo; el cupón comercial sigue siendo `DealClaim` + pedido/QR. `SupplyV2Campaign`/`SupplyV2Coupon` y `Promocion` legacy siguen separados. Booking, bundles, Discovery 2.0 y entrega multicanal siguen fuera del alcance implementado.
7. **Calidad y dispositivos:** investigar 182 advertencias lint, siete tests unitarios omitidos y bundle al 97%; probar animaciones Expo, Android/iOS y flujos en dispositivos físicos. Storage, lector y térmica todavía no se ensayaron.

### Verificación local de cierre — 2026-10-12

Esta ejecución es posterior al merge `ab5c1711` y a los ajustes de portabilidad/test de esta rama; no reemplaza checks remotos ni pruebas contra servicios reales.

| Comprobación | Resultado |
|---|---|
| TypeScript | PASS — `npm run typecheck` |
| ESLint | PASS — `npm run lint`, 0 errores y 182 advertencias |
| Unit | PASS — `npm test`, 4.036 tests totales, 4.029 pasan, 0 fallan, 7 omitidos heredados |
| Build | PASS — `npm run build` con configuración sintética de CI; Turbopack compiló y generó 52 páginas estáticas. Sin base accesible, Prisma registró advertencias de conexión capturadas por las páginas que permiten degradación. |
| PostgreSQL, RLS conductual, E2E local y CardNET QA | NOT RUN en esta rama |

## HISTORIA / FASES ANTERIORES

Las fases siguientes son hitos de implementación, no certificados actuales de producción. Sus resultados de pruebas pertenecen al commit y al entorno que cada documento indica.

| Hito | Qué conservar | Registro |
|---|---|---|
| Plan Maestro, 2026-10-06 | Dirección Commerce OS + Marketplace + Supply; alcance por etapas, monolito y separación económica | [PLAN_MAESTRO.md](PLAN_MAESTRO.md), incluidas sus erratas históricas |
| F0–F4 | Primitivas, catálogo, inventario, bridge, pedidos y billing; correcciones de guards, moneda e invariantes | [AUDITORIA_2026-10-07_F0-F4.md](AUDITORIA_2026-10-07_F0-F4.md) |
| F5–F9 | Deals, analytics, POS, checkout, conciliación/riesgo; fixes de evidencia de pago y atribución | [AUDITORIA_2026-10-07_F5-F9.md](AUDITORIA_2026-10-07_F5-F9.md), [INFORME_2026-10-08_F0-F9.md](INFORME_2026-10-08_F0-F9.md) |
| Cierre de preparación, 2026-10-08 | Pago reportado/verificado, ajuste compensatorio, atribución, derechos por unidad y mediciones | [PRODUCTION_READINESS_REPORT.md](PRODUCTION_READINESS_REPORT.md), [RENDIMIENTO.md](RENDIMIENTO.md) |
| Supply S1–S9 y retiro V1 | Backend, decisiones FEFO/ledger/segregación, rediseño Stitch, rutas y retención de tablas V1 | [IMPLEMENTATION_STATUS_SUPPLY2.md](IMPLEMENTATION_STATUS_SUPPLY2.md), ADR en `docs/adr/` |
| Experiencia comercial, 2026-10-09 | Capacidades de comercio ON, navegación y conexiones entre módulos, catálogo público, avisos | PR #583; [auditoría histórica](COMMERCE_EXPERIENCE_AUDIT.md), fuente y pruebas `comercio-experiencia*` |

El [documento anterior completo, fijado al commit base](https://github.com/starlinpaulino94-cloud/MEMBEGO/blob/2f57b6aca41ed055ff2034289e719efc7636d8a1/docs/IMPLEMENTATION_STATUS.md) conserva el detalle cronológico, commits y resultados antiguos. Se retiraron de la memoria vigente sus versiones repetidas y contradictorias; no se perdió el historial Git.

**Mantenimiento:** actualizar la fila y decisión afectadas, con evidencia y fecha. Registrar resultados de una ejecución una sola vez en su informe; no anexar otra narración de F0–F9 ni mantener varios bloques «contexto para continuar».
