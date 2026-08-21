import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Compass } from 'lucide-react'
import {
  companyIdPorSlug,
  excursionesPublicas,
} from '@/modules/excursiones/catalogo/public-queries'
import { getCompanyPublic } from '@/modules/marketplace/cached'
import { SITE_NAME } from '@/lib/site'
import { shareMetadata } from '@/lib/share/metadata'
import { ExcursionCard, type ExcursionCardData } from '@/components/public/ExcursionCard'
import { EmptyState } from '@/components/ui/empty-state'

interface ExcursionesPageProps {
  params: Promise<{ companySlug: string }>
}

export const dynamic = 'force-dynamic'
export const revalidate = 60

export async function generateMetadata({
  params,
}: ExcursionesPageProps): Promise<Metadata> {
  const { companySlug } = await params
  const company = await getCompanyPublic(companySlug)
  if (!company) return { title: `Excursiones · ${SITE_NAME}` }

  return shareMetadata({
    title: `Excursiones · ${company.name}`,
    description: `Descubre las próximas excursiones y experiencias disponibles de ${company.name}. Reserva tu cupo fácilmente.`,
    url: `/empresas/${company.slug}/excursiones`,
  })
}

export default async function ExcursionesPage({ params }: ExcursionesPageProps) {
  const { companySlug } = await params

  const company = await getCompanyPublic(companySlug)
  if (!company) notFound()

  const companyId = await companyIdPorSlug(companySlug)
  if (!companyId) notFound()

  const excursionesRaw = await excursionesPublicas(companyId)

  // Mapear a la forma requerida por ExcursionCardData
  const excursiones: ExcursionCardData[] = excursionesRaw.map((exc) => ({
    id: exc.id,
    nombre: exc.nombre,
    slug: exc.slug,
    descripcion: exc.descripcion,
    portadaUrl: exc.portadaUrl,
    categoria: exc.categoria,
    duracionMin: exc.duracionMin,
    ubicacion: exc.ubicacion,
    precioDesde: exc.variantes[0]?.precioAdulto ? Number(exc.variantes[0].precioAdulto) : null,
    moneda: exc.moneda || 'DOP',
    agotadaGlobal: exc.agotadaGlobal,
    todasFechasPasadas: exc.todasFechasPasadas,
    cupoDisponible: exc.proximasSalidas[0]?.cupoDisponible ?? null,
    proximasSalidas: exc.proximasSalidas,
    empresa: {
      id: company.id,
      slug: company.slug,
      name: company.name,
      logoUrl: company.logoUrl,
    },
  }))

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 sm:px-6 py-3.5">
          <Link
            href={`/empresas/${companySlug}`}
            className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {company.name}
          </Link>
        </div>
      </div>

      {/* Hero */}
      <div className="border-b bg-card/60">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-10">
          <div className="w-full">
            <span className="text-caption font-bold uppercase tracking-wider text-primary">Tours y Experiencias</span>
            <h1 className="mt-1 text-h1 text-foreground w-full">
              Próximas excursiones de {company.name}
            </h1>
            <p className="mt-1.5 text-xs sm:text-sm text-muted-foreground w-full">
              {excursiones.length > 0 
                ? `Explora ${excursiones.length} experiencia${excursiones.length !== 1 ? 's' : ''} disponible${excursiones.length !== 1 ? 's' : ''} con salidas confirmadas y cupos abiertos.`
                : 'Descubre y reserva las mejores aventuras.'
              }
            </p>
          </div>
        </div>
      </div>

      {/* Listado de Excursiones Próximas */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-10">
        {excursiones.length === 0 ? (
          <EmptyState
            variant="card"
            icon={<Compass className="h-10 w-10 text-muted-foreground" aria-hidden />}
            title="Sin excursiones próximas disponibles"
            description={`Actualmente ${company.name} no tiene salidas programadas con cupos abiertos. Vuelve a consultar pronto.`}
            action={
              <Link
                href={`/empresas/${companySlug}`}
                className="inline-flex items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-xs sm:text-sm font-bold text-primary-foreground shadow-sm transition hover:bg-primary/90"
              >
                Volver al perfil de la empresa
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {excursiones.map((exc) => (
              <div key={exc.id} className="relative">
                <ExcursionCard 
                  excursion={exc} 
                  hrefBase={`/empresas/${companySlug}/excursiones`}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
