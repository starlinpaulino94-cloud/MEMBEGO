/**
 * Clave de idempotencia de UN envío de formulario: la acción la guarda junto al
 * movimiento y un segundo envío con la misma clave (doble clic, reintento de
 * red) devuelve el primero en vez de mover el stock otra vez. Se renueva tras
 * cada éxito.
 */
export function nuevaClave(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}
