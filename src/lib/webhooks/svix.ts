import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Verificación de firma de webhooks estilo Svix (el que usa Resend).
 *
 * POR QUÉ ES OBLIGATORIA, Y NO UNA BUENA PRÁCTICA
 *
 * El endpoint de recepción de correo es público por definición: Resend tiene
 * que poder llamarlo sin credenciales nuestras. Sin verificar la firma,
 * CUALQUIERA que descubra la URL puede escribir mensajes en los tickets de
 * cualquier empresa haciéndose pasar por un cliente. La firma es lo único que
 * separa "un correo que recibimos" de "un POST que alguien nos mandó".
 *
 * ESQUEMA
 *
 *   contenido = `${svix-id}.${svix-timestamp}.${cuerpo crudo}`
 *   esperada  = base64( HMAC-SHA256( clave, contenido ) )
 *
 * La clave es la parte que sigue a `whsec_`, decodificada de base64. La
 * cabecera `svix-signature` puede traer VARIAS firmas separadas por espacio
 * (`v1,<firma> v1,<otra>`) porque el secreto se puede rotar: basta que UNA
 * coincida.
 *
 * Se implementa a mano y no con el SDK `svix` por lo mismo que `lib/email.ts`
 * llama a la API con `fetch`: es un HMAC de quince líneas y no justifica una
 * dependencia más en el árbol de producción.
 */

/** Ventana de tolerancia del reloj. Fuera de ella se rechaza por antigüedad. */
export const TOLERANCIA_SEGUNDOS = 5 * 60

export interface CabecerasSvix {
  id: string | null
  timestamp: string | null
  signature: string | null
}

export type ResultadoFirma =
  | { valida: true }
  | { valida: false; motivo: string }

/**
 * Compara en tiempo constante. Las longitudes distintas se descartan antes:
 * `timingSafeEqual` lanza si difieren, y esa excepción sería en sí misma un
 * canal lateral.
 */
function igualesSeguro(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

export function verificarFirmaSvix(
  cuerpoCrudo: string,
  cabeceras: CabecerasSvix,
  secreto: string | undefined,
  ahoraSegundos: number
): ResultadoFirma {
  if (!secreto) return { valida: false, motivo: 'RESEND_WEBHOOK_SECRET no configurada' }
  const { id, timestamp, signature } = cabeceras
  if (!id || !timestamp || !signature) {
    return { valida: false, motivo: 'faltan cabeceras svix' }
  }

  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return { valida: false, motivo: 'timestamp no numérico' }
  // Se rechaza tanto lo viejo como lo del futuro: un reloj adelantado en el
  // emisor no debe abrir una ventana de reenvío indefinida.
  if (Math.abs(ahoraSegundos - ts) > TOLERANCIA_SEGUNDOS) {
    return { valida: false, motivo: 'timestamp fuera de la ventana de tolerancia' }
  }

  const clave = Buffer.from(secreto.replace(/^whsec_/, ''), 'base64')
  if (clave.length === 0) return { valida: false, motivo: 'secreto vacío o mal formado' }

  const esperada = createHmac('sha256', clave)
    .update(`${id}.${timestamp}.${cuerpoCrudo}`)
    .digest('base64')

  for (const parte of signature.split(' ')) {
    const [version, firma] = parte.split(',')
    if (version !== 'v1' || !firma) continue
    if (igualesSeguro(firma, esperada)) return { valida: true }
  }
  return { valida: false, motivo: 'firma no coincide' }
}
