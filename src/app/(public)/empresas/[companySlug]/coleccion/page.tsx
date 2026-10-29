import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SITE_NAME } from '@/lib/site'
import { cargarColeccionDeBanner } from '@/modules/home/coleccion-carga'
import { ColeccionDeBanner } from '@/components/catalogo/ColeccionDeBanner'

interface Props {
  params: Promise<{ companySlug: string }>
  searchParams: Promise<{ i?: string | string[]; t?: string | string[] }>
}

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ companySlug }, sp] = await Promise.all([params, searchParams])
  const datos = await cargarColeccionDeBanner(companySlug, sp)
  // Los ids viajan en la consulta: una URL así no es canónica ni se indexa.
  return {
    title: `${datos?.titulo ?? datos?.empresa.name ?? 'Colección'} · ${SITE_NAME}`,
    robots: { index: false, follow: true },
  }
}

/**
 * La colección de un banner en la LANDING: de consulta. Las tarjetas llevan a
 * las fichas públicas, que ofrecen el traspaso a la app para comprar.
 */
export default async function ColeccionPublicaPage({ params, searchParams }: Props) {
  const [{ companySlug }, sp] = await Promise.all([params, searchParams])
  const datos = await cargarColeccionDeBanner(companySlug, sp)
  if (!datos) notFound()
  return <ColeccionDeBanner {...datos} espacio="publico" />
}
