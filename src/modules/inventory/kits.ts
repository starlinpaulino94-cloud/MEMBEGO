import { CANTIDAD_MAXIMA } from './domain'

/**
 * COMMERCE CORE · inventario — INV-5d: las reglas PURAS de los KITS (nada de base de datos).
 *
 * Un kit es una variante del catálogo que NO lleva existencias propias: se arma con una RECETA de componentes y cuántas unidades de cada uno.
 * Lo que hay "de un kit" es lo que alcanza de sus componentes; venderlo aparta, vende, libera y devuelve los componentes.
 */

/** Componentes que cabe en una receta (más que esto ya no es un kit, es un surtido). */
export const MAX_COMPONENTES_POR_KIT = 30
/** Unidades de un componente por kit (y por pedido): el máximo de un movimiento. */
export const MAX_UNIDADES_POR_COMPONENTE = CANTIDAD_MAXIMA

export interface ComponenteDeReceta {
  varianteId: string
  /** Unidades del componente por cada kit. */
  cantidad: number
}

export type ResultadoReceta = { ok: true; receta: ComponenteDeReceta[] } | { ok: false; codigo: string; error: string }

/**
 * La receta que se guarda: al menos un componente, ninguno repetido, cada cantidad un entero de 1 al máximo de un movimiento, y el kit no es
 * componente de sí mismo. Sale ordenada por id de variante (el orden en que se aparta: dos ventas de kits no se interbloquean).
 */
export function validarReceta(componentes: unknown, kitVarianteId: string): ResultadoReceta {
  if (!Array.isArray(componentes) || componentes.length === 0) return { ok: false, codigo: 'RECETA_VACIA', error: 'Un kit necesita al menos un componente.' }
  if (componentes.length > MAX_COMPONENTES_POR_KIT) return { ok: false, codigo: 'RECETA_LARGA', error: `Un kit admite hasta ${MAX_COMPONENTES_POR_KIT} componentes.` }
  const vistos = new Set<string>()
  const receta: ComponenteDeReceta[] = []
  for (const crudo of componentes as unknown[]) {
    const c = crudo as { varianteId?: unknown; cantidad?: unknown } | null
    if (typeof c?.varianteId !== 'string' || c.varianteId === '') return { ok: false, codigo: 'COMPONENTE_INVALIDO', error: 'Uno de los componentes no indica qué producto es.' }
    if (c.varianteId === kitVarianteId) return { ok: false, codigo: 'KIT_ES_SU_COMPONENTE', error: 'Un kit no puede ser componente de sí mismo.' }
    if (vistos.has(c.varianteId)) return { ok: false, codigo: 'COMPONENTE_REPETIDO', error: 'Un producto aparece dos veces en la receta: súmalo en un solo renglón.' }
    vistos.add(c.varianteId)
    const n = c.cantidad
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > CANTIDAD_MAXIMA) {
      return { ok: false, codigo: 'CANTIDAD_INVALIDA', error: `La cantidad de cada componente es un entero de 1 a ${CANTIDAD_MAXIMA.toLocaleString('es-DO')}.` }
    }
    receta.push({ varianteId: c.varianteId, cantidad: n })
  }
  return { ok: true, receta: receta.sort((a, b) => (a.varianteId < b.varianteId ? -1 : a.varianteId > b.varianteId ? 1 : 0)) }
}

/** Las unidades de cada componente que piden `kits` kits (cada una entre 1 y el máximo de un movimiento), o el error. */
export function unidadesParaKits(receta: readonly ComponenteDeReceta[], kits: number): { ok: true; unidades: ComponenteDeReceta[] } | { ok: false; codigo: string; error: string } {
  if (!Number.isInteger(kits) || kits < 1) return { ok: false, codigo: 'CANTIDAD_INVALIDA', error: 'La cantidad de kits es un entero de 1 en adelante.' }
  const unidades = receta.map((c) => ({ varianteId: c.varianteId, cantidad: c.cantidad * kits }))
  if (unidades.some((u) => u.cantidad > CANTIDAD_MAXIMA)) {
    return { ok: false, codigo: 'CANTIDAD_INVALIDA', error: `Esa cantidad de kits pide más de ${CANTIDAD_MAXIMA.toLocaleString('es-DO')} unidades de un componente.` }
  }
  return { ok: true, unidades }
}

export interface DisponibilidadDeKit {
  /** Cuántos kits se pueden armar con lo disponible (0 si falta algún componente o la receta está vacía). */
  kits: number
  /** El componente que limita (el primero que da el mínimo), o null si no hay receta. */
  limitante: string | null
}

/**
 * Cuántos kits alcanzan: el MÍNIMO, entre los componentes, de lo disponible dividido entre lo que lleva cada kit (hacia abajo). Un componente
 * del que no se sabe nada cuenta como cero disponible.
 */
export function disponibilidadDeKit(receta: readonly ComponenteDeReceta[], disponiblePorComponente: ReadonlyMap<string, number>): DisponibilidadDeKit {
  if (receta.length === 0) return { kits: 0, limitante: null }
  let kits = Number.POSITIVE_INFINITY
  let limitante: string | null = null
  for (const c of receta) {
    const alcanzan = Math.floor(Math.max(0, disponiblePorComponente.get(c.varianteId) ?? 0) / c.cantidad)
    if (alcanzan < kits) {
      kits = alcanzan
      limitante = c.varianteId
    }
  }
  return { kits, limitante }
}
