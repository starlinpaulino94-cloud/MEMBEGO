import { createHash, randomBytes, createHmac, timingSafeEqual } from 'node:crypto'

/**
 * NÚCLEO PURO del cliente OAuth 2.0 de Membego Connect (Fase 5).
 *
 * Aquí MembeGo es el CLIENTE: pide permiso al usuario para hablar con Google,
 * Meta o quien sea en nombre de una empresa. No confundir con
 * `modules/plataforma/*`, donde MembeGo es el SERVIDOR y quien pide permiso es
 * un satélite. Son dos papeles opuestos y por eso viven en módulos distintos.
 *
 * Sin red ni base: todo lo que decide seguridad se puede probar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ PROPIO Y NO NANGO (decisión D2 de la Fase 0)
 *
 * Con dos proveedores previstos, un servicio externo de OAuth costaría dinero,
 * añadiría un tercero al camino de credenciales de nuestros clientes y nos
 * ataría a su disponibilidad para algo que son doscientas líneas. El umbral
 * de revisión quedó fijado en ~10 proveedores: a partir de ahí, mantener
 * particularidades de cada uno deja de ser barato.
 */

// ── PKCE (RFC 7636) ─────────────────────────────────────────────────────────

/**
 * PKCE ata el código de autorización al navegador que lo pidió.
 *
 * Sin él, un código interceptado —en un log, en el historial, en un redirect
 * mal configurado— se puede canjear por tokens desde cualquier sitio. Con él,
 * el canje exige además el `code_verifier`, que nunca viajó por la URL.
 *
 * Se usa SIEMPRE, también con proveedores que no lo exigen: no cuesta nada y
 * quita de en medio toda una familia de fallos.
 */
export interface ParPkce {
  /** El secreto. Se guarda en el servidor y viaja solo en el canje. */
  verifier: string
  /** Su hash. Es lo que viaja en la URL de autorización. */
  challenge: string
}

export function nuevoPkce(): ParPkce {
  // 32 bytes en base64url = 43 caracteres, dentro del rango 43–128 del RFC.
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: retoDesde(verifier) }
}

export function retoDesde(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

// ── Estado (protección CSRF del flujo) ──────────────────────────────────────

/**
 * El `state` viaja hasta el proveedor y vuelve. Va FIRMADO y con caducidad.
 *
 * Firmarlo no sustituye a guardarlo —el uso único exige una fila en la base,
 * ver `EstadoOAuth`— sino que evita gastar una consulta con cualquier basura
 * que llegue al callback: si la firma no cuadra, no se mira la base siquiera.
 *
 * Formato: `<payload base64url>.<hmac base64url>`.
 */
export interface EstadoOauth {
  /** Id de la fila en `estados_oauth`. El uso único se juega ahí. */
  id: string
  /** Momento de emisión, en segundos. */
  iat: number
}

export const VIDA_ESTADO_S = 15 * 60

export function firmarEstado(secreto: string, estado: EstadoOauth): string {
  const carga = Buffer.from(JSON.stringify(estado), 'utf8').toString('base64url')
  const firma = createHmac('sha256', secreto).update(carga).digest('base64url')
  return `${carga}.${firma}`
}

export type LecturaEstado =
  | { ok: true; estado: EstadoOauth }
  | { ok: false; motivo: 'formato' | 'firma' | 'vencido' }

export function leerEstado(secreto: string, token: string, ahora = Date.now()): LecturaEstado {
  const partes = token.split('.')
  if (partes.length !== 2) return { ok: false, motivo: 'formato' }
  const [carga, firma] = partes

  const esperada = createHmac('sha256', secreto).update(carga).digest()
  const recibida = Buffer.from(firma, 'base64url')
  // Tiempo constante: comparar con === filtra cuántos bytes se acertaron.
  if (recibida.length !== esperada.length) return { ok: false, motivo: 'firma' }
  if (!timingSafeEqual(recibida, esperada)) return { ok: false, motivo: 'firma' }

  let estado: EstadoOauth
  try {
    estado = JSON.parse(Buffer.from(carga, 'base64url').toString('utf8')) as EstadoOauth
  } catch {
    return { ok: false, motivo: 'formato' }
  }
  if (!estado?.id || typeof estado.iat !== 'number') return { ok: false, motivo: 'formato' }
  if (Math.floor(ahora / 1000) - estado.iat > VIDA_ESTADO_S) return { ok: false, motivo: 'vencido' }

  return { ok: true, estado }
}

// ── URL de autorización ─────────────────────────────────────────────────────

export interface ProveedorOauth {
  /** Dónde se manda al usuario a dar permiso. */
  urlAutorizacion: string
  /** Dónde se canjea el código por tokens. */
  urlToken: string
  clientId: string
  /**
   * Parámetros extra del proveedor (`access_type=offline` en Google, sin el
   * cual no llega refresh token; `prompt=consent` para forzar que llegue otra
   * vez si el usuario ya había concedido). Van aquí y no en el código porque
   * son particularidades de cada uno, no del protocolo.
   */
  extra?: Record<string, string>
  /**
   * Dónde se revoca un token al desconectar (`oauth2.googleapis.com/revoke`
   * en Google). Opcional: un proveedor sin punto de revocación solo ve cómo
   * borramos nuestra copia, y su token sigue vivo hasta que caduque.
   */
  urlRevocacion?: string
}

/**
 * Un proveedor OAuth con lo que hace falta para canjear: el secreto NO viaja
 * aquí, viaja el NOMBRE de su variable de entorno. Un secreto en una
 * estructura de datos acaba, tarde o temprano, en un log.
 *
 * Vive en el núcleo puro (y no en `oauth.ts`, que es `server-only`) para que
 * el registro de proveedores pueda declararlo sin arrastrar la capa de base
 * de datos: así las definiciones se pueden probar sin Prisma.
 */
export interface ConfigOauthConector extends ProveedorOauth {
  /** Secreto del cliente OAuth. Sale del entorno, no de la base. */
  clientSecretEnv: string
  scopes: string[]
}

export function urlDeAutorizacion(input: {
  proveedor: ProveedorOauth
  redirectUri: string
  scopes: readonly string[]
  state: string
  challenge: string
}): string {
  const u = new URL(input.proveedor.urlAutorizacion)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', input.proveedor.clientId)
  u.searchParams.set('redirect_uri', input.redirectUri)
  u.searchParams.set('scope', input.scopes.join(' '))
  u.searchParams.set('state', input.state)
  u.searchParams.set('code_challenge', input.challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  for (const [k, v] of Object.entries(input.proveedor.extra ?? {})) u.searchParams.set(k, v)
  return u.toString()
}

// ── Política de refresco ────────────────────────────────────────────────────

/**
 * Margen con el que un token se considera «a punto de vencer».
 *
 * Cinco minutos, y no cero, porque entre que decidimos usar un token y el
 * proveedor lo valida pasa tiempo: red, reintentos, una cola. Refrescar al
 * filo produce fallos intermitentes imposibles de reproducir.
 */
export const MARGEN_REFRESCO_MS = 5 * 60 * 1000

export function necesitaRefresco(expiresAt: Date | null, ahora = Date.now()): boolean {
  // Sin fecha de caducidad no se refresca: o no caduca, o el proveedor no lo
  // dijo. Refrescar «por si acaso» gastaría el refresh token de balde y, con
  // proveedores que lo rotan, podría dejarnos sin ninguno válido.
  if (!expiresAt) return false
  return expiresAt.getTime() - ahora <= MARGEN_REFRESCO_MS
}

/** Lo que se guarda sellado de una conexión OAuth. */
export interface TokensOauth {
  accessToken: string
  refreshToken?: string | null
  scopes?: string[]
}

/**
 * Une los tokens nuevos con los que ya había.
 *
 * EL DETALLE QUE ROMPE INTEGRACIONES: al refrescar, muchos proveedores
 * devuelven `access_token` y NINGÚN `refresh_token`, porque el que ya tienes
 * sigue valiendo. Guardar la respuesta tal cual borraría el refresh token y la
 * conexión moriría al siguiente vencimiento — un fallo que aparece una hora
 * después, cuando ya nadie mira.
 */
export function fusionarTokens(previos: TokensOauth | null, nuevos: TokensOauth): TokensOauth {
  return {
    accessToken: nuevos.accessToken,
    refreshToken: nuevos.refreshToken || previos?.refreshToken || null,
    scopes: nuevos.scopes?.length ? nuevos.scopes : previos?.scopes,
  }
}

/**
 * Destino de vuelta DENTRO de MembeGo, tras un flujo OAuth.
 *
 * Solo rutas propias que empiecen por `/admin/`. Aceptar una URL absoluta
 * convertiría nuestro dominio en un redirector abierto: un enlace con aspecto
 * de membego.com que termina en otro sitio, que es lo que hace creíble una
 * suplantación.
 *
 * `//otro.com` PARECE una ruta y es una URL absoluta con el esquema heredado.
 * Es el caso que se cuela cuando solo se comprueba el primer carácter.
 */
/**
 * DE DÓNDE VINO el usuario, o null si no vino de ningún sitio conocido.
 *
 * Se parece a `destinoDeVueltaSeguro` y responde una pregunta distinta, y por
 * eso son dos funciones:
 *
 *   destinoDeVueltaSeguro  «¿a dónde mando a esta persona al terminar?»
 *                          SIEMPRE tiene que dar una respuesta, así que ante
 *                          la duda devuelve el panel de Integraciones.
 *
 *   origenSeguro           «¿venía de algún módulo?»
 *                          Aquí «no» es una respuesta válida y necesaria: sin
 *                          ella, una pantalla que llega sin parámetro creería
 *                          que viene de Integraciones y pintaría un «volver»
 *                          que no lleva a donde el usuario estaba.
 *
 * Un origen inválido se trata como ausente, NO como el panel: aceptarlo sería
 * dejar que quien fabrica el enlace decida el texto y el destino del botón.
 */
export function origenSeguro(bruto: string | null | undefined): string | null {
  const v = (bruto ?? '').trim()
  if (!v || !v.startsWith('/admin/') || v.startsWith('//')) return null
  return v
}

/**
 * NOMBRE LEGIBLE de un módulo de la aplicación, para el enlace de vuelta.
 *
 * «Volver a Citas» dice a dónde va; «Volver a /admin/citas» obliga a leer una
 * ruta. Lo que no está en la lista se llama «volver atrás», que es cierto sin
 * afirmar de más.
 */
const NOMBRE_DE_RUTA: Record<string, string> = {
  '/admin/citas': 'Citas',
  '/admin/automatizaciones': 'Automatizaciones',
  '/admin/comunicacion': 'Comunicación',
  '/admin/metodos-pago': 'Métodos de pago',
}

export function nombreDelDestino(ruta: string | null): string {
  if (!ruta) return 'atrás'
  const limpia = ruta.split('?')[0].replace(/\/$/, '')
  return NOMBRE_DE_RUTA[limpia] ?? 'atrás'
}

export function destinoDeVueltaSeguro(bruto: string | null | undefined): string {
  const v = (bruto ?? '').trim()
  if (!v.startsWith('/admin/') || v.startsWith('//')) return '/admin/integraciones'
  return v
}
