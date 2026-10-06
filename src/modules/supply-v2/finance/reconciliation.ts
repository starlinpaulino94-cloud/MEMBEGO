import type { Prisma, SupplyV2ResolutionType } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { decimal, redondear2, type Decimal } from '../core/dinero'
import { fallo } from '../core/errores'
import { siguienteNumero } from '../core/numeracion'
import { CERO, diferenciaConciliacion } from './domain'

/**
 * MEMBEGO SUPPLY · SLICE 4 · CONCILIACIÓN (§43–§46).
 *
 * Membego pone su lado (facturas, pagos, depósitos, obligaciones y
 * aplicaciones del periodo, y redenciones solo si la deuda nace al redimir)
 * y lo compara con lo que dice el proveedor. Sin estado de cuenta del
 * proveedor no hay MATCHED: queda OPEN con «Sin información del proveedor».
 * Nunca inventa datos. Idempotente por proveedor + periodo.
 */

export interface DatosConciliacion {
  supplierId: string
  periodStart: Date
  periodEnd: Date
  /** Lo que el proveedor dice que Membego le debe / le pagó en el periodo (su estado de cuenta). */
  supplierAmount?: number | string | null
  notes?: string | null
}

export interface ConciliacionCreada {
  id: string
  number: string
  status: string
  internalAmount: string
  supplierAmount: string | null
  differenceAmount: string | null
  lineas: number
  repetida: boolean
}

interface LineaInterna {
  type: 'INVOICE' | 'PAYMENT' | 'DEPOSIT' | 'DEPOSIT_APPLICATION' | 'OBLIGATION' | 'REDEMPTION' | 'SETTLEMENT'
  referenceType: string
  referenceId: string
  description: string
  internalAmount: Decimal
  occurredAt: Date
}

/** Las fuentes internas del periodo (§46). Lo que Membego registró, tal cual. */
export async function fuentesInternasEnTx(tx: Tx, supplierId: string, desde: Date, hasta: Date): Promise<{ lineas: LineaInterna[]; internalAmount: Decimal; currency: string }> {
  const rango = { gte: desde, lt: hasta }
  const [facturas, pagos, depositos, obligaciones, aplicaciones, proveedor] = await Promise.all([
    tx.supplyV2SupplierInvoice.findMany({ where: { supplierId, status: { not: 'CANCELLED' }, documentDate: rango }, select: { id: true, number: true, supplierInvoiceNumber: true, total: true, documentDate: true }, orderBy: { documentDate: 'asc' } }),
    tx.supplyV2SupplierPayment.findMany({ where: { supplierId, status: 'CONFIRMED', paidAt: rango }, select: { id: true, number: true, amount: true, paidAt: true, reference: true }, orderBy: { paidAt: 'asc' } }),
    tx.supplyV2SupplierDeposit.findMany({ where: { supplierId, status: { not: 'CANCELLED' }, createdAt: rango }, select: { id: true, number: true, originalAmount: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
    // Slice 5: las obligaciones de comisión se concilian aparte (kind COMMISSION).
    tx.supplyV2SupplierObligation.findMany({ where: { supplierId, status: { not: 'CANCELLED' }, recognizedAt: rango, OR: [{ redemptionId: null }, { redemption: { sourceType: { not: 'COMMISSION' } } }] }, select: { id: true, number: true, grossAmount: true, recognizedAt: true, recognitionBasis: true, sourceType: true }, orderBy: { recognizedAt: 'asc' } }),
    tx.supplyV2PaymentApplication.findMany({ where: { type: { in: ['DEPOSIT_TO_INVOICE', 'DEPOSIT_TO_OBLIGATION'] }, reversedAt: null, createdAt: rango, deposit: { supplierId } }, select: { id: true, amount: true, createdAt: true, deposit: { select: { number: true } }, invoice: { select: { number: true } }, obligation: { select: { number: true } } }, orderBy: { createdAt: 'asc' } }),
    tx.supplyV2Supplier.findUnique({ where: { id: supplierId }, select: { currency: true } }),
  ])
  const lineas: LineaInterna[] = [
    ...facturas.map((f) => ({ type: 'INVOICE' as const, referenceType: 'SupplyV2SupplierInvoice', referenceId: f.id, description: `Factura ${f.number}${f.supplierInvoiceNumber ? ` (${f.supplierInvoiceNumber})` : ''}`, internalAmount: f.total, occurredAt: f.documentDate })),
    ...pagos.map((p) => ({ type: 'PAYMENT' as const, referenceType: 'SupplyV2SupplierPayment', referenceId: p.id, description: `Pago ${p.number}${p.reference ? ` · ${p.reference}` : ''}`, internalAmount: p.amount, occurredAt: p.paidAt })),
    ...depositos.map((d) => ({ type: 'DEPOSIT' as const, referenceType: 'SupplyV2SupplierDeposit', referenceId: d.id, description: `Depósito ${d.number}`, internalAmount: d.originalAmount, occurredAt: d.createdAt })),
    ...obligaciones.map((o) => ({ type: o.sourceType === 'REDEMPTION' ? ('REDEMPTION' as const) : ('OBLIGATION' as const), referenceType: 'SupplyV2SupplierObligation', referenceId: o.id, description: `Obligación ${o.number} (${o.recognitionBasis})`, internalAmount: o.grossAmount, occurredAt: o.recognizedAt })),
    ...aplicaciones.map((a) => ({ type: 'DEPOSIT_APPLICATION' as const, referenceType: 'SupplyV2PaymentApplication', referenceId: a.id, description: `Depósito ${a.deposit?.number ?? ''} aplicado a ${a.invoice ? `la factura ${a.invoice.number}` : `la obligación ${a.obligation?.number ?? ''}`}`, internalAmount: a.amount, occurredAt: a.createdAt })),
  ].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
  // El saldo interno del periodo: lo reconocido como deuda menos lo pagado (pagos + depósito aplicado).
  const deuda = obligaciones.reduce((t, o) => t.plus(o.grossAmount), CERO)
  const pagado = pagos.reduce((t, p) => t.plus(p.amount), CERO).plus(aplicaciones.reduce((t, a) => t.plus(a.amount), CERO))
  return { lineas, internalAmount: redondear2(deuda.minus(pagado)), currency: proveedor?.currency ?? 'DOP' }
}

export async function crearConciliacionEnTx(tx: Tx, d: DatosConciliacion, ctx: ContextoAuditoria): Promise<ConciliacionCreada> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Una conciliación necesita quién la abre.')
  if (!(d.periodStart instanceof Date) || !(d.periodEnd instanceof Date) || Number.isNaN(d.periodStart.getTime()) || Number.isNaN(d.periodEnd.getTime())) fallo('PERIODO_INVALIDO', 'El periodo no es válido.')
  if (d.periodEnd <= d.periodStart) fallo('PERIODO_INVALIDO', 'El periodo tiene que terminar después de empezar.')
  const proveedor = await tx.supplyV2Supplier.findUnique({ where: { id: d.supplierId }, select: { id: true, companyId: true } })
  if (!proveedor) fallo('PROVEEDOR_NO_ENCONTRADO', 'El proveedor no existe.')
  const previa = await tx.supplyV2Reconciliation.findUnique({ where: { supplierId_kind_periodStart_periodEnd: { supplierId: d.supplierId, kind: 'SUPPLY', periodStart: d.periodStart, periodEnd: d.periodEnd } }, select: { id: true, number: true, status: true, internalAmount: true, supplierAmount: true, differenceAmount: true, _count: { select: { lines: true } } } })
  if (previa) {
    return { id: previa.id, number: previa.number, status: previa.status, internalAmount: previa.internalAmount.toFixed(2), supplierAmount: previa.supplierAmount?.toFixed(2) ?? null, differenceAmount: previa.differenceAmount?.toFixed(2) ?? null, lineas: previa._count.lines, repetida: true }
  }
  const { lineas, internalAmount, currency } = await fuentesInternasEnTx(tx, d.supplierId, d.periodStart, d.periodEnd)
  const supplierAmount = d.supplierAmount != null && d.supplierAmount !== '' ? redondear2(decimal(d.supplierAmount)) : null
  const { difference, status } = diferenciaConciliacion(internalAmount, supplierAmount)
  const number = await siguienteNumero(tx, 'MBG-RN', async (prefijo) => {
    const u = await tx.supplyV2Reconciliation.findFirst({ where: { number: { startsWith: prefijo } }, orderBy: { number: 'desc' }, select: { number: true } })
    return u?.number ?? null
  })
  const r = await tx.supplyV2Reconciliation.create({
    data: {
      number,
      supplierId: d.supplierId,
      kind: 'SUPPLY',
      periodStart: d.periodStart,
      periodEnd: d.periodEnd,
      status,
      currency,
      internalAmount,
      supplierAmount,
      differenceAmount: difference,
      notes: d.notes?.trim() || null,
      createdById: ctx.actorId,
      lines: {
        create: lineas.map((l) => ({
          type: l.type,
          referenceType: l.referenceType,
          referenceId: l.referenceId,
          description: l.description,
          internalAmount: l.internalAmount,
          supplierAmount: null,
          difference: null,
          status: 'OPEN',
          occurredAt: l.occurredAt,
        })),
      },
    },
    select: { id: true, number: true },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_RECONCILIATION_CREATED', 'SupplyV2Reconciliation', r.id, {
    number: r.number,
    supplierId: d.supplierId,
    periodStart: d.periodStart.toISOString(),
    periodEnd: d.periodEnd.toISOString(),
    status,
    internalAmount: internalAmount.toFixed(2),
    supplierAmount: supplierAmount?.toFixed(2) ?? null,
    lineas: lineas.length,
  }, proveedor.companyId)
  return { id: r.id, number: r.number, status, internalAmount: internalAmount.toFixed(2), supplierAmount: supplierAmount?.toFixed(2) ?? null, differenceAmount: difference?.toFixed(2) ?? null, lineas: lineas.length, repetida: false }
}

/** El proveedor mandó su estado de cuenta después: se registra y se recalcula la diferencia. Nunca se resuelve sola. */
export async function registrarMontoDelProveedorEnTx(tx: Tx, reconciliationId: string, supplierAmount: number | string, ctx: ContextoAuditoria): Promise<{ status: string; differenceAmount: string }> {
  const r = await tx.supplyV2Reconciliation.findUnique({ where: { id: reconciliationId }, select: { id: true, status: true, internalAmount: true } })
  if (!r) fallo('CONCILIACION_NO_ENCONTRADA', 'La conciliación no existe.')
  if (r.status === 'RESOLVED') fallo('CONCILIACION_RESUELTA', 'Una conciliación resuelta no se modifica.')
  const monto = redondear2(decimal(supplierAmount))
  const { difference, status } = diferenciaConciliacion(r.internalAmount, monto)
  await tx.supplyV2Reconciliation.update({ where: { id: r.id }, data: { supplierAmount: monto, differenceAmount: difference, status } })
  void ctx
  return { status, differenceAmount: difference!.toFixed(2) }
}

export async function resolverConciliacionEnTx(tx: Tx, reconciliationId: string, notas: string, ctx: ContextoAuditoria, resolutionType?: SupplyV2ResolutionType | null): Promise<void> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Resolver necesita quién lo hace.')
  if (!notas?.trim()) fallo('MOTIVO_OBLIGATORIO', 'Resolver una conciliación exige explicar cómo se resolvió.')
  const r = await tx.supplyV2Reconciliation.findUnique({ where: { id: reconciliationId }, select: { id: true, number: true, kind: true, status: true, supplierAmount: true, netClaimed: true, supplier: { select: { companyId: true } } } })
  if (!r) fallo('CONCILIACION_NO_ENCONTRADA', 'La conciliación no existe.')
  if (r.status === 'RESOLVED') return
  if (r.kind === 'COMMISSION') {
    if (r.netClaimed == null && r.supplierAmount == null) fallo('SIN_INFORMACION_DEL_PROVEEDOR', 'No se puede resolver sin lo que el proveedor reclama.')
    if (!resolutionType) fallo('RESOLUCION_OBLIGATORIA', 'Una conciliación de comisión se resuelve diciendo CÓMO: se acepta la cifra interna, la del proveedor, se ajustó o de otra forma.')
  } else if (r.supplierAmount == null) {
    fallo('SIN_INFORMACION_DEL_PROVEEDOR', 'No se puede resolver sin el estado de cuenta del proveedor.')
  }
  const ahora = new Date()
  await tx.supplyV2Reconciliation.update({ where: { id: r.id }, data: { status: 'RESOLVED', resolvedById: ctx.actorId, resolvedAt: ahora, resolutionNotes: notas.trim(), resolutionType: resolutionType ?? null } })
  await tx.supplyV2ReconciliationLine.updateMany({ where: { reconciliationId: r.id, status: { not: 'RESOLVED' } }, data: { status: 'RESOLVED' } })
  await auditarEnTx(tx, ctx, r.kind === 'COMMISSION' ? 'SUPPLY_V2_COMMISSION_RECONCILIATION_RESOLVED' : 'SUPPLY_V2_RECONCILIATION_RESOLVED', 'SupplyV2Reconciliation', r.id, { number: r.number, antes: r.status, notas: notas.trim(), resolutionType: resolutionType ?? null } satisfies Prisma.InputJsonValue, r.supplier.companyId)
}

// ── Slice 5 · CONCILIACIÓN DE COMISIÓN (§48–§52) ─────────────────────────────

export interface DatosConciliacionComision {
  supplierId: string
  periodStart: Date
  periodEnd: Date
  /** Lo que el proveedor dice que vendió / se le retuvo / se le debe en el periodo. Cualquiera puede faltar. */
  grossClaimed?: number | string | null
  commissionClaimed?: number | string | null
  netClaimed?: number | string | null
  notes?: string | null
}

export interface ConciliacionComisionCreada extends ConciliacionCreada {
  grossSalesInternal: string
  commissionInternal: string
  netInternal: string
  paymentsInternal: string
}

/**
 * Lo que Membego registró de ventas a comisión ENTREGADAS en el periodo:
 * bruto, comisión, neto (obligaciones), pagos aplicados a esas obligaciones
 * y liquidaciones. Comparado con lo que el proveedor reclama. Sin cifra del
 * proveedor no hay MATCHED. Idempotente por proveedor + COMMISSION + periodo.
 */
export async function fuentesComisionEnTx(tx: Tx, supplierId: string, desde: Date, hasta: Date) {
  const rango = { gte: desde, lt: hasta }
  const [obligaciones, aplicaciones, liquidaciones, proveedor] = await Promise.all([
    tx.supplyV2SupplierObligation.findMany({ where: { supplierId, status: { not: 'CANCELLED' }, recognizedAt: rango, redemption: { sourceType: 'COMMISSION' } }, select: { id: true, number: true, grossAmount: true, paidAmount: true, recognizedAt: true, redemption: { select: { number: true, customerUnitPriceSnapshot: true, commissionAmountSnapshot: true } } }, orderBy: { recognizedAt: 'asc' } }),
    tx.supplyV2PaymentApplication.findMany({ where: { reversedAt: null, type: { in: ['PAYMENT_TO_OBLIGATION', 'DEPOSIT_TO_OBLIGATION'] }, createdAt: rango, obligation: { supplierId, redemption: { sourceType: 'COMMISSION' } } }, select: { id: true, amount: true, createdAt: true, payment: { select: { number: true } }, deposit: { select: { number: true } }, obligation: { select: { number: true } } }, orderBy: { createdAt: 'asc' } }),
    tx.supplyV2Settlement.findMany({ where: { supplierId, status: { not: 'CANCELLED' }, periodEnd: { gt: desde }, periodStart: { lt: hasta } }, select: { id: true, number: true, supplierNet: true, paidAmount: true, status: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
    tx.supplyV2Supplier.findUnique({ where: { id: supplierId }, select: { currency: true } }),
  ])
  const lineas: LineaInterna[] = [
    ...obligaciones.map((o) => ({ type: 'REDEMPTION' as const, referenceType: 'SupplyV2SupplierObligation', referenceId: o.id, description: `Entrega ${o.redemption?.number ?? ''} · bruto ${o.redemption?.customerUnitPriceSnapshot.toFixed(2) ?? '?'} · comisión ${o.redemption?.commissionAmountSnapshot?.toFixed(2) ?? '?'} · neto ${o.grossAmount.toFixed(2)}`, internalAmount: o.grossAmount, occurredAt: o.recognizedAt })),
    ...aplicaciones.map((a) => ({ type: 'PAYMENT' as const, referenceType: 'SupplyV2PaymentApplication', referenceId: a.id, description: `${a.payment ? `Pago ${a.payment.number}` : `Depósito ${a.deposit?.number ?? ''}`} aplicado a ${a.obligation?.number ?? ''}`, internalAmount: a.amount, occurredAt: a.createdAt })),
    ...liquidaciones.map((l) => ({ type: 'SETTLEMENT' as const, referenceType: 'SupplyV2Settlement', referenceId: l.id, description: `Liquidación ${l.number} (${l.status})`, internalAmount: l.supplierNet, occurredAt: l.createdAt })),
  ].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
  const gross = obligaciones.reduce((t, o) => t.plus(o.redemption?.customerUnitPriceSnapshot ?? CERO), CERO)
  const commission = obligaciones.reduce((t, o) => t.plus(o.redemption?.commissionAmountSnapshot ?? CERO), CERO)
  const net = obligaciones.reduce((t, o) => t.plus(o.grossAmount), CERO)
  const payments = aplicaciones.reduce((t, a) => t.plus(a.amount), CERO)
  return { lineas, grossSalesInternal: redondear2(gross), commissionInternal: redondear2(commission), netInternal: redondear2(net), paymentsInternal: redondear2(payments), currency: proveedor?.currency ?? 'DOP' }
}

export async function crearConciliacionComisionEnTx(tx: Tx, d: DatosConciliacionComision, ctx: ContextoAuditoria): Promise<ConciliacionComisionCreada> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Una conciliación necesita quién la abre.')
  if (!(d.periodStart instanceof Date) || !(d.periodEnd instanceof Date) || Number.isNaN(d.periodStart.getTime()) || Number.isNaN(d.periodEnd.getTime())) fallo('PERIODO_INVALIDO', 'El periodo no es válido.')
  if (d.periodEnd <= d.periodStart) fallo('PERIODO_INVALIDO', 'El periodo tiene que terminar después de empezar.')
  const proveedor = await tx.supplyV2Supplier.findUnique({ where: { id: d.supplierId }, select: { id: true, companyId: true } })
  if (!proveedor) fallo('PROVEEDOR_NO_ENCONTRADO', 'El proveedor no existe.')
  const previa = await tx.supplyV2Reconciliation.findUnique({ where: { supplierId_kind_periodStart_periodEnd: { supplierId: d.supplierId, kind: 'COMMISSION', periodStart: d.periodStart, periodEnd: d.periodEnd } }, select: { id: true, number: true, status: true, internalAmount: true, supplierAmount: true, differenceAmount: true, grossSalesInternal: true, commissionInternal: true, netInternal: true, paymentsInternal: true, _count: { select: { lines: true } } } })
  if (previa) {
    return { id: previa.id, number: previa.number, status: previa.status, internalAmount: previa.internalAmount.toFixed(2), supplierAmount: previa.supplierAmount?.toFixed(2) ?? null, differenceAmount: previa.differenceAmount?.toFixed(2) ?? null, lineas: previa._count.lines, repetida: true, grossSalesInternal: previa.grossSalesInternal?.toFixed(2) ?? '0.00', commissionInternal: previa.commissionInternal?.toFixed(2) ?? '0.00', netInternal: previa.netInternal?.toFixed(2) ?? '0.00', paymentsInternal: previa.paymentsInternal?.toFixed(2) ?? '0.00' }
  }
  const f = await fuentesComisionEnTx(tx, d.supplierId, d.periodStart, d.periodEnd)
  const monto = (v: number | string | null | undefined) => (v != null && v !== '' ? redondear2(decimal(v)) : null)
  const grossClaimed = monto(d.grossClaimed)
  const commissionClaimed = monto(d.commissionClaimed)
  const netClaimed = monto(d.netClaimed)
  // La cifra que se concilia es el NETO: lo que Membego reconoce deberle por entregas del periodo.
  const { difference, status } = diferenciaConciliacion(f.netInternal, netClaimed)
  const number = await siguienteNumero(tx, 'MBG-RN', async (prefijo) => {
    const u = await tx.supplyV2Reconciliation.findFirst({ where: { number: { startsWith: prefijo } }, orderBy: { number: 'desc' }, select: { number: true } })
    return u?.number ?? null
  })
  const r = await tx.supplyV2Reconciliation.create({
    data: {
      number,
      supplierId: d.supplierId,
      kind: 'COMMISSION',
      periodStart: d.periodStart,
      periodEnd: d.periodEnd,
      status,
      currency: f.currency,
      internalAmount: f.netInternal,
      supplierAmount: netClaimed,
      differenceAmount: difference,
      grossSalesInternal: f.grossSalesInternal,
      commissionInternal: f.commissionInternal,
      netInternal: f.netInternal,
      paymentsInternal: f.paymentsInternal,
      grossClaimed,
      commissionClaimed,
      netClaimed,
      notes: d.notes?.trim() || null,
      createdById: ctx.actorId,
      lines: { create: f.lineas.map((l) => ({ type: l.type, referenceType: l.referenceType, referenceId: l.referenceId, description: l.description, internalAmount: l.internalAmount, supplierAmount: null, difference: null, status: 'OPEN', occurredAt: l.occurredAt })) },
    },
    select: { id: true, number: true },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_COMMISSION_RECONCILIATION_CREATED', 'SupplyV2Reconciliation', r.id, {
    number: r.number,
    supplierId: d.supplierId,
    periodStart: d.periodStart.toISOString(),
    periodEnd: d.periodEnd.toISOString(),
    status,
    grossSalesInternal: f.grossSalesInternal.toFixed(2),
    commissionInternal: f.commissionInternal.toFixed(2),
    netInternal: f.netInternal.toFixed(2),
    paymentsInternal: f.paymentsInternal.toFixed(2),
    netClaimed: netClaimed?.toFixed(2) ?? null,
    lineas: f.lineas.length,
  }, proveedor.companyId)
  return { id: r.id, number: r.number, status, internalAmount: f.netInternal.toFixed(2), supplierAmount: netClaimed?.toFixed(2) ?? null, differenceAmount: difference?.toFixed(2) ?? null, lineas: f.lineas.length, repetida: false, grossSalesInternal: f.grossSalesInternal.toFixed(2), commissionInternal: f.commissionInternal.toFixed(2), netInternal: f.netInternal.toFixed(2), paymentsInternal: f.paymentsInternal.toFixed(2) }
}

/** El proveedor manda sus cifras después (comisión): se registran y se recalcula la diferencia sobre el neto. */
export async function registrarCifrasDelProveedorEnTx(tx: Tx, reconciliationId: string, c: { grossClaimed?: number | string | null; commissionClaimed?: number | string | null; netClaimed: number | string }, ctx: ContextoAuditoria): Promise<{ status: string; differenceAmount: string }> {
  const r = await tx.supplyV2Reconciliation.findUnique({ where: { id: reconciliationId }, select: { id: true, status: true, kind: true, internalAmount: true } })
  if (!r) fallo('CONCILIACION_NO_ENCONTRADA', 'La conciliación no existe.')
  if (r.kind !== 'COMMISSION') fallo('CONCILIACION_DE_SUPPLY', 'Esta conciliación no es de comisión.')
  if (r.status === 'RESOLVED') fallo('CONCILIACION_RESUELTA', 'Una conciliación resuelta no se modifica.')
  const net = redondear2(decimal(c.netClaimed))
  const { difference, status } = diferenciaConciliacion(r.internalAmount, net)
  await tx.supplyV2Reconciliation.update({ where: { id: r.id }, data: { supplierAmount: net, netClaimed: net, grossClaimed: c.grossClaimed != null && c.grossClaimed !== '' ? redondear2(decimal(c.grossClaimed)) : undefined, commissionClaimed: c.commissionClaimed != null && c.commissionClaimed !== '' ? redondear2(decimal(c.commissionClaimed)) : undefined, differenceAmount: difference, status } })
  void ctx
  return { status, differenceAmount: difference!.toFixed(2) }
}
