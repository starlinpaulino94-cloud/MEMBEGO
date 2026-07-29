import { randomBytes } from 'crypto'

/**
 * GENERACIÓN Y CADUCIDAD DE TOKENS QR (auditoría de producción · A-02).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ESTABA MAL
 *
 * El token venía de `@default(cuid())` en el esquema. cuid es
 * *marca de tiempo + contador + huella de máquina + cuatro caracteres al azar*:
 * está diseñado para no COLISIONAR, no para no ADIVINARSE. Conocidos dos
 * tokens emitidos por el mismo servidor, el espacio de búsqueda del siguiente
 * se reduce drásticamente — la parte de tiempo y la huella son las mismas, y
 * el contador es secuencial.
 *
 * Un token QR no es un identificador: es una credencial al portador. Vale un
 * lavado. Se envía por WhatsApp, se enseña en una pantalla y se fotografía.
 *
 * Lo que impedía que fuera CRÍTICO en el informe es que canjear exige sesión de
 * empleado, así que adivinar un token no basta por sí solo. Pero la defensa no
 * puede ser solo esa: un empleado descontento con la lista de tokens probables
 * de mañana es exactamente el escenario que esto cierra.
 *
 * CÓMO QUEDA
 *
 *  · 24 bytes de `randomBytes` en base64url = 192 bits de entropía real. No hay
 *    forma de adivinar el siguiente conociendo los anteriores.
 *  · CADUCIDAD. Antes un token vivía para siempre hasta que se usaba. Un QR
 *    compartido por WhatsApp hace ocho meses seguía siendo canjeable. Ahora
 *    vence, y lo que vence deja de ser un riesgo que se acumula.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * Días que vive un token antes de caducar.
 *
 * 90 días, no 7: el QR de una membresía anual se enseña muchas veces a lo
 * largo del año y no se regenera en cada visita. Una caducidad corta
 * convertiría "mi QR no funciona" en el problema más frecuente del negocio, y
 * la respuesta del personal sería pedir que se regenere sin mirar — que es
 * peor que no tener caducidad.
 */
export const DIAS_VIGENCIA_QR = 90

/**
 * Token nuevo: 24 bytes aleatorios en base64url (32 caracteres).
 *
 * base64url y no hex porque cabe más entropía en menos caracteres, y el QR
 * resultante tiene menos módulos: se lee más rápido y desde más lejos, que en
 * una pista con sol de mediodía no es un detalle estético.
 */
export function nuevoTokenQr(): string {
  return randomBytes(24).toString('base64url')
}

/** Momento en que caduca un token emitido ahora. */
export function vencimientoQr(desde: Date = new Date()): Date {
  const d = new Date(desde)
  d.setDate(d.getDate() + DIAS_VIGENCIA_QR)
  return d
}

/**
 * ¿Está vencido este token?
 *
 * `expiraAt` nulo significa "emitido antes de que existiera la caducidad". Se
 * tratan como VIGENTES a propósito: invalidar de golpe todos los QR ya
 * repartidos dejaría a los clientes actuales en la puerta del car wash con un
 * código que ayer funcionaba. Los tokens antiguos se van renovando solos según
 * se usan, y la migración pone fecha a los que quedan.
 */
export function qrVencido(expiraAt: Date | null | undefined, ahora: Date = new Date()): boolean {
  if (!expiraAt) return false
  return expiraAt.getTime() <= ahora.getTime()
}
