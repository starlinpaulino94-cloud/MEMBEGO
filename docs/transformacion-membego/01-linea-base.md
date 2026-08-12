# Fase 01 · Línea base técnica

**Programa de transformación total — aplicación del cliente de MembeGo.**

Estado real del frontend ANTES de modificarlo. Este documento permite
reproducir el punto de partida: commit exacto, versiones, comandos con sus
resultados, inventario de rutas y deuda conocida. No cambia UI, rutas, base de
datos ni comportamiento.

| | |
|---|---|
| Commit base | `2e84854` (punta de `main`, 12-08-2026) |
| Node / npm | v22.22.2 / 10.9.7 |
| Fecha de captura | 12-08-2026 |

---

## 1. Stack real

| Pieza | Versión (package.json) | Notas |
|---|---|---|
| Next.js | `^16.1.1` (16.2.12 instalada) | **App Router**, build con webpack (`next build --webpack`) |
| React | `^19.0.0` | Server Components por defecto; `'use client'` explícito |
| TypeScript | `^5` | `strict`; el chequeo vive en CI (`npx tsc --noEmit`), **no** en el build de Vercel (decisión deliberada, ver §5) |
| Tailwind CSS | `^4` | Tokens en `src/app/globals.css` vía `@theme` (color, motion, tipografía) |
| Prisma | `^6.11.1` (cliente 6.19.3) | Esquema multiarchivo en `prisma/schema/` (137 modelos) |
| Supabase | `@supabase/supabase-js ^2.50.0`, `@supabase/ssr ^0.6.1` | Autenticación y Storage; la app consulta por Prisma, no por PostgREST (cerrado) |
| Sentry | `@sentry/nextjs ^10.63.0` | Subida de mapas apagada en Vercel (`SENTRY_UPLOAD=off` en `vercel.json`) |
| UI | shadcn-style en `src/components/ui/` + `lucide-react` + `sonner` | `packages/ui` (`@membego/ui`) transpilado |
| Validación | `zod ^4.0.2` | |
| E2E | `@playwright/test ^1.62.0` | `tests/e2e/` (3 specs), corre en CI |
| Dependencias | 62 de producción + 15 de desarrollo | |

**Gestor de estado global: no hay** (ni zustand, ni redux, ni jotai). El estado
vive en Server Components + URL; `src/lib/context/` no es estado de UI, es el
modelo de contexto del Rule Engine.

**Multi-tenant:** cada consulta pasa por `conEmpresa`/`sinEmpresa`/`conUsuario`
(`src/lib/tenant.ts`, transacciones con `SET LOCAL`), con RLS real en la base
(rol `membego_app`, 137 políticas) y guardia automática de cobertura
(`scripts/rls-cobertura.mjs`, en CI).

## 2. Estructura de rutas (grupos de `src/app/`)

`(admin)` `(auth)` `(cliente)` `(empleado)` `(onboarding)` `(public)`
`(superadmin)` + `api/` + sueltas (`invita`, `invitacion`, `invitar`, `r`,
`sso`, `og`, `offline`). **235 rutas** en el build de producción.

### Rutas del CLIENTE (alcance del programa) — 33

Bajo `(cliente)`:

```
/cliente/inicio        /cliente/cerca              /cliente/promociones
/cliente/promociones/[id]                          /cliente/mis-promociones
/cliente/mis-promociones/[id]                      /cliente/mis-promociones/[id]/agendar
/cliente/dashboard     /cliente/explorar           /cliente/empresas
/cliente/empresas/[companySlug]                    /cliente/membresia
/cliente/historial     /cliente/pagos              /cliente/perfil
/cliente/planes        /cliente/citas              /cliente/vehiculos
/cliente/vehiculos/nuevo                           /cliente/regalos
/cliente/regalos/enviar  /cliente/regalos/giftcard  /cliente/regalos/regalar
/cliente/referidos     /cliente/invita-y-gana      /cliente/ruleta
/cliente/ayuda         /cliente/ayuda/[id]         /cliente/bienvenida
/cliente/celebracion   /cliente/intereses
/mis-membresias        /membresia/[membresiaId]
```

### Navegación actual del cliente

`src/components/layout/AppShell.tsx` + `BottomNav.tsx`. Destinos declarados:
**Inicio** (`/cliente/inicio`), **Cerca**, **Ofertas** (`/cliente/promociones`),
**Beneficios** (`/cliente/mis-promociones`), **Membresías** (`/mis-membresias`),
**Historial**, **Perfil**, más el botón central **Mi QR**. La visibilidad por
empresa la decide `getNavOcultoClienteCached` (`modules/cliente/navDisponible`)
— la barra puede variar entre empresas. Relevante para las fases 15–16 (cinco
destinos): hoy hay **más de cinco candidatos**.

## 3. Comandos reales y resultados (todos ejecutados hoy, sobre `2e84854`)

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ salida 0 |
| `npx eslint src tests --max-warnings=0` | ✅ salida 0 |
| `npm test` (`tsx --test tests/*.test.ts`) | ✅ **892 pruebas, 0 fallos** (~23 s) |
| `SENTRY_UPLOAD=off npm run build` | ✅ salida 0 · «Compiled successfully in 2.5min» · 235 rutas |
| `npm run presupuesto` (tras el build) | ✅ «Dentro de presupuesto» |
| `node scripts/rls-cobertura.mjs` | ✅ 296 archivos con contexto de empresa; 14 con prisma directo, todos justificados |
| `npm run e2e` | **No ejecutado en local** (requiere servidor + base sembrada). Corre en CI (workflow «E2E», 3 specs: `publico`, `registro-v2`, `fase4-conversion`); último run de `main` en verde |

Fallos preexistentes introducidos por esta fase: **ninguno** (no hay fallos:
todo lo anterior está en verde).

## 4. CI/CD

- **`ci.yml`** — 4 trabajos: tipos/linter/pruebas (+cobertura RLS), build de
  producción (+presupuesto de bundle), `npm audit` de producción, esquema de BD
  (migración pendiente + aislamiento RLS contra PostgreSQL real).
- **`e2e.yml`** — Playwright («Recorrido público»).
- **`deploy-migraciones.yml`** — `prisma migrate deploy` + hook de Vercel.
  **Los dos pasos se saltan hoy**: el secreto `MIGRATIONS_DATABASE_URL` no está
  configurado; las migraciones se aplican a mano en Supabase (docs/DEVOPS.md).
- **`respaldo-verificacion.yml`** — verificación de respaldos.
- Despliegue: Vercel (integración git; producción = `main`). El chequeo de
  tipos NO corre en ese build (`typescript.ignoreBuildErrors`, incidente OOM
  12-08-2026, documentado en `next.config.ts`) — lo cubre CI como check
  requerido.

## 5. Deuda y particularidades detectadas (observaciones; nada se corrige aquí)

1. **Migraciones sin automatizar**: `MIGRATIONS_DATABASE_URL` sin configurar →
   el deploy puede adelantarse a la base sin aviso (el endpoint `/api/health`
   tiene centinelas de drift como mitigación).
2. **Tokens duplicados en `globals.css`**: nombres nuevos apuntando a tokens
   viejos, marcados «no se borran todavía» — limpieza pendiente (fases 09–14
   del programa pisan aquí; ya existe guardia de deuda de diseño:
   `tests/deuda-diseno.test.ts`).
3. **Navegación variable por empresa** (`navDisponible`): el mismo cliente ve
   barras distintas según el negocio — tensión directa con las fases 15–19.
4. **Más de 5 destinos** en la barra actual (7 + Mi QR).
5. **Tablas legacy en producción** fuera del esquema actual (~10: `customers`,
   `digital_passes`, `vehicles`, …) — cerradas por RLS sin política (deny-all),
   inofensivas pero presentes; el conteo real de tablas (147) difiere del
   esquema (137).
6. **Arte de promoción apaisado pre-existente**: el formato nuevo (1080×1080,
   exigido en la subida desde `formato-imagen.ts`) no re-valida lo ya subido;
   ese arte se muestra entero con franjas.
7. **Incidente 12-08-2026 (contexto)**: la `DATABASE_URL` de producción pasó
   del puerto directo (5432) al transaction pooler de Supabase por IPv4
   (`connection_limit=3`); las transacciones de contexto llevan
   `maxWait 10 s / timeout 15 s` (`src/lib/tenant.ts`). Cualquier medición de
   rendimiento (fases 57–58) parte de ese estado.
8. **Trabajo previo que pisa fases del programa** (verificado en este repo):
   cliente global multi-empresa (≈ fase 06), sistema de diseño fase 1 y guardia
   (≈ 09–14 parcial), arreglos del mapa (≈ 44–45 parcial), formato de imagen
   (≈ 56 parcial), RLS + aislamiento verificado (≈ 61 parcial). En esas fases:
   verificar contra los criterios y cubrir huecos, no rehacer.

## 6. Cómo reproducir esta línea base

```bash
git checkout 2e84854
npm ci                        # Node 22
npx tsc --noEmit              # 0
npx eslint src tests --max-warnings=0   # 0
npm test                      # 892 pass / 0 fail
SENTRY_UPLOAD=off npm run build         # 0 · 235 rutas
npm run presupuesto           # dentro de presupuesto
node scripts/rls-cobertura.mjs          # todo justificado
```
