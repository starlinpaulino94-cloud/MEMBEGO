import 'server-only'

import { sinEmpresa } from '@/lib/tenant'
import { aNumero } from '../core/dinero'
import { ORDEN_ABIERTA } from '../core/estados'

/**
 * MEMBEGO SUPPLY 2.0 · lecturas del pool de supply (§24, §37–§39).
 *
 * Todo sale de los lotes y del ledger: ningún número está escrito a mano.
 */

export interface ResumenSupplyV2 {
  valorDisponible: number
  unidadesDisponibles: number
  unidadesRecibidas: number
  unidadesAsignadas: number
  unidadesEmitidas: number
  ofertasActivas: number
  comprasAbiertas: number
  proveedoresActivos: number
}

export async function resumenSupplyV2(): Promise<ResumenSupplyV2> {
  return sinEmpresa('Supply 2.0: tablero', async (tx) => {
    const [lotes, comprasAbiertas, proveedoresActivos, ofertasActivas] = await Promise.all([
      tx.supplyV2Lot.findMany({
        where: { status: { in: ['ACTIVE', 'EXHAUSTED'] } },
        select: { quantityAvailable: true, quantityAllocated: true, quantityIssued: true, quantityReceived: true, unitCost: true },
      }),
      tx.supplyV2PurchaseOrder.count({ where: { status: { in: [...ORDEN_ABIERTA] } } }),
      tx.supplyV2Supplier.count({ where: { status: 'ACTIVE' } }),
      tx.supplyV2Offer.count({ where: { status: 'ACTIVE' } }),
    ])
    return {
      valorDisponible: lotes.reduce((t, l) => t + l.quantityAvailable * aNumero(l.unitCost), 0),
      unidadesDisponibles: lotes.reduce((t, l) => t + l.quantityAvailable, 0),
      unidadesRecibidas: lotes.reduce((t, l) => t + l.quantityReceived, 0),
      unidadesAsignadas: lotes.reduce((t, l) => t + l.quantityAllocated, 0),
      unidadesEmitidas: lotes.reduce((t, l) => t + l.quantityIssued, 0),
      ofertasActivas,
      comprasAbiertas,
      proveedoresActivos,
    }
  })
}

export interface ActividadSupplyV2 {
  id: string
  cuando: Date
  titulo: string
  detalle: string
  href: string
}

/** Últimos movimientos: eventos de órdenes y asientos del ledger, mezclados por fecha. */
export async function actividadRecienteSupplyV2(limite = 10): Promise<ActividadSupplyV2[]> {
  return sinEmpresa('Supply 2.0: actividad reciente', async (tx) => {
    const [eventos, asientos] = await Promise.all([
      tx.supplyV2PurchaseOrderEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: limite,
        select: {
          id: true,
          type: true,
          reason: true,
          createdAt: true,
          actor: { select: { name: true, email: true } },
          purchaseOrder: { select: { id: true, number: true, supplier: { select: { commercialName: true } } } },
        },
      }),
      tx.supplyV2LedgerEntry.findMany({
        orderBy: { createdAt: 'desc' },
        take: limite,
        select: {
          id: true,
          type: true,
          quantity: true,
          createdAt: true,
          actor: { select: { name: true, email: true } },
          lot: { select: { id: true, code: true, catalogItem: { select: { name: true } } } },
        },
      }),
    ])
    const TITULO: Record<string, string> = {
      CREATED: 'Orden creada',
      SUBMITTED: 'Orden enviada a aprobación',
      APPROVED: 'Orden aprobada',
      REJECTED: 'Orden rechazada',
      CANCELLED: 'Orden cancelada',
      RECEIPT_CONFIRMED: 'Recepción registrada',
      RECEIVED: 'Orden recibida por completo',
    }
    const lista: ActividadSupplyV2[] = [
      ...eventos.map((e) => ({
        id: `e-${e.id}`,
        cuando: e.createdAt,
        titulo: `${TITULO[e.type] ?? e.type} · ${e.purchaseOrder.number}`,
        detalle: [e.purchaseOrder.supplier.commercialName, e.actor?.name ?? e.actor?.email, e.reason].filter(Boolean).join(' · '),
        href: `/superadmin/supply-v2/compras/${e.purchaseOrder.id}`,
      })),
      ...asientos.map((a) => ({
        id: `l-${a.id}`,
        cuando: a.createdAt,
        titulo: `${a.type === 'RECEIPT' ? 'Supply recibido' : a.type} · +${a.quantity.toLocaleString('es-DO')} ${a.lot.catalogItem.name}`,
        detalle: [a.lot.code, a.actor?.name ?? a.actor?.email].filter(Boolean).join(' · '),
        href: `/superadmin/supply-v2/supply/lotes/${a.lot.id}`,
      })),
    ]
    return lista.sort((a, b) => b.cuando.getTime() - a.cuando.getTime()).slice(0, limite)
  })
}

export interface SupplyPorProducto {
  catalogItemId: string
  producto: string
  proveedor: string
  proveedorId: string
  unidad: string
  disponibles: number
  asignadas: number
  reservadas: number
  emitidas: number
  recibidas: number
  valorDisponible: number
  moneda: string
  lotes: number
  proximoVencimiento: Date | null
}

/** El pool agrupado por producto (§37): lo que se ve primero, no los lotes técnicos. */
export async function supplyPorProducto(): Promise<SupplyPorProducto[]> {
  const lotes = await sinEmpresa('Supply 2.0: pool agrupado por producto', (tx) =>
    tx.supplyV2Lot.findMany({
      where: { status: { in: ['ACTIVE', 'EXHAUSTED'] } },
      select: {
        catalogItemId: true,
        quantityAvailable: true,
        quantityAllocated: true,
        quantityReserved: true,
        quantityIssued: true,
        quantityReceived: true,
        unitCost: true,
        currency: true,
        expiresAt: true,
        catalogItem: { select: { name: true, unit: true } },
        supplier: { select: { id: true, commercialName: true } },
      },
    })
  )
  const grupos = new Map<string, SupplyPorProducto>()
  for (const l of lotes) {
    const g = grupos.get(l.catalogItemId) ?? {
      catalogItemId: l.catalogItemId,
      producto: l.catalogItem.name,
      proveedor: l.supplier.commercialName,
      proveedorId: l.supplier.id,
      unidad: l.catalogItem.unit,
      disponibles: 0,
      asignadas: 0,
      reservadas: 0,
      emitidas: 0,
      recibidas: 0,
      valorDisponible: 0,
      moneda: l.currency,
      lotes: 0,
      proximoVencimiento: null,
    }
    g.disponibles += l.quantityAvailable
    g.asignadas += l.quantityAllocated
    g.reservadas += l.quantityReserved
    g.emitidas += l.quantityIssued
    g.recibidas += l.quantityReceived
    g.valorDisponible += l.quantityAvailable * aNumero(l.unitCost)
    g.lotes += 1
    if (l.expiresAt && l.quantityAvailable > 0 && (!g.proximoVencimiento || l.expiresAt < g.proximoVencimiento)) {
      g.proximoVencimiento = l.expiresAt
    }
    grupos.set(l.catalogItemId, g)
  }
  return [...grupos.values()].sort((a, b) => b.disponibles - a.disponibles || a.producto.localeCompare(b.producto))
}

export async function fichaProductoSupply(catalogItemId: string) {
  return sinEmpresa('Supply 2.0: ficha de un producto en el pool', async (tx) => {
    const item = await tx.supplyV2CatalogItem.findUnique({
      where: { id: catalogItemId },
      select: {
        id: true,
        name: true,
        type: true,
        sku: true,
        unit: true,
        publicPrice: true,
        currency: true,
        supplier: { select: { id: true, commercialName: true } },
        lots: {
          orderBy: { receivedAt: 'asc' },
          select: {
            id: true,
            code: true,
            status: true,
            quantityReceived: true,
            quantityAvailable: true,
            quantityAllocated: true,
            quantityReserved: true,
            quantityIssued: true,
            unitCost: true,
            currency: true,
            receivedAt: true,
            expiresAt: true,
            purchaseOrder: { select: { id: true, number: true } },
            receipt: { select: { number: true } },
          },
        },
        orderLines: {
          select: { quantity: true, receivedQuantity: true, purchaseOrder: { select: { status: true } } },
        },
        allocations: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            purpose: true,
            status: true,
            quantity: true,
            allocatedQuantity: true,
            reservedQuantity: true,
            issuedQuantity: true,
            releasedQuantity: true,
            createdAt: true,
            offer: { select: { id: true, code: true, title: true, status: true } },
            lines: { select: { quantity: true, lot: { select: { code: true } } } },
          },
        },
        offers: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, code: true, title: true, status: true, salePrice: true, publicPrice: true, currency: true, startsAt: true, endsAt: true },
        },
      },
    })
    if (!item) return null
    const compradoTotal = item.orderLines
      .filter((l) => !['DRAFT', 'PENDING_APPROVAL', 'CANCELLED'].includes(l.purchaseOrder.status))
      .reduce((t, l) => t + l.quantity, 0)
    const recibido = item.lots.reduce((t, l) => t + l.quantityReceived, 0)
    const disponible = item.lots.reduce((t, l) => t + l.quantityAvailable, 0)
    const asignadas = item.lots.reduce((t, l) => t + l.quantityAllocated, 0)
    const reservadas = item.lots.reduce((t, l) => t + l.quantityReserved, 0)
    const emitidas = item.lots.reduce((t, l) => t + l.quantityIssued, 0)
    const valorAdquirido = item.lots.reduce((t, l) => t + l.quantityReceived * aNumero(l.unitCost), 0)
    const valorDisponible = item.lots.reduce((t, l) => t + l.quantityAvailable * aNumero(l.unitCost), 0)
    return { ...item, resumen: { compradoTotal, recibido, disponible, asignadas, reservadas, emitidas, valorAdquirido, valorDisponible } }
  })
}

export async function fichaLote(id: string) {
  return sinEmpresa('Supply 2.0: ficha de un lote y su ledger', (tx) =>
    tx.supplyV2Lot.findUnique({
      where: { id },
      include: {
        catalogItem: { select: { id: true, name: true, unit: true } },
        supplier: { select: { id: true, commercialName: true } },
        purchaseOrder: { select: { id: true, number: true } },
        receipt: { select: { id: true, number: true, receivedAt: true, receivedBy: { select: { name: true, email: true } } } },
        agreement: { select: { id: true, code: true } },
        agreementVersion: { select: { version: true } },
        ledgerEntries: {
          orderBy: { createdAt: 'asc' },
          include: { actor: { select: { name: true, email: true } } },
        },
      },
    })
  )
}
