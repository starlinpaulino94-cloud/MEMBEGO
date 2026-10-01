import 'server-only'

import { Prisma } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { estadoSesionQr, type EstadoSesionQr } from './domain'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 3 · lecturas.
 *
 * Tres públicos, tres DTOs:
 *   · PROVEEDOR (§14, §35): sus entregas e incidencias, sin costos.
 *   · SUPERADMIN (§34, §63–§65): trazabilidad completa, con costos.
 *   · POOL: unidades redimidas (en `pool/queries.ts`).
 * Todas filtran en la consulta por el proveedor o el cliente que decide el
 * servidor; nadie recibe el modelo Prisma completo.
 */

const DIA = 86_400_000
export type VentanaDias = 0 | 7 | 30

function desdeDias(dias: VentanaDias, ahora = new Date()): Date {
  if (dias === 0) {
    const d = new Date(ahora)
    d.setHours(0, 0, 0, 0)
    return d
  }
  return new Date(ahora.getTime() - dias * DIA)
}

function nombre(u: { name: string | null; email: string }): string {
  return u.name?.trim() || u.email.split('@')[0]!
}

// ── Proveedor ────────────────────────────────────────────────────────────────

export interface EntregaProveedor {
  id: string
  number: string
  redeemedAt: Date
  cliente: string
  producto: string
  sucursal: string | null
  empleado: string
  reversada: boolean
}

export async function entregasDelProveedor(supplierId: string, dias: VentanaDias = 0): Promise<EntregaProveedor[]> {
  const filas = await sinEmpresa('Supply 2.0: entregas del proveedor de la sesión', (tx) =>
    tx.supplyV2Redemption.findMany({
      where: { supplierId, redeemedAt: { gte: desdeDias(dias) } },
      orderBy: { redeemedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        number: true,
        redeemedAt: true,
        reversedAt: true,
        customer: { select: { name: true, email: true } },
        catalogItem: { select: { name: true } },
        branch: { select: { nombre: true } },
        employee: { select: { name: true, email: true } },
      },
    })
  )
  return filas.map((r) => ({
    id: r.id,
    number: r.number,
    redeemedAt: r.redeemedAt,
    cliente: nombre(r.customer),
    producto: r.catalogItem.name,
    sucursal: r.branch?.nombre ?? null,
    empleado: nombre(r.employee),
    reversada: r.reversedAt !== null,
  }))
}

export interface IncidenciaProveedor {
  id: string
  createdAt: Date
  type: string
  notes: string | null
  sucursal: string | null
  empleado: string
}

export async function incidenciasDelProveedor(supplierId: string, dias: VentanaDias = 0): Promise<IncidenciaProveedor[]> {
  const filas = await sinEmpresa('Supply 2.0: incidencias del proveedor de la sesión', (tx) =>
    tx.supplyV2RedemptionIncident.findMany({
      where: { supplierId, createdAt: { gte: desdeDias(dias) } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, createdAt: true, type: true, notes: true, branch: { select: { nombre: true } }, employee: { select: { name: true, email: true } } },
    })
  )
  return filas.map((i) => ({ id: i.id, createdAt: i.createdAt, type: i.type, notes: i.notes, sucursal: i.branch?.nombre ?? null, empleado: nombre(i.employee) }))
}

export interface ResumenProveedor {
  entregasHoy: number
  incidenciasHoy: number
  /** Beneficios vendidos de este proveedor que todavía no se han entregado. */
  pendientes: number
}

export async function resumenProveedor(supplierId: string): Promise<ResumenProveedor> {
  const hoy = desdeDias(0)
  const [entregasHoy, incidenciasHoy, pendientes] = await sinEmpresa('Supply 2.0: resumen del proveedor de la sesión', (tx) =>
    Promise.all([
      tx.supplyV2Redemption.count({ where: { supplierId, redeemedAt: { gte: hoy }, reversedAt: null } }),
      tx.supplyV2RedemptionIncident.count({ where: { supplierId, createdAt: { gte: hoy } } }),
      tx.supplyV2Entitlement.count({ where: { supplierId, status: 'ACTIVE' } }),
    ])
  )
  return { entregasHoy, incidenciasHoy, pendientes }
}

// ── Superadmin ───────────────────────────────────────────────────────────────

export interface FiltroRedenciones {
  supplierId?: string | null
  estado?: 'ENTREGADA' | 'REVERSADA' | null
  desde?: Date | null
  hasta?: Date | null
}

export interface RedencionFila {
  id: string
  number: string
  redeemedAt: Date
  cliente: string
  producto: string
  proveedor: string
  sucursal: string | null
  empleado: string
  reversada: boolean
}

export async function listarRedenciones(f: FiltroRedenciones = {}): Promise<RedencionFila[]> {
  const where: Prisma.SupplyV2RedemptionWhereInput = {}
  if (f.supplierId) where.supplierId = f.supplierId
  if (f.estado === 'ENTREGADA') where.reversedAt = null
  if (f.estado === 'REVERSADA') where.reversedAt = { not: null }
  if (f.desde || f.hasta) where.redeemedAt = { ...(f.desde ? { gte: f.desde } : {}), ...(f.hasta ? { lte: f.hasta } : {}) }
  const filas = await sinEmpresa('Supply 2.0: redenciones (plataforma)', (tx) =>
    tx.supplyV2Redemption.findMany({
      where,
      orderBy: { redeemedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        number: true,
        redeemedAt: true,
        reversedAt: true,
        customer: { select: { name: true, email: true } },
        catalogItem: { select: { name: true } },
        supplier: { select: { commercialName: true } },
        branch: { select: { nombre: true } },
        employee: { select: { name: true, email: true } },
      },
    })
  )
  return filas.map((r) => ({
    id: r.id,
    number: r.number,
    redeemedAt: r.redeemedAt,
    cliente: nombre(r.customer),
    producto: r.catalogItem.name,
    proveedor: r.supplier.commercialName,
    sucursal: r.branch?.nombre ?? null,
    empleado: nombre(r.employee),
    reversada: r.reversedAt !== null,
  }))
}

export async function proveedoresConRedenciones(): Promise<{ id: string; nombre: string }[]> {
  const grupos = await sinEmpresa('Supply 2.0: proveedores con redenciones', (tx) =>
    tx.supplyV2Supplier.findMany({ where: { redemptions: { some: {} } }, select: { id: true, commercialName: true }, orderBy: { commercialName: 'asc' } })
  )
  return grupos.map((g) => ({ id: g.id, nombre: g.commercialName }))
}

export interface HitoTimeline {
  cuando: Date
  titulo: string
  detalle?: string | null
}

/** Ficha INTERNA de una redención (§34, §56–§57, §65): con costos, lote y toda la cadena. */
export async function fichaRedencion(id: string) {
  const r = await sinEmpresa('Supply 2.0: ficha de una redención (plataforma)', (tx) =>
    tx.supplyV2Redemption.findUnique({
      where: { id },
      select: {
        id: true,
        number: true,
        redeemedAt: true,
        reversedAt: true,
        reversalReason: true,
        channel: true,
        deviceInfo: true,
        quantity: true,
        unitCostSnapshot: true,
        customerUnitPriceSnapshot: true,
        customerPaysMerchant: true,
        currency: true,
        sourceType: true,
        commissionPercentageSnapshot: true,
        commissionAmountSnapshot: true,
        supplierNetSnapshot: true,
        customer: { select: { id: true, name: true, email: true } },
        supplier: { select: { id: true, commercialName: true } },
        catalogItem: { select: { id: true, name: true } },
        branch: { select: { id: true, nombre: true } },
        employee: { select: { id: true, name: true, email: true } },
        reversedBy: { select: { name: true, email: true } },
        lot: { select: { id: true, code: true } },
        voucher: { select: { id: true, status: true, createdAt: true } },
        qrSession: { select: { id: true, createdAt: true, expiresAt: true, consumedAt: true, branch: { select: { nombre: true } } } },
        entitlement: {
          select: {
            id: true,
            status: true,
            issuedAt: true,
            expiresAt: true,
            offer: { select: { id: true, code: true, title: true } },
            order: { select: { id: true, number: true, createdAt: true, paymentSubmittedAt: true, paidAt: true } },
            vouchers: { select: { id: true, status: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
            redemptions: { select: { id: true, number: true, redeemedAt: true, reversedAt: true }, orderBy: { redeemedAt: 'asc' } },
          },
        },
      },
    })
  )
  if (!r) return null
  const o = r.entitlement.order
  const timeline: HitoTimeline[] = [{ cuando: o.createdAt, titulo: 'Orden creada', detalle: o.number }]
  if (o.paymentSubmittedAt) timeline.push({ cuando: o.paymentSubmittedAt, titulo: 'Pago enviado' })
  if (o.paidAt) timeline.push({ cuando: o.paidAt, titulo: 'Pago confirmado' })
  timeline.push({ cuando: r.entitlement.issuedAt, titulo: 'Derecho emitido' })
  for (const v of r.entitlement.vouchers) timeline.push({ cuando: v.createdAt, titulo: 'Voucher emitido' })
  timeline.push({ cuando: r.qrSession.createdAt, titulo: 'QR generado', detalle: r.qrSession.branch?.nombre ? `para ${r.qrSession.branch.nombre}` : null })
  if (r.qrSession.consumedAt) timeline.push({ cuando: r.qrSession.consumedAt, titulo: 'QR escaneado' })
  timeline.push({ cuando: r.redeemedAt, titulo: 'Entregado', detalle: `${r.number} · ${nombre(r.employee)}${r.branch ? ` · ${r.branch.nombre}` : ''}` })
  if (r.reversedAt) {
    timeline.push({ cuando: r.reversedAt, titulo: 'Reversada', detalle: r.reversalReason })
    timeline.push({ cuando: r.reversedAt, titulo: 'Beneficio activo de nuevo' })
  }
  timeline.sort((a, b) => a.cuando.getTime() - b.cuando.getTime())
  return {
    ...r,
    clienteNombre: nombre(r.customer),
    empleadoNombre: nombre(r.employee),
    reversadaPor: r.reversedBy ? nombre(r.reversedBy) : null,
    timeline,
  }
}

// ── Cliente ──────────────────────────────────────────────────────────────────

export interface SesionQrCliente {
  id: string
  nonce: string
  expiresAt: Date
  estado: EstadoSesionQr
}

/** Las sesiones QR vivas del cliente, por derecho (para volver a mostrar el QR al recargar). */
export async function sesionesQrVivasDelCliente(customerId: string): Promise<Map<string, SesionQrCliente>> {
  const filas = await sinEmpresa('Supply 2.0: sesiones QR vivas del cliente de la sesión', (tx) =>
    tx.supplyV2QrSession.findMany({
      where: { openedByCustomerId: customerId, consumedAt: null, expiresAt: { gt: new Date() }, voucher: { customerId, status: 'ACTIVE' } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, nonce: true, expiresAt: true, consumedAt: true, voucher: { select: { entitlementId: true } } },
    })
  )
  const m = new Map<string, SesionQrCliente>()
  for (const s of filas) if (!m.has(s.voucher.entitlementId)) m.set(s.voucher.entitlementId, { id: s.id, nonce: s.nonce, expiresAt: s.expiresAt, estado: estadoSesionQr(s) })
  return m
}

// ── Slice 5 · portal del proveedor: ventas Membego y liquidaciones (§58–§61) ─

export interface ResumenVentasProveedor {
  currency: string
  /** Derechos a comisión vendidos (pagados por el cliente) que todavía no se han entregado. */
  pendientesDeEntrega: number
  entregadas: number
  /** Neto del proveedor por entregas hechas y aún no pagadas. */
  montoPendienteDePago: string
  /** Neto del proveedor ya pagado (histórico). */
  montoPagado: string
  liquidacionesAbiertas: number
}

export async function resumenVentasProveedor(supplierId: string): Promise<ResumenVentasProveedor> {
  return sinEmpresa('Supply 2.0: resumen de ventas a comisión del proveedor', async (tx) => {
    const [s, pendientes, entregadas, deuda, pagado, liq] = await Promise.all([
      tx.supplyV2Supplier.findUniqueOrThrow({ where: { id: supplierId }, select: { currency: true } }),
      tx.supplyV2Entitlement.count({ where: { supplierId, sourceType: 'COMMISSION', status: 'ACTIVE' } }),
      tx.supplyV2Entitlement.count({ where: { supplierId, sourceType: 'COMMISSION', status: 'REDEEMED' } }),
      tx.supplyV2SupplierObligation.aggregate({ where: { supplierId, status: { in: ['OPEN', 'PARTIALLY_PAID'] }, redemption: { sourceType: 'COMMISSION' } }, _sum: { outstandingAmount: true } }),
      tx.supplyV2SupplierObligation.aggregate({ where: { supplierId, status: { not: 'CANCELLED' }, redemption: { sourceType: 'COMMISSION' } }, _sum: { paidAmount: true } }),
      tx.supplyV2Settlement.count({ where: { supplierId, status: { in: ['PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_PAID'] } } }),
    ])
    return {
      currency: s.currency,
      pendientesDeEntrega: pendientes,
      entregadas,
      montoPendienteDePago: (deuda._sum.outstandingAmount ?? new Prisma.Decimal(0)).toFixed(2),
      montoPagado: (pagado._sum.paidAmount ?? new Prisma.Decimal(0)).toFixed(2),
      liquidacionesAbiertas: liq,
    }
  })
}

export interface VentaProveedor {
  id: string
  producto: string
  cliente: string
  ofertaCodigo: string
  vendidoEl: Date
  /** Lo que pagó el cliente a Membego (bruto). */
  bruto: string
  /** Lo que recibirá el proveedor al entregar. */
  neto: string
  status: 'ACTIVE' | 'REDEEMED' | 'EXPIRED' | 'CANCELLED'
  entregadaEl: Date | null
  /** Estado del cobro del neto: null si no se ha entregado. */
  cobro: 'PENDIENTE' | 'LIQUIDADA' | 'PAGADA' | 'PARCIAL' | null
  liquidacionNumero: string | null
}

/** Ventas a comisión del proveedor: lo que Membego vendió por su cuenta. Sin comisión ni margen de Membego. */
export async function ventasDelProveedor(supplierId: string, filtro: 'TODAS' | 'PENDIENTES' | 'ENTREGADAS' = 'TODAS', limite = 200): Promise<VentaProveedor[]> {
  const filas = await sinEmpresa('Supply 2.0: ventas a comisión del proveedor', (tx) =>
    tx.supplyV2Entitlement.findMany({
      where: { supplierId, sourceType: 'COMMISSION', ...(filtro === 'PENDIENTES' ? { status: 'ACTIVE' } : filtro === 'ENTREGADAS' ? { status: 'REDEEMED' } : {}) },
      orderBy: { issuedAt: 'desc' },
      take: limite,
      select: {
        id: true,
        status: true,
        issuedAt: true,
        customerUnitPrice: true,
        supplierNet: true,
        catalogItem: { select: { name: true } },
        customer: { select: { name: true, email: true } },
        offer: { select: { code: true } },
        redemptions: { where: { reversedAt: null }, select: { redeemedAt: true, obligation: { select: { status: true, paidAmount: true, settlement: { select: { number: true, status: true } } } } }, take: 1 },
      },
    })
  )
  return filas.map((e) => {
    const r = e.redemptions[0] ?? null
    const o = r?.obligation ?? null
    const cobro = !r ? null : !o || o.status === 'CANCELLED' ? 'PENDIENTE' : o.status === 'PAID' ? 'PAGADA' : o.status === 'PARTIALLY_PAID' ? 'PARCIAL' : o.settlement && o.settlement.status !== 'CANCELLED' ? 'LIQUIDADA' : 'PENDIENTE'
    return {
      id: e.id,
      producto: e.catalogItem.name,
      cliente: e.customer.name?.trim() || e.customer.email.split('@')[0]!,
      ofertaCodigo: e.offer.code,
      vendidoEl: e.issuedAt,
      bruto: e.customerUnitPrice.toFixed(2),
      neto: (e.supplierNet ?? new Prisma.Decimal(0)).toFixed(2),
      status: e.status,
      entregadaEl: r?.redeemedAt ?? null,
      cobro,
      liquidacionNumero: o?.settlement?.number ?? null,
    }
  })
}

export interface LiquidacionProveedor {
  id: string
  number: string
  periodStart: Date
  periodEnd: Date
  status: string
  currency: string
  grossSales: string
  commissionAmount: string
  supplierNet: string
  paidAmount: string
  pendiente: string
  entregas: number
  approvedAt: Date | null
  paidAt: Date | null
}

export async function liquidacionesDelProveedor(supplierId: string, limite = 100): Promise<LiquidacionProveedor[]> {
  const filas = await sinEmpresa('Supply 2.0: liquidaciones del proveedor', (tx) =>
    tx.supplyV2Settlement.findMany({ where: { supplierId, status: { not: 'CANCELLED' } }, orderBy: { periodEnd: 'desc' }, take: limite, include: { _count: { select: { lines: true } } } })
  )
  return filas.map((s) => ({ id: s.id, number: s.number, periodStart: s.periodStart, periodEnd: s.periodEnd, status: s.status, currency: s.currency, grossSales: s.grossSales.toFixed(2), commissionAmount: s.commissionAmount.toFixed(2), supplierNet: s.supplierNet.toFixed(2), paidAmount: s.paidAmount.toFixed(2), pendiente: s.supplierNet.minus(s.paidAmount).toFixed(2), entregas: s._count.lines, approvedAt: s.approvedAt, paidAt: s.paidAt }))
}

export async function liquidacionDelProveedor(supplierId: string, id: string) {
  const s = await sinEmpresa('Supply 2.0: una liquidación vista por el proveedor', (tx) =>
    tx.supplyV2Settlement.findFirst({
      where: { id, supplierId, status: { not: 'CANCELLED' } },
      include: {
        lines: { orderBy: { createdAt: 'asc' } },
        intendedPayments: { where: { status: 'CONFIRMED' }, orderBy: { paidAt: 'asc' }, select: { id: true, number: true, amount: true, appliedAmount: true, paidAt: true, reference: true, method: true } },
      },
    })
  )
  if (!s) return null
  return {
    id: s.id,
    number: s.number,
    periodStart: s.periodStart,
    periodEnd: s.periodEnd,
    status: s.status,
    currency: s.currency,
    grossSales: s.grossSales.toFixed(2),
    commissionAmount: s.commissionAmount.toFixed(2),
    supplierNet: s.supplierNet.toFixed(2),
    paidAmount: s.paidAmount.toFixed(2),
    pendiente: s.supplierNet.minus(s.paidAmount).toFixed(2),
    approvedAt: s.approvedAt,
    paidAt: s.paidAt,
    lineas: s.lines.map((l) => ({ id: l.id, descripcion: l.descriptionSnapshot, gross: l.grossAmount.toFixed(2), commission: l.commissionAmount.toFixed(2), net: l.supplierNet.toFixed(2) })),
    pagos: s.intendedPayments.map((p) => ({ id: p.id, number: p.number, amount: p.appliedAmount.toFixed(2), paidAt: p.paidAt, reference: p.reference, method: p.method })),
  }
}
