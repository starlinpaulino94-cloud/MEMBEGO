import { prisma } from '../../src/lib/prisma'

/**
 * Una oferta de Supply V2 mínima (proveedor, producto, asignación y oferta) para
 * las pruebas que necesitan un ítem de origen SUPPLY: desde la Fase 2.5 la base
 * exige que un ítem `source = SUPPLY` esté ligado a una oferta, así que ya no se
 * puede «marcar» un ítem como de Supply sin una.
 */
export async function ofertaSupplyDePrueba(usuarioId: string, sufijo: string): Promise<string> {
  const unico = `${sufijo}${Math.random().toString(36).slice(2, 6)}`
  const proveedor = await prisma.supplyV2Supplier.create({ data: { source: 'EXTERNAL', commercialName: `Proveedor ${unico}` }, select: { id: true } })
  const producto = await prisma.supplyV2CatalogItem.create({ data: { supplierId: proveedor.id, type: 'SERVICE', name: `Producto ${unico}`, slug: `producto-${unico}` }, select: { id: true } })
  const asignacion = await prisma.supplyV2Allocation.create({ data: { catalogItemId: producto.id, quantity: 10, allocatedQuantity: 10, status: 'ACTIVE', createdById: usuarioId }, select: { id: true } })
  const oferta = await prisma.supplyV2Offer.create({
    data: {
      supplierId: proveedor.id,
      catalogItemId: producto.id,
      allocationId: asignacion.id,
      code: `MBG-OF-T${unico.toUpperCase()}`,
      slug: `oferta-t-${unico}`,
      title: `Oferta ${unico}`,
      sourceType: 'PREPURCHASED_SUPPLY',
      publicPrice: 100,
      salePrice: 80,
      quantityLimit: 10,
      startsAt: new Date(),
      // BORRADOR a propósito: el puente ignora los borradores, así que su barrido (que
      // recorre TODAS las ofertas) no le quita esta oferta a la prueba que la usa.
      status: 'DRAFT',
      createdById: usuarioId,
    },
    select: { id: true },
  })
  return oferta.id
}
