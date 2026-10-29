# F7 · El corte `membego.com` / `app.membego.com`

> Estado: **código listo y apagado por defecto** (F8 cierra los cabos operativos: [F8_CIERRE_DEL_CORTE.md](F8_CIERRE_DEL_CORTE.md)). Un solo proyecto de Vercel sirve los dos dominios (opción A). Mientras las
> tres variables del corte no estén definidas, el comportamiento es el de siempre: ninguna petición se redirige, los enlaces
> entre «dominios» son relativos y las cookies son *host-only*. Cortar es poner las variables y el DNS; volver atrás es
> quitarlas. Complementa `docs/SEPARACION_LANDING_APP.md` (la separación funcional, F0 a F6) y
> `docs/RUNBOOK_ETAPA6_CORTE_FISICO.md` (el camino A original, que este documento concreta).

## Decisiones

| Tema | Decisión |
|---|---|
| Forma | Un proyecto, dos dominios. El proxy decide qué host sirve cada ruta (`src/lib/anfitriones.ts`, `src/proxy.ts`). |
| Hosts | `membego.com` (landing) y `app.membego.com` (app). |
| Enlaces compartidos | `/e`, `/r`, `/i`, `/invita`, `/invitar` se quedan en la landing: están impresos y en QR. Desde ahí llevan a la app. |
| API | `/api` responde en **los dos** hosts: la app móvil no cambia y la landing consulta su sesión ligera en su propio origen. |
| Cómo se activa | `NEXT_PUBLIC_LANDING_URL`, `NEXT_PUBLIC_APP_ORIGIN` y `NEXT_PUBLIC_COOKIE_DOMAIN`. Sin los dos primeros (o con el mismo host) no hay modo dividido. |
| Redirecciones | 307, solo GET y HEAD, y el destino se arma **siempre** con los orígenes configurados, nunca con el `Host` de la petición. |
| Portada de la app | `app.membego.com/` redirige a `/login`. |
| SEO | `app.` no se indexa (`X-Robots-Tag: noindex, nofollow` y `robots.txt` con `Disallow: /`); canónicos, `metadataBase`, sitemap y `robots` de la landing salen de `landingUrl()`. |

## Qué ruta es de quién

Solo cuenta el primer segmento de la ruta, y `tests/separacion-f7.test.ts` comprueba que coincide con la clasificación por
espacios de F6 ruta por ruta.

- **Landing:** `/`, `empresas`, `catalogo`, `ofertas`, `oferta`, `promociones`, `promocion`, `plan`, `excursiones`, `blog`,
  `caracteristicas`, `contact`, `descargar`, `eliminar-cuenta`, `faq`, `privacy`, `terms`, `registro-empresa`,
  `solicitud-empresa`, `i`, `e`, `r`, `invita`, `invitar`.
- **App:** `login`, `acceso`, `registro`, `recuperar`, `actualizar-password`, `confirmar`, `auth`, `sso`, `invitacion`,
  `cliente`, `mis-membresias`, `membresia`, `admin`, `superadmin`, `empleado`, `vendedor`, `onboarding`.
- **Ambos:** `/api`, `/_next`, `/monitoring`, `/offline`, `/og` y los estáticos. Lo que no esté clasificado se deja pasar: ante
  la duda no se redirige.

## Qué cambió en el código

- **Enlaces de la landing a la app:** pasan por `haciaLaApp(...)` / `irALaApp(...)` (o por el traspaso, que lo hace por dentro).
  Una prueba falla si aparece un `href="/login"`, `router.push('/cliente…')` o equivalente escrito a mano en la landing.
- **URL absolutas de servidor (correos, avisos, acciones, trabajos):** ~49 sitios clasificados y movidos a `appUrlFor(...)` o
  `landingUrlFor(...)` según a quién apunten. Ninguna lee ya `NEXT_PUBLIC_APP_URL` directamente (solo `getAppUrl` en
  `src/lib/site.ts` y el CORS móvil).
- **Cookies que cruzan de un dominio al otro:** visitante, vendedor, referido y canal se fijan con
  `dominioDeCookieCompartida()`. Sin eso, `/e/…` o `/r/…` (en la landing) sembrarían cookies que la app no ve y la
  atribución se perdería justo al registrarse.
- **Celebración de bienvenida:** `sessionStorage` no cruza orígenes. Con dos dominios la landing deja los datos en una cookie
  de 2 minutos en el dominio compartido y la app la consume (`src/lib/celebracion-entre-dominios.ts`). Con uno, `sessionStorage`
  como siempre.
- **SEO por host:** `layout.tsx` (`metadataBase`), `sitemap.ts` y `robots.ts` usan `landingUrl()`. `robots.ts` solo es dinámico
  (lee el host) en modo dividido.
- **`public/robots.txt` eliminado.** Un archivo estático gana a `src/app/robots.ts`, así que el `robots.ts` (con sus reglas
  más completas) **nunca se servía**, y `app.` habría seguido sin `Disallow: /`. Lo encontró el E2E de dos anfitriones. Efecto en
  un solo dominio: el `robots.txt` pasa a ser el de `robots.ts` (mismos permisos a Googlebot/Bing/Twitter/Meta; además
  bloquea `/login`, `/acceso`, `/recuperar`, `/actualizar-password`, `/confirmar`, `/auth`, `/mis-membresias`, `/membresia`
  y `/onboarding`; `/r`, `/i`, `/invita` e `/invitar` siguen abiertos a propósito para las vistas previas de WhatsApp/Meta).
- **CORS móvil:** `mobile-cors.ts` admite el origen de la landing y el de la app además de los configurados.
- **QStash:** los trabajos vuelven por `/api` al origen de la app (`QSTASH_TARGET_URL` sigue mandando si existe).

## Revisado y sin cambios

- **CSP:** `default-src 'self'`; `connect-src 'self'` basta porque la sesión ligera de la landing se consulta en su propio
  origen (`/api` responde en ambos); `form-action 'self'` basta porque ningún formulario de la landing envía a la app (el
  login y el registro viven en la app). No hay `frame-ancestors` ni `navigate-to` que ajustar.
- **PWA (`public/manifest.json`):** `start_url: "/cliente/inicio"` y `scope: "/"` son relativos al origen desde el que se
  instala. Instalada desde la landing, el proxy manda esa ruta a `app.`; sin sesión, al login. La portada abierta en modo
  standalone también cede el paso a la app (`AbrirAppSiEstaInstalada`).
- **Cookie de sesión de Supabase:** `NEXT_PUBLIC_COOKIE_DOMAIN` ya estaba cableado en los cuatro puntos que fijan la cookie
  (`sessionCookieDomain()`), con salvaguardas para no aplicarlo en previews ni en hosts que no pertenezcan al dominio.

## Runbook de corte

> Hazlo en una ventana de poco tráfico. Las variables `NEXT_PUBLIC_*` se **incrustan al construir**: cambiarlas exige
> redesplegar, no basta con guardarlas.

### 0 · Antes (nada cambia para los usuarios)

1. En Vercel, añadir `app.membego.com` al **mismo proyecto** y crear el registro DNS que indique. Esperar al certificado.
2. En Supabase (Auth → URL Configuration): añadir `https://app.membego.com/**` a **Redirect URLs** (los enlaces de
   confirmación, recuperación e invitación pasan a nacer en `app.`). Dejar `https://membego.com/**`. El **Site URL** puede seguir
   siendo `https://membego.com` durante el corte.
3. Con las variables aún sin definir, `app.membego.com` debe comportarse como un alias del dominio de siempre. Comprobarlo.
4. Si se usa `QSTASH_TARGET_URL` o `CLIENT_APP_ORIGINS`, revisar que siguen apuntando a un host que existe después del corte.
5. Pasos de la pasarela de pago (CardNET): el cobro vive en `/cliente/...` (host de la app). Confirmar con ellos si su lista de
   retornos permitidos es por dominio; si lo es, añadir `app.membego.com`.

### 1 · El corte

En **Production** (no en Preview ni en Development):

```
NEXT_PUBLIC_LANDING_URL=https://membego.com
NEXT_PUBLIC_APP_ORIGIN=https://app.membego.com
NEXT_PUBLIC_COOKIE_DOMAIN=.membego.com
```

`NEXT_PUBLIC_APP_URL` se queda como está (`https://membego.com`). Redesplegar **sin caché de build**.

### 2 · Verificación inmediata

Primero, automática: `bun run corte:verificar https://membego.com https://app.membego.com --cookie-domain .membego.com`
(ver [F8_CIERRE_DEL_CORTE.md](F8_CIERRE_DEL_CORTE.md)). Después, a mano:

- [ ] `https://membego.com/` carga la landing; `https://membego.com/login` → 307 a `https://app.membego.com/login`.
- [ ] `https://app.membego.com/` → 307 a `/login`; `https://app.membego.com/promociones` → 307 a `https://membego.com/promociones`.
- [ ] `https://app.membego.com/robots.txt` dice `Disallow: /`; `https://membego.com/robots.txt` enlaza `https://membego.com/sitemap.xml`.
- [ ] Respuestas de `app.` llevan `X-Robots-Tag: noindex, nofollow`; las de `membego.com`, no.
- [ ] Login en `app.membego.com` y luego abrir `membego.com`: la barra ofrece «Ir a mi app» (cookie `.membego.com` compartida).
- [ ] Cerrar sesión en la app y refrescar la landing: vuelve a «Ingresar».
- [ ] Enlace `/e/<slug>` y `/r/<código>` reales: aterrizan en la landing y, al registrarse, la atribución (vendedor, referido,
      canal) llega a la app. Revisar `Set-Cookie`: `Domain=.membego.com`.
- [ ] Correo de recuperación y de confirmación: el enlace nace en `app.membego.com` y funciona.
- [ ] Compartir un enlace de promoción por WhatsApp: la tarjeta muestra imagen (`og:image` absoluta en `membego.com`).
- [ ] La app móvil inicia sesión y consulta datos (la API responde en ambos hosts).
- [ ] Un pago de prueba de membresía de punta a punta.

### 3 · Reversa

1. Borrar las tres variables en Production y redesplegar sin caché. Vuelve el comportamiento de un solo dominio.
2. `app.membego.com` puede quedarse en el proyecto: sin las variables es un alias inocuo. Quitarlo es opcional.
3. Las cookies ya fijadas en `.membego.com` siguen siendo válidas en `membego.com`.

## Riesgos conocidos

- **Sesiones existentes al cortar.** Quien tenga una sesión *host-only* en `membego.com` no la llevará a `app.membego.com`
  (esa cookie no se envía al otro host): tendrá que iniciar sesión una vez. **Mitigado en F8:** el proxy borra esas cookies
  heredadas una vez por navegador y host, para que no convivan con la compartida ni mezclen trozos
  ([F8_CIERRE_DEL_CORTE.md](F8_CIERRE_DEL_CORTE.md#1--sesiones-de-antes-del-corte-cookies-heredadas)). Falta verificarlo en Safari y
  Firefox en staging.
- **Lo que este trabajo no puede probar** (se probó con dos dominios de prueba `membego.test` / `app.membego.test` sobre HTTP
  local): DNS y TLS reales de Vercel, la lista de Redirect URLs de Supabase real, cookies `Secure` bajo HTTPS, Safari/ITP con
  cookies de dominio compartido, la pasarela de pago real y la app móvil publicada.
- **`robots.txt`:** cambia el contenido incluso con un solo dominio (ver arriba). Es deliberado.
- **Caché de la landing:** sigue siendo estática; el modo dividido no la vuelve dinámica. Solo `robots.txt` pasa a leer el host,
  y solo cuando las variables están puestas.

## Cómo se prueba

- **Unitarias (`tests/separacion-f7.test.ts`):** la decisión de host contra todas las rutas de la tabla de F6 (sin bucles ni
  redirección abierta), los enlaces, las cookies compartidas, las clasificaciones de URL absolutas de servidor, la ausencia de
  `public/robots.txt` y el SEO por host.
- **E2E de dos anfitriones (`tests/e2e/separacion-f7.spec.ts`):** `bun run e2e:dos-anfitriones` construye en `.next-f7` con las
  variables del corte, arranca `next start` y corre Chromium con `--host-resolver-rules` para resolver `membego.test` y
  `app.membego.test` a este equipo (sin tocar `/etc/hosts`). Con `-- --sin-build` reutiliza el build.
  Las pruebas HTTP fijan el `Host` a mano (`pedir(...)`): el cliente de Node no ve los dominios de prueba.

## Verificación (2026-10-12, sobre el árbol de F7)

Local, contra una base desechable y `membego_test`. Sin Supabase real, Vercel, DNS/TLS reales, CardNET ni equipos físicos: **no verificados**.

| Verificación | Resultado |
|---|---|
| `tsc --noEmit` | limpio |
| `bun run lint` | 0 errores (los avisos son preexistentes) |
| `bun run build` (un dominio) y build de dos anfitriones (`.next-f7`) | verdes |
| Unitarias (`bun run test`) | 4053 pruebas: 4045 pasan, 7 saltadas, 1 falla ajena a F7: `excursiones-combos-metas` fija el lunes `2026-10-12` y el día de la corrida esa hora de hoy ya pasó; el archivo no se tocó respecto a `main` |
| `tests/separacion-f7.test.ts` | 17/17 |
| E2E de dos anfitriones (`bun run e2e:dos-anfitriones`, móvil y escritorio) | 20/20 |
| E2E completo con un dominio (`bun run e2e:limpio`) | 334 pasan, 231 saltadas (las que exigen Supabase real y el spec de dos anfitriones), 0 fallos |
| PostgreSQL (`bun run test:db`) | 652/653; la que falló (`supply-v2-slice9`, «el worker reclama y muere…») pasa sola 85/85: intermitencia de temporización de la suite completa, independiente de F7 |
| Mutaciones de las guardias nuevas | detectadas: quitar el dominio compartido de las cookies de `/e`, mandar `/registro` a la landing, devolver `public/robots.txt`, escribir `href="/login"` a mano en la landing, armar el destino con el `Host` |

Hallazgo del propio E2E: `public/robots.txt` tapaba a `src/app/robots.ts` (ver arriba).
