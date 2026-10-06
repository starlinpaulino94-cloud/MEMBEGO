import 'server-only'

import type { SupplyV2CatalogItemType } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { aNumero } from '../core/dinero'
import { ORDEN_ABIERTA, ORDEN_POR_RECIBIR } from '../core/estados'

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
  /** Órdenes enviadas que esperan aprobación. */
  comprasPorAprobar: number
  /** Órdenes aprobadas (pagadas o no) con unidades todavía sin recibir. */
  comprasPorRecibir: number
  /** Órdenes que quedaron recibidas por completo en el mes en curso. */
  comprasRecibidasMes: number
  campanasActivas: number
}

export async function resumenSupplyV2(ahora = new Date()): Promise<ResumenSupplyV2> {
  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1)
  return sinEmpresa('Supply 2.0: tablero', async (tx) => {
    const [lotes, comprasAbiertas, proveedoresActivos, ofertasActivas, comprasPorAprobar, comprasPorRecibir, comprasRecibidasMes, campanasActivas] = await Promise.all([
      tx.supplyV2Lot.findMany({
        where: { status: { in: ['ACTIVE', 'EXHAUSTED'] } },
        select: { quantityAvailable: true, quantityAllocated: true, quantityIssued: true, quantityReceived: true, unitCost: true },
      }),
      tx.supplyV2PurchaseOrder.count({ where: { status: { in: [...ORDEN_ABIERTA] } } }),
      tx.supplyV2Supplier.count({ where: { status: 'ACTIVE' } }),
      tx.supplyV2Offer.count({ where: { status: 'ACTIVE' } }),
      tx.supplyV2PurchaseOrder.count({ where: { status: 'PENDING_APPROVAL' } }),
      tx.supplyV2PurchaseOrder.count({ where: { status: { in: [...ORDEN_POR_RECIBIR] } } }),
      tx.supplyV2PurchaseOrderEvent.count({ where: { type: 'RECEIVED', createdAt: { gte: inicioMes } } }),
      tx.supplyV2Campaign.count({ where: { status: 'ACTIVE' } }),
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
      comprasPorAprobar,
      comprasPorRecibir,
      comprasRecibidasMes,
      campanasActivas,
    }
  })
}

export interface ActividadSupplyV2 {
  id: string
  cuando: Date
  /** Tipo del evento de la orden (`CREATED`, `RECEIVED`…) o del asiento del ledger (`RECEIPT`, `ALLOCATION`…). */
  tipo: string
  origen: 'ORDEN' | 'LEDGER'
  /** Código que identifica el movimiento: número de la orden o código del lote. */
  referencia: string
  /** Motivo escrito al cancelar o rechazar (también va dentro de `detalle`). */
  motivo: string | null
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
    const TITULO_LEDGER: Record<string, string> = {
      RECEIPT: 'Supply recibido',
      ALLOCATION: 'Asignado a oferta',
      RELEASE_ALLOCATION: 'Asignación liberada',
      RESERVATION: 'Reservado',
      RELEASE_RESERVATION: 'Reserva liberada',
      ISSUE: 'Emitido',
      REDEMPTION: 'Redimido',
      REVERSAL: 'Reverso',
      EXPIRATION: 'Vencido',
      ADJUSTMENT: 'Ajuste',
      CANCELLATION: 'Cancelado',
      TRANSFER: 'Transferido',
    }
    const lista: ActividadSupplyV2[] = [
      ...eventos.map((e) => ({
        id: `e-${e.id}`,
        cuando: e.createdAt,
        tipo: e.type,
        origen: 'ORDEN' as const,
        referencia: e.purchaseOrder.number,
        motivo: e.type === 'CANCELLED' || e.type === 'REJECTED' ? e.reason : null,
        titulo: `${TITULO[e.type] ?? e.type} · ${e.purchaseOrder.number}`,
        detalle: [e.purchaseOrder.supplier.commercialName, e.actor?.name ?? e.actor?.email, e.reason].filter(Boolean).join(' · '),
        href: `/superadmin/supply-v2/compras/${e.purchaseOrder.id}`,
      })),
      ...asientos.map((a) => ({
        id: `l-${a.id}`,
        cuando: a.createdAt,
        tipo: a.type,
        origen: 'LEDGER' as const,
        referencia: a.lot.code,
        motivo: null,
        titulo: `${TITULO_LEDGER[a.type] ?? a.type} · +${a.quantity.toLocaleString('es-DO')} ${a.lot.catalogItem.name}`,
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
  sku: string | null
  tipo: SupplyV2CatalogItemType
  proveedor: string
  proveedorId: string
  unidad: string
  disponibles: number
  asignadas: number
  reservadas: number
  emitidas: number
  redimidas: number
  recibidas: number
  valorDisponible: number
  moneda: string
  lotes: number
  proximoVencimiento: Date | null
  descripcion: string | null
  /** Precio público del catálogo (para la proyección de GMV); null si no lo tiene. */
  precioPublico: number | null
  /** Costo por unidad del lote más reciente. */
  costoUnitario: number
  /** El lote recibido más recientemente: código y fecha. */
  /** El lote recibido más recientemente: código, fecha de recepción (día) y momento exacto en que se registró. */
  ultimoLote: { code: string; receivedAt: Date; createdAt: Date } | null
  /** La primera oferta activa del producto (a la que van sus unidades asignadas). */
  ofertaActiva: { code: string; title: string; salePrice: number } | null
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
        quantityRedeemed: true,
        quantityReceived: true,
        unitCost: true,
        currency: true,
        expiresAt: true,
        code: true,
        receivedAt: true,
        createdAt: true,
        catalogItem: { select: { name: true, unit: true, sku: true, type: true, description: true, publicPrice: true } },
        supplier: { select: { id: true, commercialName: true } },
      },
    })
  )
  const ofertas = lotes.length
    ? await sinEmpresa('Supply 2.0: ofertas activas del pool', (tx) =>
        tx.supplyV2Offer.findMany({
          where: { status: 'ACTIVE', catalogItemId: { in: [...new Set(lotes.map((l) => l.catalogItemId))] } },
          orderBy: { createdAt: 'asc' },
          select: { catalogItemId: true, code: true, title: true, salePrice: true },
        })
      )
    : []
  const grupos = new Map<string, SupplyPorProducto>()
  for (const l of lotes) {
    const g = grupos.get(l.catalogItemId) ?? {
      catalogItemId: l.catalogItemId,
      producto: l.catalogItem.name,
      sku: l.catalogItem.sku,
      tipo: l.catalogItem.type,
      proveedor: l.supplier.commercialName,
      proveedorId: l.supplier.id,
      unidad: l.catalogItem.unit,
      disponibles: 0,
      asignadas: 0,
      reservadas: 0,
      emitidas: 0,
      redimidas: 0,
      recibidas: 0,
      valorDisponible: 0,
      moneda: l.currency,
      lotes: 0,
      proximoVencimiento: null,
      descripcion: l.catalogItem.description,
      precioPublico: l.catalogItem.publicPrice === null ? null : aNumero(l.catalogItem.publicPrice),
      costoUnitario: aNumero(l.unitCost),
      ultimoLote: null,
      ofertaActiva: null,
    }
    g.disponibles += l.quantityAvailable
    g.asignadas += l.quantityAllocated
    g.reservadas += l.quantityReserved
    g.emitidas += l.quantityIssued
    g.redimidas += l.quantityRedeemed
    g.recibidas += l.quantityReceived
    g.valorDisponible += l.quantityAvailable * aNumero(l.unitCost)
    g.lotes += 1
    // Por el momento de registro y no por `receivedAt`: este guarda solo el día, y dos lotes del mismo día empatarían.
    if (!g.ultimoLote || l.createdAt > g.ultimoLote.createdAt) {
      g.ultimoLote = { code: l.code, receivedAt: l.receivedAt, createdAt: l.createdAt }
      g.costoUnitario = aNumero(l.unitCost)
    }
    if (l.expiresAt && l.quantityAvailable > 0 && (!g.proximoVencimiento || l.expiresAt < g.proximoVencimiento)) {
      g.proximoVencimiento = l.expiresAt
    }
    grupos.set(l.catalogItemId, g)
  }
  for (const o of ofertas) {
    const g = grupos.get(o.catalogItemId)
    if (g && !g.ofertaActiva) g.ofertaActiva = { code: o.code, title: o.title, salePrice: aNumero(o.salePrice) }
  }
  return [...grupos.values()].sort((a, b) => b.disponibles - a.disponibles || a.producto.localeCompare(b.producto))
}

export interface VerificacionesLotes {
  /** Lotes cuyas cubetas suman lo recibido (disponible + asignado + reservado + emitido + redimido + cerrado). */
  lotesCuadrados: number
  lotesTotal: number
  /** Lotes con unidades disponibles que vencen en los próximos 7 días (o ya vencieron). */
  vencenPronto: number
  /** Líneas de compra con recepción cuyo total recibido coincide con lo que suman sus lotes. */
  lineasConciliadas: number
  lineasConRecepcion: number
}

/** Tres verificaciones sobre los lotes y las compras recibidas, para el panel «Estado de lotes». */
export async function verificacionesLotes(ahora = new Date()): Promise<VerificacionesLotes> {
  const limite = new Date(ahora.getTime() + 7 * 86_400_000)
  return sinEmpresa('Supply 2.0: verificaciones de lotes', async (tx) => {
    const [lotes, lineas] = await Promise.all([
      tx.supplyV2Lot.findMany({
        select: { quantityReceived: true, quantityAvailable: true, quantityAllocated: true, quantityReserved: true, quantityIssued: true, quantityRedeemed: true, quantityClosed: true, expiresAt: true, status: true },
      }),
      tx.supplyV2PurchaseOrderLine.findMany({
        where: { receivedQuantity: { gt: 0 } },
        select: { receivedQuantity: true, lots: { select: { quantityReceived: true } } },
      }),
    ])
    return {
      lotesTotal: lotes.length,
      lotesCuadrados: lotes.filter((l) => l.quantityAvailable + l.quantityAllocated + l.quantityReserved + l.quantityIssued + l.quantityRedeemed + l.quantityClosed === l.quantityReceived).length,
      vencenPronto: lotes.filter((l) => l.status === 'ACTIVE' && l.quantityAvailable > 0 && l.expiresAt && l.expiresAt <= limite).length,
      lineasConRecepcion: lineas.length,
      lineasConciliadas: lineas.filter((ln) => ln.lots.reduce((t, l) => t + l.quantityReceived, 0) === ln.receivedQuantity).length,
    }
  })
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
            quantityRedeemed: true,
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
    const redimidas = item.lots.reduce((t, l) => t + l.quantityRedeemed, 0)
    const valorAdquirido = item.lots.reduce((t, l) => t + l.quantityReceived * aNumero(l.unitCost), 0)
    const valorDisponible = item.lots.reduce((t, l) => t + l.quantityAvailable * aNumero(l.unitCost), 0)
    return { ...item, resumen: { compradoTotal, recibido, disponible, asignadas, reservadas, emitidas, redimidas, valorAdquirido, valorDisponible } }
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
