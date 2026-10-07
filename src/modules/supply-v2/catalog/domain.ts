import type { SupplyV2CatalogItemType, SupplyV2Unit } from '@prisma/client'

/**
 * MEMBEGO SUPPLY · catálogo del proveedor: reglas puras (§8).
 *
 * El nombre NO es el identificador: lo es el id (y el SKU, único por
 * proveedor cuando existe). El `slug` es un identificador legible que se
 * deriva del nombre para que dos «Pizza Grande Pepperoni» del mismo proveedor
 * no se confundan sin que nadie tenga que escribir un id.
 */

export interface DatosItemCatalogo {
  supplierId: string
  type: SupplyV2CatalogItemType
  name: string
  description?: string | null
  sku?: string | null
  externalReference?: string | null
  category?: string | null
  publicPrice?: number | string | null
  currency?: string | null
  unit?: SupplyV2Unit | null
  existingProductId?: string | null
  existingServiceId?: string | null
}

export function slugDeNombre(nombre: string): string {
  const base = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return base || 'item'
}

export function validarItemCatalogo(d: DatosItemCatalogo): string | null {
  if (!d.supplierId) return 'El producto necesita un proveedor.'
  if (!d.name?.trim()) return 'El producto necesita un nombre.'
  if (d.name.trim().length > 160) return 'El nombre del producto es demasiado largo.'
  if (d.publicPrice != null && d.publicPrice !== '') {
    const n = Number(d.publicPrice)
    if (!Number.isFinite(n) || n < 0) return 'El precio público no puede ser negativo.'
  }
  return null
}

const t = (v: string | null | undefined): string | null => (v?.trim() ? v.trim() : null)

export function normalizarItemCatalogo(d: DatosItemCatalogo) {
  return {
    supplierId: d.supplierId,
    type: d.type,
    name: d.name.trim(),
    description: t(d.description),
    sku: t(d.sku)?.toUpperCase() ?? null,
    externalReference: t(d.externalReference),
    category: t(d.category),
    publicPrice: d.publicPrice != null && d.publicPrice !== '' ? String(d.publicPrice) : null,
    currency: (t(d.currency) ?? 'DOP').toUpperCase().slice(0, 3),
    unit: d.unit ?? 'UNIT',
    existingProductId: t(d.existingProductId),
    existingServiceId: t(d.existingServiceId),
  }
}
