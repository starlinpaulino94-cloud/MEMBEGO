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
  /** El proveedor es una empresa registrada en Membego. */
  proveedorEnMembego: boolean
  producto: string
  categoria: string | null
  sku: string | null
  asignadas: number
  vendidas: number
  reservadas: number
  disponibles: number
  publicPrice: string
  salePrice: string
  currency: string
  /** Supply adquirido: costo por unidad de los lotes apartados (media ponderada); null a comisión. */
  costoUnitario: string | null
  /** Supply adquirido: código del primer lote apartado. */
  lote: string | null
  startsAt: Date
  endsAt: Date | null
}

const SELECT_OFERTA = {
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
  supplier: { select: { commercialName: true, companyId: true } },
  catalogItem: { select: { name: true, category: true, sku: true } },
  allocation: {
    select: {
      allocatedQuantity: true,
      reservedQuantity: true,
      issuedQuantity: true,
      releasedQuantity: true,
      lines: { select: { quantity: true, lot: { select: { code: true, unitCost: true } } } },
    },
  },
  commissionReservations: { where: { status: { in: ['ACTIVE', 'CONSUMED'] } }, select: { status: true, quantity: true } },
} satisfies Prisma.SupplyV2OfferSelect

type OfertaSeleccionada = Prisma.SupplyV2OfferGetPayload<{ select: typeof SELECT_OFERTA }>

function aOfertaEnLista(o: OfertaSeleccionada): OfertaEnLista {
  const comision = o.sourceType === 'COMMISSION'
  const reservadasC = o.commissionReservations.filter((r) => r.status === 'ACTIVE').reduce((t, r) => t + r.quantity, 0)
  const vendidasC = o.commissionReservations.filter((r) => r.status === 'CONSUMED').reduce((t, r) => t + r.quantity, 0)
  const libresC = comision ? unidadesLibresComision(o, reservadasC + vendidasC) : null
  const lineas = o.allocation?.lines ?? []
  const unidadesLote = lineas.reduce((t, l) => t + l.quantity, 0)
  const costo = !comision && unidadesLote > 0 ? lineas.reduce((t, l) => t + l.quantity * aNumero(l.lot.unitCost), 0) / unidadesLote : null
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
    proveedorEnMembego: o.supplier.companyId !== null,
    producto: o.catalogItem.name,
    categoria: o.catalogItem.category,
    sku: o.catalogItem.sku,
    asignadas: comision ? o.availabilityQuantity ?? 0 : o.allocation?.allocatedQuantity ?? 0,
    vendidas: comision ? vendidasC : o.allocation?.issuedQuantity ?? 0,
    reservadas: comision ? reservadasC : o.allocation?.reservedQuantity ?? 0,
    disponibles: comision ? libresC ?? 0 : o.allocation ? unidadesLibres(o.allocation) : 0,
    publicPrice: o.publicPrice.toFixed(2),
    salePrice: o.salePrice.toFixed(2),
    currency: o.currency,
    costoUnitario: costo === null ? null : costo.toFixed(2),
    lote: lineas[0]?.lot.code ?? null,
    startsAt: o.startsAt,
    endsAt: o.endsAt,
  }
}

export async function listarOfertas(): Promise<OfertaEnLista[]> {
  const filas = await sinEmpresa('Supply 2.0: listado de ofertas', (tx) =>
    tx.supplyV2Offer.findMany({ orderBy: { createdAt: 'desc' }, take: 200, select: SELECT_OFERTA })
  )
  return filas.map(aOfertaEnLista)
}

export interface FiltroOfertas {
  /** Título, código, producto, SKU o proveedor. */
  q?: string | null
  sourceType?: SupplyV2OfferSource | null
  supplierId?: string | null
  status?: SupplyV2OfferStatus | null
}

/** Listado filtrado y paginado de la pantalla Ofertas: los filtros se aplican en la base. */
export async function buscarOfertas(f: FiltroOfertas, p: { pagina: number; filas: number }): Promise<{ filas: OfertaEnLista[]; total: number; adquiridas: number; comision: number }> {
  const q = f.q?.trim()
  const where: Prisma.SupplyV2OfferWhereInput = {
    ...(f.sourceType ? { sourceType: f.sourceType } : {}),
    ...(f.supplierId ? { supplierId: f.supplierId } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { code: { contains: q, mode: 'insensitive' } },
            { supplier: { commercialName: { contains: q, mode: 'insensitive' } } },
            { catalogItem: { name: { contains: q, mode: 'insensitive' } } },
            { catalogItem: { sku: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  }
  const [filas, porModelo] = await sinEmpresa('Supply 2.0: búsqueda de ofertas', (tx) =>
    Promise.all([
      tx.supplyV2Offer.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (p.pagina - 1) * p.filas, take: p.filas, select: SELECT_OFERTA }),
      tx.supplyV2Offer.groupBy({ by: ['sourceType'], where, _count: { _all: true } }),
    ])
  )
  const cuenta = (t: SupplyV2OfferSource) => porModelo.find((g) => g.sourceType === t)?._count._all ?? 0
  const adquiridas = cuenta('PREPURCHASED_SUPPLY')
  const comision = cuenta('COMMISSION')
  return { filas: filas.map(aOfertaEnLista), total: adquiridas + comision, adquiridas, comision }
}

export interface ResumenOfertas {
  activas: number
  borradores: number
  pausadas: number
  /** Unidades asignadas a ofertas activas de supply adquirido. */
  unidadesAsignadas: number
  /** Lote de la oferta activa más reciente (para el pie del indicador). */
  loteReciente: string | null
  /** Disponibles de las ofertas activas × su precio Membego. */
  gmvVitrina: number
  /** Precio unitario de la oferta activa más reciente. */
  precioReciente: number | null
  /** Margen medio ponderado de las ofertas activas de supply adquirido (0–100). */
  margenPct: number | null
  costoMedio: number | null
  utilidadMedia: number | null
  /** Ofertas activas en campañas activas y recompensas activas de fidelización. */
  enCampanas: number
  enFidelizacion: number
}

/** Indicadores de la pantalla Ofertas, sobre todas las ofertas (no el filtro). */
export async function resumenOfertas(): Promise<ResumenOfertas> {
  const [conteos, activas, enCampanas, enFidelizacion] = await sinEmpresa('Supply 2.0: indicadores de ofertas', (tx) =>
    Promise.all([
      tx.supplyV2Offer.groupBy({ by: ['status'], _count: { _all: true } }),
      tx.supplyV2Offer.findMany({ where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' }, select: SELECT_OFERTA }),
      tx.supplyV2CampaignOffer.count({ where: { campaign: { status: 'ACTIVE' }, offer: { status: 'ACTIVE' } } }),
      tx.supplyV2Reward.count({ where: { status: 'ACTIVE', offerId: { not: null } } }),
    ])
  )
  const cuenta = (e: SupplyV2OfferStatus) => conteos.find((c) => c.status === e)?._count._all ?? 0
  const lista = activas.map(aOfertaEnLista)
  const adquiridas = lista.filter((o) => o.sourceType === 'PREPURCHASED_SUPPLY' && o.costoUnitario !== null)
  const pesos = adquiridas.map((o) => ({ u: Math.max(1, o.asignadas), venta: Number(o.salePrice), costo: Number(o.costoUnitario) }))
  const totU = pesos.reduce((t, x) => t + x.u, 0)
  const venta = pesos.reduce((t, x) => t + x.u * x.venta, 0)
  const costo = pesos.reduce((t, x) => t + x.u * x.costo, 0)
  return {
    activas: cuenta('ACTIVE'),
    borradores: cuenta('DRAFT'),
    pausadas: cuenta('PAUSED'),
    unidadesAsignadas: lista.filter((o) => o.sourceType === 'PREPURCHASED_SUPPLY').reduce((t, o) => t + o.asignadas, 0),
    loteReciente: lista.find((o) => o.lote)?.lote ?? null,
    gmvVitrina: lista.reduce((t, o) => t + (o.sourceType === 'COMMISSION' && o.disponiblesComision === null ? 0 : o.disponibles) * Number(o.salePrice), 0),
    precioReciente: lista[0] ? Number(lista[0].salePrice) : null,
    margenPct: venta > 0 ? ((venta - costo) / venta) * 100 : null,
    costoMedio: totU > 0 ? costo / totU : null,
    utilidadMedia: totU > 0 ? (venta - costo) / totU : null,
    enCampanas,
    enFidelizacion,
  }
}

/** Proveedores con al menos una oferta, para el filtro. */
export async function proveedoresConOfertas(): Promise<{ id: string; nombre: string }[]> {
  const filas = await sinEmpresa('Supply 2.0: proveedores con ofertas', (tx) =>
    tx.supplyV2Supplier.findMany({ where: { offers: { some: {} } }, orderBy: { commercialName: 'asc' }, select: { id: true, commercialName: true } })
  )
  return filas.map((f) => ({ id: f.id, nombre: f.commercialName }))
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
