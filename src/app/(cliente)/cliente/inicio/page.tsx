import { requireRole } from '@/lib/auth/guards'
import { cargarPanelPersonal } from '@/modules/cliente/panelPersonal'
import { getInicioVista } from '@/modules/home/lectura'
import { getCatalogoPublicoGlobal } from '@/modules/marketplace/cached'
import { ofertasPublicas } from '@/modules/deals/publico'
import { InicioRetail } from '@/components/cliente/inicio/InicioRetail'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Inicio',
  description: 'Descubre beneficios cerca de ti y consulta tus membresías',
}

export default async function InicioCliente({
  searchParams,
}: {
  searchParams?: Promise<{ categoria?: string; category?: string }>
}) {
  const user = await requireRole('CLIENTE')
  const params = await searchParams
  const categoria =
    typeof params?.categoria === 'string'
      ? params.categoria
      : typeof params?.category === 'string'
        ? params.category
        : undefined

  // Las dos mitades se piden a la vez. La comercial SIEMPRE existe: sin
  // composición publicada se arma con los datos del marketplace, así que el
  // diseño no depende de ningún acto administrativo para verse.
  const [comercial, personal, ofertas, novedades] = await Promise.all([
    getInicioVista(user, categoria),
    cargarPanelPersonal(user),
    // Commerce Core: ofertas vivas sobre el catálogo y lo último publicado, con la
    // misma categoría activa que el resto del inicio. Best-effort: sin ellas el
    // inicio sigue entero.
    ofertasPublicas({ limite: 8, categoriaNegocio: categoria }).catch(() => []),
    getCatalogoPublicoGlobal({ limite: 8, origen: 'EMPRESAS', categoriaNegocio: categoria }).catch(() => ({ items: [], hayMas: false })),
  ])
  return <InicioRetail comercial={comercial} personal={personal} comercio={{ ofertas, productos: novedades.items }} />
}
