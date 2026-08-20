import { LRUCache } from 'lru-cache'

/**
 * Rate limiting DISTRIBUIDO (auditoría Enterprise · punto 1).
 *
 * Con `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` configuradas, el
 * límite se cuenta en Upstash Redis vía REST (ventana fija: pipeline atómico
 * INCR + PEXPIRE NX) — un límite GLOBAL real entre todas las instancias
 * serverless, sin dependencias nuevas (solo fetch).
 *
 * Sin esas variables (dev/preview) se usa el limitador local LRU de siempre.
 * Si Redis falla en runtime: FAIL-OPEN al limitador local con un warn —
 * preferimos disponibilidad a exactitud del límite; el freno por instancia
 * sigue activo.
 *
 * La API es asíncrona: `const ok = await limiter(id)`.
 */

interface RateLimitConfig {
  interval: number // Ventana en milisegundos
  maxRequests: number // Máximo de peticiones por ventana
  /** Prefijo legible de la clave en Redis (debug/observabilidad). */
  name?: string
}

interface RateLimitEntry {
  count: number
  resetAt: number
}

const DEFAULT_CONFIG: RateLimitConfig = {
  interval: 60 * 1000, // 1 minuto
  maxRequests: 10,
}

// ── Fallback local (por instancia) ───────────────────────────────────────────
const rateLimitCache = new LRUCache<string, RateLimitEntry>({
  max: 10000,
  ttl: 1000 * 60 * 60,
})

function checkLocal(key: string, config: RateLimitConfig): boolean {
  const now = Date.now()
  const entry = rateLimitCache.get(key)
  if (!entry || now > entry.resetAt) {
    rateLimitCache.set(key, { count: 1, resetAt: now + config.interval })
    return true
  }
  if (entry.count < config.maxRequests) {
    entry.count++
    return true
  }
  return false
}

// ── Upstash Redis por REST (sin SDK) ─────────────────────────────────────────

function upstashEnv(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  return url && token ? { url, token } : null
}

/**
 * Ventana fija en Redis: la clave incluye el nº de ventana, INCR cuenta y
 * PEXPIRE NX fija el TTL solo la primera vez. Un solo round-trip (pipeline).
 */
async function checkUpstash(
  key: string,
  config: RateLimitConfig,
  env: { url: string; token: string }
): Promise<boolean> {
  const window = Math.floor(Date.now() / config.interval)
  const redisKey = `rl:${key}:${window}`
  const res = await fetch(`${env.url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      ['INCR', redisKey],
      // Doble TTL: cubre relojes desalineados entre ventana y expiración.
      ['PEXPIRE', redisKey, String(config.interval * 2), 'NX'],
    ]),
    // El límite nunca debe colgar una acción: presupuesto corto.
    signal: AbortSignal.timeout(1500),
  })
  if (!res.ok) throw new Error(`upstash ${res.status}`)
  const data = (await res.json()) as Array<{ result?: number | string; error?: string }>
  const primero = data[0]
  if (!primero || primero.error !== undefined || primero.result === undefined) {
    throw new Error(`upstash pipeline: ${primero?.error ?? 'sin resultado'}`)
  }
  return Number(primero.result) <= config.maxRequests
}

// ── API pública ───────────────────────────────────────────────────────────────

export function createRateLimiter(config: RateLimitConfig = DEFAULT_CONFIG) {
  const prefix = config.name ?? 'rl'
  return async (identifier: string): Promise<boolean> => {
    const key = `${prefix}:${identifier}`
    const env = upstashEnv()
    if (!env) return checkLocal(key, config)
    try {
      return await checkUpstash(key, config, env)
    } catch (e) {
      // Fail-open al freno local: disponibilidad > exactitud del límite.
      console.warn('[rate-limit] Redis no disponible; usando límite local:', e)
      return checkLocal(key, config)
    }
  }
}

// Limitadores preconfigurados (misma semántica de siempre, ahora async)
export const loginLimiter = createRateLimiter({
  interval: 15 * 60 * 1000,
  maxRequests: 5,
  name: 'login',
})

export const registerLimiter = createRateLimiter({
  interval: 60 * 60 * 1000,
  maxRequests: 10,
  name: 'register',
})

export const qrScanLimiter = createRateLimiter({
  interval: 1 * 60 * 1000,
  maxRequests: 30,
  name: 'scan',
})

export const paymentLimiter = createRateLimiter({
  interval: 60 * 1000,
  maxRequests: 10,
  name: 'payment',
})

/**
 * ABRIR LA VENTANA DE PAGO — presupuesto PROPIO, separado del de los cobros.
 *
 * Compartía el de `paymentLimiter` (10/min entre las cinco rutas de pago), y
 * eso mezclaba dos cosas que no se parecen:
 *
 *   · Cobrar, activar, confirmar → MUEVEN DINERO. Un límite estrecho ahí es
 *     exactamente lo que se quiere: un bucle contra esas rutas es una forma de
 *     probar tarjetas.
 *   · Pedir la sesión de captura → es un GET al proveedor que devuelve una URL.
 *     No mueve dinero, no toca una tarjeta, y el navegador la pide sola al
 *     precargar la ventana.
 *
 * Juntas, la barata agotaba el presupuesto de la cara: el cliente se quedaba
 * sin poder COBRAR porque había abierto la pantalla de pago varias veces. Se
 * separan para que el límite de las rutas que mueven dinero quede intacto —
 * este cambio lo protege, no lo relaja.
 *
 * 30/min es el mismo techo que el escaneo de QR, otra operación frecuente,
 * legítima en ráfagas y sin efecto sobre el dinero.
 */
export const paymentSessionLimiter = createRateLimiter({
  interval: 60 * 1000,
  maxRequests: 30,
  name: 'payment-session',
})

export const formSubmitLimiter = createRateLimiter({
  interval: 60 * 1000,
  maxRequests: 20,
  name: 'form',
})

// Utility to get client identifier from request
export function getClientIdentifier(
  req: Request | { headers: Headers }
): string {
  const forwarded = req.headers.get('x-forwarded-for')
  const ip = forwarded ? forwarded.split(',')[0].trim() : 'unknown'
  return ip
}
