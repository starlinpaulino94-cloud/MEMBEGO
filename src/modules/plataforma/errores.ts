/**
 * PLATAFORMA · Fase 2 — CONTRATO DE ERROR DE LA API v1.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UN CÓDIGO Y NO UN MENSAJE
 *
 * El satélite lo escribe otro equipo, a veces en otro idioma, y su código tiene
 * que ramificar según lo que falló: reintentar un 429 no es lo mismo que pedir
 * un token nuevo por un 401 ni que enseñar «membresía vencida» al camarero.
 *
 * Si eso se decide leyendo `message`, el día que alguien mejore la redacción
 * —una tilde, un «no puede» por «no está autorizado»— el satélite deja de
 * reconocer el caso y falla de una forma que nadie relaciona con el cambio.
 *
 *   `code`    ESTABLE. Es API. Cambiarlo rompe satélites.
 *   `message` para personas. Puede cambiar cuando se quiera.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ SIEMPRE UN requestId
 *
 * Cuando el del satélite escribe «me da 403», la única pregunta útil es cuál de
 * los cientos de 403 de hoy. El `requestId` va en el cuerpo Y en la cabecera
 * `X-Request-Id`: el satélite lo guarda en su log, y con él se encuentra la
 * línea exacta del nuestro.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE UN ERROR NO DICE
 *
 * `message` nunca describe la configuración de la plataforma. «Sistema no
 * habilitado para esta empresa» es todo lo que se cuenta; si la causa fue que
 * el sistema está en DRAFT, que el vertical no coincide o que alguien revocó la
 * habilitación es cosa nuestra. Un error demasiado explicativo convierte la API
 * en un oráculo para enumerar empresas y sistemas.
 */

import { NextResponse } from 'next/server'

/** Códigos estables. Añadir es compatible; renombrar o quitar NO lo es. */
export const CODIGOS_ERROR = {
  // 400
  INVALID_REQUEST: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  /**
   * La misma clave con OTRO cuerpo. Es un error del cliente, no un reintento:
   * devolver la respuesta guardada sería contestarle sobre una operación
   * distinta de la que pidió.
   */
  IDEMPOTENCY_KEY_REUSED: 400,
  // 409 — una idéntica sigue en curso; reintentar en un momento
  IDEMPOTENCY_IN_PROGRESS: 409,
  // 401 — el que pide no ha demostrado quién es
  INVALID_CLIENT: 401,
  INVALID_TOKEN: 401,
  TOKEN_EXPIRED: 401,
  // 403 — sabemos quién es, y no puede
  INSUFFICIENT_SCOPE: 403,
  COMPANY_NOT_ENTITLED: 403,
  // 404
  NOT_FOUND: 404,
  /**
   * El beneficio existe pero no se puede consumir ahora: vencido, sin usos,
   * vehículo no autorizado, QR que no corresponde. No es un error del satélite
   * ni una carrera — es la respuesta del negocio, y el camarero necesita verla.
   */
  BENEFIT_NOT_ELIGIBLE: 422,
  /**
   * Alguien se adelantó: el QR se usó entre la evaluación y el canje, o la
   * membresía se agotó. Reintentable con datos frescos, a diferencia del 422.
   */
  REDEMPTION_CONFLICT: 409,
  // 429
  RATE_LIMITED: 429,
  // 5xx
  INTERNAL_ERROR: 500,
  PLATFORM_API_UNCONFIGURED: 503,
} as const

export type CodigoError = keyof typeof CODIGOS_ERROR

/**
 * Texto por defecto de cada código. Deliberadamente grueso: describe qué hacer,
 * no qué encontramos.
 */
const MENSAJES: Record<CodigoError, string> = {
  INVALID_REQUEST: 'The request is malformed or missing required parameters.',
  IDEMPOTENCY_KEY_REQUIRED: 'This endpoint writes: send an Idempotency-Key header.',
  IDEMPOTENCY_KEY_REUSED:
    'This Idempotency-Key was already used with a different request. Use a new key per operation.',
  IDEMPOTENCY_IN_PROGRESS: 'An identical request is still in progress. Retry in a moment.',
  INVALID_CLIENT: 'Client authentication failed.',
  INVALID_TOKEN: 'The access token is missing, malformed or invalid.',
  TOKEN_EXPIRED: 'The access token has expired. Request a new one.',
  INSUFFICIENT_SCOPE: 'The access token does not grant the required scope.',
  COMPANY_NOT_ENTITLED: 'This system is not enabled for the requested company.',
  NOT_FOUND: 'The requested resource does not exist.',
  BENEFIT_NOT_ELIGIBLE: 'The benefit cannot be redeemed right now.',
  REDEMPTION_CONFLICT: 'The benefit changed while redeeming. Re-evaluate and retry.',
  RATE_LIMITED: 'Too many requests. Slow down and retry later.',
  INTERNAL_ERROR: 'Unexpected error. Retry later; the requestId identifies this call.',
  PLATFORM_API_UNCONFIGURED: 'The platform API is not configured on this deployment.',
}

export interface CuerpoError {
  error: {
    code: CodigoError
    message: string
    requestId: string
    /**
     * Solo en INSUFFICIENT_SCOPE: qué scope faltaba. Es la única pista que se
     * da, y se da porque el que pregunta ya está autenticado y necesita saber
     * qué pedir en el manifest — sin esto, integrar es adivinar.
     */
    requiredScope?: string
    /**
     * Solo en BENEFIT_NOT_ELIGIBLE: por qué no se puede consumir
     * (`SIN_USOS`, `MEMBRESIA_VENCIDA`…). Aquí sí se detalla, y no contradice
     * la regla de no describir la configuración: es información del cliente que
     * el satélite ya tiene delante, y sin ella el camarero no sabe qué decirle.
     */
    reason?: string
  }
}

/**
 * Identificador de la petición. En inglés y con prefijo para que se distinga a
 * simple vista en un log ajeno.
 */
export function nuevoRequestId(): string {
  return `req_${crypto.randomUUID().replace(/-/g, '')}`
}

/**
 * Respuesta de error de la API v1. `X-Request-Id` va también en la cabecera
 * porque un cliente HTTP que descarta el cuerpo en los 4xx —hay muchos— se
 * quedaría sin la única pista que sirve para buscar.
 */
export function errorApi(
  code: CodigoError,
  requestId: string,
  extra: { message?: string; requiredScope?: string; reason?: string } = {}
): NextResponse<CuerpoError> {
  const cuerpo: CuerpoError = {
    error: {
      code,
      message: extra.message ?? MENSAJES[code],
      requestId,
      ...(extra.requiredScope ? { requiredScope: extra.requiredScope } : {}),
      ...(extra.reason ? { reason: extra.reason } : {}),
    },
  }
  const cabeceras: Record<string, string> = {
    'X-Request-Id': requestId,
    // Ningún intermediario debe guardar una respuesta de error de una API
    // autenticada: el siguiente que pregunte puede ser otro sistema.
    'Cache-Control': 'no-store',
  }
  // RFC 6750: un 401 sin `WWW-Authenticate` deja al cliente sin saber si le
  // toca renovar el token o revisar sus credenciales.
  if (CODIGOS_ERROR[code] === 401) cabeceras['WWW-Authenticate'] = `Bearer error="${code}"`
  if (code === 'INSUFFICIENT_SCOPE') {
    cabeceras['WWW-Authenticate'] =
      `Bearer error="insufficient_scope", scope="${extra.requiredScope ?? ''}"`
  }

  return NextResponse.json(cuerpo, { status: CODIGOS_ERROR[code], headers: cabeceras })
}

/** Respuesta correcta de la API v1, con el mismo `requestId` para correlacionar. */
export function respuestaApi<T>(datos: T, requestId: string): NextResponse<T> {
  return NextResponse.json(datos, {
    headers: { 'X-Request-Id': requestId, 'Cache-Control': 'no-store' },
  })
}
