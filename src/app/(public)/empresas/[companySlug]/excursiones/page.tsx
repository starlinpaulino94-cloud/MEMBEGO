import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SITE_NAME } from '@/lib/site'
import { shareMetadata } from '@/lib/share/metadata'
import { getCompanyPublic } from '@/modules/marketplace/cached'
import { cargarExcursionesDeEmpresa } from '@/modules/comercio/lista-excursiones'
import { ListaDeExcursionesDeEmpresa } from '@/components/excursiones/ListaDeExcursionesDeEmpresa'

interface ExcursionesPageProps {
  params: Promise<{ companySlug: string }>
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
  searchParams,
}: ExcursionesPageProps): Promise<Metadata> {
  const { companySlug } = await params
  const company = await getCompanyPublic(companySlug)
  if (!company) return { title: `Excursiones · ${SITE_NAME}` }

  const sp = searchParams ? await searchParams : {}
  const eParam = typeof sp?.e === 'string' ? `?e=${encodeURIComponent(sp.e)}` : ''

  return shareMetadata({
    title: `Excursiones · ${company.name}`,
    description: `Descubre las próximas excursiones y experiencias disponibles de ${company.name}. Reserva tu cupo fácilmente.`,
    url: `/empresas/${company.slug}/excursiones${eParam}`,
  })
}

/**
 * Lista PÚBLICA de las excursiones de una empresa: de CONSULTA, para buscadores y enlaces compartidos. Cada tarjeta
 * lleva a la ficha pública, que a su vez traspasa a la app para reservar. La lista de la app es
 * `/cliente/empresas/[slug]/excursiones` y comparte esta misma presentación.
 */
export default async function ExcursionesPage({ params, searchParams }: ExcursionesPageProps) {
  const { companySlug } = await params
  const sp = searchParams ? await searchParams : {}
  const enlaceVendedor = typeof sp?.e === 'string' ? sp.e : undefined
  const datos = await cargarExcursionesDeEmpresa(companySlug)
  if (!datos) notFound()
  return <ListaDeExcursionesDeEmpresa datos={datos} espacio="publico" enlaceVendedor={enlaceVendedor} />
}
