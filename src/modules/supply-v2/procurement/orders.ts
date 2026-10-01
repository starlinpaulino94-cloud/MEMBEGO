import type { SupplyV2PaymentMode, SupplyV2PurchaseOrderStatus } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { calcularTotales, decimal } from '../core/dinero'
import { fallo } from '../core/errores'
import { personasAutorizadasEnTx } from '../core/autorizadas'
import { exigirTransicion, TRANSICIONES_ORDEN } from '../core/estados'
import { MOTIVO_AUTOAPROBACION, revisarSegregacion } from '../core/segregacion'
import { PAYMENT_MODES_SLICE1 } from '../core/catalogo'
import { siguienteNumero } from '../core/numeracion'
import { acuerdoCompatible } from '../agreements/domain'

/**
 * MEMBEGO SUPPLY 2.0 · órdenes de compra (§12–§14, §23, §35).
 *
 * Todo dentro de la `tx` de quien llama. Los totales se calculan AQUÍ con
 * Decimal: el formulario manda cantidades y costos, nunca totales.
 */

export interface LineaOrdenEntrada {
  catalogItemId: string
  quantity: number
  unitCost: number | string
}

export interface DatosOrden {
  supplierId: string
  agreementId: string
  lines: LineaOrdenEntrada[]
  taxRate?: number | string | null
  paymentMode?: SupplyV2PaymentMode | null
  notes?: string | null
}

export interface OrdenCreada {
  id: string
  number: string
  total: string
}

export async function crearOrdenEnTx(tx: Tx, d: DatosOrden, ctx: ContextoAuditoria): Promise<OrdenCreada> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Una orden necesita quién la crea.')
  if (!d.lines?.length) fallo('ORDEN_SIN_LINEAS', 'Una orden de compra sin líneas no compra nada.')
  const paymentMode = d.paymentMode ?? 'PREPAID'
  if (!PAYMENT_MODES_SLICE1.includes(paymentMode)) {
    fallo('FORMA_DE_PAGO', 'En esta versión solo se puede pagar por anticipado o después.')
  }

  const proveedor = await tx.supplyV2Supplier.findUnique({
    where: { id: d.supplierId },
    select: { id: true, status: true, currency: true, companyId: true },
  })
  if (!proveedor) fallo('PROVEEDOR_NO_ENCONTRADO', 'El proveedor no existe.')
  if (proveedor.status !== 'ACTIVE') fallo('PROVEEDOR_INACTIVO', 'El proveedor no está activo.')

  const acuerdo = await tx.supplyV2Agreement.findUnique({
    where: { id: d.agreementId },
    select: {
      id: true,
      supplierId: true,
      status: true,
      type: true,
      scope: true,
      catalogItemId: true,
      category: true,
      startsAt: true,
      endsAt: true,
      version: true,
      currency: true,
    },
  })
  if (!acuerdo || acuerdo.supplierId !== proveedor.id) fallo('ACUERDO_AJENO', 'El acuerdo no es de este proveedor.')
  if (acuerdo.status !== 'ACTIVE' || acuerdo.version < 1) {
    fallo('ACUERDO_NO_VIGENTE', 'Solo se compra contra un acuerdo vigente.')
  }
  const version = await tx.supplyV2AgreementVersion.findUnique({
    where: { agreementId_version: { agreementId: acuerdo.id, version: acuerdo.version } },
    select: { id: true },
  })
  if (!version) fallo('ACUERDO_SIN_VERSION', 'El acuerdo vigente no tiene versión registrada.')

  const items = await tx.supplyV2CatalogItem.findMany({
    where: { id: { in: d.lines.map((l) => l.catalogItemId) } },
    select: { id: true, supplierId: true, name: true, category: true, status: true },
  })
  const porId = new Map(items.map((i) => [i.id, i]))
  for (const l of d.lines) {
    const item = porId.get(l.catalogItemId)
    if (!item || item.supplierId !== proveedor.id) fallo('ITEM_AJENO', 'Un producto de la orden no es de este proveedor.')
    if (item.status !== 'ACTIVE') fallo('ITEM_INACTIVO', `El producto «${item.name}» no está activo.`)
    if (!acuerdoCompatible(acuerdo, item)) {
      fallo('ACUERDO_NO_CUBRE', `El acuerdo no cubre el producto «${item.name}».`)
    }
  }

  const totales = calcularTotales(d.lines, d.taxRate ?? 0)
  const number = await siguienteNumero(tx, 'MBG-PO', async (prefijo) => {
    const u = await tx.supplyV2PurchaseOrder.findFirst({
      where: { number: { startsWith: prefijo } },
      orderBy: { number: 'desc' },
      select: { number: true },
    })
    return u?.number ?? null
  })

  const orden = await tx.supplyV2PurchaseOrder.create({
    data: {
      number,
      supplierId: proveedor.id,
      agreementId: acuerdo.id,
      agreementVersionId: version.id,
      currency: acuerdo.currency,
      subtotal: totales.subtotal,
      taxRate: totales.taxRate,
      taxes: totales.taxes,
      total: totales.total,
      status: 'DRAFT',
      paymentMode,
      notes: d.notes?.trim() || null,
      createdById: ctx.actorId,
      lines: {
        create: d.lines.map((l, i) => ({
          catalogItemId: l.catalogItemId,
          descriptionSnapshot: porId.get(l.catalogItemId)!.name,
          quantity: l.quantity,
          unitCost: decimal(l.unitCost).toDecimalPlaces(2),
          subtotal: totales.lineas[i]!.subtotal,
        })),
      },
      events: { create: { type: 'CREATED', toStatus: 'DRAFT', actorId: ctx.actorId } },
    },
    select: { id: true, number: true, total: true },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_PO_CREATED', 'SupplyV2PurchaseOrder', orden.id, {
    number: orden.number,
    supplierId: proveedor.id,
    agreementId: acuerdo.id,
    total: orden.total.toString(),
    lines: d.lines.length,
  }, proveedor.companyId)
  return { id: orden.id, number: orden.number, total: orden.total.toFixed(2) }
}

async function ordenParaMover(tx: Tx, id: string) {
  const o = await tx.supplyV2PurchaseOrder.findUnique({
    where: { id },
    select: { id: true, number: true, status: true, createdById: true, supplier: { select: { companyId: true } } },
  })
  if (!o) fallo('ORDEN_NO_ENCONTRADA', 'La orden no existe.')
  return o
}

export async function enviarAprobacionEnTx(tx: Tx, id: string, ctx: ContextoAuditoria): Promise<void> {
  const o = await ordenParaMover(tx, id)
  exigirTransicion(TRANSICIONES_ORDEN, o.status, 'PENDING_APPROVAL', 'Orden de compra')
  await tx.supplyV2PurchaseOrder.update({ where: { id }, data: { status: 'PENDING_APPROVAL' } })
  await tx.supplyV2PurchaseOrderEvent.create({
    data: { purchaseOrderId: id, type: 'SUBMITTED', fromStatus: o.status, toStatus: 'PENDING_APPROVAL', actorId: ctx.actorId },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_PO_SUBMITTED', 'SupplyV2PurchaseOrder', id, {
    number: o.number,
    antes: o.status,
    despues: 'PENDING_APPROVAL',
  }, o.supplier.companyId)
}

/**
 * Aprueba. El servidor rechaza que la apruebe quien la creó MIENTRAS HAYA otra
 * persona autorizada; si es la única, la aprobación se permite y queda marcada
 * como tal en el evento y en la bitácora (§23).
 */
export async function aprobarOrdenEnTx(tx: Tx, id: string, ctx: ContextoAuditoria): Promise<void> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Aprobar una orden necesita quién la aprueba.')
  const o = await ordenParaMover(tx, id)
  exigirTransicion(TRANSICIONES_ORDEN, o.status, 'APPROVED', 'Orden de compra')
  const personasAutorizadas = await personasAutorizadasEnTx(tx)
  const segregacion = revisarSegregacion(o.createdById, ctx.actorId, personasAutorizadas, 'ordenCompra')
  if (!segregacion.permitido) fallo('AUTOAPROBACION', segregacion.motivo)
  await tx.supplyV2PurchaseOrder.update({
    where: { id },
    data: { status: 'APPROVED', approvedById: ctx.actorId, approvedAt: new Date() },
  })
  await tx.supplyV2PurchaseOrderEvent.create({
    data: {
      purchaseOrderId: id,
      type: 'APPROVED',
      fromStatus: o.status,
      toStatus: 'APPROVED',
      reason: segregacion.autoaprobada ? MOTIVO_AUTOAPROBACION : null,
      actorId: ctx.actorId,
    },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_PO_APPROVED', 'SupplyV2PurchaseOrder', id, {
    number: o.number,
    antes: o.status,
    despues: 'APPROVED',
    createdById: o.createdById,
    autoaprobada: segregacion.autoaprobada,
    personasAutorizadas,
  }, o.supplier.companyId)
}

/** Rechaza con motivo obligatorio: vuelve a DRAFT y el evento guarda el porqué (§35). */
export async function rechazarOrdenEnTx(tx: Tx, id: string, motivo: string, ctx: ContextoAuditoria): Promise<void> {
  if (!motivo?.trim()) fallo('MOTIVO_OBLIGATORIO', 'Rechazar una orden exige un motivo.')
  const o = await ordenParaMover(tx, id)
  exigirTransicion(TRANSICIONES_ORDEN, o.status, 'DRAFT', 'Orden de compra')
  await tx.supplyV2PurchaseOrder.update({ where: { id }, data: { status: 'DRAFT' } })
  await tx.supplyV2PurchaseOrderEvent.create({
    data: { purchaseOrderId: id, type: 'REJECTED', fromStatus: o.status, toStatus: 'DRAFT', reason: motivo.trim(), actorId: ctx.actorId },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_PO_REJECTED', 'SupplyV2PurchaseOrder', id, {
    number: o.number,
    antes: o.status,
    despues: 'DRAFT',
    motivo: motivo.trim(),
  }, o.supplier.companyId)
}

export async function cancelarOrdenEnTx(tx: Tx, id: string, motivo: string, ctx: ContextoAuditoria): Promise<void> {
  if (!motivo?.trim()) fallo('MOTIVO_OBLIGATORIO', 'Cancelar una orden exige un motivo.')
  const o = await ordenParaMover(tx, id)
  exigirTransicion(TRANSICIONES_ORDEN, o.status, 'CANCELLED', 'Orden de compra')
  const recibido = await tx.supplyV2PurchaseOrderLine.aggregate({
    where: { purchaseOrderId: id },
    _sum: { receivedQuantity: true },
  })
  if ((recibido._sum.receivedQuantity ?? 0) > 0) {
    fallo('ORDEN_CON_RECEPCIONES', 'Una orden con recepciones no se cancela: el supply ya existe.')
  }
  await tx.supplyV2PurchaseOrder.update({ where: { id }, data: { status: 'CANCELLED' } })
  await tx.supplyV2PurchaseOrderEvent.create({
    data: { purchaseOrderId: id, type: 'CANCELLED', fromStatus: o.status, toStatus: 'CANCELLED', reason: motivo.trim(), actorId: ctx.actorId },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_PO_CANCELLED', 'SupplyV2PurchaseOrder', id, {
    number: o.number,
    antes: o.status,
    despues: 'CANCELLED',
    motivo: motivo.trim(),
  }, o.supplier.companyId)
}

export function estadosSiguientes(estado: SupplyV2PurchaseOrderStatus): readonly SupplyV2PurchaseOrderStatus[] {
  return TRANSICIONES_ORDEN[estado]
}
