import { asegurarUsuario, prismaDeArnes } from './supply-v2-sesion'

/**
 * ARNÉS DE SIEMBRA · el puente Supply → Catálogo (E2E).
 *
 * Siembra por Prisma el proveedor, su producto y las ofertas de Supply 2.0 que
 * el puente refleja. Lo que la prueba verifica (designar la casa, sincronizar,
 * pausar una oferta desde Supply, lo que ve el público) lo hace por la
 * interfaz, nunca por aquí.
 */

export interface OfertaSembrada {
  id: string
  slug: string
  code: string
  title: string
}

export async function ofertasDeSupply(sufijo: string, titulos: string[]): Promise<OfertaSembrada[]> {
  const prisma = prismaDeArnes()
  const creador = await asegurarUsuario('compras')
  const proveedor = await prisma.supplyV2Supplier.create({ data: { source: 'EXTERNAL', commercialName: `Proveedor Puente ${sufijo}` }, select: { id: true } })
  const producto = await prisma.supplyV2CatalogItem.create({
    data: { supplierId: proveedor.id, type: 'SERVICE', name: `Servicio puente ${sufijo}`, slug: `servicio-puente-${sufijo}` },
    select: { id: true },
  })
  const out: OfertaSembrada[] = []
  for (const [i, title] of titulos.entries()) {
    const code = `MBG-OF-E2E${sufijo.toUpperCase()}-${String(i + 1).padStart(4, '0')}`
    // Una asignación de 100 unidades libres: lo mínimo para que Supply dé la oferta por «con unidades».
    const asignacion = await prisma.supplyV2Allocation.create({
      data: { catalogItemId: producto.id, quantity: 100, allocatedQuantity: 100, status: 'ACTIVE', createdById: creador.id },
      select: { id: true },
    })
    const o = await prisma.supplyV2Offer.create({
      data: {
        supplierId: proveedor.id,
        catalogItemId: producto.id,
        allocationId: asignacion.id,
        code,
        slug: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${code.toLowerCase()}`,
        title,
        description: 'Oferta sembrada para el E2E del puente',
        sourceType: 'PREPURCHASED_SUPPLY',
        publicPrice: 1000,
        salePrice: 650.5,
        quantityLimit: 100,
        startsAt: new Date(Date.now() - 3_600_000),
        status: 'ACTIVE',
        createdById: creador.id,
        publishedById: creador.id,
        publishedAt: new Date(),
      },
      select: { id: true, slug: true, code: true },
    })
    out.push({ ...o, title })
  }
  return out
}
