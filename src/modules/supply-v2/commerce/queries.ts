import 'server-only'

import { sinEmpresa } from '@/lib/tenant'
import type { PaymentAccountRef } from '../contracts/gateways'

/**
 * MEMBEGO SUPPLY 2.0 · lecturas del CLIENTE (§46, §52–§53).
 *
 * Todas reciben el `customerId` de la sesión y filtran por él en la consulta:
 * la propiedad se decide en el servidor. Devuelven DTOs sin costos ni lotes.
 */

export interface CompraCliente {
  id: string
  number: string
  status: 'PENDING' | 'AWAITING_PAYMENT' | 'PAID' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED'
  paymentStatus: 'UNPAID' | 'SUBMITTED' | 'CONFIRMED' | 'REJECTED'
  paymentMethod: string | null
  paymentReference: string | null
  paymentRejectedReason: string | null
  cuenta: PaymentAccountRef | null
  currency: string
  subtotal: string
  discount: string
  total: string
  expiresAt: Date
  createdAt: Date
  paidAt: Date | null
  lineas: { titulo: string; producto: string; proveedor: string; offerSlug: string; quantity: number; publicUnitPrice: string; saleUnitPrice: string; total: string }[]
  derechos: { id: string; producto: string; proveedor: string; precio: string; status: string; expiresAt: Date | null; issuedAt: Date }[]
}

const INCLUDE = {
  lines: { include: { offer: { select: { slug: true, catalogItem: { select: { name: true } }, supplier: { select: { commercialName: true } } } } } },
  entitlements: { include: { catalogItem: { select: { name: true } }, supplier: { select: { commercialName: true } } }, orderBy: { issuedAt: 'asc' as const } },
} as const

type Fila = {
  id: string
  number: string
  status: CompraCliente['status']
  paymentStatus: CompraCliente['paymentStatus']
  paymentMethod: string | null
  paymentReference: string | null
  paymentRejectedReason: string | null
  paymentAccountSnapshot: unknown
  currency: string
  subtotal: { toFixed(n: number): string }
  discount: { toFixed(n: number): string }
  total: { toFixed(n: number): string }
  expiresAt: Date
  createdAt: Date
  paidAt: Date | null
  lines: { quantity: number; titleSnapshot: string; publicUnitPrice: { toFixed(n: number): string }; saleUnitPrice: { toFixed(n: number): string }; total: { toFixed(n: number): string }; offer: { slug: string; catalogItem: { name: string }; supplier: { commercialName: string } } }[]
  entitlements: { id: string; status: string; expiresAt: Date | null; issuedAt: Date; customerUnitPrice: { toFixed(n: number): string }; catalogItem: { name: string }; supplier: { commercialName: string } }[]
}

function aDto(o: Fila): CompraCliente {
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod,
    paymentReference: o.paymentReference,
    paymentRejectedReason: o.paymentRejectedReason,
    cuenta: (o.paymentAccountSnapshot as PaymentAccountRef | null) ?? null,
    currency: o.currency,
    subtotal: o.subtotal.toFixed(2),
    discount: o.discount.toFixed(2),
    total: o.total.toFixed(2),
    expiresAt: o.expiresAt,
    createdAt: o.createdAt,
    paidAt: o.paidAt,
    lineas: o.lines.map((l) => ({
      titulo: l.titleSnapshot,
      producto: l.offer.catalogItem.name,
      proveedor: l.offer.supplier.commercialName,
      offerSlug: l.offer.slug,
      quantity: l.quantity,
      publicUnitPrice: l.publicUnitPrice.toFixed(2),
      saleUnitPrice: l.saleUnitPrice.toFixed(2),
      total: l.total.toFixed(2),
    })),
    derechos: o.entitlements.map((e) => ({
      id: e.id,
      producto: e.catalogItem.name,
      proveedor: e.supplier.commercialName,
      precio: e.customerUnitPrice.toFixed(2),
      status: e.status,
      expiresAt: e.expiresAt,
      issuedAt: e.issuedAt,
    })),
  }
}

export async function misCompras(customerId: string): Promise<CompraCliente[]> {
  const filas = await sinEmpresa('Supply 2.0: compras del cliente de la sesión', (tx) =>
    tx.supplyV2CustomerOrder.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, take: 100, include: INCLUDE })
  )
  return filas.map(aDto)
}

/** Solo si la compra es de este cliente; si no, `null` (no se distingue de «no existe»). */
export async function miCompra(customerId: string, orderId: string): Promise<CompraCliente | null> {
  const o = await sinEmpresa('Supply 2.0: una compra del cliente de la sesión', (tx) =>
    tx.supplyV2CustomerOrder.findFirst({ where: { id: orderId, customerId }, include: INCLUDE })
  )
  return o ? aDto(o) : null
}

export interface DerechoCliente {
  id: string
  producto: string
  proveedor: string
  precio: string
  currency: string
  status: string
  issuedAt: Date
  expiresAt: Date | null
  orderNumber: string
  orderId: string
}

export async function misDerechos(customerId: string): Promise<DerechoCliente[]> {
  const filas = await sinEmpresa('Supply 2.0: derechos del cliente de la sesión', (tx) =>
    tx.supplyV2Entitlement.findMany({
      where: { customerId },
      orderBy: { issuedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        status: true,
        issuedAt: true,
        expiresAt: true,
        customerUnitPrice: true,
        currency: true,
        catalogItem: { select: { name: true } },
        supplier: { select: { commercialName: true } },
        order: { select: { id: true, number: true } },
      },
    })
  )
  return filas.map((e) => ({
    id: e.id,
    producto: e.catalogItem.name,
    proveedor: e.supplier.commercialName,
    precio: e.customerUnitPrice.toFixed(2),
    currency: e.currency,
    status: e.status,
    issuedAt: e.issuedAt,
    expiresAt: e.expiresAt,
    orderNumber: e.order.number,
    orderId: e.order.id,
  }))
}
