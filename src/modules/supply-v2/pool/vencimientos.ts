import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { fallo } from '../core/errores'
import { registrarVencimientoDeLoteEnTx } from '../economics/service'
import { marcarAgotadaSiCorrespondeEnTx } from '../offers/service'
import { registrarAsientoEnTx } from './lotes'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 4 · VENCIMIENTO DE LOTES (§48–§50).
 *
 * Un lote vencido cierra lo que NADIE tiene: AVAILABLE → CLOSED y
 * ALLOCATED → CLOSED (las unidades apartadas para una oferta que ya no se
 * pueden vender se dan por liberadas en su asignación). Lo RESERVED (un
 * checkout en curso) y lo ISSUED (un derecho vendido) NO se toca: esas
 * unidades tienen dueño y se resuelven por su propio camino (expiración de la
 * reserva; vencimiento del derecho). Idempotente: una segunda pasada no
 * encuentra nada que cerrar.
 */

export interface LoteVencido {
  lotId: string
  code: string
  cerradasDisponibles: number
  cerradasAsignadas: number
}

export async function expirarLoteEnTx(tx: Tx, lotId: string, ctx: ContextoAuditoria, ahora = new Date()): Promise<LoteVencido | null> {
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_lots" WHERE "id" = ${lotId} FOR UPDATE`
  const l = await tx.supplyV2Lot.findUnique({
    where: { id: lotId },
    select: { id: true, code: true, status: true, expiresAt: true, quantityAvailable: true, quantityAllocated: true, quantityReserved: true, quantityIssued: true, unitCost: true, supplier: { select: { companyId: true } } },
  })
  if (!l || !l.expiresAt || l.expiresAt > ahora) return null
  if (l.quantityAvailable + l.quantityAllocated === 0) return null

  let primerAsiento: string | null = null
  let cerradasDisponibles = 0
  let cerradasAsignadas = 0
  if (l.quantityAvailable > 0) {
    const a = await registrarAsientoEnTx(tx, l.id, { type: 'EXPIRATION', sourceBucket: 'AVAILABLE', destinationBucket: 'CLOSED', quantity: l.quantityAvailable, reason: `Lote ${l.code} vencido el ${l.expiresAt.toISOString().slice(0, 10)}.` }, { referenceType: 'LOT', referenceId: l.id }, ctx.actorId)
    primerAsiento = a.id
    cerradasDisponibles = l.quantityAvailable
  }
  if (l.quantityAllocated > 0) {
    // Lo apartado y todavía libre en cada asignación de este lote se da por liberado.
    const lineas = await tx.supplyV2AllocationLine.findMany({ where: { lotId: l.id }, select: { id: true, allocationId: true, quantity: true, reservedQuantity: true, issuedQuantity: true, releasedQuantity: true, allocation: { select: { offer: { select: { id: true } } } } } })
    let libres = 0
    for (const li of lineas) {
      const libre = li.quantity - li.reservedQuantity - li.issuedQuantity - li.releasedQuantity
      if (libre <= 0) continue
      libres += libre
      await tx.supplyV2AllocationLine.update({ where: { id: li.id }, data: { releasedQuantity: { increment: libre } } })
      await tx.supplyV2Allocation.update({ where: { id: li.allocationId }, data: { releasedQuantity: { increment: libre } } })
      if (li.allocation.offer) await marcarAgotadaSiCorrespondeEnTx(tx, li.allocation.offer.id)
    }
    if (libres !== l.quantityAllocated) fallo('LEDGER_INCONSISTENT', `El lote ${l.code} tiene ${l.quantityAllocated} asignadas pero sus asignaciones suman ${libres} libres.`)
    const a = await registrarAsientoEnTx(tx, l.id, { type: 'EXPIRATION', sourceBucket: 'ALLOCATED', destinationBucket: 'CLOSED', quantity: libres, reason: `Lote ${l.code} vencido: unidades apartadas sin vender.` }, { referenceType: 'LOT', referenceId: l.id }, ctx.actorId)
    primerAsiento ??= a.id
    cerradasAsignadas = libres
  }
  const cerradas = cerradasDisponibles + cerradasAsignadas
  await registrarVencimientoDeLoteEnTx(tx, { lotId: l.id, ledgerEntryId: primerAsiento!, unidades: cerradas }, ctx, ahora)
  // Sin unidades vivas el lote queda EXPIRED (lo que reserva o vendió alguien sigue su camino).
  if (l.quantityReserved + l.quantityIssued === 0) {
    await tx.supplyV2Lot.update({ where: { id: l.id }, data: { status: 'EXPIRED' } })
  }
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_LOT_EXPIRED', 'SupplyV2Lot', l.id, { code: l.code, cerradasDisponibles, cerradasAsignadas, costoPerdido: l.unitCost.times(cerradas).toFixed(2) }, l.supplier.companyId)
  return { lotId: l.id, code: l.code, cerradasDisponibles, cerradasAsignadas }
}

/** Candidatos: lotes vencidos con algo en AVAILABLE o ALLOCATED. */
export async function lotesPorVencerEnTx(tx: Tx, ahora = new Date(), limite = 200): Promise<string[]> {
  const filas = await tx.supplyV2Lot.findMany({
    where: { expiresAt: { lte: ahora }, OR: [{ quantityAvailable: { gt: 0 } }, { quantityAllocated: { gt: 0 } }] },
    select: { id: true },
    orderBy: { expiresAt: 'asc' },
    take: limite,
  })
  return filas.map((f) => f.id)
}
