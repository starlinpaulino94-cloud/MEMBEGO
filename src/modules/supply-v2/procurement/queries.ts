import 'server-only'

import type { Prisma, SupplyV2CatalogItemType, SupplyV2PaymentMode, SupplyV2PurchaseOrderStatus } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { ORDEN_ABIERTA, ORDEN_POR_RECIBIR } from '../core/estados'

/**
 * MEMBEGO SUPPLY · lecturas de compras.
 */

export interface OrdenEnLista {
  id: string
  number: string
  status: SupplyV2PurchaseOrderStatus
  total: string
  currency: string
  proveedor: string
  /** El proveedor es una empresa registrada en Membego (y no un proveedor externo). */
  proveedorEnMembego: boolean
  producto: string
  /** SKU y categoría del producto cuando la orden tiene una sola línea. */
  sku: string | null
  categoria: string | null
  tipoProducto: SupplyV2CatalogItemType | null
  /** Costo por unidad cuando la orden tiene una sola línea. */
  costoUnitario: string | null
  compradas: number
  recibidas: number
  paymentMode: SupplyV2PaymentMode
  /** Días de crédito del acuerdo, si los tiene. */
  plazoDias: number | null
  creadaPor: string | null
  createdAt: Date
}

const SELECT_ORDEN = {
  id: true,
  number: true,
  status: true,
  total: true,
  currency: true,
  paymentMode: true,
  createdAt: true,
  createdBy: { select: { name: true, email: true } },
  supplier: { select: { commercialName: true, companyId: true } },
  agreement: { select: { paymentTermsDays: true } },
  lines: { select: { descriptionSnapshot: true, quantity: true, receivedQuantity: true, unitCost: true, catalogItem: { select: { sku: true, category: true, type: true } } } },
} satisfies Prisma.SupplyV2PurchaseOrderSelect

type OrdenSeleccionada = Prisma.SupplyV2PurchaseOrderGetPayload<{ select: typeof SELECT_ORDEN }>

function aOrdenEnLista(o: OrdenSeleccionada): OrdenEnLista {
  const unica = o.lines.length === 1 ? o.lines[0]! : null
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    total: o.total.toFixed(2),
    currency: o.currency,
    proveedor: o.supplier.commercialName,
    proveedorEnMembego: o.supplier.companyId !== null,
    producto:
      o.lines.length === 1
        ? o.lines[0]!.descriptionSnapshot
        : `${o.lines[0]?.descriptionSnapshot ?? ''} y ${o.lines.length - 1} más`,
    sku: unica?.catalogItem.sku ?? null,
    categoria: unica?.catalogItem.category ?? null,
    tipoProducto: unica?.catalogItem.type ?? null,
    costoUnitario: unica ? unica.unitCost.toFixed(2) : null,
    compradas: o.lines.reduce((t, l) => t + l.quantity, 0),
    recibidas: o.lines.reduce((t, l) => t + l.receivedQuantity, 0),
    paymentMode: o.paymentMode,
    plazoDias: o.agreement.paymentTermsDays,
    creadaPor: o.createdBy.name ?? o.createdBy.email,
    createdAt: o.createdAt,
  }
}

export async function listarOrdenes(): Promise<OrdenEnLista[]> {
  const filas = await sinEmpresa('Supply: listado de órdenes de compra', (tx) =>
    tx.supplyV2PurchaseOrder.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: SELECT_ORDEN,
    })
  )
  return filas.map(aOrdenEnLista)
}

export interface FiltroOrdenes {
  /** Número de orden, proveedor, producto o SKU. */
  q?: string | null
  supplierId?: string | null
  status?: SupplyV2PurchaseOrderStatus | null
  paymentMode?: SupplyV2PaymentMode | null
}

/** Listado filtrado y paginado de la pantalla Compras: los filtros se aplican en la base. */
export async function buscarOrdenes(f: FiltroOrdenes, p: { pagina: number; filas: number }): Promise<{ filas: OrdenEnLista[]; total: number }> {
  const q = f.q?.trim()
  const where: Prisma.SupplyV2PurchaseOrderWhereInput = {
    ...(f.supplierId ? { supplierId: f.supplierId } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.paymentMode ? { paymentMode: f.paymentMode } : {}),
    ...(q
      ? {
          OR: [
            { number: { contains: q, mode: 'insensitive' } },
            { supplier: { commercialName: { contains: q, mode: 'insensitive' } } },
            { lines: { some: { descriptionSnapshot: { contains: q, mode: 'insensitive' } } } },
            { lines: { some: { catalogItem: { sku: { contains: q, mode: 'insensitive' } } } } },
          ],
        }
      : {}),
  }
  const [filas, total] = await sinEmpresa('Supply: búsqueda de órdenes de compra', (tx) =>
    Promise.all([
      tx.supplyV2PurchaseOrder.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (p.pagina - 1) * p.filas, take: p.filas, select: SELECT_ORDEN }),
      tx.supplyV2PurchaseOrder.count({ where }),
    ])
  )
  return { filas: filas.map(aOrdenEnLista), total }
}

export interface ResumenCompras {
  abiertas: number
  borradores: number
  porAprobar: number
  porRecibir: number
  /** La orden por recibir más reciente y cuántas unidades le faltan. */
  siguienteRecepcion: { id: string; number: string; faltan: number } | null
  recibidasMes: number
  unidadesRecibidasMes: number
}

/** Los cuatro indicadores de la pantalla Compras. */
export async function resumenCompras(ahora = new Date()): Promise<ResumenCompras> {
  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1)
  return sinEmpresa('Supply: indicadores de compras', async (tx) => {
    const [abiertas, borradores, porAprobar, porRecibir, siguiente, recibidasMes, unidadesMes] = await Promise.all([
      tx.supplyV2PurchaseOrder.count({ where: { status: { in: [...ORDEN_ABIERTA] } } }),
      tx.supplyV2PurchaseOrder.count({ where: { status: 'DRAFT' } }),
      tx.supplyV2PurchaseOrder.count({ where: { status: 'PENDING_APPROVAL' } }),
      tx.supplyV2PurchaseOrder.count({ where: { status: { in: [...ORDEN_POR_RECIBIR] } } }),
      tx.supplyV2PurchaseOrder.findFirst({
        where: { status: { in: [...ORDEN_POR_RECIBIR] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, number: true, lines: { select: { quantity: true, receivedQuantity: true } } },
      }),
      tx.supplyV2PurchaseOrderEvent.count({ where: { type: 'RECEIVED', createdAt: { gte: inicioMes } } }),
      tx.supplyV2LedgerEntry.aggregate({ where: { type: 'RECEIPT', createdAt: { gte: inicioMes } }, _sum: { quantity: true } }),
    ])
    return {
      abiertas,
      borradores,
      porAprobar,
      porRecibir,
      siguienteRecepcion: siguiente
        ? { id: siguiente.id, number: siguiente.number, faltan: siguiente.lines.reduce((t, l) => t + Math.max(0, l.quantity - l.receivedQuantity), 0) }
        : null,
      recibidasMes,
      unidadesRecibidasMes: unidadesMes._sum.quantity ?? 0,
    }
  })
}

/** Proveedores para el filtro de Compras: los que tienen al menos una orden. */
export async function proveedoresConOrdenes(): Promise<{ id: string; nombre: string }[]> {
  const filas = await sinEmpresa('Supply: proveedores con órdenes de compra', (tx) =>
    tx.supplyV2Supplier.findMany({ where: { purchaseOrders: { some: {} } }, orderBy: { commercialName: 'asc' }, select: { id: true, commercialName: true } })
  )
  return filas.map((f) => ({ id: f.id, nombre: f.commercialName }))
}

export async function fichaOrden(id: string) {
  return sinEmpresa('Supply: ficha de una orden de compra', (tx) =>
    tx.supplyV2PurchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, commercialName: true, companyId: true } },
        agreement: { select: { id: true, code: true, type: true, version: true } },
        agreementVersion: { select: { version: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        approvedBy: { select: { id: true, name: true, email: true } },
        lines: {
          orderBy: { createdAt: 'asc' },
          include: { catalogItem: { select: { id: true, name: true, unit: true } } },
        },
        receipts: {
          orderBy: { receivedAt: 'asc' },
          include: {
            receivedBy: { select: { name: true, email: true } },
            branch: { select: { nombre: true } },
            lines: { include: { lot: { select: { id: true, code: true } } } },
          },
        },
        events: {
          orderBy: { createdAt: 'asc' },
          include: { actor: { select: { name: true, email: true } } },
        },
        lots: { orderBy: { createdAt: 'asc' }, select: { id: true, code: true, quantityReceived: true, quantityAvailable: true, expiresAt: true } },
      },
    })
  )
}

/** Sucursales de un proveedor registrado (para «Sucursal opcional» al recibir). */
export async function sucursalesDeProveedor(supplierId: string) {
  return sinEmpresa('Supply: sucursales del proveedor para la recepción', async (tx) => {
    const p = await tx.supplyV2Supplier.findUnique({ where: { id: supplierId }, select: { companyId: true } })
    if (!p?.companyId) return []
    return tx.sucursal.findMany({
      where: { companyId: p.companyId, activa: true },
      orderBy: { nombre: 'asc' },
      select: { id: true, nombre: true },
    })
  })
}
