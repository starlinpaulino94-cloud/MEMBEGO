import { Metadata } from 'next'
import { Search, Filter, X, Calendar, MapPin, Tag, Users, ArrowLeft, AlertCircle, Clock, CalendarDays } from 'lucide-react'
import Link from 'next/link'
import { Suspense } from 'react'
import { buscarExcursionesPublicas } from '@/modules/excursiones/catalogo/search-queries'
import { getCompanyPublic } from '@/modules/marketplace/cached'
import { formatMoney } from '@/lib/format'
import { SITE_NAME } from '@/lib/site'
import { shareMetadata } from '@/lib/share/metadata'
import { EmptyState } from '@/components/system/EmptyState'

interface ExcursionesPageProps {
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

export async function generateMetadata({ searchParams }: ExcursionesPageProps): Promise<Metadata> {
  const params = await searchParams
  const query = params.q ?? ''
  
  return shareMetadata({
    title: query ? `Buscar: ${query} · Excursiones · ${SITE_NAME}` : `Todas las excursiones · ${SITE_NAME}`,
    description: query 
      ? `Resultados para "${query}". Encuentra tu próxima aventura filtrando por destino, fecha, categoría y más.`
      : 'Explora todas las excursiones disponibles en MembeGo. Filtra por destino, fecha, categoría, precio y disponibilidad.',
    url: `/excursiones${query ? `?q=${encodeURIComponent(query)}` : ''}`,
  })
}

export default async function ExcursionesPage({ searchParams }: ExcursionesPageProps) {
  const params = await searchParams
  
  const filtros = {
    query: params.q ?? '',
    categoria: params.cat ?? '',
    empresa: params.emp ?? '',
    fechaDesde: params.fd ? new Date(params.fd) : undefined,
    fechaHasta: params.fh ? new Date(params.fh) : undefined,
    soloConStock: params.stock === '1',
    excluirFinalizadas: true,
    pagina: parseInt(params.p ?? '1', 10),
    porPagina: 12,
  }

  const resultado = await buscarExcursionesPublicas(filtros)

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="mx-auto max-w-6xl px-4 py-4">
          <Link
            href="/empresas"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Empresas
          </Link>
        </div>
      </div>

      {/* Hero + Search */}
      <div className="bg-card/50 border-b">
        <div className="mx-auto max-w-6xl px-4 py-8">
          <div className="mb-6">
            <h1 className="text-h2 font-bold tracking-tight">
              {params.q ? `Resultados para "${params.q}"` : 'Todas las excursiones'}
            </h1>
            <p className="mt-1 text-muted-foreground">
              {params.q 
                ? `${resultado.total} excursion${resultado.total !== 1 ? 'es' : ''} encontrada${resultado.total !== 1 ? 's' : ''}`
                : 'Explora experiencias y tours de todas las empresas. Filtra por destino, fecha, categoría y disponibilidad.'
              }
            </p>
          </div>

          {/* Search Bar */}
          <SearchForm 
            initialQuery={params.q ?? ''}
            initialCategoria={params.cat ?? ''}
            initialEmpresa={params.emp ?? ''}
            initialFechaDesde={params.fd ?? ''}
            initialFechaHasta={params.fh ?? ''}
            initialSoloConStock={params.stock === '1'}
          />
        </div>
      </div>

      {/* Results */}
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Filtros activos + Sidebar filters */}
        <div className="flex flex-col gap-6 lg:flex-row">
          {/* Sidebar Filtros */}
          <aside className="lg:w-64 flex-shrink-0">
            <FiltersSidebar 
              categorias={resultado.categorias}
              empresas={resultado.empresas}
              activeCategoria={params.cat ?? ''}
              activeEmpresa={params.emp ?? ''}
              activeFechaDesde={params.fd ?? ''}
              activeFechaHasta={params.fh ?? ''}
              activeSoloConStock={params.stock === '1'}
              onChange={(key, value) => {
                const url = new URL(window.location.href)
                if (value) url.searchParams.set(key, value)
                else url.searchParams.delete(key)
                url.searchParams.delete('p')
                window.location.href = url.toString()
              }}
            />
          </aside>

          {/* Grid Resultados */}
          <main className="flex-1">
            <Suspense fallback={<ResultsSkeleton />}>
              <ResultsGrid 
                excursiones={resultado.excursiones}
                total={resultado.total}
                pagina={resultado.pagina}
                totalPaginas={resultado.totalPaginas}
                currentParams={params}
              />
            </Suspense>
          </main>
        </div>
      </div>
    </div>
  )
}

function SearchForm({ 
  initialQuery, 
  initialCategoria, 
  initialEmpresa,
  initialFechaDesde,
  initialFechaHasta,
  initialSoloConStock 
}: { 
  initialQuery: string
  initialCategoria: string
  initialEmpresa: string
  initialFechaDesde: string
  initialFechaHasta: string
  initialSoloConStock: boolean
}) {
  return (
    <form action="/excursiones" method="GET" className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            name="q"
            placeholder="Buscar excursiones por nombre, destino, categoría..."
            defaultValue={initialQuery}
            className="w-full pl-10 rounded-xl border bg-background px-4 py-3 text-base transition focus:ring-2 focus:ring-primary"
          />
        </div>
        <button type="submit" className="whitespace-nowrap rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90">
          Buscar
        </button>
      </div>

      {/* Quick filters row */}
      <div className="flex flex-wrap items-center gap-3">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <div className="flex flex-wrap gap-2">
          <select name="cat" className="rounded-xl border bg-background px-3 py-2 text-sm" defaultValue={initialCategoria}>
            <option value="">Todas las categorías</option>
            {/* Se llena desde el sidebar con JS */}
          </select>
          <select name="emp" className="rounded-xl border bg-background px-3 py-2 text-sm" defaultValue={initialEmpresa}>
            <option value="">Todas las empresas</option>
          </select>
          <input type="date" name="fd" className="rounded-xl border bg-background px-3 py-2 text-sm" defaultValue={initialFechaDesde} min={new Date().toISOString().split('T')[0]} />
          <input type="date" name="fh" className="rounded-xl border bg-background px-3 py-2 text-sm" defaultValue={initialFechaHasta} min={initialFechaDesde || new Date().toISOString().split('T')[0]} />
          <label className="flex items-center gap-2 rounded-xl border bg-background px-3 py-2 text-sm cursor-pointer">
            <input type="checkbox" name="stock" defaultChecked={initialSoloConStock} className="rounded border-input" />
            Solo con cupos
          </label>
        </div>
      </div>
    </form>
  )
}

function FiltersSidebar({ 
  categorias, 
  empresas, 
  activeCategoria, 
  activeEmpresa,
  activeFechaDesde,
  activeFechaHasta,
  activeSoloConStock,
  onChange
}: { 
  categorias: string[]
  empresas: { id: string; slug: string; name: string; logoUrl: string | null }[]
  activeCategoria: string
  activeEmpresa: string
  activeFechaDesde: string
  activeFechaHasta: string
  activeSoloConStock: boolean
  onChange: (key: string, value: string) => void
}) {
  const hayFiltros = activeCategoria || activeEmpresa || activeFechaDesde || activeFechaHasta || activeSoloConStock

  return (
    <div className="sticky top-20 space-y-6 p-4 rounded-xl border bg-card">
      {hayFiltros && (
        <button
          onClick={() => window.location.href = '/excursiones'}
          className="w-full flex items-center justify-center gap-2 text-sm text-destructive hover:text-destructive/80"
        >
          <X className="h-4 w-4" /> Limpiar todos los filtros
        </button>
      )}

      <fieldset>
        <legend className="mb-3 text-sm font-semibold">Categoría</legend>
        <div className="space-y-2 max-h-40 overflow-y-auto">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="cat"
              value=""
              checked={!activeCategoria}
              onChange={() => onChange('cat', '')}
              className="rounded border-input"
            />
            <span className="text-sm">Todas</span>
          </label>
          {categorias.map((cat) => (
            <label key={cat} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="cat"
                value={cat}
                checked={activeCategoria === cat}
                onChange={() => onChange('cat', cat)}
                className="rounded border-input"
              />
              <span className="text-sm">{cat}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-3 text-sm font-semibold">Empresa</legend>
        <div className="space-y-2 max-h-40 overflow-y-auto">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="emp"
              value=""
              checked={!activeEmpresa}
              onChange={() => onChange('emp', '')}
              className="rounded border-input"
            />
            <span className="text-sm">Todas</span>
          </label>
          {empresas.map((emp) => (
            <label key={emp.id} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="emp"
                value={emp.id}
                checked={activeEmpresa === emp.id}
                onChange={() => onChange('emp', emp.id)}
                className="rounded border-input"
              />
              <span className="text-sm truncate">{emp.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-3 text-sm font-semibold">Fechas</legend>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Desde</label>
            <input
              type="date"
              value={activeFechaDesde}
              onChange={(e) => onChange('fd', e.target.value)}
              min={new Date().toISOString().split('T')[0]}
              className="w-full rounded-xl border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Hasta</label>
            <input
              type="date"
              value={activeFechaHasta}
              onChange={(e) => onChange('fh', e.target.value)}
              min={activeFechaDesde || new Date().toISOString().split('T')[0]}
              className="w-full rounded-xl border bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-3 text-sm font-semibold">Disponibilidad</legend>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={activeSoloConStock}
            onChange={(e) => onChange('stock', e.target.checked ? '1' : '')}
            className="rounded border-input"
          />
          <span className="text-sm">Solo excursiones con cupos disponibles</span>
        </label>
      </fieldset>
    </div>
  )
}

function ResultsGrid({ 
  excursiones, 
  total, 
  pagina, 
  totalPaginas,
  currentParams
}: { 
  excursiones: any[]
  total: number
  pagina: number
  totalPaginas: number
  currentParams: any
}) {
  if (excursiones.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title={currentParams.q ? 'Sin resultados' : 'No hay excursiones disponibles'}
        description={currentParams.q 
          ? `No encontramos excursiones para "${currentParams.q}". Intenta con otros términos o amplía tus filtros.`
          : 'Actualmente no hay excursiones publicadas con tus filtros.'
        }
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {total} excursion{total !== 1 ? 'es' : ''} encontrada{total !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {excursiones.map((exc) => (
          <ExcursionPublicCard key={exc.id} excursion={exc} />
        ))}
      </div>

      {totalPaginas > 1 && (
        <Pagination 
          pagina={pagina} 
          totalPaginas={totalPaginas} 
          currentParams={currentParams} 
        />
      )}
    </div>
  )
}

function ExcursionPublicCard({ excursion }: { excursion: any }) {
  const proximaDisponible = excursion.proximasSalidas.find(
    (s: any) => !s.agotada && !s.fechaPasada
  )
  const isFinalizada = excursion.todasFechasPasadas
  const isAgotada = excursion.agotadaGlobal
  const cupoDisponible = proximaDisponible?.cupoDisponible ?? 0
  const tieneStock = !isFinalizada && !isAgotada && cupoDisponible > 0
  const pocosCupos = tieneStock && cupoDisponible <= 5 && cupoDisponible > 0

  return (
    <Link
      href={`/empresas/${excursion.company.slug}/excursiones/${excursion.slug}`}
      className={`group overflow-hidden rounded-xl border bg-card shadow-sm transition hover:shadow-md ${isAgotada || isFinalizada ? 'opacity-50 pointer-events-none' : ''}`}
    >
      <div className="relative aspect-[16/10] bg-muted">
        {excursion.portadaUrl ? (
          <img
            src={excursion.portadaUrl}
            alt={excursion.nombre}
            className="h-full w-full object-cover transition group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Tag className="h-12 w-12 text-muted-foreground/30" />
          </div>
        )}
        {excursion.categoria && (
          <span className="absolute left-3 top-3 rounded-full bg-background/80 px-2.5 py-0.5 text-xs font-medium backdrop-blur">
            {excursion.categoria}
          </span>
        )}
        {(isAgotada || isFinalizada) && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="rounded-full bg-background/90 px-3 py-1 text-sm font-semibold text-destructive flex items-center gap-1.5">
              {isFinalizada ? (
                <> <X className="h-4 w-4" /> Finalizada </> 
              ) : (
                <> <AlertCircle className="h-4 w-4" /> Agotada </>
              )}
            </span>
          </div>
        )}
        {pocosCupos && !isFinalizada && !isAgotada && (
          <div className="absolute right-3 bottom-3">
            <span className="rounded-full bg-warning/90 px-2 py-1 text-xs font-medium text-warning flex items-center gap-1">
              <Users className="h-3 w-3" /> {cupoDisponible} cupos
            </span>
          </div>
        )}
      </div>

      <div className="p-4">
        <h3 className="font-semibold group-hover:text-primary line-clamp-1">{excursion.nombre}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{excursion.company.name}</p>
        
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
          {excursion.duracionMin && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {excursion.duracionMin} min
            </span>
          )}
          {excursion.ubicacion && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {excursion.ubicacion}
            </span>
          )}
        </div>

        {excursion.precioDesde != null && (
          <p className="mt-3 text-sm font-semibold text-primary">
            Desde {formatMoney(excursion.precioDesde, { moneda: excursion.moneda })}
          </p>
        )}

        <div className="mt-3 flex items-center justify-between">
          {tieneStock && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
              pocosCupos ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'
            }`}>
              <CalendarDays className="h-3 w-3" />
              {pocosCupos ? `Últimos ${cupoDisponible}` : 'Disponible'}
            </span>
          )}
          {isFinalizada && (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
              <X className="h-3 w-3" /> Finalizada
            </span>
          )}
          {isAgotada && (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
              <AlertCircle className="h-3 w-3" /> Agotada
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

function Pagination({ pagina, totalPaginas, currentParams }: { pagina: number; totalPaginas: number; currentParams: any }) {
  const createUrl = (p: number) => {
    const params = new URLSearchParams()
    Object.entries(currentParams).forEach(([k, v]) => {
      if (v && k !== 'p') params.set(k, v as string)
    })
    if (p > 1) params.set('p', String(p))
    return `/excursiones?${params.toString()}`
  }

  return (
    <nav className="flex items-center justify-center gap-2" aria-label="Paginación">
      <Link
        href={createUrl(pagina - 1)}
        className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${pagina <= 1 ? 'opacity-50 pointer-events-none' : ''}`}
        aria-disabled={pagina <= 1}
      >
        Anterior
      </Link>
      <span className="text-sm text-muted-foreground">
        Página {pagina} de {totalPaginas}
      </span>
      <Link
        href={createUrl(pagina + 1)}
        className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${pagina >= totalPaginas ? 'opacity-50 pointer-events-none' : ''}`}
        aria-disabled={pagina >= totalPaginas}
      >
        Siguiente
      </Link>
    </nav>
  )
}

function ResultsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
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