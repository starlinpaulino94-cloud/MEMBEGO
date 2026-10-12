# Runbook · Etapa 6 — Corte físico Landing / App (guiado, con verificación)

> Ejecuta esto **tú** en un entorno con navegador: cada paso tiene un
> **checkpoint visual** porque el estilado (Tailwind v4) y la sesión
> (cookies cross-subdominio) no se pueden verificar de forma headless.
> **Para el corte de un proyecto y dos dominios (camino A) usa `docs/F7_CORTE_POR_ANFITRION.md`:** es el runbook vigente, con
> el enrutado por host ya implementado y probado.
>
> El código ya está preparado (abstracción de dominios, `sessionCookieDomain()`,
> manifiesto de UI). **Nada rompe si no defines las envs nuevas.**

Repo actual: Next 16 · **Tailwind v4** (auto-detección, `postcss.config.mjs`) ·
**npm** (`package-lock.json`, sin workspaces) · Sentry en `next.config.ts` ·
alias `@/* → ./src/*`.

---

## Decisión: dos caminos (elige por riesgo)

| | **A · Doble despliegue (recomendado primero)** | **B · Monorepo (decoupling real)** |
|---|---|---|
| Qué es | 2 proyectos de hosting desde el MISMO repo/rama | Turborepo: `apps/landing`, `apps/app`, `packages/ui` |
| Mueve archivos | ❌ No | ✅ Sí (según manifiesto Etapa 3) |
| Riesgo | 🟢 Muy bajo (reversible) | 🟠 Medio (estilado + imports) |
| Logra | Dominios/cookies/escala separados | Además, bundles 100% separados |
| Reversible | Borrar el 2º proyecto | Revertir merge |

**Recomendación:** haz **A ahora** (separación de dominios y sesión con riesgo
casi nulo) y evoluciona a **B** cuando quieras el decoupling total de bundles.

---

## Fase 0 · Preparación (ambos caminos)

1. `git checkout -b separacion/etapa6` y crea un tag de respaldo del estado
   estable actual: `git tag pre-corte-etapa6`.
2. Anota tus envs de producción actuales (Supabase, DATABASE_URL, etc.).
3. **Checkpoint:** el sitio actual funciona en su dominio único. (Baseline.)

---

## CAMINO A · Doble despliegue (sin mover código)

### A1. Segundo proyecto de hosting
- En tu hosting (Vercel/similar), crea un **2º proyecto desde el mismo repo y
  rama**. Ahora tienes dos: `membego-landing` y `membego-app`.

### A2. Dominios
- `membego-landing` → `membego.com` (+ `www` → 301 a apex).
- `membego-app` → `app.membego.com`.

### A3. Variables de entorno (clave)
En **ambos** proyectos, además de las actuales (Supabase, DATABASE_URL…):

```
NEXT_PUBLIC_APP_URL=https://membego.com        # canónico público (OG, share, referidos, emails)
NEXT_PUBLIC_LANDING_URL=https://membego.com
NEXT_PUBLIC_APP_ORIGIN=https://app.membego.com
NEXT_PUBLIC_COOKIE_DOMAIN=.membego.com          # ← habilita SSO entre subdominios
```

> Mantener `NEXT_PUBLIC_APP_URL=https://membego.com` en **ambos** evita migrar
> call-sites: todos los enlaces generados (OG, `/r/[code]`, share, correos)
> siguen apuntando al canónico. El dominio `app.` es una entrada alterna con su
> propio deploy/caché.

### A4. Checkpoints (en navegador, imprescindibles)
- [ ] `membego.com` carga con **estilado correcto** (no hay cambio: mismo build).
- [ ] `app.membego.com` carga con estilado correcto.
- [ ] **Login en `app.membego.com`** → luego abre `membego.com`: **debes seguir
      con sesión** (SSO por cookie `.membego.com`). ✅ es la prueba crítica.
- [ ] **Logout** en un subdominio cierra sesión en el otro.
- [ ] Refrescar tokens no rompe la sesión (navega varias páginas).
- [ ] `/robots.txt` y `/sitemap.xml` responden en `membego.com`.
- [ ] Compartir una promoción (`/promocion/[id]`) muestra la tarjeta OG.

### A5. Rollback A
- Quitar el dominio del 2º proyecto y borrar `NEXT_PUBLIC_COOKIE_DOMAIN`
  (vuelve a cookie host-only). El proyecto original sigue intacto.

---

## CAMINO B · Monorepo Turborepo (decoupling real)

> Hazlo en una rama y **verifica el estilado tras cada paso**. El punto más
> delicado es Tailwind v4 (ver B4).

### B1. Estructura de workspaces (npm)
- Crear `apps/app` y mover el proyecto actual completo ahí (o dejar la app en
  la raíz e ir extrayendo). Estructura objetivo:
  ```
  membego/
    package.json         # workspaces + turbo (raíz)
    turbo.json
    packages/ui/         # design system (manifiesto Etapa 3)
    apps/app/            # Next.js: (auth)(admin)(cliente)(empleado)(superadmin)(onboarding) + api + proxy
    apps/landing/        # Next.js: (public) landing + marketplace + sitemap/robots
  ```
- Raíz `package.json`: `"workspaces": ["apps/*","packages/*"]`, `"packageManager":"npm@..."`.
- `turbo.json` con pipeline `build`/`lint`/`dev`.

### B2. `packages/ui` (según manifiesto Etapa 3 — límite ya certificado limpio)
- Mover `src/components/ui/*` (27) a `packages/ui/src/`.
- Mover el helper **`cn`** ahí (separar de `safeInternalPath`, que se queda en la
  app). `packages/ui` depende solo de: `react`, `@radix-ui/*`, `lucide-react`,
  `class-variance-authority`, `clsx`, `tailwind-merge`, `sonner`, `cmdk`,
  `@tanstack/react-table` (solo `data-table`).
- Exponer `@membego/ui` (package name) con exports por componente.
- Reemplazar en ambas apps `@/components/ui/x` → `@membego/ui` (mecánico).

### B3. Repartir rutas (según mapa Etapa 2)
- `apps/landing`: grupo `(public)` (Home, empresas, promociones, plan, i,
  registro-empresa, contact, terms, privacy, caracteristicas, faq, descargar,
  blog) + `sitemap.ts` + `robots.ts` + capa read-only de marketplace queries.
- `apps/app`: todo lo autenticado + `api/*` + `proxy.ts` + `auth/callback` +
  `confirmar` + `r/[code]` + `invitacion/[token]`.
- Duplicar el `layout.tsx` raíz en ambas (fonts, ThemeProvider, Toaster). El
  **JSON-LD + metadata SEO** va SOLO en la landing.

### B4. ⚠️ Tailwind v4 — el punto crítico de estilado
- Tailwind v4 **auto-detecta** el contenido del proyecto, pero **NO escanea
  `packages/ui`** por defecto. En el `globals.css` de **cada app** añade:
  ```css
  @import "tailwindcss";
  @source "../../packages/ui/src";   /* ← imprescindible o el UI sale sin estilos */
  ```
- Copia los tokens `@theme`/variables de `globals.css` a ambas apps (o a un
  `packages/config/globals.css` compartido importado por ambas).
- **Checkpoint:** abre cada app en el navegador y confirma que **botones,
  cards y colores** se ven idénticos. Si algo sale “en crudo”, falta `@source`.

### B5. Config por app
- `postcss.config.mjs`, `tsconfig.json` (alias `@/* → ./src/*` local por app;
  `@membego/ui` vía workspace), `next.config.ts` (Sentry, headers/CSP,
  redirects) en cada app. La landing puede omitir Supabase/proxy.

### B6. Envs por app
- `apps/landing`: `NEXT_PUBLIC_APP_URL=https://membego.com`,
  `NEXT_PUBLIC_LANDING_URL`, `NEXT_PUBLIC_APP_ORIGIN`,
  `NEXT_PUBLIC_COOKIE_DOMAIN=.membego.com`. **Sin** `service_role` ni
  `SENTRY_AUTH_TOKEN`.
- `apps/app`: mismas de dominio + Supabase completas + `NEXT_PUBLIC_COOKIE_DOMAIN`.

### B7. Cross-links (migrar call-sites — ahora sí)
- Enlaces a login/registro desde la landing → `appUrlFor('/login')`,
  `appUrlFor('/registro')`.
- Logout/marca en la app → `landingUrlFor('/')`.
- Revisar `/r/[code]` e `/i/[code]`: decidir su dominio (recomendado: app) y usar
  `appUrlFor`. Share/OG/QR: `landingUrlFor` para recursos públicos.

### B8. 301 y SEO (ver Etapa 5)
- Conservar paths/slugs. 301 desde la landing hacia `appUrlFor(path)` para rutas
  de app que antes vivían en el dominio único. Registrar ambos dominios en
  Search Console; reenviar sitemaps.

### B9. Checkpoints B (navegador)
- [ ] Estilado idéntico en ambas apps (Tailwind `@source` OK).
- [ ] Login/refresh/logout cross-subdominio.
- [ ] Marketplace SEO: canónicos apuntan a `membego.com`.
- [ ] OG/share/QR/referidos resuelven al dominio correcto.
- [ ] Escáner (cámara + lector) funciona en la app.
- [ ] `npm run build` verde en ambas apps; Sentry sube sourcemaps solo en la app.

### B10. Rollback B
- Revertir el merge de la rama (`pre-corte-etapa6`). Los dominios vuelven al
  proyecto único.

---

## Orden recomendado

1. **Camino A** (dominios + cookie SSO) → verifica los checkpoints A4. Ya tienes
   separación de dominios y sesión con riesgo mínimo.
2. Cuando quieras decoupling total de bundles, ejecuta **Camino B** en rama, con
   foco en el checkpoint de Tailwind (B4).
3. **Etapa 7**: cross-links definitivos + QA + Search Console.

## Invariante
DB, Prisma, Supabase, auth, membresías, promociones, referidos, Growth, scanner
y reglas **no cambian**. Esto es organización, dominios y despliegue.
