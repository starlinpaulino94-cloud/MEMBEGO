# MEMBEGO — IMPLEMENTATION STATUS

> Memoria operativa del proyecto. **El código manda**: lo que aquí contradiga a otra documentación está registrado en §14 («Discrepancias»).
> Estados permitidos: ✅ COMPLETED · 🟡 PARTIAL · 🔵 IN PROGRESS · ⚪ NOT STARTED · 🔴 BLOCKED · 🟣 DEPRECATED · 🙈 HIDDEN.
> Regla de mantenimiento: se actualiza al cerrar cada fase o cambio importante, y **antes de terminar cualquier sesión de implementación**.
> Fuente del plan: **[`docs/PLAN_MAESTRO.md`](PLAN_MAESTRO.md)** (v2, aprobado el 2026-10-06; versionado tal cual con un aviso y erratas). Los 4 documentos estratégicos de origen (`reestructura_1`…`4`) **siguen sin versionarse** (ver §17-A). Lo esencial del plan está resumido en §2, §13 y §17.

## 1. Estado general

```text
Fecha de actualización: 2026-10-06
Branch:                 claude/wizardly-hypatia-x2l9av (sincronizada con origin; sin PR abierto)
Commit actual:          ver `git log` (F1.1 = `16e8618`, F1.2 = `ce61167`; F1.3 es el commit posterior; antes: `3c73726` auditoría F0, `7c56aeb` + `708a9bb` higiene)
Estado general:         🟡 PARTIAL — fundaciones casi cerradas; Commerce Core con catálogo completo (admin, vitrina pública y API), **apagado** por capacidad
Fase actual:            F1 Commerce Catalog — ✅ rebanadas F1.1, F1.2 y F1.3 entregadas; 🟡 cierre pendiente de la validación con Storage real y E2E de CI (§3)
Última fase completada: ninguna al 100 % (F0: 4 de 6 ítems ✅, 2 🟡 por decisiones del usuario, sin código pendiente)
Próxima fase:           F2 Inventario y F2.5 Bridge Supply→Marketplace (en paralelo) 
```

- Membego es hoy un monolito modular maduro (290 modelos, 192 migraciones, 3 700 tests unitarios) con **Supply V2 como módulo más completo** (9 slices) y **una** entidad del Commerce Core objetivo: el catálogo (`CatalogItem`/`CatalogVariant`: pantallas de admin, vitrina pública, descubrimiento entre empresas y API v1; todo detrás de la capacidad `CATALOGO_UNIFICADO`, apagada de serie).
- Hecho en F0: capa `commerce-primitives` compartida; módulos secundarios ocultos por capacidades; CRM/Mensajería apagados por defecto en tenants nuevos; ruleta apagada también para el cliente.
- F1.1 añade 5 tablas `catalog_*`, 4 enums y 4 acciones de auditoría en **2 migraciones aditivas** (`20261036_catalog_core`, `20261037_catalog_core_enums`). Nada existente cambia de comportamiento: la capacidad `CATALOGO_UNIFICADO` nace **apagada para todos**. F0 no tocó `prisma/`.
- Calidad verificada tras F1.3: tsc, lint, 3 694 unit, 366 PostgreSQL, build, bundle, RLS (estático y conductual 22/22), 192 migraciones sin deriva en PASS. Las pantallas (admin, vitrina, detalle, descubrimiento, inicio) y la API se **recorrieron contra una app y una BD locales** (26/26 admin, 27/27 público, 28/29 API: la que falla es de entorno, §8); scripts locales fuera del repo, no corren en CI. **No se re-ejecutó la suite E2E** (67 PASS / 114 SKIP medidos en `3c73726`). **Falla hoy:** `npm audit` (1 high, `source-map-js`).
- Lo más urgente no es funcionalidad: **una clave `service_role` de Supabase está comprometida en git** (rotarla es del usuario, §14). La Server Action sin guardia (`subirImagenExcursion`) ya está **cerrada** (§14, «Deuda cerrada»).
- Dos decisiones abiertas del usuario: **corte de RLS Capa 2 en producción** y **Supply V1** (§16).

## 2. Progreso por fases

Numeración = Plan Maestro v2. Alias usados en el pedido: «F2 Supply→Marketplace Bridge» = **F2.5**; «F6 Marketplace Discovery» = parte de **F2.5**; «F7 Analytics» = **F6**; «F4 Economic Control» = **F4 Merchant Billing**. «Progreso» solo cuenta entregables verificados; no hay porcentajes inventados.

| Fase | Estado | Progreso | Objetivo | Resultado actual |
|---|---|---|---|---|
| **F0** Foundation Hardening | 🟡 | 4/6 ítems ✅, 2 🟡 | RLS completo, capacidades formalizadas, módulos ocultos, `commerce-primitives` | Primitives extraídas; ocultamiento hecho salvo Supply V1; RLS: cobertura OK, Capa 2 apagada en prod |
| **F1** Commerce Catalog | 🟡 | F1.1 ✅ · F1.2 ✅ · F1.3 ✅ | `CatalogItem` + `CatalogVariant` (variante default oculta) | Esquema, migración, RLS generada, capacidad/sección/permisos, servicio, acciones, **pantallas de admin** (lista, alta, detalle, variantes, fotos, categorías) y tests (55 PG + 60 unit), **vitrina pública** (sección en la página de la empresa, detalle, `/catalogo`, franja en el inicio) y **API v1** (5 recursos). Capacidad apagada de serie; sin probar contra Storage real ni en E2E de CI |
| **F2** Inventory General | ⚪ | 0 | `InventoryLevel` + `InventoryMovement` con ledger | Solo existe inventario carwash (`ProductoInventario`), no enlazado a ventas |
| **F2.5** Supply → Marketplace Bridge + Discovery | ⚪ | 0 | Items Supply en marketplace público + feed cross-company | Existen páginas públicas `/promociones/*` de Supply V2 y búsqueda de empresas, **sin bridge ni `CatalogItem`** |
| **F3** MembegoOrder + Attribution | ⚪ | 0 | Pedido unificado, atribución, confirmación dual | 5 modelos de orden desconectados (§6) |
| **F4** Merchant Billing | ⚪ | 0 | Comisión CPA + 8 %, ledger merchant | Nada factura a una empresa |
| **F5** Growth Engine (Deals/Campaigns con presupuesto) | ⚪ | 0 | Deals con presupuesto prepago | Sistemas paralelos sin consolidar (§4) |
| **F6** Analytics / Revenue Attribution | ⚪ | 0 | GMV, atribución, ROI | `modules/reportes` existe (basado en `Transaction`), sin atribución por orden |
| **F7** POS conectado | ⚪ | 0 | POS sobre catálogo/promos/cliente | POS básico (`modules/caja`) sin catálogo |
| **F8** Marketplace Checkout | ⚪ | 0 | Carrito + pago + pickup | Solo carrito de excursiones (localStorage) |
| **F9** Advanced Features | ⚪ | 0 | Loyalty unificado, riesgo, e-NCF, split payments | — |
| Supply V2 (pre-plan, ya construido) | 🟡 | 9 slices ✅ | Dominio de aprovisionamiento B2B | Núcleo completo; faltan pasarela real, reembolsos, edición de acuerdos en UI, WhatsApp (§5) |

Camino crítico del plan: **F0 → F1 → F2.5 → F3 → F4** (F2 en paralelo con F2.5). Estimaciones del plan (no medidas): ~13–14 semanas a revenue.

## 3. Fase actual — F1 Commerce Catalog (🟡) · F1.1, F1.2 y F1.3 entregadas

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

### Límites de la verificación de F1.3 (lo que NO se probó)
- Imágenes en la vitrina: **no hay fotos reales** en este entorno (sin Storage); se vieron los marcadores de posición. El renderizado con `next/image` de fotos de Supabase no se ejercitó.
- Sin recorrido en móvil ni modo oscuro; sin SEO real (metadata y OG de la ficha no se inspeccionaron más allá del `<title>`); no hay `sitemap` ni JSON-LD del catálogo.
- Los reintentos de `POST` no son idempotentes (la tabla de idempotencia es de satélites): se mitiga con el SKU único, documentado.
- El feed cross-company es la página `/catalogo` y la franja del inicio; **no** se integró en `/cliente/explorar` ni en el feed de novedades de la app del cliente.
- La capacidad se cachea hasta 5 min por empresa (`unstable_cache` del resolutor): apagarla desde el panel invalida el tag, pero un cambio directo en BD tarda hasta ese TTL.
- Sin carrito ni checkout: la ficha termina en «Ver empresa» (F8).

### Límites de la verificación de F1.2 (lo que NO se probó)
- La **subida real de imágenes a Supabase Storage** no se probó de extremo a extremo (no hay Storage en este entorno): se verificó que falla con aviso y sin romper, y la lógica de ruta/cupo/registro por PG y por lectura de código.
- El recorrido en navegador es un **script local fuera del repo** con una sesión firmada con el secreto de pruebas; **no corre en CI**. Los tests E2E autenticados siguen sin cobertura de CI (§14).
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
Bulk import; eventos de dominio (`CatalogItemCreated`…) y webhooks del catálogo; integrar el catálogo en `/cliente/explorar`; reordenar fotos más allá de «hacer portada»; editar el nombre de una categoría; **specs E2E de CI** para las pantallas de admin, la vitrina y la API; sitemap/JSON-LD; precios por ubicación/canal (`VariantPrice`). **Nada de esto bloquea**; y la capacidad sigue apagada para todas las empresas hasta que se encienda por override.

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

Verificado por grep en `prisma/`, `src/`, `tests/`: de las entidades objetivo solo existen las del catálogo (F1.1); `SupplyV2CatalogItem` es otra cosa (lo que un proveedor vende a Membego).

| Entidad | Estado | Schema | Service | UI | Tests | Equivalente actual / integración |
|---|---|---|---|---|---|---|
| CatalogItem | 🔵 | sí (`catalog_items`) | sí | sí (`/admin/catalogo` + vitrina pública + API) | sí | Coexiste con `Servicio`/`ProductoInventario`/`Promocion`/`Excursion` (no se migran); `SupplyV2CatalogItem` llegará por el bridge (F2.5) |
| CatalogVariant | 🔵 | sí (`catalog_variants`) | sí | sí | sí | Precio, costo, SKU por empresa. Pricing por ubicación/canal ⚪ (`VariantPrice` no existe). Equivalentes por vertical: `ExcursionVariante`, `ServicioPrecio`, `PlanPrecioCategoria`, `SupplyV2Offer.salePrice` |
| Inventory (Level/Movement) | ⚪ | no | no | no | no | `ProductoInventario.stock` + `MovimientoInventario` (carwash) |
| Customer | 🟡 | sí (`Cliente`, por empresa) | sí | sí | sí | La identidad global es `User` (Supply V2 pedidos usan `User`) |
| MembegoOrder / OrderLine | ⚪ | no | no | no | no | `Transaction`, `ProductoCompra`, `ReservaExc`, `SupplyV2CustomerOrder`, `Cita` |
| OrderAttribution | ⚪ | no | no | no | no | `Cliente.canalOrigen`, `VendedorAtribucion`, `SupplyV2CustomerOrder.campaignId` |
| PaymentEvidence | ⚪ | no | no | no | no | `ProductoCompra.comprobanteUrl`, `ReservaPago.comprobanteUrl` (por flujo) |
| Commission / MerchantLedger / MerchantStatement | ⚪ | no | no | no | no | `Comision` (carwash) y `ComisionEntrada` (vendedores) son pagos *a* personal, no cobros *a* empresas |
| Entitlement | 🟡 | sí (`SupplyV2Entitlement`) | sí | sí | sí | Solo Supply V2; `EntitlementEmpresa` es otra cosa (nombre en colisión) |
| Voucher | 🟡 | sí (`SupplyV2Voucher`) | sí | sí | sí | Solo Supply V2 |
| Redemption | 🟡 | sí (`SupplyV2Redemption`) | sí | sí | sí | + 3 flujos legacy (§4) |

## 7. Migraciones

192 directorios (`0_genesis` + 191) · `YYYYMMNN_slug` donde NN es un contador mensual (no un día; 51 prefijos no son fechas válidas, p. ej. `20260771_*`) · sellado SHA-256 en `prisma/migrations/SUMAS.txt` (192 migraciones selladas) con test de inmutabilidad en CI.

| Migración | Módulo | Estado | Riesgo | Verificada |
|---|---|---|---|---|
| `0_genesis` | Baseline | ✅ | Bajo | Replay PG16 local ✅ |
| `20260771_rls_barrera_publica` | RLS Capa 1 | ✅ | Medio: solo cubre tablas existentes al aplicarse | Replay ✅ + 0 grants anon |
| `20260914_home_rls` → `20260915_home_rls_al_mecanismo_generico` | RLS Home | ✅ (revertida) | Lección: no escribir políticas `membego_inquilino` a mano | Replay ✅ |
| `20260926`…`20261009` (10) | Supply V1 | ✅ | Medio: `20261008` 1 048 líneas, `20261009` 3 UPDATE | Replay ✅ |
| `20261010`…`20261035` (27) | Supply V2 | ✅ | Medio: backfills en `20261017` (6) y `20261026` (1) | Replay ✅ + 311 tests PG |
| `20261036_catalog_core`, `20261037_catalog_core_enums` | Commerce Core · catálogo | ✅ | Bajo: aditivas, idempotentes, sin backfill; el disparador diferido es la única pieza no trivial | Replay ✅ (192/192) · reaplicadas sin error · 0 deriva · 29 tests PG |
| `20260827_combo_horario_fijo_array` | Excursiones | ✅ | **Destructiva** (único `DROP COLUMN`) | Replay ✅ |
| `20260770_reconciliacion` | Pagos | ✅ | `ALTER COLUMN TYPE` ×8 | Replay ✅ |
| `20261030_supply_v2_bloque5_preferencias` | Supply V2 | ✅ | No idempotente (sin guardas) | Replay ✅ |
| `20260918_membresia_eventos_backfill` | Membresías | ✅ | Backfill desde `audit_logs` | Replay ✅ |
| `20260781`, `20260782` | Vehículos | ✅ | Backfill de placas **manual** (`scripts/backfill-placas.mjs`) | Replay ✅; ejecución en prod UNKNOWN |

```text
Última migración en el repo:   20261037_catalog_core_enums
Última migración aplicada:     UNKNOWN en producción (sin acceso a la BD). En PG16 local: 192/192 aplicadas.
Migraciones pendientes:        UNKNOWN en prod. `docs/DEVOPS.md`: el 2026-09-14 se aplicaron 18 a mano sin registrarlas en `_prisma_migrations`.
Migraciones destructivas:      0 DROP TABLE/TYPE/TRUNCATE/DELETE; 1 DROP COLUMN (20260827); 24 de las últimas 40 contienen ADD VALUE (irreversible en Postgres)
Backfills pendientes:          placas (manual); `visits.companyId` (manual, 2026-09-visitas-company-id; la política tiene respaldo por membresía mientras dure)
Migraciones de esta rama:      2 (`20261036_catalog_core`, `20261037_catalog_core_enums`)
Deriva esquema↔migraciones:    0 (`prisma migrate diff` → «No difference detected», verificado)
`prisma/migrations_manual`:    28 archivos, TODOS a mano (Capa 2, storage, geo, diagnósticos); estado de aplicación UNKNOWN
```

Hueco detectado: **ningún `ENABLE ROW LEVEL SECURITY` en migraciones posteriores a `20260916`** (105 `CREATE TABLE`, 67 de Supply V2; las 5 de `catalog_*` entran en esa misma categoría: las cubre Capa 2, no la migración). Capa 1 solo recorre tablas existentes al aplicarse; las nuevas dependen del SQL manual de Capa 2. Cobertura real en prod: UNKNOWN (verificar con `2026-07-rls-capa2-verificar.sql`).

## 8. Calidad

Medido el 2026-10-06 tras F1.3 (BD local desechable `membego_f11`, PostgreSQL 16, con Capa 1 + Capa 2 aplicadas; no producción). Se **repitieron** tsc, lint, unit, PostgreSQL, build, bundle, migraciones y todos los gates de RLS/permisos. **No se repitió la suite E2E** (su cifra sigue siendo la de `3c73726`); en su lugar, las pantallas nuevas se recorrieron con un script de navegador local (ver abajo).

```text
TypeScript:          PASS   tsc --noEmit, 0 errores
Lint:                PASS   npx eslint src tests (comando de CI): 0 errores, 16 warnings preexistentes
Unit Tests:          3694/3700 PASS · 0 FAIL · 6 SKIP (5 requieren servidor dev; 1 BLOCKED: claves QA reales de CardNET)
  · Supply V2:       354/354 PASS
  · F0 nuevos:       31/31 PASS (commerce-primitives 22, capacidades-fase0 9)
  · Higiene nuevos:  19/19 PASS (imagen-tipo 9, excursiones-imagen-guardia 10; este último falla 9/10 contra la versión vulnerable)
  · F1.1–F1.3 nuevos: 60/60 PASS (catalog-domain 19, catalogo-permisos 14, catalogo-publico 13, catalogo-api 9, catalog-formato 4, storage-rutas +1)
Integration Tests:   N/A    (no existe capa separada; los tests unitarios son puros o de texto fuente)
PostgreSQL Tests:    366/366 PASS  npm run test:db (16 archivos; 55 de catálogo: 31 + 10 de medios + 14 de público/API) sobre BD migrada con migrate deploy
E2E (Playwright):    NOT RUN tras F1.1. Última medición (`3c73726`): PASS parcial — 67 PASS · 0 FAIL · 114 SKIP (13,1 min; replica de e2e.yml sobre PG local, build propio)
                     Los 114 SKIP son por `AUTENTICADO=false`: sin Supabase de pruebas (docs/PRUEBAS-E2E.md §4). Con la misma
                     configuración de e2e.yml, los flujos AUTENTICADOS de cliente/admin/comisiones/sidebar no se ejercen.
                     Sí corrieron: recorrido público, registro v2 y los 9 slices de Supply V2 (sesión propia).
Build:               PASS   next build, con las variables de relleno de CI (rutas `/admin/catalogo*`, `/catalogo`, `/empresas/…/catalogo/…` y `/api/platform/v1/catalog-*` compiladas)
Recorridos locales:  PASS   admin 26/26 (sesión firmada con el secreto de pruebas) · páginas públicas 27/27 · API por HTTP 28/29 (la 29.ª, «sin credenciales → 401», da 503 `PLATFORM_API_UNCONFIGURED` en esta app local, igual que las rutas existentes). Scripts fuera del repo y de CI; Chromium + `next start` + PG local; 0 errores de consola
RLS Checks:          PASS   preflight 269/290 cubiertas (21 manuales; las 5 de catálogo, generadas) · cobertura-app OK · probar-rls 22/22 (Capa 1+2 aplicadas) · 0 grants anon
Migration Checks:    PASS   prisma validate · migrate diff 0 deriva · migrate deploy 192/192 · test de inmutabilidad · reaplicación idempotente de las 2 nuevas
Otros gates de CI:   PASS   transacciones-anidadas · permisos-catalogo (98 funciones) · accesibilidad-formularios y deuda-diseño (las pantallas nuevas llegaron a incumplirlos y se corrigieron)
npm audit (prod):    FAIL   1 high — source-map-js (DoS); el job `dependencias` de CI lo bloquearía. Preexistente.
Presupuesto bundle:  PASS   npm run presupuesto («Dentro de presupuesto»)
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
| Merchant Billing Ledger | — | ⚪ no existe | — | Previsto: append-only, `balance = Σ` | — |
| Inventory Ledger general | — | ⚪ no existe | — | Previsto: `available ≥ 0` | — |
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
| MEDIUM | 114 de 181 tests E2E se omiten por falta de Supabase de pruebas; las pantallas autenticadas **no tienen cobertura de CI**. Las de catálogo (F1.2) sí se recorrieron una vez en navegador con una sesión firmada con el secreto de pruebas (el app valida el token localmente cuando Supabase no responde); las de F0 (ruleta del cliente, personalización, menú) siguen sin recorrido | Cambios de UI verificados solo por unit/tipos/build (+ recorrido local de catálogo, no repetible en CI) | Convertir ese recorrido en una spec Playwright de CI (la sesión firmada con el secreto de `e2e.yml` no necesita Supabase) y extenderla a las pantallas de F0 |
| MEDIUM | Tablas posteriores a `20260916` sin `ENABLE ROW LEVEL SECURITY` por migración | Cobertura Capa 1 en prod desconocida | Ejecutar `2026-07-rls-capa2-verificar.sql` en prod |
| MEDIUM | 4 sistemas de lealtad y ~7,9k líneas de motores sin tests ni lectores | Complejidad y riesgo al consolidar | Consolidar en F5/F9; no crear un quinto |
| MEDIUM | Rate limiter fail-open; `MovimientoInventario` sin bloqueo; `BenefitGrant` mutable; `AuditLog` inmutable solo por convención | Condiciones de carrera / manipulación | Atender al construir F2 (inventario) y antes de F4 (billing) |
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
- Las pantallas autenticadas que cambió F0 (ruleta del cliente, `/admin/personalizacion`, menús) **no se han recorrido en navegador**: solo unit/tipos/build/E2E público.
- Cinco modelos de orden y cuatro de lealtad sin capa común: F3 puede duplicar lógica si no se acota.
- Cuatro listas de capacidades que se desincronizan en silencio (hay tests que avisan de algunas).
- **Catálogo:** `prisma migrate diff` no ve disparadores, `CHECK` ni índices parciales, así que el control de deriva **no** cubre las reglas que protegen el catálogo; solo las cubren los 29 tests PG. Un `createMany` de ítems seguido de variantes en otra transacción fallará al confirmar (es el comportamiento buscado). Las 12 acciones del catálogo y las rutas de API/vitrina se ejercieron contra una app local, pero con una sesión firmada localmente y sin Storage: nunca con una sesión de Supabase real, y los recorridos no están en CI.
- **API de catálogo:** `catalog:manage` amplía lo que puede hacer una clave de empresa (§3, «Decisión de seguridad»); los `POST` no son idempotentes (se mitiga con el SKU único).
- `commerce-primitives` solo se prueba con casos propios desde esta sesión; aún no lo consume nada fuera de Supply V2.

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

## 17. Próximo trabajo exacto

### A. Antes de F1 (corto, recomendado)
1. **(Usuario)** Rotar la clave `service_role`; confirmar si el ref `ybzhvfmybyyomwpjpaud` es producción; luego sacar los valores de `scripts/run-e2e-verify.mjs` y `scripts/run-auth-e2e.mjs` a variables de entorno y añadir secret scanning a CI.
2. ✅ ~~Cerrar `subirImagenExcursion`~~ (hecho, §14). **Pendiente derivado:** un test que enumere los `'use server'` sin guardia, con allowlist de las ~18 públicas por diseño (auth, registro, marketplace, geo, reset por token).
3. ✅ ~~Versionar el Plan Maestro~~ (hecho). **Pendiente:** versionar los 4 documentos estratégicos de origen (decisión del usuario; solo si se quieren en el repo).
4. Decidir Supply V1 (§16) y, si procede, separar la capacidad V1/V2.
5. `npm audit fix` y revalidar `npm audit --omit=dev --audit-level=high`.

### B. F1 — Commerce Catalog (por rebanadas)
**F1.1 — esquema, RLS, servicio y tests (sin UI): ✅ hecha el 2026-10-06** (§3). Desviaciones respecto a la versión anterior de este punto, ya registradas en §3: `companyId` propio + FK compuesta (no Nivel N por FK), sin `supplyV2CatalogItemId` (F2.5), `_enums` solo para `AuditAccion`.

**F1.2 — UI admin: ✅ hecha el 2026-10-06** (§3). Quedó fuera, a propósito: spec E2E de CI, importación masiva, eventos de dominio.

**F1.3 — Marketplace y API: ✅ hecha el 2026-10-06** (§3). **Antes de encender la capacidad en una empresa real** (rollout con Car Town primero, override en `/superadmin/capacidades`): (1) probar la subida de imágenes y su render en la vitrina contra un Storage real; (2) convertir los recorridos locales en specs E2E de CI; (3) decidir si se mantiene `catalog:manage` (§3); (4) revisar la vitrina en móvil y modo oscuro.

### C. Después
F2 Inventario y F2.5 Bridge en paralelo → F3 → F4 (ver §2). F2.5 reutiliza `CatalogItem` con `source=SUPPLY` (solo lectura para la empresa) y aprovecha la vitrina y la API de F1.3.

# CONTEXTO PARA CONTINUAR EN UNA NUEVA SESIÓN

- **Qué construimos:** Membego pasa de membresías/promos a un *Commerce OS + Marketplace + Supply* para negocios locales de RD, como monolito modular (sin microservicios, sin reescribir).
- **Fase actual:** F1 🟡 (rebanadas hechas, falta validar con Storage real y E2E de CI). **F1.1, F1.2 y F1.3 hechas** (catálogo: 5 tablas `catalog_*`, migraciones `20261036`/`20261037`, RLS generada, capacidad `CATALOGO_UNIFICADO` **apagada**, sección `catalogo`, `src/modules/catalog/`, 12 acciones, pantallas `/admin/catalogo` con variantes, fotos y categorías; vitrina pública, `/catalogo` y API v1 de catálogo; tests). F0 🟡 solo por 2 decisiones del usuario. Rama `claude/wizardly-hypatia-x2l9av`, sin PR. Commits: `99d87e6`, `2c2efe3`, `3c73726` (F0), `7c56aeb`, `708a9bb` (higiene), `16e8618` (F1.1), `ce61167` (F1.2); F1.3 es el siguiente.
- **Estado de calidad:** tsc/lint/3 694 unit/366 PG/build/bundle/RLS (22/22)/192 migraciones sin deriva en PASS tras F1.3; recorridos locales (admin 26/26, público 27/27, API 28/29 por entorno; no CI); **suite E2E no re-ejecutada** (67 PASS + 114 SKIP en `3c73726`); `npm audit` FALLA (1 high). Sin acceso a producción (todo lo de prod = UNKNOWN).
- **Siguiente paso exacto:** F2 Inventario y/o F2.5 Bridge (§2, §17-C). Antes de encender `CATALOGO_UNIFICADO` en una empresa real: Storage real, E2E de CI y decisión sobre `catalog:manage` (§3, §17-B).
- **No cambiar:** la API de catálogo no publica; lo público sale solo por `publico-nucleo.ts`; CatalogVariant desde el día 1; pedidos/inventario/promos referencian **variante**; Merchant Billing ≠ Supply Economics; Commerce Core no importa de `supply-v2`; CPA + 8 % por `verificationLevel`; sin wallet financiera; **no escribir políticas RLS a mano**; clave de cerrojo `supply_v2` (el catálogo usa `catalogo:<companyId>`); ocultar = apagar capacidad y conservar datos; toda alta de empresa usa `CAPACIDADES_OVERRIDE_TENANT_NUEVO`; ítems y variantes se crean en la **misma transacción** (disparador diferido).
- **Archivos clave:** `src/modules/catalog/*`, `prisma/schema/catalogo.prisma`, `src/lib/commerce-primitives/*`, `src/modules/capacidades/catalogo.ts`, `src/modules/plataforma/conceptos.ts`, `src/components/layout/nav-config.ts`, `src/modules/navegacion/contexto.ts`, `src/lib/auth/{guards,permissions,funciones}.ts`, `src/lib/tenant.ts`, `docs/RLS.md`, `docs/runbooks/rls-encender.md`, `docs/CAPACIDADES.md`.
- **Cómo verificar (todo corre aquí):** `npx tsc --noEmit` · `npx eslint src tests` · `npm test` · PG local: `pg_ctlcluster 16 main start` (clave `postgres`/`ci`; crear la BD y las extensiones `pg_trgm`, `pgcrypto`, `unaccent`), `migrate deploy`, `npm run test:db`. Para `rls:probar`: aplicar antes `20260771_rls_barrera_publica` (con roles `anon`/`authenticated`) y `2026-07-rls-capa2-aislamiento.sql` precedido de `-c "set membego.clave = '…'"` (como en `ci.yml`).
- **Riesgos que no se olvidan:** la subida real de imágenes a Storage no se ha probado; clave `service_role` en git (CRITICAL, rotar); Capa 2 apagada y `rls-cobertura` con falsos negativos; Supply V1 NO oculto y cron activo; el menú oculta Supply para todos por accidente; `migrate diff` no ve el disparador/CHECK del catálogo (solo los tests PG).
- **Decisiones del usuario aún abiertas:** corte Capa 2 en producción; qué hacer con Supply V1; rotar la clave `service_role`; si se versionan los 4 documentos estratégicos de origen.
- **Plan aprobado:** `docs/PLAN_MAESTRO.md` (con aviso y 6 erratas arriba del todo; las desviaciones de F1.1 están en §3 de este archivo).
- **Regla:** el código manda sobre la doc; no marcar nada ✅ sin verificarlo; actualizar este archivo al cerrar cada fase o sesión.
