import { getCatalogoDeEmpresasRelacionadas, getCompanyPublic, getItemsPublicosPorIds } from '@/modules/marketplace/cached'
import { ofertasPublicas } from '@/modules/deals/publico'
import { limpiarTituloDeColeccion, parsearIdsDeColeccion } from './coleccion'

/**
 * Carga de la página de colección, común a la app y a la landing. `null` = la
 * empresa no existe o no es pública, o no queda ningún principal visible (los
 * tres casos se ven igual desde fuera: «no encontrado»).
 */
export async function cargarColeccionDeBanner(
  companySlug: string,
  sp: { i?: string | string[]; t?: string | string[] },
) {
  const ids = parsearIdsDeColeccion(sp.i)
  if (ids.length === 0) return null
  const empresa = await getCompanyPublic(companySlug)
  if (!empresa) return null
  const [principales, relacionados, ofertas] = await Promise.all([
    getItemsPublicosPorIds(empresa.id, ids),
    getCatalogoDeEmpresasRelacionadas(empresa.id, 12).catch(() => []),
    // Las ofertas vivas de la empresa y de la red: para «antes / ahora» en las tarjetas que la tengan.
    ofertasPublicas({ limite: 60 }).catch(() => []),
  ])
  if (principales.length === 0) return null
  return {
    titulo: limpiarTituloDeColeccion(sp.t),
    empresa: { name: empresa.name, slug: empresa.slug },
    principales,
    relacionados,
    ofertas,
  }
}
