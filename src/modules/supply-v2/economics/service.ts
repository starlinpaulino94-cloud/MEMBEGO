import type { Prisma } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { type Decimal } from '../core/dinero'
import { fallo } from '../core/errores'
import { snapshotDeVenta } from './domain'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 4 · EVENTOS ECONÓMICOS (§22–§30).
 *
 * Cada función es IDEMPOTENTE por `type + referenceType + referenceId`
 * (índice único): reconocer la misma venta dos veces deja un solo evento.
 * Los importes salen de lo congelado en el derecho (costo real del lote y
 * precio que pagó el cliente), nunca del catálogo ni de la oferta actual.
 */

export interface EventoCreado {
  id: string
  repetido: boolean
}

/**
 * VENTA (§24–§25, §29): al emitir un derecho (pago del cliente confirmado)
 * nace UN evento con ingreso, costo y margen. Aquí, y solo aquí, se reconoce
 * el costo de la unidad vendida.
 */
export async function reconocerVentaEnTx(tx: Tx, entitlementId: string, ctx: ContextoAuditoria): Promise<EventoCreado> {
  const previo = await tx.supplyV2EconomicEvent.findUnique({ where: { type_referenceType_referenceId: { type: 'SALE_REVENUE', referenceType: 'ENTITLEMENT', referenceId: entitlementId } }, select: { id: true } })
  if (previo) return { id: previo.id, repetido: true }
  const e = await tx.supplyV2Entitlement.findUnique({
    where: { id: entitlementId },
    select: {
      id: true,
      quantity: true,
      actualUnitCost: true,
      customerUnitPrice: true,
      currency: true,
      issuedAt: true,
      supplierId: true,
      catalogItemId: true,
      lotId: true,
      orderId: true,
      orderLine: { select: { publicUnitPrice: true } },
      order: { select: { number: true } },
      offer: { select: { code: true } },
      lot: { select: { code: true } },
      supplier: { select: { companyId: true } },
    },
  })
  if (!e) fallo('DERECHO_NO_ENCONTRADO', 'El derecho no existe.')
  const s = snapshotDeVenta({ customerUnitPrice: e.customerUnitPrice, publicUnitPrice: e.orderLine.publicUnitPrice, actualUnitCost: e.actualUnitCost })
  const q = e.quantity
  const ev = await tx.supplyV2EconomicEvent.create({
    data: {
      type: 'SALE_REVENUE',
      referenceType: 'ENTITLEMENT',
      referenceId: e.id,
      supplierId: e.supplierId,
      catalogItemId: e.catalogItemId,
      lotId: e.lotId,
      entitlementId: e.id,
      customerOrderId: e.orderId,
      currency: e.currency,
      units: q,
      gmvAmount: s.customerPaid.times(q),
      revenueAmount: s.customerPaid.times(q),
      costAmount: s.actualUnitCost.times(q),
      grossMarginAmount: s.grossMargin.times(q),
      occurredAt: e.issuedAt,
      metadata: {
        customerPaid: s.customerPaid.toFixed(2),
        publicPrice: s.publicPrice.toFixed(2),
        discount: s.discount.toFixed(2),
        actualUnitCost: s.actualUnitCost.toFixed(2),
        grossMargin: s.grossMargin.toFixed(2),
        orderNumber: e.order.number,
        offerCode: e.offer.code,
        lotCode: e.lot.code,
        costModel: 'RECOGNIZED_AT_SALE',
      } satisfies Prisma.InputJsonValue,
    },
    select: { id: true },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_ECONOMIC_EVENT_CREATED', 'SupplyV2EconomicEvent', ev.id, { type: 'SALE_REVENUE', entitlementId: e.id, revenue: s.customerPaid.times(q).toFixed(2), cost: s.actualUnitCost.times(q).toFixed(2) }, e.supplier.companyId)
  return { id: ev.id, repetido: false }
}

/**
 * BREAKAGE (§28, §66): un derecho vencido sin redimir. Unidad +1, sin
 * dinero: el ingreso se conserva y el costo ya se reconoció en la venta.
 */
export async function registrarBreakageEnTx(tx: Tx, entitlementId: string, ctx: ContextoAuditoria, ahora = new Date()): Promise<EventoCreado> {
  const previo = await tx.supplyV2EconomicEvent.findUnique({ where: { type_referenceType_referenceId: { type: 'BREAKAGE', referenceType: 'ENTITLEMENT', referenceId: entitlementId } }, select: { id: true } })
  if (previo) return { id: previo.id, repetido: true }
  const e = await tx.supplyV2Entitlement.findUnique({
    where: { id: entitlementId },
    select: { id: true, quantity: true, actualUnitCost: true, customerUnitPrice: true, currency: true, supplierId: true, catalogItemId: true, lotId: true, orderId: true, supplier: { select: { companyId: true } } },
  })
  if (!e) fallo('DERECHO_NO_ENCONTRADO', 'El derecho no existe.')
  const venta = await tx.supplyV2EconomicEvent.findUnique({ where: { type_referenceType_referenceId: { type: 'SALE_REVENUE', referenceType: 'ENTITLEMENT', referenceId: e.id } }, select: { id: true } })
  const ev = await tx.supplyV2EconomicEvent.create({
    data: {
      type: 'BREAKAGE',
      referenceType: 'ENTITLEMENT',
      referenceId: e.id,
      supplierId: e.supplierId,
      catalogItemId: e.catalogItemId,
      lotId: e.lotId,
      entitlementId: e.id,
      customerOrderId: e.orderId,
      currency: e.currency,
      units: e.quantity,
      gmvAmount: 0,
      revenueAmount: 0,
      costAmount: 0,
      grossMarginAmount: 0,
      occurredAt: ahora,
      metadata: {
        acquisitionCost: e.actualUnitCost.times(e.quantity).toFixed(2),
        revenueKept: e.customerUnitPrice.times(e.quantity).toFixed(2),
        costRecognizedByEventId: venta?.id ?? null,
        note: 'El costo ya se reconoció al vender; no se suma dos veces.',
      } satisfies Prisma.InputJsonValue,
    },
    select: { id: true },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_ECONOMIC_EVENT_CREATED', 'SupplyV2EconomicEvent', ev.id, { type: 'BREAKAGE', entitlementId: e.id }, e.supplier.companyId)
  return { id: ev.id, repetido: false }
}

/**
 * SUPPLY VENCIDO SIN VENDER (§50): unidades de un lote que caducaron en
 * AVAILABLE/ALLOCATED. Su costo nunca se reconoció (no se vendieron): es
 * pérdida real = unidades × costo del lote. Idempotente por asiento.
 */
export async function registrarVencimientoDeLoteEnTx(tx: Tx, d: { lotId: string; ledgerEntryId: string; unidades: number }, ctx: ContextoAuditoria, ahora = new Date()): Promise<EventoCreado> {
  const previo = await tx.supplyV2EconomicEvent.findUnique({ where: { type_referenceType_referenceId: { type: 'EXPIRATION_COST', referenceType: 'LOT', referenceId: d.ledgerEntryId } }, select: { id: true } })
  if (previo) return { id: previo.id, repetido: true }
  const l = await tx.supplyV2Lot.findUnique({ where: { id: d.lotId }, select: { id: true, code: true, unitCost: true, currency: true, supplierId: true, catalogItemId: true, supplier: { select: { companyId: true } } } })
  if (!l) fallo('LOTE_NO_ENCONTRADO', 'El lote no existe.')
  const cost: Decimal = l.unitCost.times(d.unidades)
  const ev = await tx.supplyV2EconomicEvent.create({
    data: {
      type: 'EXPIRATION_COST',
      referenceType: 'LOT',
      referenceId: d.ledgerEntryId,
      supplierId: l.supplierId,
      catalogItemId: l.catalogItemId,
      lotId: l.id,
      currency: l.currency,
      units: d.unidades,
      gmvAmount: 0,
      revenueAmount: 0,
      costAmount: cost,
      grossMarginAmount: cost.negated(),
      occurredAt: ahora,
      metadata: { lotCode: l.code, unitCost: l.unitCost.toFixed(2), ledgerEntryId: d.ledgerEntryId } satisfies Prisma.InputJsonValue,
    },
    select: { id: true },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_ECONOMIC_EVENT_CREATED', 'SupplyV2EconomicEvent', ev.id, { type: 'EXPIRATION_COST', lotId: l.id, units: d.unidades, cost: cost.toFixed(2) }, l.supplier.companyId)
  return { id: ev.id, repetido: false }
}

/** Ventas anteriores al Slice 4 (o que fallaron): derechos sin evento de venta. Idempotente; el cron lo llama. */
export async function proyectarVentasSinEventoEnTx(tx: Tx, ctx: ContextoAuditoria, limite = 200): Promise<number> {
  const pendientes = await tx.supplyV2Entitlement.findMany({
    where: { status: { not: 'CANCELLED' }, economicEvents: { none: { type: 'SALE_REVENUE' } } },
    select: { id: true },
    orderBy: { issuedAt: 'asc' },
    take: limite,
  })
  let n = 0
  for (const e of pendientes) {
    const r = await reconocerVentaEnTx(tx, e.id, ctx)
    if (!r.repetido) n++
  }
  return n
}
