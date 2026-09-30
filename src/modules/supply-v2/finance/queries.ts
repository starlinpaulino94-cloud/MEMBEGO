import 'server-only'

import type { Prisma, SupplyV2InvoiceStatus, SupplyV2ObligationStatus, SupplyV2SupplierPaymentStatus } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import type { Paginacion } from '@/lib/paginacion'
import { calcularEconomia } from '../economics/queries'
import { CERO, OBLIGACION_VIVA } from './domain'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 4 · lecturas de finanzas (§33–§38, §47, §61).
 *
 * Listas con PAGINACIÓN REAL (`{ filas, total }`): nada se trunca en
 * silencio. Los importes viajan como texto con dos decimales.
 */

const fmt = (n: { toFixed(d: number): string } | null | undefined) => (n == null ? null : n.toFixed(2))
const nombre = (u: { name: string | null; email: string } | null | undefined) => (u ? u.name?.trim() || u.email : null)

// ── Tablero (§33) ─────────────────────────────────────────────────────────────

export interface ResumenFinanzas {
  cxpTotal: string
  facturasPendientes: number
  facturasPendientesMonto: string
  depositosDisponibles: string
  pagosDelMes: string
  pagosPendientesDeConfirmar: number
  gmv: string
  revenue: string
  cost: string
  grossMargin: string
  marginPct: number | null
  unitsSold: number
  unitsRedeemed: number
  unitsExpired: number
  breakageRate: number | null
  supplyVencidoUnidades: number
  supplyVencidoCosto: string
  hayDatos: boolean
}

export async function resumenFinanzas(ahora = new Date()): Promise<ResumenFinanzas> {
  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1)
  const [cxp, pendientes, depositos, pagosMes, pagosPendientes, vencido] = await sinEmpresa('Supply 2.0: tablero de finanzas', (tx) =>
    Promise.all([
      tx.supplyV2SupplierObligation.aggregate({ where: { status: { in: [...OBLIGACION_VIVA] } }, _sum: { outstandingAmount: true } }),
      tx.supplyV2SupplierInvoice.aggregate({ where: { status: { in: ['APPROVED', 'PARTIALLY_PAID'] } }, _sum: { amountDue: true }, _count: { _all: true } }),
      tx.supplyV2SupplierDeposit.aggregate({ where: { status: 'ACTIVE' }, _sum: { availableAmount: true } }),
      tx.supplyV2SupplierPayment.aggregate({ where: { status: 'CONFIRMED', paidAt: { gte: inicioMes } }, _sum: { amount: true } }),
      tx.supplyV2SupplierPayment.count({ where: { status: 'PENDING' } }),
      tx.supplyV2EconomicEvent.aggregate({ where: { type: 'EXPIRATION_COST' }, _sum: { units: true, costAmount: true } }),
    ])
  )
  const econ = await calcularEconomia({ ventana: 'MES' }, ahora)
  const hayDatos = (pendientes._count._all ?? 0) > 0 || (depositos._sum.availableAmount ?? CERO).greaterThan(0) || (cxp._sum.outstandingAmount ?? CERO).greaterThan(0) || econ.hayDatos || (pagosMes._sum.amount ?? CERO).greaterThan(0)
  return {
    cxpTotal: (cxp._sum.outstandingAmount ?? CERO).toFixed(2),
    facturasPendientes: pendientes._count._all ?? 0,
    facturasPendientesMonto: (pendientes._sum.amountDue ?? CERO).toFixed(2),
    depositosDisponibles: (depositos._sum.availableAmount ?? CERO).toFixed(2),
    pagosDelMes: (pagosMes._sum.amount ?? CERO).toFixed(2),
    pagosPendientesDeConfirmar: pagosPendientes,
    gmv: econ.gmv.toFixed(2),
    revenue: econ.revenue.toFixed(2),
    cost: econ.cost.toFixed(2),
    grossMargin: econ.grossMargin.toFixed(2),
    marginPct: econ.marginPct,
    unitsSold: econ.unitsSold,
    unitsRedeemed: econ.unitsRedeemed,
    unitsExpired: econ.unitsExpired,
    breakageRate: econ.breakageRate,
    supplyVencidoUnidades: vencido._sum.units ?? 0,
    supplyVencidoCosto: (vencido._sum.costAmount ?? CERO).toFixed(2),
    hayDatos,
  }
}

// ── Facturas (§35) ────────────────────────────────────────────────────────────

export interface FiltroFacturas {
  supplierId?: string | null
  status?: SupplyV2InvoiceStatus | 'PENDIENTES' | null
}

export interface FacturaFila {
  id: string
  number: string
  supplierInvoiceNumber: string | null
  proveedor: string
  proveedorId: string
  documentDate: Date
  dueDate: Date | null
  currency: string
  total: string
  amountApplied: string
  amountPaid: string
  amountDue: string
  status: SupplyV2InvoiceStatus
  purchaseOrder: { id: string; number: string } | null
}

export async function listarFacturas(f: FiltroFacturas, p: Paginacion): Promise<{ filas: FacturaFila[]; total: number }> {
  const where: Prisma.SupplyV2SupplierInvoiceWhereInput = {}
  if (f.supplierId) where.supplierId = f.supplierId
  if (f.status === 'PENDIENTES') where.status = { in: ['PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_PAID'] }
  else if (f.status) where.status = f.status
  const [filas, total] = await sinEmpresa('Supply 2.0: facturas de proveedor', (tx) =>
    Promise.all([
      tx.supplyV2SupplierInvoice.findMany({
        where,
        orderBy: [{ documentDate: 'desc' }, { number: 'desc' }],
        skip: p.saltar,
        take: p.tomar,
        select: { id: true, number: true, supplierInvoiceNumber: true, documentDate: true, dueDate: true, currency: true, total: true, amountApplied: true, amountPaid: true, amountDue: true, status: true, supplier: { select: { id: true, commercialName: true } }, purchaseOrder: { select: { id: true, number: true } } },
      }),
      tx.supplyV2SupplierInvoice.count({ where }),
    ])
  )
  return {
    filas: filas.map((x) => ({ id: x.id, number: x.number, supplierInvoiceNumber: x.supplierInvoiceNumber, proveedor: x.supplier.commercialName, proveedorId: x.supplier.id, documentDate: x.documentDate, dueDate: x.dueDate, currency: x.currency, total: x.total.toFixed(2), amountApplied: x.amountApplied.toFixed(2), amountPaid: x.amountPaid.toFixed(2), amountDue: x.amountDue.toFixed(2), status: x.status, purchaseOrder: x.purchaseOrder })),
    total,
  }
}

export async function fichaFactura(id: string) {
  const f = await sinEmpresa('Supply 2.0: ficha de una factura de proveedor', (tx) =>
    tx.supplyV2SupplierInvoice.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, commercialName: true, currency: true } },
        purchaseOrder: { select: { id: true, number: true, status: true, total: true, agreementVersion: { select: { snapshot: true } } } },
        createdBy: { select: { name: true, email: true } },
        approvedBy: { select: { name: true, email: true } },
        lines: { orderBy: { createdAt: 'asc' } },
        obligations: { orderBy: { recognizedAt: 'asc' }, select: { id: true, number: true, recognitionBasis: true, grossAmount: true, paidAmount: true, outstandingAmount: true, status: true, dueAt: true } },
        applications: { orderBy: { createdAt: 'asc' }, include: { payment: { select: { id: true, number: true, method: true, reference: true } }, deposit: { select: { id: true, number: true } }, createdBy: { select: { name: true, email: true } } } },
        payments: { where: { status: 'PENDING' }, select: { id: true, number: true, amount: true, createdBy: { select: { name: true, email: true } } } },
      },
    })
  )
  if (!f) return null
  const timeline: { cuando: Date; titulo: string; detalle?: string | null; tono: 'neutral' | 'success' | 'warning' | 'info' | 'danger' }[] = [
    { cuando: f.createdAt, titulo: `Factura registrada · ${f.total.toFixed(2)}`, detalle: nombre(f.createdBy), tono: 'neutral' },
  ]
  if (f.approvedAt) timeline.push({ cuando: f.approvedAt, titulo: 'Aprobada', detalle: nombre(f.approvedBy), tono: 'info' })
  for (const a of f.applications) {
    if (a.type === 'REVERSAL') continue
    timeline.push({ cuando: a.createdAt, titulo: `${a.deposit ? `Depósito ${a.deposit.number}` : `Pago ${a.payment?.number ?? ''}`} aplicado · ${a.amount.toFixed(2)}`, detalle: a.reversedAt ? `Reversada: ${a.reversalReason}` : nombre(a.createdBy), tono: a.reversedAt ? 'warning' : 'success' })
    if (a.reversedAt) timeline.push({ cuando: a.reversedAt, titulo: `Aplicación reversada · ${a.amount.toFixed(2)}`, detalle: a.reversalReason, tono: 'warning' })
  }
  if (f.status === 'PAID') timeline.push({ cuando: f.updatedAt, titulo: 'Factura pagada', tono: 'success' })
  if (f.cancelledAt) timeline.push({ cuando: f.cancelledAt, titulo: 'Cancelada', detalle: f.cancelledReason, tono: 'danger' })
  timeline.sort((a, b) => a.cuando.getTime() - b.cuando.getTime())
  return { ...f, timeline, creadoPor: nombre(f.createdBy), aprobadoPor: nombre(f.approvedBy) }
}

// ── Depósitos (§36) ───────────────────────────────────────────────────────────

export interface DepositoFila {
  id: string
  number: string
  proveedor: string
  proveedorId: string
  currency: string
  originalAmount: string
  availableAmount: string
  appliedAmount: string
  status: string
  createdAt: Date
  paymentNumber: string | null
}

export async function listarDepositos(f: { supplierId?: string | null; status?: string | null }, p: Paginacion): Promise<{ filas: DepositoFila[]; total: number }> {
  const where: Prisma.SupplyV2SupplierDepositWhereInput = {}
  if (f.supplierId) where.supplierId = f.supplierId
  if (f.status) where.status = f.status as never
  const [filas, total] = await sinEmpresa('Supply 2.0: depósitos', (tx) =>
    Promise.all([
      tx.supplyV2SupplierDeposit.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.saltar, take: p.tomar, select: { id: true, number: true, currency: true, originalAmount: true, availableAmount: true, appliedAmount: true, status: true, createdAt: true, supplier: { select: { id: true, commercialName: true } }, payment: { select: { number: true } } } }),
      tx.supplyV2SupplierDeposit.count({ where }),
    ])
  )
  return { filas: filas.map((d) => ({ id: d.id, number: d.number, proveedor: d.supplier.commercialName, proveedorId: d.supplier.id, currency: d.currency, originalAmount: d.originalAmount.toFixed(2), availableAmount: d.availableAmount.toFixed(2), appliedAmount: d.appliedAmount.toFixed(2), status: d.status, createdAt: d.createdAt, paymentNumber: d.payment?.number ?? null })), total }
}

export async function fichaDeposito(id: string) {
  return sinEmpresa('Supply 2.0: ficha de un depósito', (tx) =>
    tx.supplyV2SupplierDeposit.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, commercialName: true } },
        payment: { select: { id: true, number: true, reference: true, paidAt: true } },
        createdBy: { select: { name: true, email: true } },
        movements: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { name: true, email: true } }, application: { select: { id: true, type: true, invoice: { select: { id: true, number: true } }, obligation: { select: { id: true, number: true } } } } } },
        applications: { where: { type: { in: ['DEPOSIT_TO_INVOICE', 'DEPOSIT_TO_OBLIGATION'] } }, orderBy: { createdAt: 'asc' }, include: { invoice: { select: { id: true, number: true } }, obligation: { select: { id: true, number: true } } } },
      },
    })
  )
}

// ── Pagos (§37) ───────────────────────────────────────────────────────────────

export interface PagoFila {
  id: string
  number: string
  proveedor: string
  proveedorId: string
  method: string
  currency: string
  amount: string
  appliedAmount: string
  paidAt: Date
  reference: string | null
  status: SupplyV2SupplierPaymentStatus
  aplicaciones: number
  creadoPor: string | null
  confirmadoPor: string | null
  intendedInvoice: { id: string; number: string } | null
  intendedDeposit: boolean
}

export async function listarPagos(f: { supplierId?: string | null; status?: SupplyV2SupplierPaymentStatus | null }, p: Paginacion): Promise<{ filas: PagoFila[]; total: number }> {
  const where: Prisma.SupplyV2SupplierPaymentWhereInput = {}
  if (f.supplierId) where.supplierId = f.supplierId
  if (f.status) where.status = f.status
  const [filas, total] = await sinEmpresa('Supply 2.0: pagos a proveedores', (tx) =>
    Promise.all([
      tx.supplyV2SupplierPayment.findMany({
        where,
        orderBy: [{ paidAt: 'desc' }, { number: 'desc' }],
        skip: p.saltar,
        take: p.tomar,
        select: { id: true, number: true, method: true, currency: true, amount: true, appliedAmount: true, paidAt: true, reference: true, status: true, intendedDeposit: true, supplier: { select: { id: true, commercialName: true } }, createdBy: { select: { name: true, email: true } }, confirmedBy: { select: { name: true, email: true } }, intendedInvoice: { select: { id: true, number: true } }, _count: { select: { applications: { where: { reversedAt: null, type: { not: 'REVERSAL' } } } } } },
      }),
      tx.supplyV2SupplierPayment.count({ where }),
    ])
  )
  return { filas: filas.map((x) => ({ id: x.id, number: x.number, proveedor: x.supplier.commercialName, proveedorId: x.supplier.id, method: x.method, currency: x.currency, amount: x.amount.toFixed(2), appliedAmount: x.appliedAmount.toFixed(2), paidAt: x.paidAt, reference: x.reference, status: x.status, aplicaciones: x._count.applications, creadoPor: nombre(x.createdBy), confirmadoPor: nombre(x.confirmedBy), intendedInvoice: x.intendedInvoice, intendedDeposit: x.intendedDeposit })), total }
}

export async function fichaPago(id: string) {
  return sinEmpresa('Supply 2.0: ficha de un pago', (tx) =>
    tx.supplyV2SupplierPayment.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, commercialName: true } },
        createdBy: { select: { name: true, email: true } },
        confirmedBy: { select: { name: true, email: true } },
        intendedInvoice: { select: { id: true, number: true } },
        intendedObligation: { select: { id: true, number: true } },
        fundedDeposit: { select: { id: true, number: true } },
        applications: { orderBy: { createdAt: 'asc' }, include: { invoice: { select: { id: true, number: true } }, obligation: { select: { id: true, number: true } }, deposit: { select: { id: true, number: true } } } },
      },
    })
  )
}

// ── Obligaciones (§38) ────────────────────────────────────────────────────────

export interface ObligacionFila {
  id: string
  number: string
  proveedor: string
  proveedorId: string
  origen: string
  recognitionBasis: string
  currency: string
  grossAmount: string
  paidAmount: string
  outstandingAmount: string
  dueAt: Date | null
  recognizedAt: Date
  status: SupplyV2ObligationStatus
  invoice: { id: string; number: string } | null
  purchaseOrder: { id: string; number: string } | null
}

export async function listarObligaciones(f: { supplierId?: string | null; status?: SupplyV2ObligationStatus | 'VIVAS' | null }, p: Paginacion): Promise<{ filas: ObligacionFila[]; total: number }> {
  const where: Prisma.SupplyV2SupplierObligationWhereInput = {}
  if (f.supplierId) where.supplierId = f.supplierId
  if (f.status === 'VIVAS') where.status = { in: [...OBLIGACION_VIVA] }
  else if (f.status) where.status = f.status
  const [filas, total] = await sinEmpresa('Supply 2.0: obligaciones', (tx) =>
    Promise.all([
      tx.supplyV2SupplierObligation.findMany({ where, orderBy: [{ recognizedAt: 'desc' }], skip: p.saltar, take: p.tomar, include: { supplier: { select: { id: true, commercialName: true } }, invoice: { select: { id: true, number: true } }, purchaseOrder: { select: { id: true, number: true } }, receipt: { select: { number: true } }, redemption: { select: { number: true } } } }),
      tx.supplyV2SupplierObligation.count({ where }),
    ])
  )
  return {
    filas: filas.map((o) => ({
      id: o.id,
      number: o.number,
      proveedor: o.supplier.commercialName,
      proveedorId: o.supplier.id,
      origen: o.sourceType === 'INVOICE' ? `Factura ${o.invoice?.number ?? ''}` : o.sourceType === 'PURCHASE_RECEIPT' ? `Recepción ${o.receipt?.number ?? ''}` : o.sourceType === 'REDEMPTION' ? `Entrega ${o.redemption?.number ?? ''}` : 'Manual',
      recognitionBasis: o.recognitionBasis,
      currency: o.currency,
      grossAmount: o.grossAmount.toFixed(2),
      paidAmount: o.paidAmount.toFixed(2),
      outstandingAmount: o.outstandingAmount.toFixed(2),
      dueAt: o.dueAt,
      recognizedAt: o.recognizedAt,
      status: o.status,
      invoice: o.invoice,
      purchaseOrder: o.purchaseOrder,
    })),
    total,
  }
}

// ── Conciliaciones (§43) ─────────────────────────────────────────────────────

export async function listarConciliaciones(f: { supplierId?: string | null }, p: Paginacion) {
  const where: Prisma.SupplyV2ReconciliationWhereInput = f.supplierId ? { supplierId: f.supplierId } : {}
  const [filas, total] = await sinEmpresa('Supply 2.0: conciliaciones', (tx) =>
    Promise.all([
      tx.supplyV2Reconciliation.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.saltar, take: p.tomar, include: { supplier: { select: { id: true, commercialName: true } }, _count: { select: { lines: true } } } }),
      tx.supplyV2Reconciliation.count({ where }),
    ])
  )
  return { filas: filas.map((r) => ({ id: r.id, number: r.number, proveedor: r.supplier.commercialName, periodStart: r.periodStart, periodEnd: r.periodEnd, status: r.status, currency: r.currency, internalAmount: r.internalAmount.toFixed(2), supplierAmount: fmt(r.supplierAmount), differenceAmount: fmt(r.differenceAmount), lineas: r._count.lines, createdAt: r.createdAt })), total }
}

export async function fichaConciliacion(id: string, p: Paginacion) {
  const r = await sinEmpresa('Supply 2.0: ficha de una conciliación', (tx) =>
    tx.supplyV2Reconciliation.findUnique({ where: { id }, include: { supplier: { select: { id: true, commercialName: true } }, createdBy: { select: { name: true, email: true } }, resolvedBy: { select: { name: true, email: true } }, _count: { select: { lines: true } } } })
  )
  if (!r) return null
  const lineas = await sinEmpresa('Supply 2.0: líneas de una conciliación', (tx) => tx.supplyV2ReconciliationLine.findMany({ where: { reconciliationId: id }, orderBy: { occurredAt: 'asc' }, skip: p.saltar, take: p.tomar }))
  return { ...r, lineas, totalLineas: r._count.lines, creadoPor: nombre(r.createdBy), resueltoPor: nombre(r.resolvedBy) }
}

// ── Perfil financiero del proveedor (§34) ────────────────────────────────────

export interface HitoFinanciero {
  cuando: Date
  titulo: string
  detalle?: string | null
  monto?: string | null
  href?: string | null
  tono: 'neutral' | 'success' | 'warning' | 'info' | 'danger'
}

export interface PerfilFinanciero {
  saldoAPagar: string
  facturasPendientes: number
  facturasPendientesMonto: string
  depositoDisponible: string
  pagadoHistorico: string
  supplyAdquirido: string
  unidadesAdquiridas: number
  currency: string
  timeline: HitoFinanciero[]
}

export async function perfilFinancieroProveedor(supplierId: string, limiteTimeline = 30): Promise<PerfilFinanciero | null> {
  return sinEmpresa('Supply 2.0: perfil financiero del proveedor', async (tx) => {
    const s = await tx.supplyV2Supplier.findUnique({ where: { id: supplierId }, select: { id: true, currency: true } })
    if (!s) return null
    const [cxp, pendientes, depositos, pagado, lotes, facturas, pagos, deps, apps, obligaciones] = await Promise.all([
      tx.supplyV2SupplierObligation.aggregate({ where: { supplierId, status: { in: [...OBLIGACION_VIVA] } }, _sum: { outstandingAmount: true } }),
      tx.supplyV2SupplierInvoice.aggregate({ where: { supplierId, status: { in: ['APPROVED', 'PARTIALLY_PAID'] } }, _sum: { amountDue: true }, _count: { _all: true } }),
      tx.supplyV2SupplierDeposit.aggregate({ where: { supplierId, status: 'ACTIVE' }, _sum: { availableAmount: true } }),
      tx.supplyV2SupplierPayment.aggregate({ where: { supplierId, status: 'CONFIRMED' }, _sum: { amount: true } }),
      tx.supplyV2Lot.findMany({ where: { supplierId }, select: { quantityReceived: true, unitCost: true } }),
      tx.supplyV2SupplierInvoice.findMany({ where: { supplierId }, orderBy: { createdAt: 'desc' }, take: limiteTimeline, select: { id: true, number: true, total: true, status: true, createdAt: true, approvedAt: true, cancelledAt: true } }),
      tx.supplyV2SupplierPayment.findMany({ where: { supplierId, status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' }, take: limiteTimeline, select: { id: true, number: true, amount: true, status: true, method: true, paidAt: true, confirmedAt: true, createdAt: true, intendedDeposit: true } }),
      tx.supplyV2SupplierDeposit.findMany({ where: { supplierId }, orderBy: { createdAt: 'desc' }, take: limiteTimeline, select: { id: true, number: true, originalAmount: true, createdAt: true } }),
      tx.supplyV2PaymentApplication.findMany({ where: { OR: [{ payment: { supplierId } }, { deposit: { supplierId } }], type: { not: 'REVERSAL' } }, orderBy: { createdAt: 'desc' }, take: limiteTimeline, select: { id: true, type: true, amount: true, createdAt: true, reversedAt: true, reversalReason: true, invoice: { select: { id: true, number: true } }, obligation: { select: { number: true } }, deposit: { select: { number: true } }, payment: { select: { number: true } } } }),
      tx.supplyV2SupplierObligation.findMany({ where: { supplierId, sourceType: { not: 'INVOICE' } }, orderBy: { recognizedAt: 'desc' }, take: limiteTimeline, select: { id: true, number: true, grossAmount: true, recognitionBasis: true, recognizedAt: true, status: true } }),
    ])
    const timeline: HitoFinanciero[] = []
    for (const f of facturas) {
      timeline.push({ cuando: f.createdAt, titulo: `Factura ${f.number}`, monto: f.total.toFixed(2), href: `/superadmin/supply-v2/finanzas/facturas/${f.id}`, tono: f.status === 'CANCELLED' ? 'danger' : 'neutral', detalle: f.status === 'CANCELLED' ? 'Cancelada' : null })
      if (f.status === 'PAID') timeline.push({ cuando: f.approvedAt ?? f.createdAt, titulo: `Factura ${f.number} pagada`, href: `/superadmin/supply-v2/finanzas/facturas/${f.id}`, tono: 'success' })
    }
    for (const p of pagos) timeline.push({ cuando: p.confirmedAt ?? p.createdAt, titulo: p.intendedDeposit ? `Anticipo ${p.number}` : `Transferencia ${p.number}`, detalle: p.status === 'PENDING' ? 'Pendiente de confirmar' : null, monto: p.amount.toFixed(2), href: `/superadmin/supply-v2/finanzas/pagos/${p.id}`, tono: p.status === 'PENDING' ? 'warning' : 'success' })
    for (const d of deps) timeline.push({ cuando: d.createdAt, titulo: `Depósito ${d.number}`, monto: d.originalAmount.toFixed(2), href: `/superadmin/supply-v2/finanzas/depositos/${d.id}`, tono: 'info' })
    for (const a of apps) {
      if (a.type === 'PAYMENT_TO_DEPOSIT') continue
      const origen = a.deposit ? `Aplicación depósito ${a.deposit.number}` : `Pago ${a.payment?.number ?? ''} aplicado`
      const destino = a.invoice ? `a la factura ${a.invoice.number}` : `a la obligación ${a.obligation?.number ?? ''}`
      timeline.push({ cuando: a.createdAt, titulo: `${origen} ${destino}`, monto: a.amount.toFixed(2), href: a.invoice ? `/superadmin/supply-v2/finanzas/facturas/${a.invoice.id}` : null, tono: a.reversedAt ? 'warning' : 'info', detalle: a.reversedAt ? `Reversada: ${a.reversalReason}` : null })
    }
    for (const o of obligaciones) timeline.push({ cuando: o.recognizedAt, titulo: `Obligación ${o.number} (${o.recognitionBasis})`, monto: o.grossAmount.toFixed(2), tono: o.status === 'CANCELLED' ? 'danger' : 'neutral', detalle: o.status === 'CANCELLED' ? 'Cancelada' : null, href: '/superadmin/supply-v2/finanzas/obligaciones' })
    timeline.sort((a, b) => a.cuando.getTime() - b.cuando.getTime())
    return {
      saldoAPagar: (cxp._sum.outstandingAmount ?? CERO).toFixed(2),
      facturasPendientes: pendientes._count._all ?? 0,
      facturasPendientesMonto: (pendientes._sum.amountDue ?? CERO).toFixed(2),
      depositoDisponible: (depositos._sum.availableAmount ?? CERO).toFixed(2),
      pagadoHistorico: (pagado._sum.amount ?? CERO).toFixed(2),
      supplyAdquirido: lotes.reduce((t, l) => t.plus(l.unitCost.times(l.quantityReceived)), CERO).toFixed(2),
      unidadesAdquiridas: lotes.reduce((t, l) => t + l.quantityReceived, 0),
      currency: s.currency,
      timeline: timeline.slice(-limiteTimeline),
    }
  })
}

// ── Timeline financiero de la orden (§61) ────────────────────────────────────

export async function timelineFinancieroOrden(purchaseOrderId: string): Promise<HitoFinanciero[]> {
  return sinEmpresa('Supply 2.0: timeline financiero de una orden', async (tx) => {
    const o = await tx.supplyV2PurchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      select: {
        number: true,
        total: true,
        events: { where: { type: { in: ['CREATED', 'APPROVED'] } }, orderBy: { createdAt: 'asc' }, select: { type: true, createdAt: true } },
        invoices: { where: { status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'asc' }, select: { id: true, number: true, total: true, status: true, createdAt: true, approvedAt: true, applications: { where: { reversedAt: null, type: { not: 'REVERSAL' } }, orderBy: { createdAt: 'asc' }, select: { amount: true, createdAt: true, type: true, payment: { select: { number: true } }, deposit: { select: { number: true } } } } } },
        obligations: { where: { sourceType: 'PURCHASE_RECEIPT' }, orderBy: { recognizedAt: 'asc' }, select: { number: true, grossAmount: true, recognizedAt: true, status: true } },
        receipts: { orderBy: { receivedAt: 'asc' }, select: { number: true, receivedAt: true, lines: { select: { quantity: true } } } },
      },
    })
    if (!o) return []
    const hitos: HitoFinanciero[] = []
    for (const e of o.events) hitos.push({ cuando: e.createdAt, titulo: e.type === 'CREATED' ? `PO creada · ${o.total.toFixed(2)}` : 'Aprobada', tono: e.type === 'CREATED' ? 'neutral' : 'info' })
    for (const f of o.invoices) {
      hitos.push({ cuando: f.createdAt, titulo: `Factura proveedor ${f.number} · ${f.total.toFixed(2)}`, detalle: f.status === 'PENDING_APPROVAL' ? 'Pendiente de aprobación' : null, href: `/superadmin/supply-v2/finanzas/facturas/${f.id}`, tono: 'neutral' })
      for (const a of f.applications) hitos.push({ cuando: a.createdAt, titulo: `${a.deposit ? `Depósito ${a.deposit.number} aplicado` : `Pago ${a.payment?.number ?? ''}`} · ${a.amount.toFixed(2)}`, href: `/superadmin/supply-v2/finanzas/facturas/${f.id}`, tono: 'success' })
      if (f.status === 'PAID') hitos.push({ cuando: f.applications.at(-1)?.createdAt ?? f.createdAt, titulo: `Factura ${f.number} pagada`, tono: 'success' })
    }
    for (const ob of o.obligations) hitos.push({ cuando: ob.recognizedAt, titulo: `Obligación ${ob.number} por recepción · ${ob.grossAmount.toFixed(2)}`, detalle: ob.status === 'PAID' ? 'Pagada' : ob.status === 'CANCELLED' ? 'Cancelada' : 'Pendiente', tono: 'warning' })
    for (const r of o.receipts) hitos.push({ cuando: r.receivedAt, titulo: `Recepción ${r.number} · ${r.lines.reduce((t, l) => t + l.quantity, 0).toLocaleString('es-DO')} unidades`, detalle: 'Supply recibido', tono: 'success' })
    return hitos.sort((a, b) => a.cuando.getTime() - b.cuando.getTime())
  })
}

// ── Catálogos para formularios ───────────────────────────────────────────────

export async function proveedoresParaFinanzas() {
  return sinEmpresa('Supply 2.0: proveedores para finanzas', (tx) => tx.supplyV2Supplier.findMany({ where: { status: 'ACTIVE' }, orderBy: { commercialName: 'asc' }, select: { id: true, commercialName: true, currency: true } }))
}

/** Órdenes aprobadas (o más) con líneas y cuánto queda por facturar en cada una. */
export async function ordenesFacturables(supplierId?: string | null) {
  return sinEmpresa('Supply 2.0: órdenes facturables', async (tx) => {
    const ordenes = await tx.supplyV2PurchaseOrder.findMany({
      where: { status: { notIn: ['DRAFT', 'PENDING_APPROVAL', 'CANCELLED'] }, ...(supplierId ? { supplierId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, number: true, supplierId: true, currency: true, taxRate: true, total: true, supplier: { select: { commercialName: true } }, lines: { select: { id: true, descriptionSnapshot: true, quantity: true, unitCost: true, invoiceLines: { where: { invoice: { status: { not: 'CANCELLED' } } }, select: { quantity: true } } } } },
    })
    return ordenes
      .map((o) => ({
        id: o.id,
        number: o.number,
        supplierId: o.supplierId,
        proveedor: o.supplier.commercialName,
        currency: o.currency,
        taxRate: o.taxRate.toString(),
        total: o.total.toFixed(2),
        lines: o.lines.map((l) => ({ id: l.id, descripcion: l.descriptionSnapshot, quantity: l.quantity, unitCost: l.unitCost.toFixed(2), porFacturar: l.quantity - l.invoiceLines.reduce((t, x) => t + x.quantity, 0) })),
      }))
      .filter((o) => o.lines.some((l) => l.porFacturar > 0))
  })
}

export async function depositosActivosDe(supplierId: string) {
  return sinEmpresa('Supply 2.0: depósitos activos de un proveedor', (tx) => tx.supplyV2SupplierDeposit.findMany({ where: { supplierId, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, select: { id: true, number: true, availableAmount: true, currency: true } }))
}

export async function pagosConSaldoDe(supplierId: string) {
  const filas = await sinEmpresa('Supply 2.0: pagos confirmados con saldo sin aplicar', (tx) => tx.supplyV2SupplierPayment.findMany({ where: { supplierId, status: 'CONFIRMED' }, orderBy: { paidAt: 'asc' }, select: { id: true, number: true, amount: true, appliedAmount: true, currency: true, reference: true } }))
  return filas.filter((p) => p.amount.greaterThan(p.appliedAmount)).map((p) => ({ id: p.id, number: p.number, sinAplicar: p.amount.minus(p.appliedAmount).toFixed(2), currency: p.currency, reference: p.reference }))
}
