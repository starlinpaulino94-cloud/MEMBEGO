import 'server-only'

import type { SupplyV2AvailabilityMode, SupplyV2OfferSource, SupplyV2OfferStatus } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { aNumero } from '../core/dinero'
import { resolverAcuerdoComisionDeItemEnTx } from '../agreements/service'
import { unidadesLibres, unidadesLibresComision } from './domain'

/**
 * MEMBEGO SUPPLY 2.0 · lecturas de ofertas para la ADMINISTRACIÓN (§43–§44).
 * Aquí sí se ven costos y lotes: es la vista interna.
 */

export interface OfertaEnLista {
  id: string
  code: string
  title: string
  status: SupplyV2OfferStatus
  /** Slice 5: modelo de la oferta (supply adquirido o comisión). */
  sourceType: SupplyV2OfferSource
  commissionPercentage: string | null
  availabilityMode: SupplyV2AvailabilityMode | null
  /** `null` = sin tope (comisión UNLIMITED). */
  disponiblesComision: number | null
  proveedor: string
  producto: string
  asignadas: number
  vendidas: number
  reservadas: number
  disponibles: number
  publicPrice: string
  salePrice: string
  currency: string
  startsAt: Date
  endsAt: Date | null
}

export async function listarOfertas(): Promise<OfertaEnLista[]> {
  const filas = await sinEmpresa('Supply 2.0: listado de ofertas', (tx) =>
    tx.supplyV2Offer.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        code: true,
        title: true,
        status: true,
        publicPrice: true,
        salePrice: true,
        currency: true,
        startsAt: true,
        endsAt: true,
        quantityLimit: true,
        sourceType: true,
        commissionPercentage: true,
        availabilityMode: true,
        availabilityQuantity: true,
        supplier: { select: { commercialName: true } },
        catalogItem: { select: { name: true } },
        allocation: { select: { allocatedQuantity: true, reservedQuantity: true, issuedQuantity: true, releasedQuantity: true } },
        commissionReservations: { where: { status: { in: ['ACTIVE', 'CONSUMED'] } }, select: { status: true, quantity: true } },
      },
    })
  )
  return filas.map((o) => {
    const comision = o.sourceType === 'COMMISSION'
    const reservadasC = o.commissionReservations.filter((r) => r.status === 'ACTIVE').reduce((t, r) => t + r.quantity, 0)
    const vendidasC = o.commissionReservations.filter((r) => r.status === 'CONSUMED').reduce((t, r) => t + r.quantity, 0)
    const libresC = comision ? unidadesLibresComision(o, reservadasC + vendidasC) : null
    return {
    id: o.id,
    code: o.code,
    title: o.title,
    status: o.status,
    sourceType: o.sourceType,
    commissionPercentage: o.commissionPercentage?.toFixed(2) ?? null,
    availabilityMode: o.availabilityMode,
    disponiblesComision: libresC,
    proveedor: o.supplier.commercialName,
    producto: o.catalogItem.name,
    asignadas: comision ? o.availabilityQuantity ?? 0 : o.allocation?.allocatedQuantity ?? 0,
    vendidas: comision ? vendidasC : o.allocation?.issuedQuantity ?? 0,
    reservadas: comision ? reservadasC : o.allocation?.reservedQuantity ?? 0,
    disponibles: comision ? libresC ?? 0 : o.allocation ? unidadesLibres(o.allocation) : 0,
    publicPrice: o.publicPrice.toFixed(2),
    salePrice: o.salePrice.toFixed(2),
    currency: o.currency,
    startsAt: o.startsAt,
    endsAt: o.endsAt,
    }
  })
}

export async function fichaOferta(id: string) {
  const o = await sinEmpresa('Supply 2.0: ficha de una oferta', (tx) =>
    tx.supplyV2Offer.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, commercialName: true } },
        catalogItem: { select: { id: true, name: true, unit: true, category: true } },
        createdBy: { select: { name: true, email: true } },
        publishedBy: { select: { name: true, email: true } },
        agreement: { select: { id: true, code: true, scope: true, commissionPercentage: true, status: true } },
        commissionReservations: { where: { status: { in: ['ACTIVE', 'CONSUMED'] } }, select: { status: true, quantity: true } },
        allocation: {
          include: {
            lines: { include: { lot: { select: { id: true, code: true, unitCost: true, expiresAt: true } } } },
          },
        },
        orderLines: {
          orderBy: { order: { createdAt: 'desc' } },
          take: 20,
          include: { order: { select: { id: true, number: true, status: true, paymentStatus: true, total: true, createdAt: true, customer: { select: { name: true, email: true } } } } },
        },
        _count: { select: { entitlements: true } },
      },
    })
  )
  if (!o) return null
  const ledger = o.allocation
    ? await sinEmpresa('Supply 2.0: ledger relacionado con una oferta', (tx) =>
        tx.supplyV2LedgerEntry.findMany({
          where: {
            OR: [
              { referenceType: 'ALLOCATION', referenceId: o.allocation!.id },
              { referenceType: 'CUSTOMER_ORDER', referenceId: { in: o.orderLines.map((l) => l.order.id) } },
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: { lot: { select: { code: true } }, actor: { select: { name: true, email: true } } },
        })
      )
    : []
  const costoEstimado = o.allocation && o.allocation.lines.length > 0
    ? o.allocation.lines.reduce((t, l) => t + l.quantity * aNumero(l.lot.unitCost), 0) / o.allocation.lines.reduce((t, l) => t + l.quantity, 0)
    : null
  // Slice 5 (§62): estadísticas de comisión de la oferta (ventas, comisión, neto, entregas, pendiente).
  let comision: EstadisticasComision | null = null
  if (o.sourceType === 'COMMISSION') {
    const reservadas = o.commissionReservations.filter((r) => r.status === 'ACTIVE').reduce((t, r) => t + r.quantity, 0)
    const vendidas = o.commissionReservations.filter((r) => r.status === 'CONSUMED').reduce((t, r) => t + r.quantity, 0)
    const [derechos, obligaciones] = await sinEmpresa('Supply 2.0: estadísticas de comisión de una oferta', (tx) =>
      Promise.all([
        tx.supplyV2Entitlement.groupBy({ by: ['status'], where: { offerId: o.id }, _count: { _all: true }, _sum: { customerUnitPrice: true, commissionAmount: true, supplierNet: true } }),
        tx.supplyV2SupplierObligation.aggregate({ where: { redemption: { entitlement: { offerId: o.id } }, status: { not: 'CANCELLED' } }, _sum: { grossAmount: true, paidAmount: true, outstandingAmount: true } }),
      ])
    )
    const total = (k: 'customerUnitPrice' | 'commissionAmount' | 'supplierNet') => derechos.reduce((t, d) => t.plus(d._sum[k] ?? 0), new Prisma.Decimal(0))
    const n = (st: string) => derechos.find((d) => d.status === st)?._count._all ?? 0
    comision = {
      agreementCode: o.agreement?.code ?? null,
      agreementId: o.agreement?.id ?? null,
      agreementScope: o.commissionScope ?? o.agreement?.scope ?? null,
      commissionPercentage: o.commissionPercentage?.toFixed(2) ?? null,
      availabilityMode: o.availabilityMode,
      availabilityQuantity: o.availabilityQuantity,
      reservadas,
      vendidas,
      libres: unidadesLibresComision(o, reservadas + vendidas),
      entregadas: n('REDEEMED'),
      pendientesDeEntrega: n('ACTIVE'),
      vencidas: n('EXPIRED'),
      gmv: total('customerUnitPrice').toFixed(2),
      comision: total('commissionAmount').toFixed(2),
      netoProveedor: total('supplierNet').toFixed(2),
      netoDevengado: (obligaciones._sum.grossAmount ?? new Prisma.Decimal(0)).toFixed(2),
      netoPagado: (obligaciones._sum.paidAmount ?? new Prisma.Decimal(0)).toFixed(2),
      netoPendiente: (obligaciones._sum.outstandingAmount ?? new Prisma.Decimal(0)).toFixed(2),
    }
  }
  return { ...o, ledger, costoEstimado, disponibles: o.allocation ? unidadesLibres(o.allocation) : comision?.libres ?? 0, comision }
}

export interface EstadisticasComision {
  agreementCode: string | null
  agreementId: string | null
  agreementScope: 'ITEM' | 'CATEGORY' | 'CATALOG' | null
  commissionPercentage: string | null
  availabilityMode: SupplyV2AvailabilityMode | null
  availabilityQuantity: number | null
  reservadas: number
  vendidas: number
  /** `null` = sin tope. */
  libres: number | null
  entregadas: number
  pendientesDeEntrega: number
  vencidas: number
  gmv: string
  comision: string
  netoProveedor: string
  netoDevengado: string
  netoPagado: string
  netoPendiente: string
}

/**
 * Slice 5 (§11): productos que se pueden vender a COMISIÓN hoy: activos y
 * con un acuerdo a comisión vigente que los cubra (ITEM > CATEGORY > CATALOG).
 * La regla resuelta se muestra al administrador; nunca al cliente.
 */
export async function productosParaOfertaComision() {
  return sinEmpresa('Supply 2.0: productos con acuerdo a comisión', async (tx) => {
    const items = await tx.supplyV2CatalogItem.findMany({
      where: { status: 'ACTIVE', supplier: { status: 'ACTIVE', agreements: { some: { type: 'COMMISSION', status: 'ACTIVE' } } } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, category: true, publicPrice: true, currency: true, unit: true, supplier: { select: { id: true, commercialName: true } } },
    })
    const ahora = new Date()
    const out: { id: string; name: string; category: string | null; proveedor: string; supplierId: string; unit: string; currency: string; publicPrice: string | null; commissionPercentage: string; agreementCode: string; agreementScope: 'ITEM' | 'CATEGORY' | 'CATALOG' }[] = []
    for (const i of items) {
      const a = await resolverAcuerdoComisionDeItemEnTx(tx, i.id, ahora)
      if (!a) continue
      out.push({ id: i.id, name: i.name, category: i.category, proveedor: i.supplier.commercialName, supplierId: i.supplier.id, unit: i.unit, currency: i.currency, publicPrice: i.publicPrice?.toFixed(2) ?? null, commissionPercentage: a.commissionPercentage.toFixed(2), agreementCode: a.code, agreementScope: a.scope })
    }
    return out
  })
}

/** Lo que el wizard necesita del producto (§11): disponibilidad y costo promedio ponderado. */
export async function productosParaOferta() {
  const items = await sinEmpresa('Supply 2.0: productos con supply disponible para ofertar', (tx) =>
    tx.supplyV2CatalogItem.findMany({
      where: { status: 'ACTIVE', lots: { some: { quantityAvailable: { gt: 0 }, status: 'ACTIVE' } } },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        publicPrice: true,
        currency: true,
        unit: true,
        supplier: { select: { id: true, commercialName: true } },
        lots: { where: { status: 'ACTIVE', quantityAvailable: { gt: 0 } }, select: { quantityAvailable: true, unitCost: true, expiresAt: true } },
      },
    })
  )
  const ahora = new Date()
  return items
    .map((i) => {
      const vivos = i.lots.filter((l) => !l.expiresAt || l.expiresAt > ahora)
      const disponibles = vivos.reduce((t, l) => t + l.quantityAvailable, 0)
      const costo = disponibles > 0 ? vivos.reduce((t, l) => t + l.quantityAvailable * aNumero(l.unitCost), 0) / disponibles : 0
      return {
        id: i.id,
        name: i.name,
        proveedor: i.supplier.commercialName,
        supplierId: i.supplier.id,
        unit: i.unit,
        currency: i.currency,
        publicPrice: i.publicPrice?.toFixed(2) ?? null,
        disponibles,
        costoPromedio: Number(costo.toFixed(2)),
      }
    })
    .filter((i) => i.disponibles > 0)
}

/** Cola de pagos por revisar y ventas recientes (administración). */
export async function listarComprasClientes(filtro: 'PENDIENTES' | 'TODAS' = 'TODAS') {
  return sinEmpresa('Supply 2.0: compras de clientes', (tx) =>
    tx.supplyV2CustomerOrder.findMany({
      where: filtro === 'PENDIENTES' ? { status: { in: ['PENDING', 'AWAITING_PAYMENT'] } } : {},
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
      select: {
        id: true,
        number: true,
        status: true,
        paymentStatus: true,
        paymentMethod: true,
        paymentReference: true,
        paymentSubmittedAt: true,
        total: true,
        currency: true,
        expiresAt: true,
        createdAt: true,
        paidAt: true,
        customer: { select: { name: true, email: true } },
        sourceType: true,
        commissionAmount: true,
        supplierNet: true,
        // Slice 6 (§24): la financiación congelada; el total es lo que paga el cliente.
        contractualValue: true,
        supplierDiscountTotal: true,
        membegoSubsidyTotal: true,
        commissionBase: true,
        lines: { select: { titleSnapshot: true, quantity: true, benefit: { select: { code: true, name: true, funding: true } }, offer: { select: { id: true, code: true, sourceType: true } } } },
      },
    })
  )
}
