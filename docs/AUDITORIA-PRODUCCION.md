# Auditoría de preparación para producción — MembeGo

**Fecha:** 2026-07-28 · **Rama auditada:** `claude/membego-brand-migration-iy3crt` (commit `249be2b`)
**Escenario evaluado:** 100.000 registrados · 20.000 DAU · 5.000 concurrentes · miles de empresas ·
miles de escaneos QR/min · miles de pagos y notificaciones simultáneos.

> Toda afirmación de este documento apunta a un archivo y una línea del repositorio. Donde no se
> pudo verificar algo por falta de acceso (producción, Supabase, Vercel) se dice explícitamente y
> se indica qué haría falta ver.

---

## 0. Stack real confirmado

| Declarado | Real (evidencia) |
|---|---|
| Next.js App Router | ✅ Next 16, `src/proxy.ts` (el middleware se llama `proxy` en Next 16), `build: next build --webpack` |
| React / TypeScript | ✅ `tsconfig.json`, 129.356 líneas TS/TSX en `src/` |
| PostgreSQL + Prisma | ✅ `prisma/schema.prisma` (4.003 líneas, 112 modelos, 214 `@@index`, 31 `@@unique`) |
| Supabase | ✅ Auth (`@supabase/ssr`), Storage (14 puntos de subida), **sin Realtime**, **sin RLS** |
| Tailwind | ✅ + monorepo parcial `packages/ui` (`transpilePackages: ['@membego/ui']`) |
| Vercel | ✅ `vercel.json` (1 cron) |
| Sentry | ✅ `sentry.server.config.ts`, `instrumentation-client.ts`, `tracesSampleRate: 0.2` |

**Diferencias respecto a lo declarado:**
- No hay Redis salvo Upstash **solo para rate limiting** (`src/lib/rate-limit.ts`).
- No hay colas, workers ni background jobs. Un único cron diario.
- **No existe `.github/`** → no hay CI/CD de ningún tipo.
- 68 migraciones en `prisma/migrations/` que se aplican **a mano** en el SQL Editor de Supabase.

---

## 1. Hallazgos CRÍTICOS

### C-01 · Comprobantes de pago en bucket público, con ruta escribible por el cliente

- **Gravedad:** CRÍTICO · **Probabilidad:** ALTA · **Prioridad:** P0
- **Evidencia:**
  - `docs/STORAGE_SETUP.md:36` — *"El bucket `comprobantes` queda **público** porque el código usa `getPublicUrl()`"*.
  - `src/components/membresia/ComprobanteForm.tsx:79` — `const path = \`comprobantes/${membershipId}-${Date.now()}.${ext}\``
  - `src/components/cliente/ComprobanteCompraForm.tsx:72-73` — `compras/${compraId}-${Date.now()}` con `.upload(path, file, { upsert: true })`
- **Explicación técnica:** los comprobantes de transferencia bancaria (nombre del titular, número de
  cuenta, monto, banco) se suben desde el navegador con la clave anon a un bucket **público**. La
  lectura no pasa por ninguna autorización: cualquiera con la URL ve el documento, y la URL es
  derivable (`membershipId` es un cuid presente en respuestas de la app + timestamp acotable). Además
  `upsert: true` sobre una ruta que compone el **cliente** significa que un usuario autenticado puede
  escribir `comprobantes/<membershipId-ajeno>-<ts>.jpg` y **sobrescribir el comprobante de otro**.
- **Impacto:** exposición de datos financieros personales de todos los clientes que hayan pagado por
  transferencia; manipulación de evidencia de pago; incumplimiento de cualquier marco de protección
  de datos.
- **Solución:** bucket `comprobantes` a **privado**; subida vía server action (o URL firmada de
  subida con ruta generada en el servidor, nunca por el cliente); lectura mediante `createSignedUrl`
  de corta duración emitida solo al dueño y al administrador de la empresa; política de Storage que
  ate el prefijo al `auth.uid()`; desactivar `upsert`.
- **No verificable desde aquí:** el estado real de las políticas del bucket en Supabase. Necesito el
  resultado de `select id, public from storage.buckets;` y `select * from storage.policies;`.

### C-02 · No existe CI/CD — nada impide desplegar código roto

- **Gravedad:** CRÍTICO · **Probabilidad:** ALTA · **Prioridad:** P0
- **Evidencia:** no existe el directorio `.github/`. `package.json` tiene `test`, `lint` y `build`,
  pero ningún disparador automático.
- **Explicación:** los 113 tests, `tsc --noEmit`, ESLint y `next build` solo se ejecutan si una
  persona se acuerda de hacerlo. Un push directo a la rama de despliegue va a producción sin ninguna
  puerta.
- **Impacto:** un error de tipado o un test roto llega a 20.000 usuarios diarios. Sin rollback
  automatizado, la recuperación depende de la UI de Vercel y de que alguien se dé cuenta.
- **Solución:** GitHub Actions con `tsc --noEmit`, `eslint`, `npm test` y `next build` como *required
  checks*; despliegue solo desde `main` verde; `vercel rollback` documentado en un runbook.

### C-03 · Migraciones de base de datos aplicadas a mano

- **Gravedad:** CRÍTICO · **Probabilidad:** ALTA · **Prioridad:** P0
- **Evidencia:** 68 directorios en `prisma/migrations/`; el flujo real (documentado en cada
  migración: *"Ejecutar en el SQL Editor de Supabase"*) es copiar y pegar. La existencia de
  `src/modules/superadmin/migraciones.ts` —un detector de *schema drift* con lista manual de
  centinelas— es la prueba de que el problema ya se materializó.
- **Impacto:** el deploy puede ir adelantado a la base. El código es tolerante (fail-open) y por eso
  el fallo **no se ve**: los módulos aparecen vacíos sin un solo error. Ya ocurrió con
  `companies.capacidades` (comentario en `migraciones.ts:8-13`).
- **Solución:** `prisma migrate deploy` en el pipeline, antes del despliegue de la app, con la
  conexión `DIRECT_URL`. Bloquear el deploy si la migración falla.

### C-04 · `/api/stats` es un endpoint público sin caché que hace cuatro conteos completos

- **Gravedad:** CRÍTICO · **Probabilidad:** ALTA · **Prioridad:** P0
- **Evidencia:** `src/app/api/stats/route.ts:4` `export const dynamic = 'force-dynamic'`; líneas
  14-19: `company.count`, `cliente.count()` (sin `where`), `membership.count`, `visit.count()` (sin `where`).
- **Explicación:** `COUNT(*)` sin filtro en PostgreSQL es un *sequential scan*. Con 100.000 clientes
  y varios millones de visitas son cuatro escaneos completos **por petición**, sin caché, desde la
  landing pública.
- **Impacto:** es un vector de denegación de servicio trivial (un bucle de `curl` tumba la base) y
  además auto-infligido: cada visita anónima a la portada paga ese coste. Es el candidato número uno
  a ser el primer componente que colapse.
- **Solución:** `unstable_cache` con `revalidate: 300` (el patrón ya existe en
  `src/modules/marketplace/cached.ts`), o una tabla de contadores materializados. `visit.count()`
  debe desaparecer: sustituir por un contador incremental.

### C-05 · El login no tiene rate limiting: el limitador existe pero nunca se usa

- **Gravedad:** CRÍTICO · **Probabilidad:** ALTA · **Prioridad:** P0
- **Evidencia:** `src/lib/rate-limit.ts:117` exporta `loginLimiter`. `grep -rn "loginLimiter" src`
  fuera de ese archivo devuelve **cero resultados**. El login se hace en el cliente:
  `src/components/auth/LoginForm.tsx:108` → `supabase.auth.signInWithPassword(...)`.
- **Explicación:** al ocurrir en el navegador contra Supabase Auth directamente, la petición **no
  pasa por el servidor de Next**, así que ningún limitador propio puede intervenir. La única defensa
  es el rate limit del proyecto Supabase, que es global y generoso.
- **Impacto:** fuerza bruta de credenciales y enumeración de usuarios (los mensajes de error de
  Supabase distinguen "usuario no existe" de "contraseña incorrecta" según configuración).
- **Solución:** mover el login a una server action que aplique `loginLimiter` por IP + email antes de
  llamar a Supabase; activar CAPTCHA en Supabase Auth; verificar que la protección contra
  enumeración está activada en el proyecto.
- **No verificable desde aquí:** la configuración de Auth del proyecto Supabase (rate limits, CAPTCHA,
  `Confirm email`). Necesito acceso al panel.

### C-06 · El cron recorre todas las empresas en serie con 60 segundos de presupuesto

- **Gravedad:** CRÍTICO (a escala) · **Probabilidad:** ALTA · **Prioridad:** P0
- **Evidencia:** `vercel.json` — un único cron `0 9 * * *`. `src/app/api/cron/automatizaciones/route.ts:7`
  `export const maxDuration = 60`. `src/modules/admin/automatizaciones.ts:176-190`:
  ```ts
  const companies = await prisma.company.findMany({ where: { isActive: true } })
  for (const c of companies) {
    resultados.push({ companyId: c.id, resultado: await ejecutarAutomatizacionesEmpresa(c.id) })
  }
  ```
- **Explicación:** bucle secuencial, `await` por empresa, sin *checkpointing*. Con 1.000 empresas a
  ~200 ms cada una son 200 s: la función se corta a los 60 s y **las empresas restantes no se
  procesan nunca**, sin que nadie se entere (el `catch` interno solo registra en consola).
- **Impacto:** cumpleaños, avisos de vencimiento y recuperación de inactivos dejan de funcionar para
  la mayoría de empresas. Silenciosamente.
- **Solución:** cola de trabajos (QStash de Upstash, ya se paga Upstash; o Inngest/Trigger.dev) con
  un mensaje por empresa; o cron paginado con cursor persistido y `maxDuration` a 300 s en plan Pro.

### C-07 · Fan-out de notificaciones síncrono dentro del request

- **Gravedad:** CRÍTICO (a escala) · **Probabilidad:** ALTA · **Prioridad:** P0
- **Evidencia:** `src/modules/notificaciones/service.ts:62` y `:86` — `prisma.notificacion.createMany`
  con el resultado de un `findMany` de **todos** los clientes de la empresa, dentro del request.
- **Explicación:** una empresa con 50.000 clientes genera un `INSERT` de 50.000 filas en una función
  serverless con límite de tiempo y memoria, bloqueando la respuesta al administrador que pulsó el
  botón.
- **Impacto:** timeout de la acción, notificación a medias (no es transaccional respecto al resto),
  saturación del pool de conexiones durante segundos.
- **Solución:** encolar el fan-out; insertar por lotes de 1.000 con `skipDuplicates`; devolver al
  administrador de inmediato con un estado "enviando".

### C-08 · Cinco vulnerabilidades HIGH en dependencias de producción

- **Gravedad:** CRÍTICO · **Probabilidad:** MEDIA · **Prioridad:** P0
- **Evidencia:** `npm audit --omit=dev` → `{'high': 5}`; `sharp <0.35.0` con CVE-2026-33327,
  CVE-2026-33328, CVE-2026-35590, CVE-2026-35591 (libvips).
- **Impacto:** `sharp` procesa imágenes subidas por usuarios (avatares, logos, evidencias). Las CVE
  de libvips son típicamente corrupción de memoria explotable con una imagen manipulada → RCE en el
  proceso que optimiza imágenes.
- **Solución:** `npm audit fix --force` a `sharp@0.35.3` y verificar `next/image`; añadir
  `npm audit --omit=dev --audit-level=high` al pipeline como *check* bloqueante.

---

## 2. Hallazgos ALTOS

### A-01 · Aislamiento multi-empresa 100 % aplicativo: sin RLS en PostgreSQL

- **Evidencia:** ninguna migración contiene `ENABLE ROW LEVEL SECURITY`. El aislamiento depende de
  que **cada** consulta lleve `companyId` en el `WHERE`.
- **Riesgo:** con 112 modelos y ~150 archivos de módulos, un solo `findUnique({ where: { id } })` sin
  verificar propiedad es una fuga entre empresas. El patrón está bien aplicado en lo que revisé
  (`getMetodosParaCompraNueva`, `getCuentas`, `contarDatosDemo`…), pero es una disciplina, no una
  garantía.
- **Solución:** RLS como segunda barrera con `current_setting('app.company_id')` fijado por
  transacción; mientras tanto, un test automatizado que recorra los módulos y falle si una consulta
  sobre un modelo con `companyId` no lo incluye.
- **No verificado exhaustivamente:** revisar las ~150 consultas una a una excede esta auditoría. Es
  el trabajo que recomiendo antes del lanzamiento.

### A-02 · Tokens QR generados con `cuid()`, no con aleatoriedad criptográfica

- **Evidencia:** `prisma/schema.prisma`, modelo `QrToken`: `token String @unique @default(cuid())`.
- **Explicación:** cuid v1 es *timestamp + contador + huella de máquina + 4 caracteres aleatorios*.
  Es resistente a colisiones, **no** a predicción. Conocidos dos tokens del mismo servidor, el espacio
  de búsqueda del tercero se reduce drásticamente.
- **Mitigante real:** canjear exige sesión de empleado y el canje es atómico y de un solo uso
  (`src/modules/visitas/actions.ts:485-520`), así que la explotación requiere credenciales de staff.
  Por eso es ALTO y no CRÍTICO.
- **Solución:** `@default(dbgenerated("encode(gen_random_bytes(24),'base64url')"))` o generar en la
  aplicación con `crypto.randomUUID()`; añadir caducidad temporal al token (hoy no vence, solo se
  invalida al usarse).

### A-03 · Los administradores nuevos nunca reciben notificaciones (bug funcional)

- **Evidencia:** `src/modules/notificaciones/service.ts:29` — `where: { companyId, role: 'ADMIN_EMPRESA' }`.
  Pero `src/modules/empresas/actions.ts:212` crea los administradores con `role: 'ADMINISTRADOR'`, y
  el propio `schema.prisma:17` marca `ADMIN_EMPRESA` como *"legacy: se mantiene por usuarios existentes"*.
- **Impacto:** ninguna empresa creada por el flujo actual recibe avisos de pago pendiente, comprobante
  subido, etc. Es un fallo de producto invisible.
- **Solución:** `role: { in: FULL_ADMIN_ROLES }` (o el subconjunto que deba recibir avisos).

### A-04 · CSP con `unsafe-inline` y `unsafe-eval`

- **Evidencia:** `next.config.ts`, `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net`.
- **Riesgo:** anula buena parte del valor de la CSP frente a XSS. El propio comentario del archivo lo
  reconoce y lo pospone.
- **Solución:** CSP basada en *nonce* (soportada por Next 16); el wasm del scanner puede aislarse con
  `wasm-unsafe-eval` en lugar de `unsafe-eval`. Revisar si `cdn.jsdelivr.net` sigue siendo necesario.

### A-05 · `Visit` sin índice por empresa, siendo la tabla de mayor crecimiento

- **Evidencia:** modelo `Visit` — índices por `clienteId`, `membershipId`, `fechaVisita`, `vehiculoId`,
  `sucursalId`. **Ninguno por `companyId`**, ni compuesto `(companyId, fechaVisita)`.
- **Impacto:** una fila por escaneo. A miles de escaneos por minuto son ~2-5 M de filas/mes. Todo
  reporte de empresa por rango de fechas hará *scan* + filtro.
- **Solución:** `@@index([companyId, fechaVisita])`; planificar particionado por rango de fecha a
  partir de ~50 M de filas.

### A-06 · Sin colas, sin workers, sin trabajo en segundo plano

- **Evidencia:** `vercel.json` (1 cron); no hay dependencias de cola en `package.json`; Upstash solo
  se usa en `rate-limit.ts`.
- **Impacto:** todo lo pesado (fan-out, correos, cálculos de reportes, motores de estrategia) ocurre
  dentro del request. Es la causa raíz de C-06 y C-07.

### A-07 · Cobertura de pruebas: solo unitarias puras

- **Evidencia:** `tests/` tiene 9 archivos, todos `node:test` sobre funciones puras. `package.json` no
  contiene Playwright, Vitest, Jest, k6 ni Artillery.
- **Falta:** integración (con base real), E2E (registro → compra → pago → QR → canje), carga, estrés,
  caos, seguridad automatizada, pentest.
- **Impacto:** los caminos críticos con dinero (`activacionCompra`, `canjeActions`, `caja`) no tienen
  ninguna prueba que toque la base de datos.

### A-08 · Sin backups verificados, sin plan de recuperación, sin runbook

- **Evidencia:** no hay documentación de RPO/RTO, ni de restauración, ni de guardia.
- **No verificable desde aquí:** el plan de Supabase determina la retención de backups (Free: 0-7 días;
  Pro: PITR opcional). Necesito saber el plan contratado.

**Estado tras la Fase 5 — parcialmente cerrado.** Lo que se hizo:

- `docs/RECUPERACION.md`: qué hay que restaurar (son **cuatro** sistemas, no uno), RPO/RTO propuestos
  por escenario, procedimiento paso a paso y bitácora de simulacros.
- `scripts/verificar-respaldo.mjs` + `.github/workflows/respaldo-verificacion.yml`: simulacro de
  restauración **semanal y automático**, que además mide el RPO real en vez de suponerlo.
- `docs/runbooks/` (8 runbooks) y el modo mantenimiento (`src/modules/mantenimiento`), sin el cual
  ninguna restauración es limpia.

Lo que **sigue abierto** y no depende del código: activar PITR, respaldar Supabase Storage, tener una
copia fuera de Supabase, y restaurar a mano un respaldo real del proveedor al menos una vez. Detalle
y razones en `docs/RECUPERACION.md` § 8.

Un hallazgo nuevo, encontrado al escribir esa fase: **un volcado del esquema `public` no incluye
`auth`**, donde viven las credenciales de Supabase Auth a las que apunta `User.supabaseId`
(`prisma/schema.prisma:132`). Restaurar solo `public` devuelve todos los datos y ni una contraseña:
la aplicación se ve perfecta y nadie puede entrar. El verificador lo comprueba explícitamente.

### A-09 · Observabilidad incompleta

- **Evidencia:** Sentry configurado (`tracesSampleRate: 0.2`, `prismaIntegration`), `/api/health`
  correcto. **No hay** métricas de negocio, alertas, SLO/SLI, dashboards, ni tracing distribuido más
  allá de lo que Sentry infiere.
- **Impacto:** una degradación del pool de conexiones se detecta cuando los usuarios se quejan.

---

## 3. Hallazgos MEDIOS

| Id | Hallazgo | Evidencia | Solución |
|---|---|---|---|
| M-01 | Archivos de acciones de 900+ líneas | `referidos/actions.ts` (972), `regalos/actions.ts` (964), `admin/actions.ts` (917) | Dividir por caso de uso |
| M-02 | Schema de 4.003 líneas y 112 modelos en un archivo | `prisma/schema.prisma` | `prismaSchemaFolder` (soportado en Prisma 6) |
| M-03 | `getSession()` en el proxy para decidir redirecciones | `src/proxy.ts:105-118` | Aceptable y **documentado**: la autorización real usa `getUser()` en cada página y acción. Se registra como riesgo asumido, no como fallo |
| M-04 | Sin PWA / offline | No hay `manifest.json` ni service worker | El scanner en pista con mala señal se beneficiaría de cola offline |
| M-05 | Validación de subidas solo en el cliente | `ComprobanteForm.tsx:56-67` valida tipo y tamaño en el navegador | Validar en el servidor o en la política de Storage |
| M-06 | `experimental.webpackMemoryOptimizations` por OOM en build | `next.config.ts:8-12` | Señal de que el proyecto está cerca del límite del builder; vigilar |
| M-07 | Sin paginación visible en listados de administración | Revisión de páginas admin | A 100k clientes, `/admin/clientes` debe paginar en servidor |
| M-08 | 3 warnings de ESLint sin resolver | `PersonalizacionForm.tsx:14`, `compra-estado.ts:19`, `CampanaEstadoButton.tsx:4` | Trivial |

---

## 4. Lo que está bien hecho (para no romperlo)

No todo es deuda. Estos puntos están por encima de la media y conviene protegerlos:

- **El canje de QR es correctamente atómico.** `src/modules/visitas/actions.ts:485-520`: invariantes
  protegidas por `updateMany` con condición en el `WHERE` (no por lecturas previas), lo que elimina
  el TOCTOU. Un doble escaneo simultáneo no descuenta dos veces. Esto es lo más difícil de todo el
  sistema y está resuelto.
- **Guards fail-closed.** `src/lib/auth/guards.ts` — `requireAdminUser` excluye roles acotados por
  defecto, con el razonamiento escrito de por qué (las server actions se despachan por ID, el gate por
  path no las cubre).
- **Rate limiting distribuido real** con Upstash y degradación local (`src/lib/rate-limit.ts`),
  aplicado en 17 puntos de entrada.
- **Guardia del pooler de Prisma** (`src/lib/prisma.ts:22-45`): detecta el error clásico de apuntar
  al puerto 5432 en serverless y avisa. Muy pocos proyectos lo tienen.
- **Detector de *schema drift*** en el panel de superadmin (`src/modules/superadmin/migraciones.ts`).
- **Caché del marketplace** con `unstable_cache` + tags (`src/modules/marketplace/cached.ts`).
- **Densidad de comentarios de *por qué*** muy superior a la media: el código explica decisiones, no
  mecánica. Es el activo de mantenibilidad más valioso del repositorio.

---

## 5. ¿Sobreviviría al escenario planteado?

**No, con la configuración actual.** Orden de colapso previsto:

1. **`/api/stats`** (C-04) — primer punto en caer. Cada visita anónima a la landing dispara cuatro
   *seq scans*. Con 5.000 concurrentes, la base se satura antes que cualquier otra cosa.
2. **Pool de conexiones de Supabase** — el transaction pooler de Supabase da ~200 conexiones en Pro.
   Cada instancia serverless de Vercel abre su pool. Con `connection_limit=1` por instancia y cientos
   de instancias frías simultáneas, los `P2024` (timeout de pool) empiezan alrededor de los 200-400
   concurrentes reales si `/api/stats` sigue consumiendo conexiones.
3. **Fan-out de notificaciones** (C-07) — la primera campaña masiva de una empresa grande tumba la
   acción.
4. **Cron de automatizaciones** (C-06) — no colapsa, simplemente deja de hacer su trabajo en silencio.

**Techo estimado con la configuración actual:** ~500-1.000 usuarios concurrentes antes de
degradación severa. Corrigiendo C-04 y añadiendo caché a la landing, el techo sube a varios miles.

### Escalabilidad por tramos

| Usuarios registrados | ¿Aguanta? | Bloqueante |
|---|---|---|
| 10.000 | Sí, con C-04 corregido | — |
| 50.000 | Sí, con colas para notificaciones | C-07 |
| 100.000 | Condicionado | C-06, C-07, A-05 (índice de `Visit`), paginación en admin |
| 500.000 | No sin rediseño | Particionado de `Visit`/`Transaction`, réplicas de lectura, cola real |
| 1.000.000 | No | + separación de reportes a un almacén analítico |
| 10.000.000 | No | + sharding por tenant o multi-región |

---

## 6. Estimación de costes (mensual, USD)

> Estimación de ingeniería, no presupuesto. Asume Vercel Pro y Supabase con almacenamiento
> proporcional. **No verificable** sin datos reales de tráfico y de tamaño medio de comprobante.

| Usuarios | Vercel | Supabase | Storage/CDN | Correo | Redis | Total aprox. |
|---|---|---|---|---|---|---|
| 100 | 0-20 | 0-25 | ~0 | 0 | 0 | **~20-45** |
| 1.000 | 20 | 25 | ~5 | ~10 | 0 | **~60** |
| 10.000 | 20-60 | 25-100 | ~25 | ~30 | ~10 | **~110-215** |
| 100.000 | 150-400 | 400-900 (Pro + cómputo dedicado + PITR) | ~150 | ~150 | ~50 | **~900-1.650** |
| 1.000.000 | 800-2.500 | 2.500-6.000 (instancia grande + réplicas) | ~800 | ~800 | ~200 | **~5.000-10.000** |

El coste dominante a partir de 100k es el cómputo de Postgres, y lo empuja directamente C-04:
los conteos sin caché obligan a sobredimensionar la instancia.

---

## 7. Puntuaciones

| Categoría | Puntuación | Comentario |
|---|---|---|
| Arquitectura | **72** | Modular, por dominios, excelentemente documentada. Sin capa de servicios formal ni asincronía |
| Escalabilidad | **38** | Sin colas, sin workers, cron secuencial, conteos sin caché |
| Seguridad | **45** | Buenas bases (guards, rate limit, headers) arruinadas por C-01 y C-05; sin RLS |
| Rendimiento | **48** | Canje atómico y caché de marketplace bien; `/api/stats` y fan-out lo hunden |
| Mantenibilidad | **70** | Comentarios de *por qué* excepcionales; archivos y schema demasiado grandes |
| Calidad del código | **68** | `tsc` y ESLint limpios, tipado estricto; duplicación y funciones gigantes |
| DevOps | **22** | Sin CI/CD, migraciones a mano, sin rollback documentado |
| Observabilidad | **40** | Sentry + health endpoint; sin métricas, alertas, SLO ni tracing |
| Preparación para producción | **35** | Los cuatro P0 son bloqueantes |
| Soportar miles de usuarios | **30** | Colapsa por `/api/stats` mucho antes de los 5.000 concurrentes |

**Media ponderada: 47/100.**

---

## 8. Tabla resumen por área

| Área | Estado | Riesgo | Prioridad |
|---|---|---|---|
| Arquitectura | Aceptable | Medio | P2 |
| Frontend | Aceptable | Bajo | P3 |
| Backend | Aceptable con reservas | Alto | P1 |
| Base de datos | Deficiente a escala | Alto | P1 |
| Prisma | Bien configurado | Bajo | P3 |
| Supabase (Auth) | Deficiente | Crítico | P0 |
| Supabase (Storage) | **Inseguro** | Crítico | P0 |
| Supabase (RLS) | Ausente | Alto | P1 |
| Seguridad general | Deficiente | Crítico | P0 |
| Sistema QR | Bueno (lógica) / débil (token) | Alto | P1 |
| Multi-empresa | Correcto pero frágil | Alto | P1 |
| Rendimiento | Deficiente | Crítico | P0 |
| Escalabilidad | Deficiente | Crítico | P0 |
| Infraestructura | Incompleta | Alto | P1 |
| Observabilidad | Incompleta | Alto | P1 |
| DevOps | **Ausente** | Crítico | P0 |
| Costes | Razonables hasta 100k | Medio | P2 |
| Código | Bueno | Bajo | P3 |
| UX bajo carga | Aceptable | Medio | P2 |
| Pruebas | Insuficientes | Alto | P1 |

---

## 9. Comparación con estándares de la industria

Frente a lo que hacen Stripe, GitHub, Shopify, Linear o Mercado Libre, falta:

- **Puertas automáticas antes de producción** (CI con checks obligatorios, despliegues progresivos,
  *feature flags* de rollout). MembeGo tiene un sistema de capacidades por empresa —una base
  excelente para *feature flags*— pero no lo usa para desplegar gradualmente.
- **Presupuestos de error y SLO.** Nadie puede decir hoy si la plataforma cumple un 99,9 %.
- **Migraciones versionadas y automáticas**, con capacidad de revertir.
- **Aislamiento de datos garantizado por el motor** (RLS o esquema por tenant), no por disciplina.
- **Pruebas de carga como parte del ciclo**, no como evento.
- **Guardia y runbooks.** Hoy no hay una respuesta escrita a "la base no responde a las 3 a.m.".
- **Gestión de secretos con rotación** y auditoría de acceso.

Lo que **sí** está a nivel: la documentación interna del *porqué* de las decisiones. Está por encima
de lo que se ve en muchas empresas de ese tamaño.

---

## 10. Roadmap

### Fase 1 — Críticos (bloqueantes del lanzamiento) · 1-2 semanas
1. C-01 Bucket `comprobantes` privado + URLs firmadas + ruta generada en servidor + sin `upsert`.
2. C-04 Cachear `/api/stats` y eliminar `visit.count()`.
3. C-05 Login por server action con `loginLimiter` + CAPTCHA en Supabase.
4. C-08 Actualizar `sharp`.
5. C-02 CI en GitHub Actions con tsc + eslint + test + build + `npm audit` como checks obligatorios.
6. C-03 `prisma migrate deploy` en el pipeline.
7. A-03 Corregir el rol en `notificarAdmins` (una línea, fallo de producto invisible).

### Fase 2 — Escalabilidad · 2-4 semanas
8. C-06 + C-07 Cola de trabajos (QStash) para fan-out de notificaciones y automatizaciones por empresa.
9. A-05 Índice `(companyId, fechaVisita)` en `Visit`; revisar índices de `Transaction`.
10. M-07 Paginación en servidor en todos los listados de administración.
11. Contadores materializados para las métricas de la landing y del dashboard.

### Fase 3 — Seguridad · 2-4 semanas
12. A-01 RLS en PostgreSQL como segunda barrera + test automático de aislamiento por tenant.
13. A-02 Tokens QR con `gen_random_bytes` + caducidad temporal.
14. A-04 CSP con nonce, sin `unsafe-eval`.
15. M-05 Validación de subidas en el servidor.
16. Pentest externo del flujo de pago y del canje QR.

### Fase 4 — Rendimiento · 2-3 semanas
17. Pruebas de carga (k6) del escenario objetivo: 5.000 concurrentes, 1.000 escaneos/min.
18. Ajuste del pool según los resultados; evaluar réplica de lectura para reportes.
19. Revisión de N+1 con el `prismaIntegration` de Sentry en un entorno de carga.

### Fase 5 — Infraestructura · 2-3 semanas — **hecha, con excepciones**
20. ✅ Backups verificados con restauración probada; RPO/RTO definidos.
    → `scripts/verificar-respaldo.mjs` (simulacro semanal automático, mide el RPO real),
    `docs/RECUPERACION.md` § 3. Los RPO/RTO son una **propuesta** pendiente de que el dueño
    la acepte o la corrija.
21. ⚠️ PITR en Supabase; plan de recuperación escrito y ensayado.
    → El plan está escrito (`docs/RECUPERACION.md`). **PITR no está activado** —depende del plan
    contratado— y **no se ha ensayado** una restauración real: la bitácora del § 7 está vacía a
    propósito para que se vea.
22. ✅ Runbooks de incidentes. → `docs/runbooks/` (8) + modo mantenimiento
    (`src/modules/mantenimiento`, 13 pruebas).
    ❌ **Rotación de guardia: no existe y no puede existir hoy.** Hay una persona. Lo que sí se puede
    montar —monitor de uptime externo y un segundo par de manos con acceso— está en
    `docs/RECUPERACION.md` § 6.

Sigue sin cubrirse, y es la carencia mayor: **no hay respaldo de Supabase Storage**. Los comprobantes
de pago y las fotos de evidencia no se pueden recuperar. `docs/RECUPERACION.md` § 8.

### Fase 6 — Observabilidad · 1-2 semanas
23. Métricas de negocio y de sistema con alertas (latencia p95, errores, saturación del pool).
24. SLO definidos con presupuesto de error.
25. Tracing distribuido completo; dashboards por dominio.

### Fase 7 — Optimización final · continuo
26. E2E del recorrido completo del cliente.
27. Dividir archivos de 900+ líneas y el schema por dominios.
28. PWA con cola offline para el scanner de pista.
29. Revisión de bundle y presupuestos de rendimiento.

---

## 11. Veredicto

### ¿Publicarías MembeGo hoy para recibir miles de usuarios reales?

## **No.**

No es "sí con reservas". Con la configuración actual, **el lanzamiento causaría dos daños concretos
e irreversibles** antes de que el equipo pudiera reaccionar:

**1. Fuga de datos financieros desde el minuto uno.** No es un riesgo teórico ni requiere un atacante
sofisticado: el bucket `comprobantes` es público por diseño documentado
(`docs/STORAGE_SETUP.md:36`) y las rutas se componen con identificadores que la propia aplicación
expone (`ComprobanteForm.tsx:79`). Cada cliente que pague por transferencia deja su comprobante
bancario accesible. Y `upsert: true` sobre una ruta que elige el navegador permite además
**sobrescribir** el comprobante de otra persona: se pierde la evidencia de un pago que sí se hizo.
Esto no se arregla después del lanzamiento — los datos ya expuestos no se recuperan.

**2. Caída de la base de datos por el propio tráfico de la portada.** `/api/stats` ejecuta cuatro
`COUNT(*)` sin filtro ni caché en cada visita anónima (`src/app/api/stats/route.ts:14-19`). Con
100.000 clientes y millones de visitas, eso son cuatro escaneos secuenciales completos por petición.
A 5.000 concurrentes la base se satura y **toda la plataforma cae, incluido el escáner de la pista**:
los car wash no pueden atender a nadie. No hace falta un ataque; basta con el lanzamiento saliendo bien.

A eso se suma que **no existe ninguna puerta automática antes de producción** (no hay `.github/`) y
que las migraciones se aplican a mano, así que la corrección de urgencia se haría sin red: sin tests
que la validen y con riesgo de desfase entre el código desplegado y el esquema de la base.

**La respuesta cambia a "Sí, pero únicamente después de corregir los puntos críticos" cuando se
cierre la Fase 1 completa.** Son siete puntos, ninguno conceptualmente difícil, estimados en una a
dos semanas de trabajo. Cuatro de ellos (C-04, C-05, C-08, A-03) son cambios de pocas líneas.

Y conviene decir lo otro con la misma claridad: **la parte difícil ya está bien hecha.** El canje de
QR —lo único que, si falla, regala servicios o cobra dos veces— está resuelto con updates guardados
atómicos, sin TOCTOU, mejor que en muchos sistemas en producción. Los guards son fail-closed por
diseño explícito. Hay rate limiting distribuido real. Lo que falta no es arquitectura: es la
infraestructura de operación alrededor de un producto que ya funciona.
