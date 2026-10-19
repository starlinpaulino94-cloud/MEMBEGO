/**
 * LOS DOS ANFITRIONES: `membego.com` (landing) y `app.membego.com` (app) — separación landing/app · F7.
 *
 * Un solo proyecto sirve los dos dominios. Este módulo PURO decide, para una petición, si la ruta pertenece a ese host o
 * al otro (y entonces se redirige), y arma los enlaces entre dominios. No lee nada del servidor: recibe el host, la ruta y
 * los orígenes configurados, así que lo usan el proxy, los componentes de cliente y las pruebas.
 *
 * ── APAGADO POR DEFECTO ──────────────────────────────────────────────────────────────────────────────────────────────
 * El modo dividido solo existe si `NEXT_PUBLIC_LANDING_URL` y `NEXT_PUBLIC_APP_ORIGIN` están definidos y son hosts
 * DISTINTOS. Sin ellos —local, previews, hoy en producción— nada cambia: ninguna petición se redirige y los enlaces
 * entre dominios son relativos. El corte es poner las variables (y el DNS); la reversa, quitarlas.
 *
 * ── QUÉ RUTA ES DE QUIÉN ─────────────────────────────────────────────────────────────────────────────────────────────
 * Sale de la clasificación por espacios de F6 (`scripts/docs/rutas-por-espacio.ts`), y `tests/separacion-f7.test.ts`
 * comprueba que coincide con ella ruta por ruta. Solo cuenta el PRIMER segmento de la ruta:
 *   · landing: la consulta pública, los enlaces compartidos (`/e`, `/r`, `/i`, `/invita`, `/invitar`) y la portada;
 *   · app: acceso, `/cliente`, paneles, `/mis-membresias` y `/membresia`;
 *   · ambos: `/api` (la app móvil y la sesión ligera de la landing), `/_next`, `/monitoring`, `/offline`, `/og` y los
 *     estáticos. Lo que no esté clasificado se deja pasar: ante la duda no se redirige.
 */

export type Anfitrion = 'landing' | 'app'
export type AnfitrionDeRuta = Anfitrion | 'ambos'

const DE_LA_LANDING = new Set([
  'empresas', 'catalogo', 'ofertas', 'oferta', 'promociones', 'promocion', 'plan', 'excursiones', 'blog', 'caracteristicas',
  'contact', 'descargar', 'eliminar-cuenta', 'faq', 'privacy', 'terms', 'registro-empresa', 'solicitud-empresa',
  // Enlaces que la gente comparte o imprime (QR): siguen en el dominio de siempre y desde ahí llevan a la app.
  'i', 'e', 'r', 'invita', 'invitar',
])

const DE_LA_APP = new Set([
  'login', 'acceso', 'registro', 'recuperar', 'actualizar-password', 'confirmar', 'auth', 'sso', 'invitacion',
  'cliente', 'mis-membresias', 'membresia', 'admin', 'superadmin', 'empleado', 'vendedor', 'onboarding',
  // El comprobante de pago que la app abre en el navegador con un enlace firmado: lo construye `appUrlFor`.
  'comprobante',
])

/** Qué host sirve una ruta. La portada (`/`) es de la landing. */
export function anfitrionDeRuta(ruta: string): AnfitrionDeRuta {
  const segmento = ruta.split(/[?#]/)[0].split('/').filter(Boolean)[0]
  if (segmento === undefined) return 'landing'
  if (DE_LA_LANDING.has(segmento)) return 'landing'
  if (DE_LA_APP.has(segmento)) return 'app'
  return 'ambos'
}

/** Los orígenes de cada dominio, o `null` si el modo dividido no está activo. */
export interface Anfitriones {
  readonly landing: string
  readonly app: string
}

function origenValido(crudo: string | undefined): URL | null {
  const texto = crudo?.trim()
  if (!texto) return null
  try {
    const url = new URL(texto)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

/** El modo dividido: ambos orígenes definidos, válidos y con host distinto. En cualquier otro caso, `null`. */
export function anfitrionesDe(landingUrl: string | undefined, appOrigen: string | undefined): Anfitriones | null {
  const landing = origenValido(landingUrl)
  const app = origenValido(appOrigen)
  if (!landing || !app || landing.host === app.host) return null
  return { landing: landing.origin, app: app.origin }
}

/** Los anfitriones del entorno. Las lecturas son literales para que Next las incruste también en el navegador. */
export function anfitrionesDelEntorno(): Anfitriones | null {
  return anfitrionesDe(process.env.NEXT_PUBLIC_LANDING_URL, process.env.NEXT_PUBLIC_APP_ORIGIN)
}

/** ¿Qué anfitrión es ESTE host? `null` si no es ninguno de los dos (localhost, previews de Vercel…): ahí no se hace nada. */
export function anfitrionDelHost(host: string | null | undefined, anfitriones: Anfitriones | null): Anfitrion | null {
  if (!anfitriones || !host) return null
  const limpio = host.trim().toLowerCase()
  if (limpio === new URL(anfitriones.app).host) return 'app'
  if (limpio === new URL(anfitriones.landing).host) return 'landing'
  return null
}

export type Decision = { accion: 'seguir' } | { accion: 'redirigir'; destino: string }

/**
 * ¿Esta petición va a este host o hay que mandarla al otro? El destino se arma SIEMPRE con los orígenes configurados,
 * nunca con el `Host` de la petición: no hay forma de usarlo como redirección abierta. Solo se redirige GET y HEAD (una
 * acción de servidor o un POST que lleguen al host equivocado no se desvían a ciegas). La portada del host de la app no
 * es de nadie: manda al acceso.
 */
export function decidirAnfitrion(entrada: { host: string | null | undefined; ruta: string; busqueda?: string; metodo?: string }, anfitriones: Anfitriones | null): Decision {
  const aqui = anfitrionDelHost(entrada.host, anfitriones)
  if (!anfitriones || !aqui) return { accion: 'seguir' }
  const metodo = (entrada.metodo ?? 'GET').toUpperCase()
  if (metodo !== 'GET' && metodo !== 'HEAD') return { accion: 'seguir' }
  const busqueda = entrada.busqueda ?? ''
  if (aqui === 'app' && (entrada.ruta === '/' || entrada.ruta === '')) return { accion: 'redirigir', destino: `${anfitriones.app}/login` }
  const deLaRuta = anfitrionDeRuta(entrada.ruta)
  if (deLaRuta === 'ambos' || deLaRuta === aqui) return { accion: 'seguir' }
  const origen = deLaRuta === 'app' ? anfitriones.app : anfitriones.landing
  return { accion: 'redirigir', destino: `${origen}${entrada.ruta}${busqueda}` }
}

/**
 * El código de la redirección entre hosts: 307 (temporal) mientras se valida el corte —un buscador no la memoriza y la reversa
 * es limpia— y 308 (permanente, igual que un 301 para los buscadores pero conserva el método) cuando el corte ya es estable.
 */
export function estadoDeRedireccion(permanente: boolean): 307 | 308 {
  return permanente ? 308 : 307
}

/** Cabeceras que el host añade a sus respuestas: la app no se indexa. */
export function cabecerasDelAnfitrion(host: string | null | undefined, anfitriones: Anfitriones | null): Record<string, string> {
  return anfitrionDelHost(host, anfitriones) === 'app' ? { 'X-Robots-Tag': 'noindex, nofollow' } : {}
}

/** Un enlace a una ruta de la APP: absoluto en el modo dividido (desde la landing), relativo si no. */
export function haciaLaApp(ruta: string, anfitriones: Anfitriones | null = anfitrionesDelEntorno()): string {
  return anfitriones ? `${anfitriones.app}${ruta.startsWith('/') ? ruta : `/${ruta}`}` : ruta
}

/** Un enlace a una ruta de la LANDING: absoluto en el modo dividido (desde la app), relativo si no. */
export function haciaLaLanding(ruta: string, anfitriones: Anfitriones | null = anfitrionesDelEntorno()): string {
  return anfitriones ? `${anfitriones.landing}${ruta.startsWith('/') ? ruta : `/${ruta}`}` : ruta
}

/**
 * Navegar a una ruta de la APP desde código de cliente de la landing (después de registrarse, por ejemplo). Con un solo
 * dominio es la navegación de siempre (`router.push` / `router.replace`, sin recarga); con los dos dominios es una
 * navegación completa al otro host, que es lo único que cruza la frontera de sesión sin arrastrar la caché del cliente.
 */
export function irALaApp(
  router: { push: (ruta: string) => void; replace: (ruta: string) => void },
  ruta: string,
  opciones: { reemplazar?: boolean } = {},
  anfitriones: Anfitriones | null = anfitrionesDelEntorno()
): void {
  if (!anfitriones) {
    if (opciones.reemplazar) router.replace(ruta)
    else router.push(ruta)
    return
  }
  const destino = haciaLaApp(ruta, anfitriones)
  if (opciones.reemplazar) window.location.replace(destino)
  else window.location.assign(destino)
}
