import type { Metadata } from 'next'
import { OG_SIZE } from '@/lib/share/og'
import { SITE_NAME } from '@/lib/site'

/**
 * Share Engine · metadatos de compartición unificados.
 *
 * Toda ruta pública compartible (promoción, plan, empresa, campaña,
 * invitación) construye sus metadatos con este helper para que el enlace se
 * muestre como tarjeta enriquecida en WhatsApp/Facebook/Telegram/X:
 * og:title/description/image/url/type + twitter:card/title/description/image.
 *
 * La imagen puede venir explícita (`image`) o, si se omite, la aporta el
 * `opengraph-image.tsx` de la ruta (Next inyecta og:image y twitter:image
 * apuntando a la tarjeta generada — ver src/lib/share/og.tsx).
 */
export interface ShareMetadataInput {
  title: string
  description: string
  /** Ruta canónica del enlace (relativa a metadataBase o absoluta). */
  url: string
  siteName?: string
  /** Imagen explícita en `OG_SIZE`. Omitir si la ruta tiene opengraph-image.tsx. */
  image?: string | null
  imageAlt?: string
  type?: 'website' | 'article'
}

export function shareMetadata({
  title,
  description: rawDescription,
  url,
  siteName = SITE_NAME,
  image,
  imageAlt,
  type = 'website',
}: ShareMetadataInput): Metadata {
  const description = rawDescription.slice(0, 200)

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type,
      title,
      description,
      url,
      siteName,
      locale: 'es_DO',
      // Las dimensiones declaradas tienen que ser las REALES de la tarjeta: con
      // ellas WhatsApp reserva el hueco antes de descargarla. Si mienten, la
      // vista previa salta de tamaño al cargar.
      ...(image
        ? {
            images: [
              { url: image, width: OG_SIZE.width, height: OG_SIZE.height, alt: imageAlt ?? title },
            ],
          }
        : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  }
}
