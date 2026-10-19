import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SITE_NAME } from '@/lib/site'
import { shareMetadata } from '@/lib/share/metadata'
import { getCompanyPublic } from '@/modules/marketplace/cached'
import { companyIdPorSlug, excursionPublica } from '@/modules/excursiones/catalogo/public-queries'
import { cargarFichaDeExcursion } from '@/modules/comercio/ficha-excursion'
import { rutaDeExcursion } from '@/modules/comercio/rutas'
import { FichaDeExcursion } from '@/components/excursiones/FichaDeExcursion'
import { TraspasoALaApp } from '@/components/public/TraspasoALaApp'

interface ExcursionDetailPageProps {
  params: Promise<{ companySlug: string; excursionSlug: string }>
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
  searchParams,
}: ExcursionDetailPageProps): Promise<Metadata> {
  const { companySlug, excursionSlug } = await params
  const company = await getCompanyPublic(companySlug)
  if (!company) return { title: `Excursión · ${SITE_NAME}` }

  const companyId = await companyIdPorSlug(companySlug)
  if (!companyId) return { title: `Excursión · ${company.name}` }

  const exc = await excursionPublica(companyId, excursionSlug)
  if (!exc) return { title: `Excursión · ${company.name}` }

  const sp = searchParams ? await searchParams : {}
  const eParam = typeof sp?.e === 'string' ? `?e=${encodeURIComponent(sp.e)}` : ''

  return shareMetadata({
    title: `${exc.nombre} · ${company.name}`,
    description: exc.descripcion ?? `Reserva ${exc.nombre} con ${company.name}.`,
    url: `/empresas/${company.slug}/excursiones/${exc.slug}${eParam}`,
    image: exc.portadaUrl ?? undefined,
  })
}

/**
 * Ficha PÚBLICA de una excursión: de CONSULTA, para buscadores y enlaces compartidos. «No existe» y «no es pública» se
 * ven igual.
 *
 * Muestra lo mismo que la ficha de la app (`FichaDeExcursion`: portada, galería, qué incluye, itinerario, precios,
 * políticas), pero NO reserva: ni formulario, ni carrito, ni cajón. Donde estaba el formulario hay el traspaso a la
 * app, que según quién mire lleva a iniciar sesión o crear cuenta, directo a la ficha dentro de `/cliente`, o al propio
 * panel. Esta página ya no lee la sesión: eso lo hace el traspaso desde el navegador.
 *
 * (Sobre el `?e=` del enlace de vendedor: esta página NO lo lee. La atribución ocurre en `/e/[slug]`, que siembra las
 * cookies.)
 */
export default async function ExcursionDetailPage({ params }: ExcursionDetailPageProps) {
  const { companySlug, excursionSlug } = await params
  const ficha = await cargarFichaDeExcursion(companySlug, excursionSlug)
  if (!ficha) notFound()
  const destino = rutaDeExcursion('app', ficha.company.slug, ficha.exc.slug)

  return (
    <FichaDeExcursion
      ficha={ficha}
      espacio="publico"
      ranuraReserva={
        <TraspasoALaApp
          destino={destino}
          titulo="Reservar esta excursión"
          descripcion="Las reservas se hacen dentro de tu cuenta MembeGo."
          etiquetaCliente="Reservar en la app"
        />
      }
    />
  )
}
