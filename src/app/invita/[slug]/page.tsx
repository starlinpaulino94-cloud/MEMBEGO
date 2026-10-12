import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getCampanaBySlug } from '@/modules/invitaciones/queries'
import { landingUrlFor } from '@/lib/site'
import { shareMetadata } from '@/lib/share/metadata'
import { normalizeInvitaContenido } from '@/lib/invitaContenido'
import { arteDeCampana } from '@/modules/invitaciones/ogCard'
import { CampanaLandingScreen } from '@/components/invitaciones/CampanaLandingScreen'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | undefined>>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const campana = await getCampanaBySlug(slug)
  if (!campana) return {}

  // Share Engine: la config de "Compartir" del editor tiene prioridad sobre
  // los datos base. La og:image apunta DIRECTO al CDN cuando hay imagen
  // oficial (respuesta instantánea para el robot de WhatsApp, que corta a los
  // ~5 s); sin imagen, a la tarjeta compuesta de /og/campana.
  const compartir = normalizeInvitaContenido(campana.contenido)
  const title = compartir.ogTitulo || campana.titulo
  const image =
    arteDeCampana(campana) ?? landingUrlFor(`/og/campana?slug=${encodeURIComponent(slug)}`)

  return {
    ...shareMetadata({
      title,
      description: compartir.ogDescripcion || campana.descripcion,
      url: landingUrlFor(`/invita/${slug}`),
      siteName: campana.company.name,
      image,
    }),
    title: `${title} — ${campana.company.name}`,
  }
}

export default async function CampanaLandingPage({ params, searchParams }: Props) {
  const { slug } = await params
  const sp = await searchParams
  const campana = await getCampanaBySlug(slug)

  if (!campana || campana.estado === 'BORRADOR') notFound()

  return <CampanaLandingScreen campana={campana} refCode={sp.ref ?? ''} />
}
