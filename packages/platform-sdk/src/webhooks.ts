import { createHmac, createPublicKey, timingSafeEqual, verify } from 'node:crypto'
import {
  CABECERA_EVENTO,
  CABECERA_FIRMA,
  CABECERA_FIRMA_HMAC,
  CABECERA_TIMESTAMP,
  VENTANA_REPLAY_SEGUNDOS,
  materialFirmado,
  type CuerpoWebhook,
} from '@membego/contracts'

/**
 * SDK · verificación de los webhooks de MembeGo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SOBRE EL CUERPO CRUDO, SIEMPRE
 *
 * `verificarWebhook` recibe el **texto** del cuerpo, no un objeto. No es una
 * comodidad de la API: volver a serializar un objeto produce, tarde o temprano,
 * otra cadena —otro orden de claves, otro espaciado— y una firma que se rechaza
 * sin que nadie entienda por qué.
 *
 * En Express eso significa `express.raw({ type: 'application/json' })` ANTES de
 * `express.json()`. Es el error de integración más común con webhooks firmados,
 * y el que más tiempo cuesta encontrar, porque el código «parece» correcto.
 */

export type FalloWebhook =
  | 'SIN_FIRMA'
  | 'FIRMA_INVALIDA'
  | 'FUERA_DE_VENTANA'
  | 'CUERPO_INVALIDO'
  | 'SIN_VERIFICADOR'

export type ResultadoWebhook =
  | { ok: true; evento: CuerpoWebhook }
  | { ok: false; fallo: FalloWebhook }

/** Cabeceras, en cualquiera de las formas en que las dan los frameworks. */
export type Cabeceras = Headers | Record<string, string | string[] | undefined>

function leer(cabeceras: Cabeceras, nombre: string): string | null {
  if (typeof (cabeceras as Headers).get === 'function') {
    return (cabeceras as Headers).get(nombre)
  }
  const plano = cabeceras as Record<string, string | string[] | undefined>
  // Node baja las cabeceras a minúsculas; un objeto a mano puede no hacerlo.
  const v = plano[nombre] ?? plano[nombre.toLowerCase()]
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

export interface OpcionesVerificacion {
  /**
   * Clave pública Ed25519 de MembeGo, en PEM.
   * Se obtiene de `GET /api/platform/v1/.well-known/keys`.
   */
  clavePublicaPem?: string
  /**
   * Secreto compartido, para verificar la firma HMAC anterior.
   *
   * Existe solo para la ventana de migración. Si se pasan los dos, manda
   * Ed25519 — con el HMAC, quien puede verificar puede falsificar, así que
   * mientras se acepte, cualquiera que tenga ese secreto puede fabricar eventos.
   */
  secretoCompartido?: string
  ahoraEpoch?: number
  ventanaSegundos?: number
}

/**
 * Verifica y devuelve el evento. **Nunca lanza**: un webhook mal firmado es un
 * resultado, no una excepción — quien llama tiene que poder responder 400 sin
 * envolverlo todo en un try.
 */
export function verificarWebhook(
  cuerpoCrudo: string,
  cabeceras: Cabeceras,
  opciones: OpcionesVerificacion
): ResultadoWebhook {
  const ahora = opciones.ahoraEpoch ?? Math.floor(Date.now() / 1000)
  const ventana = opciones.ventanaSegundos ?? VENTANA_REPLAY_SEGUNDOS

  const firma = leer(cabeceras, CABECERA_FIRMA)
  const hmac = leer(cabeceras, CABECERA_FIRMA_HMAC)
  const timestampBruto = leer(cabeceras, CABECERA_TIMESTAMP)
  const eventId = leer(cabeceras, CABECERA_EVENTO)

  if (!opciones.clavePublicaPem && !opciones.secretoCompartido) {
    return { ok: false, fallo: 'SIN_VERIFICADOR' }
  }

  // ── Ed25519, la buena ───────────────────────────────────────────────────
  if (opciones.clavePublicaPem && firma && timestampBruto && eventId) {
    const timestamp = Number(timestampBruto)
    if (!Number.isFinite(timestamp)) return { ok: false, fallo: 'FIRMA_INVALIDA' }
    if (Math.abs(ahora - timestamp) > ventana) return { ok: false, fallo: 'FUERA_DE_VENTANA' }

    let valida = false
    try {
      valida = verify(
        null,
        Buffer.from(materialFirmado(timestamp, eventId, cuerpoCrudo), 'utf8'),
        createPublicKey(opciones.clavePublicaPem),
        Buffer.from(firma, 'base64')
      )
    } catch {
      valida = false
    }
    if (!valida) return { ok: false, fallo: 'FIRMA_INVALIDA' }
    return interpretar(cuerpoCrudo)
  }

  // ── HMAC, la de la ventana de migración ─────────────────────────────────
  if (opciones.secretoCompartido && hmac) {
    const esperada = createHmac('sha256', opciones.secretoCompartido)
      .update(cuerpoCrudo, 'utf8')
      .digest('hex')
    const a = Buffer.from(esperada, 'utf8')
    const b = Buffer.from(hmac, 'utf8')
    // Comparación en tiempo constante: un `===` filtra por tiempo cuántos bytes
    // acertó quien prueba, y con eso se descubre una firma byte a byte.
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, fallo: 'FIRMA_INVALIDA' }
    }
    return interpretar(cuerpoCrudo)
  }

  return { ok: false, fallo: 'SIN_FIRMA' }
}

function interpretar(cuerpoCrudo: string): ResultadoWebhook {
  try {
    const evento = JSON.parse(cuerpoCrudo) as CuerpoWebhook
    if (!evento?.eventId || !evento?.companyId) return { ok: false, fallo: 'CUERPO_INVALIDO' }
    return { ok: true, evento }
  } catch {
    return { ok: false, fallo: 'CUERPO_INVALIDO' }
  }
}
