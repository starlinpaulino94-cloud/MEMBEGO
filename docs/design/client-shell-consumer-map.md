# Client shell consumer map and platform constraints

Read-only blast-radius inventory for the client shell shared by the Next.js
`(cliente)` route group and the Expo Router app in `apps/client`. Produced for
Todo 3 of `.omo/plans/cliente-web-to-native-redesign.md`. Every claim cites a
real `path:line`. No product code was modified.

Repo: `C:\Users\Usuario\projects\MEMBEGO` · branch `feat/expo-app-client` ·
HEAD `c95a00b2cc7f4e2cd5d7340e92685f8a915d199e` (see
`.omo/evidence/task-3-cliente-web-to-native-redesign.md`).

---

## 1. Web shell — symbol inventory

### 1.1 `CustomerShell`

- Defines: `src/components/layout/CustomerShell.tsx:17`
- Props: `iniciales, email, dbUserId, role, companyId, zonaLabel, demoNombre, children` (`CustomerShell.tsx:17-35`)
- Consumers (runtime):
  - `src/app/(cliente)/layout.tsx:6` (import), `:67-77` (render) — the only runtime caller.
- Consumers (static/assertion):
  - `tests/cliente-retail.test.ts:72` (`assert.match(src, /CustomerShell/)`), `:79` (reads the file), `:80-93` (asserts `action="/cliente/buscar"`, `href="/cliente/qr"`, `href="/cliente/cerca"`, `href="/cliente/perfil"`, `<BottomNav />`, `<TabsEscritorio />`, `con-dock-inferior`, exactly one `<BannerDemo `).
  - `tests/movil-cliente.test.ts:63` (reads the file), `:64-73` (asserts no `pb-24`, asserts `con-dock-inferior`).
- Textual-only references (comments that encode the shell's content padding `px-4 py-4 lg:px-6`, no import): `src/components/cliente/inicio/InicioRetail.tsx:24`, `src/components/CatalogoPlanesGlobal.tsx:68`, `src/app/(cliente)/cliente/planes/page.tsx:206`, `src/app/(cliente)/cliente/cerca/page.tsx:23`, `src/app/(cliente)/cliente/buscar/page.tsx:50`.
- Breaks if signature/markup changes:
  - Any prop change breaks `src/app/(cliente)/layout.tsx:67-77` (single caller) at compile time.
  - Markup/route-string changes (`/cliente/buscar`, `/cliente/qr`, `/cliente/cerca`, `/cliente/perfil`, `con-dock-inferior`, one `BannerDemo`) fail `tests/cliente-retail.test.ts:78-94`.
  - Changing the content padding (`px-4 py-4 lg:px-6`) silently breaks the negative-margin mirror in `InicioRetail.tsx:24` and the padding replicas in `cerca/page.tsx:23`/`buscar/page.tsx:50`.
  - `tests/cliente-retail.test.ts:78` **currently fails** because it asserts `href="/cliente/qr"` inside `CustomerShell.tsx`, but the QR link lives in `TabsEscritorio`/`BottomNav`, not in the shell file (evidence: `.omo/evidence/task-3-cliente-retail-test.txt`).

### 1.2 `TabsEscritorio` (web)

- Defines: `src/components/layout/TabsEscritorio.tsx:24`
- Consumers: `src/components/layout/CustomerShell.tsx:4` (import), `:97` (render, inside the sticky header); `tests/cliente-retail.test.ts:49` (reads file), `:57-62` (asserts `aria-current={activo ? 'page' : undefined}`), `:85` (asserts `<TabsEscritorio />` in the shell).
- Reads `DESTINOS_CLIENTE` + `esDestinoActivo` from `./destinos-cliente` (`TabsEscritorio.tsx:6`).
- No props. Breaks if the active-state markup (`aria-current`) or the destination source changes.

### 1.3 `BottomNav` (web)

- Defines: `src/components/layout/BottomNav.tsx:42`
- Consumers: `src/components/layout/CustomerShell.tsx:3` (import), `:105` (render); `tests/cliente-retail.test.ts:48` (reads file), `:50-53` (asserts `DESTINOS_CLIENTE`, no `FLEX_CANDIDATOS|qrHref|hiddenNav`, `--dock-inferior`), `:84` (asserts `<BottomNav />`); `tests/movil-cliente.test.ts:90-97` (asserts `--dock-inferior`).
- Reads `DESTINOS_CLIENTE` + `esDestinoActivo` (`BottomNav.tsx:14`); icon map `ICONOS` keyed by href at `BottomNav.tsx:31-37` with `?? Home` fallback at `:57`; elevated QR target `HREF_QR = '/cliente/qr'` at `:40`, rendered at `:58-79`.
- Breaks if a destination `href` is renamed without updating `ICONOS` (silently falls back to `Home`) or if `--dock-inferior` usage is removed (test).

### 1.4 `DESTINOS_CLIENTE` / `esDestinoActivo` (web, single source)

- Defines: `src/components/layout/destinos-cliente.ts:21` (`DESTINOS_CLIENTE`), `:45` (`esDestinoActivo`).
- Consumers: `src/components/layout/BottomNav.tsx:14`, `src/components/layout/TabsEscritorio.tsx:6`, `tests/cliente-retail.test.ts:15-18` (imports and asserts values).
- **Contract divergence**: the doc comment at `destinos-cliente.ts:1-8` and `tests/cliente-retail.test.ts:23-32` say exactly four destinations (`/cliente/inicio`, `/cliente/perfil`, `/cliente/qr`, `/cliente/menu`), but the array at `destinos-cliente.ts:21-42` has **five** entries, inserting `{ href: '/cliente/promociones', label: 'Beneficios' }` at `:40`. The assertion at `tests/cliente-retail.test.ts:24-27` fails today (evidence file).

### 1.5 Shell-rendered supporting components (shared outside the client shell)

| Symbol | Defines | Consumers | Breaks if changed |
| --- | --- | --- | --- |
| `BannerDemo` | `src/components/system/BannerDemo.tsx:17` | `CustomerShell.tsx:5,100`; `src/app/(admin)/layout.tsx:11,184`; `tests/cliente-retail.test.ts:90` | Prop `{ nombreEmpresa?: string \| null }` is used by admin too; the test pins exactly one render inside `CustomerShell` |
| `SentryUserSync` | `src/components/SentryUserSync.tsx:12` | `CustomerShell.tsx:6,106`; `src/app/(empleado)/layout.tsx:36`; `src/app/(admin)/layout.tsx:181`; `src/app/(superadmin)/layout.tsx:33` | Prop shape `{ userId,email,role,companyId }` is shared by 4 layouts |
| `ExcursionCarritoWrapper` | `src/components/excursiones/ExcursionCarritoWrapper.tsx:7` | `CustomerShell.tsx:7,102`; `src/app/(public)/layout.tsx:3,14`; `src/app/(public)/checkout/page.tsx:3,12` | `{ children }` only; used by public layouts as well |

## 2. Native shell — symbol inventory

Native shell surfaces live in `apps/client/src/components/layout/`.

### 2.1 `HeaderVibe`

- Defines: `apps/client/src/components/layout/HeaderVibe.tsx:15`
- Props: `{ zonaLabel?: string | null; onSearch?: (query: string) => void }` (`HeaderVibe.tsx:10-13`)
- Consumers: `apps/client/app/(tabs)/_layout.tsx:4` (import), `:14` (`<HeaderVibe />` — **no props passed**).
- Uses `useRouter` (`:16`), `useSafeAreaInsets` (`:17`), `useAuth` (`:18`), `LinearGradient` colors `['#5b21b6','#7c3aed','#2563eb','#06b6d4']` at `:26`.
- Breaks if signature/markup changes: single runtime caller is `(tabs)/_layout.tsx`; no native test references it (grep for `HeaderVibe` finds only the component and that layout).
- Dead wiring: prop `onSearch` is never passed or used (`HeaderVibe.tsx:10-15`), and `zonaLabel` is never passed from the layout, so `PillUbicacion` always receives `undefined` and renders the fallback string (`HeaderVibe.tsx:80`, `PillUbicacion.tsx:23`).

### 2.2 `PillUbicacion`

- Defines: `apps/client/src/components/layout/PillUbicacion.tsx:10`
- Props: `{ zonaLabel?: string | null; onPress?: () => void }` (`PillUbicacion.tsx:5-8`)
- Consumers: `HeaderVibe.tsx:6` (import), `:80` (render, only `zonaLabel` passed, `onPress` omitted).
- Breaks if changed: single consumer. `onPress` omitted ⇒ the pill is inert (touch does nothing) on native.

### 2.3 `BottomTabDock` (native)

- Defines: `apps/client/src/components/layout/BottomTabDock.tsx:44`
- Own `DESTINOS` at `:19-34`; own `esDestinoActivo` at `:37-42`.
- Consumers: `apps/client/app/(tabs)/_layout.tsx:6` (import), `:29` (`{!isDesktop && <BottomTabDock />}`).
- Uses `useSafeAreaInsets` at `:45`, `Math.max(insets.bottom, 8)` at `:51`.
- Breaks if changed: single consumer + duplicated destination source (see §4).

### 2.4 `TabsEscritorio` (native)

- Defines: `apps/client/src/components/layout/TabsEscritorio.tsx:33`
- Own `DESTINOS` at `:11-24`; own `esDestinoActivo` at `:26-31`.
- Consumers: `apps/client/app/(tabs)/_layout.tsx:5` (import), `:15` (`{isDesktop && <TabsEscritorio />}`).
- Breaks if changed: single consumer + duplicated destination source (see §4).

### 2.5 Native shell container / auth

- Container: `apps/client/app/(tabs)/_layout.tsx:8-32` renders `HeaderVibe` (`:14`), `TabsEscritorio` at `width >= 768` (`:10`, `:15`), an Expo `Tabs` navigator with `tabBarStyle: { display: 'none' }` (`:17-27`, screens `inicio/qr/cuenta/menu`), and `BottomTabDock` below 768 (`:29`).
- Root: `apps/client/app/_layout.tsx:48` `SafeAreaProvider`, `:50` `AuthProvider`, `:52-58` root `Stack` (auth + tabs + standalone screens).
- `AuthProvider` / `useAuth`: `apps/client/src/lib/auth-context.tsx:17` / `:76`; `isAuthenticated = !!user` at `:51`; `isCliente` computed at `:53` but **never consumed** (grep for `isCliente` returns only `auth-context.tsx:10,53,60,71`).
- `HeaderVibe` consumes `useAuth` at `HeaderVibe.tsx:18` for the avatar (`:60-76`).

## 3. Four persistent destinations — as coded today, both platforms

### 3.1 Web (`src/components/layout/destinos-cliente.ts:21-42`)

```
{ href: '/cliente/inicio',      label: 'Inicio' }
{ href: '/cliente/perfil',      label: 'Cuenta', match: ['/cliente/pagos','/cliente/historial','/cliente/ayuda','/cliente/empresas','/cliente/vehiculos','/cliente/intereses'] }
{ href: '/cliente/qr',          label: 'Mi QR',  match: ['/membresia','/mis-membresias','/cliente/mis-promociones'] }
{ href: '/cliente/promociones', label: 'Beneficios' }      ← 5th entry in a "4 destinations" contract
{ href: '/cliente/menu',        label: 'Menú' }
```

Match rule (`destinos-cliente.ts:45-48`): active iff `pathname === base || pathname.startsWith(base + '/')` for the href or any `match` prefix (segment-aware).

### 3.2 Native (`apps/client/src/components/layout/BottomTabDock.tsx:19-34`)

```
{ href: '/(tabs)/inicio', label: 'Inicio', icon: Home }
{ href: '/(tabs)/cuenta', label: 'Cuenta', icon: User, match: ['pagos','historial','ayuda','empresas','vehiculos','intereses'] }
{ href: '/(tabs)/qr',     label: 'Mi QR',  icon: QrCode, match: ['membresia','mis-membresias','mis-promociones'] }
{ href: '/(tabs)/menu',   label: 'Menú',   icon: Menu }
```

Match rule (`BottomTabDock.tsx:37-42`): active iff `pathname === href || pathname.startsWith(href + '/')`, **or** `(match ?? []).some(prefix => pathname.includes(prefix))` — substring anywhere, not segment-bounded.

`apps/client/src/components/layout/TabsEscritorio.tsx:11-31` repeats the **same four entries and the same matcher** with no icons. This is the duplicate-definition finding called out by the plan.

### 3.3 Do they agree? No.

| Aspect | Web | Native | Divergence |
| --- | --- | --- | --- |
| Destination count | 5 (`destinos-cliente.ts:21-42`) | 4 (`BottomTabDock.tsx:19-34`, `TabsEscritorio.tsx:11-24`) | Web has extra `Beneficios` → `/cliente/promociones`; native has none |
| 4th label / target | `Beneficios` → `/cliente/promociones` | `Menú` → `/(tabs)/menu` | Different destination in the same slot |
| `Menú` position | 5th | 4th | Order differs |
| href space | Next paths `/cliente/...` | Expo group paths `/(tabs)/...` | Not interchangeable |
| Active matcher | segment-bounded (`destinos-cliente.ts:46`) | substring `includes()` on bare words (`BottomTabDock.tsx:41`) | A path containing `'pagos'`/`'ayuda'` anywhere activates Cuenta on native but not necessarily on web |
| Duplication | Single module, two readers | Two independent copies | Changing one native copy does not change the other |
| Reference test | Asserts exactly 4 (`tests/cliente-retail.test.ts:23-32`) | No native test | Web code already violates its own test today |

## 4. Route activation rules (which routes get the shell)

### 4.1 Web

- The shell wraps **every** route in the `(cliente)` group, because it is rendered by the group layout `src/app/(cliente)/layout.tsx:65-78`.
- Auth gate: `requireRole('CLIENTE')` at `src/app/(cliente)/layout.tsx:56` (imported `:5`).
- Bypass branch: `x-skip-cliente-auth === '1'` at `layout.tsx:18`; when set, the layout renders a plain landing-style wrapper and **not** `CustomerShell` (`layout.tsx:20-54`). The header is set only for `/cliente/establecer-contrasena` by `src/proxy.ts:75-77`.
- Server-resolved data injected into the shell: `layout.tsx:57-63` (see §7).

### 4.2 Native

- The shell (`HeaderVibe` + `TabsEscritorio` + `BottomTabDock`) wraps **only** the four `(tabs)` routes declared in `apps/client/app/(tabs)/_layout.tsx:23-26`: `inicio`, `qr`, `cuenta`, `menu`.
- Every other native route is a root `Stack` screen (`apps/client/app/_layout.tsx:52-58`) and gets **no** header, dock, or desktop tabs (grep for `HeaderVibe|BottomTabDock` under `apps/client/app` returns only `(tabs)/_layout.tsx`).
- Auth gating native is per-screen client-side, not a route-group guard:
  - `apps/client/app/index.tsx:17` unconditionally `<Redirect href="/(tabs)/inicio" />` (no auth check).
  - Screens redirect when unauthenticated: `buscar.tsx:52-55`, `empresas.tsx:48-51`, `empresas/[companySlug].tsx:77-80`, and render fallbacks at `qr.tsx:32`, `cuenta.tsx:50`, `ayuda.tsx:157`, etc.
  - No CLIENTE role gate exists on native (`isCliente` unused).

## 5. Web shell surfaces (as coded)

| Surface | Site | Target / behaviour |
| --- | --- | --- |
| Search form | `CustomerShell.tsx:45-63` | `<form action="/cliente/buscar" role="search">`, input `name="q"`; Mic at `:62` is decorative |
| Notifications (campana) | `CustomerShell.tsx:64-70` | `<Link href="/cliente/novedades">` |
| Account / avatar | `CustomerShell.tsx:71-81` | `<Link href="/cliente/perfil">`, initials from `layout.tsx:68` |
| Location strip | `CustomerShell.tsx:83-95` | `<Link href="/cliente/cerca">`, label from `zonaLabel` |
| Desktop tabs | `CustomerShell.tsx:97` | `TabsEscritorio` (`lg` visible) |
| Demo banner | `CustomerShell.tsx:100` | `BannerDemo` when `demoNombre` truthy |
| Cart wrapper | `CustomerShell.tsx:102` | `ExcursionCarritoWrapper` around `{children}` |
| Mobile dock | `CustomerShell.tsx:105` | `BottomNav` (`lg:hidden`) |
| Sentry sync | `CustomerShell.tsx:106` | `SentryUserSync` |

Top-level content element: `<main className="con-dock-inferior mx-auto w-full max-w-md px-4 py-4 md:max-w-3xl lg:max-w-7xl lg:px-6">` at `CustomerShell.tsx:101`.

## 6. Native shell surfaces (as coded)

| Surface | Site | Target / behaviour |
| --- | --- | --- |
| Search input | `HeaderVibe.tsx:34-43` | `TextInput`, **no submit handler** (`onSearch` unused) |
| Scanner (QR) | `HeaderVibe.tsx:45-51` | `router.push('/(tabs)/qr')` |
| Notifications (campana) | `HeaderVibe.tsx:53-58` | `TouchableOpacity` with **no `onPress`** — inert |
| Account / avatar | `HeaderVibe.tsx:60-76` | `/(tabs)/cuenta` if `isAuthenticated`, else `/(auth)/login` |
| Location pill | `HeaderVibe.tsx:79-81` → `PillUbicacion.tsx:10-33` | `onPress` never passed — inert; label from `zonaLabel` (never passed ⇒ fallback) |
| Desktop tabs | `(tabs)/_layout.tsx:15` | `TabsEscritorio` at `width >= 768` |
| Mobile dock | `(tabs)/_layout.tsx:29` | `BottomTabDock` below 768 |
| Demo banner | — | **No native equivalent** (grep `BannerDemo` outside web returns nothing in `apps/client`) |
| Cart wrapper | — | **No native equivalent** (grep `ExcursionCarrito|Carrito` in `apps/client` returns no files) |
| Sentry sync | — | **No native equivalent** (grep `Sentry|sentry` in `apps/client` returns no matches) |

## 7. Safe-area reservation rules

### Web

- Token definitions in `src/app/globals.css`:
  - `--dock-inferior: 3.5rem;` → `globals.css:257`
  - `--espacio-dock: calc(var(--dock-inferior) + env(safe-area-inset-bottom, 0px) + 1rem);` → `globals.css:258`
- Utility: `.con-dock-inferior { padding-bottom: var(--espacio-dock); }` → `globals.css:580-582`, with desktop override `@media (min-width: 1024px) { padding-bottom: 2rem; }` → `globals.css:583-587`.
- Applied on the shell `<main>` → `CustomerShell.tsx:101`.
- The dock itself declares the same height variable and the safe-area padding:
  - `style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}` → `BottomNav.tsx:49`
  - `style={{ minHeight: 'var(--dock-inferior)' }}` → `BottomNav.tsx:53`
- The clipped-CTA bug this chain fixes is documented in `globals.css:192-217` and `globals.css:570-579` (the old `pb-24` = 96px underestimated 56px bar + 24-48px gesture inset; the promotion detail CTA "Ver empresa y sus planes" was cut). Guarded by `tests/movil-cliente.test.ts:60-114` (requires `con-dock-inferior`, requires `env(safe-area-inset-bottom` inside the `--espacio-dock:` declaration, requires `--dock-inferior` in `BottomNav`, and forbids any `fixed … bottom-0` in client screens without a safe-area token).

### Native

- There is **no** `--dock-inferior` / `.con-dock-inferior` on native.
- `HeaderVibe` reserves the top inset itself: `style={{ paddingTop: insets.top + 12 }}` → `HeaderVibe.tsx:31`.
- `BottomTabDock` reserves the bottom inset itself: `style={{ paddingBottom: Math.max(insets.bottom, 8) }}` → `BottomTabDock.tsx:51`.
- `BottomTabDock` is rendered in normal flex flow inside the tabs layout (`(tabs)/_layout.tsx:16-29`), not `position: fixed`; content is therefore not padded by the shell — each screen applies its own `useSafeAreaInsets` (78 references across 39 files; e.g. `vehiculos.tsx:21`, `promociones.tsx:48`, `mis-membresias.tsx:99`). The tabs layout's content `View` at `(tabs)/_layout.tsx:16` has no bottom padding.
- `Sheet` also self-reserves safe area: `apps/client/src/components/ui/Sheet.tsx:14` via `useSafeAreaInsets`.

## 8. Platform-specific map boundary

- Route selector: `apps/client/app/cerca.tsx:9` — `export default Platform.OS === 'web' ? CercaWeb : CercaNative`; it statically imports both `./cerca.web` (`:6`) and `./cerca.native` (`:7`). This is the expo-router route `/cerca`.
- Web implementation: `apps/client/app/cerca.web.tsx`
  - Imports `leaflet` types (`:22`) and dynamically `import('leaflet')` + `import('leaflet/dist/leaflet.css')` (`:88-91`, `:127`).
  - Renders into a react-native-web `View` used as a DOM node (`:51` ref, `:95-105`), OSM tile layer at `:107-109`, GPS via `navigator.geolocation` at `:156-168`.
- Native implementation: `apps/client/app/cerca.native.tsx`
  - Static `import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps'` (`:22`), renders `<MapView>`/`<Marker>` at `:217-237`.
  - Header comment: requires a dev build, does not work in Expo Go (`:2-9`); no `expo-location` (`:7-9`, `:72-80`).
- Dependencies: `apps/client/package.json:19` (`leaflet`), `:26` (`react-native-maps`), `:38` (`@types/leaflet`); native plugin config `apps/client/app.json:31-37`.
- Shared **data** layer only: both files use `useGeoCercanos` (`cerca.web.tsx:26`, `cerca.native.tsx:26`) and `useGeoAutocompletar` (`cerca.web.tsx:27`, `cerca.native.tsx:27`); rendering libraries are disjoint.
- Separate web-only Leaflet maps also exist in the Next app (`src/components/geo/MapaCercaDeMi.tsx:3-9` incl. `leaflet.markercluster`, `src/components/geo/MapaConfirmarVivienda.tsx:3-5`, `src/components/admin/MapaUbicacion.tsx:3-5`).
- A single shared implementation is **not** assumed: the two files import disjoint native modules, the native one needs a dev build, and the plan guardrail forbids collapsing them into a lowest-common-denominator implementation (`.omo/plans/cliente-web-to-native-redesign.md:36`).

## 9. Server-side (web) vs client-side (native) location/demo data

### Web — resolved server-side in the route-group layout

- `src/app/(cliente)/layout.tsx:7-8` imports `LocationService` (`@/modules/geo/ubicaciones/service`) and `nombreSiEsDemo` (`@/modules/demo`).
- `layout.tsx:56` `const user = await requireRole('CLIENTE')`.
- `layout.tsx:57-62`:
  - `LocationService.primaria(user.metadata.dbUserId).catch(() => null)` when `dbUserId` exists, else `Promise.resolve(null)`.
  - `nombreSiEsDemo(user.metadata.companyId)`.
- `layout.tsx:63` `const zona = ubicacion?.sector?.name ?? ubicacion?.city?.name ?? null`.
- `layout.tsx:73` passes `zonaLabel={zona}` and `:74` passes `demoNombre={demo ?? null}` into `CustomerShell`; the shell renders the location strip (`CustomerShell.tsx:83-95`) and demo banner (`:100`).
- `LocationService.primaria` definition: `src/modules/geo/ubicaciones/service.ts:43` (method usage inside the service at `:71-144`). Other server callers for reference: `src/app/api/v1/cliente/qr/route.ts:67`, `src/modules/home/lectura.ts:70`, `src/app/api/v1/cliente/ajustes/route.ts:40`, `src/app/(cliente)/cliente/ajustes/page.tsx:72`, `src/app/(cliente)/cliente/qr/page.tsx:224`.

### Native — client-side hooks only; no equivalent shell data

- There is no server layout on native. `HeaderVibe` declares `zonaLabel?` (`HeaderVibe.tsx:11`) and forwards it to `PillUbicacion` (`:80`), but the only caller renders `<HeaderVibe />` with no props (`(tabs)/_layout.tsx:14`), so `zonaLabel` is always `undefined` and `PillUbicacion` shows `'Explorar cerca de ti'` (`PillUbicacion.tsx:23`).
- Native location is per-screen and client-driven inside `cerca`: `useGeoCercanos` with `contexto: 'HOME' | 'CURRENT' | 'MANUAL'` (`cerca.native.tsx:51`, `:61-64`); the "Mi ubicación" action only opens a consent banner, it never acquires GPS (`cerca.native.tsx:72-80`, `:289-312`).
- No native demo banner or `nombreSiEsDemo` consumer exists (grep `nombreSiEsDemo` in `apps/client`: no matches).
- Native profile/demo-adjacent data arrives through BFF-backed client hooks (`usePerfil` at `(tabs)/cuenta.tsx:46`, `useBienvenida` at `bienvenida.tsx:27`, etc.), fetched in the client with `isAuthenticated` gating.

## 10. Refactor-risk ranking (what breaks first in Todo 4)

1. **Destination set divergence (highest).** Web has 5 entries (`destinos-cliente.ts:21-42`) while its own test expects 4 (`tests/cliente-retail.test.ts:23-32`) and native has a different 4 (`BottomTabDock.tsx:19-34`, `TabsEscritorio.tsx:11-24`). Any normalization must pick the canonical destination set first; otherwise at least one platform's navigation and the red test stay wrong.
2. **Dead native shell data plumbing.** `HeaderVibe` never receives `zonaLabel` and `PillUbicacion` never receives `onPress`; the notifications campana also has no handler. Restyling the markup without wiring data leaves these inert.
3. **Header-height / padding coupling.** `BannerDemo` is `sticky top-14` (`BannerDemo.tsx:21`); `InicioRetail.tsx:24` uses a negative margin mirroring the shell padding; `cerca/page.tsx:23` and `buscar/page.tsx:50` replicate it. Changing `CustomerShell` padding or header height misaligns these without any type error.
4. **Active-state matcher semantics.** Web is segment-bounded (`destinos-cliente.ts:46`); native is substring-based (`BottomTabDock.tsx:41`, `TabsEscritorio.tsx:30`). Unifying them can flip which tab is highlighted on routes like `/pagos`-containing paths.
5. **Shell-rendered shared components.** `SentryUserSync` (4 layouts), `BannerDemo` (admin + client), and `ExcursionCarritoWrapper` (public + client) are rendered by the shell but consumed elsewhere; signature changes ripple outside the client area.
6. **Safe-area contract.** The `--dock-inferior`/`--espacio-dock`/`.con-dock-inferior` chain is pinned by `tests/movil-cliente.test.ts:60-114`; changing the variable semantics without updating the guard reintroduces the clipped-CTA regression documented at `globals.css:192-217`.

## 11. Explicit non-findings

- No `.web.tsx` / `.native.tsx` pair exists other than `cerca.web.tsx` / `cerca.native.tsx` (glob over `apps/client/{app,src}` returned one file each).
- The native shell has no tests; the web shell is covered only by static source assertions in `tests/cliente-retail.test.ts` and `tests/movil-cliente.test.ts` (no DOM/render test).
- All shell consumers above are verified by direct file reads and greps; no consumer is described as "probably" or "likely".
