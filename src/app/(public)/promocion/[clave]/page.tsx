import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { getPromotionDetail, getPromotionOg } from '@/modules/marketplace/cached'
import { PromotionDetail } from '@/components/marketplace/PromotionDetail'
import { SITE_NAME } from '@/lib/site'
import { shareMetadata } from '@/lib/share/metadata'
import { rutaPublicaPromo } from '@/modules/promociones/slug'

interface PromotionDetailPageProps {
  /** Puede ser el slug («lavado-premium») o el id de siempre. */
  params: Promise<{ clave: string }>
}

export const revalidate = 3600

// Fase E8 · Vista previa enriquecida al compartir (Open Graph + Twitter Cards).
// La imagen la genera dinámicamente opengraph-image.tsx (misma ruta), así que
// aquí solo declaramos textos y URL; Next inyecta la imagen automáticamente.
export async function generateMetadata({
  params,
}: PromotionDetailPageProps): Promise<Metadata> {
  const { clave } = await params
  const og = await getPromotionOg(clave)

  if (!og) {
    return { title: `Promoción · ${SITE_NAME}` }
  }

  // Share Engine: los textos EDITADOS por el negocio tienen prioridad.
  const title = og.ogTitulo || `${og.titulo} · ${og.empresa}`
  const descuento =
    og.descuento && og.descuento > 0 ? `${og.descuento}% de descuento · ` : ''
  const description = (
    og.ogDescripcion ||
    `${descuento}${og.descripcion || `Beneficio de ${og.empresa} en ${SITE_NAME}`}`
  ).slice(0, 200)
  // Share Engine: la imagen la genera opengraph-image.tsx de esta ruta
  // (tarjeta con la imagen oficial de la promo y el descuento protagonista).
  return shareMetadata({
    title,
    description,
    // Siempre la URL canónica (con slug si lo tiene): así los "me gusta" y las
    // vistas previas de las redes no se reparten entre dos direcciones.
    url: rutaPublicaPromo(og),
  })
}

export default async function PromotionDetailPage({
  params,
}: PromotionDetailPageProps) {
  const { clave } = await params

  const promotion = await getPromotionDetail(clave)

  if (!promotion) {
    notFound()
  }

  // Un enlace viejo (con id) de una promoción que ya tiene slug se manda a la
  // dirección con nombre: los enlaces que sigan circulando terminan todos en
  // la misma URL, que es la que se comparte y la que indexan las redes.
  if (promotion.slug && clave === promotion.id) {
    permanentRedirect(rutaPublicaPromo(promotion))
  }

  return <PromotionDetail mode="public" promotion={promotion} />
}
