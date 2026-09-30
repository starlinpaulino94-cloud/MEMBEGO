import 'server-only'

import type { SupplyV2OfferStatus } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { aNumero } from '../core/dinero'
import { unidadesLibres } from './domain'

/**
 * MEMBEGO SUPPLY 2.0 · lecturas de ofertas para la ADMINISTRACIÓN (§43–§44).
 * Aquí sí se ven costos y lotes: es la vista interna.
 */

export interface OfertaEnLista {
  id: string
  code: string
  title: string
  status: SupplyV2OfferStatus
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
        supplier: { select: { commercialName: true } },
        catalogItem: { select: { name: true } },
        allocation: { select: { allocatedQuantity: true, reservedQuantity: true, issuedQuantity: true, releasedQuantity: true } },
      },
    })
  )
  return filas.map((o) => ({
    id: o.id,
    code: o.code,
    title: o.title,
    status: o.status,
    proveedor: o.supplier.commercialName,
    producto: o.catalogItem.name,
    asignadas: o.allocation?.allocatedQuantity ?? 0,
    vendidas: o.allocation?.issuedQuantity ?? 0,
    reservadas: o.allocation?.reservedQuantity ?? 0,
    disponibles: o.allocation ? unidadesLibres(o.allocation) : 0,
    publicPrice: o.publicPrice.toFixed(2),
    salePrice: o.salePrice.toFixed(2),
    currency: o.currency,
    startsAt: o.startsAt,
    endsAt: o.endsAt,
  }))
}

export async function fichaOferta(id: string) {
  const o = await sinEmpresa('Supply 2.0: ficha de una oferta', (tx) =>
    tx.supplyV2Offer.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, commercialName: true } },
        catalogItem: { select: { id: true, name: true, unit: true } },
        createdBy: { select: { name: true, email: true } },
        publishedBy: { select: { name: true, email: true } },
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
  return { ...o, ledger, costoEstimado, disponibles: o.allocation ? unidadesLibres(o.allocation) : 0 }
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
        lines: { select: { titleSnapshot: true, quantity: true, offer: { select: { id: true, code: true } } } },
      },
    })
  )
}
