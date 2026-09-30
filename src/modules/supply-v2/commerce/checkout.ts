import type { Prisma, SupplyV2PaymentMethod } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { vencimientoDeReserva } from '../core/config'
import { fallo } from '../core/errores'
import {
  exigirTransicion,
  motivoNoComprable,
  ORDEN_CLIENTE_CON_RESERVA,
  TRANSICIONES_ORDEN_CLIENTE,
  unidadesQueCuentanParaLimite,
  validarLimitePorCliente,
} from '../core/estados'
import { repartirFefo } from '../core/fefo'
import { siguienteNumero } from '../core/numeracion'
import { calcularLineaCliente, montoCuadra } from '../core/precios'
import { registrarAsientoEnTx } from '../pool/lotes'
import { unidadesLibres } from '../offers/domain'
import { marcarAgotadaSiCorrespondeEnTx } from '../offers/service'
import type { PaymentAccountRef } from '../contracts/gateways'

/**
 * MEMBEGO SUPPLY 2.0 · CHECKOUT, RESERVA, PAGO Y DERECHO (§21–§37).
 *
 * TODO dentro de la `tx` de quien llama. La OFERTA se bloquea con
 * `FOR UPDATE` en cada operación que mueve sus unidades: dos clientes por la
 * última unidad, o dos checkouts del mismo cliente contra su límite, se
 * serializan en la base y solo uno pasa (§24, §35).
 *
 * Movimientos:
 *   abrir      ALLOCATED → RESERVED   (por lote, FEFO dentro de la asignación)
 *   cancelar   RESERVED  → ALLOCATED
 *   expirar    RESERVED  → ALLOCATED
 *   pagar      RESERVED  → ISSUED     + un derecho por unidad, con el costo del lote real
 */

export interface DatosCheckout {
  customerId: string
  offerId: string
  quantity: number
  idempotencyKey?: string | null
  /** Cuenta de cobro elegida; se congela como foto en la orden. */
  cuenta?: PaymentAccountRef | null
}

export interface OrdenClienteAbierta {
  id: string
  number: string
  total: string
  expiresAt: Date
  repetida: boolean
}

export async function abrirOrdenClienteEnTx(tx: Tx, d: DatosCheckout, ctx: ContextoAuditoria): Promise<OrdenClienteAbierta> {
  if (!Number.isInteger(d.quantity) || d.quantity <= 0) fallo('CANTIDAD_INVALIDA', 'La cantidad tiene que ser un entero positivo.')

  // 1. Bloquear la oferta: serializa a todos los compradores de esta oferta.
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_offers" WHERE "id" = ${d.offerId} FOR UPDATE`

  // 2. Idempotencia, después del bloqueo (§26).
  if (d.idempotencyKey) {
    const previa = await tx.supplyV2CustomerOrder.findUnique({
      where: { idempotencyKey: d.idempotencyKey },
      select: { id: true, number: true, total: true, expiresAt: true, customerId: true },
    })
    if (previa) {
      if (previa.customerId !== d.customerId) fallo('CLAVE_AJENA', 'Esa clave de compra no es tuya.')
      return { id: previa.id, number: previa.number, total: previa.total.toFixed(2), expiresAt: previa.expiresAt, repetida: true }
    }
  }

  const oferta = await tx.supplyV2Offer.findUnique({
    where: { id: d.offerId },
    select: {
      id: true,
      code: true,
      title: true,
      status: true,
      startsAt: true,
      endsAt: true,
      publicPrice: true,
      salePrice: true,
      currency: true,
      perCustomerLimit: true,
      supplier: { select: { companyId: true } },
      allocation: {
        select: {
          id: true,
          allocatedQuantity: true,
          reservedQuantity: true,
          issuedQuantity: true,
          releasedQuantity: true,
          lines: {
            select: { id: true, lotId: true, quantity: true, reservedQuantity: true, issuedQuantity: true, releasedQuantity: true, lot: { select: { expiresAt: true, receivedAt: true } } },
          },
        },
      },
    },
  })
  if (!oferta) fallo('OFERTA_NO_ENCONTRADA', 'La oferta no existe.')
  if (!oferta.allocation) fallo('OFERTA_SIN_SUPPLY', 'Esta oferta no tiene supply asignado.')
  const libres = unidadesLibres(oferta.allocation)
  const veto = motivoNoComprable(oferta, libres)
  if (veto) fallo('OFERTA_NO_COMPRABLE', veto)
  if (d.quantity > libres) fallo('SIN_UNIDADES', libres === 1 ? 'Solo queda 1 unidad en esta oferta.' : `Solo quedan ${libres} unidades en esta oferta.`)

  // 3. Límite por cliente: pagadas + reservas vivas de este cliente en esta oferta (§35).
  const previas = await tx.supplyV2CustomerOrderLine.findMany({
    where: { offerId: oferta.id, order: { customerId: d.customerId } },
    select: { quantity: true, order: { select: { status: true } } },
  })
  const yaCuenta = unidadesQueCuentanParaLimite(previas.map((p) => ({ status: p.order.status, quantity: p.quantity })))
  const limite = validarLimitePorCliente(oferta.perCustomerLimit, yaCuenta, d.quantity)
  if (limite) fallo('LIMITE_POR_CLIENTE', limite)

  // 4. FEFO dentro de la asignación: de qué lotes salen las unidades reservadas (§33).
  const candidatos = oferta.allocation.lines.map((l) => ({
    id: l.id,
    disponible: l.quantity - l.reservedQuantity - l.issuedQuantity - l.releasedQuantity,
    expiresAt: l.lot.expiresAt,
    receivedAt: l.lot.receivedAt,
  }))
  const reparto = repartirFefo(candidatos, d.quantity)
  const lineaPorId = new Map(oferta.allocation.lines.map((l) => [l.id, l]))

  // 5. La orden con sus precios congelados (§49).
  const linea = calcularLineaCliente(oferta.publicPrice, oferta.salePrice, d.quantity)
  const number = await siguienteNumero(tx, 'MBG-SO', async (prefijo) => {
    const u = await tx.supplyV2CustomerOrder.findFirst({ where: { number: { startsWith: prefijo } }, orderBy: { number: 'desc' }, select: { number: true } })
    return u?.number ?? null
  })
  const expiresAt = vencimientoDeReserva()
  const orden = await tx.supplyV2CustomerOrder.create({
    data: {
      number,
      customerId: d.customerId,
      currency: oferta.currency,
      subtotal: linea.subtotal,
      discount: linea.discount,
      total: linea.total,
      status: 'PENDING',
      paymentStatus: 'UNPAID',
      expiresAt,
      paymentAccountId: d.cuenta?.id ?? null,
      paymentAccountSnapshot: d.cuenta ? (d.cuenta as unknown as Prisma.InputJsonValue) : undefined,
      idempotencyKey: d.idempotencyKey ?? null,
      lines: {
        create: {
          offerId: oferta.id,
          titleSnapshot: oferta.title,
          quantity: d.quantity,
          publicUnitPrice: linea.publicUnitPrice,
          saleUnitPrice: linea.saleUnitPrice,
          subtotal: linea.subtotal,
          discount: linea.discount,
          total: linea.total,
          reservations: {
            create: reparto.map((r) => ({ allocationLineId: r.id, lotId: lineaPorId.get(r.id)!.lotId, quantity: r.cantidad, status: 'ACTIVE' })),
          },
        },
      },
    },
    select: { id: true, number: true, total: true, expiresAt: true },
  })

  // 6. ALLOCATED → RESERVED en cada lote, y los contadores.
  for (const r of reparto) {
    const l = lineaPorId.get(r.id)!
    await registrarAsientoEnTx(
      tx,
      l.lotId,
      { type: 'RESERVATION', sourceBucket: 'ALLOCATED', destinationBucket: 'RESERVED', quantity: r.cantidad, reason: `Reserva de la orden ${orden.number} (oferta ${oferta.code}).` },
      { referenceType: 'CUSTOMER_ORDER', referenceId: orden.id },
      ctx.actorId
    )
    await tx.supplyV2AllocationLine.update({ where: { id: l.id }, data: { reservedQuantity: { increment: r.cantidad } } })
  }
  await tx.supplyV2Allocation.update({ where: { id: oferta.allocation.id }, data: { reservedQuantity: { increment: d.quantity } } })

  await auditarEnTx(tx, ctx, 'SUPPLY_V2_ORDER_CREATED', 'SupplyV2CustomerOrder', orden.id, {
    number: orden.number,
    offerId: oferta.id,
    quantity: d.quantity,
    total: orden.total.toString(),
  }, oferta.supplier.companyId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_ORDER_RESERVED', 'SupplyV2CustomerOrder', orden.id, {
    number: orden.number,
    reservas: reparto.map((r) => ({ lotId: lineaPorId.get(r.id)!.lotId, quantity: r.cantidad })),
    expiresAt: expiresAt.toISOString(),
  }, oferta.supplier.companyId)

  return { id: orden.id, number: orden.number, total: orden.total.toFixed(2), expiresAt, repetida: false }
}

// ── Liberar (cancelar / expirar / rechazar) ────────────────────────────────

async function ordenBloqueada(tx: Tx, orderId: string) {
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_customer_orders" WHERE "id" = ${orderId} FOR UPDATE`
  const o = await tx.supplyV2CustomerOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      number: true,
      status: true,
      paymentStatus: true,
      customerId: true,
      total: true,
      currency: true,
      expiresAt: true,
      lines: {
        select: {
          id: true,
          offerId: true,
          quantity: true,
          saleUnitPrice: true,
          offer: { select: { id: true, code: true, supplierId: true, catalogItemId: true, allocationId: true, supplier: { select: { companyId: true } } } },
          reservations: { where: { status: 'ACTIVE' }, select: { id: true, allocationLineId: true, lotId: true, quantity: true } },
        },
      },
    },
  })
  if (!o) fallo('ORDEN_NO_ENCONTRADA', 'La compra no existe.')
  return o
}

type OrdenBloqueada = Awaited<ReturnType<typeof ordenBloqueada>>

/** RESERVED → ALLOCATED para todas las reservas vivas de la orden. */
async function soltarReservasEnTx(tx: Tx, o: OrdenBloqueada, motivo: string, actorId: string | null): Promise<number> {
  let soltadas = 0
  for (const l of o.lines) {
    // Bloquear la oferta para que el contador no compita con un checkout.
    await tx.$queryRaw`SELECT "id" FROM "supply_v2_offers" WHERE "id" = ${l.offerId} FOR UPDATE`
    for (const r of l.reservations) {
      await registrarAsientoEnTx(
        tx,
        r.lotId,
        { type: 'RELEASE_RESERVATION', sourceBucket: 'RESERVED', destinationBucket: 'ALLOCATED', quantity: r.quantity, reason: motivo },
        { referenceType: 'CUSTOMER_ORDER', referenceId: o.id },
        actorId
      )
      await tx.supplyV2AllocationLine.update({ where: { id: r.allocationLineId }, data: { reservedQuantity: { decrement: r.quantity } } })
      await tx.supplyV2OrderReservation.update({ where: { id: r.id }, data: { status: 'RELEASED', releasedAt: new Date() } })
      soltadas += r.quantity
    }
    if (l.offer.allocationId && l.reservations.length > 0) {
      await tx.supplyV2Allocation.update({
        where: { id: l.offer.allocationId },
        data: { reservedQuantity: { decrement: l.reservations.reduce((t, r) => t + r.quantity, 0) } },
      })
    }
  }
  return soltadas
}

/** El cliente se echa atrás antes de pagar (§36). Solo el dueño. */
export async function cancelarOrdenClienteEnTx(tx: Tx, orderId: string, customerId: string, ctx: ContextoAuditoria): Promise<void> {
  const o = await ordenBloqueada(tx, orderId)
  if (o.customerId !== customerId) fallo('ORDEN_AJENA', 'Esa compra no es tuya.')
  exigirTransicion(TRANSICIONES_ORDEN_CLIENTE, o.status, 'CANCELLED', 'Compra')
  const soltadas = await soltarReservasEnTx(tx, o, `Cancelada por el cliente (${o.number}).`, ctx.actorId)
  await tx.supplyV2CustomerOrder.update({ where: { id: o.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_ORDER_CANCELLED', 'SupplyV2CustomerOrder', o.id, { number: o.number, antes: o.status, soltadas }, o.lines[0]?.offer.supplier.companyId ?? null)
}

/** Expira una orden PENDING cuya reserva caducó (§37). Idempotente. */
export async function expirarOrdenEnTx(tx: Tx, orderId: string, ctx: ContextoAuditoria, ahora = new Date()): Promise<boolean> {
  const o = await ordenBloqueada(tx, orderId)
  if (o.status !== 'PENDING') return false
  if (o.expiresAt > ahora) return false
  const soltadas = await soltarReservasEnTx(tx, o, `Reserva expirada (${o.number}).`, ctx.actorId)
  await tx.supplyV2CustomerOrder.update({ where: { id: o.id }, data: { status: 'EXPIRED', expiredAt: ahora } })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_ORDER_EXPIRED', 'SupplyV2CustomerOrder', o.id, { number: o.number, soltadas }, o.lines[0]?.offer.supplier.companyId ?? null)
  return true
}

/** Membego revisó y NO vio el dinero: la reserva se suelta y la orden se cancela. */
export async function rechazarPagoEnTx(tx: Tx, orderId: string, motivo: string, ctx: ContextoAuditoria): Promise<void> {
  if (!motivo?.trim()) fallo('MOTIVO_OBLIGATORIO', 'Rechazar un pago exige un motivo.')
  const o = await ordenBloqueada(tx, orderId)
  if (!ORDEN_CLIENTE_CON_RESERVA.includes(o.status)) fallo('ORDEN_NO_RECHAZABLE', `Una compra ${o.status} no se puede rechazar.`)
  const soltadas = await soltarReservasEnTx(tx, o, `Pago rechazado (${o.number}): ${motivo.trim()}`, ctx.actorId)
  await tx.supplyV2CustomerOrder.update({
    where: { id: o.id },
    data: { status: 'CANCELLED', paymentStatus: 'REJECTED', paymentRejectedReason: motivo.trim(), cancelledAt: new Date() },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_ORDER_PAYMENT_REJECTED', 'SupplyV2CustomerOrder', o.id, { number: o.number, motivo: motivo.trim(), soltadas }, o.lines[0]?.offer.supplier.companyId ?? null)
}

// ── Pago ───────────────────────────────────────────────────────────────────

/** El cliente avisa que pagó (§29): la orden pasa a revisión y la reserva aguanta. */
export async function avisarPagoEnTx(
  tx: Tx,
  d: { orderId: string; customerId: string; method: SupplyV2PaymentMethod; reference?: string | null },
  ctx: ContextoAuditoria
): Promise<void> {
  const o = await ordenBloqueada(tx, d.orderId)
  if (o.customerId !== d.customerId) fallo('ORDEN_AJENA', 'Esa compra no es tuya.')
  if (o.status === 'AWAITING_PAYMENT') return
  exigirTransicion(TRANSICIONES_ORDEN_CLIENTE, o.status, 'AWAITING_PAYMENT', 'Compra')
  if (o.expiresAt <= new Date()) fallo('RESERVA_VENCIDA', 'La reserva de esta compra ya venció. Vuelve a comprar.')
  await tx.supplyV2CustomerOrder.update({
    where: { id: o.id },
    data: { status: 'AWAITING_PAYMENT', paymentStatus: 'SUBMITTED', paymentMethod: d.method, paymentReference: d.reference?.trim() || null, paymentSubmittedAt: new Date() },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_ORDER_PAYMENT_SUBMITTED', 'SupplyV2CustomerOrder', o.id, {
    number: o.number,
    method: d.method,
    reference: d.reference?.trim() || null,
  }, o.lines[0]?.offer.supplier.companyId ?? null)
}

export interface PagoConfirmado {
  id: string
  number: string
  entitlements: { id: string; lotId: string; actualUnitCost: string }[]
  repetido: boolean
}

/**
 * CONFIRMACIÓN DEL PAGO (§30): una persona de Membego vio el dinero. En UNA
 * transacción: bloquear la orden → validar → RESERVED → ISSUED por lote →
 * un derecho por unidad con el costo REAL del lote → orden PAID → bitácora.
 * Idempotente: una orden ya PAID devuelve sus derechos sin emitir de nuevo.
 */
export async function confirmarPagoEnTx(
  tx: Tx,
  d: { orderId: string; amountSeen: number | string; method?: SupplyV2PaymentMethod | null },
  ctx: ContextoAuditoria
): Promise<PagoConfirmado> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Confirmar un pago necesita quién lo confirma.')
  const o = await ordenBloqueada(tx, d.orderId)
  if (o.status === 'PAID') {
    const existentes = await tx.supplyV2Entitlement.findMany({ where: { orderId: o.id }, select: { id: true, lotId: true, actualUnitCost: true } })
    return { id: o.id, number: o.number, entitlements: existentes.map((e) => ({ ...e, actualUnitCost: e.actualUnitCost.toFixed(2) })), repetido: true }
  }
  exigirTransicion(TRANSICIONES_ORDEN_CLIENTE, o.status, 'PAID', 'Compra')
  if (!montoCuadra(d.amountSeen, o.total)) {
    fallo('MONTO_NO_CUADRA', `El monto visto (${d.amountSeen}) no coincide con el total de la compra (${o.total.toFixed(2)}).`)
  }
  const reservadas = o.lines.reduce((t, l) => t + l.reservations.reduce((s, r) => s + r.quantity, 0), 0)
  const pedidas = o.lines.reduce((t, l) => t + l.quantity, 0)
  if (reservadas !== pedidas) fallo('RESERVA_INCOMPLETA', 'La reserva de esta compra ya no está completa: no se puede emitir.')

  const entitlements: PagoConfirmado['entitlements'] = []
  for (const l of o.lines) {
    await tx.$queryRaw`SELECT "id" FROM "supply_v2_offers" WHERE "id" = ${l.offerId} FOR UPDATE`
    for (const r of l.reservations) {
      const lote = await tx.supplyV2Lot.findUniqueOrThrow({ where: { id: r.lotId }, select: { unitCost: true, currency: true, expiresAt: true } })
      await registrarAsientoEnTx(
        tx,
        r.lotId,
        { type: 'ISSUE', sourceBucket: 'RESERVED', destinationBucket: 'ISSUED', quantity: r.quantity, reason: `Pago confirmado de la orden ${o.number}.` },
        { referenceType: 'CUSTOMER_ORDER', referenceId: o.id },
        ctx.actorId
      )
      await tx.supplyV2AllocationLine.update({
        where: { id: r.allocationLineId },
        data: { reservedQuantity: { decrement: r.quantity }, issuedQuantity: { increment: r.quantity } },
      })
      await tx.supplyV2OrderReservation.update({ where: { id: r.id }, data: { status: 'ISSUED', issuedAt: new Date() } })
      for (let i = 0; i < r.quantity; i++) {
        const e = await tx.supplyV2Entitlement.create({
          data: {
            customerId: o.customerId,
            supplierId: l.offer.supplierId,
            catalogItemId: l.offer.catalogItemId,
            offerId: l.offer.id,
            orderId: o.id,
            orderLineId: l.id,
            allocationId: l.offer.allocationId!,
            allocationLineId: r.allocationLineId,
            lotId: r.lotId,
            quantity: 1,
            origin: 'PURCHASE',
            actualUnitCost: lote.unitCost,
            customerUnitPrice: l.saleUnitPrice,
            currency: lote.currency,
            status: 'ACTIVE',
            expiresAt: lote.expiresAt,
          },
          select: { id: true, lotId: true, actualUnitCost: true },
        })
        entitlements.push({ id: e.id, lotId: e.lotId, actualUnitCost: e.actualUnitCost.toFixed(2) })
      }
    }
    if (l.offer.allocationId) {
      const q = l.reservations.reduce((t, r) => t + r.quantity, 0)
      await tx.supplyV2Allocation.update({
        where: { id: l.offer.allocationId },
        data: { reservedQuantity: { decrement: q }, issuedQuantity: { increment: q } },
      })
    }
    await marcarAgotadaSiCorrespondeEnTx(tx, l.offerId)
  }
  await tx.supplyV2CustomerOrder.update({
    where: { id: o.id },
    data: {
      status: 'PAID',
      paymentStatus: 'CONFIRMED',
      paidAt: new Date(),
      paymentConfirmedById: ctx.actorId,
      paymentAmountSeen: String(d.amountSeen),
      ...(d.method ? { paymentMethod: d.method } : {}),
    },
  })
  const companyId = o.lines[0]?.offer.supplier.companyId ?? null
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_ORDER_PAID', 'SupplyV2CustomerOrder', o.id, {
    number: o.number,
    total: o.total.toString(),
    amountSeen: String(d.amountSeen),
    entitlements: entitlements.length,
  }, companyId)
  for (const e of entitlements) {
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_ENTITLEMENT_ISSUED', 'SupplyV2Entitlement', e.id, {
      orderId: o.id,
      number: o.number,
      lotId: e.lotId,
      actualUnitCost: e.actualUnitCost,
      customerId: o.customerId,
    }, companyId)
  }
  return { id: o.id, number: o.number, entitlements, repetido: false }
}
