import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CompanyProfile } from '@/components/marketplace/CompanyProfile'
import {
  getCompanyPublic,
  getCompanyStats,
  getCompanyPlanesPublic,
  getCompanyPostsPublic,
  getPromotionsPublic,
} from '@/modules/marketplace/cached'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { getCompanyResenas } from '@/modules/resenas/queries'
import { companyIdPorSlug, excursionesPublicas } from '@/modules/excursiones/catalogo/public-queries'
import { SITE_NAME } from '@/lib/site'
import { shareMetadata } from '@/lib/share/metadata'

interface CompanyDetailPageProps {
  params: Promise<{ companySlug: string }>
}

export const revalidate = 3600

// Fase separación · SEO del marketplace: metadata dinámica + canónico por
// empresa (para que al separar dominios el canónico apunte correctamente).
export async function generateMetadata({
  params,
}: CompanyDetailPageProps): Promise<Metadata> {
  const { companySlug } = await params
  const company = await getCompanyPublic(companySlug)
  if (!company) return { title: `Empresa · ${SITE_NAME}` }

  const ubicacion = [company.ciudad, company.provincia].filter(Boolean).join(', ')
  const title = company.name
  const description =
    company.description ||
    `Descubre las membresías y promociones de ${company.name}${ubicacion ? ` en ${ubicacion}` : ''} en ${SITE_NAME}.`
  // Share Engine: la imagen la genera opengraph-image.tsx de esta ruta
  // (tarjeta 1200×630 con el banner de la empresa), no el logo crudo.
  return shareMetadata({
    title,
    description,
    url: `/empresas/${company.slug}`,
  })
}

export default async function CompanyDetailPage({
  params,
}: CompanyDetailPageProps) {
  const { companySlug } = await params

  const company = await getCompanyPublic(companySlug)
  if (!company) notFound()

  const [stats, planes, promotions, posts, prefs, resenas, excursionesData] = await Promise.all([
    getCompanyStats(companySlug),
    getCompanyPlanesPublic(company.id),
    getPromotionsPublic({ company: companySlug, limit: 12 }),
    getCompanyPostsPublic(company.id),
    getRegionalPrefs(company.id),
    getCompanyResenas(company.id),
    companyIdPorSlug(companySlug).then((cid) =>
      cid ? excursionesPublicas(cid) : Promise.resolve([])
    ),
  ])

  const excursiones = excursionesData.map((exc) => ({
    id: exc.id,
    nombre: exc.nombre,
    slug: exc.slug,
    portadaUrl: exc.portadaUrl,
    categoria: exc.categoria,
    moneda: exc.moneda,
    duracionMin: exc.duracionMin,
    ubicacion: exc.ubicacion,
    precioDesde: exc.variantes[0]?.precioAdulto ?? null,
  }))

  return (
    <CompanyProfile
      mode="public"
      company={company}
      stats={stats}
      planes={planes}
      promotions={promotions}
      posts={posts}
      prefs={prefs}
      resenas={resenas}
      excursiones={excursiones}
    />
  )
}
