import type { SupplyPorProducto } from '@/modules/supply-v2/pool/queries'

export type EstadoStock = 'EN_STOCK' | 'SIN_ASIGNAR' | 'AGOTADO'

export const ESTADO_STOCK_LABELS: Record<EstadoStock, string> = {
  EN_STOCK: 'En stock',
  SIN_ASIGNAR: 'Sin asignar',
  AGOTADO: 'Agotado',
}

/**
 * Estado de un producto del pool, derivado de sus cubetas: «Agotado» sin
 * disponibles, «Sin asignar» si nada está comprometido en ofertas, «En stock»
 * en el resto. Sin umbrales inventados («óptimo», «bajo stock»).
 */
export function estadoStock(p: Pick<SupplyPorProducto, 'disponibles' | 'asignadas'>): EstadoStock {
  if (p.disponibles <= 0) return 'AGOTADO'
  if (p.asignadas <= 0) return 'SIN_ASIGNAR'
  return 'EN_STOCK'
}

export function diasHasta(fecha: Date, ahora = new Date()): number {
  return Math.ceil((fecha.getTime() - ahora.getTime()) / 86_400_000)
}
