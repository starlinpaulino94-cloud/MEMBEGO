/**
 * LIMPIEZA DE DATOS PERSONALES ANTES DE ENVIARLOS A SENTRY
 * (auditoría de producción · A-09, Fase 6).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ FALTABA
 *
 * Los dos `beforeSend` que había —uno en el servidor, otro en el navegador—
 * borraban las cabeceras `Authorization` y `Cookie`. Eso está bien y no basta,
 * porque los secretos y los datos personales de MembeGo viajan además por otras
 * tres vías que quedaban abiertas:
 *
 *  · LA URL. `/?pase=<MANTENIMIENTO_PASE>` (Fase 5), `/confirmar?token=…`,
 *    `/r/<codigo>`. Sentry guarda la URL completa de cada error.
 *  · `event.user`. El SDK rellena `email` en cuanto identificas al usuario, y
 *    ese campo se queda en el panel de errores durante meses.
 *  · Las migas de pan (`breadcrumbs`) de navegación, que son URLs otra vez.
 *
 * Nada de esto es una brecha: es la forma normal en que los datos personales
 * se van acumulando en un sitio donde nadie pensó que estarían.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ SE CONSERVA, Y POR QUÉ IMPORTA
 *
 * El `id` del usuario SÍ se conserva. Sin él, "este error le pasa siempre a la
 * misma persona" deja de ser una frase que se pueda decir, y ese dato es la
 * mitad de los diagnósticos. Un id opaco no dice quién es nadie salvo para
 * quien ya tiene acceso a la base — que es exactamente quien está depurando.
 *
 * Las rutas también se conservan enteras: saber que el error ocurre en
 * `/empleado/scanner` y no en `/cliente/inicio` es el dato. Lo que se va es la
 * parte de después del `?`.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Parámetros cuyo valor no puede salir del servidor bajo ningún concepto. */
const PARAMS_PROHIBIDOS = [
  'pase', // modo mantenimiento (Fase 5)
  'token',
  'access_token',
  'refresh_token',
  'code',
  'secret',
  'apikey',
  'api_key',
  'email',
  'correo',
  'telefono',
  'password',
]

const REEMPLAZO = '[oculto]'

/**
 * Quita de una URL los parámetros sensibles, conservando el resto.
 *
 * Se conserva la ruta y los parámetros inocuos (`?page=2`) porque son útiles
 * para depurar. Acepta URLs relativas.
 */
export function limpiarUrl(url: string): string {
  try {
    // `base` ficticia para poder parsear rutas relativas. No sale a ningún
    // sitio: solo se usa para volver a serializar.
    const u = new URL(url, 'https://membego.invalid')
    let tocada = false
    for (const p of PARAMS_PROHIBIDOS) {
      if (u.searchParams.has(p)) {
        u.searchParams.set(p, REEMPLAZO)
        tocada = true
      }
    }
    if (!tocada) return url
    const limpia = url.startsWith('http') ? u.toString() : `${u.pathname}${u.search}${u.hash}`
    return limpia
  } catch {
    // Si no se puede parsear, se corta en el `?`. Perder los parámetros es
    // aceptable; dejarlos pasar sin mirar, no.
    const i = url.indexOf('?')
    return i === -1 ? url : `${url.slice(0, i)}?${REEMPLAZO}`
  }
}

/** Tipo mínimo del evento de Sentry que aquí se toca. */
export interface EventoSentry {
  request?: {
    url?: string
    query_string?: unknown
    headers?: Record<string, unknown>
    cookies?: unknown
    data?: unknown
  }
  user?: Record<string, unknown>
}

/**
 * Limpia un evento antes de enviarlo. Se llama desde los dos `beforeSend`
 * —servidor y navegador— para que la política sea UNA y no dos que se
 * desincronizan a los seis meses.
 */
export function limpiarEvento<T extends EventoSentry>(evento: T): T {
  if (evento.request) {
    if (evento.request.headers) {
      for (const clave of Object.keys(evento.request.headers)) {
        const k = clave.toLowerCase()
        if (
          k === 'authorization' ||
          k === 'cookie' ||
          k === 'x-metricas-secret' ||
          k === 'x-health-secret' ||
          k === 'x-bootstrap-secret' ||
          k === 'upstash-signature'
        ) {
          delete evento.request.headers[clave]
        }
      }
    }
    // Las cookies llevan el token de sesión de Supabase y el pase de
    // mantenimiento. Enteras fuera: no hay ninguna que valga para depurar.
    delete evento.request.cookies
    if (typeof evento.request.url === 'string') {
      evento.request.url = limpiarUrl(evento.request.url)
    }
    // `query_string` es la misma información otra vez, por si el SDK la
    // rellenó aparte.
    if (evento.request.query_string) evento.request.query_string = REEMPLAZO
  }

  if (evento.user) {
    // Se conserva `id` (ver la cabecera). Todo lo demás identifica a una
    // persona y no ayuda a arreglar el error.
    for (const clave of Object.keys(evento.user)) {
      if (clave !== 'id') delete evento.user[clave]
    }
  }

  return evento
}

/** Miga de pan con la URL ya limpia. */
export function limpiarMiga<T extends { data?: Record<string, unknown> }>(miga: T): T {
  if (miga.data && typeof miga.data.url === 'string') {
    miga.data.url = limpiarUrl(miga.data.url)
  }
  if (miga.data && typeof miga.data.to === 'string') {
    miga.data.to = limpiarUrl(miga.data.to)
  }
  if (miga.data && typeof miga.data.from === 'string') {
    miga.data.from = limpiarUrl(miga.data.from)
  }
  return miga
}
