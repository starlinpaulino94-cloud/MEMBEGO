import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { fallo } from '../core/errores'
import { exigirTransicion } from '../core/estados'
import { siguienteNumero } from '../core/numeracion'
import { esAutoaprobacion, MOTIVO_AUTOAPROBACION } from '../core/segregacion'
import { calcularTotalesFactura, TRANSICIONES_FACTURA, validarLineasContraOrden, type LineaFacturaEntrada } from './domain'
import { enlazarObligacionesAFacturaEnTx } from './obligations'
import { bloquearFila, recalcularFacturaEnTx } from './applications'

/**
 * MEMBEGO SUPPLY · SLICE 4 · FACTURAS DEL PROVEEDOR (§7–§10, §58).
 *
 * La factura es el DOCUMENTO del proveedor. Nace pendiente de aprobación;
 * al aprobarla (otra persona) nace o se enlaza la obligación; el dinero se
 * aplica sobre ella (`applications.ts`). Nunca se borra: se cancela, y solo
 * sin aplicaciones vivas.
 */

export interface DatosFactura {
  supplierId: string
  purchaseOrderId?: string | null
  supplierInvoiceNumber?: string | null
  documentDate: Date
  dueDate?: Date | null
  taxRate?: number | string | null
  lines: LineaFacturaEntrada[]
  attachmentPath?: string | null
  notes?: string | null
  idempotencyKey?: string | null
}

export interface FacturaCreada {
  id: string
  number: string
  total: string
  repetida: boolean
}

export async function crearFacturaEnTx(tx: Tx, d: DatosFactura, ctx: ContextoAuditoria): Promise<FacturaCreada> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Una factura necesita quién la registra.')
  if (!d.lines?.length) fallo('FACTURA_SIN_LINEAS', 'Una factura sin líneas no factura nada.')
  if (!(d.documentDate instanceof Date) || Number.isNaN(d.documentDate.getTime())) fallo('FECHA_INVALIDA', 'La fecha del documento no es válida.')
  if (d.dueDate && d.dueDate < d.documentDate) fallo('VENCIMIENTO_INVALIDO', 'El vencimiento no puede ser anterior a la fecha del documento.')

  const proveedor = await tx.supplyV2Supplier.findUnique({ where: { id: d.supplierId }, select: { id: true, status: true, currency: true, companyId: true, commercialName: true } })
  if (!proveedor) fallo('PROVEEDOR_NO_ENCONTRADO', 'El proveedor no existe.')
  if (proveedor.status !== 'ACTIVE') fallo('PROVEEDOR_INACTIVO', 'El proveedor no está activo.')

  if (d.idempotencyKey) {
    const previa = await tx.supplyV2SupplierInvoice.findUnique({ where: { idempotencyKey: d.idempotencyKey }, select: { id: true, number: true, total: true } })
    if (previa) return { id: previa.id, number: previa.number, total: previa.total.toFixed(2), repetida: true }
  }

  const numeroProveedor = d.supplierInvoiceNumber?.trim() || null
  if (numeroProveedor) {
    const dup = await tx.supplyV2SupplierInvoice.findFirst({ where: { supplierId: proveedor.id, supplierInvoiceNumber: numeroProveedor, status: { not: 'CANCELLED' } }, select: { number: true } })
    if (dup) fallo('FACTURA_DUPLICADA', `La factura ${numeroProveedor} de ${proveedor.commercialName} ya está registrada como ${dup.number}.`)
  }

  let currency = proveedor.currency
  let taxRate: number | string = d.taxRate ?? 0
  let porLinea = new Map<string, { catalogItemId: string; descriptionSnapshot: string }>()
  if (d.purchaseOrderId) {
    // Candado sobre la orden: dos facturas simultáneas no facturan la misma unidad dos veces.
    await tx.$queryRaw`SELECT "id" FROM "supply_v2_purchase_orders" WHERE "id" = ${d.purchaseOrderId} FOR UPDATE`
    const o = await tx.supplyV2PurchaseOrder.findUnique({
      where: { id: d.purchaseOrderId },
      select: { id: true, number: true, status: true, supplierId: true, currency: true, taxRate: true, lines: { select: { id: true, quantity: true, catalogItemId: true, descriptionSnapshot: true } } },
    })
    if (!o || o.supplierId !== proveedor.id) fallo('ORDEN_AJENA', 'La orden de compra no es de este proveedor.')
    if (['DRAFT', 'PENDING_APPROVAL', 'CANCELLED'].includes(o.status)) fallo('ORDEN_NO_FACTURABLE', `Solo se factura contra una orden aprobada (${o.number} está ${o.status}).`)
    const facturado = await tx.supplyV2SupplierInvoiceLine.groupBy({ by: ['purchaseOrderLineId'], where: { purchaseOrderLineId: { in: o.lines.map((l) => l.id) }, invoice: { status: { not: 'CANCELLED' } } }, _sum: { quantity: true } })
    const yaPorLinea = new Map(facturado.map((f) => [f.purchaseOrderLineId!, f._sum.quantity ?? 0]))
    const error = validarLineasContraOrden(d.lines, o.lines.map((l) => ({ id: l.id, quantity: l.quantity, invoicedQuantity: yaPorLinea.get(l.id) ?? 0, descriptionSnapshot: l.descriptionSnapshot })))
    if (error) fallo('SOBRE_FACTURACION', error)
    currency = o.currency
    if (d.taxRate == null || d.taxRate === '') taxRate = o.taxRate.toString()
    porLinea = new Map(o.lines.map((l) => [l.id, { catalogItemId: l.catalogItemId, descriptionSnapshot: l.descriptionSnapshot }]))
  }

  let totales
  try {
    totales = calcularTotalesFactura(d.lines, taxRate)
  } catch (e) {
    fallo('FACTURA_INVALIDA', e instanceof Error ? e.message : 'La factura no es válida.')
  }

  const number = await siguienteNumero(tx, 'MBG-SI', async (prefijo) => {
    const u = await tx.supplyV2SupplierInvoice.findFirst({ where: { number: { startsWith: prefijo } }, orderBy: { number: 'desc' }, select: { number: true } })
    return u?.number ?? null
  }, d.documentDate)

  const f = await tx.supplyV2SupplierInvoice.create({
    data: {
      number,
      supplierId: proveedor.id,
      purchaseOrderId: d.purchaseOrderId ?? null,
      supplierInvoiceNumber: numeroProveedor,
      documentDate: d.documentDate,
      dueDate: d.dueDate ?? null,
      currency,
      subtotal: totales.subtotal,
      taxRate: totales.taxRate,
      taxes: totales.taxes,
      total: totales.total,
      status: 'PENDING_APPROVAL',
      amountApplied: 0,
      amountPaid: 0,
      amountDue: totales.total,
      attachmentPath: d.attachmentPath?.trim() || null,
      notes: d.notes?.trim() || null,
      createdById: ctx.actorId,
      idempotencyKey: d.idempotencyKey ?? null,
      lines: {
        create: d.lines.map((l, i) => {
          const base = l.purchaseOrderLineId ? porLinea.get(l.purchaseOrderLineId) : null
          return {
            purchaseOrderLineId: l.purchaseOrderLineId ?? null,
            catalogItemId: l.catalogItemId ?? base?.catalogItemId ?? null,
            descriptionSnapshot: (l.description?.trim() || base?.descriptionSnapshot || 'Línea').slice(0, 200),
            quantity: l.quantity,
            unitCost: totales.lineas[i]!.subtotal.dividedBy(l.quantity).toDecimalPlaces(2),
            subtotal: totales.lineas[i]!.subtotal,
            taxes: totales.lineas[i]!.taxes,
            total: totales.lineas[i]!.total,
          }
        }),
      },
    },
    select: { id: true, number: true, total: true },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_INVOICE_CREATED', 'SupplyV2SupplierInvoice', f.id, {
    number: f.number,
    supplierId: proveedor.id,
    purchaseOrderId: d.purchaseOrderId ?? null,
    supplierInvoiceNumber: numeroProveedor,
    total: f.total.toFixed(2),
    lines: d.lines.length,
  }, proveedor.companyId)
  return { id: f.id, number: f.number, total: f.total.toFixed(2), repetida: false }
}

export async function aprobarFacturaEnTx(tx: Tx, invoiceId: string, ctx: ContextoAuditoria): Promise<{ id: string; number: string; obligaciones: number; repetida: boolean }> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Aprobar una factura necesita quién la aprueba.')
  await bloquearFila(tx, 'supply_v2_supplier_invoices', invoiceId)
  const f = await tx.supplyV2SupplierInvoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, number: true, status: true, total: true, currency: true, supplierId: true, purchaseOrderId: true, dueDate: true, createdById: true, supplier: { select: { companyId: true } } },
  })
  if (!f) fallo('FACTURA_NO_ENCONTRADA', 'La factura no existe.')
  if (f.status === 'APPROVED' || f.status === 'PARTIALLY_PAID' || f.status === 'PAID') {
    const n = await tx.supplyV2SupplierObligation.count({ where: { invoiceId: f.id } })
    return { id: f.id, number: f.number, obligaciones: n, repetida: true }
  }
  exigirTransicion(TRANSICIONES_FACTURA, f.status, 'APPROVED', 'Factura')
  const autoaprobada = esAutoaprobacion(f.createdById, ctx.actorId)
  const ahora = new Date()
  await tx.supplyV2SupplierInvoice.update({ where: { id: f.id }, data: { status: 'APPROVED', approvedById: ctx.actorId, approvedAt: ahora } })
  const r = await enlazarObligacionesAFacturaEnTx(tx, { ...f, approvedAt: ahora, companyId: f.supplier.companyId }, ctx)
  // Si enlazó obligaciones que ya tenían pagos, la caché de la factura los refleja.
  await recalcularFacturaEnTx(tx, f.id)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_INVOICE_APPROVED', 'SupplyV2SupplierInvoice', f.id, {
    number: f.number,
    total: f.total.toFixed(2),
    obligacionesEnlazadas: r.enlazadas,
    obligacionCreada: r.creada,
    createdById: f.createdById,
    autoaprobada: autoaprobada,
    ...(autoaprobada ? { motivo: MOTIVO_AUTOAPROBACION } : {}),
  }, f.supplier.companyId)
  return { id: f.id, number: f.number, obligaciones: r.enlazadas.length + (r.creada ? 1 : 0), repetida: false }
}

/** Solo sin aplicaciones vivas (§58): una factura pagada no se cancela en silencio; primero se reversan sus aplicaciones. */
export async function cancelarFacturaEnTx(tx: Tx, invoiceId: string, motivo: string, ctx: ContextoAuditoria): Promise<void> {
  if (!motivo?.trim()) fallo('MOTIVO_OBLIGATORIO', 'Cancelar una factura exige un motivo.')
  await bloquearFila(tx, 'supply_v2_supplier_invoices', invoiceId)
  const f = await tx.supplyV2SupplierInvoice.findUnique({ where: { id: invoiceId }, select: { id: true, number: true, status: true, purchaseOrderId: true, supplier: { select: { companyId: true } } } })
  if (!f) fallo('FACTURA_NO_ENCONTRADA', 'La factura no existe.')
  if (f.status === 'CANCELLED') return
  const vivas = await tx.supplyV2PaymentApplication.count({ where: { invoiceId: f.id, reversedAt: null, type: { not: 'REVERSAL' } } })
  if (vivas > 0) fallo('FACTURA_CON_APLICACIONES', `La factura ${f.number} tiene ${vivas} aplicación(es) viva(s): reversa cada una antes de cancelarla.`)
  exigirTransicion(TRANSICIONES_FACTURA, f.status, 'CANCELLED', 'Factura')
  const ahora = new Date()
  await tx.supplyV2SupplierInvoice.update({ where: { id: f.id }, data: { status: 'CANCELLED', cancelledAt: ahora, cancelledReason: motivo.trim(), amountDue: 0, amountPaid: 0, amountApplied: 0 } })
  // Las obligaciones que NACIERON de esta factura se cancelan; las que solo se
  // enlazaron (recepción, redención) siguen debiéndose y se desenlazan.
  const propias = await tx.supplyV2SupplierObligation.findMany({ where: { invoiceId: f.id, sourceType: 'INVOICE' }, select: { id: true, number: true } })
  for (const o of propias) {
    await tx.supplyV2SupplierObligation.update({ where: { id: o.id }, data: { status: 'CANCELLED', outstandingAmount: 0, cancelledAt: ahora, cancelledReason: `Factura ${f.number} cancelada: ${motivo.trim()}` } })
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_OBLIGATION_CANCELLED', 'SupplyV2SupplierObligation', o.id, { number: o.number, invoiceNumber: f.number, motivo: motivo.trim() }, f.supplier.companyId)
  }
  await tx.supplyV2SupplierObligation.updateMany({ where: { invoiceId: f.id, sourceType: { not: 'INVOICE' } }, data: { invoiceId: null } })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_INVOICE_CANCELLED', 'SupplyV2SupplierInvoice', f.id, { number: f.number, antes: f.status, motivo: motivo.trim(), obligacionesCanceladas: propias.length }, f.supplier.companyId)
}
