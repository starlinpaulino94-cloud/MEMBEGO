import { createHmac, timingSafeEqual } from 'crypto'

/**
 * NÚCLEO PURO de las integraciones con sistemas satélite: firmas y tokens.
 * Sin Prisma ni red — verificable con pruebas y reutilizable en la doc del
 * contrato (el satélite implementa EXACTAMENTE estas mismas operaciones).
 */

/**
 * Eventos del bus que se ENTREGAN A LOS SATÉLITES conectados.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTA LISTA ES MÁS ESTRECHA QUE `EVENTOS_EMITIDOS` (B-4)
 *
 * `despacho.ts` filtra por esta lista antes de crear una fila en el outbox de
 * cada satélite: un satélite recibe SOLO lo que está aquí. Por eso no es «todo
 * lo que el bus emite» —eso inundaría a Car Wash con `promocion.creada` y
 * `mensaje.recibido`, que no atiende, y le llenaría la cola de entregas muertas.
 *
 * Aquí va lo que un satélite necesita para operar: los hechos de negocio que ya
 * atendía, MÁS los eventos que alimentan una PROYECCIÓN CORE que él mantiene.
 * `cliente.actualizado` es de estos últimos: el contrato de proyección (§Fase
 * 1a) dice que un satélite refresca su copia de `Customer` con
 * `customer.created` Y `customer.updated`. Recibía el alta y no la edición, así
 * que su copia se quedaba con el teléfono viejo y nadie sabía por qué. Añadirlo
 * no es ruido: cierra ese hueco.
 *
 * La superficie ANCHA —lo que un Zapier de empresa puede recibir— es
 * `EVENTOS_EMITIDOS`, y viaja por otro canal (los webhooks de empresa) que no
 * filtra por esta lista.
 */
export const EVENTOS_REENVIADOS = [
  'cliente.registrado',
  'cliente.actualizado',
  'cliente.primera_visita',
  'cliente.visita',
  'cliente.compro_servicio',
  'cliente.primera_compra',
  'membresia.activada',
  'referido.convirtio',
] as const

/**
 * TODO evento interno que el bus EMITE DE VERDAD hoy, con emisor real.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA VERDAD SOBRE QUÉ EVENTOS EXISTEN (B-4)
 *
 * `EVENTOS_REENVIADOS` es el subconjunto que llega a los satélites;
 * `EVENTOS_EMITIDOS` es la lista completa de lo que ocurre en el bus, y es la
 * que alimenta la superficie de INTEGRACIÓN de una empresa: el selector de un
 * webhook (A-5), el catálogo de documentación (`catalogoV2`) y el cálculo de
 * qué eventos de proyección aún no tienen emisor.
 *
 * Los webhooks de empresa (`repartirEventoAWebhooks`) NO filtran por
 * `EVENTOS_REENVIADOS`, así que estos eventos ya llegaban a quien se suscribía a
 * «todo» — pero con su nombre interno en español y sin poder elegirlos uno a
 * uno. Nombrarlos y ofrecerlos es lo que cierra B-4: la lista deja de ser «los
 * siete que atiende un satélite» y pasa a ser «todo lo que tu negocio puede
 * avisar», que es lo que un integrador espera de una plataforma como GoHighLevel.
 *
 * REGLA DE ORO: un evento entra aquí SOLO cuando tiene un emisor real en el
 * código (una llamada a `emitirEventoEstrategia`). Meter un nombre sin emisor
 * recrea el mismo problema de B-4 al revés: una casilla que no recibe nada y una
 * tarde buscando por qué. `EVENTOS_REENVIADOS` es, por construcción, un
 * subconjunto de esta lista (un satélite no puede recibir algo que no se emite).
 */
export const EVENTOS_EMITIDOS = [
  ...EVENTOS_REENVIADOS,
  // Journey de referidos: el invitado se registró (antes de convertir).
  'referido.invitado_registrado',
  // Mensajería (Meta): entra un mensaje, y de un primer mensaje nace un prospecto.
  'mensaje.recibido',
  'prospecto.creado',
  // Ciclo de vida de las promociones (emitido por el puente de promociones).
  'promocion.creada',
  'promocion.actualizada',
  'promocion.eliminada',
  'promocion.duplicada',
  'promocion.activada',
  'promocion.pausada',
  'promocion.archivada',
  // Reservas de excursión: una reserva quedó pagada.
  'reserva.pagada',
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
  /**
   * Nombre comercial de la empresa. Opcional como todo lo nuevo: existe para
   * que un satélite con AUTO-VINCULACIÓN pueda crear el tenant con su nombre
   * real en vez de un marcador. Un satélite que no lo mire, ni se entera.
   */
  companyName?: string
  /** Epoch en segundos; después de esto el token no vale. */
  exp: number

  // ── Fase 5 ────────────────────────────────────────────────────────────────
  // Campos NUEVOS y opcionales: un satélite que no los mire sigue funcionando
  // exactamente igual, que es lo que permite desplegar esto sin coordinar.

  /**
   * Identificador único del token. Es lo que permite el USO ÚNICO: quien lo
   * canjea contra `/api/platform/v1/sso/redeem` gana, y el segundo choca.
   *
   * Mientras un satélite verifique el token por su cuenta —como hasta hoy—,
   * hacerlo de un solo uso es responsabilidad suya: MembeGo no se entera de esa
   * verificación. El canje contra la API es lo que traslada esa garantía aquí.
   */
  jti?: string
  /**
   * Puesto del usuario DENTRO del vertical: `MESERO`, `COCINA`, `LAVADOR`.
   *
   * Cadena libre. MembeGo la guarda y la transporta; interpretarla es del
   * satélite. Un enum obligaría a desplegar el Core cada vez que un vertical
   * inventara un puesto (§50).
   */
  systemRole?: string
  /** Permisos finos que define y lee el vertical. El Core solo los lleva. */
  permisos?: Record<string, unknown>
  /**
   * A dónde llevar al usuario dentro del satélite. VALIDADO contra la `urlBase`
   * del sistema antes de firmar, y firmado con el resto — si viajara suelto en
   * la query, cualquiera podría cambiarlo y convertir nuestro SSO en un
   * redirector abierto con la credibilidad de MembeGo detrás.
   */
  returnUrl?: string
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
  /**
   * Identificador único del token (Fase 5). OPCIONAL por compatibilidad: un
   * satélite que aún no lo mande sigue entrando, y queda un aviso en el log.
   *
   * Cuando viene, MembeGo garantiza el uso único — que aquí sí puede, porque
   * es quien valida.
   */
  jti?: string
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
