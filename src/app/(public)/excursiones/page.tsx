import { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { Search } from 'lucide-react'
import { buscarUnificado, type BuscadorUnificadoResult } from '@/modules/cliente/actions'
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
    url: `/excursiones${query ? `?q=${encodeURIComponent(query)}` : ''}` })
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
    porPagina: 12 }

  const resultado = await buscarUnificado(filtros.query)
  // `buscarUnificado` devuelve o los resultados o `{ error }`. Estrechar el
  // tipo aquí es lo que permite leer `.excursiones` sin castear: si un día la
  // búsqueda falla, la página enseña la lista vacía en vez de reventar.
  const excursiones = 'error' in resultado ? [] : resultado.excursiones

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="mx-auto max-w-6xl px-4 py-4">
          <Link
            href="/empresas"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
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
              Explora experiencias y tours de todas las empresas. Filtra por destino, fecha, categoría y disponibilidad.
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
        <Suspense fallback={<ResultsSkeleton />}>
          <ResultsGrid 
            excursiones={excursiones}
            total={excursiones.length}
            pagina={1}
            totalPaginas={1}
            currentParams={params}
          />
        </Suspense>
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
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
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
        <svg className="h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
        <div className="flex flex-wrap gap-2">
          <select name="cat" className="rounded-xl border bg-background px-3 py-2 text-sm" defaultValue={initialCategoria}>
            <option value="">Todas las categorías</option>
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

function ResultsGrid({ 
  excursiones, 
  total, 
  pagina, 
  totalPaginas,
  currentParams
}: { 
  excursiones: BuscadorUnificadoResult['excursiones']
  total: number
  pagina: number
  totalPaginas: number
  currentParams: Record<string, string | undefined>
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
          <Link
            key={exc.id}
            href={`/empresas/${exc.empresa.slug}/excursiones/${exc.slug}`}
            className={`group overflow-hidden rounded-xl border bg-card shadow-sm transition hover:shadow-md ${exc.agotadaGlobal || exc.todasFechasPasadas ? 'opacity-50 pointer-events-none' : ''}`}
          >
            <div className="relative aspect-[16/10] bg-muted">
              {exc.portadaUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={exc.portadaUrl}
                  alt={exc.nombre}
                  className="h-full w-full object-cover transition group-hover:scale-105"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <svg className="h-12 w-12 text-muted-foreground/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                  </svg>
                </div>
              )}
              {exc.categoria && (
                <span className="absolute left-3 top-3 rounded-full bg-background/80 px-2.5 py-0.5 text-xs font-medium backdrop-blur">
                  {exc.categoria}
                </span>
              )}
              {(exc.agotadaGlobal || exc.todasFechasPasadas) && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <span className="rounded-full bg-background/90 px-3 py-1 text-sm font-semibold text-destructive flex items-center gap-1.5">
                    {exc.todasFechasPasadas ? (
                      <> <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg> Finalizada </> 
                    ) : (
                      <> <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></svg> Agotada </>
                    )}
                  </span>
                </div>
              )}
              {exc.cupoDisponible && exc.cupoDisponible <= 5 && exc.cupoDisponible > 0 && !exc.agotadaGlobal && !exc.todasFechasPasadas && (
                <div className="absolute right-3 bottom-3">
                  <span className="rounded-full bg-warning/90 px-2 py-1 text-xs font-medium text-warning-foreground flex items-center gap-1">
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M7 7l5 5" /></svg>
                    {exc.cupoDisponible} cupos
                  </span>
                </div>
              )}
            </div>

            <div className="p-4">
              <h3 className="font-semibold group-hover:text-primary line-clamp-1">{exc.nombre}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{exc.empresa.name}</p>
              
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                {exc.duracionMin && (
                  <span className="flex items-center gap-1">
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                    {exc.duracionMin} min
                  </span>
                )}
                {exc.ubicacion && (
                  <span className="flex items-center gap-1">
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-20 13-7 0-13-6-13-13 0-7 9-13 13-13" /><path d="M12 2v20" /><path d="M12 2a10 10 0 0 1 0 20" /></svg>
                    {exc.ubicacion}
                  </span>
                )}
              </div>

              {exc.precioDesde != null && (
                <p className="mt-3 text-sm font-semibold text-primary">
                  Desde {new Intl.NumberFormat('es-DO', { style: 'currency', currency: exc.moneda, minimumFractionDigits: 0 }).format(exc.precioDesde)}
                </p>
              )}

              <div className="mt-2 flex items-center justify-between">
                {exc.agotadaGlobal && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></svg> Agotada
                  </span>
                )}
                {exc.todasFechasPasadas && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg> Finalizada
                  </span>
                )}
              </div>
            </div>
          </Link>
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

function Pagination({
  pagina,
  totalPaginas,
  currentParams,
}: {
  pagina: number
  totalPaginas: number
  currentParams: Record<string, string | undefined>
}) {
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