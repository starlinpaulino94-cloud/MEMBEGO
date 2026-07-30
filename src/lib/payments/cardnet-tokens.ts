import 'server-only'
import {
  urlsTokens,
  montoEnteroMenor,
  interpretarCompraToken,
  sinSensibles,
  MONEDA_DOP_TOKENS,
  type AmbienteTokens,
  type ResultadoCompraToken,
} from '@/lib/payments/cardnet-tokens-core'

export {
  urlsTokens,
  montoEnteroMenor,
  interpretarCompraToken,
  sinSensibles,
  type AmbienteTokens,
  type ResultadoCompraToken,
}

/**
 * Capa de servidor de la TOKENIZACIÓN HOSPEDADA de CardNET.
 *
 * Aquí viven las dos únicas cosas que no pueden salir del servidor:
 *  1. La LLAVE PRIVADA (`Authorization: Basic <privada>`), que es un secreto:
 *     quien la tenga puede cobrar. Nunca en la base, nunca en el navegador,
 *     nunca en logs.
 *  2. La llamada HTTP al Purchase.
 *
 * La llave PÚBLICA sí puede ir al navegador (se usa para abrir el iframe de
 * captura); por eso se expone aparte, en `getTokensPublicConfig`.
 */

export interface TokensConfig {
  publicKey: string
  privateKey: string
  ambiente: AmbienteTokens
}

/** Config completa (incluye el secreto). Solo servidor. */
export function getTokensConfig(): TokensConfig | null {
  const publicKey = process.env.CARDNET_TOKENS_PUBLIC_KEY?.trim()
  const privateKey = process.env.CARDNET_TOKENS_PRIVATE_KEY?.trim()
  if (!publicKey || !privateKey) return null
  return {
    publicKey,
    privateKey,
    ambiente: process.env.CARDNET_TOKENS_AMBIENTE === 'produccion' ? 'produccion' : 'pruebas',
  }
}

/** ¿Están las dos llaves configuradas? Gobierna si se ofrece la tarjeta. */
export function cardnetTokensConfigurado(): boolean {
  return getTokensConfig() !== null
}

/** Datos NO secretos que el navegador necesita para abrir el iframe. */
export interface TokensPublicConfig {
  publicKey: string
  captureUrl: string
  scriptUrl: string
  ambiente: AmbienteTokens
}

/**
 * Config pública para el componente de pago. Devuelve null si no está
 * configurado. NO incluye la llave privada — es seguro pasarla al cliente.
 */
export function getTokensPublicConfig(): TokensPublicConfig | null {
  const cfg = getTokensConfig()
  if (!cfg) return null
  const urls = urlsTokens(cfg.ambiente)
  return {
    publicKey: cfg.publicKey,
    captureUrl: urls.capture,
    scriptUrl: urls.script,
    ambiente: cfg.ambiente,
  }
}

export interface CobrarConTokenInput {
  /** El token que devolvió el iframe de CardNET (`tokenCreated`). */
  trxToken: string
  /** Monto en pesos, LEÍDO DE LA BASE. Nunca del navegador. */
  pesos: number
  /** Nuestra referencia del intento (para conciliar). */
  orden: string
  /** IP del cliente, para el antifraude de CardNET. */
  clienteIp: string
  /** Factura/impuesto opcionales (DataDo). */
  invoice?: string
  tax?: number
}

export interface CobrarConTokenSalida extends ResultadoCompraToken {
  /** Respuesta cruda, ya sin datos sensibles, para guardar como evidencia. */
  crudo: Record<string, unknown>
}

/**
 * Cobra usando el token. Un solo POST al Purchase con la llave privada. El
 * `Capture: true` liquida el cargo en el acto (no es una pre-autorización).
 */
export async function cobrarConToken(input: CobrarConTokenInput): Promise<CobrarConTokenSalida> {
  const cfg = getTokensConfig()
  if (!cfg) {
    return {
      aprobada: false,
      autorizacion: null,
      codigo: '',
      motivo: 'El pago con tarjeta no está disponible.',
      crudo: {},
    }
  }

  const { api } = urlsTokens(cfg.ambiente)
  const cuerpo: Record<string, unknown> = {
    TrxToken: input.trxToken,
    Order: input.orden,
    Amount: montoEnteroMenor(input.pesos),
    Tip: 0,
    Currency: MONEDA_DOP_TOKENS,
    Capture: true,
    CustomerIP: input.clienteIp,
    DataDo: {
      Tax: String(input.tax ?? 0),
      Invoice: input.invoice ?? input.orden,
    },
  }

  let json: Record<string, unknown> = {}
  let ok = false
  try {
    const resp = await fetch(`${api}/Purchase`, {
      method: 'POST',
      headers: {
        // La llave privada es el valor Basic tal cual (así en el Postman de
        // CardNET), no un base64(user:pass).
        Authorization: `Basic ${cfg.privateKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(cuerpo),
      // Un cobro no debe colgarse indefinidamente.
      signal: AbortSignal.timeout(30_000),
    })
    ok = resp.ok
    json = (await resp.json().catch(() => ({}))) as Record<string, unknown>
    if (!resp.ok && Object.keys(json).length === 0) {
      json = { ResponseMessage: `HTTP ${resp.status}` }
    }
  } catch {
    return {
      aprobada: false,
      autorizacion: null,
      codigo: '',
      motivo: 'No se pudo contactar la pasarela. Intenta de nuevo.',
      crudo: {},
    }
  }

  const interpretado = interpretarCompraToken(json)
  // Si el HTTP no fue 2xx, no se aprueba aunque el cuerpo diga otra cosa.
  const aprobada = ok && interpretado.aprobada
  return {
    ...interpretado,
    aprobada,
    crudo: sinSensibles(json),
  }
}
