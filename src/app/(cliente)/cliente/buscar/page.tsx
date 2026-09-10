import { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { Search, Tag, Compass, ChevronRight, Store } from 'lucide-react'
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

/**
 * BUSCAR — resultados unificados en lenguaje retail (derivado del Inicio).
 *
 * La versión anterior traía su propia carcasa: barra de «Volver al inicio»,
 * un hero con OTRO buscador (el de la cabecera ya envía aquí — repetirlo es
 * navegación duplicada, la misma regla que sacó el buscador del Inicio),
 * contenedores `max-w-7xl` peleándose con los del CustomerShell y radios y
 * textos a mano. Ahora la página pone solo lo suyo: título con el conteo,
 * chips rápidos de categoría y cupos (como el catálogo), el panel de filtros
 * avanzados y las tres secciones con las tarjetas compartidas.
 *
 * TODA la lógica se conserva: parámetros q/cat/emp/fd/fh/stock, filtrado de
 * excursiones vigentes, guardadas, y los «Ver todas» con el contexto puesto.
 */
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

  // Chips rápidos: enlaces que conservan el resto de los parámetros. La
  // paginación (`p`) se reinicia al cambiar de filtro.
  const chipHref = (cambios: Record<string, string | null>) => {
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v)
    for (const [k, v] of Object.entries(cambios)) {
      if (v === null) sp.delete(k)
      else sp.set(k, v)
    }
    sp.delete('p')
    const qs = sp.toString()
    return qs ? `/cliente/buscar?${qs}` : '/cliente/buscar'
  }
  const chipActivo =
    'inline-flex min-h-10 shrink-0 items-center rounded-full bg-retail-deep px-4 text-label-lg text-white transition active:scale-[0.97]'
  const chipReposo =
    'inline-flex min-h-10 shrink-0 items-center rounded-full border border-border bg-card px-4 text-label-lg text-muted-foreground transition hover:text-foreground active:scale-[0.97]'

  return (
    <div className="space-y-5 animate-fade-up">
      {/* ── Cabecera: el buscador vive en la carcasa; aquí, el resultado ── */}
      <header>
        <h1 className="break-words text-h2 text-foreground">
          {query ? `Resultados para "${query}"` : 'Buscar en MembeGo'}
        </h1>
        <p className="mt-0.5 text-small text-muted-foreground">
          {query
            ? `Encontramos ${total} resultado${total !== 1 ? 's' : ''}.`
            : 'Empresas afiliadas, ofertas exclusivas y tours para ti.'}
        </p>
      </header>

      {/* ── Chips rápidos: categoría y cupos, como en el catálogo ───────── */}
      {(categorias.length > 0 || excursiones.length > 0) && (
        <nav
          aria-label="Filtros rápidos"
          className="relative no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
        >
          <Link
            href={chipHref({ cat: null })}
            aria-current={!params.cat ? 'page' : undefined}
            className={!params.cat ? chipActivo : chipReposo}
          >
            Todas
          </Link>
          {categorias.map((c) => (
            <Link
              key={c}
              href={chipHref({ cat: c })}
              aria-current={params.cat === c ? 'page' : undefined}
              className={params.cat === c ? chipActivo : chipReposo}
            >
              {c}
            </Link>
          ))}
          <Link
            href={chipHref({ stock: params.stock === '1' ? null : '1' })}
            aria-current={params.stock === '1' ? 'page' : undefined}
            className={params.stock === '1' ? chipActivo : chipReposo}
          >
            Solo con cupos
          </Link>
        </nav>
      )}

      {/* ── Filtros avanzados + resultados. Sin materia que filtrar (aún
          no se buscó nada), el panel no se enseña. ─────────────────────── */}
      <div className="flex flex-col gap-5 lg:flex-row lg:gap-6">
        {(categorias.length > 0 || empresasFiltro.length > 0) && (
          <aside className="w-full shrink-0 lg:w-64">
            <FiltersSidebar categorias={categorias} empresas={empresasFiltro} />
          </aside>
        )}

        <div className="min-w-0 flex-1">
          <Suspense fallback={<ResultsSkeleton />}>
            <ResultsGrid
              empresas={empresas}
              promociones={promociones}
              excursiones={excursiones}
              guardadasIds={guardadasIds}
              currentParams={params}
            />
          </Suspense>
        </div>
      </div>
    </div>
  )
}

function ResultsGrid({
  empresas,
  promociones,
  excursiones,
  guardadasIds,
  currentParams
}: {
  empresas: BusinessCardData[]
  promociones: BuscadorUnificadoResult['promociones']
  excursiones: BuscadorUnificadoResult['excursiones']
  guardadasIds: Set<string>
  currentParams: Record<string, string | undefined>
}) {
  if (empresas.length === 0 && promociones.length === 0 && excursiones.length === 0) {
    // Dos vacíos distintos: buscó y no hubo (se dice qué falló), o aún no
    // buscó (se invita al buscador de la cabecera — el único de la app).
    return (
      <EmptyState
        icon={Search}
        title={currentParams.q ? `Sin resultados para "${currentParams.q}"` : '¿Qué estás buscando?'}
        description={currentParams.q
          ? `No encontramos resultados para "${currentParams.q}". Intenta con otros términos o explora todas las empresas.`
          : 'Escribe en el buscador de arriba para encontrar empresas, ofertas y excursiones — o empieza por aquí.'
        }
        action={
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link
              href="/cliente/explorar"
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 text-label-lg text-primary-foreground transition-colors duration-fast hover:bg-brand-primary-hover"
            >
              Explorar empresas
            </Link>
            <Link
              href="/cliente/promociones"
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-border bg-card px-5 text-label-lg text-foreground transition-colors duration-fast hover:border-primary/40"
            >
              Ver ofertas
            </Link>
          </div>
        }
      />
    )
  }

  return (
    <div className="space-y-8">
      {/* Empresas */}
      {empresas.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="flex min-w-0 items-center gap-2 text-h3 text-foreground">
              <Store className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              Empresas y negocios ({empresas.length})
            </h2>
            <Link
              href={`/cliente/explorar${currentParams.q ? `?q=${encodeURIComponent(currentParams.q)}` : ''}`}
              className="flex shrink-0 items-center gap-0.5 text-small font-semibold text-primary hover:underline"
            >
              Ver todas <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>

          <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {empresas.map((emp) => (
              <li key={emp.id} className="flex">
                <BusinessCard company={emp} hrefBase="/cliente/empresas" className="w-full" />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Promociones */}
      {promociones.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="flex min-w-0 items-center gap-2 text-h3 text-foreground">
              <Tag className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              Promociones y ofertas ({promociones.length})
            </h2>
            <Link
              href={`/cliente/promociones?${new URLSearchParams({ q: currentParams.q || '', cat: currentParams.cat || '', emp: currentParams.emp || '' }).toString()}`}
              className="flex shrink-0 items-center gap-0.5 text-small font-semibold text-primary hover:underline"
            >
              Ver todas <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>

          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
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
                <li key={p.id} className="relative">
                  <PromotionCard promotion={promoObj} hrefBase="/cliente/promociones" esquinaLibre />
                  <SavePromoButton promocionId={p.id} guardada={guardadasIds.has(p.id)} />
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Excursiones */}
      {excursiones.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="flex min-w-0 items-center gap-2 text-h3 text-foreground">
              <Compass className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              Excursiones y tours ({excursiones.length})
            </h2>
            <Link
              href={`/cliente/excursiones?${new URLSearchParams({ q: currentParams.q || '', cat: currentParams.cat || '', emp: currentParams.emp || '' }).toString()}`}
              className="flex shrink-0 items-center gap-0.5 text-small font-semibold text-primary hover:underline"
            >
              Ver todas <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>

          <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {excursiones.map((e) => (
              <li key={e.id} className="flex">
                <ExcursionCard excursion={e} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function ResultsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="animate-pulse overflow-hidden rounded-lg border border-border bg-card">
          <div className="aspect-16/10 bg-muted" />
          <div className="space-y-3 p-4">
            <div className="h-4 w-3/4 rounded bg-muted" />
            <div className="h-4 w-1/2 rounded bg-muted" />
            <div className="h-3 w-full rounded bg-muted" />
            <div className="h-3 w-2/3 rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  )
}
