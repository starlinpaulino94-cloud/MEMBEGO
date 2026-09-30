import { Prisma } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { fallo } from '../core/errores'
import { normalizarItemCatalogo, slugDeNombre, validarItemCatalogo, type DatosItemCatalogo } from './domain'

export interface ItemCreado {
  id: string
  name: string
  slug: string
  sku: string | null
  type: string
  unit: string
  publicPrice: string | null
  currency: string
}

/**
 * Crea un ítem del catálogo del proveedor (§8). `supplierId + sku` único: un
 * SKU repetido en el mismo proveedor falla con un mensaje claro, no con un
 * error de índice. Dos nombres iguales reciben slugs distintos.
 */
export async function crearItemCatalogoEnTx(
  tx: Tx,
  d: DatosItemCatalogo,
  ctx: ContextoAuditoria
): Promise<ItemCreado> {
  const error = validarItemCatalogo(d)
  if (error) fallo('ITEM_INVALIDO', error)
  const datos = normalizarItemCatalogo(d)

  const proveedor = await tx.supplyV2Supplier.findUnique({
    where: { id: datos.supplierId },
    select: { id: true, status: true, companyId: true },
  })
  if (!proveedor) fallo('PROVEEDOR_NO_ENCONTRADO', 'El proveedor no existe.')
  if (proveedor.status === 'BLOCKED') fallo('PROVEEDOR_BLOQUEADO', 'El proveedor está bloqueado.')

  if (datos.sku) {
    const repetido = await tx.supplyV2CatalogItem.findFirst({
      where: { supplierId: datos.supplierId, sku: datos.sku },
      select: { id: true },
    })
    if (repetido) fallo('SKU_DUPLICADO', `El SKU ${datos.sku} ya existe en este proveedor.`)
  }

  // Un vínculo a producto/servicio existente solo vale si pertenece a la
  // empresa del proveedor: no se puede apuntar al catálogo de otra empresa.
  if (datos.existingServiceId) {
    const s = await tx.servicio.findUnique({ where: { id: datos.existingServiceId }, select: { companyId: true } })
    if (!s || s.companyId !== proveedor.companyId) fallo('SERVICIO_AJENO', 'El servicio no pertenece a este proveedor.')
  }
  if (datos.existingProductId) {
    const p = await tx.productoInventario.findUnique({ where: { id: datos.existingProductId }, select: { companyId: true } })
    if (!p || p.companyId !== proveedor.companyId) fallo('PRODUCTO_AJENO', 'El producto no pertenece a este proveedor.')
  }

  // El slug se elige ANTES de insertar: dentro de una transacción de
  // PostgreSQL un INSERT que choca aborta la transacción entera, así que no se
  // puede «probar y reintentar». El índice único sigue siendo la última red.
  const base = slugDeNombre(datos.name)
  const ocupados = new Set(
    (
      await tx.supplyV2CatalogItem.findMany({
        where: { supplierId: datos.supplierId, slug: { startsWith: base } },
        select: { slug: true },
      })
    ).map((x) => x.slug)
  )
  let slug = base
  for (let n = 2; ocupados.has(slug); n++) slug = `${base}-${n}`

  const creado = await tx.supplyV2CatalogItem.create({
    data: {
      ...datos,
      slug,
      publicPrice: datos.publicPrice != null ? new Prisma.Decimal(datos.publicPrice) : null,
      status: 'ACTIVE',
    },
    select: { id: true, name: true, slug: true, sku: true, type: true, unit: true, publicPrice: true, currency: true },
  })
  await auditarEnTx(
    tx,
    ctx,
    'SUPPLY_V2_CATALOG_ITEM_CREATED',
    'SupplyV2CatalogItem',
    creado.id,
    { supplierId: datos.supplierId, name: creado.name, sku: creado.sku, type: creado.type },
    proveedor.companyId
  )
  return { ...creado, publicPrice: creado.publicPrice ? creado.publicPrice.toFixed(2) : null }
}
