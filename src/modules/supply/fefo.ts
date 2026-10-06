import type { SupplyLoteEstado } from '@prisma/client'

/**
 * MEMBEGO SUPPLY · FEFO (Fase 10).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * FIRST EXPIRE, FIRST OUT
 *
 * Cuando Membego tiene tres lotes del mismo producto —uno que vence el 1 de
 * octubre, otro el 15 de noviembre, otro en diciembre— y hay que entregar una
 * unidad, sale la del lote que vence ANTES. Cualquier otro orden tira dinero:
 * lo que vence sin usarse ya está pagado.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CONFIGURABLE, PORQUE A VECES EL CALENDARIO NO MANDA
 *
 * Hay razones comerciales legítimas para saltárselo: una campaña atada a un
 * proveedor concreto, un lote reservado para un acuerdo con un influencer, un
 * proveedor con incidencias al que no conviene mandarle más clientes hasta
 * resolverlas. Por eso la estrategia es un parámetro y no un `sort` escondido
 * dentro de la emisión.
 *
 * PURO: recibe lotes ya leídos y devuelve el orden. No consulta nada.
 */

export const ESTRATEGIAS_SELECCION = ['FEFO', 'FIFO', 'MAYOR_COSTO', 'MENOR_COSTO'] as const
export type EstrategiaSeleccion = (typeof ESTRATEGIAS_SELECCION)[number]

export const ESTRATEGIA_LABELS: Record<EstrategiaSeleccion, string> = {
  FEFO: 'Primero el que vence antes (recomendado)',
  FIFO: 'Primero el que se compró antes',
  MAYOR_COSTO: 'Primero el más caro',
  MENOR_COSTO: 'Primero el más barato',
}

export const ESTRATEGIA_POR_DEFECTO: EstrategiaSeleccion = 'FEFO'

/** Lo mínimo que hace falta saber de un lote para elegirlo. */
export interface LoteElegible {
  id: string
  codigo: string
  estado: SupplyLoteEstado
  venceAt: Date
  inicioAt: Date
  createdAt: Date
  costoUnitario: number
  /** Unidades que este lote puede entregar AHORA (disponibles + asignadas). */
  utilizables: number
  /** Unidades libres, sin asignar a ninguna campaña. */
  disponibles: number
  proveedorId: string
  snapshotSucursalIds: readonly string[]
}

export interface FiltroSeleccion {
  ahora?: Date
  /** Si se pide una sucursal concreta, el lote tiene que cubrirla. */
  sucursalId?: string | null
  /** Solo lotes de este proveedor. */
  proveedorId?: string | null
  /** Excluir estos lotes (p. ej. proveedor con incidencias abiertas). */
  excluirLoteIds?: readonly string[]
  /** Exigir unidades LIBRES (sin asignar) en vez de solo utilizables. */
  exigirDisponibles?: boolean
}

/**
 * ¿Puede este lote entregar una unidad ahora mismo?
 *
 * `inicioAt` importa tanto como `venceAt`: un contrato que empieza el 1 de
 * octubre no puede entregar el 28 de septiembre, y sin esta comprobación un
 * lote PROGRAMADO adelantado por error repartiría unidades que el proveedor
 * todavía no se comprometió a cumplir.
 */
export function loteUtilizable(lote: LoteElegible, filtro: FiltroSeleccion = {}): boolean {
  const ahora = filtro.ahora ?? new Date()
  if (lote.estado !== 'ACTIVO') return false
  if (lote.inicioAt > ahora) return false
  if (lote.venceAt <= ahora) return false

  const cantidad = filtro.exigirDisponibles ? lote.disponibles : lote.utilizables
  if (cantidad <= 0) return false

  if (filtro.proveedorId && lote.proveedorId !== filtro.proveedorId) return false
  if (filtro.excluirLoteIds?.includes(lote.id)) return false

  // Lista de sucursales VACÍA = todas las del proveedor. Es lo contrario de
  // "ninguna", y confundirlo dejaría sin canjear todos los contratos que no
  // limitan sucursal, que son la mayoría.
  if (filtro.sucursalId && lote.snapshotSucursalIds.length > 0) {
    if (!lote.snapshotSucursalIds.includes(filtro.sucursalId)) return false
  }
  return true
}

/** Ordena los lotes según la estrategia. No filtra: solo ordena. */
export function ordenarLotes(
  lotes: readonly LoteElegible[],
  estrategia: EstrategiaSeleccion = ESTRATEGIA_POR_DEFECTO
): LoteElegible[] {
  const copia = [...lotes]
  switch (estrategia) {
    case 'FEFO':
      // Desempate por creación: dos lotes que vencen el mismo día se consumen
      // en el orden en que se compraron, que es lo que espera cualquiera que
      // mire la lista.
      return copia.sort(
        (a, b) => a.venceAt.getTime() - b.venceAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime()
      )
    case 'FIFO':
      return copia.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    case 'MAYOR_COSTO':
      return copia.sort((a, b) => b.costoUnitario - a.costoUnitario || a.venceAt.getTime() - b.venceAt.getTime())
    case 'MENOR_COSTO':
      return copia.sort((a, b) => a.costoUnitario - b.costoUnitario || a.venceAt.getTime() - b.venceAt.getTime())
  }
}

/** Lotes que pueden entregar, ya ordenados por la estrategia. */
export function lotesCandidatos(
  lotes: readonly LoteElegible[],
  filtro: FiltroSeleccion = {},
  estrategia: EstrategiaSeleccion = ESTRATEGIA_POR_DEFECTO
): LoteElegible[] {
  return ordenarLotes(
    lotes.filter((l) => loteUtilizable(l, filtro)),
    estrategia
  )
}

/** El lote del que debería salir la próxima unidad, o null si no hay ninguno. */
export function elegirLote(
  lotes: readonly LoteElegible[],
  filtro: FiltroSeleccion = {},
  estrategia: EstrategiaSeleccion = ESTRATEGIA_POR_DEFECTO
): LoteElegible | null {
  return lotesCandidatos(lotes, filtro, estrategia)[0] ?? null
}

export interface RepartoLote {
  loteId: string
  codigo: string
  cantidad: number
  costoUnitario: number
}

/**
 * Reparte `cantidad` unidades entre varios lotes según la estrategia.
 *
 * Para una campaña de 500 unidades que no cabe en un solo lote: se llena el
 * que vence antes y se sigue. Devuelve también `faltante`, porque decir «no se
 * pudo» sin decir cuánto faltaba obliga a repetir la consulta para saberlo.
 */
export function repartirEntreLotes(
  lotes: readonly LoteElegible[],
  cantidad: number,
  filtro: FiltroSeleccion = {},
  estrategia: EstrategiaSeleccion = ESTRATEGIA_POR_DEFECTO
): { reparto: RepartoLote[]; faltante: number } {
  if (!Number.isInteger(cantidad) || cantidad <= 0) {
    throw new Error('La cantidad a repartir tiene que ser un entero positivo.')
  }

  const candidatos = lotesCandidatos(lotes, filtro, estrategia)
  const reparto: RepartoLote[] = []
  let restante = cantidad

  for (const lote of candidatos) {
    if (restante === 0) break
    const capacidad = filtro.exigirDisponibles ? lote.disponibles : lote.utilizables
    const toma = Math.min(capacidad, restante)
    if (toma <= 0) continue
    reparto.push({
      loteId: lote.id,
      codigo: lote.codigo,
      cantidad: toma,
      costoUnitario: lote.costoUnitario,
    })
    restante -= toma
  }

  return { reparto, faltante: restante }
}

/** Costo total de un reparto: lo que a Membego le cuesta esa campaña. */
export function costoDelReparto(reparto: readonly RepartoLote[]): number {
  return reparto.reduce((t, r) => t + r.cantidad * r.costoUnitario, 0)
}
