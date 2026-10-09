import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SITE_NAME } from '@/lib/site'
import { getItemCatalogoPublico } from '@/modules/marketplace/cached'
import { cargarFichaDeItem } from '@/modules/comercio/ficha-item'
import { rutaDeItem } from '@/modules/comercio/rutas'
import { FichaDeItem } from '@/components/catalogo/FichaDeItem'
import { CompraDeLaFicha, OfertaDeLaFicha } from '@/components/catalogo/AccionesDeCompra'

interface Props {
  params: Promise<{ companySlug: string; itemSlug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { companySlug, itemSlug } = await params
  const item = await getItemCatalogoPublico(companySlug, itemSlug)
  // La app no se indexa: su ficha es la de la landing, que es la que se comparte.
  return { title: `${item?.name ?? 'Producto'} · ${SITE_NAME}`, robots: { index: false, follow: false } }
}

/**
 * La ficha de un producto o servicio DENTRO DE LA APP: aquí se obtiene la oferta,
 * se agrega al carrito, se pide y se reserva. Lo mismo que se ve en la landing
 * (`FichaDeItem`), con los botones de verdad en lugar del traspaso.
 *
 * La sesión de CLIENTE la exige el layout de `/cliente`. «No existe» y «no es
 * público» se ven igual que en la landing: mismo cargador.
 */
export default async function FichaDeItemEnLaAppPage({ params }: Props) {
  const { companySlug, itemSlug } = await params
  const ficha = await cargarFichaDeItem(companySlug, itemSlug)
  if (!ficha) notFound()
  const retorno = rutaDeItem('app', ficha.item.company.slug, ficha.item.slug)
  return (
    <FichaDeItem
      ficha={ficha}
      espacio="app"
      ranuraOferta={<OfertaDeLaFicha ficha={ficha} retorno={retorno} />}
      ranuraCompra={<CompraDeLaFicha ficha={ficha} retorno={retorno} />}
    />
  )
}
