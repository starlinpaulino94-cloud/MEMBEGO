import 'server-only'

import type { SupplyV2PurchaseOrderStatus } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'

/**
 * MEMBEGO SUPPLY 2.0 · lecturas de compras.
 */

export interface OrdenEnLista {
  id: string
  number: string
  status: SupplyV2PurchaseOrderStatus
  total: string
  currency: string
  proveedor: string
  producto: string
  compradas: number
  recibidas: number
  createdAt: Date
}

export async function listarOrdenes(): Promise<OrdenEnLista[]> {
  const filas = await sinEmpresa('Supply 2.0: listado de órdenes de compra', (tx) =>
    tx.supplyV2PurchaseOrder.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        number: true,
        status: true,
        total: true,
        currency: true,
        createdAt: true,
        supplier: { select: { commercialName: true } },
        lines: { select: { descriptionSnapshot: true, quantity: true, receivedQuantity: true } },
      },
    })
  )
  return filas.map((o) => ({
    id: o.id,
    number: o.number,
    status: o.status,
    total: o.total.toFixed(2),
    currency: o.currency,
    proveedor: o.supplier.commercialName,
    producto:
      o.lines.length === 1
        ? o.lines[0]!.descriptionSnapshot
        : `${o.lines[0]?.descriptionSnapshot ?? ''} y ${o.lines.length - 1} más`,
    compradas: o.lines.reduce((t, l) => t + l.quantity, 0),
    recibidas: o.lines.reduce((t, l) => t + l.receivedQuantity, 0),
    createdAt: o.createdAt,
  }))
}

export async function fichaOrden(id: string) {
  return sinEmpresa('Supply 2.0: ficha de una orden de compra', (tx) =>
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
  return sinEmpresa('Supply 2.0: sucursales del proveedor para la recepción', async (tx) => {
    const p = await tx.supplyV2Supplier.findUnique({ where: { id: supplierId }, select: { companyId: true } })
    if (!p?.companyId) return []
    return tx.sucursal.findMany({
      where: { companyId: p.companyId, activa: true },
      orderBy: { nombre: 'asc' },
      select: { id: true, nombre: true },
    })
  })
}
