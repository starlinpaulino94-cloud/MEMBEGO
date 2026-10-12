# F8 · Cierre operativo del corte

> Estado: **hecha en código; apagada por defecto, igual que F7.** F7 dejó el corte `membego.com` / `app.membego.com`
> implementado ([F7_CORTE_POR_ANFITRION.md](F7_CORTE_POR_ANFITRION.md)). F8 cierra lo que quedaba abierto para poder encenderlo
> sin sorpresas: el riesgo de las sesiones existentes, el paso de redirección temporal a permanente, y una forma de comprobar
> el resultado contra un despliegue real en vez de a ojo.

## 1 · Sesiones de antes del corte (cookies heredadas)

**El problema.** Hoy la cookie de sesión de Supabase (`sb-<ref>-auth-token`, a veces partida en `.0`, `.1`…) es *host-only* en
`membego.com`. Al activar `NEXT_PUBLIC_COOKIE_DOMAIN`, los inicios de sesión nuevos escriben la misma cookie con
`Domain=.membego.com`, y el navegador guarda **las dos**. Next arma el mapa de cookies de la petición por nombre: si la vieja
trae un trozo (`.1`) que la nueva ya no necesita, el servidor une trozos de dos sesiones distintas y la sesión parece
corrupta. La vieja no sirve para nada (la app vive en otro host y no la recibe).

**La mitigación** (`src/lib/cookies-heredadas.ts`, aplicada en la puerta de `src/proxy.ts`):

- Solo en modo dividido, en los dos hosts de MembeGo y solo si hay dominio de cookie compartido (`sessionCookieDomain()`).
- Si la petición trae cookies de sesión y no trae el marcador `mg_cd`, la respuesta añade un `Set-Cookie` **sin `Domain`** por
  cada una (`Max-Age=0; Path=/`): solo toca la cookie *host-only*, no la compartida. Más un marcador `mg_cd=1` *host-only*
  (un año), de modo que se hace **una vez por navegador y por host**.
- La landing sigue siendo estática: solo responde con cookies quien ya trae sesión, y una sola vez. Un visitante anónimo no
  recibe ninguna (el verificador lo comprueba).
- Va como líneas `Set-Cookie` crudas (`headers.append`): el mapa de cookies de Next va por nombre y no puede representar a la
  vieja y a la compartida a la vez.
- **Interruptor de emergencia:** `ANFITRIONES_LIMPIAR_COOKIES_HEREDADAS=0` la apaga sin tocar código (variable de servidor;
  basta redesplegar, no hace falta reconstruir).

**Efecto para el usuario:** quien tenga hoy una sesión solo de `membego.com` ya no la usaba tras el corte; ahora deja de
arrastrarla. Tendrá que iniciar sesión una vez en `app.membego.com`; a partir de ahí la cookie compartida sirve en los dos hosts.

**Lo que NO está verificado:** E2E (Chromium) comprueba que el borrado sin `Domain` elimina la vieja y conserva la compartida
con el mismo nombre. Un navegador que tratase la *host-only* y la de dominio como la misma cookie borraría también la compartida:
sería un cierre de sesión **una sola vez** (el marcador impide repetirlo). **Probar en Safari y Firefox en staging antes de
producción**; si se comportaran así, apagar con el interruptor y aceptar la convivencia de cookies hasta que caduquen.

Las cookies de atribución (visitante, vendedor, referido, canal) también fueron *host-only* antes del corte, pero son valores
simples sin trozos: la más nueva gana y no hay mezcla posible. No se limpian.

## 2 · Redirección temporal → permanente

El corte arranca con **307** (los buscadores no lo memorizan y la reversa es limpia). Cuando esté estable:

- `ANFITRIONES_REDIRECCION_PERMANENTE=1` (variable de servidor; redesplegar, sin reconstruir) cambia a **308**, que para los
  buscadores equivale a un 301 y conserva el método. Código: `estadoDeRedireccion` en `src/lib/anfitriones.ts`.
- **Los navegadores guardan un 308 casi para siempre.** Si después se quitara el corte, quienes ya recibieron el 308 seguirían
  yendo a `app.membego.com`. Por eso: mantener el 307 al menos **2–4 semanas** de corte estable y sin planes de reversa antes de
  pasar a 308. Con 308 la reversa deja de ser limpia para esos navegadores.

## 3 · Search Console y las URL ya indexadas

- **Propiedad:** la de dominio `membego.com` (verificada por DNS) ya cubre `app.` y la landing. **No hace falta «Cambio de
  dirección»**: el dominio es el mismo. No es necesario crear otra propiedad para `app.`, que no se indexa.
- **Sitemap:** solo lista páginas de la landing, con su origen (el verificador lo comprueba contra la clasificación por host).
  Reenviar `https://membego.com/sitemap.xml` tras el corte.
- **Lo que se espera ver:** las URL de acceso y de app que Google hubiera indexado bajo `membego.com` (`/login`, `/registro`…)
  pasan a «Página con redirección» y, al aterrizar en `app.` con `noindex`, salen del índice. Es lo deseado; no usar la
  herramienta de eliminación de URL.
- **Landing:** las páginas públicas no cambian de host ni de URL. Revisar en el informe de «Páginas» que no aparezcan como
  «Excluida por noindex» (sería una señal de que el `X-Robots-Tag` de la app se está sirviendo en la landing).
- **Plan de 301:** `/empresa/:slug*` → `/empresas/:slug*` (ya existe) viaja con la landing. Las rutas de app que hoy responden en
  el dominio único se redirigen desde la landing a la app, con ruta y consulta intactas (F7), en 307 y luego 308 (apartado 2).

## 4 · El verificador del corte

```
bun run corte:verificar <origen-landing> <origen-app> [--cookie-domain .membego.com] [--permanente] [--via host:puerto]
```

Pregunta a un despliegue real (solo lectura, sin sesión; un POST que no debe desviarse) y sale con código 1 si algo falla:

- **Enrutado:** la landing sirve su portada; lo de la app va a la app con ruta y consulta intactas; la portada de la app va a
  `/login`; lo público va a la landing; un POST no se desvía; el `Host` reenviado no decide el destino.
- **API:** responde en los dos hosts, y la sesión ligera con `no-store`.
- **SEO:** la app con `X-Robots-Tag: noindex` y `Disallow: /`; la landing indexable con su sitemap; canónico de la landing;
  sitemap solo con páginas de la landing.
- **Cookies** (con `--cookie-domain`): la de canal se siembra en el dominio compartido; la sesión heredada se borra una vez y
  deja marcador; una landing anónima no responde con cookies.
- `--permanente` espera 308 en vez de 307. `--via 127.0.0.1:3210` conecta a esa dirección enviando el `Host` y el SNI de cada
  origen: sirve para el arnés local y para probar un despliegue **antes de cambiar el DNS**.

Está probado en `tests/separacion-f8.test.ts` (contra un despliegue simulado con las mismas funciones puras del proxy, y con
mutaciones: detecta cada incumplimiento) y en el E2E de dos anfitriones (contra el servidor real: da 0 fallos, y falla con los
hosts al revés).

## 5 · Staging: cómo ensayar el corte con cookies reales

El dominio compartido **no se aplica en previews**: `sessionCookieDomain()` lo ignora si `VERCEL_ENV` no es `production`
(salvaguarda para que un dominio que no coincide no rompa el login). Así que un *preview* o un entorno personalizado de Vercel
**no sirven** para ensayar las cookies. Lo que sí sirve:

1. Un segundo proyecto de Vercel (con su propio entorno de **Production**) apuntando a esta rama, con dominios reales de
   ensayo, p. ej. `stg.membego.com` y `app.stg.membego.com`.
2. Variables de ese proyecto: `NEXT_PUBLIC_LANDING_URL=https://stg.membego.com`, `NEXT_PUBLIC_APP_ORIGIN=https://app.stg.membego.com`,
   `NEXT_PUBLIC_COOKIE_DOMAIN=.stg.membego.com`, `NEXT_PUBLIC_APP_URL=https://stg.membego.com`, más las de base de datos y
   Supabase **de ensayo** (no las de producción).
3. En el Supabase de ensayo: Redirect URLs con `https://app.stg.membego.com/**` y `https://stg.membego.com/**`.
4. Verificar: `bun run corte:verificar https://stg.membego.com https://app.stg.membego.com --cookie-domain .stg.membego.com`
5. A mano, lo que el script no puede: iniciar sesión en `app.stg` y ver «Ir a mi app» en `stg`; cerrar sesión en uno y ver el
   otro; una sesión **con trozos** (`.0`/`.1`) creada ANTES de activar las variables, y luego tras activarlas; Safari y Firefox;
   un cobro de prueba de punta a punta; correos de confirmación y recuperación.

## 6 · Lista previa al corte de producción

- [ ] Ensayo en staging completo (apartado 5), incluido Safari y Firefox.
- [ ] `https://app.membego.com/**` en las Redirect URLs de Supabase de producción; dominio añadido al proyecto y certificado válido.
- [ ] El DNS y el certificado de `app.membego.com` ya existen **antes** de poner las variables (en cuanto se redesplieguen con ellas,
      el corte está vivo en producción). Mientras el DNS propaga, `--via <ip>` permite verificar sin esperar.
- [ ] Ventana de poco tráfico; las tres variables en Production; redesplegar sin caché.
- [ ] `bun run corte:verificar https://membego.com https://app.membego.com --cookie-domain .membego.com` en verde.
- [ ] Mantener el 307 2–4 semanas; entonces `ANFITRIONES_REDIRECCION_PERMANENTE=1` y verificar con `--permanente`.
- [ ] Reenviar el sitemap en Search Console.

## Verificación (2026-10-12, sobre el árbol de F8)

Local, contra una base desechable y `membego_test`. Sin Supabase real, Vercel, DNS/TLS reales, Safari/Firefox ni pasarela: **no verificados**.

| Verificación | Resultado |
|---|---|
| `tsc --noEmit` / `bun run lint` | limpio / 0 errores |
| `bun run build` (un dominio) y build de dos anfitriones | verdes |
| Unitarias (`bun run test`) | 4063 pruebas: 4056 pasan, 7 saltadas, 0 fallan |
| `tests/separacion-f8.test.ts` | 10/10 |
| E2E de dos anfitriones (`bun run e2e:dos-anfitriones`, móvil y escritorio) | 26/26 (incluye limpieza de cookies heredadas en Chromium y el verificador contra el servidor real) |
| E2E completo con un dominio (`bun run e2e:limpio`) | 334 pasan, 237 saltadas (Supabase real y los specs de dos anfitriones), 0 fallos |
| PostgreSQL (`bun run test:db`) | 653/653 |
| Mutaciones de las guardias nuevas | detectadas: `Domain` en el borrado, sin interruptor de emergencia, 307 fijo, sin marcador |
