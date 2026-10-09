# MEMBEGO — AUDITORÍA E IMPLEMENTACIÓN DE LA EXPERIENCIA COMERCIAL

> **Registro histórico restaurado el 2026-10-09 desde Git.** Este contenido existió versionado en `3d958bb8` (PR #583) y fue eliminado en `126c2e47`; por ello se restaura la fuente verificable, no se presenta como auditoría nueva. Sus observaciones, pruebas, capturas y veredicto corresponden a la rama/commit fechados en el encabezado y pueden haber cambiado. Para el estado vigente, rutas, pruebas y pendientes, consulte [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) y verifique el código actual. La limpieza de onboarding y su CI se registran en [CODEX_ONBOARDING_AUDIT.md](CODEX_ONBOARDING_AUDIT.md).

> Fecha: 2026-10-09 · Rama: `claude/gracious-pasteur-87pexr` · Base: `main` en `faf4996` (PR #582).
> Encargo: «completar la experiencia comercial real» — que Catálogo → Inventario → Promociones → Marketplace → Pedidos se **vea, se encuentre y funcione** de principio a fin, sin arquitecturas paralelas ni duplicados.
> Método: auditoría del código real (navegación, capacidades, permisos, rutas, servicios, esquema, tests) antes de escribir una línea; después, implementación por bloques con `typecheck`, `lint`, tests unitarios, PostgreSQL, E2E y `build` tras cada uno.

---

## 0. Veredicto en una frase

El Commerce Core **ya existía y era sólido** (catálogo, inventario con ledger, pedidos con reserva transaccional, ofertas sobre el catálogo, comisiones, analítica), pero estaba **apagado por capacidad para todas las empresas**, repartido en grupos de menú que no se leían como un sistema, y con pantallas que eran callejones sin salida (la ficha de un producto no enseñaba ni su stock ni sus ofertas ni sus pedidos; el cliente dentro de la app no veía ni productos ni ofertas; nadie avisaba al cliente del estado de su pedido). Este trabajo **no añade una arquitectura nueva**: enciende lo que había, lo agrupa, lo conecta y le pone la UX que faltaba. Detalle en §1–§4; qué queda pendiente en §7.

---

## 1. Qué existía (verificado en el código, no en la documentación)

| Dominio | Existía | Dónde |
|---|---|---|
| Catálogo unificado (`CatalogItem`, `CatalogVariant` con variante default oculta, categorías propias, imágenes) | ✅ esquema, servicio, acciones, `/admin/catalogo`, vitrina pública, API v1, 55 tests PG | `prisma/schema/catalogo.prisma`, `src/modules/catalog/*` |
| Inventario por variante × sucursal con ledger inmutable, reservas con TTL, transferencias, umbral de stock bajo | ✅ `/admin/inventario`, servicio con `FOR UPDATE`, idempotencia, CHECKs en la base, 63 tests | `prisma/schema/inventario.prisma`, `src/modules/inventory/*` |
| Pedidos Membego (`MembegoOrder`, líneas inmutables como snapshot, atribución, confirmación dual, QR de un uso) con **reserva al crear, venta al entregar, liberación al cancelar** | ✅ servicio transaccional, `/admin/pedidos-membego`, «Mis pedidos», escáner | `src/modules/orders/*` |
| Ofertas sobre el catálogo (`Deal` → `CatalogVariant`, `DealClaim` = un pedido LISTO con QR), precio calculado en el servidor | ✅ `/admin/deals`, `/ofertas`, cron, tests | `src/modules/deals/*` |
| Carrito por negocio + checkout multi-línea (todo o nada) | ✅ `/carrito`, `/carrito/pagar/[negocio]` | `src/modules/checkout/*` |
| Comisiones, cuenta de la empresa, analítica (GMV, canales, embudo, ofertas), conciliación y riesgo | ✅ | `billing`, `analytics`, `conciliacion`, `riesgo-comercio` |
| Supply V2 reflejado en el catálogo por el puente (`source = SUPPLY`) | ✅ | `src/modules/supply-bridge/*` |
| Notificaciones in-app con `dedupeKey`, bus de eventos `DomainEvent` + `encolar`, bitácora `AuditLog` | ✅ infraestructura | `notificaciones`, `estrategias/eventos.ts`, `lib/automation/domain/events.ts` |

## 2. Qué estaba oculto

1. **Las tres capacidades de comercio nacían APAGADAS para las 5 categorías** (`CATALOGO_UNIFICADO`, `PEDIDOS_MEMBEGO`, `DEALS_MARKETPLACE` en `src/modules/capacidades/catalogo.ts`). Catálogo, Inventario, Pedidos y Ofertas existían pero **ninguna empresa los veía** sin que un superadmin los encendiera uno por uno. Es la causa principal de «no encuentro el módulo de Catálogo ni el de Inventario».
2. Los roles acotados (Gerente, Cajero) nunca recibían las secciones de comercio, aunque el cajero es quien recoge el pedido en el mostrador.
3. El hub del panel llamaba «Catálogo» a un grupo que mezclaba catálogo, inventario, planes, beneficios y excursiones, y ponía **Pedidos Membego en «Operaciones»**: la cadena Catálogo → Inventario → Ofertas → Pedidos no se leía en ningún sitio.
4. El hub `/admin/ofertas` («Promoción pública», «Oferta relámpago», «Regalo VIP») **no enlazaba** a las ofertas sobre el catálogo (`/admin/deals`), que es la única oferta que el marketplace enseña con «antes / ahora».
5. Dentro de la app del cliente, el perfil de una empresa **no recibía ni catálogo ni ofertas**; `/cliente/explorar` era solo un directorio de negocios («Encuentra membresías»); el inicio no enseñaba ni ofertas sobre el catálogo ni productos; el buscador no indexaba ni productos ni ofertas; la navegación pública no enlazaba `/catalogo`, `/ofertas` ni `/empresas`.

## 3. Qué estaba incompleto

| Hueco | Consecuencia |
|---|---|
| La ficha del producto en el panel no enseñaba stock, ni sus ofertas, ni sus pedidos, ni su historial, ni enlazaba a Inventario | Para entender un producto había que visitar cuatro módulos y buscarlo en cada uno |
| `/admin/deals/nueva` no aceptaba preselección ni enseñaba el precio final | No se podía «crear promoción» desde el producto; la empresa escribía un 20 % sin ver «RD$9,600» |
| El detalle de la oferta no enlazaba al producto; las líneas del pedido no enlazaban a nada | Sistema sin hilos entre sus partes |
| El cliente **no recibía ningún aviso** (recibido, aceptado, listo, completado, cancelado); la empresa solo «Nuevo pedido» | El cliente entraba a «Mis pedidos» a mirar |
| Stock bajo: el umbral existía pero **nadie avisaba** | La lista de Inventario lo pintaba; la empresa se enteraba si entraba |
| **Cero eventos de dominio** de comercio en el bus (`DomainEvent`) | Automatizaciones y webhooks ciegos a pedidos, stock y ofertas |
| Analítica sin ventas por producto (ninguna consulta tocaba `membego_order_lines`) | La empresa no sabía qué vendió por Membego |
| Dashboard sin comercio: la CTA principal era «Nuevo Beneficio» → promoción legacy | El panel no reflejaba pedidos nuevos, stock bajo ni ofertas |
| Onboarding de empresa: 8 pasos de perfil, ninguno de comercio | Nadie guiaba a «crea tu primer producto» |
| Público: disponibilidad binaria («Agotado»), sin «Pocas unidades», sin sucursal con stock por variante; tarjetas sin «antes / ahora» ni distintivo de oferta; mismo CTA para todo | Marketplace que parecía un listado técnico |
| Vitrina con una sola sección «Productos y servicios»; sin sucursales en la pública | No había «Productos / Servicios / Ofertas / Información» |
| Categorías: cinco taxonomías; `/catalogo` sin filtro por categoría | No se podía navegar «Comida → pizzas y pizzerías» |
| Fixtures de tests que daban por hecho que el catálogo nace apagado | Habría que cambiarlas al encenderlo |

## 4. Qué se creó y qué se conectó (por commit)

### 4.1 Visibilidad (`39bf190`)
- **Capacidades**: `CAPACIDADES_COMERCIO = ['CATALOGO_UNIFICADO', 'PEDIDOS_MEMBEGO', 'DEALS_MARKETPLACE']` entra en el paquete base de las 5 categorías. Siguen siendo capacidades (se apagan por override en una empresa concreta), pero dejan de nacer ocultas. El arnés E2E y las fixtures PG escriben ahora el override **explícito** (`false` apaga).
- **Menú de la empresa**: el grupo del hub pasa a **«Comercio»** (id `comercio`) con, en orden de uso: Catálogo, Inventario, Pedidos Membego, **Ofertas y Promociones** (`/admin/deals`, antes «Ofertas con presupuesto»), **Beneficios y regalos** (`/admin/ofertas`, el hub legacy), Planes, Excursiones. Pedidos sale de «Operaciones».
- **Roles**: Gerente recibe `catalogo`, `inventario`, `pedidos-membego`, `deals`; Cajero recibe `pedidos-membego`.
- **Hub de Beneficios y regalos**: nueva tarjeta «Oferta sobre un producto o servicio» → `/admin/deals` (solo con la capacidad).
- **Dashboard**: la CTA principal pasa a «Nuevo producto o servicio» (`/admin/catalogo/nuevo`).

### 4.2 Catálogo como centro (`39bf190`)
- **`src/modules/comercio/panorama-item.ts`** (nuevo módulo neutro `comercio`: compone lecturas de catálogo, inventario, ofertas, pedidos y bitácora **sin que el catálogo importe del inventario** — el test de dirección de dependencias sigue en verde): stock por variante y sucursal, ofertas vivas con «antes / ahora», pedidos de 90 días (unidades, ventas, descuento, pedidos que esperan), historial legible de la bitácora.
- **Ficha del producto** (`/admin/catalogo/[id]`): secciones ancla **Información · Variantes y precio · Inventario · Promociones · Pedidos · Marketplace · Historial**. Inventario enseña «Bávaro 100 / Verón 40» con «Administrar inventario» y «Movimientos»; Promociones enseña las ofertas con precio antes/ahora y el botón **«Crear promoción»** (preselecciona la variante); Pedidos enseña los que esperan y lo vendido; Marketplace enseña los canales (Marketplace ✓, Perfil público, POS) y «Ver como cliente»; Historial, la bitácora del ítem y sus variantes.
- **Lista del catálogo**: portada, «Stock gestionado», estado de stock (En stock / Stock bajo / Agotado), «Marketplace ✓», paginación real y el estado vacío del encargo («Todavía no tienes productos o servicios… [Crear primer producto]»). El resumen de stock lo calcula `src/modules/comercio/stock.ts` sobre niveles crudos que el catálogo solo lee.
- **Inventario**: las reservas vivas enlazan al pedido.

### 4.3 Promociones ↔ catálogo (`39bf190`)
- `/admin/deals/nueva?variante=…` (o `?item=…`) preselecciona el producto (solo si es ofertable por esa empresa) y propone el título; el formulario enseña **«Así lo verá el cliente: Antes RD$12,000 · Ahora RD$9,600 · ahorra RD$2,400»** mientras se escribe (misma regla que `precioDeLaOferta`; el servidor recalcula y manda) y **avisa si el producto está agotado** (la oferta se crea igual, el marketplace la mostrará como «Agotado»: crear una promoción nunca toca el stock).
- El detalle de la oferta enlaza al producto del catálogo y explica que lo **referencia** (no hay «AirPods Promoción» duplicado).
- Las opciones de producto del formulario traen `itemId` y `sinStock`.

### 4.4 Pedido ↔ inventario ↔ avisos ↔ eventos ↔ analítica (`89c7ed8`)
- Verificado (no reescrito): `crearPedidoEnTx` **reserva** con `FOR UPDATE` e idempotencia; `completarPorQrEnTx` **consume la reserva como SALE**; `cancelarPedidoEnTx` **libera** (`RESERVATION_RELEASE`); el precio sale del catálogo y `precioUnitario`/`descuento` del navegador se rechazan (`PRECIO_NO_PERMITIDO`, `DESCUENTO_NO_PERMITIDO`); las líneas son snapshot inmutable (nombre, variante, `unitPrice`, `discount`, `lineTotal`, cantidad).
- **`src/modules/orders/avisos.ts`** (nuevo): `avisarPasoDelPedido(companyId, pedidoId, paso, por)` — al **cliente** (si su ficha tiene cuenta): Pedido recibido / confirmado / confirma el monto / listo (con la sucursal) / completado / cancelado (con motivo) / reembolsado; a la **empresa**: Nuevo pedido, Un cliente canceló su pedido, Pedido cancelado por falta de respuesta, Pedido entregado. `dedupeKey = pedido:<id>:<paso>`: repetir no repite. Best-effort y **después** de la transacción. Conectado en `orders/actions.ts`, `escaner-actions.ts`, `cliente-actions.ts`, `checkout/actions.ts`, `orders/barrido.ts` y en el reclamo de ofertas (`deals/cliente-actions.ts`: el cliente recibe «Tu oferta está lista»).
- **`src/modules/inventory/avisos.ts`** (nuevo): `avisarStockBajo(companyId, varianteIds)` tras apartar o vender: solo niveles con umbral, **un aviso por nivel y día**, «Stock bajo» o «Producto agotado» con enlace a `/admin/inventario/<variante>`.
- **Eventos de dominio** en `lib/automation/domain/events.ts`: `pedido.creado/aceptado/listo/completado/cancelado/reembolsado`, `inventario.reservado/vendido/stock_bajo`, `oferta.obtenida`, `oferta.canjeada` (la oferta se da por **canjeada** solo al cerrar el pedido con el QR: «obtenida ≠ aplicada ≠ canjeada»). Emitidos por `emitirEventoEstrategia` (persisten en `DomainEvent`, los consume el worker).
- **Analítica por producto**: `productosEnTx` en `analytics/queries.ts` (pedidos, completados, cierre, unidades, ventas, descuento, por ítem, solo marketplace) y la tabla «Ventas por producto» en `/admin/resultados-membego`. **No se inventan visualizaciones**: no hay tracking de vistas de producto, y la pantalla lo dice.
- **Dashboard**: fila **«Comercio Membego»** (`src/modules/comercio/dashboard.ts`): pedidos nuevos (enlace al filtro), en curso, ventas Membego del mes, catálogo publicado, stock bajo (enlace a `/admin/inventario?estado=BAJO`), ofertas activas y canjes del mes. Solo los módulos encendidos.
- **Onboarding de empresa** (`empresas/onboarding.ts`): pasos de comercio — sucursal activa, primer producto, disponibilidad/inventario (hecho si ningún ítem controla inventario o ya hay existencias), publicado en el marketplace, primera oferta — **sin bloquear** la publicación del perfil (`requeridoParaPublicar: false`, con la etiqueta «comercio» en la lista).

### 4.5 Marketplace (`89c7ed8`, `7a7be81`)
- **Proyección pública** (`catalog/publico-nucleo.ts`): `disponibilidad: 'DISPONIBLE' | 'POCAS_UNIDADES' | 'AGOTADO'` por variante y por ítem — **nunca la cantidad**; «Pocas unidades» **solo si la empresa fijó umbral** (`lowStockThreshold`) y lo disponible lo cruzó; `sucursalesConStock: string[] | null` (ids, no cantidades; `null` = no controla inventario). La lista blanca sigue sin `onHand`, `reserved`, `cost`, `sku`, `barcode`, `capabilities`; el test PG lo comprueba con la cantidad exacta (100) en la base.
- **`src/modules/comercio/vitrina.ts`** (puro): la mejor oferta viva por ítem (`indiceDeOfertas`), `% OFF`, `separarCatalogo` (Productos / Servicios), `ctaDelItem` («Obtener oferta» / «Ver producto» / «Reservar» / «Ver oferta Membego» / «Ver detalle»).
- **Tarjeta de producto**: imagen, distintivo «20% OFF» o «Agotado», nombre, empresa, «Antes / Ahora» o «Desde», disponibilidad en color, «Servicio» / «Para recoger», CTA por tipo.
- **Vitrina de la empresa** (`CompanyProfile`): secciones **Productos · Servicios · Ofertas** (más Membresías, Promociones legacy, Beneficios, Eventos, Noticias, Actividades, Galería, Reseñas, Información), solo las que tienen contenido; cada tarjeta lleva su oferta. La pública recibe ahora las **sucursales**; la de la app recibe **catálogo y ofertas**.
- **Detalle del producto**: galería, nombre, empresa, categorías, **precio normal y promocional con ahorro** (con «%OFF» sobre la imagen), disponibilidad por variante, **la oferta viva con sus condiciones y «Obtener oferta»**, «Se recoge en: Bávaro · Verón», «Agregar al carrito» + «Hacer un pedido» (producto) o «Reservar este servicio» (servicio); `PedirForm` **deshabilita las sucursales sin stock** de la variante elegida.
- **Explorar** (`/cliente/explorar`): pestañas **Negocios · Productos · Servicios · Ofertas**, buscador y **una taxonomía transversal** (las categorías de negocio) que filtra por igual negocios, productos y ofertas (`catalogoPublicoGlobal({ categoriaNegocio, tipo })`, `ofertasPublicas({ q, categoriaNegocio })`). «Marca única» solo redirige la pestaña Negocios.
- **Inicio del cliente**: bandas **«Ofertas destacadas»** y **«Nuevo en Membego»** (`VibeComercio`), con la categoría activa del inicio; **sin empresas escritas a mano**.
- **Búsqueda** (`buscarUnificado` + `/cliente/buscar`): devuelve y pinta **Ofertas** y **Productos y servicios** antes que empresas, promociones legacy y excursiones.
- **`/catalogo`**: chips de categoría de negocio y «antes / ahora» en las tarjetas.
- **Navegación**: cliente — «Explorar» en Descubrir; pública — Negocios, Productos y servicios, Ofertas.
- **Supply**: sigue por el puente y su propio checkout, con el distintivo «Oferta MembeGo» (no se convierte en inventario de la empresa).

## 5. Rutas y navegación por rol (tabla obligatoria)

| Rol | Módulo | Ruta | Menú | Capacidad / sección |
|---|---|---|---|---|
| Admin | Catálogo | `/admin/catalogo` | Comercio › Catálogo | `CATALOGO_UNIFICADO` · sección `catalogo` (crear, editar, publicar, archivar, variante) |
| Admin | Nuevo producto o servicio | `/admin/catalogo/nuevo` | Catálogo › «Nuevo producto o servicio» · Dashboard CTA · estado vacío | `CATALOGO_UNIFICADO` · `catalogo.crear` |
| Admin | Ficha del producto (Información, Variantes, Inventario, Promociones, Pedidos, Marketplace, Historial) | `/admin/catalogo/[id]` | desde la lista | `CATALOGO_UNIFICADO` |
| Admin | Inventario | `/admin/inventario` · `/admin/inventario/[varianteId]` | Comercio › Inventario · ficha › «Administrar inventario» · Dashboard › Stock bajo | `CATALOGO_UNIFICADO` · sección `inventario` (ajustar, transferir) |
| Admin | Pedidos Membego | `/admin/pedidos-membego` · `[pedidoId]` | Comercio › Pedidos Membego · Dashboard › Pedidos nuevos | `PEDIDOS_MEMBEGO` · sección `pedidos-membego` (gestionar, cancelar, reembolsar) |
| Admin | Ofertas y Promociones (sobre el catálogo) | `/admin/deals` · `/admin/deals/nueva[?variante=\|?item=]` · `[dealId]` | Comercio › Ofertas y Promociones · ficha del producto › «Crear promoción» · Beneficios y regalos › «Oferta sobre un producto» | `DEALS_MARKETPLACE` · sección `deals` (crear, publicar, presupuesto, archivar) |
| Admin | Beneficios y regalos (promoción pública, banner, regalo VIP — legacy) | `/admin/ofertas` → `/admin/promociones`, `/admin/marketing`, `/admin/ofertas/vip` | Comercio › Beneficios y regalos | sin capacidad · secciones `ofertas`, `promociones`, `marketing` |
| Admin | Campañas | `/admin/campanas` | Marketing › Campañas | sin capacidad · sección `campanas` |
| Admin | Clientes | `/admin/clientes` | Clientes › Directorio | sección `clientes` |
| Admin | Resultados Membego (ventas por producto y por oferta) | `/admin/resultados-membego` | Operaciones › Resultados Membego · ficha › «Ver pedidos» | `PEDIDOS_MEMBEGO` · sección `resultados-membego` |
| Admin | Dashboard › Comercio Membego | `/admin/dashboard` | Principal › Resumen | módulos encendidos |
| Gerente | Catálogo, Inventario, Pedidos, Ofertas y Promociones | ídem | Comercio | paquete por oficio (`RESTRICTED_ACCESS.GERENTE`) |
| Cajero | Pedidos Membego · Escanear QR · Caja | `/admin/pedidos-membego`, `/admin/scanner`, `/empleado/caja` | Comercio › Pedidos · Operaciones › Escanear QR | `RESTRICTED_ACCESS.CAJERO` · `POS_MEMBEGO` para cobrar en caja |
| Superadmin | Capacidades por empresa (encender/apagar comercio) | `/superadmin/capacidades` | Operación › Capacidades | — |
| Superadmin | Puente Supply → Catálogo · Cobros · Analítica · Conciliación · Riesgo | `/superadmin/puente-supply`, `/superadmin/facturacion`, `/superadmin/analitica`, `/superadmin/conciliacion`, `/superadmin/riesgo` | Operación | — |
| Cliente | Inicio (Ofertas destacadas, Nuevo en Membego, categorías, empresas) | `/cliente/inicio` | Inicio | — |
| Cliente | Explorar (Negocios · Productos · Servicios · Ofertas, categorías) | `/cliente/explorar[?ver=productos\|servicios\|ofertas][&category=][&q=]` | Descubrir › Explorar · Inicio › «Ver todas / Ver más» | — |
| Cliente | Buscar (ofertas, productos, empresas, promociones, excursiones) | `/cliente/buscar?q=` | buscador de la cabecera | — |
| Cliente | Cerca de mí (sucursales reales) | `/cliente/cerca` | Descubrir › Cerca de mí | — |
| Cliente | Vitrina de la empresa (Productos, Servicios, Ofertas, Información…) | `/cliente/empresas/[slug]` · pública `/empresas/[slug]` | Explorar › negocio · Inicio › empresa | — |
| Cliente | Detalle del producto (oferta, disponibilidad, sucursal, pedir / reservar / obtener) | `/empresas/[slug]/catalogo/[item]` | tarjeta de producto | la empresa debe tener `CATALOGO_UNIFICADO` (+ `PEDIDOS_MEMBEGO` para pedir, `DEALS_MARKETPLACE` para la oferta) |
| Cliente | Carrito · Pagar | `/carrito` · `/carrito/pagar/[slug]` | icono del carrito · «Agregar al carrito» | `PEDIDOS_MEMBEGO` de la empresa |
| Cliente | Mis pedidos (seguimiento, confirmar monto, QR, cancelar) | `/cliente/pedidos` · `[id]` | Mi Membego › Mis pedidos · avisos | visible si la empresa recibe pedidos o la persona tiene alguno |
| Cliente | Mi QR | `/cliente/qr` | dock › Mi QR | — |
| Público | Productos y servicios · Ofertas · Negocios | `/catalogo` · `/ofertas` · `/empresas` | nav pública | — |

## 6. Cómo se verificó

| Check | Resultado |
|---|---|
| `tsc --noEmit` | ✅ limpio |
| `eslint .` | ver `IMPLEMENTATION_STATUS.md` §8 (corrida final) |
| Unit (`tsx --test tests/*.test.ts`) | ✅ 3 935 (los 5 que fallaban tras los cambios se corrigieron en su causa: ids del hub, fixture del catálogo, regex de `/catalogo`, radios y micro-textos fuera del vocabulario) |
| PostgreSQL (`test:db`, base migrada) | ✅ 648 + **7 nuevos** en `tests/postgres/comercio-experiencia.db.test.ts` |
| E2E nuevo `tests/e2e/comercio-experiencia.spec.ts` (escritorio, sesiones firmadas, base `db push`) | ✅ **9/9** en 37 s: menú Comercio → crear producto → ficha con 7 secciones → Inventario 100 + umbral → publicar → promoción preseleccionada con vista previa → vitrina y Explorar con antes/ahora/«Disponible» sin la cantidad → compra 2 (reserva 2, avisos a ambos) → aceptar/listo (avisos, QR) → escáner → COMPLETED, onHand 98, SALE, analítica |
| E2E existentes tocados (`catalogo-admin`, `catalogo-publico`, `pedidos-membego`, `deals-membego`, `inventario-admin`, `puente-supply`, `carrito-checkout`, `publico`, `analitica-membego`, `pos-membego`) | ver `IMPLEMENTATION_STATUS.md` §8 (corrida final) |
| `next build` | ✅ |
| Capturas (`tests/e2e/capturas-comercio.spec.ts`, `E2E_CAPTURAS=1`) | `docs/capturas/comercio/*.png` (móvil y escritorio) |

### Los cinco E2E obligatorios del encargo

| # | Escenario | Dónde | Resultado |
|---|---|---|---|
| 56 | Empresa → sucursal → producto → 100 u → publicar → 20 % → cliente ve precio promo y no el stock → compra 2 → reserva 2 → empresa acepta/prepara → avisos → QR → COMPLETED → onHand 98 → analítica | PG test 1 (servicio) + E2E 9/9 (interfaz) | ✅ |
| 57 | Servicio sin inventario → 25 % → obtener → QR → canje, sin movimientos de stock | PG test 2 | ✅ |
| 58 | Stock 1, dos clientes a la vez → una reserva, un rechazo, disponible 0 | PG test 3 (+ los 20/5 y 2/1 ya existentes en `inventory.db`) | ✅ |
| 59 | 100 → compra 2 → 98 → cancela → 100 | PG test 4 | ✅ |
| 60 | Base 1 000 · 20 % → línea `unitPrice 1000 / discount 200 / lineTotal 800`; precio del navegador rechazado; snapshot inmutable | PG test 5 | ✅ |
| + | «Pocas unidades» solo con umbral; stock bajo avisa una vez al día; textos por actor | PG tests 6–7 | ✅ |

## 7. Qué queda pendiente (honesto)

**Decisiones de producto / negocio**
- Las capacidades de comercio están **encendidas de serie**: una empresa ya registrada verá Catálogo, Inventario, Pedidos y Ofertas al entrar. Si alguna no debe tenerlos, se apagan por override en `/superadmin/capacidades`. Conviene **avisar a las empresas** de las comisiones (`PEDIDOS_MEMBEGO` activa Merchant Billing: CPA por pedido entregado) antes de un piloto.
- Legacy: `Promocion` (promoción pública), `MarketingCampaign` (banner), `OfertaPrivada` (regalo VIP) y `Campana` siguen como **beneficios sin producto**; no referencian al catálogo y no se migran. Las «Campañas» que distribuyen ofertas del catálogo (Plan Maestro F5 Campaigns) **no existen**.
- **Cupones de comercio**: no hay modelo (`Promocion.codigo` es texto; el cupón real es de Supply V2). El carrito no aplica ofertas ni cupones: la oferta se obtiene por su propio flujo (un pedido LISTO con QR, 1 unidad).

**Técnico (no bloquea el piloto, sí conviene saberlo)**
- **Capacidad de servicios** (fecha, hora, cupo): no se construyó. Un servicio se vende sin stock (`manageInventory = false`) y su CTA es «Reservar», que hoy crea un pedido con nota; la agenda real sigue en el módulo de Citas, sin unirse al pedido.
- **Bundles**: el tipo `BUNDLE` existe; no hay kit de inventario que descuente componentes.
- **Cerca de mí**: usa sucursales reales, pero cuenta promociones legacy, no ofertas del catálogo ni productos.
- **Vistas de producto / impresiones de oferta**: no se miden; la analítica lo dice en vez de inventar la cifra.
- **Subcategorías**: `BusinessCategory` es plana. La taxonomía transversal funciona a un nivel («Comida»); «Comida → Pizza» exige `parentId`.
- **Reserva vs. cupón**: la reserva de inventario vence a los 7 días; una oferta puede valer hasta 60. Si el pedido sigue LISTO al vencer la reserva, el cierre vende de lo disponible y, si no alcanza, el pedido queda LISTO con error claro (ya estaba así).
- **Canales**: «Perfil público» es hoy el mismo interruptor que «Marketplace» (`availableMarketplace`); no hay canal separado.
- **Avisos**: in-app (campanita) con dedupe. Correo/WhatsApp del cliente para pedidos no se conectaron (la infraestructura existe en Supply V2).
- **E2E en CI**: el nuevo spec corre en el proyecto `escritorio` con sesiones firmadas, como los demás de Commerce Core; hay que confirmarlo en un runner de GitHub.
- Deuda heredada ya documentada (clave `service_role` en el historial, RLS Capa 2, CardNET) sigue igual.

## 8. Veredicto para el piloto

**Listo para un piloto controlado** (una o pocas empresas, con alguien de Membego acompañando): la cadena «creo lo que vendo → controlo lo que tengo → hago ofertas sobre eso mismo → recibo pedidos → entrego con QR» funciona de principio a fin, está visible en el menú, protegida por permisos y capacidades, probada contra PostgreSQL real y por la interfaz, y el consumidor descubre empresas, productos, servicios y ofertas, compra u obtiene, sigue su pedido y usa su QR. **No está listo** para un lanzamiento abierto sin antes: avisar a las empresas de la comisión, decidir qué hacer con los beneficios legacy frente a las ofertas del catálogo, y recorrerlo con una persona en un móvil real (y modo oscuro) con un lector de QR físico.
