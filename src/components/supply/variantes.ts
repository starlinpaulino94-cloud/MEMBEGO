import type {
  SupplyConciliacionEstado,
  SupplyDiscrepanciaEstado,
  SupplyLiquidacionEstado,
  SupplyVentaEstado,
} from '@prisma/client'

/** Color del badge por estado. Solo presentación: el significado vive en `estados.ts`. */
export type VarianteBadge = 'success' | 'destructive' | 'warning' | 'outline' | 'secondary' | 'default'

export function varianteLiquidacion(estado: SupplyLiquidacionEstado): VarianteBadge {
  if (estado === 'PAGADA' || estado === 'CONCILIADA') return 'success'
  if (estado === 'DISPUTADA') return 'destructive'
  if (estado === 'APROBADA') return 'warning'
  if (estado === 'CANCELADA') return 'outline'
  return 'secondary'
}

export function varianteVenta(estado: SupplyVentaEstado): VarianteBadge {
  if (estado === 'ENTREGADA') return 'success'
  if (estado === 'PAGADA') return 'default'
  if (estado === 'CANCELADA' || estado === 'REEMBOLSADA') return 'outline'
  return 'secondary'
}

export function varianteConciliacion(estado: SupplyConciliacionEstado): VarianteBadge {
  if (estado === 'CERRADA') return 'success'
  if (estado === 'EN_REVISION') return 'warning'
  return 'secondary'
}

export function varianteDiscrepancia(estado: SupplyDiscrepanciaEstado): VarianteBadge {
  if (estado === 'APROBADA') return 'success'
  if (estado === 'RECHAZADA') return 'outline'
  if (estado === 'ABIERTA') return 'destructive'
  if (estado === 'EN_INVESTIGACION') return 'warning'
  return 'secondary'
}
