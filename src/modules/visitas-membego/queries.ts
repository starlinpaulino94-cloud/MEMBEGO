import type { AncillaryCommissionStatus, AncillaryEvidenceLevel, AncillarySaleStatus, MembegoVisitOrigin, MembegoVisitStatus, Prisma, VisitDisputeStatus } from '@prisma/client'
import { conEmpresa, sinEmpresa, type Tx } from '@/lib/tenant'
import { finDeVentana } from './domain'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · lecturas de las visitas atribuidas.
 * Proveedor (su empresa), cliente (las suyas) y superadmin (todas).
 * Nunca costos de Supply ni saldos internos de la empresa.
 */

export interface VentaDeVisita {
  id: string
  number: string
  status: AncillarySaleStatus
  evidenceLevel: AncillaryEvidenceLevel
  subtotal: string
  commissionAmount: string
  commissionRate: string
  commissionStatus: AncillaryCommissionStatus
  hasCustomLines: boolean
  reportedAt: Date
  reportedBy: string
  lineas: { description: string; quantity: number; unitPrice: string; lineTotal: string; kind: 'CATALOG_ITEM' | 'CUSTOM_REPORTED_LINE' }[]
  disputa: { id: string; status: VisitDisputeStatus } | null
}

export interface VisitaDetalle {
  id: string
  number: string
  status: MembegoVisitStatus
  origin: MembegoVisitOrigin
  companyId: string
  empresa: string
  sucursal: string | null
  cliente: string
  customerUserId: string
  openedAt: Date
  closedAt: Date | null
  ventanaHasta: Date
  incluido: { producto: string; cantidad: number; redemptionNumber: string } | null
  politica: { enabled: boolean; rate: string; windowMinutes: number; requiresCustomerConfirmation: boolean; receiptRequiredAbove: string | null }
  ancillaryTotal: string
  commissionTotal: string
  currency: string
  customerConfirmedAt: Date | null
  ventas: VentaDeVisita[]
  disputas: { id: string; status: VisitDisputeStatus; customerClaim: string; claimedTotal: string | null; reportedTotal: string; resolution: string | null; openedAt: Date; resolvedAt: Date | null; saleId: string | null }[]
}

const nombre = (u: { name: string | null; email: string }) => u.name?.trim() || u.email.split('@')[0]!

const INCLUDE_DETALLE = {
  company: { select: { name: true } },
  location: { select: { nombre: true } },
  customer: { select: { name: true, email: true } },
  redemption: { select: { number: true, quantity: true, catalogItem: { select: { name: true } } } },
  sales: { orderBy: { reportedAt: 'asc' as const }, include: { lines: true, reportedBy: { select: { name: true, email: true } }, dispute: { select: { id: true, status: true } } } },
  disputes: { orderBy: { openedAt: 'desc' as const } },
}

function aDetalle(v: NonNullable<Awaited<ReturnType<typeof leerDetalle>>>): VisitaDetalle {
  return {
    id: v.id,
    number: v.number,
    status: v.status,
    origin: v.origin,
    companyId: v.companyId,
    empresa: v.company.name,
    sucursal: v.location?.nombre ?? null,
    cliente: nombre(v.customer),
    customerUserId: v.customerUserId,
    openedAt: v.openedAt,
    closedAt: v.closedAt,
    ventanaHasta: finDeVentana(v.openedAt, { attributionWindowMinutes: v.attributionWindowMinutes }),
    incluido: v.redemption ? { producto: v.redemption.catalogItem.name, cantidad: v.redemption.quantity, redemptionNumber: v.redemption.number } : null,
    politica: { enabled: v.ancillaryCommissionEnabled, rate: v.ancillaryCommissionRate.toFixed(2), windowMinutes: v.attributionWindowMinutes, requiresCustomerConfirmation: v.requiresCustomerConfirmation, receiptRequiredAbove: v.receiptRequiredAbove?.toFixed(2) ?? null },
    ancillaryTotal: v.ancillaryTotal.toFixed(2),
    commissionTotal: v.commissionTotal.toFixed(2),
    currency: v.currency,
    customerConfirmedAt: v.customerConfirmedAt,
    ventas: v.sales.map((s) => ({
      id: s.id,
      number: s.number,
      status: s.status,
      evidenceLevel: s.evidenceLevel,
      subtotal: s.subtotal.toFixed(2),
      commissionAmount: s.commissionAmount.toFixed(2),
      commissionRate: s.commissionRate.toFixed(2),
      commissionStatus: s.commissionStatus,
      hasCustomLines: s.hasCustomLines,
      reportedAt: s.reportedAt,
      reportedBy: nombre(s.reportedBy),
      lineas: s.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice.toFixed(2), lineTotal: l.lineTotal.toFixed(2), kind: l.kind })),
      disputa: s.dispute ? { id: s.dispute.id, status: s.dispute.status } : null,
    })),
    disputas: v.disputes.map((d) => ({ id: d.id, status: d.status, customerClaim: d.customerClaim, claimedTotal: d.claimedTotal?.toFixed(2) ?? null, reportedTotal: d.reportedTotal.toFixed(2), resolution: d.resolution, openedAt: d.openedAt, resolvedAt: d.resolvedAt, saleId: d.saleId })),
  }
}

async function leerDetalle(tx: Tx, where: { id: string; companyId?: string; customerUserId?: string }) {
  return tx.membegoVisit.findFirst({ where, include: INCLUDE_DETALLE })
}

/** Proveedor/empresa: una visita de SU empresa. */
export async function visitaDeLaEmpresa(companyId: string, visitId: string): Promise<VisitaDetalle | null> {
  const v = await conEmpresa(companyId, (tx) => leerDetalle(tx, { id: visitId, companyId }))
  return v ? aDetalle(v) : null
}

/** Cliente: una visita SUYA. */
export async function miVisita(customerUserId: string, visitId: string): Promise<VisitaDetalle | null> {
  const v = await sinEmpresa('Visitas Membego: el cliente ve su propia visita', (tx) => leerDetalle(tx, { id: visitId, customerUserId }))
  return v ? aDetalle(v) : null
}

/** Superadmin: cualquier visita. */
export async function visitaParaPlataforma(visitId: string): Promise<VisitaDetalle | null> {
  const v = await sinEmpresa('Visitas Membego: superadmin', (tx) => leerDetalle(tx, { id: visitId }))
  return v ? aDetalle(v) : null
}

export interface VisitaEnLista {
  id: string
  number: string
  status: MembegoVisitStatus
  origin: MembegoVisitOrigin
  empresa: string
  cliente: string
  openedAt: Date
  closedAt: Date | null
  incluido: string | null
  ancillaryTotal: string
  commissionTotal: string
  currency: string
  ventas: number
  disputasAbiertas: number
  customerConfirmedAt: Date | null
}

const SELECT_LISTA = {
  id: true, number: true, status: true, origin: true, openedAt: true, closedAt: true, ancillaryTotal: true, commissionTotal: true, currency: true, customerConfirmedAt: true,
  company: { select: { name: true } },
  customer: { select: { name: true, email: true } },
  redemption: { select: { catalogItem: { select: { name: true } } } },
  _count: { select: { sales: true, disputes: { where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } } } },
} satisfies Prisma.MembegoVisitSelect

type FilaLista = { id: string; number: string; status: MembegoVisitStatus; origin: MembegoVisitOrigin; openedAt: Date; closedAt: Date | null; ancillaryTotal: { toFixed(n: number): string }; commissionTotal: { toFixed(n: number): string }; currency: string; customerConfirmedAt: Date | null; company: { name: string }; customer: { name: string | null; email: string }; redemption: { catalogItem: { name: string } } | null; _count: { sales: number; disputes: number } }

const aLista = (v: FilaLista): VisitaEnLista => ({
  id: v.id, number: v.number, status: v.status, origin: v.origin, empresa: v.company.name, cliente: nombre(v.customer), openedAt: v.openedAt, closedAt: v.closedAt,
  incluido: v.redemption?.catalogItem.name ?? null, ancillaryTotal: v.ancillaryTotal.toFixed(2), commissionTotal: v.commissionTotal.toFixed(2), currency: v.currency,
  ventas: v._count.sales, disputasAbiertas: v._count.disputes, customerConfirmedAt: v.customerConfirmedAt,
})

export async function visitasDeLaEmpresa(companyId: string, f: { dias?: number; soloConVentas?: boolean } = {}, limite = 200): Promise<VisitaEnLista[]> {
  const desde = f.dias != null ? new Date(Date.now() - f.dias * 86_400_000) : undefined
  const filas = await conEmpresa(companyId, (tx) =>
    tx.membegoVisit.findMany({ where: { companyId, ...(desde ? { openedAt: { gte: desde } } : {}), ...(f.soloConVentas ? { sales: { some: {} } } : {}) }, orderBy: { openedAt: 'desc' }, take: limite, select: SELECT_LISTA })
  )
  return filas.map(aLista)
}

export async function visitasDeLaPlataforma(f: { estado?: MembegoVisitStatus; soloDisputas?: boolean; empresaId?: string } = {}, limite = 200): Promise<VisitaEnLista[]> {
  const filas = await sinEmpresa('Visitas Membego: panorama del superadmin', (tx) =>
    tx.membegoVisit.findMany({
      where: { ...(f.estado ? { status: f.estado } : {}), ...(f.empresaId ? { companyId: f.empresaId } : {}), ...(f.soloDisputas ? { disputes: { some: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } } } : {}) },
      orderBy: { openedAt: 'desc' },
      take: limite,
      select: SELECT_LISTA,
    })
  )
  return filas.map(aLista)
}

export async function misVisitas(customerUserId: string, limite = 50): Promise<VisitaEnLista[]> {
  const filas = await sinEmpresa('Visitas Membego: las visitas del cliente', (tx) => tx.membegoVisit.findMany({ where: { customerUserId }, orderBy: { openedAt: 'desc' }, take: limite, select: SELECT_LISTA }))
  return filas.map(aLista)
}

/** Resumen de ventas adicionales y comisión de la empresa para el portal (§30). */
export async function resumenDeExtrasDeLaEmpresa(companyId: string, dias = 30): Promise<{ visitas: number; conExtras: number; ventas: number; extrasTotal: string; comisionTotal: string; confirmadas: number; disputasAbiertas: number; currency: string }> {
  const desde = new Date(Date.now() - dias * 86_400_000)
  return conEmpresa(companyId, async (tx) => {
    const [visitas, conExtras, ventas, disputasAbiertas, agregados, cuenta] = await Promise.all([
      tx.membegoVisit.count({ where: { companyId, openedAt: { gte: desde } } }),
      tx.membegoVisit.count({ where: { companyId, openedAt: { gte: desde }, ancillaryTotal: { gt: 0 } } }),
      tx.ancillarySale.count({ where: { companyId, reportedAt: { gte: desde }, status: { not: 'REVERSED' } } }),
      tx.visitDispute.count({ where: { companyId, status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
      tx.ancillarySale.aggregate({ where: { companyId, reportedAt: { gte: desde }, status: { not: 'REVERSED' } }, _sum: { subtotal: true } }),
      tx.merchantBillingConfig.findUnique({ where: { companyId }, select: { currency: true } }),
    ])
    const confirmadas = await tx.ancillarySale.count({ where: { companyId, reportedAt: { gte: desde }, status: { not: 'REVERSED' }, customerConfirmedAt: { not: null } } })
    const comision = await tx.merchantLedgerEntry.aggregate({ where: { companyId, referenceType: 'ANCILLARY_SALE', createdAt: { gte: desde } }, _sum: { amount: true } })
    return {
      visitas, conExtras, ventas, confirmadas, disputasAbiertas,
      extrasTotal: (agregados._sum.subtotal ?? 0).toFixed(2),
      comisionTotal: (comision._sum.amount ?? 0).toFixed(2),
      currency: cuenta?.currency ?? 'DOP',
    }
  })
}

/** El mini catálogo del proveedor: lo que puede vender como extra (§26). */
export async function extrasDelProveedor(supplierId: string): Promise<{ id: string; name: string; price: string | null; activo: boolean; sellableAsExtra: boolean; catalogItemId: string | null; deMembego: boolean }[]> {
  const filas = await sinEmpresa('Visitas Membego: mini catálogo del proveedor', (tx) =>
    tx.supplyV2CatalogItem.findMany({
      where: { supplierId, status: { not: 'ARCHIVED' }, OR: [{ sellableAsExtra: true }, { agreements: { some: { status: 'ACTIVE' } } }] },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, publicPrice: true, status: true, sellableAsExtra: true, catalogItemId: true, _count: { select: { agreements: { where: { status: 'ACTIVE' } } } } },
    })
  )
  return filas.map((f) => ({ id: f.id, name: f.name, price: f.publicPrice?.toFixed(2) ?? null, activo: f.status === 'ACTIVE', sellableAsExtra: f.sellableAsExtra, catalogItemId: f.catalogItemId, deMembego: f._count.agreements > 0 }))
}
