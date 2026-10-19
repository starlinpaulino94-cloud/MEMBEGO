import type { Tx } from '@/lib/tenant'
import { decimal, redondear2 } from '@/lib/commerce-primitives/dinero'
import { auditarEnTx, type ContextoAuditoria } from '@/modules/supply-v2/core/auditoria'
import { fallo } from '@/modules/supply-v2/core/errores'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · el MINI CATÁLOGO del proveedor (§26).
 *
 * No es un Commerce Catalog: son filas de `SupplyV2CatalogItem` (el catálogo
 * del proveedor que Supply ya tiene) marcadas `sellableAsExtra`, con nombre,
 * precio y activo. Sirven para registrar ventas adicionales en una visita con
 * precio releído del servidor. Cuando el proveedor sea Merchant, `catalogItemId`
 * las mapea al catálogo unificado sin duplicarlas (§20, §26).
 */

function slugDe(nombre: string): string {
  return nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'extra'
}

export async function guardarExtraEnTx(
  tx: Tx,
  d: { supplierId: string; companyId: string; id?: string | null; name: string; price: string | number; activo: boolean },
  ctx: ContextoAuditoria
): Promise<{ id: string; creado: boolean }> {
  const name = d.name.trim()
  if (name.length < 2 || name.length > 160) fallo('EXTRA_INVALIDO', 'El nombre del extra tiene que tener entre 2 y 160 caracteres.')
  let price
  try {
    price = redondear2(decimal(d.price))
  } catch {
    fallo('EXTRA_INVALIDO', 'El precio no es un número.')
  }
  if (!price.isFinite() || price.isNegative() || price.greaterThan('1000000')) fallo('EXTRA_INVALIDO', 'El precio no es válido.')

  const supplier = await tx.supplyV2Supplier.findUnique({ where: { id: d.supplierId }, select: { id: true, companyId: true } })
  if (!supplier || supplier.companyId !== d.companyId) fallo('PROVEEDOR_AJENO', 'Ese proveedor no es el de tu empresa.')

  if (d.id) {
    const existente = await tx.supplyV2CatalogItem.findFirst({ where: { id: d.id, supplierId: d.supplierId }, select: { id: true, sellableAsExtra: true, agreements: { where: { status: 'ACTIVE' }, select: { id: true } } } })
    if (!existente) fallo('EXTRA_NO_ENCONTRADO', 'Ese extra no es de tu catálogo.')
    // Un ítem que Membego compra (con acuerdo activo) puede venderse también como extra, pero su nombre lo administra Membego.
    const esDeMembego = existente.agreements.length > 0
    await tx.supplyV2CatalogItem.update({
      where: { id: existente.id },
      data: { ...(esDeMembego ? {} : { name }), publicPrice: price, sellableAsExtra: true, status: d.activo ? 'ACTIVE' : 'INACTIVE' },
    })
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_CATALOG_ITEM_CREATED', 'SupplyV2CatalogItem', existente.id, { extra: true, accion: 'actualizado', name, price: price.toFixed(2), activo: d.activo }, d.companyId)
    return { id: existente.id, creado: false }
  }

  // Slug único dentro del proveedor.
  const base = slugDe(name)
  let slug = base
  let n = 1
  while (await tx.supplyV2CatalogItem.findUnique({ where: { supplierId_slug: { supplierId: d.supplierId, slug } }, select: { id: true } })) {
    n += 1
    slug = `${base}-${n}`
  }
  const creado = await tx.supplyV2CatalogItem.create({
    data: { supplierId: d.supplierId, type: 'PRODUCT', name, slug, publicPrice: price, currency: 'DOP', unit: 'UNIT', status: d.activo ? 'ACTIVE' : 'INACTIVE', sellableAsExtra: true, fulfillmentBacking: 'ON_DEMAND' },
    select: { id: true },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_CATALOG_ITEM_CREATED', 'SupplyV2CatalogItem', creado.id, { extra: true, accion: 'creado', name, price: price.toFixed(2), activo: d.activo }, d.companyId)
  return { id: creado.id, creado: true }
}

/**
 * Promoción al catálogo unificado cuando el proveedor ya es Merchant (§26):
 * se MAPEA el extra a un `CatalogItem` existente de la misma empresa, sin
 * duplicar. Crear el ítem del catálogo es trabajo del módulo de catálogo.
 */
export async function mapearExtraAlCatalogoEnTx(tx: Tx, d: { supplierId: string; companyId: string; extraId: string; catalogItemId: string | null }, ctx: ContextoAuditoria): Promise<void> {
  const extra = await tx.supplyV2CatalogItem.findFirst({ where: { id: d.extraId, supplierId: d.supplierId }, select: { id: true, supplier: { select: { companyId: true } } } })
  if (!extra || extra.supplier.companyId !== d.companyId) fallo('EXTRA_NO_ENCONTRADO', 'Ese extra no es de tu catálogo.')
  if (d.catalogItemId) {
    const item = await tx.catalogItem.findFirst({ where: { id: d.catalogItemId, companyId: d.companyId }, select: { id: true } })
    if (!item) fallo('ITEM_AJENO', 'Ese producto del catálogo no es de tu empresa.')
  }
  await tx.supplyV2CatalogItem.update({ where: { id: extra.id }, data: { catalogItemId: d.catalogItemId } })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_CATALOG_ITEM_CREATED', 'SupplyV2CatalogItem', extra.id, { extra: true, accion: 'mapeado', catalogItemId: d.catalogItemId }, d.companyId)
}
