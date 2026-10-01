import type { Prisma, SupplyV2SettlementFrequency } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { personasAutorizadasEnTx } from '../core/autorizadas'
import { fallo } from '../core/errores'
import { exigirTransicion } from '../core/estados'
import { siguienteNumero } from '../core/numeracion'
import { MOTIVO_AUTOAPROBACION, revisarSegregacion } from '../core/segregacion'
import { recalcularLiquidacionEnTx } from './applications'
import { CERO } from './domain'
import {
  elegibles,
  LIQUIDACION_CANCELABLE,
  LIQUIDACION_VIVA,
  periodoDeFrecuencia,
  totalesDeLiquidacion,
  TRANSICIONES_LIQUIDACION,
  validarPeriodo,
} from './settlements-domain'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 5 · LIQUIDACIONES (§35–§47).
 *
 * Una liquidación es la cuenta que Membego le rinde al proveedor por un
 * periodo de ventas a comisión ENTREGADAS: bruto vendido, comisión retenida
 * y neto a pagar. Agrupa obligaciones de comisión OPEN / PARTIALLY_PAID que
 * no estén en otra liquidación viva; `supplier_obligations.settlementId` es
 * la barrera (bajo candado FOR UPDATE) contra dos liquidaciones con la
 * misma obligación. Las líneas son FOTO. Se paga con el motor del Slice 4
 * (`crearPagoEnTx` con `settlementId` → al confirmar se reparte la más
 * antigua primero) y el estado se deriva de sus obligaciones. Las ventas de
 * supply prepagado NUNCA entran aquí.
 */

export interface DatosLiquidacion {
  supplierId: string
  frequency: SupplyV2SettlementFrequency
  /** Obligatorios en MANUAL; en el resto se calculan desde `referencia`. */
  periodStart?: Date | null
  periodEnd?: Date | null
  referencia?: Date | null
  notes?: string | null
  idempotencyKey?: string | null
}

export interface LiquidacionCreada {
  id: string
  number: string
  status: string
  lineas: number
  grossSales: string
  commissionAmount: string
  supplierNet: string
  repetida: boolean
}

export async function numeroLiquidacion(tx: Tx, fecha = new Date()): Promise<string> {
  return siguienteNumero(tx, 'MBG-ST', async (prefijo) => {
    const u = await tx.supplyV2Settlement.findFirst({ where: { number: { startsWith: prefijo } }, orderBy: { number: 'desc' }, select: { number: true } })
    return u?.number ?? null
  }, fecha)
}

/** Lo que está pendiente de liquidar HOY de un proveedor (para la pantalla y para generar). */
export async function obligacionesLiquidablesEnTx(tx: Tx, supplierId: string, periodStart: Date, periodEnd: Date, currency: string, bloquear = false) {
  if (bloquear) {
    // Candado sobre las obligaciones de comisión vivas del proveedor: dos generaciones simultáneas se serializan aquí.
    await tx.$queryRaw`SELECT o."id" FROM "supply_v2_supplier_obligations" o WHERE o."supplierId" = ${supplierId} AND o."status" IN ('OPEN','PARTIALLY_PAID') AND o."settlementId" IS NULL ORDER BY o."recognizedAt" ASC, o."id" ASC FOR UPDATE`
  }
  const filas = await tx.supplyV2SupplierObligation.findMany({
    where: { supplierId, sourceType: 'REDEMPTION', status: { in: ['OPEN', 'PARTIALLY_PAID'] }, settlementId: null, redemption: { sourceType: 'COMMISSION' } },
    orderBy: [{ recognizedAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      number: true,
      status: true,
      settlementId: true,
      currency: true,
      grossAmount: true,
      outstandingAmount: true,
      recognizedAt: true,
      redemption: { select: { id: true, number: true, redeemedAt: true, customerUnitPriceSnapshot: true, commissionAmountSnapshot: true, supplierNetSnapshot: true, commissionPercentageSnapshot: true, contractualValueSnapshot: true, supplierDiscountSnapshot: true, membegoSubsidySnapshot: true, catalogItem: { select: { name: true } }, customer: { select: { name: true, email: true } } } },
    },
  })
  return elegibles(filas, periodStart, periodEnd, currency)
}

export async function generarLiquidacionEnTx(tx: Tx, d: DatosLiquidacion, ctx: ContextoAuditoria): Promise<LiquidacionCreada> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Generar una liquidación necesita quién la genera.')
  const proveedor = await tx.supplyV2Supplier.findUnique({ where: { id: d.supplierId }, select: { id: true, status: true, currency: true, companyId: true, commercialName: true } })
  if (!proveedor) fallo('PROVEEDOR_NO_ENCONTRADO', 'El proveedor no existe.')
  if (d.idempotencyKey) {
    const previa = await tx.supplyV2Settlement.findUnique({ where: { idempotencyKey: d.idempotencyKey }, select: { id: true, number: true, status: true, grossSales: true, commissionAmount: true, supplierNet: true, _count: { select: { lines: true } } } })
    if (previa) return { id: previa.id, number: previa.number, status: previa.status, lineas: previa._count.lines, grossSales: previa.grossSales.toFixed(2), commissionAmount: previa.commissionAmount.toFixed(2), supplierNet: previa.supplierNet.toFixed(2), repetida: true }
  }
  let periodStart: Date
  let periodEnd: Date
  if (d.frequency === 'MANUAL') {
    if (!d.periodStart || !d.periodEnd) fallo('PERIODO_INVALIDO', 'Una liquidación manual necesita el periodo.')
    periodStart = d.periodStart
    periodEnd = d.periodEnd
  } else {
    const p = periodoDeFrecuencia(d.frequency, d.referencia ?? new Date())
    if (!p) fallo('PERIODO_INVALIDO', 'No se pudo calcular el periodo.')
    periodStart = d.periodStart ?? p.periodStart
    periodEnd = d.periodEnd ?? p.periodEnd
  }
  const errorPeriodo = validarPeriodo(periodStart, periodEnd)
  if (errorPeriodo) fallo('PERIODO_INVALIDO', errorPeriodo)

  const obligaciones = await obligacionesLiquidablesEnTx(tx, proveedor.id, periodStart, periodEnd, proveedor.currency, true)
  if (obligaciones.length === 0) fallo('SIN_OBLIGACIONES', `No hay entregas a comisión pendientes de liquidar de ${proveedor.commercialName} en ese periodo.`)

  const lineas = obligaciones.map((o) => {
    const r = o.redemption!
    // Slice 6 (§26): GMV = contractual + descuento del proveedor; el cliente pagó contractual − subsidio.
    const contractual = r.contractualValueSnapshot ?? r.customerUnitPriceSnapshot
    const discount = r.supplierDiscountSnapshot ?? CERO
    const subsidy = r.membegoSubsidySnapshot ?? CERO
    const commission = r.commissionAmountSnapshot ?? CERO
    return {
      obligationId: o.id,
      redemptionId: r.id,
      descriptionSnapshot: `Entrega ${r.number} · ${r.catalogItem.name} · ${r.customer.name?.trim() || r.customer.email} · ${r.redeemedAt.toISOString().slice(0, 10)} · comisión ${r.commissionPercentageSnapshot?.toFixed(2) ?? '?'} %${subsidy.greaterThan(0) ? ` · bono Membego ${subsidy.toFixed(2)}` : ''}${discount.greaterThan(0) ? ` · descuento proveedor ${discount.toFixed(2)}` : ''}`,
      grossAmount: contractual.plus(discount),
      commissionAmount: commission,
      // El neto liquidable es lo que la obligación todavía debe (una obligación parcialmente pagada entra por su saldo).
      supplierNet: o.outstandingAmount,
      contractualAmount: contractual,
      supplierDiscountAmount: discount,
      membegoSubsidyAmount: subsidy,
      customerPaidAmount: r.customerUnitPriceSnapshot,
    }
  })
  const totales = totalesDeLiquidacion(lineas)
  const suma = (k: 'contractualAmount' | 'supplierDiscountAmount' | 'membegoSubsidyAmount' | 'customerPaidAmount') => lineas.reduce((t, l) => t.plus(l[k]), CERO)
  const number = await numeroLiquidacion(tx, periodEnd)
  const s = await tx.supplyV2Settlement.create({
    data: {
      number,
      supplierId: proveedor.id,
      frequency: d.frequency,
      periodStart,
      periodEnd,
      currency: proveedor.currency,
      grossSales: totales.grossSales,
      commissionAmount: totales.commissionAmount,
      supplierNet: totales.supplierNet,
      paidAmount: CERO,
      contractualValue: suma('contractualAmount'),
      supplierDiscountTotal: suma('supplierDiscountAmount'),
      membegoSubsidyTotal: suma('membegoSubsidyAmount'),
      customerPaidTotal: suma('customerPaidAmount'),
      status: 'PENDING_APPROVAL',
      notes: d.notes?.trim() || null,
      createdById: ctx.actorId,
      idempotencyKey: d.idempotencyKey ?? null,
      lines: { create: lineas },
    },
    select: { id: true, number: true, status: true },
  })
  // La barrera: ninguna otra liquidación viva puede tomar estas obligaciones.
  const marcadas = await tx.supplyV2SupplierObligation.updateMany({ where: { id: { in: obligaciones.map((o) => o.id) }, settlementId: null }, data: { settlementId: s.id } })
  if (marcadas.count !== obligaciones.length) fallo('CONCURRENCIA', 'Otra liquidación tomó parte de estas obligaciones: vuelve a intentarlo.')
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_SETTLEMENT_CREATED', 'SupplyV2Settlement', s.id, {
    number: s.number,
    supplierId: proveedor.id,
    frequency: d.frequency,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    lineas: lineas.length,
    grossSales: totales.grossSales.toFixed(2),
    commissionAmount: totales.commissionAmount.toFixed(2),
    supplierNet: totales.supplierNet.toFixed(2),
    contractualValue: suma('contractualAmount').toFixed(2),
    membegoSubsidy: suma('membegoSubsidyAmount').toFixed(2),
    supplierDiscount: suma('supplierDiscountAmount').toFixed(2),
    customerPaid: suma('customerPaidAmount').toFixed(2),
  }, proveedor.companyId)
  return { id: s.id, number: s.number, status: s.status, lineas: lineas.length, grossSales: totales.grossSales.toFixed(2), commissionAmount: totales.commissionAmount.toFixed(2), supplierNet: totales.supplierNet.toFixed(2), repetida: false }
}

async function liquidacionBloqueada(tx: Tx, settlementId: string) {
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_settlements" WHERE "id" = ${settlementId} FOR UPDATE`
  const s = await tx.supplyV2Settlement.findUnique({
    where: { id: settlementId },
    select: { id: true, number: true, status: true, createdById: true, supplierNet: true, paidAmount: true, supplierId: true, supplier: { select: { companyId: true } } },
  })
  if (!s) fallo('LIQUIDACION_NO_ENCONTRADA', 'La liquidación no existe.')
  return s
}

/** APROBAR (§40): otra persona autorizada revisa la cuenta. Idempotente. */
export async function aprobarLiquidacionEnTx(tx: Tx, settlementId: string, ctx: ContextoAuditoria): Promise<{ id: string; number: string; status: string; repetida: boolean }> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Aprobar una liquidación necesita quién la aprueba.')
  const s = await liquidacionBloqueada(tx, settlementId)
  if (['APPROVED', 'PARTIALLY_PAID', 'PAID'].includes(s.status)) return { id: s.id, number: s.number, status: s.status, repetida: true }
  exigirTransicion(TRANSICIONES_LIQUIDACION, s.status, 'APPROVED', 'Liquidación')
  const personasAutorizadas = await personasAutorizadasEnTx(tx)
  const segregacion = revisarSegregacion(s.createdById, ctx.actorId, personasAutorizadas, 'liquidacion')
  if (!segregacion.permitido) fallo('AUTOAPROBACION', segregacion.motivo)
  await tx.supplyV2Settlement.update({ where: { id: s.id }, data: { status: 'APPROVED', approvedById: ctx.actorId, approvedAt: new Date() } })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_SETTLEMENT_APPROVED', 'SupplyV2Settlement', s.id, {
    number: s.number,
    supplierNet: s.supplierNet.toFixed(2),
    createdById: s.createdById,
    autoaprobada: segregacion.autoaprobada,
    personasAutorizadas,
    ...(segregacion.autoaprobada ? { motivo: MOTIVO_AUTOAPROBACION } : {}),
  }, s.supplier.companyId)
  // Por si hubo pagos sueltos a sus obligaciones antes de aprobar: el estado deriva de lo pagado.
  const r = await recalcularLiquidacionEnTx(tx, s.id, ctx)
  return { id: s.id, number: s.number, status: r.status, repetida: false }
}

/** CANCELAR (§44): solo sin dinero aplicado; las obligaciones vuelven a quedar liquidables. */
export async function cancelarLiquidacionEnTx(tx: Tx, settlementId: string, motivo: string, ctx: ContextoAuditoria): Promise<void> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Cancelar una liquidación necesita quién lo hace.')
  if (!motivo?.trim()) fallo('MOTIVO_OBLIGATORIO', 'Cancelar una liquidación exige un motivo.')
  const s = await liquidacionBloqueada(tx, settlementId)
  if (s.status === 'CANCELLED') return
  if (!LIQUIDACION_CANCELABLE.includes(s.status) || s.paidAmount.greaterThan(0)) {
    fallo('LIQUIDACION_CON_PAGOS', `La liquidación ${s.number} ya tiene dinero aplicado: reversa sus aplicaciones antes de cancelarla.`)
  }
  const pendientes = await tx.supplyV2SupplierPayment.count({ where: { intendedSettlementId: s.id, status: 'PENDING' } })
  if (pendientes > 0) fallo('LIQUIDACION_CON_PAGOS', `La liquidación ${s.number} tiene ${pendientes} pago(s) pendiente(s) de confirmar: cancélalos primero.`)
  exigirTransicion(TRANSICIONES_LIQUIDACION, s.status, 'CANCELLED', 'Liquidación')
  await tx.supplyV2SupplierObligation.updateMany({ where: { settlementId: s.id }, data: { settlementId: null } })
  await tx.supplyV2Settlement.update({ where: { id: s.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledReason: motivo.trim() } })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_SETTLEMENT_CANCELLED', 'SupplyV2Settlement', s.id, { number: s.number, antes: s.status, motivo: motivo.trim() }, s.supplier.companyId)
}

/** Las obligaciones de una liquidación viva, en orden de pago (la más antigua primero), bloqueadas. */
export async function obligacionesDeLiquidacionBloqueadasEnTx(tx: Tx, settlementId: string) {
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_supplier_obligations" WHERE "settlementId" = ${settlementId} ORDER BY "recognizedAt" ASC, "id" ASC FOR UPDATE`
  return tx.supplyV2SupplierObligation.findMany({
    where: { settlementId, status: { in: ['OPEN', 'PARTIALLY_PAID'] } },
    orderBy: [{ recognizedAt: 'asc' }, { id: 'asc' }],
    select: { id: true, number: true, outstandingAmount: true, recognizedAt: true },
  })
}

export const LIQUIDACION_ESTADOS_VIVOS = LIQUIDACION_VIVA

export type LineaLiquidacionCreate = Prisma.SupplyV2SettlementLineCreateWithoutSettlementInput
