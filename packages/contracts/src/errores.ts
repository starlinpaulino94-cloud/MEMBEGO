/**
 * CONTRATOS · el contrato de error de la API v1.
 *
 * `code` es ESTABLE: es API, y el satélite ramifica con él. `message` es para
 * personas y puede cambiar cuando se quiera — un satélite que ramifique leyendo
 * el texto se rompe el día que alguien corrija una tilde.
 *
 * Añadir un código es compatible; renombrar o quitar uno NO lo es.
 */

export const CODIGOS_ERROR = {
  // 400
  INVALID_REQUEST: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  /** La misma clave con OTRO cuerpo: es un error del cliente, no un reintento. */
  IDEMPOTENCY_KEY_REUSED: 400,
  // 409
  IDEMPOTENCY_IN_PROGRESS: 409,
  // 401 — el que pide no ha demostrado quién es
  INVALID_CLIENT: 401,
  INVALID_TOKEN: 401,
  TOKEN_EXPIRED: 401,
  // 403 — sabemos quién es, y no puede
  INSUFFICIENT_SCOPE: 403,
  COMPANY_NOT_ENTITLED: 403,
  /**
   * La clave de API de empresa es válida, pero este recurso solo lo puede usar
   * un sistema satélite (necesita saber QUÉ sistema realiza la operación: un
   * canje sin sistema que lo respalde no se puede auditar).
   *
   * Se dice con claridad en vez de devolver un 401 genérico: la lista de
   * recursos es API pública, así que no se filtra nada, y quien integra pierde
   * media tarde averiguando si su clave está mal.
   */
  API_KEY_NOT_SUPPORTED: 403,
  // 404
  NOT_FOUND: 404,
  /** El beneficio existe pero no se puede consumir ahora. No reintentar igual. */
  BENEFIT_NOT_ELIGIBLE: 422,
  /** Alguien se adelantó. Re-evaluar y reintentar. */
  REDEMPTION_CONFLICT: 409,
  /** El token SSO no verifica con tu secreto, o ya venció. */
  SSO_TOKEN_INVALID: 401,
  /**
   * Ya se canjeó. Un token SSO vale UNA vez: si llega este código, o hay un
   * reintento tuyo —que no hace falta, la primera respuesta era válida— o
   * alguien capturó la URL.
   */
  SSO_TOKEN_ALREADY_USED: 409,
  // 429
  RATE_LIMITED: 429,
  // 5xx
  INTERNAL_ERROR: 500,
  PLATFORM_API_UNCONFIGURED: 503,
} as const

export type CodigoError = keyof typeof CODIGOS_ERROR

export interface CuerpoError {
  error: {
    code: CodigoError
    message: string
    /** Va también en la cabecera `X-Request-Id`. Guárdalo en tu log. */
    requestId: string
    /** Solo en INSUFFICIENT_SCOPE: qué scope faltaba. */
    requiredScope?: string
    /** Solo en BENEFIT_NOT_ELIGIBLE: por qué no se puede consumir. */
    reason?: string
  }
}

/**
 * ¿Merece la pena reintentar este código?
 *
 * Vive aquí y no en el SDK porque es parte del contrato: si el Core cambia qué
 * es reintentable, todos los clientes tienen que enterarse por el mismo sitio.
 *
 * Un 4xx NO se reintenta —salvo el 429— porque reintentar algo que el servidor
 * rechazó por su contenido solo gasta cuota y retrasa el error real.
 */
export function esReintentable(code: CodigoError): boolean {
  return code === 'RATE_LIMITED' || code === 'INTERNAL_ERROR' || code === 'IDEMPOTENCY_IN_PROGRESS'
}

/** Códigos que significan «pide un token nuevo y vuelve a intentarlo». */
export function exigeTokenNuevo(code: CodigoError): boolean {
  return code === 'TOKEN_EXPIRED' || code === 'INVALID_TOKEN'
}
