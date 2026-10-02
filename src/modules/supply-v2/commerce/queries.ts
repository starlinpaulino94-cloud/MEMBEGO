import 'server-only'

import type { Prisma, SupplyV2EntitlementStatus } from '@prisma/client'
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
  paymentStatus: 'UNPAID' | 'SUBMITTED' | 'CONFIRMED' | 'REJECTED' | 'COVERED_BY_BENEFIT'
  paymentMethod: string | null
  paymentReference: string | null
  paymentRejectedReason: string | null
  cuenta: PaymentAccountRef | null
  currency: string
  subtotal: string
  discount: string
  /** Lo que paga el cliente (§15). */
  total: string
  /** Slice 6: valor contractual, descuento del proveedor y bono de Membego, congelados. */
  contractualValue: string
  supplierDiscountTotal: string
  membegoSubsidyTotal: string
  beneficio: { id: string; code: string; name: string; funding: string } | null
  /** Slice 7 (§25): la campaña y el cupón congelados en la compra. */
  campana: { code: string; name: string } | null
  cupon: string | null
  /**
   * Slice 8 (§16): qué se está comprando. Una membresía NO lleva líneas, ni
   * lote, ni derecho: lo que se entrega es la membresía misma, así que la
   * pantalla tiene que saberlo para no enseñar un carrito vacío.
   */
  kind: 'OFFER' | 'MEMBERSHIP'
  membresia: { plan: string; programa: string; negocio: string | null; dias: number } | null
  expiresAt: Date
  createdAt: Date
  paidAt: Date | null
  lineas: { titulo: string; producto: string; proveedor: string; offerSlug: string; quantity: number; publicUnitPrice: string; saleUnitPrice: string; total: string; contractualValue: string; supplierDiscountAmount: string; membegoSubsidyAmount: string }[]
  derechos: { id: string; producto: string; proveedor: string; precio: string; status: string; expiresAt: Date | null; issuedAt: Date }[]
}

const INCLUDE = {
  lines: { include: { offer: { select: { slug: true, catalogItem: { select: { name: true } }, supplier: { select: { commercialName: true } } } }, benefit: { select: { id: true, code: true, name: true, funding: true } } } },
  entitlements: { include: { catalogItem: { select: { name: true } }, supplier: { select: { commercialName: true } } }, orderBy: { issuedAt: 'asc' as const } },
  campaign: { select: { code: true, name: true } },
  membershipPlan: { select: { name: true, durationDays: true, program: { select: { name: true, supplier: { select: { commercialName: true } } } } } },
} satisfies Prisma.SupplyV2CustomerOrderInclude

type Fila = Prisma.SupplyV2CustomerOrderGetPayload<{ include: typeof INCLUDE }>

function aDto(o: Fila): CompraCliente {
  const beneficio = o.lines.find((l) => l.benefit)?.benefit ?? null
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
    contractualValue: o.contractualValue.toFixed(2),
    supplierDiscountTotal: o.supplierDiscountTotal.toFixed(2),
    membegoSubsidyTotal: o.membegoSubsidyTotal.toFixed(2),
    beneficio: beneficio ? { id: beneficio.id, code: beneficio.code, name: beneficio.name, funding: beneficio.funding } : null,
    campana: o.campaign ? { code: o.campaign.code, name: o.campaign.name } : null,
    cupon: o.couponCodeSnapshot,
    kind: o.kind,
    membresia: o.membershipPlan
      ? {
          plan: o.membershipPlan.name,
          programa: o.membershipPlan.program.name,
          negocio: o.membershipPlan.program.supplier?.commercialName ?? null,
          dias: o.membershipPlan.durationDays,
        }
      : null,
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
      contractualValue: l.contractualValue.toFixed(2),
      supplierDiscountAmount: l.supplierDiscountAmount.toFixed(2),
      membegoSubsidyAmount: l.membegoSubsidyAmount.toFixed(2),
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
  status: SupplyV2EntitlementStatus
  issuedAt: Date
  expiresAt: Date | null
  orderNumber: string
  orderId: string
  /** Slice 3: si ya se entregó, cuándo y dónde (sin datos internos). */
  redencion: { redeemedAt: Date; sucursal: string | null } | null
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
        redemptions: { where: { reversedAt: null }, take: 1, select: { redeemedAt: true, branch: { select: { nombre: true } } } },
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
    redencion: e.redemptions[0] ? { redeemedAt: e.redemptions[0].redeemedAt, sucursal: e.redemptions[0].branch?.nombre ?? null } : null,
  }))
}
