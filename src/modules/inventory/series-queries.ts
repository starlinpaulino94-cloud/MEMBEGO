import type { InventoryBucket, InventoryMovementType } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { normalizarCodigoLote } from './lotes'

/**
 * COMMERCE CORE · inventario — INV-5c: la BÚSQUEDA DE UNA SERIE con su historia. Solo lee: una serie es un lote de una unidad, y todo lo que
 * le pasó (entró, se vendió, se transfirió, se dañó) está en los repartos por lote del ledger.
 */

/** Series que devuelve una búsqueda (la pantalla pide que se afine el texto si hay más). */
export const MAX_SERIES_ENCONTRADAS = 20
/** Movimientos que se muestran por búsqueda (los más recientes de todas las series encontradas). */
const MAX_MOVIMIENTOS_DE_SERIES = 300

export interface PasoDeSerie {
  movimientoId: string
  fecha: Date
  tipo: InventoryMovementType
  sucursal: string
  desde: InventoryBucket | null
  hacia: InventoryBucket | null
  motivo: string | null
}

export interface SerieEncontrada {
  loteId: string
  serie: string
  varianteId: string
  sku: string
  producto: string
  nombreVariante: string
  esDefault: boolean
  creadaEn: Date
  /** Dónde está ahora (sucursales con la unidad, disponible/apartada/dañada). Vacío = ya no está en ninguna (se vendió o se dio de baja). */
  ubicaciones: { sucursalId: string; sucursal: string; disponible: number; reservada: number; danada: number }[]
  /** Lo que le pasó, de lo más reciente a lo más antiguo. */
  historia: PasoDeSerie[]
}

export interface BusquedaDeSeries {
  /** El texto tal como se buscó (normalizado). Vacío = no se buscó nada. */
  consulta: string
  series: SerieEncontrada[]
  /** Hay más series que coinciden que las mostradas. */
  hayMas: boolean
}

/** Las series de la empresa cuyo número contiene el texto (sin distinguir mayúsculas), con dónde están y su historia. */
export async function buscarSeriesEnTx(tx: Tx, companyId: string, texto: string): Promise<BusquedaDeSeries> {
  const t = normalizarCodigoLote(texto)
  if (!t.ok) return { consulta: '', series: [], hayMas: false }
  const lotes = await tx.inventoryLot.findMany({
    where: { companyId, legacy: false, code: { contains: t.valor, mode: 'insensitive' }, variant: { lotTracking: { some: { companyId, tracksSerials: true } } } },
    select: {
      id: true,
      code: true,
      createdAt: true,
      variant: { select: { id: true, sku: true, name: true, isDefault: true, item: { select: { name: true } } } },
      balances: { select: { onHand: true, reserved: true, damaged: true, level: { select: { location: { select: { id: true, nombre: true } } } } } },
    },
    orderBy: [{ code: 'asc' }, { id: 'asc' }],
    take: MAX_SERIES_ENCONTRADAS + 1,
  })
  const hayMas = lotes.length > MAX_SERIES_ENCONTRADAS
  const mostradas = lotes.slice(0, MAX_SERIES_ENCONTRADAS)
  // Primero las que coinciden exactamente con lo buscado.
  mostradas.sort((a, b) => Number(b.code === t.valor) - Number(a.code === t.valor))
  const ids = mostradas.map((l) => l.id)
  const pasos =
    ids.length === 0
      ? []
      : await tx.inventoryMovementLot.findMany({
          where: { companyId, lotId: { in: ids } },
          select: {
            lotId: true,
            movement: { select: { id: true, type: true, sourceBucket: true, destinationBucket: true, reason: true, createdAt: true, level: { select: { location: { select: { nombre: true } } } } } },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: MAX_MOVIMIENTOS_DE_SERIES,
        })
  const porLote = new Map<string, PasoDeSerie[]>()
  for (const p of pasos) {
    const m = p.movement
    porLote.set(p.lotId, [
      ...(porLote.get(p.lotId) ?? []),
      { movimientoId: m.id, fecha: m.createdAt, tipo: m.type, sucursal: m.level.location.nombre, desde: m.sourceBucket, hacia: m.destinationBucket, motivo: m.reason },
    ])
  }
  const series = mostradas.map(
    (l): SerieEncontrada => ({
      loteId: l.id,
      serie: l.code,
      varianteId: l.variant.id,
      sku: l.variant.sku,
      producto: l.variant.item.name,
      nombreVariante: l.variant.name,
      esDefault: l.variant.isDefault,
      creadaEn: l.createdAt,
      ubicaciones: l.balances
        .filter((b) => b.onHand > 0 || b.damaged > 0)
        .map((b) => ({ sucursalId: b.level.location.id, sucursal: b.level.location.nombre, disponible: Math.max(b.onHand - b.reserved, 0), reservada: b.reserved, danada: b.damaged })),
      historia: porLote.get(l.id) ?? [],
    })
  )
  return { consulta: t.valor, series, hayMas }
}
