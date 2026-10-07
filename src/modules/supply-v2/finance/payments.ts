import type { SupplyV2SupplierPaymentMethod } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { decimal, redondear2 } from '../core/dinero'
import { fallo } from '../core/errores'
import { exigirTransicion } from '../core/estados'
import { siguienteNumero } from '../core/numeracion'
import { aplicarEnTx, bloquearFila, recalcularPagoEnTx } from './applications'
import { crearDepositoDesdePagoEnTx } from './deposits'
import { esAutoaprobacion, MOTIVO_AUTOAPROBACION } from '../core/segregacion'
import { CERO, FACTURA_PAGABLE, OBLIGACION_VIVA, TRANSICIONES_PAGO_PROVEEDOR } from './domain'
import { obligacionesDeLiquidacionBloqueadasEnTx } from './settlements'
import { LIQUIDACION_PAGABLE, repartirPagoMasAntiguoPrimero } from './settlements-domain'

/**
 * MEMBEGO SUPPLY · SLICE 4 · PAGOS AL PROVEEDOR (§13, §41, §56).
 *
 * Un pago es dinero que SALE. Lo registra una persona (PENDING) y lo
 * confirma OTRA (CONFIRMED) —segregación en el servidor—. Al confirmarse se
 * aplica a lo que se declaró al registrarlo (factura, obligación o depósito)
 * hasta donde quepa; lo que sobre queda visible como «sin aplicar» y se
 * convierte en depósito solo de forma explícita.
 */

export const METODOS_PAGO_PROVEEDOR: readonly SupplyV2SupplierPaymentMethod[] = ['BANK_TRANSFER', 'CASH', 'OTHER']

export interface DatosPago {
  supplierId: string
  method: SupplyV2SupplierPaymentMethod
  amount: number | string
  paidAt?: Date | null
  reference?: string | null
  proofPath?: string | null
  notes?: string | null
  /** A qué se aplica al confirmarse: uno de los cuatro, o ninguno (queda sin aplicar). */
  invoiceId?: string | null
  obligationId?: string | null
  /** Slice 5: una liquidación aprobada; al confirmar se reparte entre sus obligaciones, la más antigua primero. */
  settlementId?: string | null
  asDeposit?: boolean
  idempotencyKey?: string | null
}

export interface PagoCreado {
  id: string
  number: string
  amount: string
  repetido: boolean
}

export async function crearPagoEnTx(tx: Tx, d: DatosPago, ctx: ContextoAuditoria): Promise<PagoCreado> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Un pago necesita quién lo registra.')
  if (!METODOS_PAGO_PROVEEDOR.includes(d.method)) fallo('METODO_INVALIDO', 'Forma de pago no admitida: transferencia, efectivo u otra.')
  let monto
  try {
    monto = decimal(d.amount)
  } catch {
    fallo('MONTO_INVALIDO', 'El monto no es un número.')
  }
  if (!monto.isFinite() || monto.lessThanOrEqualTo(0)) fallo('MONTO_INVALIDO', 'El monto del pago tiene que ser mayor que cero.')
  if (!monto.equals(redondear2(monto))) fallo('MONTO_INVALIDO', 'El monto no puede tener más de dos decimales.')
  const destinos = (d.invoiceId ? 1 : 0) + (d.obligationId ? 1 : 0) + (d.settlementId ? 1 : 0) + (d.asDeposit ? 1 : 0)
  if (destinos > 1) fallo('DESTINO_INVALIDO', 'Un pago se destina a una factura, a una obligación, a una liquidación o a un depósito, no a varios.')

  const proveedor = await tx.supplyV2Supplier.findUnique({ where: { id: d.supplierId }, select: { id: true, status: true, currency: true, companyId: true } })
  if (!proveedor) fallo('PROVEEDOR_NO_ENCONTRADO', 'El proveedor no existe.')
  if (proveedor.status !== 'ACTIVE') fallo('PROVEEDOR_INACTIVO', 'El proveedor no está activo.')

  if (d.idempotencyKey) {
    const previo = await tx.supplyV2SupplierPayment.findUnique({ where: { idempotencyKey: d.idempotencyKey }, select: { id: true, number: true, amount: true } })
    if (previo) return { id: previo.id, number: previo.number, amount: previo.amount.toFixed(2), repetido: true }
  }
  if (d.invoiceId) {
    const f = await tx.supplyV2SupplierInvoice.findUnique({ where: { id: d.invoiceId }, select: { supplierId: true, status: true, number: true } })
    if (!f || f.supplierId !== proveedor.id) fallo('FACTURA_AJENA', 'La factura no es de este proveedor.')
    if (f.status === 'CANCELLED') fallo('FACTURA_CANCELADA', `La factura ${f.number} está cancelada.`)
  }
  if (d.obligationId) {
    const o = await tx.supplyV2SupplierObligation.findUnique({ where: { id: d.obligationId }, select: { supplierId: true, status: true, number: true } })
    if (!o || o.supplierId !== proveedor.id) fallo('OBLIGACION_AJENA', 'La obligación no es de este proveedor.')
    if (!OBLIGACION_VIVA.includes(o.status)) fallo('OBLIGACION_NO_VIVA', `La obligación ${o.number} está ${o.status}.`)
  }
  if (d.settlementId) {
    const s = await tx.supplyV2Settlement.findUnique({ where: { id: d.settlementId }, select: { supplierId: true, status: true, number: true, supplierNet: true, paidAmount: true, currency: true } })
    if (!s || s.supplierId !== proveedor.id) fallo('LIQUIDACION_AJENA', 'La liquidación no es de este proveedor.')
    if (!LIQUIDACION_PAGABLE.includes(s.status)) fallo('LIQUIDACION_NO_PAGABLE', `La liquidación ${s.number} está ${s.status}: solo se paga una liquidación aprobada con saldo.`)
    if (s.currency !== proveedor.currency) fallo('MONEDA_DISTINTA', 'La liquidación está en otra moneda.')
    const saldo = s.supplierNet.minus(s.paidAmount)
    if (monto.greaterThan(saldo)) fallo('MONTO_INVALIDO', `La liquidación ${s.number} solo tiene ${saldo.toFixed(2)} pendiente y se intentan pagar ${monto.toFixed(2)}. No se permite sobrepagar.`)
  }

  const paidAt = d.paidAt ?? new Date()
  const number = await siguienteNumero(tx, 'MBG-SP', async (prefijo) => {
    const u = await tx.supplyV2SupplierPayment.findFirst({ where: { number: { startsWith: prefijo } }, orderBy: { number: 'desc' }, select: { number: true } })
    return u?.number ?? null
  }, paidAt)
  const p = await tx.supplyV2SupplierPayment.create({
    data: {
      number,
      supplierId: proveedor.id,
      method: d.method,
      currency: proveedor.currency,
      amount: monto,
      appliedAmount: CERO,
      reference: d.reference?.trim() || null,
      paidAt,
      proofPath: d.proofPath?.trim() || null,
      notes: d.notes?.trim() || null,
      status: 'PENDING',
      intendedInvoiceId: d.invoiceId ?? null,
      intendedObligationId: d.obligationId ?? null,
      intendedSettlementId: d.settlementId ?? null,
      intendedDeposit: Boolean(d.asDeposit),
      createdById: ctx.actorId,
      idempotencyKey: d.idempotencyKey ?? null,
    },
    select: { id: true, number: true, amount: true },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_PAYMENT_CREATED', 'SupplyV2SupplierPayment', p.id, {
    number: p.number,
    supplierId: proveedor.id,
    method: d.method,
    amount: p.amount.toFixed(2),
    reference: d.reference?.trim() || null,
    intendedInvoiceId: d.invoiceId ?? null,
    intendedObligationId: d.obligationId ?? null,
    intendedSettlementId: d.settlementId ?? null,
    intendedDeposit: Boolean(d.asDeposit),
  }, proveedor.companyId)
  return { id: p.id, number: p.number, amount: p.amount.toFixed(2), repetido: false }
}

export interface PagoConfirmadoProveedor {
  id: string
  number: string
  aplicado: string
  sinAplicar: string
  depositId: string | null
  repetido: boolean
}

/**
 * CONFIRMACIÓN (§41): otra persona autorizada vio salir el dinero. En la
 * misma transacción se aplica a lo declarado hasta lo que quepa.
 */
export async function confirmarPagoProveedorEnTx(tx: Tx, paymentId: string, ctx: ContextoAuditoria): Promise<PagoConfirmadoProveedor> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Confirmar un pago necesita quién lo confirma.')
  await bloquearFila(tx, 'supply_v2_supplier_payments', paymentId)
  const p = await tx.supplyV2SupplierPayment.findUnique({
    where: { id: paymentId },
    select: { id: true, number: true, status: true, amount: true, appliedAmount: true, createdById: true, intendedInvoiceId: true, intendedObligationId: true, intendedSettlementId: true, intendedDeposit: true, supplier: { select: { companyId: true } }, fundedDeposit: { select: { id: true } } },
  })
  if (!p) fallo('PAGO_NO_ENCONTRADO', 'El pago no existe.')
  if (p.status === 'CONFIRMED') {
    return { id: p.id, number: p.number, aplicado: p.appliedAmount.toFixed(2), sinAplicar: p.amount.minus(p.appliedAmount).toFixed(2), depositId: p.fundedDeposit?.id ?? null, repetido: true }
  }
  exigirTransicion(TRANSICIONES_PAGO_PROVEEDOR, p.status, 'CONFIRMED', 'Pago')
  const autoaprobada = esAutoaprobacion(p.createdById, ctx.actorId)
  await tx.supplyV2SupplierPayment.update({ where: { id: p.id }, data: { status: 'CONFIRMED', confirmedById: ctx.actorId, confirmedAt: new Date() } })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_PAYMENT_CONFIRMED', 'SupplyV2SupplierPayment', p.id, {
    number: p.number,
    amount: p.amount.toFixed(2),
    createdById: p.createdById,
    autoaprobada: autoaprobada,
    ...(autoaprobada ? { motivo: MOTIVO_AUTOAPROBACION } : {}),
  }, p.supplier.companyId)

  let depositId: string | null = null
  if (p.intendedInvoiceId) {
    const f = await tx.supplyV2SupplierInvoice.findUnique({ where: { id: p.intendedInvoiceId }, select: { id: true, amountDue: true, status: true } })
    if (f && FACTURA_PAGABLE.includes(f.status as never) && f.amountDue.greaterThan(0)) {
      const monto = p.amount.lessThan(f.amountDue) ? p.amount : f.amountDue
      await aplicarEnTx(tx, { paymentId: p.id, invoiceId: f.id, amount: monto, idempotencyKey: `pago:${p.id}:factura:${f.id}` }, ctx)
    }
  } else if (p.intendedObligationId) {
    const o = await tx.supplyV2SupplierObligation.findUnique({ where: { id: p.intendedObligationId }, select: { id: true, outstandingAmount: true, status: true } })
    if (o && OBLIGACION_VIVA.includes(o.status) && o.outstandingAmount.greaterThan(0)) {
      const monto = p.amount.lessThan(o.outstandingAmount) ? p.amount : o.outstandingAmount
      await aplicarEnTx(tx, { paymentId: p.id, obligationId: o.id, amount: monto, idempotencyKey: `pago:${p.id}:obligacion:${o.id}` }, ctx)
    }
  } else if (p.intendedSettlementId) {
    // Slice 5 (§41–§43): liquidación → sus obligaciones, la más antigua primero. Cada aplicación
    // recalcula la obligación y, con ella, la liquidación. Nunca sobrepaga: lo que no quepa queda sin aplicar.
    await tx.$queryRaw`SELECT "id" FROM "supply_v2_settlements" WHERE "id" = ${p.intendedSettlementId} FOR UPDATE`
    const s = await tx.supplyV2Settlement.findUnique({ where: { id: p.intendedSettlementId }, select: { id: true, number: true, status: true, supplier: { select: { companyId: true } } } })
    if (s && LIQUIDACION_PAGABLE.includes(s.status)) {
      const obligaciones = await obligacionesDeLiquidacionBloqueadasEnTx(tx, s.id)
      const { aplicaciones, sinAplicar } = repartirPagoMasAntiguoPrimero(p.amount, obligaciones)
      for (const a of aplicaciones) {
        await aplicarEnTx(tx, { paymentId: p.id, obligationId: a.obligacion.id, amount: a.amount, idempotencyKey: `pago:${p.id}:liquidacion:${s.id}:${a.obligacion.id}` }, ctx)
      }
      await auditarEnTx(tx, ctx, 'SUPPLY_V2_SETTLEMENT_PAYMENT_APPLIED', 'SupplyV2Settlement', s.id, {
        number: s.number,
        paymentId: p.id,
        paymentNumber: p.number,
        amount: p.amount.toFixed(2),
        aplicado: aplicaciones.reduce((t, a) => t.plus(a.amount), CERO).toFixed(2),
        sinAplicar: sinAplicar.toFixed(2),
        obligaciones: aplicaciones.map((a) => ({ id: a.obligacion.id, number: a.obligacion.number, amount: a.amount.toFixed(2) })),
      }, s.supplier.companyId)
    }
  } else if (p.intendedDeposit) {
    const dep = await crearDepositoDesdePagoEnTx(tx, { paymentId: p.id, amount: p.amount, idempotencyKey: `pago:${p.id}:deposito` }, ctx)
    depositId = dep.id
  }
  const { applied, unapplied } = await recalcularPagoEnTx(tx, p.id)
  return { id: p.id, number: p.number, aplicado: applied.toFixed(2), sinAplicar: unapplied.toFixed(2), depositId, repetido: false }
}

/** Solo un pago sin aplicaciones vivas se cancela (con motivo). */
export async function cancelarPagoProveedorEnTx(tx: Tx, paymentId: string, motivo: string, ctx: ContextoAuditoria): Promise<void> {
  if (!motivo?.trim()) fallo('MOTIVO_OBLIGATORIO', 'Cancelar un pago exige un motivo.')
  await bloquearFila(tx, 'supply_v2_supplier_payments', paymentId)
  const p = await tx.supplyV2SupplierPayment.findUnique({ where: { id: paymentId }, select: { id: true, number: true, status: true, supplier: { select: { companyId: true } } } })
  if (!p) fallo('PAGO_NO_ENCONTRADO', 'El pago no existe.')
  if (p.status === 'CANCELLED') return
  const vivas = await tx.supplyV2PaymentApplication.count({ where: { paymentId: p.id, reversedAt: null, type: { not: 'REVERSAL' } } })
  if (vivas > 0) fallo('PAGO_CON_APLICACIONES', `El pago ${p.number} tiene ${vivas} aplicación(es) viva(s): reversa cada una antes de cancelarlo.`)
  exigirTransicion(TRANSICIONES_PAGO_PROVEEDOR, p.status, 'CANCELLED', 'Pago')
  await tx.supplyV2SupplierPayment.update({ where: { id: p.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledReason: motivo.trim() } })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_PAYMENT_CANCELLED', 'SupplyV2SupplierPayment', p.id, { number: p.number, antes: p.status, motivo: motivo.trim() }, p.supplier.companyId)
}
