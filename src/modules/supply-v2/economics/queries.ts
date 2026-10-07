import 'server-only'

import type { Prisma } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { agregarEconomia, rangoDeVentana, type Economia, type VentanaEconomia } from './domain'

/**
 * MEMBEGO SUPPLY · SLICE 4 · `SupplyV2Economics` (§31–§32, §68).
 *
 * UN solo sitio calcula GMV, ingreso, costo, margen, unidades vendidas,
 * redimidas y vencidas y la tasa de breakage: las pantallas piden aquí y no
 * repiten fórmulas. Todo sale de los eventos económicos congelados y de las
 * redenciones vivas; nunca de precios actuales.
 */

export interface FiltroEconomia {
  ventana: VentanaEconomia
  desde?: Date | null
  hasta?: Date | null
  supplierId?: string | null
  catalogItemId?: string | null
}

export interface EconomiaCalculada extends Economia {
  desde: Date
  hasta: Date
  hayDatos: boolean
}

export async function calcularEconomia(f: FiltroEconomia, ahora = new Date()): Promise<EconomiaCalculada> {
  const { desde, hasta } = rangoDeVentana(f.ventana, ahora, f.desde, f.hasta)
  const comun: Prisma.SupplyV2EconomicEventWhereInput = {
    occurredAt: { gte: desde, lt: hasta },
    ...(f.supplierId ? { supplierId: f.supplierId } : {}),
    ...(f.catalogItemId ? { catalogItemId: f.catalogItemId } : {}),
  }
  const [eventos, redimidas] = await sinEmpresa('Supply: economía del supply', (tx) =>
    Promise.all([
      tx.supplyV2EconomicEvent.findMany({ where: comun, select: { type: true, units: true, gmvAmount: true, revenueAmount: true, costAmount: true, grossMarginAmount: true, contractualAmount: true, supplierDiscountAmount: true, subsidyAmount: true, customerPaidAmount: true } }),
      tx.supplyV2Redemption.count({
        where: {
          reversedAt: null,
          redeemedAt: { gte: desde, lt: hasta },
          ...(f.supplierId ? { supplierId: f.supplierId } : {}),
          ...(f.catalogItemId ? { catalogItemId: f.catalogItemId } : {}),
        },
      }),
    ])
  )
  const e = agregarEconomia(eventos, redimidas)
  return { ...e, desde, hasta, hayDatos: eventos.length > 0 || redimidas > 0 }
}

export interface FilaDesglose {
  catalogItemId: string | null
  producto: string
  sku: string | null
  proveedor: string | null
  /** Modalidades con ventas en el periodo (un producto puede tener las dos). */
  modalidades: ('PREPAGO' | 'COMISION')[]
  unidades: number
  gmv: string
  /** Costo real por unidad del supply adquirido; null si no hubo venta de supply. */
  costoUnitario: string | null
  subsidio: string
  ingreso: string
  margen: string
  /** Margen sobre el ingreso, como en `Economia.marginPct`; null si no hay ingreso. */
  margenPct: number | null
}

/**
 * Desglose por producto de los MISMOS eventos que `calcularEconomia` (mismo
 * filtro y misma agregación por grupo), de modo que la suma de la tabla
 * coincide con los indicadores. Solo lectura.
 */
export async function desglosePorProducto(f: FiltroEconomia, ahora = new Date()): Promise<FilaDesglose[]> {
  const { desde, hasta } = rangoDeVentana(f.ventana, ahora, f.desde, f.hasta)
  const eventos = await sinEmpresa('Supply: desglose económico por producto', (tx) =>
    tx.supplyV2EconomicEvent.findMany({
      where: {
        occurredAt: { gte: desde, lt: hasta },
        ...(f.supplierId ? { supplierId: f.supplierId } : {}),
        ...(f.catalogItemId ? { catalogItemId: f.catalogItemId } : {}),
      },
      select: {
        type: true, units: true, gmvAmount: true, revenueAmount: true, costAmount: true, grossMarginAmount: true, contractualAmount: true, supplierDiscountAmount: true, subsidyAmount: true, customerPaidAmount: true,
        catalogItemId: true,
        catalogItem: { select: { name: true, sku: true, supplier: { select: { commercialName: true } } } },
      },
    })
  )
  const grupos = new Map<string, typeof eventos>()
  for (const e of eventos) {
    const k = e.catalogItemId ?? '∅'
    const g = grupos.get(k)
    if (g) g.push(e)
    else grupos.set(k, [e])
  }
  const filas: FilaDesglose[] = []
  for (const [k, g] of grupos) {
    const e = agregarEconomia(g, 0)
    if (e.unitsSold === 0 && e.gmv.isZero() && e.membegoSubsidy.isZero()) continue
    const ci = g[0].catalogItem
    const modalidades: FilaDesglose['modalidades'] = []
    if (e.prepurchase.unitsSold > 0) modalidades.push('PREPAGO')
    if (e.commission.unitsSold > 0) modalidades.push('COMISION')
    filas.push({
      catalogItemId: k === '∅' ? null : k,
      producto: ci?.name ?? 'Sin producto asociado',
      sku: ci?.sku ?? null,
      proveedor: ci?.supplier.commercialName ?? null,
      modalidades,
      unidades: e.unitsSold,
      gmv: e.gmv.toFixed(2),
      costoUnitario: e.prepurchase.unitsSold > 0 ? e.prepurchase.cost.dividedBy(e.prepurchase.unitsSold).toFixed(2) : null,
      subsidio: e.membegoSubsidy.toFixed(2),
      ingreso: e.revenue.toFixed(2),
      margen: e.grossMargin.toFixed(2),
      margenPct: e.marginPct,
    })
  }
  return filas.sort((a, b) => Number(b.gmv) - Number(a.gmv))
}

export async function opcionesDeFiltroEconomia(): Promise<{ proveedores: { id: string; nombre: string }[]; productos: { id: string; nombre: string; proveedor: string }[] }> {
  const [proveedores, productos] = await sinEmpresa('Supply: filtros del reporte económico', (tx) =>
    Promise.all([
      tx.supplyV2Supplier.findMany({ where: { economicEvents: { some: {} } }, orderBy: { commercialName: 'asc' }, select: { id: true, commercialName: true } }),
      tx.supplyV2CatalogItem.findMany({ where: { economicEvents: { some: {} } }, orderBy: { name: 'asc' }, select: { id: true, name: true, supplier: { select: { commercialName: true } } } }),
    ])
  )
  return { proveedores: proveedores.map((p) => ({ id: p.id, nombre: p.commercialName })), productos: productos.map((p) => ({ id: p.id, nombre: p.name, proveedor: p.supplier.commercialName })) }
}

export interface HitoEconomico {
  cuando: Date
  titulo: string
  detalle?: string | null
  monto?: string | null
  tono: 'neutral' | 'success' | 'warning' | 'info'
}

/** Timeline económico de UNA compra del cliente (§62): venta → derecho → costo → margen → redención / vencimiento. Sin precios actuales. */
export async function timelineEconomicoDeCompra(orderId: string): Promise<{
  order: { id: string; number: string; status: string; total: string; currency: string; customer: string; paidAt: Date | null; contractualValue: string; supplierDiscountTotal: string; membegoSubsidyTotal: string; beneficio: { code: string; name: string; funding: string } | null }
  derechos: { id: string; status: string; producto: string; proveedor: string; hitos: HitoEconomico[]; venta: { customerPaid: string; publicPrice: string; discount: string; actualUnitCost: string; grossMargin: string; contractual: string; descuentoProveedor: string; subsidio: string } | null }[]
} | null> {
  const o = await sinEmpresa('Supply: timeline económico de una compra', (tx) =>
    tx.supplyV2CustomerOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        number: true,
        status: true,
        total: true,
        currency: true,
        paidAt: true,
        createdAt: true,
        contractualValue: true,
        supplierDiscountTotal: true,
        membegoSubsidyTotal: true,
        customer: { select: { name: true, email: true } },
        lines: { select: { benefit: { select: { code: true, name: true, funding: true } } } },
        entitlements: {
          orderBy: { issuedAt: 'asc' },
          select: {
            id: true,
            status: true,
            issuedAt: true,
            expiresAt: true,
            currency: true,
            contractualUnitValue: true,
            supplierDiscountAmount: true,
            membegoSubsidyAmount: true,
            catalogItem: { select: { name: true } },
            supplier: { select: { commercialName: true } },
            economicEvents: { orderBy: { occurredAt: 'asc' }, select: { type: true, occurredAt: true, revenueAmount: true, costAmount: true, grossMarginAmount: true, metadata: true, subsidyAmount: true, contractualAmount: true, supplierDiscountAmount: true, customerPaidAmount: true } },
            redemptions: { orderBy: { redeemedAt: 'asc' }, select: { number: true, redeemedAt: true, reversedAt: true, reversalReason: true, branch: { select: { nombre: true } } } },
          },
        },
      },
    })
  )
  if (!o) return null
  const dinero = (n: { toFixed(d: number): string }, moneda: string) => `${moneda === 'DOP' ? 'RD$' : `${moneda} `}${Number(n.toFixed(2)).toLocaleString('es-DO', { minimumFractionDigits: 2 })}`
  return {
    order: {
      id: o.id,
      number: o.number,
      status: o.status,
      total: o.total.toFixed(2),
      currency: o.currency,
      customer: o.customer.name ?? o.customer.email,
      paidAt: o.paidAt,
      contractualValue: o.contractualValue.toFixed(2),
      supplierDiscountTotal: o.supplierDiscountTotal.toFixed(2),
      membegoSubsidyTotal: o.membegoSubsidyTotal.toFixed(2),
      beneficio: o.lines.find((l) => l.benefit)?.benefit ?? null,
    },
    derechos: o.entitlements.map((e) => {
      const venta = e.economicEvents.find((x) => x.type === 'SALE_REVENUE')
      const meta = (venta?.metadata ?? null) as Record<string, string> | null
      const hitos: HitoEconomico[] = []
      hitos.push({ cuando: o.paidAt ?? o.createdAt, titulo: `Venta ${dinero(venta?.revenueAmount ?? o.total, e.currency)}`, detalle: `Compra ${o.number}`, tono: 'success' })
      hitos.push({ cuando: e.issuedAt, titulo: 'Derecho emitido', detalle: `${e.catalogItem.name} · ${e.supplier.commercialName}`, tono: 'info' })
      if (venta) {
        hitos.push({ cuando: venta.occurredAt, titulo: `Costo ${dinero(venta.costAmount, e.currency)}`, detalle: 'Costo real del lote, reconocido una sola vez al vender', tono: 'neutral' })
        hitos.push({ cuando: venta.occurredAt, titulo: `Margen ${dinero(venta.grossMarginAmount, e.currency)}`, detalle: meta ? `Precio público ${dinero({ toFixed: () => meta.publicPrice ?? '0' }, e.currency)} · descuento ${dinero({ toFixed: () => meta.discount ?? '0' }, e.currency)}` : null, tono: 'success' })
      } else {
        hitos.push({ cuando: e.issuedAt, titulo: 'Sin evento económico todavía', detalle: 'El cron lo proyecta en la siguiente pasada.', tono: 'warning' })
      }
      for (const r of e.redemptions) {
        hitos.push({ cuando: r.redeemedAt, titulo: `Redención ${r.number}`, detalle: r.branch?.nombre ?? null, tono: 'success' })
        if (r.reversedAt) hitos.push({ cuando: r.reversedAt, titulo: 'Redención reversada', detalle: r.reversalReason, tono: 'warning' })
      }
      // Slice 6 (§28): el subsidio es un evento APARTE, no un descuento del ingreso.
      const subsidio = e.economicEvents.find((x) => x.type === 'MEMBEGO_SUBSIDY')
      if (subsidio) {
        hitos.push({ cuando: subsidio.occurredAt, titulo: `Subsidio de Membego ${dinero(subsidio.subsidyAmount ?? e.membegoSubsidyAmount, e.currency)}`, detalle: 'Costo promocional: lo financió Membego, no el proveedor.', tono: 'warning' })
      }
      const breakage = e.economicEvents.find((x) => x.type === 'BREAKAGE')
      if (breakage) hitos.push({ cuando: breakage.occurredAt, titulo: 'Venció sin usarse (breakage)', detalle: 'El ingreso se conserva; el costo no se duplica.', tono: 'warning' })
      hitos.sort((a, b) => a.cuando.getTime() - b.cuando.getTime())
      return {
        id: e.id,
        status: e.status,
        producto: e.catalogItem.name,
        proveedor: e.supplier.commercialName,
        hitos,
        venta: meta
          ? {
              customerPaid: meta.customerPaid ?? '0.00',
              publicPrice: meta.publicPrice ?? '0.00',
              discount: meta.discount ?? '0.00',
              actualUnitCost: meta.actualUnitCost ?? '0.00',
              grossMargin: meta.grossMargin ?? '0.00',
              contractual: (venta?.contractualAmount ?? e.contractualUnitValue).toFixed(2),
              descuentoProveedor: e.supplierDiscountAmount.toFixed(2),
              subsidio: e.membegoSubsidyAmount.toFixed(2),
            }
          : null,
      }
    }),
  }
}
