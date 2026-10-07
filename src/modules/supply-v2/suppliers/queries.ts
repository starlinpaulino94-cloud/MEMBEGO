import 'server-only'

import type { Prisma } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { ORDEN_ABIERTA } from '../core/estados'
import { aNumero } from '../core/dinero'

/**
 * MEMBEGO SUPPLY · lecturas de proveedores. Cada función abre su propia
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
  const filas = await sinEmpresa('Supply: listado de proveedores', (tx) =>
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

export interface ProveedorEnDirectorio extends ProveedorEnLista {
  taxId: string | null
  address: string | null
  /** Categorías distintas de sus productos vivos, en orden alfabético. */
  categorias: string[]
  /** Suma de sus órdenes de compra emitidas (sin borradores ni canceladas). */
  totalComprado: string
  currency: string
}

export interface FiltroProveedores {
  /** Nombre comercial o legal, RNC, contacto o ciudad. */
  q?: string | null
  source?: 'REGISTERED_COMPANY' | 'EXTERNAL' | null
  status?: 'ACTIVE' | 'INACTIVE' | 'BLOCKED' | null
  /** Categoría de alguno de sus productos. */
  categoria?: string | null
}

/** Directorio de la pantalla Proveedores: filtros en la base y paginación. */
export async function buscarProveedores(f: FiltroProveedores, p: { pagina: number; filas: number }): Promise<{ filas: ProveedorEnDirectorio[]; total: number }> {
  const q = f.q?.trim()
  const where: Prisma.SupplyV2SupplierWhereInput = {
    ...(f.source ? { source: f.source } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.categoria ? { catalogItems: { some: { category: f.categoria, status: { not: 'ARCHIVED' } } } } : {}),
    ...(q
      ? {
          OR: [
            { commercialName: { contains: q, mode: 'insensitive' } },
            { legalName: { contains: q, mode: 'insensitive' } },
            { taxId: { contains: q, mode: 'insensitive' } },
            { contactName: { contains: q, mode: 'insensitive' } },
            { city: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  }
  return sinEmpresa('Supply: directorio de proveedores', async (tx) => {
    const [filas, total] = await Promise.all([
      tx.supplyV2Supplier.findMany({
        where,
        orderBy: [{ status: 'asc' }, { commercialName: 'asc' }],
        skip: (p.pagina - 1) * p.filas,
        take: p.filas,
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
          address: true,
          taxId: true,
          currency: true,
          createdAt: true,
          catalogItems: { where: { status: { not: 'ARCHIVED' } }, select: { category: true } },
          _count: { select: { purchaseOrders: { where: { status: { in: [...ORDEN_ABIERTA] } } } } },
        },
      }),
      tx.supplyV2Supplier.count({ where }),
    ])
    const totales = filas.length
      ? await tx.supplyV2PurchaseOrder.groupBy({
          by: ['supplierId'],
          where: { supplierId: { in: filas.map((f) => f.id) }, status: { notIn: ['DRAFT', 'CANCELLED'] } },
          _sum: { total: true },
        })
      : []
    const totalDe = new Map(totales.map((t) => [t.supplierId, t._sum.total]))
    return {
      total,
      filas: filas.map(({ catalogItems, _count, ...prov }) => ({
        ...prov,
        productos: catalogItems.length,
        comprasAbiertas: _count.purchaseOrders,
        categorias: [...new Set(catalogItems.map((c) => c.category?.trim()).filter((c): c is string => Boolean(c)))].sort((a, b) => a.localeCompare(b, 'es')),
        totalComprado: (totalDe.get(prov.id) ?? null)?.toFixed(2) ?? '0.00',
      })),
    }
  })
}

export interface ResumenProveedores {
  total: number
  activos: number
  registrados: number
  externos: number
  conComprasAbiertas: number
  ordenesAbiertas: number
}

/** Los cuatro indicadores de la pantalla Proveedores. */
export async function resumenProveedores(): Promise<ResumenProveedores> {
  return sinEmpresa('Supply: indicadores de proveedores', async (tx) => {
    const [total, activos, registrados, externos, conComprasAbiertas, ordenesAbiertas] = await Promise.all([
      tx.supplyV2Supplier.count(),
      tx.supplyV2Supplier.count({ where: { status: 'ACTIVE' } }),
      tx.supplyV2Supplier.count({ where: { source: 'REGISTERED_COMPANY' } }),
      tx.supplyV2Supplier.count({ where: { source: 'EXTERNAL' } }),
      tx.supplyV2Supplier.count({ where: { purchaseOrders: { some: { status: { in: [...ORDEN_ABIERTA] } } } } }),
      tx.supplyV2PurchaseOrder.count({ where: { status: { in: [...ORDEN_ABIERTA] } } }),
    ])
    return { total, activos, registrados, externos, conComprasAbiertas, ordenesAbiertas }
  })
}

/** Categorías de producto en uso, para el filtro del directorio. */
export async function categoriasDeProveedores(): Promise<string[]> {
  const filas = await sinEmpresa('Supply: categorías de productos de proveedores', (tx) =>
    tx.supplyV2CatalogItem.findMany({ where: { status: { not: 'ARCHIVED' }, category: { not: null } }, distinct: ['category'], select: { category: true }, orderBy: { category: 'asc' } })
  )
  return filas.map((f) => f.category!).filter((c) => c.trim().length > 0)
}

export async function fichaProveedor(id: string) {
  const p = await sinEmpresa('Supply: ficha de un proveedor', (tx) =>
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
            commissionPercentage: true,
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
  return sinEmpresa('Supply: datos del wizard de compra', (tx) =>
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
