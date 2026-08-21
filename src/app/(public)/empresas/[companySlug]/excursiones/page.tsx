import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { ArrowLeft, Clock, MapPin, Compass, AlertCircle, X } from 'lucide-react'
import {
  companyIdPorSlug,
  excursionesPublicas,
} from '@/modules/excursiones/catalogo/public-queries'
import { getCompanyPublic } from '@/modules/marketplace/cached'
import { formatMoney } from '@/lib/format'
import { SITE_NAME } from '@/lib/site'
import { shareMetadata } from '@/lib/share/metadata'

interface ExcursionesPageProps {
  params: Promise<{ companySlug: string }>
}

export const revalidate = 3600

export async function generateMetadata({
  params,
}: ExcursionesPageProps): Promise<Metadata> {
  const { companySlug } = await params
  const company = await getCompanyPublic(companySlug)
  if (!company) return { title: `Excursiones · ${SITE_NAME}` }

  return shareMetadata({
    title: `Excursiones · ${company.name}`,
    description: `Descubre las excursiones disponibles de ${company.name}. Reserva tu experiencia.`,
    url: `/empresas/${company.slug}/excursiones`,
  })
}

export default async function ExcursionesPage({ params }: ExcursionesPageProps) {
  const { companySlug } = await params

  const company = await getCompanyPublic(companySlug)
  if (!company) notFound()

  const companyId = await companyIdPorSlug(companySlug)
  if (!companyId) notFound()

  const excursiones = await excursionesPublicas(companyId)

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-4">
          <Link
            href={`/empresas/${companySlug}`}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {company.name}
          </Link>
        </div>
      </div>

      {/* Hero */}
      <div className="border-b bg-card/50">
        <div className="mx-auto max-w-5xl px-4 py-8 text-center">
          <Compass className="mx-auto mb-3 h-10 w-10 text-primary" />
          <h1 className="text-h2 font-bold tracking-tight">
            Excursiones
          </h1>
          <p className="mt-2 text-muted-foreground">
            Explora y reserva las experiencias de {company.name}
          </p>
        </div>
      </div>

      {/* Listado */}
      <div className="mx-auto max-w-5xl px-4 py-8">
        {excursiones.length === 0 ? (
          <div className="rounded-lg border bg-card p-12 text-center">
            <Compass className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
            <h2 className="text-h3 font-semibold">Sin excursiones disponibles</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Pronto habrá nuevas experiencias para ti.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {excursiones.map((exc) => {
              const precioMinimo = exc.variantes[0]?.precioAdulto
              const agotadaGlobal = exc.agotadaGlobal
              const fechaPasada = exc.todasFechasPasadas
              return (
                <Link
                  key={exc.id}
                  href={`/empresas/${companySlug}/excursiones/${exc.slug}`}
                  className={`group overflow-hidden rounded-xl border bg-card shadow-sm transition hover:shadow-md ${agotadaGlobal ? 'opacity-50 pointer-events-none' : ''}`}
                >
                  {/* Portada */}
                  <div className="relative aspect-[16/10] bg-muted">
                    {exc.portadaUrl ? (
                      <Image
                        src={exc.portadaUrl}
                        alt={exc.nombre}
                        fill
                        className="object-cover transition group-hover:scale-105"
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <Compass className="h-12 w-12 text-muted-foreground/30" />
                      </div>
                    )}
                    {exc.categoria && (
                      <span className="absolute left-3 top-3 rounded-full bg-background/80 px-2.5 py-0.5 text-xs font-medium backdrop-blur">
                        {exc.categoria}
                      </span>
                    )}
                    {(agotadaGlobal || fechaPasada) && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <span className="rounded-full bg-background/90 px-3 py-1 text-sm font-semibold text-destructive flex items-center gap-1.5">
                          {fechaPasada ? (
                            <>
                              <X className="h-4 w-4" />
                              Finalizada
                            </>
                          ) : (
                            <>
                              <AlertCircle className="h-4 w-4" />
                              Agotada
                            </>
                          )}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-4">
                    <h2 className="font-semibold group-hover:text-primary">
                      {exc.nombre}
                    </h2>
                    {exc.descripcion && (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {exc.descripcion}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      {exc.duracionMin && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {exc.duracionMin} min
                        </span>
                      )}
                      {exc.ubicacion && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" />
                          {exc.ubicacion}
                        </span>
                      )}
                    </div>
                    {precioMinimo != null && (
                      <p className="mt-3 text-sm font-semibold text-primary">
                       Desde {formatMoney(Number(precioMinimo), { moneda: exc.moneda })}
                      </p>
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
