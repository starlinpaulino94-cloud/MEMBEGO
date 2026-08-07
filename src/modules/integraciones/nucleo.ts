import { createHmac, timingSafeEqual } from 'crypto'

/**
 * NÚCLEO PURO de las integraciones con sistemas satélite: firmas y tokens.
 * Sin Prisma ni red — verificable con pruebas y reutilizable en la doc del
 * contrato (el satélite implementa EXACTAMENTE estas mismas operaciones).
 */

/** Eventos del bus que se reenvían a los sistemas conectados. */
export const EVENTOS_REENVIADOS = [
  'cliente.registrado',
  'cliente.primera_visita',
  'cliente.visita',
  'cliente.compro_servicio',
  'cliente.primera_compra',
  'membresia.activada',
  'referido.convirtio',
] as const

/** Firma HMAC-SHA256 (hex) de un cuerpo, con el secreto compartido. */
export function firmarHmac(secreto: string, cuerpo: string): string {
  return createHmac('sha256', secreto).update(cuerpo, 'utf8').digest('hex')
}

/** Compara firmas sin filtrar información por tiempo de ejecución. */
export function firmaValida(secreto: string, cuerpo: string, firma: string): boolean {
  const esperada = firmarHmac(secreto, cuerpo)
  const a = Buffer.from(esperada, 'utf8')
  const b = Buffer.from(firma, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

export interface DatosSSO {
  /** ID estable del usuario en MembeGo (supabaseId). */
  sub: string
  email: string
  nombre?: string
  /** Rol en MembeGo (ADMIN_EMPRESA, GERENTE, EMPLEADO, …). */
  rol: string
  /** Empresa de MembeGo a la que pertenece — el tenant en el satélite. */
  companyId: string
  /** Epoch en segundos; después de esto el token no vale. */
  exp: number
}

function base64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url')
}

/**
 * TOKEN SSO de un solo uso y corta vida: `base64url(JSON).firmaHex`.
 * El satélite lo verifica con el MISMO secreto compartido — sin llamadas de
 * vuelta a MembeGo y sin dependencias de librerías JWT.
 */
export function crearTokenSSO(secreto: string, datos: DatosSSO): string {
  const cuerpo = base64url(JSON.stringify(datos))
  return `${cuerpo}.${firmarHmac(secreto, cuerpo)}`
}

/** Verificación del token (la misma que implementa el satélite). */
export function verificarTokenSSO(
  secreto: string,
  token: string,
  ahoraEpoch = Math.floor(Date.now() / 1000)
): DatosSSO | null {
  const punto = token.lastIndexOf('.')
  if (punto <= 0) return null
  const cuerpo = token.slice(0, punto)
  const firma = token.slice(punto + 1)
  if (!firmaValida(secreto, cuerpo, firma)) return null
  try {
    const datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8')) as DatosSSO
    if (typeof datos.exp !== 'number' || datos.exp < ahoraEpoch) return null
    if (!datos.sub || !datos.companyId) return null
    return datos
  } catch {
    return null
  }
}

/** Token de ENTRADA (satélite → MembeGo). Mismo formato; el satélite puede no
 *  conocer el `sub` de un usuario que nunca entró por nuestro SSO, así que
 *  basta `sub` O `email` (además de `companyId` y `exp`). */
export interface DatosSSOEntrante {
  /** supabaseId que NUESTRO token saliente le entregó al satélite (preferido). */
  sub?: string
  /** Único en MembeGo; suficiente si el satélite no guarda el sub. */
  email?: string
  companyId: string
  exp: number
}

/**
 * Verificación del token ENTRANTE (SSO satélite → MembeGo). Igual de estricta
 * en firma y vigencia que `verificarTokenSSO`; solo relaja la identidad a
 * `sub` O `email`. Es una función aparte a propósito: la verificación de
 * NUESTROS tokens (la que copian los satélites) no debe aflojarse jamás.
 */
export function verificarTokenSSOEntrante(
  secreto: string,
  token: string,
  ahoraEpoch = Math.floor(Date.now() / 1000)
): DatosSSOEntrante | null {
  const punto = token.lastIndexOf('.')
  if (punto <= 0) return null
  const cuerpo = token.slice(0, punto)
  const firma = token.slice(punto + 1)
  if (!firmaValida(secreto, cuerpo, firma)) return null
  try {
    const datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8')) as DatosSSOEntrante
    if (typeof datos.exp !== 'number' || datos.exp < ahoraEpoch) return null
    if (!datos.companyId) return null
    if (!datos.sub && !datos.email) return null
    return datos
  } catch {
    return null
  }
}
