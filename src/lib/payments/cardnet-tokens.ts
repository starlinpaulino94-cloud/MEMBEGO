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

/**
 * Header de autenticación de CardNET. El manual (§2.4) es explícito: la API Key
 * va como el "username" de HTTP Basic, SIN password. O sea `Basic
 * base64(key + ":")`, NO la llave en crudo. (El Postman ponía la llave cruda,
 * pero devolvía errores; el manual manda.)
 */
function basicAuth(privateKey: string): string {
  return `Basic ${Buffer.from(`${privateKey}:`).toString('base64')}`
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
        Authorization: basicAuth(cfg.privateKey),
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

// ── Fase 2: tarjeta guardada (cobros recurrentes) ───────────────────────────
//
// Estas tres llamadas salen del Postman de tokenización de CardNET. El header
// de autorización es la LLAVE PRIVADA (secreto de servidor).

/** Hace un POST autenticado a la API de tokens. Devuelve {ok, json}. */
async function postTokens(
  path: string,
  cuerpo: Record<string, unknown> | null
): Promise<{ ok: boolean; json: Record<string, unknown> }> {
  const cfg = getTokensConfig()
  if (!cfg) return { ok: false, json: {} }
  const { api } = urlsTokens(cfg.ambiente)
  try {
    const resp = await fetch(`${api}${path}`, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(cfg.privateKey),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(30_000),
    })
    const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>
    return { ok: resp.ok, json }
  } catch {
    return { ok: false, json: {} }
  }
}

/**
 * SESIÓN DE CAPTURA (paso previo OBLIGATORIO a abrir el iframe).
 *
 * El manual de tokenización (§4) es claro: NO se puede abrir el iframe con un
 * `session_id` inventado — eso da `TK004 INVALID_SESSION_IDENTIFIER` (el 500
 * que veíamos). Hay que crear un Customer en el servidor; CardNET devuelve un
 * `CaptureURL` y un `UniqueID` válidos, y con ESOS se abre el iframe.
 *
 * Devuelve lo que el navegador necesita (CaptureURL + UniqueID). NUNCA la llave
 * privada. VERIFICAR-QA: la grafía exacta de los campos de respuesta.
 */
export async function crearSesionCaptura(input: {
  email: string
}): Promise<{ captureUrl: string; uniqueId: string; customerId: string } | null> {
  const { ok, json } = await postTokens('/customer', {
    Email: input.email,
    Enable: 'true',
  })
  if (!ok) return null
  const s = (...ks: string[]) => {
    for (const k of ks) {
      const v = json[k]
      if (typeof v === 'string' && v) return v
      if (typeof v === 'number') return String(v)
    }
    return ''
  }
  const captureUrl = s('CaptureURL', 'captureUrl', 'CaptureUrl')
  const uniqueId = s('UniqueID', 'UniqueId', 'uniqueId')
  const customerId = s('CustomerId', 'customerId', 'Id', 'id')
  if (!captureUrl || !uniqueId) return null
  return { captureUrl, uniqueId, customerId }
}

/**
 * Crea (o registra) un Customer en CardNET. Devuelve el CustomerId con el que
 * luego se asocia el perfil de pago. `POST /api/Customer`.
 */
export async function crearClienteCardnet(input: {
  email: string
  nombre?: string
  apellido?: string
}): Promise<{ customerId: string } | null> {
  const { ok, json } = await postTokens('/Customer', {
    Email: input.email,
    ...(input.nombre ? { FirstName: input.nombre } : {}),
    ...(input.apellido ? { LastName: input.apellido } : {}),
    Enable: 'true',
  })
  if (!ok) return null
  // VERIFICAR-QA: el nombre del campo del id puede variar (CustomerId/Id).
  const id =
    (json.CustomerId ?? json.customerId ?? json.Id ?? json.id ?? '') as string | number
  const customerId = String(id).trim()
  return customerId ? { customerId } : null
}

/**
 * Cobra una CREDENCIAL GUARDADA (renovación recurrente). Reutiliza el mismo
 * Purchase, pero con las referencias almacenadas en vez de un token de un solo
 * uso.
 *
 * VERIFICAR-QA (importante): la forma exacta de referenciar la tarjeta
 * archivada en el Purchase solo se confirma con CardNET. Se envían todas las
 * referencias que tengamos (token/CustomerId/PaymentProfileId) y se marca la
 * transacción como recurrente. Cuando QA revele el contrato real, se ajusta
 * SOLO este cuerpo — el resto del flujo (activación, idempotencia) no cambia.
 */
export async function cobrarConCredencialGuardada(input: {
  customerId: string
  paymentProfileId?: string | null
  token?: string | null
  pesos: number
  orden: string
  clienteIp: string
}): Promise<CobrarConTokenSalida> {
  const cuerpo: Record<string, unknown> = {
    ...(input.token ? { TrxToken: input.token } : {}),
    CustomerId: input.customerId,
    ...(input.paymentProfileId ? { PaymentProfileId: input.paymentProfileId } : {}),
    Order: input.orden,
    Amount: montoEnteroMenor(input.pesos),
    Tip: 0,
    Currency: MONEDA_DOP_TOKENS,
    Capture: true,
    CustomerIP: input.clienteIp,
    // Marca de credencial archivada / recurrente (nombres del ZTRANS).
    Environment: 'Ecommerce_COF',
    DataDo: { Tax: '0', Invoice: input.orden },
  }
  const { ok, json } = await postTokens('/Purchase', cuerpo)
  const interpretado = interpretarCompraToken(json)
  return { ...interpretado, aprobada: ok && interpretado.aprobada, crudo: sinSensibles(json) }
}

/**
 * Borra un perfil de pago guardado (el cliente quita su tarjeta).
 * `POST /api/Customer/{id}/PaymentProfileDelete`.
 */
export async function borrarPerfilCardnet(input: {
  customerId: string
  paymentProfileId: string
}): Promise<boolean> {
  const { ok } = await postTokens(`/Customer/${encodeURIComponent(input.customerId)}/PaymentProfileDelete`, {
    PaymentProfileId: input.paymentProfileId,
  })
  return ok
}
