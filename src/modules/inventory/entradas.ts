import { costoADecimal, costoOpcional } from './costos'
import { CANTIDAD_MAXIMA, validarCantidad } from './domain'

/**
 * COMMERCE CORE · inventario — INV-2a: las reglas PURAS de una entrada de
 * mercancía con varias líneas.
 *
 * Sin Prisma ni base: las usan el servicio (que las vuelve a aplicar, porque no
 * confía en lo que manda el navegador), el formulario y las pruebas.
 */

/** Líneas máximas de una entrada capturada a mano. */
export const MAX_LINEAS_ENTRADA = 200
/** Líneas máximas de un archivo CSV: lo acota el tiempo de una transacción (45 s). */
export const MAX_LINEAS_IMPORTACION = 1000
export const MAX_REFERENCIA = 120
export const MAX_NOTA = 500

export interface LineaEntrada {
  varianteId: string
  cantidad: number
  /**
   * INV-3a: costo unitario de la línea, ya normalizado con cuatro decimales (`'12.5000'`). Falta (o es null) cuando no se
   * capturó: una entrada sin costo es válida y no mueve el costo promedio. Sin impuestos.
   */
  costo?: string | null
}

export type ResultadoLineas = { ok: true; lineas: LineaEntrada[]; unidades: number } | { ok: false; codigo: string; error: string }

/**
 * Valida las líneas de una entrada: al menos una, no más del tope, cada
 * variante UNA sola vez y cada cantidad un entero de 1 a CANTIDAD_MAXIMA.
 * Las repetidas NO se suman aquí (eso sería adivinar): quien captura a mano las
 * fusiona antes con `fusionarLineas`, y un CSV con filas repetidas se rechaza.
 */
export function validarLineasEntrada(lineas: unknown, max: number = MAX_LINEAS_ENTRADA): ResultadoLineas {
  if (!Array.isArray(lineas) || lineas.length === 0) return { ok: false, codigo: 'ENTRADA_SIN_LINEAS', error: 'Agrega al menos un producto a la entrada.' }
  if (lineas.length > max) return { ok: false, codigo: 'DEMASIADAS_LINEAS', error: `Una entrada admite hasta ${max} productos; esta trae ${lineas.length}. Divídela en varias.` }
  const vistas = new Set<string>()
  const limpias: LineaEntrada[] = []
  let unidades = 0
  for (const crudo of lineas as unknown[]) {
    const l = crudo as { varianteId?: unknown; cantidad?: unknown; costo?: unknown } | null
    const id = typeof l?.varianteId === 'string' ? l.varianteId.trim() : ''
    if (id === '' || id.length > 120) return { ok: false, codigo: 'LINEA_INVALIDA', error: 'Una de las líneas no indica qué producto es.' }
    if (vistas.has(id)) return { ok: false, codigo: 'LINEA_REPETIDA', error: 'Un producto aparece más de una vez en la entrada: junta sus cantidades en una sola línea.' }
    vistas.add(id)
    const c = validarCantidad(l?.cantidad)
    if (!c.ok) return { ok: false, codigo: 'CANTIDAD_INVALIDA', error: c.error }
    const costo = costoOpcional(l?.costo)
    if (!costo.ok) return { ok: false, codigo: 'COSTO_INVALIDO', error: `Línea ${limpias.length + 1}: ${costo.error}` }
    limpias.push(costo.valor === null ? { varianteId: id, cantidad: c.valor } : { varianteId: id, cantidad: c.valor, costo: costoADecimal(costo.valor) })
    unidades += c.valor
  }
  return { ok: true, lineas: limpias, unidades }
}

/**
 * Junta las líneas que apuntan a la misma variante sumando sus cantidades, en el
 * orden de la primera aparición. Es lo que hace el formulario al escanear dos
 * veces el mismo producto.
 */
export function fusionarLineas(lineas: readonly LineaEntrada[]): LineaEntrada[] {
  const porId = new Map<string, { cantidad: number; costo: string | null }>()
  for (const l of lineas) {
    const previa = porId.get(l.varianteId)
    // Si dos escaneos traen costos distintos manda el primero que traiga uno.
    porId.set(l.varianteId, { cantidad: (previa?.cantidad ?? 0) + l.cantidad, costo: previa?.costo ?? l.costo ?? null })
  }
  return [...porId.entries()].map(([varianteId, x]) => (x.costo === null ? { varianteId, cantidad: Math.min(x.cantidad, CANTIDAD_MAXIMA) } : { varianteId, cantidad: Math.min(x.cantidad, CANTIDAD_MAXIMA), costo: x.costo }))
}

/** Un texto libre acotado (factura, nota): recortado y sin saltos raros, o error. */
export function normalizarTextoLibre(v: unknown, max: number, nombre: string): { ok: true; valor: string | null } | { ok: false; error: string } {
  if (v === undefined || v === null) return { ok: true, valor: null }
  if (typeof v !== 'string') return { ok: false, error: `${nombre} no es válida.` }
  const t = v.trim().replace(/\s+/g, ' ')
  if (t.length > max) return { ok: false, error: `${nombre} no puede pasar de ${max} caracteres.` }
  return { ok: true, valor: t === '' ? null : t }
}

/** El prefijo del correlativo de las entradas: `ENT-2026-000001`. */
export const PREFIJO_ENTRADA = 'ENT'
