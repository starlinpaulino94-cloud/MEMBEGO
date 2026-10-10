# Arquitectura de separación Landing / Aplicación (FASE 2 · preparación)

> Estado: **separación FÍSICA por dominios: preparada, no ejecutada.** El proyecto
> sigue funcionando en **un solo dominio**. Lo que sí se ejecutó (2026-10-09/10) es
> la separación **funcional** dentro de este repositorio —landing que informa, app
> del cliente que opera, paneles—, documentada, con su tabla de rutas por espacio
> generada del código, en [SEPARACION_LANDING_APP.md](SEPARACION_LANDING_APP.md).
> Este documento fija el mapa objetivo para cortar por dominios cuando se apruebe
> (F7); el mapa de abajo ya refleja el estado funcional de hoy.

## Objetivo

- `membego.com` → **Landing** (marketing, SEO, blog).
- `app.membego.com` → **Aplicación** (auth + paneles).
- `api.membego.com` → **Backend futuro** (no se toca ahora).

Estrategia elegida (R1): **B → C** — el marketplace público mantiene por ahora
su capa de datos de solo-lectura y luego migra a `api.membego.com`. La base de
datos, Prisma, Supabase, auth, motores de negocio y APIs **no cambian**.

## Abstracción de dominios (ya preparada)

`src/lib/site.ts` expone:

| Función | Devuelve | Hoy |
|---|---|---|
| `getAppUrl()` | dominio único (retrocompatible) | `NEXT_PUBLIC_APP_URL` / `https://membego.com` |
| `landingUrl()` / `landingUrlFor(path)` | dominio de la Landing | = `getAppUrl()` |
| `appUrl()` / `appUrlFor(path)` | dominio de la Aplicación | = `getAppUrl()` |
| `absoluteUrl(path)` | URL absoluta (dominio actual) | sin cambios |

Env (opcionales, en `.env.example`): `NEXT_PUBLIC_LANDING_URL`,
`NEXT_PUBLIC_APP_ORIGIN`. **Mientras estén vacías, todo apunta al dominio único
→ cero cambio de comportamiento.** Ningún llamador se ha migrado todavía; la
migración de call-sites es una etapa posterior (ver checklist).

## Mapa de route-groups → proyecto futuro

| Route group / ruta | Proyecto | Naturaleza |
|---|---|---|
| `(public)/page.tsx` (Home) | Landing | Marketing + destacados (DB) |
| `(public)/empresas`, `/empresas/[slug]` | Landing | Marketplace/SEO (DB) |
| `(public)/promociones`, `/promocion/[id]` (+OG) | Landing | Marketplace/SEO (DB), **solo consulta**; la compra/contratación/reclamo es del cliente en `/cliente/*` |
| `(public)/plan/[id]` (+OG) | Landing | Marketplace/SEO (DB) |
| `(public)/registro-empresa` | Landing | Captación B2B (form) |
| `(public)/contact` `/terms` `/privacy` | Landing | Estáticas |
| *(nuevas: características, FAQ, blog, descarga)* | Landing | A crear (etapa 4) |
| `(auth)/*` (login, registro, recuperar, confirmar) | App | Auth |
| `(cliente)/*`, `/mis-membresias`, `/membresia/[id]` | App | Cliente: todo lo operativo (carrito único, fichas de compra y reserva, ofertas Membego, membresías, campañas, regalos) vive bajo `/cliente`. `/mis-membresias` y `/membresia/[id]` se quedan fuera por la app móvil |
| `(admin)/*` | App | Panel admin |
| `(superadmin)/*` | App | Panel superadmin |
| `(empleado)/*` | App | Scanner |
| `(onboarding)/*` | App | Onboarding B2B |
| `invitacion/[token]` | App | Invitación de equipo |
| `(auth)/registro` (antes `(public)/registro`, movido en F5; misma URL) | App | Entrada al registro; conserva la consulta |
| `(public)/i/[code]` | **Híbrido → App** | Enlace de invitación que lleva al registro |
| `r/[code]`, `auth/callback`, `confirmar` | App | Redirects / auth |
| `api/*`, `/monitoring` | App | Backend interno |
| `layout.tsx` (root), `error`, `not-found` | **Compartido** (duplicar) | Shell base |
| `sitemap.ts`, (falta `robots.ts`) | Landing | SEO |

## Límite de UI compartida (futuro `packages/ui`)

Componentes usados por **ambos** lados — fuente única a extraer (no duplicar
divergiendo):

- `src/components/ui/*` (design system, 27).
- `src/components/marketplace/*` (`PromotionDetail`, `CompanyProfile`).
- `src/components/public/Share*` (`ShareMenu`, `SharePromocionMenu`, `ShareButton`, `SharePromocion`).
- `src/components/growth/CountdownTimer` (landing) — separar de los de app
  (`ConfettiCelebration`, `GenerarInvitacionCard`).
- Infra: `ThemeProvider`, `ThemeToggle`, `EstadoBadge`, `PanelError`, `PanelNotFound`.

Exclusivos Landing: `src/components/public/*` (resto).
Exclusivos App: `admin/`, `cliente/`, `scanner/`, `superadmin/`, `membresia/`,
`onboarding/`, `qr/`, `charts/`, `auth/`, `layout/` (AppShell).

## Navegación cross-dominio (a cablear en etapa 7)

| Enlace | Destino futuro | Función a usar |
|---|---|---|
| `PublicNav` → empresas/promociones/para-empresas | Landing | relativo |
| `PublicNav` → login/registro | App | `appUrlFor('/login')`; con sesión la barra muestra «Ir a mi app» / «Ir a mi panel» (componente de cliente, la landing sigue estática) |
| Traspaso (`TraspasoALaApp`, `EnlaceDeTraspaso`) | App | `rutaDeLogin(destino)`; el destino pasa por `destino-seguro` |
| `AppShell` / `nav-config.ts` | App | relativo |
| Logout / marca → Home | Landing | `landingUrlFor('/')` |
| Share/OG/QR/referidos | según recurso | `landingUrlFor` / `appUrlFor` |

## Dependencias que NO deben ir a la Landing pura

`@supabase/*`, `html5-qrcode`, `qrcode`, `leaflet`, `@tanstack/react-table`,
`recharts`, `lru-cache`, `input-otp`, `cmdk`, `vaul`, `embla-carousel-react`,
`react-day-picker`, `react-resizable-panels`. `@prisma/client` solo si la
Landing conserva el marketplace (opción B). **Nunca** claves `service_role` ni
`SENTRY_AUTH_TOKEN` en la Landing.

## Checklist de ejecución (siguientes etapas — requieren aprobación)

- [ ] **Etapa 3** — Extraer UI compartida a paquete/monorepo (Turborepo).
- [ ] **Etapa 4** — Landing estática (Home marketing, características, FAQ,
      contacto, términos, privacidad, descarga) + `robots.ts` + sitemap propio +
      metadata/JSON-LD movidos desde el layout raíz.
- [ ] **Etapa 5** — Ubicar el marketplace (B: capa de datos read-only en Landing)
      + 301/canónicos/Search Console.
- [ ] **Etapa 6** — App independiente: cookies en `.membego.com`, todos los
      grupos autenticados + APIs.
- [ ] **Etapa 7** — Migrar call-sites de `getAppUrl()` a `landingUrlFor`/
      `appUrlFor`, cablear cross-links y QA de sesión cross-subdominio.

## Etapa 3 · Manifiesto de extracción de UI (auditado, límite verificado)

Auditoría de fugas ejecutada sobre el conjunto compartido. **Resultado: el
límite está limpio.** El design system no depende de negocio.

### `packages/ui` (design system puro — listo para extraer)
- `src/components/ui/*` — **27 componentes** (accordion, alert-dialog, alert,
  badge, button, card, command, confirm-dialog, data-table, delete-button,
  dialog, dropdown-menu, empty-state, input, label, page-header, pagination,
  password-input, progress, select, skeleton, sonner, stat-card, status-banner,
  switch, tabs, textarea).
- Única dependencia interna: `cn` de `src/lib/utils.ts` (24 usos). `cn` es
  **puro** (`clsx` + `tailwind-merge`), sin negocio → viaja con el paquete.
  > Nota: `lib/utils.ts` mezcla `cn` (UI) con `safeInternalPath` (auth de app);
  > al extraer conviene separar `cn` a `packages/ui` y dejar `safeInternalPath`
  > en la app. Los tokens de diseño viven en `globals.css` + config de Tailwind
  > (deben incluirse en el `content` del paquete).
- Dependencias externas: `@radix-ui/*`, `lucide-react`, `class-variance-authority`,
  `clsx`, `tailwind-merge`, `sonner`, `cmdk`, `@tanstack/react-table` (solo
  `data-table`).
- **Cero** imports de `@/modules`, Prisma, Supabase o auth. ✅

### Genéricos compartibles (candidatos a `packages/ui` o `packages/shared`)
- `src/components/public/ShareMenu.tsx`, `ShareButton.tsx` — limpios.
- `src/components/growth/CountdownTimer.tsx` — limpio.
- `src/components/ThemeProvider`, `ThemeToggle`, `EstadoBadge`, `PanelError`,
  `PanelNotFound` — limpios.

### Capa de FEATURE compartida (NO es UI pura — se queda con su dominio)
- `src/components/marketplace/PromotionDetail`, `CompanyProfile` — dependen de
  `@/modules/marketplace/{types,queries}`, `@/lib/format` y de wrappers de
  dominio. Van a un paquete de feature o permanecen en la app (opción B).
- `src/components/public/SharePromocionMenu`, `SharePromocion` — **wrappers de
  dominio** que llaman al server action `recordPromotionShare`
  (`@/modules/marketplace/actions`). NO son UI genérica: pertenecen a la feature
  de marketplace. (Los genéricos `ShareMenu`/`ShareButton` sí son de UI.)

### Movimiento físico (big-bang) — pendiente de verificación visual
Convertir a monorepo (mover `src/` → `apps/app`, crear `packages/ui`, workspaces
+ `turbo.json`, alias tsconfig, `content` de Tailwind) reescribe imports y
**afecta el estilado**, que no puede verificarse en un entorno headless. Se
recomienda ejecutarlo en un paso dedicado con verificación visual del Tailwind.
El manifiesto anterior lo hace **mecánico y de bajo riesgo**.

## Etapa 5 · Ubicación del marketplace (opción B) + SEO

Decisión R1 aplicada: **el marketplace público se queda con una capa de datos
de solo-lectura** (hoy en el mismo proyecto; luego migrable a `api.membego.com`
sin tocar UI). Auditoría confirmada:

- `src/modules/marketplace/queries.ts` — **100% read-only** (cero
  create/update/delete/upsert). Es la capa que la Landing conserva bajo opción B.
- Únicas escrituras del marketplace: `recordPromotionView` y
  `recordPromotionShare` (`marketplace/actions.ts`) — contadores de analítica
  de bajo riesgo. Bajo la separación pueden (a) seguir como server actions en la
  Landing, o (b) enviarse a `api.membego.com` en el futuro (fire-and-forget).

### Canónicos (cerrado el gap de SEO)
Ahora **todas** las páginas del marketplace declaran `canonical` + OG:

| Ruta | Canónico |
|---|---|
| `/empresas` | metadata estática ✅ (nuevo) |
| `/empresas/[companySlug]` | `generateMetadata` dinámica ✅ (nuevo) |
| `/promociones` | metadata estática ✅ (nuevo) |
| `/promocion/[id]` | `generateMetadata` ✅ (E8) |
| `/plan/[id]` | `generateMetadata` ✅ (E8) |

Los canónicos son **relativos** y se resuelven contra `metadataBase`
(`getAppUrl()`). Al separar dominios, si el marketplace vive en la Landing,
`metadataBase` de ese proyecto = `landingUrl()` → los canónicos quedan
correctos sin tocar las páginas.

### Plan de 301 / redirects para el corte de dominios (etapa 6–7)
- Ya existe: `/empresa/:slug*` → `/empresas/:slug*` (301, `next.config.ts`) —
  viaja con la Landing.
- Al separar: si alguna URL de marketplace cambia de host, publicar 301 en el
  origen antiguo hacia el nuevo host **conservando el path y el slug** (no
  cambiar slugs). Registrar ambos dominios en Search Console y reenviar sitemaps.
- Rutas de app que hoy responden en el dominio único (`/login`, `/registro`,
  paneles): al separarlas, 301 desde la Landing hacia `appUrlFor(path)`.

## Etapa 6 · App independiente (arranque: cookie cross-subdominio)

Pieza fundacional **hecha y segura** (env-driven, sin cambio de conducta):

- `sessionCookieDomain()` en `src/lib/site.ts` lee `NEXT_PUBLIC_COOKIE_DOMAIN`.
  Vacío ⇒ `undefined` ⇒ cookie **host-only** (comportamiento actual idéntico).
- Cableado en los 4 puntos que fijan cookies de Supabase, aplicando `domain`
  **solo si está definido**:
  - `src/lib/supabase/client.ts` (browser, `cookieOptions`).
  - `src/lib/supabase/server.ts` (RSC/server actions, `setAll`).
  - `src/lib/supabase/route-client.ts` (callbacks OAuth/confirmar, `setAll`).
  - `src/proxy.ts` (middleware: refresh/rotación de sesión, `setAll`).
- Al separar dominios, definir en producción
  `NEXT_PUBLIC_COOKIE_DOMAIN=".membego.com"` → SSO entre `app.membego.com` y
  `membego.com` sin re-login. **No fijarlo en local ni previews** (host distinto
  rompe la sesión).

### Runbook del corte físico (pendiente — requiere verificación visual)
El movimiento físico a dos proyectos/monorepo NO se ejecuta a ciegas porque
afecta el estilado (Tailwind `content`) y la sesión (cookies), no verificables
en entorno headless. Orden sugerido con verificación en navegador tras cada paso:
1. **Cookies**: definir `NEXT_PUBLIC_COOKIE_DOMAIN=.membego.com` en producción y
   verificar login/refresh/logout en `app.` y `membego.com`.
2. **Monorepo**: crear `apps/app`, `apps/landing`, `packages/ui` (Turborepo);
   mover según el manifiesto de Etapa 3; ajustar `content` de Tailwind y alias
   tsconfig; verificar estilado visualmente.
3. **Dominios**: apuntar `app.membego.com` al proyecto app y `membego.com` al de
   landing/marketplace; definir `NEXT_PUBLIC_LANDING_URL`/`NEXT_PUBLIC_APP_ORIGIN`.
4. **Cross-links y 301**: migrar call-sites a `landingUrlFor`/`appUrlFor`;
   publicar 301 y reenviar sitemaps (ver Etapa 5).
5. **QA**: sesión cross-subdominio, OG/share/QR/referidos, SEO/canónicos.

## Invariantes (no romper)

DB, Prisma, Supabase, auth, membresías, promociones, referidos, Growth Engine,
panel admin, scanner y motor de reglas **no se modifican**. La separación es
puramente de **organización y dominios**.
