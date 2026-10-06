import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { fallo } from '../core/errores'
import { estadoTrasRecepcion, ORDEN_RECIBIBLE, validarCantidadRecibida } from '../core/estados'
import { siguienteNumero } from '../core/numeracion'
import { registrarAsientoEnTx } from '../pool/lotes'
import { reconocerObligacionPorRecepcionEnTx } from '../finance/obligations'

/**
 * MEMBEGO SUPPLY 2.0 · RECEPCIÓN (§15–§22).
 *
 * AQUÍ ES DONDE NACE EL SUPPLY. Una sola transacción:
 *
 *   bloquear líneas de la orden → validar pendiente → recepción → líneas de
 *   recepción → lote por línea → asiento RECEIPT → receivedQuantity → estado
 *   de la orden → evento → bitácora
 *
 * Si algo falla, no queda nada: ni recepción sin lote, ni lote sin ledger, ni
 * orden actualizada sin recepción.
 *
 * IDEMPOTENTE por `idempotencyKey`: el doble clic devuelve la misma recepción.
 */

export interface LineaRecepcionEntrada {
  purchaseOrderLineId: string
  quantity: number
  expiresAt?: Date | null
  notes?: string | null
}

export interface DatosRecepcion {
  purchaseOrderId: string
  lines: LineaRecepcionEntrada[]
  receivedAt?: Date | null
  branchId?: string | null
  reference?: string | null
  notes?: string | null
  idempotencyKey?: string | null
}

export interface RecepcionConfirmada {
  id: string
  number: string
  purchaseOrderStatus: 'PARTIALLY_RECEIVED' | 'RECEIVED'
  lots: { id: string; code: string; quantity: number; catalogItemId: string }[]
  /** true si la clave de idempotencia ya existía y no se creó nada nuevo. */
  repetida: boolean
}

export async function confirmarRecepcionEnTx(
  tx: Tx,
  d: DatosRecepcion,
  ctx: ContextoAuditoria
): Promise<RecepcionConfirmada> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Una recepción necesita quién la recibe.')
  if (!d.lines?.length) fallo('RECEPCION_VACIA', 'Una recepción sin líneas no recibe nada.')
  for (const l of d.lines) {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) {
      fallo('CANTIDAD_INVALIDA', 'La cantidad recibida tiene que ser un entero positivo.')
    }
  }

  // 1. Bloquear la orden y sus líneas: dos recepciones simultáneas se
  //    serializan y la segunda ve el pendiente ya descontado.
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_purchase_orders" WHERE "id" = ${d.purchaseOrderId} FOR UPDATE`
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_purchase_order_lines" WHERE "purchaseOrderId" = ${d.purchaseOrderId} FOR UPDATE`

  // 2. Idempotencia, DESPUÉS del bloqueo: el segundo clic espera al primero y
  //    entonces encuentra su recepción.
  if (d.idempotencyKey) {
    const previa = await tx.supplyV2PurchaseReceipt.findUnique({
      where: { idempotencyKey: d.idempotencyKey },
      select: {
        id: true,
        number: true,
        purchaseOrder: { select: { status: true } },
        lots: { select: { id: true, code: true, quantityReceived: true, catalogItemId: true } },
      },
    })
    if (previa) {
      return {
        id: previa.id,
        number: previa.number,
        purchaseOrderStatus: previa.purchaseOrder.status === 'RECEIVED' ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
        lots: previa.lots.map((l) => ({ id: l.id, code: l.code, quantity: l.quantityReceived, catalogItemId: l.catalogItemId })),
        repetida: true,
      }
    }
  }

  const orden = await tx.supplyV2PurchaseOrder.findUnique({
    where: { id: d.purchaseOrderId },
    select: {
      id: true,
      number: true,
      status: true,
      supplierId: true,
      agreementId: true,
      agreementVersionId: true,
      currency: true,
      supplier: { select: { companyId: true } },
      lines: { select: { id: true, catalogItemId: true, quantity: true, receivedQuantity: true, unitCost: true, descriptionSnapshot: true } },
    },
  })
  if (!orden) fallo('ORDEN_NO_ENCONTRADA', 'La orden no existe.')
  if (!ORDEN_RECIBIBLE.includes(orden.status)) {
    fallo('ORDEN_NO_RECIBIBLE', 'Solo se recibe contra una orden aprobada y todavía no completa.')
  }
  if (d.branchId) {
    const s = await tx.sucursal.findUnique({ where: { id: d.branchId }, select: { companyId: true } })
    if (!s || s.companyId !== orden.supplier.companyId) fallo('SUCURSAL_AJENA', 'La sucursal no es de este proveedor.')
  }

  // 3. Validar cada línea contra su pendiente (nunca por encima de lo comprado).
  const lineasPorId = new Map(orden.lines.map((l) => [l.id, l]))
  const acumulado = new Map<string, number>()
  for (const l of d.lines) {
    const linea = lineasPorId.get(l.purchaseOrderLineId)
    if (!linea) fallo('LINEA_AJENA', 'Una línea de la recepción no pertenece a esta orden.')
    const yaEnEstaRecepcion = acumulado.get(linea.id) ?? 0
    const error = validarCantidadRecibida(l.quantity, {
      quantity: linea.quantity,
      receivedQuantity: linea.receivedQuantity + yaEnEstaRecepcion,
    })
    if (error) fallo('SOBRE_RECEPCION', `${linea.descriptionSnapshot}: ${error}`)
    acumulado.set(linea.id, yaEnEstaRecepcion + l.quantity)
  }

  const receivedAt = d.receivedAt ?? new Date()

  // 4. La recepción.
  const number = await siguienteNumero(tx, 'MBG-RC', async (prefijo) => {
    const u = await tx.supplyV2PurchaseReceipt.findFirst({
      where: { number: { startsWith: prefijo } },
      orderBy: { number: 'desc' },
      select: { number: true },
    })
    return u?.number ?? null
  }, receivedAt)

  const recepcion = await tx.supplyV2PurchaseReceipt.create({
    data: {
      number,
      purchaseOrderId: orden.id,
      supplierId: orden.supplierId,
      receivedAt,
      branchId: d.branchId ?? null,
      reference: d.reference?.trim() || null,
      notes: d.notes?.trim() || null,
      receivedById: ctx.actorId,
      status: 'CONFIRMED',
      idempotencyKey: d.idempotencyKey ?? null,
    },
    select: { id: true, number: true },
  })

  // 5. Por cada línea: línea de recepción → lote → asiento RECEIPT → pendiente.
  const lots: RecepcionConfirmada['lots'] = []
  for (const l of d.lines) {
    const linea = lineasPorId.get(l.purchaseOrderLineId)!
    const lineaRecepcion = await tx.supplyV2PurchaseReceiptLine.create({
      data: {
        receiptId: recepcion.id,
        purchaseOrderLineId: linea.id,
        quantity: l.quantity,
        expiresAt: l.expiresAt ?? null,
        notes: l.notes?.trim() || null,
      },
      select: { id: true },
    })
    const code = await siguienteNumero(tx, 'LOT', async (prefijo) => {
      const u = await tx.supplyV2Lot.findFirst({
        where: { code: { startsWith: prefijo } },
        orderBy: { code: 'desc' },
        select: { code: true },
      })
      return u?.code ?? null
    }, receivedAt)
    // El lote nace con recibido = cantidad y cubetas en cero: es el asiento
    // RECEIPT el que pone las unidades en AVAILABLE. Entre el INSERT y el
    // asiento el CHECK de cuadre se evalúa por fila; por eso nace en 0.
    const lote = await tx.supplyV2Lot.create({
      data: {
        code,
        supplierId: orden.supplierId,
        catalogItemId: linea.catalogItemId,
        purchaseOrderId: orden.id,
        purchaseOrderLineId: linea.id,
        receiptId: recepcion.id,
        receiptLineId: lineaRecepcion.id,
        agreementId: orden.agreementId,
        agreementVersionId: orden.agreementVersionId,
        quantityReceived: 0,
        unitCost: linea.unitCost,
        currency: orden.currency,
        receivedAt,
        expiresAt: l.expiresAt ?? null,
        status: 'ACTIVE',
      },
      select: { id: true, code: true },
    })
    await registrarAsientoEnTx(
      tx,
      lote.id,
      {
        type: 'RECEIPT',
        sourceBucket: null,
        destinationBucket: 'AVAILABLE',
        quantity: l.quantity,
        reason: `Recepción ${recepcion.number} de la orden ${orden.number}.`,
      },
      { referenceType: 'PURCHASE_RECEIPT', referenceId: recepcion.id },
      ctx.actorId
    )
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_LOT_CREATED', 'SupplyV2Lot', lote.id, {
      code: lote.code,
      receiptId: recepcion.id,
      purchaseOrderId: orden.id,
      catalogItemId: linea.catalogItemId,
      quantity: l.quantity,
      unitCost: linea.unitCost.toString(),
    }, orden.supplier.companyId)
    lots.push({ id: lote.id, code: lote.code, quantity: l.quantity, catalogItemId: linea.catalogItemId })
  }
  for (const [lineaId, cantidad] of acumulado) {
    await tx.supplyV2PurchaseOrderLine.update({
      where: { id: lineaId },
      data: { receivedQuantity: { increment: cantidad } },
    })
  }

  // 6. Estado de la orden, derivado de sus líneas.
  const lineasActualizadas = orden.lines.map((l) => ({
    quantity: l.quantity,
    receivedQuantity: l.receivedQuantity + (acumulado.get(l.id) ?? 0),
  }))
  const nuevoEstado = estadoTrasRecepcion(lineasActualizadas)
  await tx.supplyV2PurchaseOrder.update({ where: { id: orden.id }, data: { status: nuevoEstado } })
  await tx.supplyV2PurchaseOrderEvent.create({
    data: {
      purchaseOrderId: orden.id,
      type: nuevoEstado === 'RECEIVED' ? 'RECEIVED' : 'RECEIPT_CONFIRMED',
      fromStatus: orden.status,
      toStatus: nuevoEstado,
      reason: `Recepción ${recepcion.number}: ${d.lines.reduce((t, l) => t + l.quantity, 0)} unidades.`,
      actorId: ctx.actorId,
    },
  })

  // 6b. Slice 4 (§19): si la versión del acuerdo reconoce la deuda AL RECIBIR,
  //     nace la obligación aquí; PREPAID / ON_INVOICE no crean nada.
  await reconocerObligacionPorRecepcionEnTx(tx, recepcion.id, ctx)

  // 7. Bitácora.
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_RECEIPT_CONFIRMED', 'SupplyV2PurchaseReceipt', recepcion.id, {
    number: recepcion.number,
    purchaseOrderId: orden.id,
    purchaseOrderNumber: orden.number,
    antes: orden.status,
    despues: nuevoEstado,
    lots: lots.map((l) => ({ code: l.code, quantity: l.quantity })),
  }, orden.supplier.companyId)

  return { id: recepcion.id, number: recepcion.number, purchaseOrderStatus: nuevoEstado, lots, repetida: false }
}
