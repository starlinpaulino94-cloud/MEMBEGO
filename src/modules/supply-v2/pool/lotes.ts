import type { Prisma } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { aplicarMovimiento, cubetasDeLote, invarianteCumplido, type Buckets, type LedgerMove } from '../core/ledger'
import { fallo } from '../core/errores'

/**
 * MEMBEGO SUPPLY 2.0 · escritura del ledger.
 *
 * `registrarAsientoEnTx` es LA función que mueve unidades: lee el lote
 * (bloqueado por quien llama o aquí mismo), calcula las cubetas con el ledger
 * puro, escribe el asiento con saldo antes/después y actualiza la caché del
 * lote. Ningún otro código escribe `quantityAvailable` & co. a mano.
 */

export interface ReferenciaAsiento {
  referenceType: 'PURCHASE_RECEIPT' | 'ADJUSTMENT' | 'CANCELLATION' | 'ALLOCATION' | 'CUSTOMER_ORDER' | 'ENTITLEMENT' | 'OFFER' | 'REDEMPTION'
  referenceId: string
}

export async function registrarAsientoEnTx(
  tx: Tx,
  lotId: string,
  movimiento: LedgerMove,
  ref: ReferenciaAsiento,
  actorId: string | null
): Promise<{ id: string; antes: Buckets; despues: Buckets }> {
  // Bloqueo de fila: dos asientos sobre el mismo lote se serializan.
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_lots" WHERE "id" = ${lotId} FOR UPDATE`
  const lote = await tx.supplyV2Lot.findUnique({
    where: { id: lotId },
    select: {
      id: true,
      quantityReceived: true,
      quantityAvailable: true,
      quantityAllocated: true,
      quantityReserved: true,
      quantityIssued: true,
      quantityRedeemed: true,
      quantityClosed: true,
    },
  })
  if (!lote) fallo('LOTE_NO_ENCONTRADO', 'El lote no existe.')

  const antes = cubetasDeLote(lote)
  const despues = aplicarMovimiento(antes, movimiento)
  // Lo que entra o sale del lote cambia lo «recibido» del lote.
  const recibido =
    lote.quantityReceived +
    (movimiento.sourceBucket === null ? movimiento.quantity : 0) -
    (movimiento.destinationBucket === null ? movimiento.quantity : 0)
  if (!invarianteCumplido(recibido, despues)) {
    fallo('LEDGER_DESCUADRADO', 'El asiento dejaría el lote descuadrado.')
  }

  const asiento = await tx.supplyV2LedgerEntry.create({
    data: {
      lotId,
      type: movimiento.type,
      sourceBucket: movimiento.sourceBucket,
      destinationBucket: movimiento.destinationBucket,
      quantity: movimiento.quantity,
      balanceBefore: antes.AVAILABLE,
      balanceAfter: despues.AVAILABLE,
      bucketsBefore: antes as unknown as Prisma.InputJsonValue,
      bucketsAfter: despues as unknown as Prisma.InputJsonValue,
      referenceType: ref.referenceType,
      referenceId: ref.referenceId,
      reason: movimiento.reason ?? null,
      actorId,
    },
    select: { id: true },
  })
  await tx.supplyV2Lot.update({
    where: { id: lotId },
    data: {
      quantityReceived: recibido,
      quantityAvailable: despues.AVAILABLE,
      quantityAllocated: despues.ALLOCATED,
      quantityReserved: despues.RESERVED,
      quantityIssued: despues.ISSUED,
      quantityRedeemed: despues.REDEEMED,
      quantityClosed: despues.CLOSED,
      status:
        despues.AVAILABLE + despues.ALLOCATED + despues.RESERVED + despues.ISSUED === 0
          ? despues.CLOSED === recibido && despues.REDEEMED === 0
            ? 'CLOSED'
            : 'EXHAUSTED'
          : 'ACTIVE',
    },
  })
  return { id: asiento.id, antes, despues }
}
