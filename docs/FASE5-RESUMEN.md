# Fase 5 — Aislamiento Multi-tenant: Migración Completa a `conEmpresa`/`sinEmpresa`

Fecha de cierre: 2026-08-04  
Contexto: [evaluacion_puntos_mejora_membego.md](./evaluacion_puntos_mejora_membego.md) §3,  
[plan_refactorizacion_membego.md](./plan_refactorizacion_membego.md) Componente 3.

---

## 1. Objetivo

Cerrar el hallazgo **A-01** ("Aislamiento multi-empresa 100 % aplicativo: sin RLS
en PostgreSQL") envolviendo **todos** los puntos de consulta de la aplicación
con `conEmpresa`/`sinEmpresa` de `src/lib/tenant.ts`, de modo que cuando se
encienda RLS (cambiando `DATABASE_URL` a `membego_app`), cada transacción
declare su empresa y las políticas de PostgreSQL filtren correctamente.

**Resultado (declarado entonces):** 0 archivos con consultas `prisma.` o
`$queryRaw` sin envoltorio de tenant.

> ### ⚠️ Corrección · 2026-08-11
>
> **Ese resultado era falso, y el gate que lo midió tenía un punto ciego.**
> `scripts/rls-cobertura.mjs` recorría solo archivos `.ts`. En App Router, una
> parte enorme de las consultas vive en **componentes de servidor** (`.tsx`):
> las páginas del panel llaman a Prisma directamente. El gate informaba
> «✓ todos cubiertos» contando **9** archivos cuando en realidad había **95**
> tocando la base.
>
> Medido de nuevo con el gate corregido: **85 archivos y ~188 sitios de
> consulta siguen sin envoltorio** — 44 pantallas de admin, 11 de superadmin,
> 6 de cliente, 1 de empleado y 2 componentes.
>
> **Resuelto el mismo día:** los 85 se migraron en cuatro tandas (admin 57,
> superadmin 12, cliente 10, mostrador 6) y la lista `PENDIENTES` del gate está
> vacía. Lo que sigue es el registro de lo que se encontró.
>
> **Consecuencia que se evitó:** encender la Capa 2 con el gate anterior habría
> dejado en blanco la mayor parte del panel. Con `membego_app` una consulta sin contexto **no da error**:
> devuelve cero filas. Ver el inventario nominal en la lista `PENDIENTES` del
> script y el estado real en `docs/RLS.md`.

---

## 2. Qué se hizo, fase por fase

### 5.0 — Banco de pruebas y Capa 1+2 (preexistente)

- Capa 1+2 de RLS aplicada: `GRANT membego_app TO postgres`, 115/115 tablas
  con política en `prisma/migrations_manual/2026-07-rls-capa2-aislamiento.sql`.
- `npm run rls:probar` pasa 6/6 (aislamiento real verificado con datos
  sembrados).
- `PrismaAutomationRepository`: `type Db` ampliado a `PrismaClient | Prisma.TransactionClient`.
- Fix SQL: `sistemas_conectados` corregido → 115/115 tablas cubiertas.

### 5.1 — Admin, superadmin, empresas (17 + 9 + 8 = 34 archivos)

| Módulo | Archivos | Envoltorio |
|---|---|---|
| `admin/**` (actividad, dashboard, clientes, comprobantes, empleados, empresa, pagos, reportes, servicios, tickets, usuarios) | 17 | `conEmpresa` / `sinEmpresa` |
| `superadmin/**` (purgar, campanasGlobales, campanasActions, accesoActions, usuariosActions, eliminarActions, migraciones, membresiaActions) | 9 | `sinEmpresa` (cross-tenant) |
| `empresas/**` (sucursalPrincipal, onboarding, regional, accesos, accesosActions, queries, actions, perfilActions) | 8 | `conEmpresa` |

### 5.2 — Core operations (5 + 1 + 7 + 1 + 2 + 2 = 18 archivos)

| Módulo | Archivos | Envoltorio |
|---|---|---|
| `cliente/**` (queries, actions, registroActions, perfilActions, vehiculoActions) | 5 | `conEmpresa` |
| `visitas/actions.ts` | 1 | `conEmpresa` |
| `pagos/**` (queries, actions, comprobanteActions, confirmarActions, historialActions, metodoActions,验证) | 7 | `conEmpresa` |
| `membresia/actions.ts` | 1 | `conEmpresa` |
| `transacciones/**` (queries, actions) | 2 | `conEmpresa` |
| `caja/**` (queries, actions) | 2 | `conEmpresa` |

### 5.3 — Marketing, growth, engagement (6 + 2 + 6 + 2 + 6 + 3 + 3 + 3 + 2 + 4 + 1 + 1 = 39 archivos)

| Módulo | Archivos | Envoltorio |
|---|---|---|
| `growth/**` (links, registro, rewards, shareActions, cached, campanaActions) | 6 | `conEmpresa` / `sinEmpresa` |
| `referidos/**` (queries, actions) | 2 | `sinEmpresa` |
| `invitaciones/**` (motorProgreso, beneficios, landingActions, adminActions, queries, constants) | 6 | `conEmpresa` |
| `ofertas/**` (queries, actions) | 2 | `conEmpresa` |
| `engagement/**` (push, recordatorios, reglas, recompensas, calendario, constants) | 6 | `conEmpresa` / `sinEmpresa` |
| `promociones/**` (queries, actions, rulesEngine) | 3 | `conEmpresa` |
| `marketplace/**` (cached, queries, actions) | 3 | `sinEmpresa` |
| `social/**` (feed, reactions, comments) | 3 | `conEmpresa` |
| `resenas/**` (queries, actions) | 2 | `conEmpresa` |
| `seguimiento/**` (queries, config, actions, constants) | 4 | `conEmpresa` |
| `scanner/actions.ts` | 1 | `conEmpresa` |
| `gamificacion/ruletaActions.ts` | 1 | `conEmpresa` |

### 5.4 — Infraestructura y dominios complementarios (17 archivos)

| Módulo | Archivos | Envoltorio |
|---|---|---|
| `jobs/ejecutor.ts` | 1 | `conEmpresa` / `sinEmpresa` |
| `notificaciones/**` (queries, actions) | 2 | `conEmpresa` |
| `observabilidad/metricas.ts` | 1 | `sinEmpresa` |
| `soporte/**` (queries, actions) | 2 | `conEmpresa` |
| `integraciones/**` (webhook, sync) | 2 | `sinEmpresa` |
| `adquisicion/**` (canal, attribution) | 2 | `sinEmpresa` |
| `apps/**` (reportes, config) | 2 | `conEmpresa` |
| `auditoria/queries.ts` | 1 | `conEmpresa` |
| `capacidades/**` (queries, actions) | 2 | `conEmpresa` |
| `campanas/cadena.ts` | 1 | `conEmpresa` |
| `citas/**` (queries, actions) | 2 | `conEmpresa` |
| `demo/**` (queries, actions) | 2 | `sinEmpresa` |
| `estrategias/**` (queries, eventos) | 2 | `sinEmpresa` |
| `registro/**` (queries, actions) | 2 | `sinEmpresa` |
| `registros/queries.ts` | 1 | `conEmpresa` |
| `storage/comprobantes.ts` | 1 | `sinEmpresa` |

### Carwash (18 archivos)

Todos los archivos de `src/modules/apps/carwash/**` migrados a `conEmpresa`.

### Regalos (1 archivo)

`regalos/actions.ts` — 11 usos de `prisma.` migrados.

### Route handlers `app/` (9 archivos)

| Archivo | Envoltorio | Motivo |
|---|---|---|
| `(admin)/admin/actividad/export/route.ts` | `conEmpresa` | `company.findUnique` con `companyId` conocido |
| `(admin)/admin/app/carwash/reportes/export/route.ts` | `conEmpresa` | `company.findUnique` con `companyId` conocido |
| `(admin)/admin/registros/export/route.ts` | `conEmpresa` | `company.findUnique` condicional |
| `(admin)/admin/seguimiento/export/route.ts` | `conEmpresa` | `company.findUnique` con `companyId` conocido |
| `api/admin-reset-password/route.ts` | `sinEmpresa` | `$queryRaw` sobre `auth.users` (cross-tenant) |
| `api/bootstrap-superadmin/route.ts` | `sinEmpresa` | `user.upsert` cross-tenant |
| `api/health/route.ts` | `sinEmpresa` | Health check: catálogos del sistema |
| `api/stats/route.ts` | `sinEmpresa` | `pg_class.reltuples` + conteos cross-tenant |
| `app/r/[code]/route.ts` | `sinEmpresa` | Lookup de cliente por código sin contexto |

### Utilidades `lib/` (8 archivos)

| Archivo | Envoltorio | Motivo |
|---|---|---|
| `lib/referidos.ts` | `sinEmpresa` + `conEmpresa` | `ensureCodigoCorto` (lookup cross-tenant + update con companyId), `logReferralEvent` (create con companyId) |
| `lib/referidos-attribution.ts` | `sinEmpresa` + `conEmpresa` | Lookups cross-tenant (código, supabaseId, anti-fraude) → `sinEmpresa`. `referido.create` → `conEmpresa` |
| `lib/auth/googleOnboarding.ts` | `sinEmpresa` + `conEmpresa` | Lookups cross-tenant → `sinEmpresa`. Mutaciones con companyId → `conEmpresa` |
| `lib/transactions/application/analytics.ts` | `conEmpresa` | Todas las queries con `companyId` explícito |
| `lib/prisma.ts` | Whitelist | Cliente Prisma (proxy + logging), sin consultas propias |
| `lib/prisma-errors.ts` | Whitelist | Clasificación de errores, sin consultas |
| `lib/seed.ts` | Whitelist | Script CLI, corre como `postgres` |
| `lib/supabase/identity.ts` | Whitelist | Esquema `auth`, no aplica RLS de `public` |

---

## 3. Infraestructura de verificación

### Gate de cobertura estática (`scripts/rls-cobertura.mjs`)

Script que recorre `src/` buscando archivos con `prisma.<modelo>.` o
`$queryRaw`/`$executeRaw` y verifica que importen `conEmpresa` o `sinEmpresa`.
Archivos justificados entran en una whitelist.

```bash
node scripts/rls-cobertura.mjs        # falla si hay gaps (CI gate)
node scripts/rls-cobertura.mjs --info  # reporta sin fallar (dev)
```

### CI gate (`.github/workflows/ci.yml`)

Agregado al job `verificar`:

```yaml
- name: Cobertura RLS (envoltorio de tenant)
  run: node scripts/rls-cobertura.mjs
```

Bloquea el merge si algún archivo con consultas no está cubierto.

### Fix: whitelist keys

Bug corregido: las claves del `Map` BLANCA tenían prefijo `src/` pero la
variable `relativa` lo strippeaba, causando que los archivos justificados
nunca matchearan. Corregido eliminando el prefijo.

---

## 4. Patrón de migración

```ts
// Antes (prisma global, sin contexto de empresa):
const empresa = await prisma.company.findUnique({ where: { id: companyId } })

// Después (dentro de conEmpresa):
const empresa = await conEmpresa(companyId, (tx) =>
  tx.company.findUnique({ where: { id: companyId } })
)
```

```ts
// Lookup cross-tenant (sin empresa conocida):
const user = await sinEmpresa('auth-user-lookup', (tx) =>
  tx.user.findUnique({ where: { email } })
)
```

**Reglas:**
- `WHERE companyId` **nunca se quita** — RLS es la segunda barrera, no la
  primera.
- `conEmpresa`/`sinEmpresa` **no se anidan** — Prisma reutiliza la transacción
  existente (savepoint).
- Archivos `lib/` llamados desde módulos envueltos en `conEmpresa` funcionan
  correctamente porque Prisma reutiliza la transacción padre.
- Narrowing de TS se pierde dentro del closure → extraer a const local.

---

## 5. Verificación

```
npx tsc --noEmit              → 0 errores (solo artefactos .next)
bun run test                  → 286/286 pass
node scripts/rls-cobertura.mjs → ✓ 0 gaps  ← medida inválida: solo miraba .ts (ver corrección arriba)
```

---

## 6. Archivos tocados (resumen)

```
~100 archivos en src/modules/** migrados
9 archivos en src/app/** migrados
8 archivos en src/lib/** migrados/whitelisted
scripts/rls-cobertura.mjs (whitelist fix)
.github/workflows/ci.yml (RLS gate)
docs/RLS.md (stats actualizados)
docs/FASE5-RESUMEN.md (este documento)
```

---

## 7. Qué queda para encender RLS en producción

1. **Base de prueba**: aplicar la Capa 2 (`psql -f ...aislamiento.sql`).
2. **Cambiar** `DATABASE_URL` de `postgres` a `membego_app` (rol sin BYPASSRLS).
3. **Ejecutar** `npm run rls:probar` — debe pasar 6/6.
4. **Ejercitar** la aplicación manualmente (admin, cliente, marketplace, scanner).
5. **Producción**: devolver `DATABASE_URL` al rol `postgres` si algo falla
   (marcha atrás inmediata).

---

## 8. Relación con el plan de refactorización

| Plan § | Componente | Estado |
|---|---|---|
| §3 Componente 3 | Aislamiento Tenant (RLS & Prisma) | **Fase 5 completada** — código envuelto, gate CI activo. Falta encender en producción. |
| §3 Componente 1 | Auth y Middleware (JWT local) | Pendiente |
| §3 Componente 2 | Consultas N+1, paginación | Pendiente |
| §3 Componente 4 | Monorepo (Turborepo) | Pendiente |
| §3 Componente 5 | Procesamiento asíncrono (colas) | Pendiente |
| §3 Componente 6 | Validación Zod y logs | Pendiente |
| §3 Componente 7 | Monetización SaaS | Pendiente |

La evaluación §3.2 ("Uso de un Contexto de Prisma Seguro") propuso
`prisma.$extends` para inyectar el tenant automáticamente. Se descartó en
favor de `conEmpresa`/`sinEmpresa` explícitos porque:
- No rompe el tipado de Prisma (el `$extends` genera tipos ilegibles).
- Es migrable gradualmente (cada archivo se envuelve independientemente).
- No oculta el `WHERE companyId` — que debe quedarse como primera barrera.
