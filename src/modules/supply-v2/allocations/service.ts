import type { SupplyV2AllocationPurpose } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { fallo } from '../core/errores'
import { repartirFefo } from '../core/fefo'
import { registrarAsientoEnTx } from '../pool/lotes'

/**
 * MEMBEGO SUPPLY · ASIGNACIÓN (§4–§6, §16, §38–§39).
 *
 * Apartar supply disponible para un fin. Se hace en la `tx` de quien llama:
 *
 *   bloquear lotes del producto → FEFO → validar disponibilidad → asignación
 *   → líneas por lote → AVAILABLE → ALLOCATED en el ledger → bitácora
 *
 * Si algo falla no queda asignación a medias.
 */

export interface AsignacionCreada {
  id: string
  quantity: number
  lines: { id: string; lotId: string; quantity: number; unitCost: string }[]
}

export async function asignarEnTx(
  tx: Tx,
  d: { catalogItemId: string; quantity: number; purpose?: SupplyV2AllocationPurpose; startsAt?: Date | null; endsAt?: Date | null; referenceLabel: string },
  ctx: ContextoAuditoria
): Promise<AsignacionCreada> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Una asignación necesita quién la crea.')
  if (!Number.isInteger(d.quantity) || d.quantity <= 0) fallo('CANTIDAD_INVALIDA', 'La cantidad a asignar tiene que ser un entero positivo.')

  // 1. Bloquear los lotes vivos del producto: dos asignaciones a la vez se serializan.
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_lots" WHERE "catalogItemId" = ${d.catalogItemId} AND "status" IN ('ACTIVE', 'EXHAUSTED') FOR UPDATE`
  const lotes = await tx.supplyV2Lot.findMany({
    where: { catalogItemId: d.catalogItemId, status: { in: ['ACTIVE', 'EXHAUSTED'] } },
    select: { id: true, quantityAvailable: true, expiresAt: true, receivedAt: true, unitCost: true, supplier: { select: { companyId: true } } },
  })
  const ahora = new Date()
  const candidatos = lotes
    .filter((l) => !l.expiresAt || l.expiresAt > ahora)
    .map((l) => ({ id: l.id, disponible: l.quantityAvailable, expiresAt: l.expiresAt, receivedAt: l.receivedAt }))
  let reparto: { id: string; cantidad: number }[]
  try {
    reparto = repartirFefo(candidatos, d.quantity)
  } catch (e) {
    fallo('SIN_DISPONIBILIDAD', e instanceof Error ? e.message : 'No hay supply suficiente.')
  }

  // 2. La asignación y sus líneas.
  const asignacion = await tx.supplyV2Allocation.create({
    data: {
      catalogItemId: d.catalogItemId,
      purpose: d.purpose ?? 'OFFER',
      quantity: d.quantity,
      allocatedQuantity: d.quantity,
      status: 'ACTIVE',
      startsAt: d.startsAt ?? null,
      endsAt: d.endsAt ?? null,
      createdById: ctx.actorId,
      lines: { create: reparto.map((r) => ({ lotId: r.id, quantity: r.cantidad })) },
    },
    select: { id: true, lines: { select: { id: true, lotId: true, quantity: true } } },
  })

  // 3. El ledger: AVAILABLE → ALLOCATED en cada lote que financia la asignación.
  const costoPorLote = new Map(lotes.map((l) => [l.id, l.unitCost]))
  for (const linea of asignacion.lines) {
    await registrarAsientoEnTx(
      tx,
      linea.lotId,
      { type: 'ALLOCATION', sourceBucket: 'AVAILABLE', destinationBucket: 'ALLOCATED', quantity: linea.quantity, reason: `Asignación para ${d.referenceLabel}.` },
      { referenceType: 'ALLOCATION', referenceId: asignacion.id },
      ctx.actorId
    )
  }
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_ALLOCATION_CREATED', 'SupplyV2Allocation', asignacion.id, {
    catalogItemId: d.catalogItemId,
    quantity: d.quantity,
    lines: asignacion.lines.map((l) => ({ lotId: l.lotId, quantity: l.quantity })),
  }, lotes[0]?.supplier.companyId ?? null)

  return {
    id: asignacion.id,
    quantity: d.quantity,
    lines: asignacion.lines.map((l) => ({ ...l, unitCost: costoPorLote.get(l.lotId)?.toFixed(2) ?? '0.00' })),
  }
}

/**
 * Libera lo que la asignación tiene apartado y NADIE usa: ALLOCATED →
 * AVAILABLE por lote, sin tocar lo reservado ni lo emitido (§38–§39).
 * Idempotente: una segunda llamada no encuentra nada que liberar.
 */
export async function liberarAsignacionEnTx(
  tx: Tx,
  allocationId: string,
  motivo: string,
  estadoFinal: 'ENDED' | 'CANCELLED',
  ctx: ContextoAuditoria
): Promise<{ liberadas: number }> {
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_allocations" WHERE "id" = ${allocationId} FOR UPDATE`
  const a = await tx.supplyV2Allocation.findUnique({
    where: { id: allocationId },
    select: { id: true, status: true, lines: { select: { id: true, lotId: true, quantity: true, reservedQuantity: true, issuedQuantity: true, releasedQuantity: true } } },
  })
  if (!a) fallo('ASIGNACION_NO_ENCONTRADA', 'La asignación no existe.')

  let liberadas = 0
  for (const l of a.lines) {
    const libre = l.quantity - l.reservedQuantity - l.issuedQuantity - l.releasedQuantity
    if (libre <= 0) continue
    await registrarAsientoEnTx(
      tx,
      l.lotId,
      { type: 'RELEASE_ALLOCATION', sourceBucket: 'ALLOCATED', destinationBucket: 'AVAILABLE', quantity: libre, reason: motivo },
      { referenceType: 'ALLOCATION', referenceId: a.id },
      ctx.actorId
    )
    await tx.supplyV2AllocationLine.update({ where: { id: l.id }, data: { releasedQuantity: { increment: libre } } })
    liberadas += libre
  }
  if (a.status === 'ACTIVE' || a.status === 'EXHAUSTED' || a.status === 'DRAFT') {
    await tx.supplyV2Allocation.update({
      where: { id: a.id },
      data: { releasedQuantity: { increment: liberadas }, status: estadoFinal },
    })
  }
  if (liberadas > 0) {
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_ALLOCATION_RELEASED', 'SupplyV2Allocation', a.id, { liberadas, motivo, estadoFinal })
  }
  return { liberadas }
}
