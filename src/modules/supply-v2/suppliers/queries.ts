import 'server-only'

import { sinEmpresa } from '@/lib/tenant'
import { ORDEN_ABIERTA } from '../core/estados'
import { aNumero } from '../core/dinero'

/**
 * MEMBEGO SUPPLY 2.0 · lecturas de proveedores. Cada función abre su propia
 * transacción de plataforma (`sinEmpresa`): Membego mira a todos sus
 * proveedores, que son de empresas distintas.
 */

export interface ProveedorEnLista {
  id: string
  commercialName: string
  source: 'REGISTERED_COMPANY' | 'EXTERNAL'
  status: 'ACTIVE' | 'INACTIVE' | 'BLOCKED'
  contactName: string | null
  whatsapp: string | null
  phone: string | null
  email: string | null
  city: string | null
  productos: number
  comprasAbiertas: number
  createdAt: Date
}

export async function listarProveedores(): Promise<ProveedorEnLista[]> {
  const filas = await sinEmpresa('Supply 2.0: listado de proveedores', (tx) =>
    tx.supplyV2Supplier.findMany({
      orderBy: [{ status: 'asc' }, { commercialName: 'asc' }],
      select: {
        id: true,
        commercialName: true,
        source: true,
        status: true,
        contactName: true,
        whatsapp: true,
        phone: true,
        email: true,
        city: true,
        createdAt: true,
        _count: {
          select: {
            catalogItems: { where: { status: { not: 'ARCHIVED' } } },
            purchaseOrders: { where: { status: { in: [...ORDEN_ABIERTA] } } },
          },
        },
      },
    })
  )
  return filas.map(({ _count, ...p }) => ({ ...p, productos: _count.catalogItems, comprasAbiertas: _count.purchaseOrders }))
}

export async function fichaProveedor(id: string) {
  const p = await sinEmpresa('Supply 2.0: ficha de un proveedor', (tx) =>
    tx.supplyV2Supplier.findUnique({
      where: { id },
      include: {
        company: { select: { id: true, name: true, slug: true, isActive: true } },
        createdBy: { select: { name: true, email: true } },
        catalogItems: {
          where: { status: { not: 'ARCHIVED' } },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, type: true, sku: true, category: true, publicPrice: true, currency: true, unit: true, status: true },
        },
        agreements: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            code: true,
            version: true,
            type: true,
            scope: true,
            status: true,
            negotiatedUnitCost: true,
            currency: true,
            paymentTermsDays: true,
            startsAt: true,
            endsAt: true,
            catalogItem: { select: { id: true, name: true } },
            category: true,
          },
        },
        purchaseOrders: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { id: true, number: true, status: true, total: true, currency: true, createdAt: true, lines: { select: { quantity: true, receivedQuantity: true } } },
        },
        lots: {
          where: { status: 'ACTIVE' },
          select: { quantityAvailable: true, quantityReceived: true, unitCost: true },
        },
      },
    })
  )
  if (!p) return null
  const disponibles = p.lots.reduce((t, l) => t + l.quantityAvailable, 0)
  const recibidas = p.lots.reduce((t, l) => t + l.quantityReceived, 0)
  const valorDisponible = p.lots.reduce((t, l) => t + l.quantityAvailable * aNumero(l.unitCost), 0)
  return { ...p, resumen: { disponibles, recibidas, valorDisponible } }
}

/** Proveedores activos con su catálogo y sus acuerdos vigentes: lo que el wizard necesita. */
export async function proveedoresParaWizard() {
  return sinEmpresa('Supply 2.0: datos del wizard de compra', (tx) =>
    tx.supplyV2Supplier.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { commercialName: 'asc' },
      select: {
        id: true,
        commercialName: true,
        source: true,
        currency: true,
        companyId: true,
        catalogItems: {
          where: { status: 'ACTIVE' },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, type: true, sku: true, category: true, publicPrice: true, currency: true, unit: true },
        },
        agreements: {
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            code: true,
            version: true,
            type: true,
            scope: true,
            status: true,
            catalogItemId: true,
            category: true,
            negotiatedUnitCost: true,
            currency: true,
            paymentTermsDays: true,
            startsAt: true,
            endsAt: true,
          },
        },
      },
    })
  )
}
