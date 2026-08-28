import type { Metadata } from 'next'
import Link from 'next/link'
import { Tag } from 'lucide-react'
import { SearchBar } from '@/components/public/SearchBar'
import { PromotionGrid } from '@/components/public/PromotionGrid'
import { getPromotionsPublic } from '@/modules/marketplace/cached'

interface PromotionsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'Promociones',
  description:
    'Descubre promociones y beneficios exclusivos de las empresas en MembeGo. Ofertas vigentes, cupones y descuentos.',
  alternates: { canonical: '/promociones' },
  openGraph: {
    type: 'website',
    title: 'Promociones · MembeGo',
    description: 'Promociones y beneficios exclusivos de empresas en MembeGo.',
    url: '/promociones',
  },
}

export default async function PromotionsPage({
  searchParams,
}: PromotionsPageProps) {
  const params = await searchParams

  const filters = {
    search: typeof params.search === 'string' ? params.search : undefined,
    company: typeof params.company === 'string' ? params.company : undefined,
    type: typeof params.type === 'string' ? params.type : undefined,
    tag: typeof params.tag === 'string' ? params.tag : undefined,
    limit: 50,
    offset: 0,
  }

  const promotions = await getPromotionsPublic(filters)

  return (
    <div className="min-h-screen bg-card">
      {/* Header */}
      <section className="relative overflow-hidden surface-hero pb-16 pt-14">
        <div className="absolute inset-0 bg-grid-light mask-fade" />
        <div className="absolute -top-16 right-10 h-56 w-56 rounded-full bg-primary/25 blur-3xl" />
        <div className="absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-primary/25 blur-3xl" />
        <div className="relative mx-auto max-w-7xl space-y-7 px-4 sm:px-6 lg:px-8">
          <div className="text-white">
            <span className="inline-flex animate-slide-up items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-1.5 text-sm font-medium text-white/80 backdrop-blur">
              <Tag className="h-4 w-4 text-primary" /> Ofertas vigentes
            </span>
            <h1 className="mt-5 animate-slide-up text-display delay-75">
              Promociones
            </h1>
            <p className="mt-3 max-w-xl animate-slide-up text-body text-white/80 delay-100">
              Descuentos, regalos y beneficios exclusivos de las empresas
              afiliadas a MembeGo.
            </p>
          </div>
          <div className="animate-slide-up delay-150">
            <SearchBar placeholder="Buscar promociones..." />
          </div>
        </div>
      </section>

      {/* Filtros por tipo */}
      <section className="sticky top-[4.5rem] z-30 border-b border-border/60 bg-white/85 py-3 glass">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 sm:px-6 lg:px-8">
          <Link
            href="/promociones"
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-all duration-fast ${
              !filters.type
                ? 'bg-primary text-primary-foreground shadow-glow'
                : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground'
            }`}
          >
            Todas
          </Link>
          {['descuento', 'promocion', 'regalo', 'evento'].map((type) => (
            <Link
              key={type}
              href={`/promociones?type=${type}`}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium capitalize transition-all duration-fast ${
                filters.type === type
                  ? 'bg-primary text-primary-foreground shadow-glow'
                  : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground'
              }`}
            >
              {type}
            </Link>
          ))}
        </div>
      </section>

      {/* Main Content */}
      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <PromotionGrid
            promotions={promotions}
            isLoading={false}
            variant="default"
            emptyMessage={
              filters.search || filters.type || filters.tag
                ? 'No se encontraron promociones con esos criterios'
                : 'No hay promociones disponibles en este momento'
            }
          />
        </div>
      </section>
    </div>
  )
}
