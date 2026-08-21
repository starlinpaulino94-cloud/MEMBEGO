import { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { Search, Filter, Tag, Compass, ChevronRight, Store } from 'lucide-react'
import { buscarUnificado, type BuscadorUnificadoResult } from '@/modules/cliente/actions'
import { getUser } from '@/lib/auth'
import { getGuardadasIds } from '@/modules/social/queries'
import { SITE_NAME } from '@/lib/site'
import { shareMetadata } from '@/lib/share/metadata'
import { EmptyState } from '@/components/system/EmptyState'
import { PromotionCard } from '@/components/public/PromotionCard'
import { ExcursionCard } from '@/components/public/ExcursionCard'
import { BusinessCard, type BusinessCardData } from '@/components/marketplace/BusinessCard'
import { SavePromoButton } from '@/components/cliente/SavePromoButton'
import { FiltersSidebar } from './FiltersSidebar'
import type { PromotionPublic } from '@/modules/marketplace/types'

interface BuscarPageProps {
  searchParams: Promise<{
    q?: string
    cat?: string
    emp?: string
    fd?: string
    fh?: string
    stock?: string
    p?: string
  }>
}

export const revalidate = 300

export async function generateMetadata({ searchParams }: BuscarPageProps): Promise<Metadata> {
  const params = await searchParams
  const query = params.q ?? ''
  
  return shareMetadata({
    title: query ? `Buscar: ${query} · ${SITE_NAME}` : `Buscar ofertas, excursiones y empresas · ${SITE_NAME}`,
    description: query 
      ? `Resultados para "${query}". Encuentra ofertas, excursiones y empresas.`
      : 'Explora empresas, ofertas, promociones y excursiones en MembeGo. Filtra por categoría, precio y disponibilidad.',
    url: `/cliente/buscar${query ? `?q=${encodeURIComponent(query)}` : ''}` })
}

export default async function BuscarPage({ searchParams }: BuscarPageProps) {
  const [params, user] = await Promise.all([
    searchParams,
    getUser().catch(() => null),
  ])
  
  const query = params.q ?? ''
  
  const [resultado, guardadasIds] = await Promise.all([
    // Sin cast: `buscarUnificado` ya declara su forma (BuscadorUnificadoResult).
    buscarUnificado(query),
    user?.metadata?.dbUserId
      ? getGuardadasIds(user.metadata.dbUserId).catch(() => new Set<string>())
      : Promise.resolve(new Set<string>()),
  ])

  const hayError = 'error' in resultado
  const rawPromociones = hayError ? [] : resultado.promociones
  const rawExcursiones = hayError ? [] : resultado.excursiones
  const rawEmpresas: BusinessCardData[] = hayError ? [] : (resultado.empresas ?? [])

  // Extraer categorías y empresas disponibles
  const categoriasSet = new Set<string>()
  const empresasMap = new Map<string, { id: string; slug: string; name: string; logoUrl: string | null }>()

  for (const emp of rawEmpresas) {
    if (emp.type) categoriasSet.add(emp.type)
    empresasMap.set(emp.id, { id: emp.id, slug: emp.slug, name: emp.name, logoUrl: emp.logoUrl })
  }
  for (const e of rawExcursiones) {
    if (e.categoria) categoriasSet.add(e.categoria)
    if (e.empresa?.id) empresasMap.set(e.empresa.id, e.empresa)
  }
  for (const p of rawPromociones) {
    if (p.company?.id) empresasMap.set(p.company.id, p.company)
  }

  const categorias = Array.from(categoriasSet).sort()
  const empresasFiltro = Array.from(empresasMap.values()).sort((a, b) => a.name.localeCompare(b.name))

  // Aplicar filtros a los resultados (excluyendo siempre excursiones atrasadas)
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const esExcursionVigente = (e: BuscadorUnificadoResult['excursiones'][number]) =>
    !e.todasFechasPasadas &&
    (!e.proximasSalidas ||
      e.proximasSalidas.length === 0 ||
      e.proximasSalidas.some((s) => !s.fechaPasada && new Date(s.fecha) >= hoy))

  let promociones = rawPromociones
  let excursiones = rawExcursiones.filter(esExcursionVigente)
  let empresas = rawEmpresas

  if (params.cat) {
    const catLower = params.cat.toLowerCase()
    excursiones = excursiones.filter((e) => e.categoria?.toLowerCase() === catLower)
    empresas = empresas.filter((emp) => emp.type?.toLowerCase() === catLower)
  }

  if (params.emp) {
    promociones = promociones.filter((p) => p.company?.id === params.emp)
    excursiones = excursiones.filter((e) => e.empresa?.id === params.emp)
    empresas = empresas.filter((emp) => emp.id === params.emp)
  }

  if (params.fd) {
    const fdDate = new Date(params.fd)
    excursiones = excursiones.filter((e) =>
      (e.proximasSalidas || []).some((s) => new Date(s.fecha) >= fdDate)
    )
  }

  if (params.fh) {
    const fhDate = new Date(params.fh)
    excursiones = excursiones.filter((e) =>
      (e.proximasSalidas || []).some((s) => new Date(s.fecha) <= fhDate)
    )
  }

  if (params.stock === '1') {
    excursiones = excursiones.filter(
      (e) => (e.cupoDisponible == null || e.cupoDisponible > 0) && !e.agotadaGlobal && !e.todasFechasPasadas
    )
  }

  const total = promociones.length + excursiones.length + empresas.length

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-3.5">
          <Link
            href="/cliente/inicio"
            className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Volver al inicio
          </Link>
        </div>
      </div>

      {/* Hero + Search */}
      <div className="bg-card/60 border-b">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8">
          <div className="mb-5 sm:mb-6 w-full">
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-extrabold tracking-tight text-foreground w-full">
              {params.q ? `Resultados para "${params.q}"` : 'Buscar empresas, ofertas y excursiones'}
            </h1>
            <p className="mt-1.5 text-xs sm:text-sm text-muted-foreground w-full">
              {params.q 
                ? `Encontramos ${total} resultado${total !== 1 ? 's' : ''}`
                : 'Explora empresas afiliadas, ofertas exclusivas y tours para ti.'
              }
            </p>
          </div>

          {/* Search Form */}
          <SearchForm 
            initialQuery={params.q ?? ''}
            initialCategoria={params.cat ?? ''}
            initialEmpresa={params.emp ?? ''}
            initialFechaDesde={params.fd ?? ''}
            initialFechaHasta={params.fh ?? ''}
            initialSoloConStock={params.stock === '1'}
            categorias={categorias}
            empresas={empresasFiltro}
          />
        </div>
      </div>

      {/* Results Section */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex flex-col gap-6 lg:gap-8 lg:flex-row">
          {/* Sidebar Filtros */}
          <aside className="w-full lg:w-64 shrink-0">
            <FiltersSidebar 
              categorias={categorias}
              empresas={empresasFiltro}
            />
          </aside>

          {/* Grid Resultados */}
          <div className="flex-1 min-w-0">
            <Suspense fallback={<ResultsSkeleton />}>
              <ResultsGrid 
                empresas={empresas}
                promociones={promociones}
                excursiones={excursiones}
                total={total}
                guardadasIds={guardadasIds}
                currentParams={params}
              />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  )
}

function SearchForm({ 
  initialQuery, 
  initialCategoria, 
  initialEmpresa,
  initialSoloConStock,
  categorias = [],
  empresas = []
}: { 
  initialQuery: string
  initialCategoria: string
  initialEmpresa: string
  initialFechaDesde: string
  initialFechaHasta: string
  initialSoloConStock: boolean
  categorias: string[]
  empresas: { id: string; slug: string; name: string; logoUrl: string | null }[]
}) {
  return (
    <form action="/cliente/buscar" method="GET" className="space-y-3 sm:space-y-4">
      <div className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground pointer-events-none" />
          <input
            name="q"
            type="search"
            placeholder="Buscar empresas, car wash, restaurantes, ofertas, tours..."
            defaultValue={initialQuery}
            className="w-full h-12 pl-11 pr-4 rounded-xl border border-input bg-background text-sm sm:text-base text-foreground transition focus:ring-2 focus:ring-primary outline-none"
          />
        </div>
        <button
          type="submit"
          className="h-12 w-full sm:w-auto px-6 rounded-xl bg-primary font-bold text-sm sm:text-base text-primary-foreground shadow-sm transition hover:bg-primary/90 active:scale-[0.99] flex items-center justify-center gap-2"
        >
          <Search className="h-4 w-4" />
          Buscar
        </button>
      </div>

      {/* Quick filters row */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <Filter className="h-4 w-4 text-muted-foreground hidden sm:inline-block" />
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          {categorias.length > 0 && (
            <select
              name="cat"
              aria-label="Filtrar por categoría"
              className="flex-1 sm:flex-initial h-10 rounded-xl border border-input bg-background px-3 text-xs sm:text-sm text-foreground outline-none focus:ring-2 focus:ring-primary"
              defaultValue={initialCategoria}
            >
              <option value="">Todas las categorías</option>
              {categorias.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
          {empresas.length > 0 && (
            <select
              name="emp"
              aria-label="Filtrar por empresa"
              className="flex-1 sm:flex-initial h-10 rounded-xl border border-input bg-background px-3 text-xs sm:text-sm text-foreground outline-none focus:ring-2 focus:ring-primary"
              defaultValue={initialEmpresa}
            >
              <option value="">Todas las empresas</option>
              {empresas.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.name}</option>
              ))}
            </select>
          )}
          <label className="inline-flex items-center gap-2 h-10 px-3 rounded-xl border border-input bg-card text-xs sm:text-sm font-medium text-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              name="stock"
              value="1"
              defaultChecked={initialSoloConStock}
              className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
            />
            Solo con cupos
          </label>
        </div>
      </div>
    </form>
  )
}

function ResultsGrid({ 
  empresas,
  promociones, 
  excursiones, 
  total,
  guardadasIds,
  currentParams
}: { 
  empresas: BusinessCardData[]
  promociones: BuscadorUnificadoResult['promociones']
  excursiones: BuscadorUnificadoResult['excursiones']
  total: number
  guardadasIds: Set<string>
  currentParams: Record<string, string | undefined>
}) {
  if (empresas.length === 0 && promociones.length === 0 && excursiones.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title={currentParams.q ? `Sin resultados para "${currentParams.q}"` : 'No hay empresas, ofertas ni excursiones disponibles'}
        description={currentParams.q 
          ? `No encontramos resultados para "${currentParams.q}". Intenta con otros términos o explora todas las empresas.`
          : 'Actualmente no hay contenido publicado con tus filtros seleccionados.'
        }
        action={
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link
              href="/cliente/explorar"
              className="inline-flex items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-xs sm:text-sm font-bold text-primary-foreground shadow-sm transition hover:bg-primary/90"
            >
              Explorar empresas
            </Link>
            <Link
              href="/cliente/promociones"
              className="inline-flex items-center justify-center rounded-xl border border-border bg-card px-5 py-2.5 text-xs sm:text-sm font-bold text-foreground shadow-sm transition hover:bg-muted"
            >
              Ver ofertas
            </Link>
          </div>
        }
      />
    )
  }

  return (
    <div className="space-y-10 sm:space-y-12">
      <div className="flex items-center justify-between">
        <p className="text-xs sm:text-sm font-medium text-muted-foreground">
          {total} resultado{total !== 1 ? 's' : ''} encontrado{total !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Empresas Grid */}
      {empresas.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-base sm:text-lg font-bold text-foreground">
              <Store className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
              Empresas y Negocios ({empresas.length})
            </h3>
            <Link
              href={`/cliente/explorar${currentParams.q ? `?q=${encodeURIComponent(currentParams.q)}` : ''}`}
              className="text-xs sm:text-sm font-semibold text-primary hover:underline flex items-center gap-1"
            >
              Ver todas <ChevronRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
            {empresas.map((emp) => (
              <div key={emp.id} className="relative">
                <BusinessCard company={emp} hrefBase="/cliente/empresas" />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Promociones Grid */}
      {promociones.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-base sm:text-lg font-bold text-foreground">
              <Tag className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
              Promociones y Ofertas ({promociones.length})
            </h3>
            <Link
              href={`/cliente/promociones?${new URLSearchParams({ q: currentParams.q || '', cat: currentParams.cat || '', emp: currentParams.emp || '' }).toString()}`}
              className="text-xs sm:text-sm font-semibold text-primary hover:underline flex items-center gap-1"
            >
              Ver todas <ChevronRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
            {promociones.map((p) => {
              const promoObj: PromotionPublic = {
                id: p.id,
                titulo: p.titulo,
                slug: p.slug,
                descripcion: p.descripcion || '',
                imagenUrl: p.imagenUrl,
                tipo: p.tipo,
                descuento: p.descuento,
                codigo: p.codigo,
                vigenciaDesde: p.vigenciaDesde ? new Date(p.vigenciaDesde) : new Date(),
                vigenciaHasta: p.vigenciaHasta ? new Date(p.vigenciaHasta) : null,
                viewCount: p.viewCount || 0,
                shareCount: p.shareCount || 0,
                tags: p.tags || [],
                isFeatured: p.isFeatured || false,
                createdAt: p.createdAt ? new Date(p.createdAt) : new Date(),
                company: p.company }

              return (
                <div key={p.id} className="relative">
                  <PromotionCard promotion={promoObj} hrefBase="/cliente/promociones" />
                  <SavePromoButton promocionId={p.id} guardada={guardadasIds.has(p.id)} />
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Excursiones Grid */}
      {excursiones.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-base sm:text-lg font-bold text-foreground">
              <Compass className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
              Excursiones y Tours ({excursiones.length})
            </h3>
            <Link
              href={`/cliente/excursiones?${new URLSearchParams({ q: currentParams.q || '', cat: currentParams.cat || '', emp: currentParams.emp || '' }).toString()}`}
              className="text-xs sm:text-sm font-semibold text-primary hover:underline flex items-center gap-1"
            >
              Ver todas <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
            {excursiones.map((e) => (
              <div key={e.id} className="relative">
                <ExcursionCard excursion={e} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function ResultsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="animate-pulse overflow-hidden rounded-xl border bg-card">
          <div className="aspect-[16/10] bg-muted" />
          <div className="p-4 space-y-3">
            <div className="h-4 w-3/4 bg-muted rounded" />
            <div className="h-4 w-1/2 bg-muted rounded" />
            <div className="h-3 w-full bg-muted rounded" />
            <div className="h-3 w-2/3 bg-muted rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}
