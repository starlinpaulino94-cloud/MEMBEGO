/**
 * PLATAFORMA · Fase 6 — LA REGLA DEL TELÉFONO, SIN SERVIDOR DETRÁS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTÁ SEPARADA
 *
 * `consultas.ts` empieza con `import 'server-only'` —y debe seguir haciéndolo,
 * porque abre transacciones con la base—. Pero esta comparación es una decisión
 * de negocio pura, y es justo la que hay que poder probar caso por caso.
 *
 * Importar el módulo entero desde una prueba arrastraría `server-only`, que
 * revienta fuera del contexto de Next: el archivo no carga y la prueba no falla
 * con una aserción, desaparece. Ya pasó con `idempotencia` (Fase 3) y con `sso`
 * (Fase 5); la separación es el mismo remedio, y aquí está por el mismo motivo.
 */

/** Mínimo de dígitos para que un teléfono identifique a alguien. */
export const MINIMO_DIGITOS_TELEFONO = 7

/**
 * Cuánto puede sobrar por delante: un prefijo internacional («+1», «+34»,
 * «+593»). Más que eso ya no es un prefijo, es otro número.
 */
const MAX_PREFIJO = 3

/**
 * ¿Son el mismo número, escrito distinto?
 *
 * ESTE FALLO EXISTIÓ, y lo encontró la prueba contra base real: la comparación
 * era `guardado.endsWith(consultado)`, en una sola dirección. Con el cliente
 * guardado como «809-555-1234» y un satélite preguntando por «+18095551234»
 * —el formato E.164, que es el que manda cualquier integración seria— la
 * respuesta era «no existe».
 *
 * Y ese es el peor fallo posible aquí: el empleado concluye que el cliente no
 * tiene membresía y le cobra el precio completo.
 *
 * La comparación es simétrica y ACOTADA: uno tiene que ser sufijo del otro y
 * sobrar como mucho un prefijo internacional. Sin ese tope, «5551234» casaría
 * con cualquier número del mundo que acabe igual — y confundir dos clientes es
 * peor que no encontrar a uno.
 */
export function mismoTelefono(a: string, b: string): boolean {
  const x = a.replace(/\D/g, '')
  const y = b.replace(/\D/g, '')
  if (x.length < MINIMO_DIGITOS_TELEFONO || y.length < MINIMO_DIGITOS_TELEFONO) return false
  if (x === y) return true

  const [corto, largo] = x.length <= y.length ? [x, y] : [y, x]
  return largo.length - corto.length <= MAX_PREFIJO && largo.endsWith(corto)
}
