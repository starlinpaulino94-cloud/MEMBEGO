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
  return {
    title: `${datos?.titulo ?? datos?.empresa.name ?? 'Colección'} · ${SITE_NAME}`,
    robots: { index: false, follow: false },
  }
}

/**
 * La colección de un banner DENTRO DE LA APP: los principales y, debajo, lo de
 * negocios relacionados. Las tarjetas llevan a las fichas de la app, donde se
 * compra. La sesión de cliente la exige el layout de `/cliente`.
 */
export default async function ColeccionEnLaAppPage({ params, searchParams }: Props) {
  const [{ companySlug }, sp] = await Promise.all([params, searchParams])
  const datos = await cargarColeccionDeBanner(companySlug, sp)
  if (!datos) notFound()
  return <ColeccionDeBanner {...datos} espacio="app" />
}
