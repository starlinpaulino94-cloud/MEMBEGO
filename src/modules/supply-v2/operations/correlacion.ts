import { nuevoCorrelationId } from './domain'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 2 · EL HILO DE LA OPERACIÓN (§9).
 *
 * Un `correlationId` es lo que permite contar una historia completa cuando algo
 * sale mal: la petición HTTP, la fila del inbox, el pago, la bitácora, el
 * efecto del outbox, el trabajo de la cola y los logs del worker llevan el
 * MISMO hilo. Sin él, investigar un pago es cruzar marcas de tiempo a mano.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRES REGLAS, Y LA TERCERA ES LA QUE IMPORTA
 *
 *   1. Si el proveedor trae uno utilizable, se respeta: así su rastro y el
 *      nuestro se pueden cruzar.
 *   2. Si no trae, o trae basura, se acuña uno. Nunca se sigue sin hilo.
 *   3. NO ES UNA CREDENCIAL. Llega por una cabecera que cualquiera puede
 *      poner, así que no autoriza nada, no identifica a nadie y no elige
 *      ninguna fila: solo se escribe. Lo contrario —«si trae el hilo de la
 *      operación, será suya»— convertiría una cabecera libre en un permiso.
 *
 * Y una cuarta, práctica: se acota. Un hilo es un identificador, no un sitio
 * donde meter texto. Sin tope, una cabecera de 8 KB acabaría copiada en la
 * fila del inbox, en cada efecto del outbox y en cada línea de log.
 */

/** Lo más largo que aceptamos. Un UUID con prefijo cabe de sobra. */
export const MAX_CORRELATION = 64
/** Lo más corto que distingue algo de otra cosa. */
export const MIN_CORRELATION = 8

/**
 * Forma admitida: letras, números, guion, guion bajo y punto. Sin espacios,
 * sin dos puntos, sin barras y sin nada que se pueda leer como otra cosa al
 * concatenarlo en una clave de deduplicación o en una línea de log.
 */
const RE_CORRELACION = /^[A-Za-z0-9._-]+$/

export function correlationIdValido(valor: unknown): valor is string {
  return (
    typeof valor === 'string' &&
    valor.length >= MIN_CORRELATION &&
    valor.length <= MAX_CORRELATION &&
    RE_CORRELACION.test(valor)
  )
}

/**
 * El hilo con el que se sigue adelante: el que vino si sirve, uno nuevo si no.
 *
 * Nunca devuelve vacío, y nunca devuelve lo que llegó sin comprobarlo.
 */
export function normalizarCorrelationId(valor: unknown): string {
  if (typeof valor === 'string') {
    const limpio = valor.trim()
    if (correlationIdValido(limpio)) return limpio
  }
  return nuevoCorrelationId()
}
