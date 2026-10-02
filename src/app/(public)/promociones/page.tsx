import type { Metadata } from 'next'
import Link from 'next/link'
import { Tag } from 'lucide-react'
import { SearchBar } from '@/components/public/SearchBar'
import { PromotionGrid } from '@/components/public/PromotionGrid'
import { getPromotionsPublic } from '@/modules/marketplace/cached'
import { ofertasPublicas } from '@/modules/supply-v2/marketplace/read-model'
import { campanasPublicas } from '@/modules/supply-v2/campaigns/queries'
import { membresiasEnElMarketplace } from '@/modules/supply-v2/loyalty/queries'
import { RUTA_CAMPANAS_PUBLICAS, RUTA_MEMBRESIAS_PUBLICAS } from '@/modules/supply-v2/core/catalogo'
import { OfertaMembegoCard } from '@/components/supply-v2/oferta-membego-card'

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

  const sinFiltros = !filters.search && !filters.type && !filters.tag && !filters.company
  const [promotions, ofertasMembego, campanas, membresias] = await Promise.all([
    getPromotionsPublic(filters),
    // Supply 2.0 entra al marketplace por su read model público: solo ofertas
    // comprables hoy, sin costos ni lotes. Sin filtros: son de Membego, no de una empresa.
    sinFiltros ? ofertasPublicas(12).catch(() => []) : Promise.resolve([]),
    // Slice 7 (§18): las campañas activas y vigentes AHORA. La vigencia y el
    // horario se comprueban en la consulta, no se dan por buenos.
    sinFiltros ? campanasPublicas(null, new Date(), 6).catch(() => []) : Promise.resolve([]),
    // Slice 8 (§15): los planes publicados de programas activos. Igual que las
    // campañas: una sección dentro de ESTE marketplace.
    sinFiltros ? membresiasEnElMarketplace().catch(() => []) : Promise.resolve([]),
  ])

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

      {/* Campañas Membego (Supply 2.0 · Slice 7): una sección DENTRO de este
          marketplace, no otro marketplace. Solo si hay alguna activa y vigente. */}
      {campanas.length > 0 && (
        <section className="pt-12" data-testid="campanas-marketplace">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-h2">Campañas y promociones</h2>
                <p className="text-small text-muted-foreground">Promociones por tiempo limitado en los comercios de la red.</p>
              </div>
              <Link href={RUTA_CAMPANAS_PUBLICAS} className="text-small text-primary underline-offset-4 hover:underline" data-testid="link-todas-campanas">
                Ver todas las campañas
              </Link>
            </div>
            <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {campanas.slice(0, 3).map((c) => (
                <li key={c.id} className="rounded-2xl border border-border/70 bg-card p-5 shadow-premium" data-testid="campana-marketplace">
                  <Link href={`${RUTA_CAMPANAS_PUBLICAS}/${c.code}`} className="text-h3 underline-offset-4 hover:underline">{c.name}</Link>
                  <p className="mt-1 text-caption text-muted-foreground">{c.empresas.slice(0, 3).join(' · ')}</p>
                  {c.description && <p className="mt-2 line-clamp-2 text-small text-muted-foreground">{c.description}</p>}
                  <p className="mt-2 text-caption text-muted-foreground">{c.ofertas.length} producto(s) participan{c.endsAt ? ` · hasta el ${new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium' }).format(new Date(c.endsAt))}` : ''}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Membresías Membego (Supply 2.0 · Slice 8): los planes publicados. */}
      {membresias.length > 0 && (
        <section className="pt-12" data-testid="membresias-marketplace">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-h2">Membresías</h2>
                <p className="text-small text-muted-foreground">Contrata una vez y sus beneficios quedan en tu cuenta mientras esté vigente.</p>
              </div>
              <Link href={RUTA_MEMBRESIAS_PUBLICAS} className="text-small text-primary underline-offset-4 hover:underline" data-testid="link-todas-membresias">
                Ver todas las membresías
              </Link>
            </div>
            <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {membresias.slice(0, 3).map((m) => (
                <li key={m.id} className="rounded-2xl border border-border/70 bg-card p-5 shadow-premium" data-testid="membresia-marketplace">
                  <p className="text-caption text-muted-foreground">{m.negocio}</p>
                  <Link href={RUTA_MEMBRESIAS_PUBLICAS} className="text-h3 underline-offset-4 hover:underline">{m.nombre}</Link>
                  <p className="mt-2 text-h3 tabular-nums">{m.gratuita ? 'Gratis' : m.precio}</p>
                  <p className="mt-1 text-caption text-muted-foreground">{m.duracionDias} días{m.incluye.length > 0 ? ` · ${m.incluye.length} beneficio(s)` : ''}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Ofertas Membego (Supply 2.0): solo si hay alguna comprable hoy. */}
      {ofertasMembego.length > 0 && (
        <section className="pt-12" data-testid="ofertas-membego">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-h2">Ofertas Membego</h2>
                <p className="text-small text-muted-foreground">Productos que Membego ya pagó a precio negociado. Compra y úsalo en el negocio.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {ofertasMembego.map((o) => (
                <OfertaMembegoCard key={o.id} oferta={o} />
              ))}
            </div>
          </div>
        </section>
      )}

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
