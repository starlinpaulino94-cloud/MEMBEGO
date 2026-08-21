import Link from 'next/link'
import {
  AlertCircle,
  Compass,
  Star,
  Sparkles,
  CalendarDays,
  Flame,
  Search,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import {
  getCategoriasExcursiones,
  buscarExcursionesCliente,
  getExcursionFeed,
  type ExcursionFeed,
} from '@/modules/excursiones/catalogo/cliente-queries'
import { cn } from '@/lib/utils'
import { ExcursionCard, type ExcursionCardData } from '@/components/public/ExcursionCard'
import { EmptyState } from '@/components/system/EmptyState'
import { PageHeader } from '@/components/ui/page-header'
import { SectionHeader } from '@/components/ui/section-header'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Excursiones',
  description: 'Tours, experiencias y aventuras disponibles para ti',
}

function ExcursionGrid({ excursiones }: { excursiones: ExcursionCardData[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
      {excursiones.map((e) => (
        <div key={e.id} className="relative">
          <ExcursionCard excursion={e} />
        </div>
      ))}
    </div>
  )
}

function SeccionExcursiones({
  icon: Icon,
  titulo,
  descripcion,
  excursiones,
}: {
  icon: LucideIcon
  titulo: string
  descripcion?: string
  excursiones: ExcursionCardData[]
}) {
  if (excursiones.length === 0) return null
  return (
    <section>
      <SectionHeader
        title={titulo}
        description={descripcion}
        action={
          <span className="inline-flex items-center gap-1.5 text-caption">
            <Icon className="h-4 w-4 text-primary" aria-hidden />
            {excursiones.length}
            <span className="sr-only">excursiones</span>
          </span>
        }
      />
      <ExcursionGrid excursiones={excursiones} />
    </section>
  )
}

export default async function ExcursionesDisponiblesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requireRole('CLIENTE')

  const params = await searchParams
  const soloTexto = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const q = soloTexto(params.q)
  const categoria = soloTexto(params.categoria)
  const empresa = soloTexto(params.empresa)
  const stock = soloTexto(params.stock)
  const buscando = Boolean(q || categoria || empresa || stock)

  let feed: ExcursionFeed | null = null
  let categorias: { slug: string; name: string }[] = []
  let resultados: ExcursionCardData[] = []
  let loadError = false

  try {
    categorias = await getCategoriasExcursiones().catch(() => [])

    if (buscando) {
      resultados = await buscarExcursionesCliente({
        texto: q || undefined,
        categoria: categoria || undefined,
        empresaId: empresa || undefined,
        soloConStock: stock === '1',
      })
    } else {
      feed = await getExcursionFeed(user.metadata.dbUserId)
    }
  } catch (e) {
    loadError = true
    console.error('[cliente-excursiones]', e)
  }

  /** Enlaces de los chips: cambiar de categoría no borra lo que se escribió. */
  const hrefCon = (cambios: { categoria?: string | null }) => {
    const qs = new URLSearchParams()
    if (q) qs.set('q', q)
    if (empresa) qs.set('empresa', empresa)
    if (stock) qs.set('stock', stock)
    const cat = cambios.categoria === undefined ? categoria : cambios.categoria
    if (cat) qs.set('categoria', cat)
    const s = qs.toString()
    return `/cliente/excursiones${s ? `?${s}` : ''}`
  }

  const categoriaActiva = categorias.find((c) => c.slug.toLowerCase() === categoria.toLowerCase())

  const sinExcursiones =
    feed != null &&
    feed.misEmpresas.length === 0 &&
    feed.destacadas.length === 0 &&
    feed.nuevas.length === 0 &&
    feed.proximasSalidas.length === 0

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Experiencias"
        title="Excursiones y Tours"
        description="Descubre aventuras y paseos de tus empresas favoritas. Reserva tu cupo fácilmente."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm" className="h-10 text-xs sm:text-sm">
              <Link href="/cliente/mis-excursiones">
                <CalendarDays aria-hidden className="mr-1.5 h-4 w-4" />
                Mis reservas
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-10 text-xs sm:text-sm">
              <Link href="/cliente/explorar">
                <Compass aria-hidden className="mr-1.5 h-4 w-4" />
                Explorar empresas
              </Link>
            </Button>
          </div>
        }
      />

      {/* Buscador GET Mobile-First */}
      <search className="block">
        <form action="/cliente/excursiones" role="search">
          {categoria && <input type="hidden" name="categoria" value={categoria} />}
          {empresa && <input type="hidden" name="empresa" value={empresa} />}
          {stock && <input type="hidden" name="stock" value={stock} />}
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
            />
            <input
              name="q"
              type="search"
              defaultValue={q}
              aria-label="Buscar excursiones"
              placeholder="Buscar: saona, catamarán, buggy, tirolesa, buceo…"
              className="h-12 w-full rounded-xl border border-border bg-card pl-12 pr-4 text-sm sm:text-base text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
          </div>
        </form>
      </search>

      {/* Chips de categoría - Scroll horizontal táctil sin barra */}
      {categorias.length > 0 && (
        <nav aria-label="Categorías">
          <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
            {[{ slug: null, name: 'Todas' }, ...categorias].map((cat) => {
              const activa = (cat.slug?.toLowerCase() || null) === (categoria?.toLowerCase() || null)
              return (
                <li key={cat.slug ?? 'todas'} className="shrink-0">
                  <Link
                    href={hrefCon({ categoria: cat.slug })}
                    aria-current={activa ? 'page' : undefined}
                    className={cn(
                      'inline-flex min-h-10 sm:min-h-11 items-center rounded-full px-4 text-xs sm:text-small font-semibold transition-colors',
                      activa
                        ? 'bg-primary text-primary-foreground'
                        : 'border border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground'
                    )}
                  >
                    {cat.name}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      )}

      {loadError ? (
        <EmptyState
          icon={AlertCircle}
          title="No pudimos cargar las excursiones"
          description="Intenta de nuevo en unos momentos."
          action={
            <Button asChild variant="outline">
              <Link href="/cliente/excursiones">Reintentar</Link>
            </Button>
          }
        />
      ) : buscando ? (
        /* ── Resultados ─────────────────────────────────────────────────── */
        <div className="space-y-6">
          <p className="text-xs sm:text-small text-muted-foreground" role="status">
            {resultados.length} {resultados.length === 1 ? 'excursión vigente encontrada' : 'excursiones vigentes encontradas'}
            {categoriaActiva ? ` en ${categoriaActiva.name}` : ''}
            {q ? ` para «${q}»` : ''}
          </p>
          {resultados.length === 0 ? (
            <EmptyState
              icon={Compass}
              title={q ? `Sin resultados para «${q}»` : 'Sin excursiones vigentes con esos filtros'}
              description="Prueba con otros términos o explora todas las excursiones."
              action={
                <Button asChild variant="outline">
                  <Link href="/cliente/excursiones">Ver todas las excursiones</Link>
                </Button>
              }
            />
          ) : (
            <ExcursionGrid excursiones={resultados} />
          )}
        </div>
      ) : feed == null ? (
        <EmptyState
          icon={AlertCircle}
          title="No pudimos cargar las excursiones"
          description="Intenta de nuevo en unos momentos."
          action={
            <Button asChild variant="outline">
              <Link href="/cliente/excursiones">Reintentar</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-10 sm:space-y-12">
          {/* De tus empresas: donde soy cliente + las que sigo */}
          <SeccionExcursiones
            icon={Star}
            titulo="De tus empresas"
            descripcion="Donde eres cliente y las que sigues. Tus favoritas primero."
            excursiones={feed.misEmpresas}
          />

          {/* Próximas salidas */}
          <SeccionExcursiones
            icon={CalendarDays}
            titulo="Próximas salidas"
            descripcion="Tours con salidas programadas y cupos disponibles."
            excursiones={feed.proximasSalidas}
          />

          {/* Destacadas */}
          <SeccionExcursiones
            icon={Flame}
            titulo="Destacadas"
            descripcion="Las experiencias más populares y reservadas."
            excursiones={feed.destacadas}
          />

          {/* Nuevas */}
          <SeccionExcursiones
            icon={Sparkles}
            titulo="Nuevas aventuras"
            descripcion="Publicadas recientemente por las empresas."
            excursiones={feed.nuevas}
          />

          {/* Sin excursiones */}
          {sinExcursiones && (
            <EmptyState
              icon={Compass}
              title="Sin excursiones activas por el momento"
              description="Sigue empresas para enterarte tan pronto publiquen nuevas experiencias."
              action={
                <Button asChild size="lg">
                  <Link href="/cliente/explorar">Explorar empresas</Link>
                </Button>
              }
            />
          )}
        </div>
      )}
    </div>
  )
}