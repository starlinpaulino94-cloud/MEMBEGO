import 'server-only'
import {
  urlsTokens,
  apiCandidatos,
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
 * Formatos posibles del header de autenticación. Los documentos de CardNET se
 * contradicen: el Postman manda la llave CRUDA tras "Basic", el manual (§2.4)
 * dice que va como "username" de HTTP Basic (base64(key:)). El servidor prueba
 * en orden y se queda con el que el proveedor acepte (el 401 dice literalmente
 * "or is incorrectly formatted", así que el formato importa).
 */
function variantesAuth(privateKey: string): { nombre: string; valor: string }[] {
  return [
    { nombre: 'cruda', valor: `Basic ${privateKey}` },
    { nombre: 'basic-user', valor: `Basic ${Buffer.from(`${privateKey}:`).toString('base64')}` },
    { nombre: 'base64-simple', valor: `Basic ${Buffer.from(privateKey).toString('base64')}` },
  ]
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

  const { ok, status, json } = await postTokens('/Purchase', cuerpo)
  if (status === 0) {
    return {
      aprobada: false,
      autorizacion: null,
      codigo: '',
      motivo: 'No se pudo contactar la pasarela. Intenta de nuevo.',
      crudo: sinSensibles(json),
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

/** POST crudo contra UNA base con UN header de auth. Devuelve {ok, status, json}. */
async function postBase(
  base: string,
  path: string,
  cuerpo: Record<string, unknown> | null,
  authValor: string
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  try {
    const resp = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        Authorization: authValor,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(20_000),
    })
    const texto = await resp.text().catch(() => '')
    let json: Record<string, unknown>
    try {
      json = JSON.parse(texto) as Record<string, unknown>
    } catch {
      // Respuesta no-JSON (HTML de error, texto plano): conservarla acotada
      // para diagnóstico — sin ella, un fallo del proveedor es invisible.
      json = texto ? { _texto: texto.slice(0, 500) } : {}
    }
    return { ok: resp.ok, status: resp.status, json }
  } catch (e) {
    return { ok: false, status: 0, json: { _error: e instanceof Error ? e.message : 'fetch' } }
  }
}

// Base y formato de auth que ya funcionaron en esta instancia: las llamadas
// siguientes van directo, sin re-probar candidatos.
let baseConfirmada: string | null = null
let authConfirmada: string | null = null

/**
 * POST autenticado a la API de tokens. Prueba las bases candidatas (un 404 o
 * fallo de red pasa a la siguiente) y, dentro del host vivo, los formatos de
 * auth (un 401 pasa al siguiente formato). El primero que logra 2xx queda
 * fijado para el resto de la vida de la instancia.
 */
async function postTokens(
  path: string,
  cuerpo: Record<string, unknown> | null
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const cfg = getTokensConfig()
  if (!cfg) return { ok: false, status: 0, json: {} }

  if (baseConfirmada && authConfirmada) {
    return postBase(baseConfirmada, path, cuerpo, authConfirmada)
  }

  let mejor: { ok: boolean; status: number; json: Record<string, unknown> } | null = null
  for (const base of apiCandidatos(cfg.ambiente)) {
    for (const auth of variantesAuth(cfg.privateKey)) {
      const r = await postBase(base, path, cuerpo, auth.valor)
      if (r.ok) {
        baseConfirmada = base
        authConfirmada = auth.valor
        return r
      }
      // Host muerto o ruta inexistente: no tiene sentido probar más formatos aquí.
      if (r.status === 0 || r.status === 404) break
      if (!mejor) mejor = r
      // Otro error que no es de auth (400, 500): el formato no es el problema.
      if (r.status !== 401 && r.status !== 403) break
    }
  }
  return mejor ?? { ok: false, status: 0, json: { _error: 'ningún host respondió' } }
}

/**
 * DIAGNÓSTICO: intenta crear un Customer contra cada base candidata y cada
 * formato de auth, y devuelve status + respuesta (sin datos sensibles) de cada
 * intento. No expone llaves. Si TODOS dan 401, la llave no pertenece a la
 * cuenta y hay que reclamarla a CardNET.
 */
export async function probarSesionTokens(): Promise<
  { url: string; formato: string; ok: boolean; status: number; respuesta: Record<string, unknown> }[]
> {
  const cfg = getTokensConfig()
  if (!cfg) return []
  const resultados = []
  for (const base of apiCandidatos(cfg.ambiente)) {
    for (const auth of variantesAuth(cfg.privateKey)) {
      const r = await postBase(
        base,
        '/customer',
        { Email: 'diagnostico@membego.com', Enable: 'true' },
        auth.valor
      )
      resultados.push({
        url: `${base}/customer`,
        formato: auth.nombre,
        ok: r.ok,
        status: r.status,
        respuesta: sinSensibles(r.json),
      })
      // Host muerto/ruta inexistente: pasar al siguiente host.
      if (r.status === 0 || r.status === 404) break
    }
  }
  return resultados
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
