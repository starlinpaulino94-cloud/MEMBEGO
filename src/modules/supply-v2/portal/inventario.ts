import type { SupplyV2Bucket, SupplyV2CatalogItemType, SupplyV2FulfillmentBacking, SupplyV2LedgerEntryType } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · inventario / derechos de Membego vistos
 * por el PROVEEDOR (§9, §10). No es el inventario del negocio: es lo que
 * Membego le compró, en unidades/derechos, con las cubetas del ledger de
 * lotes (caché) y los movimientos (verdad). Solo lotes de SU `supplierId`.
 *
 *   recibidas = disponibles + asignadas + reservadas + emitidas + redimidas + cerradas
 *
 * Para el proveedor:
 *   · «Compradas»            = recibidas (lo que Membego adquirió)
 *   · «Por vender»           = disponibles + asignadas (todavía sin cliente)
 *   · «Reservadas»           = reservadas (checkout en curso)
 *   · «Pendientes de entrega»= emitidas (ya vendidas; vendrán a canjearlas)
 *   · «Canjeadas»            = redimidas
 *   · «Vencidas/cerradas»    = cerradas
 */

export interface InventarioDeProveedorFila {
  catalogItemId: string
  producto: string
  tipo: SupplyV2CatalogItemType
  sku: string | null
  unidad: string
  backing: SupplyV2FulfillmentBacking
  contratos: { id: string; code: string }[]
  compradas: number
  porVender: number
  reservadas: number
  pendientesDeEntrega: number
  canjeadas: number
  cerradas: number
  lotes: number
  proximoVencimiento: Date | null
  capacidadDiaria: { total: number; usada: number; disponible: number } | null
}

const inicioDeHoy = (ahora: Date) => {
  const d = new Date(ahora)
  d.setHours(0, 0, 0, 0)
  return d
}

export async function inventarioDelProveedor(supplierId: string, ahora = new Date()): Promise<InventarioDeProveedorFila[]> {
  const hoy = inicioDeHoy(ahora)
  return sinEmpresa('Supply: inventario Membego del proveedor de la sesión', async (tx) => {
    const items = await tx.supplyV2CatalogItem.findMany({
      where: { supplierId, status: { not: 'ARCHIVED' } },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        type: true,
        sku: true,
        unit: true,
        fulfillmentBacking: true,
        dailyCapacity: true,
        agreements: { where: { status: 'ACTIVE' }, select: { id: true, code: true }, orderBy: { createdAt: 'desc' } },
        lots: {
          where: { supplierId },
          select: { quantityReceived: true, quantityAvailable: true, quantityAllocated: true, quantityReserved: true, quantityIssued: true, quantityRedeemed: true, quantityClosed: true, expiresAt: true, status: true },
        },
      },
    })
    const conCapacidad = items.filter((i) => i.dailyCapacity != null).map((i) => i.id)
    const usadasHoy = conCapacidad.length
      ? await tx.supplyV2Redemption.groupBy({ by: ['catalogItemId'], where: { supplierId, catalogItemId: { in: conCapacidad }, redeemedAt: { gte: hoy }, reversedAt: null }, _count: { _all: true } })
      : []
    const usadas = new Map(usadasHoy.map((u) => [u.catalogItemId, u._count._all]))
    return items
      .filter((i) => i.lots.length > 0 || i.agreements.length > 0)
      .map((i) => {
        const sum = (f: (l: (typeof i.lots)[number]) => number) => i.lots.reduce((t, l) => t + f(l), 0)
        const proximo = i.lots
          .filter((l) => l.expiresAt && l.quantityAvailable + l.quantityAllocated + l.quantityReserved + l.quantityIssued > 0)
          .map((l) => l.expiresAt as Date)
          .sort((a, b) => a.getTime() - b.getTime())[0] ?? null
        const usada = usadas.get(i.id) ?? 0
        return {
          catalogItemId: i.id,
          producto: i.name,
          tipo: i.type,
          sku: i.sku,
          unidad: i.unit,
          backing: i.fulfillmentBacking,
          contratos: i.agreements,
          compradas: sum((l) => l.quantityReceived),
          porVender: sum((l) => l.quantityAvailable + l.quantityAllocated),
          reservadas: sum((l) => l.quantityReserved),
          pendientesDeEntrega: sum((l) => l.quantityIssued),
          canjeadas: sum((l) => l.quantityRedeemed),
          cerradas: sum((l) => l.quantityClosed),
          lotes: i.lots.length,
          proximoVencimiento: proximo,
          capacidadDiaria: i.dailyCapacity == null ? null : { total: i.dailyCapacity, usada, disponible: Math.max(0, i.dailyCapacity - usada) },
        }
      })
  })
}

export interface MovimientoDeProveedor {
  id: string
  createdAt: Date
  lote: string
  type: SupplyV2LedgerEntryType
  sourceBucket: SupplyV2Bucket | null
  destinationBucket: SupplyV2Bucket | null
  quantity: number
  /** Disponibles del lote después del asiento. */
  balanceAfter: number
  reason: string | null
}

/** Los asientos del ledger (la verdad) de los lotes del proveedor para un producto. */
export async function movimientosDelProveedor(supplierId: string, catalogItemId: string, limite = 100): Promise<{ producto: string; movimientos: MovimientoDeProveedor[] } | null> {
  return sinEmpresa('Supply: movimientos del inventario Membego del proveedor de la sesión', async (tx) => {
    const item = await tx.supplyV2CatalogItem.findFirst({ where: { id: catalogItemId, supplierId }, select: { name: true } })
    if (!item) return null
    const filas = await tx.supplyV2LedgerEntry.findMany({
      where: { lot: { supplierId, catalogItemId } },
      orderBy: { createdAt: 'desc' },
      take: limite,
      select: { id: true, createdAt: true, type: true, sourceBucket: true, destinationBucket: true, quantity: true, balanceAfter: true, reason: true, lot: { select: { code: true } } },
    })
    return {
      producto: item.name,
      movimientos: filas.map((f) => ({ id: f.id, createdAt: f.createdAt, lote: f.lot.code, type: f.type, sourceBucket: f.sourceBucket, destinationBucket: f.destinationBucket, quantity: f.quantity, balanceAfter: f.balanceAfter, reason: f.reason })),
    }
  })
}

/** Signo con el que el proveedor lee un asiento: +compra, −canje, +reversa… */
export function signoDeMovimiento(m: Pick<MovimientoDeProveedor, 'type' | 'destinationBucket'>): '+' | '-' | '·' {
  switch (m.type) {
    case 'RECEIPT':
    case 'REVERSAL':
      return '+'
    case 'REDEMPTION':
    case 'EXPIRATION':
    case 'CANCELLATION':
      return '-'
    case 'ADJUSTMENT':
      return m.destinationBucket ? '+' : '-'
    default:
      return '·'
  }
}

export const MOVIMIENTO_LABELS: Record<SupplyV2LedgerEntryType, string> = {
  RECEIPT: 'Compra recibida',
  ALLOCATION: 'Apartado para una oferta',
  RELEASE_ALLOCATION: 'Liberado de una oferta',
  RESERVATION: 'Reservado (checkout)',
  RELEASE_RESERVATION: 'Reserva liberada',
  ISSUE: 'Vendido al cliente',
  REDEMPTION: 'Canje',
  REVERSAL: 'Reversa de canje',
  EXPIRATION: 'Vencido',
  ADJUSTMENT: 'Ajuste',
  CANCELLATION: 'Cancelación',
  TRANSFER: 'Traslado',
}
