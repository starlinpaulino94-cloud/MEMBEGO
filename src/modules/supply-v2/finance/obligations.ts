import type { SupplyV2RecognitionBasis } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { redondear2, type Decimal } from '../core/dinero'
import { fallo } from '../core/errores'
import { siguienteNumero } from '../core/numeracion'
import { CERO, creaObligacion, OBLIGACION_VIVA, politicaDeVersion, vencimientoDeObligacion, type PoliticaFinanciera } from './domain'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 4 · OBLIGACIONES (§17–§21).
 *
 * Una obligación es «Membego debe X al proveedor por este hecho». Nace donde
 * lo dice la VERSIÓN del acuerdo que rige la compra (nunca el acuerdo
 * actual), y es única por hecho (`sourceType + sourceId`): repetir el hecho
 * no repite la deuda. Regla crítica: NO TODA REDENCIÓN CREA CxP.
 */

export async function numeroObligacion(tx: Tx, fecha = new Date()): Promise<string> {
  return siguienteNumero(tx, 'MBG-OB', async (prefijo) => {
    const u = await tx.supplyV2SupplierObligation.findFirst({ where: { number: { startsWith: prefijo } }, orderBy: { number: 'desc' }, select: { number: true } })
    return u?.number ?? null
  }, fecha)
}

export interface DatosObligacion {
  supplierId: string
  sourceType: 'INVOICE' | 'PURCHASE_RECEIPT' | 'REDEMPTION' | 'MANUAL'
  sourceId: string
  recognitionBasis: SupplyV2RecognitionBasis
  grossAmount: Decimal
  currency: string
  purchaseOrderId?: string | null
  receiptId?: string | null
  redemptionId?: string | null
  invoiceId?: string | null
  agreementId?: string | null
  agreementVersionId?: string | null
  recognizedAt?: Date
  dueAt?: Date | null
  notes?: string | null
  companyId?: string | null
}

export interface ObligacionReconocida {
  id: string
  number: string
  grossAmount: string
  repetida: boolean
}

/** Crea la obligación si no existe para ese hecho; si existe, la devuelve (idempotente, §53). */
export async function reconocerObligacionEnTx(tx: Tx, d: DatosObligacion, ctx: ContextoAuditoria): Promise<ObligacionReconocida> {
  const previa = await tx.supplyV2SupplierObligation.findUnique({ where: { sourceType_sourceId: { sourceType: d.sourceType, sourceId: d.sourceId } }, select: { id: true, number: true, grossAmount: true } })
  if (previa) return { id: previa.id, number: previa.number, grossAmount: previa.grossAmount.toFixed(2), repetida: true }
  const gross = redondear2(d.grossAmount)
  if (gross.isNegative()) fallo('MONTO_INVALIDO', 'Una obligación no puede ser negativa.')
  const recognizedAt = d.recognizedAt ?? new Date()
  const number = await numeroObligacion(tx, recognizedAt)
  const o = await tx.supplyV2SupplierObligation.create({
    data: {
      number,
      supplierId: d.supplierId,
      sourceType: d.sourceType,
      sourceId: d.sourceId,
      purchaseOrderId: d.purchaseOrderId ?? null,
      receiptId: d.receiptId ?? null,
      redemptionId: d.redemptionId ?? null,
      invoiceId: d.invoiceId ?? null,
      agreementId: d.agreementId ?? null,
      agreementVersionId: d.agreementVersionId ?? null,
      currency: d.currency,
      grossAmount: gross,
      paidAmount: CERO,
      outstandingAmount: gross,
      recognitionBasis: d.recognitionBasis,
      status: gross.isZero() ? 'PAID' : 'OPEN',
      recognizedAt,
      dueAt: d.dueAt ?? null,
      notes: d.notes ?? null,
    },
    select: { id: true, number: true },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_OBLIGATION_RECOGNIZED', 'SupplyV2SupplierObligation', o.id, {
    number: o.number,
    supplierId: d.supplierId,
    sourceType: d.sourceType,
    sourceId: d.sourceId,
    recognitionBasis: d.recognitionBasis,
    grossAmount: gross.toFixed(2),
    agreementVersionId: d.agreementVersionId ?? null,
  }, d.companyId ?? null)
  return { id: o.id, number: o.number, grossAmount: gross.toFixed(2), repetida: false }
}

/** Política financiera de la versión del acuerdo de una orden de compra. */
export async function politicaDeOrdenEnTx(tx: Tx, purchaseOrderId: string): Promise<{ politica: PoliticaFinanciera; agreementId: string; agreementVersionId: string; supplierId: string; companyId: string | null; taxRate: Decimal; currency: string }> {
  const o = await tx.supplyV2PurchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: { agreementId: true, agreementVersionId: true, supplierId: true, taxRate: true, currency: true, agreementVersion: { select: { snapshot: true } }, supplier: { select: { companyId: true } } },
  })
  if (!o) fallo('ORDEN_NO_ENCONTRADA', 'La orden no existe.')
  return { politica: politicaDeVersion(o.agreementVersion.snapshot), agreementId: o.agreementId, agreementVersionId: o.agreementVersionId, supplierId: o.supplierId, companyId: o.supplier.companyId, taxRate: o.taxRate, currency: o.currency }
}

/**
 * RECEPCIÓN (§19, PAY_LATER con ON_RECEIPT): la mercancía ya está y ya se
 * debe. Bajo cualquier otra política no crea nada. Monto = unidades × costo
 * de la línea, con el impuesto de la orden (así cuadra con la factura).
 */
export async function reconocerObligacionPorRecepcionEnTx(tx: Tx, receiptId: string, ctx: ContextoAuditoria): Promise<ObligacionReconocida | null> {
  const r = await tx.supplyV2PurchaseReceipt.findUnique({
    where: { id: receiptId },
    select: { id: true, number: true, receivedAt: true, purchaseOrderId: true, supplierId: true, lines: { select: { quantity: true, purchaseOrderLine: { select: { unitCost: true } } } } },
  })
  if (!r) fallo('RECEPCION_NO_ENCONTRADA', 'La recepción no existe.')
  const { politica, agreementId, agreementVersionId, companyId, taxRate, currency } = await politicaDeOrdenEnTx(tx, r.purchaseOrderId)
  if (!creaObligacion(politica, 'RECEIPT')) return null
  const subtotal = r.lines.reduce((t, l) => t.plus(l.purchaseOrderLine.unitCost.times(l.quantity)), CERO)
  const gross = redondear2(subtotal.plus(redondear2(subtotal.times(taxRate).dividedBy(100))))
  return reconocerObligacionEnTx(tx, {
    supplierId: r.supplierId,
    sourceType: 'PURCHASE_RECEIPT',
    sourceId: r.id,
    recognitionBasis: 'RECEIPT',
    grossAmount: gross,
    currency,
    purchaseOrderId: r.purchaseOrderId,
    receiptId: r.id,
    agreementId,
    agreementVersionId,
    recognizedAt: r.receivedAt,
    dueAt: vencimientoDeObligacion(r.receivedAt, politica.paymentTermsDays),
    notes: `Recepción ${r.number}.`,
    companyId,
  }, ctx)
}

/**
 * REDENCIÓN (§2, §19): solo si la versión del acuerdo del LOTE dice
 * ON_REDEMPTION. Una compra PREPAID (o PAY_LATER con deuda ya reconocida al
 * recibir o facturar) NO crea deuda nueva al entregar.
 */
export async function reconocerObligacionPorRedencionEnTx(tx: Tx, redemptionId: string, ctx: ContextoAuditoria): Promise<ObligacionReconocida | null> {
  const r = await tx.supplyV2Redemption.findUnique({
    where: { id: redemptionId },
    select: { id: true, number: true, redeemedAt: true, supplierId: true, quantity: true, unitCostSnapshot: true, currency: true, lot: { select: { purchaseOrderId: true, agreementId: true, agreementVersionId: true, agreementVersion: { select: { snapshot: true } } } }, supplier: { select: { companyId: true } } },
  })
  if (!r) fallo('REDENCION_NO_ENCONTRADA', 'La redención no existe.')
  const politica = politicaDeVersion(r.lot.agreementVersion.snapshot)
  if (!creaObligacion(politica, 'REDEMPTION')) return null
  return reconocerObligacionEnTx(tx, {
    supplierId: r.supplierId,
    sourceType: 'REDEMPTION',
    sourceId: r.id,
    recognitionBasis: 'REDEMPTION',
    grossAmount: r.unitCostSnapshot.times(r.quantity),
    currency: r.currency,
    purchaseOrderId: r.lot.purchaseOrderId,
    redemptionId: r.id,
    agreementId: r.lot.agreementId,
    agreementVersionId: r.lot.agreementVersionId,
    recognizedAt: r.redeemedAt,
    dueAt: vencimientoDeObligacion(r.redeemedAt, politica.paymentTermsDays),
    notes: `Entrega ${r.number}.`,
    companyId: r.supplier.companyId,
  }, ctx)
}

/** La reversa de una redención cancela su obligación si nadie la pagó todavía; si ya se pagó, queda y se avisa. */
export async function cancelarObligacionDeRedencionEnTx(tx: Tx, redemptionId: string, motivo: string, ctx: ContextoAuditoria): Promise<'CANCELADA' | 'PAGADA_SE_CONSERVA' | 'SIN_OBLIGACION'> {
  const o = await tx.supplyV2SupplierObligation.findUnique({ where: { redemptionId }, select: { id: true, number: true, status: true, paidAmount: true, supplier: { select: { companyId: true } } } })
  if (!o) return 'SIN_OBLIGACION'
  if (o.status === 'CANCELLED') return 'CANCELADA'
  if (o.paidAmount.greaterThan(0)) {
    await tx.supplyV2SupplierObligation.update({ where: { id: o.id }, data: { notes: `Redención reversada con pago ya aplicado: ${motivo}` } })
    return 'PAGADA_SE_CONSERVA'
  }
  await tx.supplyV2SupplierObligation.update({ where: { id: o.id }, data: { status: 'CANCELLED', outstandingAmount: CERO, cancelledAt: new Date(), cancelledReason: motivo } })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_OBLIGATION_CANCELLED', 'SupplyV2SupplierObligation', o.id, { number: o.number, motivo }, o.supplier.companyId)
  return 'CANCELADA'
}

/**
 * Al APROBAR una factura (§9, §19): enlaza las obligaciones vivas ya
 * reconocidas por recepción (misma orden) o por redención (mismo proveedor)
 * que todavía no tienen factura, la más antigua primero mientras quepan en
 * el total; el resto del total nace como obligación INVOICE. Así una deuda
 * nunca se cuenta dos veces: ni la recepción y su factura, ni la factura y
 * sus redenciones.
 */
export async function enlazarObligacionesAFacturaEnTx(
  tx: Tx,
  f: { id: string; number: string; total: Decimal; currency: string; supplierId: string; purchaseOrderId: string | null; dueDate: Date | null; approvedAt: Date; companyId: string | null },
  ctx: ContextoAuditoria
): Promise<{ enlazadas: string[]; creada: string | null }> {
  let politica: PoliticaFinanciera = politicaDeVersion(null)
  let agreementId: string | null = null
  let agreementVersionId: string | null = null
  if (f.purchaseOrderId) {
    const p = await politicaDeOrdenEnTx(tx, f.purchaseOrderId)
    politica = p.politica
    agreementId = p.agreementId
    agreementVersionId = p.agreementVersionId
  }
  const candidatas =
    politica.payableRecognition === 'ON_RECEIPT' && f.purchaseOrderId
      ? await tx.supplyV2SupplierObligation.findMany({ where: { purchaseOrderId: f.purchaseOrderId, sourceType: 'PURCHASE_RECEIPT', invoiceId: null, status: { in: [...OBLIGACION_VIVA] }, currency: f.currency }, orderBy: [{ recognizedAt: 'asc' }, { id: 'asc' }], select: { id: true, grossAmount: true } })
      : politica.payableRecognition === 'ON_REDEMPTION'
        ? await tx.supplyV2SupplierObligation.findMany({ where: { supplierId: f.supplierId, sourceType: 'REDEMPTION', invoiceId: null, status: { in: [...OBLIGACION_VIVA] }, currency: f.currency, ...(f.purchaseOrderId ? { purchaseOrderId: f.purchaseOrderId } : {}) }, orderBy: [{ recognizedAt: 'asc' }, { id: 'asc' }], select: { id: true, grossAmount: true } })
        : []
  let acumulado = CERO
  const enlazadas: string[] = []
  for (const c of candidatas) {
    if (acumulado.plus(c.grossAmount).greaterThan(f.total)) break
    acumulado = acumulado.plus(c.grossAmount)
    enlazadas.push(c.id)
  }
  if (enlazadas.length > 0) {
    await tx.supplyV2SupplierObligation.updateMany({ where: { id: { in: enlazadas } }, data: { invoiceId: f.id, ...(f.dueDate ? { dueAt: f.dueDate } : {}) } })
  }
  const resto = f.total.minus(acumulado)
  let creada: string | null = null
  if (resto.greaterThan(0)) {
    const o = await reconocerObligacionEnTx(tx, {
      supplierId: f.supplierId,
      sourceType: 'INVOICE',
      sourceId: f.id,
      recognitionBasis: 'INVOICE',
      grossAmount: resto,
      currency: f.currency,
      purchaseOrderId: f.purchaseOrderId,
      invoiceId: f.id,
      agreementId,
      agreementVersionId,
      recognizedAt: f.approvedAt,
      dueAt: f.dueDate ?? vencimientoDeObligacion(f.approvedAt, politica.paymentTermsDays),
      notes: `Factura ${f.number}.`,
      companyId: f.companyId,
    }, ctx)
    creada = o.id
  }
  return { enlazadas, creada }
}
