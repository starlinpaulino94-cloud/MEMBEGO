import type { Prisma } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { decimal, type Decimal } from '../core/dinero'
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
  const e = await tx.supplyV2Entitlement.findUnique({
    where: { id: entitlementId },
    select: {
      id: true,
      quantity: true,
      sourceType: true,
      actualUnitCost: true,
      customerUnitPrice: true,
      commissionPercentage: true,
      commissionAmount: true,
      supplierNet: true,
      contractualUnitValue: true,
      supplierDiscountAmount: true,
      membegoSubsidyAmount: true,
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
  if (e.sourceType === 'COMMISSION') {
    const r = await reconocerVentaComisionEnTx(tx, e, ctx)
    await registrarSubsidioEnTx(tx, e, ctx)
    return r
  }
  const previo = await tx.supplyV2EconomicEvent.findUnique({ where: { type_referenceType_referenceId: { type: 'SALE_REVENUE', referenceType: 'ENTITLEMENT', referenceId: entitlementId } }, select: { id: true } })
  if (previo) {
    await registrarSubsidioEnTx(tx, e, ctx)
    return { id: previo.id, repetido: true }
  }
  const s = snapshotDeVenta({ customerUnitPrice: e.customerUnitPrice, publicUnitPrice: e.orderLine.publicUnitPrice, actualUnitCost: e.actualUnitCost, contractualUnitValue: e.contractualUnitValue })
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
      // Slice 6 (§28): GMV = valor contractual + descuento del proveedor (lo que vale la venta); ingreso = valor contractual.
      gmvAmount: s.contractualValue.plus(e.supplierDiscountAmount).times(q),
      revenueAmount: s.contractualValue.times(q),
      costAmount: s.actualUnitCost.times(q),
      grossMarginAmount: s.grossMargin.times(q),
      contractualAmount: s.contractualValue.times(q),
      supplierDiscountAmount: e.supplierDiscountAmount.times(q),
      subsidyAmount: e.membegoSubsidyAmount.times(q),
      customerPaidAmount: s.customerPaid.times(q),
      occurredAt: e.issuedAt,
      metadata: {
        customerPaid: s.customerPaid.toFixed(2),
        contractualValue: s.contractualValue.toFixed(2),
        membegoSubsidy: e.membegoSubsidyAmount.toFixed(2),
        supplierDiscount: e.supplierDiscountAmount.toFixed(2),
        publicPrice: s.publicPrice.toFixed(2),
        discount: s.discount.toFixed(2),
        actualUnitCost: s.actualUnitCost.toFixed(2),
        grossMargin: s.grossMargin.toFixed(2),
        orderNumber: e.order.number,
        offerCode: e.offer.code,
        lotCode: e.lot?.code ?? null,
        costModel: 'RECOGNIZED_AT_SALE',
      } satisfies Prisma.InputJsonValue,
    },
    select: { id: true },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_ECONOMIC_EVENT_CREATED', 'SupplyV2EconomicEvent', ev.id, { type: 'SALE_REVENUE', entitlementId: e.id, revenue: s.contractualValue.times(q).toFixed(2), cost: s.actualUnitCost.times(q).toFixed(2), subsidy: e.membegoSubsidyAmount.times(q).toFixed(2) }, e.supplier.companyId)
  await registrarSubsidioEnTx(tx, e, ctx)
  return { id: ev.id, repetido: false }
}

/**
 * Slice 6 (§28) · SUBSIDIO DE MEMBEGO: lo que Membego financió en la venta es
 * un COSTO PROMOCIONAL aparte. Evento propio (idempotente por derecho): no se
 * resta del ingreso ni se suma al costo del supply; se ve en la contribución
 * después de subsidio. Sin subsidio no hay evento.
 */
export async function registrarSubsidioEnTx(
  tx: Tx,
  e: { id: string; quantity: number; membegoSubsidyAmount: Decimal; supplierDiscountAmount: Decimal; contractualUnitValue: Decimal; customerUnitPrice: Decimal; currency: string; issuedAt: Date; supplierId: string; catalogItemId: string; lotId: string | null; orderId: string; supplier: { companyId: string | null } },
  ctx: ContextoAuditoria
): Promise<EventoCreado | null> {
  if (e.membegoSubsidyAmount.lessThanOrEqualTo(0)) return null
  const previo = await tx.supplyV2EconomicEvent.findUnique({ where: { type_referenceType_referenceId: { type: 'MEMBEGO_SUBSIDY', referenceType: 'ENTITLEMENT', referenceId: e.id } }, select: { id: true } })
  if (previo) return { id: previo.id, repetido: true }
  const q = e.quantity
  const ev = await tx.supplyV2EconomicEvent.create({
    data: {
      type: 'MEMBEGO_SUBSIDY',
      referenceType: 'ENTITLEMENT',
      referenceId: e.id,
      supplierId: e.supplierId,
      catalogItemId: e.catalogItemId,
      lotId: e.lotId,
      entitlementId: e.id,
      customerOrderId: e.orderId,
      currency: e.currency,
      units: q,
      gmvAmount: 0,
      revenueAmount: 0,
      costAmount: 0,
      grossMarginAmount: 0,
      contractualAmount: e.contractualUnitValue.times(q),
      supplierDiscountAmount: e.supplierDiscountAmount.times(q),
      subsidyAmount: e.membegoSubsidyAmount.times(q),
      customerPaidAmount: e.customerUnitPrice.times(q),
      occurredAt: e.issuedAt,
      metadata: { note: 'Subsidio financiado por Membego: costo promocional, separado del margen bruto.', subsidy: e.membegoSubsidyAmount.times(q).toFixed(2) } satisfies Prisma.InputJsonValue,
    },
    select: { id: true },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_ECONOMIC_EVENT_CREATED', 'SupplyV2EconomicEvent', ev.id, { type: 'MEMBEGO_SUBSIDY', entitlementId: e.id, subsidy: e.membegoSubsidyAmount.times(q).toFixed(2) }, e.supplier.companyId)
  return { id: ev.id, repetido: false }
}

type DerechoComision = {
  id: string
  quantity: number
  customerUnitPrice: Decimal
  contractualUnitValue: Decimal
  supplierDiscountAmount: Decimal
  membegoSubsidyAmount: Decimal
  commissionPercentage: Decimal | null
  commissionAmount: Decimal | null
  supplierNet: Decimal | null
  currency: string
  issuedAt: Date
  supplierId: string
  catalogItemId: string
  orderId: string
  orderLine: { publicUnitPrice: Decimal }
  order: { number: string }
  offer: { code: string }
  supplier: { companyId: string | null }
}

/**
 * Slice 5 · VENTA A COMISIÓN (§53–§56): al confirmarse el pago del cliente
 * nace UN evento `COMMISSION_REVENUE` por derecho: GMV = lo que pagó el
 * cliente, INGRESO = la comisión, COSTO = 0 (Membego no compró nada) y el
 * neto del proveedor va en los metadatos (no es ingreso ni costo). Lo que se
 * le debe al proveedor nace después, al entregar, como obligación.
 */
async function reconocerVentaComisionEnTx(tx: Tx, e: DerechoComision, ctx: ContextoAuditoria): Promise<EventoCreado> {
  const previo = await tx.supplyV2EconomicEvent.findUnique({ where: { type_referenceType_referenceId: { type: 'COMMISSION_REVENUE', referenceType: 'ENTITLEMENT', referenceId: e.id } }, select: { id: true } })
  if (previo) return { id: previo.id, repetido: true }
  if (e.commissionAmount == null || e.supplierNet == null) fallo('DERECHO_SIN_FOTO', 'El derecho a comisión no tiene la foto de la comisión.')
  // Slice 6: contractual = lo que pagó el cliente + subsidio de Membego; GMV = contractual + descuento del proveedor.
  const contractual = e.contractualUnitValue.isZero() ? e.customerUnitPrice : e.contractualUnitValue
  const gmv = contractual.plus(e.supplierDiscountAmount).times(e.quantity)
  const ev = await tx.supplyV2EconomicEvent.create({
    data: {
      type: 'COMMISSION_REVENUE',
      referenceType: 'ENTITLEMENT',
      referenceId: e.id,
      supplierId: e.supplierId,
      catalogItemId: e.catalogItemId,
      lotId: null,
      entitlementId: e.id,
      customerOrderId: e.orderId,
      currency: e.currency,
      units: e.quantity,
      gmvAmount: gmv,
      revenueAmount: e.commissionAmount,
      costAmount: 0,
      grossMarginAmount: e.commissionAmount,
      contractualAmount: contractual.times(e.quantity),
      supplierDiscountAmount: e.supplierDiscountAmount.times(e.quantity),
      subsidyAmount: e.membegoSubsidyAmount.times(e.quantity),
      customerPaidAmount: e.customerUnitPrice.times(e.quantity),
      occurredAt: e.issuedAt,
      metadata: {
        customerPaid: e.customerUnitPrice.times(e.quantity).toFixed(2),
        contractualValue: contractual.times(e.quantity).toFixed(2),
        membegoSubsidy: e.membegoSubsidyAmount.times(e.quantity).toFixed(2),
        supplierDiscount: e.supplierDiscountAmount.times(e.quantity).toFixed(2),
        publicPrice: e.orderLine.publicUnitPrice.times(e.quantity).toFixed(2),
        commissionPercentage: e.commissionPercentage?.toFixed(2) ?? null,
        commissionAmount: e.commissionAmount.toFixed(2),
        supplierNet: e.supplierNet.toFixed(2),
        orderNumber: e.order.number,
        offerCode: e.offer.code,
        costModel: 'COMMISSION_NO_INVENTORY',
        note: 'El neto del proveedor no es ingreso ni costo de Membego; se debe al entregar.',
      } satisfies Prisma.InputJsonValue,
    },
    select: { id: true },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_ECONOMIC_EVENT_CREATED', 'SupplyV2EconomicEvent', ev.id, { type: 'COMMISSION_REVENUE', entitlementId: e.id, gmv: gmv.toFixed(2), revenue: e.commissionAmount.toFixed(2), supplierNet: e.supplierNet.toFixed(2) }, e.supplier.companyId)
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
    select: { id: true, quantity: true, sourceType: true, actualUnitCost: true, customerUnitPrice: true, commissionAmount: true, supplierNet: true, currency: true, supplierId: true, catalogItemId: true, lotId: true, orderId: true, supplier: { select: { companyId: true } } },
  })
  if (!e) fallo('DERECHO_NO_ENCONTRADO', 'El derecho no existe.')
  const esComision = e.sourceType === 'COMMISSION'
  const venta = await tx.supplyV2EconomicEvent.findUnique({ where: { type_referenceType_referenceId: { type: esComision ? 'COMMISSION_REVENUE' : 'SALE_REVENUE', referenceType: 'ENTITLEMENT', referenceId: e.id } }, select: { id: true } })
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
      metadata: esComision
        ? {
            sourceType: 'COMMISSION',
            customerPaid: e.customerUnitPrice.times(e.quantity).toFixed(2),
            commissionKept: e.commissionAmount?.toFixed(2) ?? null,
            supplierNetNotOwed: e.supplierNet?.toFixed(2) ?? null,
            revenueEventId: venta?.id ?? null,
            note: 'Venta a comisión vencida sin entregar: no nace obligación con el proveedor (no cumplió); el cobro al cliente se conserva.',
          }
        : {
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
    where: { status: { not: 'CANCELLED' }, economicEvents: { none: { type: { in: ['SALE_REVENUE', 'COMMISSION_REVENUE'] } } } },
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

/**
 * Slice 8 (§38) · VENTA DE UNA MEMBRESÍA.
 *
 * Una membresía no tiene derecho ni lote, así que no pasa por
 * `reconocerVentaEnTx`: sin este evento, el dinero de una membresía no se
 * vería en ninguna parte de la economía. Es ingreso de Membego (o del
 * negocio, según quién la vende) y NO tiene costo de supply: no se compró
 * ninguna unidad.
 *
 * Idempotente por pedido: la clave natural del evento es
 * (tipo, CUSTOMER_ORDER, pedido), así que confirmar dos veces no lo duplica.
 */
export async function reconocerVentaDeMembresiaEnTx(tx: Tx, orderId: string, ctx: ContextoAuditoria): Promise<EventoCreado | null> {
  const orden = await tx.supplyV2CustomerOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      number: true,
      kind: true,
      status: true,
      total: true,
      currency: true,
      paidAt: true,
      membershipPlan: { select: { id: true, code: true, name: true, program: { select: { id: true, code: true, supplierId: true, supplier: { select: { companyId: true } } } } } },
    },
  })
  if (!orden || orden.kind !== 'MEMBERSHIP' || orden.status !== 'PAID' || !orden.membershipPlan) return null
  if (orden.total.lessThanOrEqualTo(0)) return null
  // Todo evento económico cuelga de un proveedor. Un plan solo existe dentro
  // del programa de un negocio (lo exige `crearPlanEnTx`), así que esto no
  // debería pasar; si pasara, es mejor no inventarse un proveedor.
  const supplierId = orden.membershipPlan.program.supplierId
  if (!supplierId) return null

  const previo = await tx.supplyV2EconomicEvent.findUnique({
    where: { type_referenceType_referenceId: { type: 'SALE_REVENUE', referenceType: 'CUSTOMER_ORDER', referenceId: orden.id } },
    select: { id: true },
  })
  if (previo) return { id: previo.id, repetido: true }

  const ev = await tx.supplyV2EconomicEvent.create({
    data: {
      type: 'SALE_REVENUE',
      referenceType: 'CUSTOMER_ORDER',
      referenceId: orden.id,
      supplierId,
      customerOrderId: orden.id,
      currency: orden.currency,
      units: 1,
      gmvAmount: orden.total,
      revenueAmount: orden.total,
      // Una membresía no consume inventario: no hay costo de supply que
      // reconocer aquí. Lo que cueste entregar sus beneficios se reconoce
      // cuando esos beneficios se usan, por su propio camino.
      costAmount: decimal(0),
      grossMarginAmount: orden.total,
      contractualAmount: orden.total,
      customerPaidAmount: orden.total,
      occurredAt: orden.paidAt ?? new Date(),
      metadata: {
        origen: 'MEMBRESIA',
        planCode: orden.membershipPlan.code,
        planNombre: orden.membershipPlan.name,
        programaCode: orden.membershipPlan.program.code,
        orderNumber: orden.number,
        costModel: 'SIN_COSTO_DE_SUPPLY',
      } satisfies Prisma.InputJsonValue,
    },
    select: { id: true },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_ECONOMIC_EVENT_CREATED', 'SupplyV2EconomicEvent', ev.id, { type: 'SALE_REVENUE', origen: 'MEMBRESIA', orderId: orden.id, revenue: orden.total.toFixed(2) }, orden.membershipPlan.program.supplier?.companyId ?? null)
  return { id: ev.id, repetido: false }
}
