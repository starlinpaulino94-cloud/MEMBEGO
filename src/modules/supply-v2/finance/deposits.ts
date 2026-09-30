import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { decimal, redondear2, type Decimal } from '../core/dinero'
import { fallo } from '../core/errores'
import { siguienteNumero } from '../core/numeracion'
import { bloquearFila, recalcularPagoEnTx } from './applications'
import { CERO } from './domain'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 4 · DEPÓSITOS DEL PROVEEDOR (§11–§12, §16, §56).
 *
 * Un depósito es dinero que YA salió y el proveedor guarda a cuenta de
 * compras futuras. Nace de un pago CONFIRMADO (o de su excedente), nunca de
 * la nada. Su saldo cambia solo por aplicaciones (`applications.ts`) y cada
 * cambio deja un movimiento: la suma de movimientos reconstruye el saldo.
 * Un pago directo a una factura NUNCA toca el depósito (§16): son orígenes
 * distintos y el código no los mezcla.
 */

export interface DatosDepositoDesdePago {
  paymentId: string
  /** Por defecto, todo lo que el pago tenga sin aplicar. */
  amount?: number | string | Decimal | null
  reference?: string | null
  notes?: string | null
  idempotencyKey?: string | null
}

export interface DepositoCreado {
  id: string
  number: string
  originalAmount: string
  repetido: boolean
}

export async function crearDepositoDesdePagoEnTx(tx: Tx, d: DatosDepositoDesdePago, ctx: ContextoAuditoria): Promise<DepositoCreado> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Un depósito necesita quién lo registra.')
  await bloquearFila(tx, 'supply_v2_supplier_payments', d.paymentId)
  if (d.idempotencyKey) {
    const previo = await tx.supplyV2SupplierDeposit.findUnique({ where: { idempotencyKey: d.idempotencyKey }, select: { id: true, number: true, originalAmount: true } })
    if (previo) return { id: previo.id, number: previo.number, originalAmount: previo.originalAmount.toFixed(2), repetido: true }
  }
  const p = await tx.supplyV2SupplierPayment.findUnique({
    where: { id: d.paymentId },
    select: { id: true, number: true, status: true, supplierId: true, currency: true, amount: true, appliedAmount: true, reference: true, fundedDeposit: { select: { id: true, number: true, originalAmount: true } }, supplier: { select: { companyId: true } } },
  })
  if (!p) fallo('PAGO_NO_ENCONTRADO', 'El pago no existe.')
  if (p.status !== 'CONFIRMED') fallo('PAGO_NO_CONFIRMADO', `El pago ${p.number} no está confirmado: un depósito nace de dinero confirmado.`)
  if (p.fundedDeposit) return { id: p.fundedDeposit.id, number: p.fundedDeposit.number, originalAmount: p.fundedDeposit.originalAmount.toFixed(2), repetido: true }
  const sinAplicar = p.amount.minus(p.appliedAmount)
  const monto = d.amount != null && d.amount !== '' ? redondear2(decimal(d.amount)) : sinAplicar
  if (!monto.isFinite() || monto.lessThanOrEqualTo(0)) fallo('MONTO_INVALIDO', 'El depósito tiene que ser mayor que cero.')
  if (monto.greaterThan(sinAplicar)) fallo('EXCEDENTE_INSUFICIENTE', `El pago ${p.number} solo tiene ${sinAplicar.toFixed(2)} sin aplicar.`)

  const number = await siguienteNumero(tx, 'MBG-SD', async (prefijo) => {
    const u = await tx.supplyV2SupplierDeposit.findFirst({ where: { number: { startsWith: prefijo } }, orderBy: { number: 'desc' }, select: { number: true } })
    return u?.number ?? null
  })
  const dep = await tx.supplyV2SupplierDeposit.create({
    data: {
      number,
      supplierId: p.supplierId,
      currency: p.currency,
      originalAmount: monto,
      availableAmount: monto,
      appliedAmount: CERO,
      refundedAmount: CERO,
      status: 'ACTIVE',
      paymentId: p.id,
      reference: d.reference?.trim() || p.reference,
      notes: d.notes?.trim() || null,
      createdById: ctx.actorId,
      idempotencyKey: d.idempotencyKey ?? null,
    },
    select: { id: true, number: true },
  })
  const app = await tx.supplyV2PaymentApplication.create({
    data: { type: 'PAYMENT_TO_DEPOSIT', paymentId: p.id, depositId: dep.id, amount: monto, currency: p.currency, createdById: ctx.actorId },
    select: { id: true },
  })
  await tx.supplyV2SupplierDepositMovement.create({
    data: { depositId: dep.id, type: 'DEPOSIT_CREATED', amount: monto, balanceAfter: monto, applicationId: app.id, reason: `Financiado por el pago ${p.number}.`, actorId: ctx.actorId },
  })
  await recalcularPagoEnTx(tx, p.id)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_DEPOSIT_CREATED', 'SupplyV2SupplierDeposit', dep.id, {
    number: dep.number,
    supplierId: p.supplierId,
    paymentNumber: p.number,
    originalAmount: monto.toFixed(2),
  }, p.supplier.companyId)
  return { id: dep.id, number: dep.number, originalAmount: monto.toFixed(2), repetido: false }
}
