/**
 * CardNET Tokenización (PÁGINA HOSPEDADA) — lógica pura, sin I/O.
 *
 * A diferencia de `cardnet-core.ts` (integración DIRECTA 3DS, donde la tarjeta
 * pasa por nuestro servidor), aquí el cliente digita la tarjeta en un IFRAME de
 * CardNET y solo nos llega un TOKEN. Nuestro servidor nunca ve el número de
 * tarjeta. Es el modelo de menor alcance PCI (SAQ A) — ver docs/PAGOS-CARDNET.md.
 *
 * Este archivo NO importa `server-only`: lo cargan las pruebas
 * (tests/cardnet-tokens.test.ts) y solo tiene funciones puras.
 */

export type AmbienteTokens = 'pruebas' | 'produccion'

/**
 * URLs del servicio de tokens por ambiente.
 *
 * El widget de CardNET (PWCheckout.js) es del middleware GTP/Seglan y EXIGE que
 * el script se cargue desde su propio dominio (`gtp-seglan.com`) — si se sirve
 * desde otro host, el propio script lo rechaza. El host se confirmó por el
 * mensaje del widget en QA:
 *   · QA:   tr-tsp-test.gtp-seglan.com/tr-tsp-mw-cardnet/v1
 *   · Prod: tr-tsp.gtp-seglan.com/tr-tsp-mw-cardnet/v1   (VERIFICAR-QA con CardNET)
 *
 * (El Postman traía `labservicios.cardnet.com.do/servicios/tokens/v1`, un host
 * viejo que devuelve 500. No usar.)
 */
export function urlsTokens(ambiente: AmbienteTokens): {
  /** Base de la API REST (Customer, Purchase, …). Lleva Authorization: Basic. */
  api: string
  /** URL del iframe de captura de tarjeta (se abre en el navegador). */
  capture: string
  /** Script del checkout hospedado (PWCheckout.js) que carga el navegador. */
  script: string
} {
  const base =
    ambiente === 'produccion'
      ? 'https://tr-tsp.gtp-seglan.com/tr-tsp-mw-cardnet/v1'
      : 'https://tr-tsp-test.gtp-seglan.com/tr-tsp-mw-cardnet/v1'
  return {
    api: `${base}/api`,
    capture: `${base}/Capture/`,
    script: `${base}/Scripts/PWCheckout.js`,
  }
}

/**
 * Bases CANDIDATAS de la API REST, en orden de preferencia. Los documentos de
 * CardNET se contradicen entre sí (el Postman dice `labservicios`, el manual
 * dice `lab`, el widget vive en `gtp-seglan`), así que el servidor prueba en
 * orden y se queda con el primero que responda de verdad. `CARDNET_TOKENS_API_BASE`
 * (env) permite fijarlo a mano cuando CardNET confirme el definitivo.
 */
export function apiCandidatos(ambiente: AmbienteTokens): string[] {
  const fijo = process.env.CARDNET_TOKENS_API_BASE?.trim()
  if (fijo) return [fijo.replace(/\/$/, '')]
  return ambiente === 'produccion'
    ? [
        'https://tr-tsp.gtp-seglan.com/tr-tsp-mw-cardnet/v1/api',
        'https://servicios.cardnet.com.do/servicios/tokens/v1/api',
      ]
    : [
        'https://tr-tsp-test.gtp-seglan.com/tr-tsp-mw-cardnet/v1/api',
        'https://labservicios.cardnet.com.do/servicios/tokens/v1/api',
        'https://lab.cardnet.com.do/servicios/tokens/v1/api',
      ]
}

/**
 * Monto en la unidad menor (centavos) como ENTERO, que es lo que espera el
 * campo `Amount` del Purchase de CardNET (10000 = RD$100.00). Se redondea para
 * no arrastrar errores de coma flotante.
 */
export function montoEnteroMenor(pesos: number): number {
  return Math.round(pesos * 100)
}

/** Respuesta interpretada de un cobro por token. */
export interface ResultadoCompraToken {
  aprobada: boolean
  autorizacion: string | null
  /** Código crudo del emisor/plataforma, para diagnóstico. */
  codigo: string
  /** Mensaje corto para el cliente (sin filtrar detalle del banco). */
  motivo: string | null
}

/**
 * Interpreta la respuesta del Purchase. VERIFICAR-QA: la forma exacta de la
 * respuesta solo se confirma con un cobro real. Por eso se aceptan varias
 * grafías comunes del "aprobado" y, ante la duda, se trata como NO aprobado:
 * nunca activar producto por una respuesta ambigua es la postura segura.
 */
export function interpretarCompraToken(resp: unknown): ResultadoCompraToken {
  const r = (resp ?? {}) as Record<string, unknown>

  const s = (v: unknown) => (v == null ? '' : String(v)).trim()
  // Distintos nombres posibles del código de respuesta según la versión.
  const codigo =
    s(r.ResponseCode) || s(r.IsoCode) || s(r.IsoResponseCode) || s(r['response-code'])
  const aprobadaBool = r.Approved === true || r.approved === true || r.IsApproved === true
  const codigoOk = codigo === '00' || codigo === '000'
  const aprobada = aprobadaBool || codigoOk

  const autorizacion =
    s(r.AuthorizationCode) ||
    s(r.Authorization) ||
    s(r['approval-code']) ||
    s(r.RRN) ||
    null

  return {
    aprobada,
    autorizacion: autorizacion || null,
    codigo: codigo || (aprobada ? '00' : ''),
    motivo: aprobada ? null : mensajeCompra(codigo, r),
  }
}

/**
 * Mensaje para el cliente cuando el cobro no pasa. Se apoya en el código si es
 * conocido; si no, un genérico que no expone detalle del emisor.
 */
function mensajeCompra(codigo: string, r: Record<string, unknown>): string {
  const conocidos: Record<string, string> = {
    '05': 'Tu banco rechazó la tarjeta.',
    '51': 'Fondos insuficientes.',
    '54': 'La tarjeta está vencida.',
    '14': 'El número de tarjeta no es válido.',
    '41': 'Tarjeta reportada. Contacta a tu banco.',
    '43': 'Tarjeta reportada. Contacta a tu banco.',
    '61': 'Superaste el límite de tu tarjeta.',
    '65': 'Superaste el límite de intentos. Intenta más tarde.',
  }
  if (codigo && conocidos[codigo]) return conocidos[codigo]
  const msg = (r.ResponseMessage ?? r.Message ?? '') as string
  // Solo se usa el mensaje de la plataforma si es corto y no técnico.
  if (typeof msg === 'string' && msg.length > 0 && msg.length <= 60) return msg
  return 'No se pudo procesar el pago. Verifica los datos o intenta con otra tarjeta.'
}

/**
 * Quita datos sensibles antes de loguear la respuesta como evidencia. Un token
 * de CardNET no es un número de tarjeta, pero sí permite cobrar: no debe quedar
 * en logs en claro. Enmascara cualquier clave que parezca token/tarjeta.
 */
export function sinSensibles(obj: Record<string, unknown>): Record<string, unknown> {
  const salida: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    const kl = k.toLowerCase()
    if (
      kl.includes('token') ||
      kl.includes('card') ||
      kl.includes('pan') ||
      kl.includes('cvv') ||
      kl === 'acctnumber'
    ) {
      salida[k] = typeof v === 'string' && v.length > 4 ? `***${v.slice(-4)}` : '***'
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      salida[k] = sinSensibles(v as Record<string, unknown>)
    } else {
      salida[k] = v
    }
  }
  return salida
}

/** Código de moneda de la República Dominicana para el Purchase. */
export const MONEDA_DOP_TOKENS = 'DOP'
