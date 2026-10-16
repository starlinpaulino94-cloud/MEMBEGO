# Auditoría del estado · 2026-10-16

**Qué se audita:** todo lo entregado por esta sesión hasta hoy —el programa de inventario INV-1 → INV-5b3— y el entorno en que se entrega
(rama, CI, migraciones, despliegue, documentación). **Cómo:** sobre hechos, no de memoria: historial de git, estado del código en
`HEAD` (`75a2959f`), los registros de GitHub Actions, las puertas estáticas del repo (`rls:cobertura`, `rls:preflight`, deuda de diseño,
presupuesto de bundle, `npm audit`), y una comprobación en el navegador sobre el build de producción local. Cada cifra de este documento
sale de un comando ejecutado hoy; lo que no pude comprobar está en § 9.

**Resumen en seis líneas.**

1. El código está **sano y bien cubierto**: 0 errores de tipos y lint, 968/968 pruebas contra PostgreSQL, 20/20 E2E de inventario, autorización en
   las 40 acciones y las 15 descargas, SQL siempre parametrizado, 0 vulnerabilidades en dependencias de producción.
2. **El despliegue de migraciones es automático** al fusionar en `main` (flujo «Migrar y desplegar»), y ya aplicó en producción las `20261059`,
   `20261060` y `20261066`. La instrucción que repetí en cada entrega («aplica el SQL a mano en Supabase») estaba **desfasada**: viene de un
   documento viejo. Las tres migraciones de la rama (`20261067`, `20261068`, `20261069`) se aplicarán solas al fusionar; la `20261068` conviene
   fusionarla en hora valle.
3. **Siete entregas (INV-4a → 5b3, +19 309 líneas) no han pasado por el CI remoto**: el CI solo corre en `pull_request` y en `main`, y no hay PR
   abierto. Solo tienen la verificación local de cada entrega. Y en `main`, ningún E2E remoto ha terminado en verde desde INV-3a (uno cancelado,
   uno caído por infraestructura).
4. **Un fallo de interfaz nuevo, confirmado en el navegador**: en las pantallas con filtros, «Quitar filtros» limpia la lista pero el formulario
   **conserva** el valor anterior (13 de 14 pantallas; solo «Vence pronto» lo tiene bien). Arreglo pequeño y mecánico.
5. **Documentación desfasada** en cuatro sitios (migraciones «a mano», conteo de migraciones, verificadores SQL generados hace 19 migraciones,
   y mis propias secciones de verificación).
6. **Deuda que crece**: `service.ts` de 2 998 líneas con funciones de hasta 203; la deuda de diseño está **al tope** (147/147) y el bundle al 97 %
   de su indicador general; una prueba de Supply V2 frágil; un E2E de separación que falla en este entorno desde antes.

---

## 1. Dónde está cada cosa

| Qué | Dónde | Estado |
|---|---|---|
| INV-1 → INV-3c (movimientos, entradas, conteos, transferencias, costos, compras, reposición) | `main` (`be77cf76`, PRs #615 INV-3a, #616 INV-3b, #617 INV-3c del 14 y 15 de octubre) | **fusionado y desplegado**: sus migraciones (`20261059`, `20261060`, `20261066`) las aplicó el flujo automático y disparó Vercel |
| INV-4a, 4b, 4c, 5a, 5b1, 5b2, 5b3 | rama `claude/gracious-pasteur-87pexr`, 9 commits sobre `main` (7 entregas + 2 fusiones de `main`): 103 archivos, +19 309 / −327 | **sin PR, sin CI remoto, sin desplegar**; `main` no se ha movido desde la base |
| Migraciones de la rama | `20261067_inventory_reason_codes`, `20261068_inventory_lots`, `20261069_inventory_count_lots` (selladas en `SUMAS.txt`; `migrate diff` sin deriva) | **pendientes de producción porque la rama no se ha fusionado**, no porque haya que pegarlas a mano |

Commits de la rama, del más nuevo al más viejo: `75a2959f` 5b3 · `9e0a5b2e` 5b2 · `2caec536` 5b1 · `ca2591e6` 5a · `8d1167ff` 4c · `07c98623` 4b ·
`679a3d0a` (merge main) · `c593c676` 4a · `2a1bc33b` (merge main).

## 2. Cómo se despliega de verdad (y qué dije mal)

`.github/workflows/deploy-migraciones.yml` («Migrar y desplegar») corre en cada `push` a `main`: detecta migraciones nuevas, comprueba el secreto
`MIGRATIONS_DATABASE_URL`, hace `prisma migrate status`, **`prisma migrate deploy`** contra la base real y, si todo va bien, dispara el *deploy
hook* de Vercel (el auto-deploy de Git está apagado en `vercel.json`: producción **solo** se despliega desde este flujo, después de migrar). Está
documentado en `docs/DEVOPS.md`. Los registros de Actions lo confirman:

| Merge | Fecha | Qué aplicó `migrate deploy` | Vercel |
|---|---|---|---|
| #615 (INV-3a) | 2026-10-14 21:58 | `20261059_inventory_costs` («226 migrations found… All migrations have been successfully applied») | job `MiaKmwd4sp3edzoM72ED` |
| #616 (INV-3b) | 2026-10-15 13:35 | `20261060_inventory_purchasing` (por inferencia: el paso «Aplicar» salió verde y en #617 solo quedaba una pendiente) | — |
| #617 (INV-3c) | 2026-10-15 15:23 | `20261066_inventory_reorder` («228 migrations found») | job `QrMGYxgWOi27gIvJ4E5A` |

La base es `aws-1-us-east-2.pooler.supabase.com:5432`, base `postgres` (el *session pooler*, el que admite DDL).

**Lo que dije mal.** En los informes de INV-3a a INV-5b3 y en `docs/AUDITORIA-INVENTARIO.md` (§ 26, 28, 30 y 32) repetí que las migraciones
`20261059`, `20261060`, `20261066`, `20261067`, `20261068` y `20261069` «siguen pendientes de aplicarse **a mano** en Supabase antes de desplegar».
Las tres primeras **ya están aplicadas** desde el 14–15 de octubre; las otras tres se aplicarán solas en el merge. La fuente del error es
`docs/MIGRACIONES.md`, que dice «se aplican a mano… no hay `prisma migrate deploy` automático»: es del mismo commit que creó el flujo
(`353651cf`, 29-09) y no se actualizó. `docs/DEVOPS.md` es el vigente.

**Lo que hay que cuidar al fusionar la rama.** `migrate deploy` aplicará `20261067`, `20261068` y `20261069` en ese orden, en el momento del merge,
y después desplegará el código: el orden «SQL primero» queda garantizado solo. Pero la `20261068` (lotes) es una sola transacción con un índice
único sobre el ledger y `lock_timeout`: la nota de INV-5a de hacerla **fuera de hora punta** sigue valiendo, y ahora «la hora» es la del merge (o la
de un «Run workflow» manual). Si `migrate deploy` falla, el flujo **no despliega** el código (bien) y hay que mirar el resumen del job.

**Sin comprobar directamente:** no tengo acceso al proyecto de Supabase de MEMBEGO (el conector de esta sesión ve seis proyectos y ninguno es
este), así que no leí `_prisma_migrations` ni corrí `db:doctor` contra producción. Lo anterior sale de los registros de Actions, que son la fuente
primaria de lo que el flujo hizo. Tampoco comprobé que los dos despliegues de Vercel terminaran en verde.

## 3. CI y E2E remotos: lo que no ha corrido

- `ci.yml` y `e2e.yml` se disparan en `pull_request` y en `push` a `main`. **No hay PR abierto** para la rama, así que las siete entregas desde
  INV-4a no tienen ni una corrida remota de tipos, lint, unitarias, `test:db` ni E2E. Lo que tienen es la cadena local de cada entrega (tsc, lint,
  `bun run test`, `test:db`, build, presupuesto, E2E de inventario y mutaciones), documentada en `AUDITORIA-INVENTARIO.md`. Es mucho, pero es
  **una sola máquina y una sola persona**.
- Los últimos tres PR sí pasaron el CI (tipos/lint/unit/`test:db`) en verde. El **E2E remoto**, no: en el PR #617 se **canceló** (el merge llegó
  antes de que terminara; `cancel-in-progress`), y en `main` el E2E del merge #616 se canceló por el siguiente push y el de #617 **cayó en
  «Initialize containers»** a los 16 s (el contenedor de Postgres del runner, no una prueba). El último E2E remoto en verde sobre `main` es el de
  #615 (INV-3a). Conclusión: **INV-3b e INV-3c están en producción sin que un E2E remoto los haya recorrido**; localmente sí (72/72 y 19/19).

## 4. El código de inventario, medido

| Medida | Valor |
|---|---|
| `src/modules/inventory/` | 14 181 líneas en 27 archivos. `service.ts` **2 998**, `queries.ts` 1 548, `actions.ts` 1 020, `exportacion.ts` 904, `compras-service.ts` 690 |
| Funciones más largas (`service.ts`) | `aplicarConteoEnTx` **203**, `registrarEntradaMultipleEnTx` 180, `enviarTrasladoEnTx` 159, `importarConteoEnTx` 134, `recibirTrasladoEnTx` 107 |
| `src/components/inventario/` | 25 componentes, 4 309 líneas |
| Páginas y rutas de `/admin/inventario` | 46 archivos |
| SQL crudo | 61 sitios en 11 archivos, **todos** con plantillas parametrizadas (`$queryRaw`/`$executeRaw` con `Prisma.sql`); **0** `RawUnsafe` |
| Escapes de tipos | 2 `as number` (lectura de entrada en acciones), **0** `@ts-ignore`, **0** `eslint-disable`, **0** `as any` |
| TODO/FIXME | 0 reales (las 19 coincidencias son «TODO O NADA») |
| `console.*` | 6 `console.error`, todos en captura de errores (`actions`, `barrido`, `avisos`, `valor`, `errores-pantalla`) |
| Lint | 0 errores, **189 avisos** (apps/client 55, scripts de verificación ≈100, `src/` 17: 9 componentes, 6 módulos, 2 páginas) |
| Dependencias | `npm audit --omit=dev`: **0** vulnerabilidades |
| Deuda de diseño | **147 / 147** clases de color fuera del vocabulario (37 colores crudos). La prueba `deuda-diseno` exige que el techo no quede por encima de la realidad: **cualquier color nuevo a mano rompe la suite** |
| Bundle | indicador general **8 948 / 9 200 KB (97 %)** (8 928 → 8 935 → 8 948 en las tres últimas entregas); entrada compartida 859/1 000; trozo mayor 409/600 |

Lectura: la calidad local es alta (sin atajos, sin SQL sin parametrizar, sin TODO) y la deuda es **estructural**: un servicio de tres mil líneas con
funciones de doscientas, y dos techos (diseño y bundle) a punto de saltar. Nada de esto es urgente; todo es más caro cuanto más tarde.

## 5. Seguridad y aislamiento

- **Autorización.** Las 15 rutas de descarga (`.../exportar`, `.../hoja`, `.../plantilla`) pasan por `requireSection('inventario', <función>)` y
  devuelven 403 sin ella. Las 40 acciones de servidor autorizan **antes** de tocar la base (`contexto(función)` / `operar(...)`), y lo vigila
  `tests/inventario-permisos.test.ts` (97 pruebas), incluida la nueva `lotesParaContarProducto` (5b3).
- **Entrada.** Toda entrada de acciones se valida (`texto()`, `esObjeto`, validadores puros) y los CSV que suben se validan fila a fila sin escribir
  nada hasta que el archivo está limpio. Los CSV que bajan neutralizan fórmulas (`SIN_FORMULA`) en todo lo que escribe una persona (nombres,
  SKU, códigos de lote, motivos).
- **Inquilino.** `rls:cobertura` ✓ (636 archivos con contexto de empresa; los 24 con `prisma.` directo están justificados) y `rls:preflight` ✓
  (las 20 tablas de inventario tienen `companyId` propio; ninguna quedaría denegada al encender la Capa 2). **Pero la Capa 2 de RLS sigue apagada
  en producción** (`AUDITORIA-PRODUCCION.md`): hoy el aislamiento entre empresas depende de que cada consulta filtre por `companyId`, que es lo que
  hacen todas las de inventario (y lo que prueban las suites «aislamiento» de cada entrega). Encender la Capa 2 es una decisión fuera de este
  programa.
- **Integridad en la base.** Las nueve migraciones de inventario llevan sus invariantes a PostgreSQL (CHECK, disparadores de inmutabilidad, claves
  foráneas compuestas, disparadores diferidos de lotes); las pruebas `inventory-*-esquema` las ejercitan escribiendo por fuera del servicio.
- **Superficie.** No hay inventario en `/api/v1` (5e, pendiente) y la app Expo no toca inventario: la única puerta es el panel.

## 6. Pruebas: cuánto hay y dónde flaquea

| Capa | Total del repo | De inventario |
|---|---|---|
| Unitarias (`bun run test`) | 4 602 (4 595 pasan, 7 omitidas heredadas: CardNET sin llaves QA y un volcado opcional) | 18 archivos, 405 pruebas |
| PostgreSQL (`bun run test:db`) | **968 / 968** | 16 archivos, 318 pruebas |
| E2E (escritorio) | — | 20 (14 en `inventario-admin`, 6 en `inventario-lotes`) |
| Mutaciones | — | una campaña por entrega (5b3: 82 de 83 detectadas, 1 equivalente explicada) |

Donde flaquea:

- `tests/e2e/separacion-invariantes.spec.ts:90` **falla en este entorno desde antes** (también sobre `main`): no se ha investigado en este programa.
- **Supply V2 `B2·G · §8 caso 1`** falló una vez (967/968) por basura acumulada en la base reutilizable (`recuperarArriendos` recupera 100 como máximo
  y había 100); aislada y en la segunda corrida pasa. Es frágil **por diseño de la prueba**, no por inventario; sigue sin arreglar.
- **Carrera de hidratación al subir un CSV** en Playwright: elegir el archivo antes de que la página hidrate deja «Revisar» deshabilitado. Arreglada
  en `inventario-lotes.spec.ts` (5b3); **latente** en `inventario-admin.spec.ts` (2b), donde todavía no se ha manifestado.
- **E2E remoto inestable** (§ 3): cancelaciones por `cancel-in-progress` y una caída de infraestructura.

## 7. Hallazgo nuevo: «Quitar filtros» deja el formulario con el valor anterior

**Qué pasa.** En las pantallas con filtros, el formulario es un `<form method="get">` con campos no controlados (`defaultValue`) y «Quitar filtros»
es un `<Link>`. Al pulsarlo, Next navega **sin recargar** y React conserva el mismo árbol: la lista se repinta sin filtros, pero los `<select>` y
los `<input>` **siguen enseñando lo que se eligió antes**. Quien vuelve a pulsar «Filtrar» re-aplica, sin querer, el filtro que acaba de quitar.
«Vence pronto» (5b1) lo evita con `<form key={consulta}>` (React vuelve a montar el formulario cuando cambia la consulta); **lo arreglé allí
porque el E2E lo pilló, y no lo extendí a las demás pantallas**.

**Dónde.** 13 de las 14 pantallas con «Quitar filtros» no tienen `key` en el formulario: existencias (`/admin/inventario`), movimientos, entradas,
conteos, transferencias, compras, proveedores, valor, reposición, y los informes de mermas, rotación, sin ventas y margen.

**Comprobado en el navegador** (build de producción local, base de E2E, `tests/e2e/_auditoria-filtros.spec.ts`, temporal y no versionado):
en una empresa recién creada (sin datos), se elige una opción, se pulsa «Filtrar» (la URL cambia), se pulsa «Quitar filtros» (la URL vuelve
a limpia) y se lee el `<select>`:

| Pantalla | Campo | Elegido | Tras «Quitar filtros» | |
|---|---|---|---|---|
| Mermas por motivo | `motivo` | `sin` | **`sin`** | **falla** |
| Movimientos | `tipo` | `PURCHASE` | **`PURCHASE`** | **falla** |
| Compras | `estado` | `DRAFT` | **`DRAFT`** | **falla** |
| Vence pronto | `estado` | — | `''` | bien (el E2E de 5b1 ya lo exige) |

Rotación, sin ventas y margen no se pudieron probar así: su único `<select>` es el periodo, que no cuenta como filtro para «Quitar filtros»; por
código tienen la misma forma (formulario sin `key`) y el mismo fallo es de esperar con el campo de búsqueda.

**Gravedad.** Baja-media: no pierde datos ni rompe nada, pero engaña (el formulario dice una cosa y la lista otra) y provoca re-filtrados por error.
**Arreglo.** Una línea por pantalla (`key` con la consulta de la URL, como en `vencimientos`) y una aserción en los E2E (`toHaveValue('')` tras
«Quitar filtros», como ya hace el de 5b1). Lo puedo hacer en una entrega corta.

## 8. Documentación: lo que está desfasado

| Documento | Qué dice | Qué es verdad |
|---|---|---|
| `docs/MIGRACIONES.md` | «se aplican a mano en el SQL Editor; no hay `migrate deploy` automático» | Hay flujo automático desde el 29-09 (`DEVOPS.md`); `db:doctor` sigue valiendo para diagnosticar |
| `docs/IMPLEMENTATION_STATUS.md` (l. 73) | «209 migraciones, hasta `20261052`» | 231 selladas, hasta `20261069` |
| `scripts/verificar-migraciones.sql` y `-resumen.sql` | generados el 12-10 con 212 migraciones hasta `20261055` | **19 migraciones por detrás**; ninguna entrega de inventario (INV-2a → 5b3, la mía incluida) corrió `generar-verificar-migraciones.mjs`. O se regeneran en cada migración nueva, o se retiran a favor de `db:doctor` |
| `docs/AUDITORIA-INVENTARIO.md` § 26, 28, 30, 32 e informes de entrega | «pendiente de aplicarse a mano en Supabase antes de desplegar» | se aplica solo al fusionar (§ 2); lo pendiente es **fusionar**, no pegar SQL |
| `docs/PRUEBAS-E2E.md`, `IMPLEMENTATION_STATUS.md` (inventario) | al día con 5b3 | — |

## 9. Qué NO verifiqué

- **Producción directamente:** ni `_prisma_migrations`, ni `db:doctor`, ni la Capa 2, ni los datos (sin acceso al proyecto de Supabase de MEMBEGO desde
  esta sesión). Lo de § 2 sale de los registros de Actions.
- **Vercel:** que los despliegues disparados el 14 y el 15 terminaran en verde y sirvan el código de INV-3c.
- **Cómo se ve nada** (escritorio con capturas, móvil, modo oscuro) en ninguna de las siete entregas de la rama.
- **Rendimiento** con volumen real (conteos de 1 000 líneas con lotes, informes sobre un ledger grande).
- **Dispositivos**: lector de códigos, celular, impresora.
- **El resto del producto** (pagos, Supply, landing/app): esta auditoría es del programa de inventario y de su entorno de entrega; los pendientes
  heredados de otras áreas están en `IMPLEMENTATION_STATUS.md` § «Pendientes prioritarios» (producción no auditada, CardNET real, piloto, F7/F8
  corte de dominios con `corte:verificar`, Car Wash «Inventario» vs Commerce Core).

## 10. Recomendaciones, por orden

1. **Abrir el PR de la rama ahora** (INV-4a → 5b3) para que el CI remoto corra sobre las siete entregas, y **fusionar en hora valle** por la
   `20261068`. Si el E2E remoto vuelve a caer en «Initialize containers», reintentar: es infraestructura, no código. No mezclar sin un E2E remoto
   terminado en verde (lo que pasó con #617).
2. **Corregir «Quitar filtros»** en las 13 pantallas (§ 7): entrega corta, con sus aserciones E2E.
3. **Poner al día los documentos** de § 8: `MIGRACIONES.md` (el flujo es automático; `db:doctor` para diagnosticar), la línea de migraciones de
   `IMPLEMENTATION_STATUS.md`, las secciones «a mano» de `AUDITORIA-INVENTARIO.md`, y regenerar o retirar los verificadores SQL. Y dejar escrito el
   único paso manual que queda: **fusionar en hora valle cuando la migración toque el ledger**.
4. **Endurecer la prueba frágil de Supply V2** (`B2·G · §8 caso 1`): que limpie sus reclamos abandonados o que `recuperarArriendos` pagine; y mirar de
   una vez `separacion-invariantes.spec.ts:90`.
5. **Partir `service.ts`** por dominio (conteos, traslados, entradas, lotes) antes de 5b4/5b5, que vuelven a tocarlo: refactor mecánico, protegido por
   968 pruebas contra PostgreSQL y las guardias estáticas (que habrá que actualizar: varias leen `service.ts` por nombre).
6. **Antes de la siguiente pantalla nueva**, bajar la deuda de diseño por debajo del techo (147/147) en vez de subirlo, y vigilar el bundle (97 %).
7. **Decidir la Capa 2 de RLS y la auditoría de producción** (credenciales, overrides): no es de inventario, pero inventario ya tiene 20 tablas que
   dependen de ello.
8. **Seguir con 5b4 y 5b5** con el mismo método (migración sellada, pruebas en tres capas, mutaciones, informe honesto), y con dos cambios de
   proceso: regenerar los verificadores (o retirarlos) con cada migración, y describir el despliegue como lo que es (automático al fusionar).
