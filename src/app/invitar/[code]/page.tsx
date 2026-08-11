import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCampanaPorCodigoInvitacion } from '@/modules/invitaciones/queries'
import { absoluteUrl } from '@/lib/site'
import { shareMetadata } from '@/lib/share/metadata'
import { normalizeInvitaContenido } from '@/lib/invitaContenido'
import { arteDeCampana } from '@/modules/invitaciones/ogCard'
import { CampanaLandingScreen } from '@/components/invitaciones/CampanaLandingScreen'

export const dynamic = 'force-dynamic'

/**
 * MVP "Invita y Gana" · Enlace corto personal: membego.com/invitar/XXXXXX.
 *
 * Renderiza la landing DIRECTAMENTE (no redirige): los robots de vista previa
 * de WhatsApp/Facebook no siguen redirecciones, así que la URL compartida
 * debe responder 200 con sus propios metadatos OG y su opengraph-image para
 * que el enlace siempre muestre la tarjeta grande con imagen.
 */
interface Props {
  params: Promise<{ code: string }>
  /**
   * `c` = campaña que prometía el enlace cuando se compartió (§ fase 7).
   *
   * Sin ella, el enlace servía «la campaña activa AHORA», así que al cambiarla
   * el negocio cambiaba también todos los enlaces ya repartidos: la tarjeta
   * que la gente vio en WhatsApp ofrecía una cosa y la landing, otra.
   */
  searchParams: Promise<{ c?: string }>
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { code } = await params
  const { c } = await searchParams
  const res = await getCampanaPorCodigoInvitacion(code, c)
  if (!res) return {}

  const { campana } = res

  // Share Engine: la config de "Compartir" del editor tiene prioridad. La
  // og:image apunta DIRECTO al CDN cuando hay imagen oficial (respuesta
  // instantánea para el robot de WhatsApp); sin imagen, a /og/campana.
  const compartir = normalizeInvitaContenido(campana.contenido)
  const title = compartir.ogTitulo || campana.titulo
  // La tarjeta se pide por SLUG de la campaña ya resuelta, no por código: con
  // `?code=` la imagen volvía a preguntar «¿cuál está activa?» y podía acabar
  // dibujando una campaña distinta de la que la landing enseña debajo.
  const image =
    arteDeCampana(campana) ??
    absoluteUrl(`/og/campana?slug=${encodeURIComponent(campana.slug)}`)
  const url = absoluteUrl(
    `/invitar/${code}?c=${encodeURIComponent(campana.slug)}`
  )

  return {
    ...shareMetadata({
      title,
      description: compartir.ogDescripcion || campana.descripcion,
      url,
      siteName: campana.company.name,
      image,
    }),
    title: `${title} — ${campana.company.name}`,
  }
}

export default async function InvitarCodePage({ params, searchParams }: Props) {
  const { code } = await params
  const { c } = await searchParams
  const res = await getCampanaPorCodigoInvitacion(code, c)

  // Código desconocido o sin campaña activa: a la portada (nunca un 404 feo
  // para un enlace que alguien recibió por WhatsApp).
  if (!res) redirect('/')

  return <CampanaLandingScreen campana={res.campana} refCode={res.ref} />
}
