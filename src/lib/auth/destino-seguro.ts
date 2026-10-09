import { ROUTE_PROTECTION, type AppRole } from '@/types'

/**
 * DESTINOS DE RETORNO: `?redirect=` (login) y `?next=` (registro).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UN ÚNICO VALIDADOR
 *
 * Esos dos parámetros los pone cualquiera en un enlace. Si el sistema los
 * obedece a ciegas, el login se vuelve un trampolín de phishing: la víctima ve
 * el dominio de MembeGo, se autentica de verdad y acaba en la página del
 * atacante creyendo que sigue dentro. Antes cada pantalla (proxy, login,
 * registro con asistente, registro clásico) tenía su propia comprobación de
 * «empieza por / y no por //», y el registro clásico general ni la tenía.
 *
 * Aquí viven las reglas, una vez:
 *
 *   1. Solo rutas internas: empieza por UNA barra; sin esquema, sin `\`, sin
 *      caracteres de control, ni escritos ni decodificados.
 *   2. Se normaliza con el analizador de URL (resuelve `/a/../b`, `%2e%2e`)
 *      y se comprueba que sigue siendo del mismo origen.
 *   3. Solo rutas AUTORIZADAS: los espacios de la aplicación y las páginas
 *      públicas de consulta. Nunca las del propio flujo de acceso (`/login`,
 *      `/registro`, `/recuperar`…): un destino que vuelve al login es un bucle.
 *   4. Con el rol a la vista, un destino de un espacio que ese rol no puede
 *      abrir (un administrador con `?redirect=/cliente/carrito`) se descarta y
 *      se usa su casa: no se le manda a un flujo que no le corresponde.
 *
 * Es un módulo PURO (solo importa los tipos de rutas): lo usan el proxy, las
 * acciones de servidor y los formularios de cliente.
 */

/** Páginas públicas de consulta a las que tiene sentido volver tras entrar. */
const PREFIJOS_PUBLICOS = [
  '/empresas',
  '/catalogo',
  '/ofertas',
  '/oferta',
  '/promociones',
  '/promocion',
  '/plan',
  '/excursiones',
  '/checkout',
  '/carrito',
  '/i',
  '/invitar',
  '/invita',
  '/invitacion',
  '/caracteristicas',
  '/faq',
  '/blog',
  '/contact',
  '/descargar',
  '/privacy',
  '/terms',
]

/** El propio flujo de acceso, el API y los enlaces cortos: jamás son un destino. */
const PREFIJOS_PROHIBIDOS = ['/login', '/acceso', '/registro', '/recuperar', '/actualizar-password', '/confirmar', '/auth', '/api', '/_next', '/sso', '/e', '/r', '/monitoring']

const MAX_LARGO = 2048
const CARACTERES_PELIGROSOS = /[\u0000-\u001f\u007f\\]/

/** `/cliente` coincide con `/cliente` y `/cliente/x`, pero no con `/clientes`. */
function coincide(ruta: string, prefijo: string): boolean {
  return ruta === prefijo || ruta.startsWith(prefijo + '/')
}

function esRutaAutorizada(ruta: string): boolean {
  if (PREFIJOS_PROHIBIDOS.some((p) => coincide(ruta, p))) return false
  if (ROUTE_PROTECTION.some((r) => coincide(ruta, r.prefix))) return true
  return PREFIJOS_PUBLICOS.some((p) => coincide(ruta, p))
}

/**
 * El destino normalizado (ruta + consulta + ancla) o `null` si no es una ruta
 * interna autorizada. Nunca lanza.
 */
export function destinoInterno(candidato: unknown): string | null {
  if (typeof candidato !== 'string') return null
  if (candidato.length === 0 || candidato.length > MAX_LARGO) return null
  if (!candidato.startsWith('/') || candidato.startsWith('//')) return null
  if (CARACTERES_PELIGROSOS.test(candidato)) return null
  try {
    // Lo decodificado tampoco puede esconder una barra doble, una contrabarra ni un control.
    const decodificado = decodeURIComponent(candidato)
    if (CARACTERES_PELIGROSOS.test(decodificado) || decodificado.startsWith('//')) return null
    const url = new URL(candidato, 'http://destino.invalid')
    if (url.origin !== 'http://destino.invalid' || url.pathname.startsWith('//')) return null
    if (!esRutaAutorizada(url.pathname)) return null
    return url.pathname + url.search + url.hash
  } catch {
    return null
  }
}

/** Como `destinoInterno`, pero con respaldo: nunca devuelve `null`. */
export function destinoOPorDefecto(candidato: unknown, porDefecto: string): string {
  return destinoInterno(candidato) ?? porDefecto
}

/**
 * El destino, si ese ROL puede abrirlo; si no, `porDefecto` (su casa). El rol da
 * la puerta del espacio; la autorización fina sigue siendo del proxy y de las
 * guardias de cada página.
 *
 * `puedeEntrarAlPanel`: la puerta de `/admin` admite DOS llaves —el rol, o una
 * sección CONCEDIDA a un empleado por el módulo de Permisos—. Quien llama (el proxy
 * y el login, que tienen los permisos a la vista) lo calcula con
 * `puedeEntrarAlPanel` de `permissions`; este módulo no lo importa para seguir siendo
 * liviano en los formularios de cliente. Sin él, un empleado con una sección
 * concedida recibiría su casa en vez del panel al que iba.
 */
export function destinoParaRol(candidato: unknown, rol: AppRole, porDefecto: string, opciones: { puedeEntrarAlPanel?: boolean } = {}): string {
  const destino = destinoInterno(candidato)
  if (!destino) return porDefecto
  const ruta = new URL(destino, 'http://destino.invalid').pathname
  const regla = ROUTE_PROTECTION.find((r) => coincide(ruta, r.prefix))
  if (!regla) return destino
  if (regla.prefix === '/admin' && opciones.puedeEntrarAlPanel) return destino
  if (!regla.roles.includes(rol)) return porDefecto
  return destino
}
