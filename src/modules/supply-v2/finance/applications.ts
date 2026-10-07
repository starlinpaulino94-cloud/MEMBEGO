import type { SupplyV2ApplicationType } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { decimal, type Decimal } from '../core/dinero'
import { fallo } from '../core/errores'
import { puedeTransicionar, TRANSICIONES_ORDEN } from '../core/estados'
import { estadoLiquidacionSegunPago } from './settlements-domain'
import {
  CERO,
  estadoDepositoSegunSaldo,
  estadoFacturaSegunSaldo,
  estadoObligacionSegunSaldo,
  FACTURA_PAGABLE,
  OBLIGACION_VIVA,
  politicaDeVersion,
  validarAplicacion,
} from './domain'

/**
 * MEMBEGO SUPPLY · SLICE 4 · EL QUE MUEVE EL DINERO.
 *
 * Una APLICACIÓN relaciona un origen de dinero (pago confirmado o depósito)
 * con una deuda (obligación; y la factura a la que pertenece, si tiene). Las
 * aplicaciones son la VERDAD: los saldos de factura, obligación, depósito y
 * pago son caché que `recalcular*EnTx` reconstruye sumando aplicaciones vivas.
 * Por eso reversar es crear otra fila y recalcular, nunca «restar a mano».
 *
 * Orden FIJO de candados para que dos aplicaciones simultáneas se serialicen
 * y nunca se bloqueen mutuamente (§54–§55):
 *
 *   pago → depósito → factura → obligaciones (por fecha de reconocimiento)
 *
 * Y la base tiene la última palabra: CHECK de pendiente ≥ 0, disponible ≥ 0 y
 * aplicado ≤ monto del pago (migración `20261013_supply_v2_slice4`).
 */

const VIVA = { reversedAt: null, type: { not: 'REVERSAL' as const } }

export async function bloquearFila(tx: Tx, tabla: 'supply_v2_supplier_payments' | 'supply_v2_supplier_deposits' | 'supply_v2_supplier_invoices' | 'supply_v2_supplier_obligations' | 'supply_v2_payment_applications', id: string): Promise<void> {
  // El nombre de la tabla viene de un literal del propio código, nunca del usuario.
  await tx.$executeRawUnsafe(`SELECT "id" FROM "${tabla}" WHERE "id" = $1 FOR UPDATE`, id)
}

async function sumaViva(tx: Tx, where: Record<string, unknown>): Promise<Decimal> {
  const r = await tx.supplyV2PaymentApplication.aggregate({ where: { ...VIVA, ...where }, _sum: { amount: true } })
  return r._sum.amount ?? CERO
}

// ── Recalcular la caché desde las aplicaciones vivas ─────────────────────────

export async function recalcularObligacionEnTx(tx: Tx, obligationId: string, ctx: ContextoAuditoria): Promise<{ status: string; outstanding: Decimal }> {
  const o = await tx.supplyV2SupplierObligation.findUniqueOrThrow({
    where: { id: obligationId },
    select: { id: true, number: true, status: true, grossAmount: true, settlementId: true, supplier: { select: { companyId: true } } },
  })
  const paid = await sumaViva(tx, { obligationId })
  const outstanding = o.grossAmount.minus(paid)
  if (outstanding.isNegative()) fallo('SOBREPAGO', `La obligación ${o.number} quedaría sobrepagada.`)
  const status = o.status === 'CANCELLED' ? 'CANCELLED' : estadoObligacionSegunSaldo(o.grossAmount, paid)
  await tx.supplyV2SupplierObligation.update({ where: { id: o.id }, data: { paidAmount: paid, outstandingAmount: outstanding, status } })
  if (status === 'PAID' && o.status !== 'PAID') {
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_OBLIGATION_PAID', 'SupplyV2SupplierObligation', o.id, { number: o.number, grossAmount: o.grossAmount.toFixed(2) }, o.supplier.companyId)
  }
  // Slice 5 (§42): la liquidación que la contiene deriva su estado de sus obligaciones.
  if (o.settlementId) await recalcularLiquidacionEnTx(tx, o.settlementId, ctx)
  return { status, outstanding }
}

/**
 * Slice 5: `paidAmount` y estado de una liquidación = lo pagado en sus
 * obligaciones vivas (las aplicaciones siguen siendo la verdad). Solo se
 * deriva estando aprobada; PENDING_APPROVAL y CANCELLED no cambian aquí.
 *
 * CORRECCIÓN previa al Slice 7: se descuenta lo que YA se había adelantado a
 * esas obligaciones ANTES de generar la liquidación (`alreadyPaidTotal`). El
 * neto de la liquidación es el SALDO de sus obligaciones, así que lo pagado
 * tiene que medirse desde la misma línea de salida. Sumando todo, una
 * liquidación de 500 sobre una obligación con 400 adelantados nacía con 400
 * pagados y 100 pendientes: al proveedor se le quedaban debiendo 400.
 */
export async function recalcularLiquidacionEnTx(tx: Tx, settlementId: string, ctx: ContextoAuditoria): Promise<{ status: string; paidAmount: Decimal }> {
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_settlements" WHERE "id" = ${settlementId} FOR UPDATE`
  const s = await tx.supplyV2Settlement.findUniqueOrThrow({
    where: { id: settlementId },
    select: { id: true, number: true, status: true, supplierNet: true, paidAmount: true, alreadyPaidTotal: true, obligations: { select: { paidAmount: true, status: true } }, supplier: { select: { companyId: true } } },
  })
  const pagadoEnObligaciones = s.obligations.filter((o) => o.status !== 'CANCELLED').reduce((t, o) => t.plus(o.paidAmount), CERO)
  const contraEstaLiquidacion = pagadoEnObligaciones.minus(s.alreadyPaidTotal)
  const paidAmount = contraEstaLiquidacion.isNegative() ? CERO : contraEstaLiquidacion
  let status = s.status
  if (['APPROVED', 'PARTIALLY_PAID', 'PAID'].includes(s.status)) status = estadoLiquidacionSegunPago(s.supplierNet, paidAmount)
  await tx.supplyV2Settlement.update({ where: { id: s.id }, data: { paidAmount, status, ...(status === 'PAID' && s.status !== 'PAID' ? { paidAt: new Date() } : {}), ...(status !== 'PAID' && s.status === 'PAID' ? { paidAt: null } : {}) } })
  if (status === 'PAID' && s.status !== 'PAID') {
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_SETTLEMENT_PAID', 'SupplyV2Settlement', s.id, { number: s.number, supplierNet: s.supplierNet.toFixed(2), paidAmount: paidAmount.toFixed(2) }, s.supplier.companyId)
  }
  return { status, paidAmount }
}

/** Slice 5: vuelve a sumar las líneas de una liquidación (cuando una obligación sale de ella antes de pagarse). */
export async function recalcularTotalesDeLiquidacionEnTx(tx: Tx, settlementId: string): Promise<void> {
  const lineas = await tx.supplyV2SettlementLine.findMany({
    where: { settlementId },
    select: { grossAmount: true, commissionAmount: true, supplierNet: true, contractualAmount: true, supplierDiscountAmount: true, membegoSubsidyAmount: true, customerPaidAmount: true, alreadyPaidAmount: true },
  })
  // Se vuelven a sumar TODAS las columnas, no solo tres: si se dejara alguna
  // sin recalcular, la cabecera dejaría de cuadrar con sus líneas y el CHECK
  // de la base rechazaría el cambio (o, peor, lo dejaría pasar descuadrado).
  const t = lineas.reduce(
    (acc, l) => ({
      g: acc.g.plus(l.grossAmount),
      c: acc.c.plus(l.commissionAmount),
      n: acc.n.plus(l.supplierNet),
      contractual: acc.contractual.plus(l.contractualAmount),
      descuento: acc.descuento.plus(l.supplierDiscountAmount),
      subsidio: acc.subsidio.plus(l.membegoSubsidyAmount),
      cobrado: acc.cobrado.plus(l.customerPaidAmount),
      adelantado: acc.adelantado.plus(l.alreadyPaidAmount),
    }),
    { g: CERO, c: CERO, n: CERO, contractual: CERO, descuento: CERO, subsidio: CERO, cobrado: CERO, adelantado: CERO }
  )
  await tx.supplyV2Settlement.update({
    where: { id: settlementId },
    data: {
      grossSales: t.g,
      commissionAmount: t.c,
      supplierNet: t.n,
      contractualValue: t.contractual,
      supplierDiscountTotal: t.descuento,
      membegoSubsidyTotal: t.subsidio,
      customerPaidTotal: t.cobrado,
      alreadyPaidTotal: t.adelantado,
    },
  })
}

export async function recalcularFacturaEnTx(tx: Tx, invoiceId: string): Promise<{ status: string; amountDue: Decimal }> {
  const f = await tx.supplyV2SupplierInvoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: { id: true, number: true, status: true, total: true, purchaseOrderId: true },
  })
  const [pagado, aplicado] = await Promise.all([
    sumaViva(tx, { invoiceId, type: { in: ['PAYMENT_TO_INVOICE', 'PAYMENT_TO_OBLIGATION'] } }),
    sumaViva(tx, { invoiceId, type: { in: ['DEPOSIT_TO_INVOICE', 'DEPOSIT_TO_OBLIGATION'] } }),
  ])
  const amountDue = f.total.minus(pagado).minus(aplicado)
  if (amountDue.isNegative()) fallo('SOBREPAGO', `La factura ${f.number} quedaría sobrepagada.`)
  const status = ['APPROVED', 'PARTIALLY_PAID', 'PAID'].includes(f.status) ? estadoFacturaSegunSaldo(f.total, pagado, aplicado) : f.status
  await tx.supplyV2SupplierInvoice.update({ where: { id: f.id }, data: { amountPaid: pagado, amountApplied: aplicado, amountDue, status } })
  if (f.purchaseOrderId) await actualizarEstadoPagoDeOrdenEnTx(tx, f.purchaseOrderId)
  return { status, amountDue }
}

/** El estado «pagada / parcialmente pagada» de la orden, derivado de sus facturas; solo si la máquina de estados lo admite. */
export async function actualizarEstadoPagoDeOrdenEnTx(tx: Tx, purchaseOrderId: string): Promise<void> {
  const o = await tx.supplyV2PurchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: { id: true, status: true, total: true, invoices: { where: { status: { not: 'CANCELLED' } }, select: { amountPaid: true, amountApplied: true } } },
  })
  if (!o) return
  const cubierto = o.invoices.reduce((t, f) => t.plus(f.amountPaid).plus(f.amountApplied), CERO)
  const objetivo = cubierto.greaterThanOrEqualTo(o.total) && cubierto.greaterThan(0) ? 'PAID' : cubierto.greaterThan(0) ? 'PARTIALLY_PAID' : null
  if (!objetivo || objetivo === o.status) return
  if (!puedeTransicionar(TRANSICIONES_ORDEN, o.status, objetivo)) return
  await tx.supplyV2PurchaseOrder.update({ where: { id: o.id }, data: { status: objetivo } })
}

export async function recalcularDepositoEnTx(tx: Tx, depositId: string): Promise<{ available: Decimal; status: string }> {
  const d = await tx.supplyV2SupplierDeposit.findUniqueOrThrow({
    where: { id: depositId },
    select: { id: true, number: true, status: true, originalAmount: true, refundedAmount: true },
  })
  const applied = await sumaViva(tx, { depositId, type: { in: ['DEPOSIT_TO_INVOICE', 'DEPOSIT_TO_OBLIGATION'] } })
  const available = d.originalAmount.minus(applied).minus(d.refundedAmount)
  if (available.isNegative()) fallo('DEPOSITO_INSUFICIENTE', `El depósito ${d.number} quedaría en negativo.`)
  const status = d.status === 'CANCELLED' ? 'CANCELLED' : estadoDepositoSegunSaldo(available, d.refundedAmount, d.originalAmount)
  await tx.supplyV2SupplierDeposit.update({ where: { id: d.id }, data: { appliedAmount: applied, availableAmount: available, status } })
  return { available, status }
}

export async function recalcularPagoEnTx(tx: Tx, paymentId: string): Promise<{ applied: Decimal; unapplied: Decimal }> {
  const p = await tx.supplyV2SupplierPayment.findUniqueOrThrow({ where: { id: paymentId }, select: { id: true, number: true, amount: true } })
  const applied = await sumaViva(tx, { paymentId })
  if (applied.greaterThan(p.amount)) fallo('SOBREAPLICACION', `El pago ${p.number} quedaría aplicado por encima de su monto.`)
  await tx.supplyV2SupplierPayment.update({ where: { id: p.id }, data: { appliedAmount: applied } })
  return { applied, unapplied: p.amount.minus(applied) }
}

// ── Aplicar dinero a una deuda ───────────────────────────────────────────────

export interface DatosAplicacion {
  /** Origen: exactamente uno. */
  paymentId?: string | null
  depositId?: string | null
  /** Destino: una factura (se reparte entre sus obligaciones) o una obligación suelta. */
  invoiceId?: string | null
  obligationId?: string | null
  amount: number | string | Decimal
  idempotencyKey?: string | null
}

export interface AplicacionHecha {
  /** Filas creadas (una por obligación cubierta). */
  applicationIds: string[]
  amount: string
  invoiceStatus?: string
  obligationStatus?: string
  repetida: boolean
}

async function origenBloqueado(tx: Tx, d: DatosAplicacion) {
  if ((d.paymentId ? 1 : 0) + (d.depositId ? 1 : 0) !== 1) fallo('ORIGEN_INVALIDO', 'Una aplicación sale de un pago o de un depósito, no de los dos ni de ninguno.')
  if (d.paymentId) {
    await bloquearFila(tx, 'supply_v2_supplier_payments', d.paymentId)
    const p = await tx.supplyV2SupplierPayment.findUnique({ where: { id: d.paymentId }, select: { id: true, number: true, status: true, supplierId: true, currency: true, amount: true, appliedAmount: true, supplier: { select: { companyId: true } } } })
    if (!p) fallo('PAGO_NO_ENCONTRADO', 'El pago no existe.')
    if (p.status !== 'CONFIRMED') fallo('PAGO_NO_CONFIRMADO', `El pago ${p.number} todavía no está confirmado: solo se aplica dinero confirmado.`)
    return { tipo: 'PAGO' as const, id: p.id, number: p.number, supplierId: p.supplierId, currency: p.currency, disponible: p.amount.minus(p.appliedAmount), companyId: p.supplier.companyId }
  }
  await bloquearFila(tx, 'supply_v2_supplier_deposits', d.depositId!)
  const dep = await tx.supplyV2SupplierDeposit.findUnique({ where: { id: d.depositId! }, select: { id: true, number: true, status: true, supplierId: true, currency: true, availableAmount: true, supplier: { select: { companyId: true } } } })
  if (!dep) fallo('DEPOSITO_NO_ENCONTRADO', 'El depósito no existe.')
  if (dep.status !== 'ACTIVE') fallo('DEPOSITO_NO_ACTIVO', `El depósito ${dep.number} no está activo.`)
  return { tipo: 'DEPOSITO' as const, id: dep.id, number: dep.number, supplierId: dep.supplierId, currency: dep.currency, disponible: dep.availableAmount, companyId: dep.supplier.companyId }
}

/**
 * Aplica `amount` desde un pago o un depósito a una factura (repartido entre
 * sus obligaciones, la más antigua primero) o a una obligación suelta.
 * Idempotente por `idempotencyKey`. Nunca deja negativo ni sobrepaga (§55–§56).
 */
export async function aplicarEnTx(tx: Tx, d: DatosAplicacion, ctx: ContextoAuditoria): Promise<AplicacionHecha> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Aplicar dinero necesita quién lo hace.')
  if ((d.invoiceId ? 1 : 0) + (d.obligationId ? 1 : 0) !== 1) fallo('DESTINO_INVALIDO', 'Una aplicación va a una factura o a una obligación, no a las dos ni a ninguna.')

  // 1. Origen bloqueado (pago → depósito).
  const origen = await origenBloqueado(tx, d)

  // 2. Idempotencia, DESPUÉS del candado del origen.
  if (d.idempotencyKey) {
    const previas = await tx.supplyV2PaymentApplication.findMany({ where: { OR: [{ idempotencyKey: d.idempotencyKey }, { idempotencyKey: { startsWith: `${d.idempotencyKey}:` } }] }, select: { id: true, amount: true } })
    if (previas.length > 0) {
      return { applicationIds: previas.map((p) => p.id), amount: previas.reduce((t, p) => t.plus(p.amount), CERO).toFixed(2), repetida: true }
    }
  }

  // 3. Destino bloqueado (factura → obligaciones).
  let invoice: { id: string; number: string; status: string; supplierId: string; currency: string; amountDue: Decimal; purchaseOrder: { agreementVersion: { snapshot: unknown } } | null } | null = null
  let obligaciones: { id: string; number: string; outstandingAmount: Decimal; invoiceId: string | null; supplierId: string; currency: string; status: string }[]
  if (d.invoiceId) {
    await bloquearFila(tx, 'supply_v2_supplier_invoices', d.invoiceId)
    invoice = await tx.supplyV2SupplierInvoice.findUnique({
      where: { id: d.invoiceId },
      select: { id: true, number: true, status: true, supplierId: true, currency: true, amountDue: true, purchaseOrder: { select: { agreementVersion: { select: { snapshot: true } } } } },
    })
    if (!invoice) fallo('FACTURA_NO_ENCONTRADA', 'La factura no existe.')
    if (!FACTURA_PAGABLE.includes(invoice.status as never)) fallo('FACTURA_NO_PAGABLE', `La factura ${invoice.number} está ${invoice.status}: solo se paga una factura aprobada con saldo.`)
    if (origen.tipo === 'DEPOSITO' && invoice.purchaseOrder && !politicaDeVersion(invoice.purchaseOrder.agreementVersion.snapshot).allowDepositApplication) {
      fallo('DEPOSITO_NO_PERMITIDO', 'El acuerdo de esta compra no permite cubrir facturas con depósito.')
    }
    await tx.$queryRaw`SELECT "id" FROM "supply_v2_supplier_obligations" WHERE "invoiceId" = ${invoice.id} ORDER BY "recognizedAt" ASC, "id" ASC FOR UPDATE`
    obligaciones = await tx.supplyV2SupplierObligation.findMany({
      where: { invoiceId: invoice.id, status: { in: [...OBLIGACION_VIVA] } },
      orderBy: [{ recognizedAt: 'asc' }, { id: 'asc' }],
      select: { id: true, number: true, outstandingAmount: true, invoiceId: true, supplierId: true, currency: true, status: true },
    })
    if (obligaciones.length === 0) fallo('FACTURA_SIN_OBLIGACION', `La factura ${invoice.number} no tiene obligación viva a la que aplicar.`)
  } else {
    await bloquearFila(tx, 'supply_v2_supplier_obligations', d.obligationId!)
    const o = await tx.supplyV2SupplierObligation.findUnique({ where: { id: d.obligationId! }, select: { id: true, number: true, outstandingAmount: true, invoiceId: true, supplierId: true, currency: true, status: true } })
    if (!o) fallo('OBLIGACION_NO_ENCONTRADA', 'La obligación no existe.')
    if (!OBLIGACION_VIVA.includes(o.status)) fallo('OBLIGACION_NO_VIVA', `La obligación ${o.number} está ${o.status}.`)
    if (o.invoiceId) {
      // Se paga por la factura para que sus saldos se muevan juntos.
      await bloquearFila(tx, 'supply_v2_supplier_invoices', o.invoiceId)
      invoice = await tx.supplyV2SupplierInvoice.findUniqueOrThrow({ where: { id: o.invoiceId }, select: { id: true, number: true, status: true, supplierId: true, currency: true, amountDue: true, purchaseOrder: { select: { agreementVersion: { select: { snapshot: true } } } } } })
      if (!FACTURA_PAGABLE.includes(invoice.status as never)) fallo('FACTURA_NO_PAGABLE', `La factura ${invoice.number} está ${invoice.status}.`)
    }
    obligaciones = [o]
  }

  // 4. Mismo proveedor, misma moneda, y el monto cabe en ambos lados.
  const destino = invoice ?? obligaciones[0]!
  if (destino.supplierId !== origen.supplierId) fallo('PROVEEDOR_DISTINTO', 'El dinero y la deuda son de proveedores distintos.')
  if (destino.currency !== origen.currency) fallo('MONEDA_DISTINTA', 'El dinero y la deuda están en monedas distintas.')
  const pendiente = invoice ? invoice.amountDue : obligaciones[0]!.outstandingAmount
  const error = validarAplicacion({
    monto: d.amount,
    disponibleOrigen: origen.disponible,
    pendienteDestino: pendiente,
    origen: origen.tipo === 'PAGO' ? `El pago ${origen.number}` : `El depósito ${origen.number}`,
    destino: invoice ? `La factura ${invoice.number}` : `La obligación ${obligaciones[0]!.number}`,
  })
  if (error) fallo('APLICACION_INVALIDA', error)
  const monto = decimal(d.amount)

  // 5. Una fila por obligación cubierta, la más antigua primero.
  const type: SupplyV2ApplicationType =
    origen.tipo === 'PAGO' ? (invoice && d.invoiceId ? 'PAYMENT_TO_INVOICE' : 'PAYMENT_TO_OBLIGATION') : invoice && d.invoiceId ? 'DEPOSIT_TO_INVOICE' : 'DEPOSIT_TO_OBLIGATION'
  let restante = monto
  const ids: string[] = []
  for (const [i, o] of obligaciones.entries()) {
    if (restante.lessThanOrEqualTo(0)) break
    const cuota = Decimal_min(restante, o.outstandingAmount)
    if (cuota.lessThanOrEqualTo(0)) continue
    const a = await tx.supplyV2PaymentApplication.create({
      data: {
        type,
        paymentId: origen.tipo === 'PAGO' ? origen.id : null,
        depositId: origen.tipo === 'DEPOSITO' ? origen.id : null,
        invoiceId: invoice?.id ?? null,
        obligationId: o.id,
        amount: cuota,
        currency: origen.currency,
        idempotencyKey: d.idempotencyKey ? (i === 0 ? d.idempotencyKey : `${d.idempotencyKey}:${i}`) : null,
        createdById: ctx.actorId,
      },
      select: { id: true },
    })
    ids.push(a.id)
    restante = restante.minus(cuota)
    await recalcularObligacionEnTx(tx, o.id, ctx)
    if (origen.tipo === 'DEPOSITO') {
      const { available } = await recalcularDepositoEnTx(tx, origen.id)
      await tx.supplyV2SupplierDepositMovement.create({
        data: { depositId: origen.id, type: 'DEPOSIT_APPLIED', amount: cuota.negated(), balanceAfter: available, applicationId: a.id, reason: `Aplicado a ${invoice ? `la factura ${invoice.number}` : `la obligación ${o.number}`}.`, actorId: ctx.actorId },
      })
    }
  }
  if (restante.greaterThan(0)) fallo('OBLIGACIONES_INSUFICIENTES', `Las obligaciones de la factura no cubren el monto: quedan ${restante.toFixed(2)} sin destino.`)

  // 6. Caché del origen y de la factura.
  if (origen.tipo === 'PAGO') await recalcularPagoEnTx(tx, origen.id)
  let invoiceStatus: string | undefined
  if (invoice) invoiceStatus = (await recalcularFacturaEnTx(tx, invoice.id)).status
  const obligationStatus = (await tx.supplyV2SupplierObligation.findUniqueOrThrow({ where: { id: obligaciones[0]!.id }, select: { status: true } })).status

  // 7. Bitácora.
  await auditarEnTx(tx, ctx, origen.tipo === 'PAGO' ? 'SUPPLY_V2_PAYMENT_APPLIED' : 'SUPPLY_V2_DEPOSIT_APPLIED', origen.tipo === 'PAGO' ? 'SupplyV2SupplierPayment' : 'SupplyV2SupplierDeposit', origen.id, {
    number: origen.number,
    type,
    amount: monto.toFixed(2),
    invoiceId: invoice?.id ?? null,
    invoiceNumber: invoice?.number ?? null,
    obligationIds: obligaciones.slice(0, ids.length).map((o) => o.id),
    applicationIds: ids,
    invoiceStatus: invoiceStatus ?? null,
  }, origen.companyId)

  return { applicationIds: ids, amount: monto.toFixed(2), invoiceStatus, obligationStatus, repetida: false }
}

function Decimal_min(a: Decimal, b: Decimal): Decimal {
  return a.lessThan(b) ? a : b
}

// ── Reversa (§57) ────────────────────────────────────────────────────────────

export interface ReversaAplicacion {
  id: string
  reversalId: string
  amount: string
}

/**
 * Deshace una aplicación por error administrativo: crea una fila REVERSAL
 * que apunta a la original, marca la original y RECALCULA todos los saldos
 * desde las aplicaciones vivas. La original no se borra.
 */
export async function reversarAplicacionEnTx(tx: Tx, applicationId: string, motivo: string, ctx: ContextoAuditoria): Promise<ReversaAplicacion> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Reversar necesita quién lo hace.')
  if (!motivo?.trim()) fallo('MOTIVO_OBLIGATORIO', 'Reversar una aplicación exige un motivo.')
  await bloquearFila(tx, 'supply_v2_payment_applications', applicationId)
  const a = await tx.supplyV2PaymentApplication.findUnique({
    where: { id: applicationId },
    select: { id: true, type: true, amount: true, currency: true, paymentId: true, depositId: true, invoiceId: true, obligationId: true, reversedAt: true, payment: { select: { number: true, supplier: { select: { companyId: true } } } }, deposit: { select: { number: true, status: true, originalAmount: true, availableAmount: true, supplier: { select: { companyId: true } } } } },
  })
  if (!a) fallo('APLICACION_NO_ENCONTRADA', 'La aplicación no existe.')
  if (a.type === 'REVERSAL') fallo('ES_REVERSA', 'Una reversa no se reversa.')
  if (a.reversedAt) fallo('YA_REVERSADA', 'Esa aplicación ya fue reversada.')

  // Candados en el mismo orden que al aplicar.
  if (a.paymentId) await bloquearFila(tx, 'supply_v2_supplier_payments', a.paymentId)
  if (a.depositId) await bloquearFila(tx, 'supply_v2_supplier_deposits', a.depositId)
  if (a.invoiceId) await bloquearFila(tx, 'supply_v2_supplier_invoices', a.invoiceId)
  if (a.obligationId) await bloquearFila(tx, 'supply_v2_supplier_obligations', a.obligationId)

  if (a.type === 'PAYMENT_TO_DEPOSIT') {
    // El depósito que financió este pago solo se deshace si nadie lo usó.
    if (!a.deposit || !a.deposit.availableAmount.equals(a.deposit.originalAmount) || a.deposit.status !== 'ACTIVE') {
      fallo('DEPOSITO_USADO', 'El depósito ya se aplicó en parte: reversa primero sus aplicaciones.')
    }
  }

  const ahora = new Date()
  const rev = await tx.supplyV2PaymentApplication.create({
    data: {
      type: 'REVERSAL',
      paymentId: a.paymentId,
      depositId: a.depositId,
      invoiceId: a.invoiceId,
      obligationId: a.obligationId,
      amount: a.amount,
      currency: a.currency,
      reversalOfId: a.id,
      createdById: ctx.actorId,
    },
    select: { id: true },
  })
  await tx.supplyV2PaymentApplication.update({ where: { id: a.id }, data: { reversedAt: ahora, reversedById: ctx.actorId, reversalReason: motivo.trim() } })

  if (a.obligationId) await recalcularObligacionEnTx(tx, a.obligationId, ctx)
  if (a.invoiceId) await recalcularFacturaEnTx(tx, a.invoiceId)
  if (a.paymentId) await recalcularPagoEnTx(tx, a.paymentId)
  if (a.depositId) {
    if (a.type === 'PAYMENT_TO_DEPOSIT') {
      await tx.supplyV2SupplierDeposit.update({ where: { id: a.depositId }, data: { status: 'CANCELLED', availableAmount: CERO, refundedAmount: a.deposit!.originalAmount } })
      await tx.supplyV2SupplierDepositMovement.create({ data: { depositId: a.depositId, type: 'ADJUSTMENT', amount: a.deposit!.originalAmount.negated(), balanceAfter: CERO, applicationId: rev.id, reason: `Depósito deshecho: ${motivo.trim()}`, actorId: ctx.actorId } })
    } else {
      const { available } = await recalcularDepositoEnTx(tx, a.depositId)
      await tx.supplyV2SupplierDepositMovement.create({ data: { depositId: a.depositId, type: 'DEPOSIT_RELEASED', amount: a.amount, balanceAfter: available, applicationId: rev.id, reason: `Reversa: ${motivo.trim()}`, actorId: ctx.actorId } })
    }
  }

  const companyId = a.payment?.supplier.companyId ?? a.deposit?.supplier.companyId ?? null
  await auditarEnTx(tx, ctx, a.paymentId && a.type !== 'PAYMENT_TO_DEPOSIT' ? 'SUPPLY_V2_PAYMENT_REVERSED' : 'SUPPLY_V2_DEPOSIT_REVERSED', 'SupplyV2PaymentApplication', a.id, {
    type: a.type,
    amount: a.amount.toFixed(2),
    reversalId: rev.id,
    paymentNumber: a.payment?.number ?? null,
    depositNumber: a.deposit?.number ?? null,
    invoiceId: a.invoiceId,
    obligationId: a.obligationId,
    motivo: motivo.trim(),
  }, companyId)
  return { id: a.id, reversalId: rev.id, amount: a.amount.toFixed(2) }
}
