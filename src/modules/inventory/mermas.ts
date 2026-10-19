import { valorDe, type Costo } from './costos'
import { etiquetaDeMotivo, type ClaseDeMotivo } from './motivos'

/**
 * COMMERCE CORE · inventario — INV-4b: el informe de mermas por motivo. PURO: sin base de datos ni servidor.
 *
 * QUÉ ES UNA MERMA. Lo que sale del inventario sin venderse: los FALTANTES (un ajuste que resta) y las BAJAS de lo dañado. Es lo
 * que el inventario perdió de verdad y lo que vale dinero. El DAÑO (vendible → dañado) todavía está en la sucursal —sigue
 * contando en el valor del inventario hasta que se dé de baja—, así que se enseña aparte y no se suma a lo perdido: una pieza que
 * se daña hoy y se da de baja mañana sería, si no, dos pérdidas. Los SOBRANTES (un ajuste que suma) van aparte también: no son una
 * pérdida, pero se ven junto a ella porque suelen ser la otra cara del mismo descuadre.
 *
 * LO QUE VALE. Cada ajuste y cada daño guarda el costo promedio de su instante (INV-3a): valor = unidades × ese costo. Lo que no
 * tiene costo se cuenta aparte, nunca como cero. Sin la función `costos` el costo ni se lee.
 */

export type GrupoDeMerma = 'PERDIDA' | 'SOBRANTE' | 'DANO'

export const GRUPOS_DE_MERMA: readonly GrupoDeMerma[] = ['PERDIDA', 'SOBRANTE', 'DANO']

export const ETIQUETA_GRUPO: Record<GrupoDeMerma, string> = {
  PERDIDA: 'Lo perdido',
  SOBRANTE: 'Sobrantes',
  DANO: 'Dañado',
}

/** Qué se cuenta en cada grupo, en una frase (para la pantalla y el archivo). */
export const EXPLICACION_GRUPO: Record<GrupoDeMerma, string> = {
  PERDIDA: 'Faltantes y bajas de lo dañado: lo que salió del inventario sin venderse.',
  SOBRANTE: 'Ajustes que sumaron: había más de lo que decía el sistema.',
  DANO: 'Mercancía que dejó de ser vendible pero sigue en la sucursal hasta que se dé de baja (no se suma a lo perdido).',
}

export function grupoDeClase(clase: ClaseDeMotivo): GrupoDeMerma {
  return clase === 'FALTANTE' || clase === 'BAJA' ? 'PERDIDA' : clase === 'SOBRANTE' ? 'SOBRANTE' : 'DANO'
}

/** El valor «sin motivo codificado» en la URL: los movimientos sin código (anteriores a INV-4b o de procesos que no eligen uno). */
export const FILTRO_SIN_MOTIVO = 'sin'

/** Los filtros del informe. Las fechas son días LOCALES de la empresa, ambos incluidos (por defecto, los últimos 30). */
export interface FiltrosMermas {
  desde?: string
  hasta?: string
  sucursalId?: string
  /** Un código del catálogo o `FILTRO_SIN_MOTIVO`. */
  motivo?: string
  q?: string
  pagina: number
}

export interface FilaPorMotivo {
  /** null = sin motivo codificado. */
  codigo: string | null
  etiqueta: string
  movimientos: number
  unidades: number
  /** unidades × costo, solo lo que tiene costo; null si no se pueden ver costos. */
  valor: Costo | null
  /** Unidades sin costo conocido; null si no se pueden ver costos. */
  unidadesSinCosto: number | null
}

export interface TotalGrupo {
  movimientos: number
  unidades: number
  valor: Costo | null
  unidadesSinCosto: number | null
}

/**
 * Ordena las filas de un grupo de lo que más pesa a lo que menos: por valor (si se puede ver), luego por unidades, y por último
 * por etiqueta y código para que el orden no dependa de la base. «Sin motivo codificado» queda al final cuando empata: es lo
 * menos informativo. «Otro» también cae al final de su empate.
 */
export function ordenarPorMotivo(filas: readonly FilaPorMotivo[]): FilaPorMotivo[] {
  const rango = (f: FilaPorMotivo) => (f.codigo === null ? 2 : f.codigo === 'OTHER' ? 1 : 0)
  return [...filas].sort((a, b) => {
    const va = a.valor ?? BigInt(-1)
    const vb = b.valor ?? BigInt(-1)
    if (va !== vb) return va > vb ? -1 : 1
    if (a.unidades !== b.unidades) return b.unidades - a.unidades
    if (rango(a) !== rango(b)) return rango(a) - rango(b)
    return a.etiqueta.localeCompare(b.etiqueta, 'es') || (a.codigo ?? '').localeCompare(b.codigo ?? '')
  })
}

/** La fila de un motivo: etiqueta del catálogo (o «Sin motivo codificado») y sus cifras. */
export function filaPorMotivo(c: { codigo: string | null; movimientos: number; unidades: number; valor: Costo | null; unidadesSinCosto: number | null }): FilaPorMotivo {
  return { codigo: c.codigo, etiqueta: etiquetaDeMotivo(c.codigo), movimientos: c.movimientos, unidades: c.unidades, valor: c.valor, unidadesSinCosto: c.unidadesSinCosto }
}

/** La suma de las filas de un grupo. Si alguna no trae valor (no se pueden ver costos), el total tampoco. */
export function totalDeGrupo(filas: readonly FilaPorMotivo[]): TotalGrupo {
  const conValor = filas.every((f) => f.valor !== null)
  return {
    movimientos: filas.reduce((t, f) => t + f.movimientos, 0),
    unidades: filas.reduce((t, f) => t + f.unidades, 0),
    valor: conValor ? filas.reduce((t, f) => t + (f.valor ?? BigInt(0)), BigInt(0)) : null,
    unidadesSinCosto: conValor ? filas.reduce((t, f) => t + (f.unidadesSinCosto ?? 0), 0) : null,
  }
}

/**
 * Qué parte del total es `parte`, en porcentaje con un decimal (0 si no hay total). Sirve para unidades y para dinero: el dinero
 * llega en diezmilésimas y se divide con enteros grandes, sin pasar por coma flotante hasta el último paso.
 */
export function participacion(parte: number | Costo, total: number | Costo): number {
  const p = typeof parte === 'bigint' ? parte : BigInt(parte)
  const t = typeof total === 'bigint' ? total : BigInt(total)
  if (t <= BigInt(0)) return 0
  // Décimas de punto porcentual: parte × 1000 / total, redondeado a la mitad hacia arriba.
  const decimas = (p * BigInt(2000) + t) / (t * BigInt(2))
  return Number(decimas) / 10
}

/** El valor de una fila de detalle: unidades × el costo congelado en el movimiento; null si no tiene costo. */
export function valorDeMovimiento(unidades: number, costo: Costo | null): Costo | null {
  return costo === null ? null : valorDe(unidades, costo)
}
