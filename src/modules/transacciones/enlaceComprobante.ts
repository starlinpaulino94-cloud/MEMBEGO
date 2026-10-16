import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * ENLACE FIRMADO A UN COMPROBANTE (16-10-2026).
 *
 * La app del teléfono autentica con `Authorization: Bearer`, pero imprimir se
 * hace en el navegador del sistema (Chrome/Safari), que no tiene esa sesión.
 * En vez de pedirle al cliente que inicie sesión otra vez, la app pide al
 * servidor un enlace firmado y de vida corta: `/comprobante/<id>.<exp>.<firma>`.
 * La firma es un HMAC del id y la caducidad, así que ni el id ni la fecha se
 * pueden cambiar sin romperla, y pasado el plazo el enlace muere solo.
 *
 * Lo que da acceso es la firma, no el id: un id de transacción adivinado sin
 * firma no abre nada. Por eso el secreto nunca viaja y la verificación compara
 * en tiempo constante.
 */

export const VIGENCIA_ENLACE_MIN = 20

function secreto(): string {
  const s = process.env.COMPROBANTES_SECRET ?? process.env.SUPABASE_JWT_SECRET
  if (!s) throw new Error('Falta SUPABASE_JWT_SECRET (o COMPROBANTES_SECRET) para firmar enlaces de comprobantes')
  return s
}

function firma(transactionId: string, exp: number): string {
  return createHmac('sha256', secreto()).update(`comprobante:${transactionId}:${exp}`).digest('base64url')
}

/** `id.exp.firma`, con `exp` en segundos Unix. */
export function firmarEnlaceComprobante(transactionId: string, ahoraMs = Date.now()): string {
  if (!/^[A-Za-z0-9_-]+$/.test(transactionId)) throw new Error('Id de transacción no válido para firmar')
  const exp = Math.floor(ahoraMs / 1000) + VIGENCIA_ENLACE_MIN * 60
  return `${transactionId}.${exp}.${firma(transactionId, exp)}`
}

/** Devuelve el id de la transacción si el enlace es auténtico y no ha caducado; si no, null. */
export function verificarEnlaceComprobante(token: string, ahoraMs = Date.now()): string | null {
  const partes = token.split('.')
  if (partes.length !== 3) return null
  const [transactionId, expRaw, firmaRecibida] = partes
  if (!/^[A-Za-z0-9_-]+$/.test(transactionId) || !/^\d+$/.test(expRaw)) return null
  const exp = Number(expRaw)
  if (exp * 1000 < ahoraMs) return null
  const esperada = Buffer.from(firma(transactionId, exp))
  const recibida = Buffer.from(firmaRecibida)
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return null
  return transactionId
}

export function rutaComprobantePublico(token: string): string {
  return `/comprobante/${token}`
}
