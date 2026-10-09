import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BadgePercent, Search, ShoppingBag, Store } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { esMarcaUnica } from '@/modules/marketplace/marcaUnica'
import { getCompaniesPublic, getCategoriesPublic, getCatalogoPublicoGlobal } from '@/modules/marketplace/cached'
import { ofertasPublicas } from '@/modules/deals/publico'
import { getSeguidasIds } from '@/modules/social/queries'
import { normalizarBusqueda, normalizarPagina } from '@/modules/catalog/publico-nucleo'
import { claveDeItem, indiceDeOfertas } from '@/modules/comercio/vitrina'
import { ExplorarEmpresasList } from '@/components/cliente/ExplorarEmpresasList'
import { TarjetaCatalogoPublica } from '@/components/catalogo/TarjetaCatalogoPublica'
import { TarjetaOferta } from '@/components/deals/TarjetaOferta'
import { EmptyState } from '@/components/system/EmptyState'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Explorar',
  description: 'Descubre negocios, productos, servicios y ofertas en Membego',
}

type Vista = 'negocios' | 'productos' | 'servicios' | 'ofertas'
const VISTAS: readonly { id: Vista; label: string; icon: typeof Store }[] = [
  { id: 'negocios', label: 'Negocios', icon: Store },
  { id: 'productos', label: 'Productos', icon: ShoppingBag },
  { id: 'servicios', label: 'Servicios', icon: ShoppingBag },
  { id: 'ofertas', label: 'Ofertas', icon: BadgePercent },
]
const POR_PAGINA = 24

/**
 * EXPLORAR — el descubrimiento del marketplace dentro de la app.
 *
 * Antes era solo un directorio de negocios («Encuentra membresías»). Ahora es
 * la puerta a todo lo que se puede conseguir, con UNA taxonomía transversal
 * (las categorías de negocio) que navega por igual negocios, productos,
 * servicios y ofertas: elegir «Comida» filtra las pizzerías Y sus pizzas Y sus
 * ofertas. Los datos son las mismas proyecciones públicas de /catalogo y
 * /ofertas (sin stock exacto, sin costos), con las mismas tarjetas.
 */
export default async function ExplorarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requireRole('CLIENTE')
  const params = await searchParams
  const ver: Vista = VISTAS.some((v) => v.id === params.ver) ? (params.ver as Vista) : 'negocios'

  // Marca única: con UNA sola empresa publicada el directorio de negocios no
  // tiene sentido (se va directo a sus membresías); sus productos y ofertas sí.
  if (ver === 'negocios' && (await esMarcaUnica())) redirect('/cliente/planes')

  const search = typeof params.q === 'string' ? params.q.trim().slice(0, 80) : ''
  const category = typeof params.category === 'string' ? params.category.slice(0, 80) : ''
  const pagina = normalizarPagina(typeof params.pagina === 'string' ? params.pagina : undefined)

  const categorias = await getCategoriesPublic().catch(() => [])
  const categoriaActiva = categorias.find((c) => c.slug === category)
  // Una categoría desconocida en la URL no filtra nada (texto libre).
  const categoriaNegocio = categoriaActiva?.slug

  /** Enlaces que conservan búsqueda y categoría al cambiar de pestaña, y viceversa. */
  const href = (cambios: { ver?: Vista; category?: string | null; q?: string | null; pagina?: number }) => {
    const qs = new URLSearchParams()
    const q = cambios.q === undefined ? search : cambios.q
    const cat = cambios.category === undefined ? category : cambios.category
    const v = cambios.ver ?? ver
    if (q) qs.set('q', q)
    if (cat) qs.set('category', cat)
    if (v !== 'negocios') qs.set('ver', v)
    if (cambios.pagina && cambios.pagina > 0) qs.set('pagina', String(cambios.pagina))
    const s = qs.toString()
    return `/cliente/explorar${s ? `?${s}` : ''}`
  }

  const filtrando = Boolean(search || category)

  // ── Datos de la pestaña activa (solo lo que se va a pintar) ──────────────
  let companies: Awaited<ReturnType<typeof getCompaniesPublic>> = []
  let seguidas = new Set<string>()
  let items: Awaited<ReturnType<typeof getCatalogoPublicoGlobal>> = { items: [], hayMas: false }
  let ofertas: Awaited<ReturnType<typeof ofertasPublicas>> = []
  if (ver === 'negocios') {
    ;[companies, seguidas] = await Promise.all([
      getCompaniesPublic({ search: search || undefined, category: category || undefined, limit: 100 }),
      getSeguidasIds(user.metadata.dbUserId),
    ])
  } else if (ver === 'ofertas') {
    ofertas = await ofertasPublicas({ q: search || undefined, categoriaNegocio, limite: 48 })
  } else {
    ;[items, ofertas] = await Promise.all([
      getCatalogoPublicoGlobal({
        q: normalizarBusqueda(search),
        categoriaNegocio,
        pagina,
        limite: POR_PAGINA,
        origen: 'EMPRESAS',
        ...(ver === 'servicios' ? { tipo: 'SERVICE' as const } : {}),
      }),
      // Para pintar «antes / ahora» en las tarjetas de los productos que tienen oferta.
      ofertasPublicas({ categoriaNegocio, limite: 60 }).catch(() => []),
    ])
    if (ver === 'productos') items = { ...items, items: items.items.filter((i) => i.type !== 'SERVICE') }
  }
  const ofertaPorItem = indiceDeOfertas(ofertas)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Explorar"
        description="Negocios, productos, servicios y ofertas cerca de ti. Pide, reserva u obtén tu oferta y canjéala con tu QR."
      />

      {/* Buscador — método GET a propósito: la búsqueda queda en la URL, se
          puede compartir y el botón "atrás" funciona. */}
      <search>
        <form action="/cliente/explorar" role="search">
          {category && <input type="hidden" name="category" value={category} />}
          {ver !== 'negocios' && <input type="hidden" name="ver" value={ver} />}
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <input
              name="q"
              type="search"
              defaultValue={search}
              maxLength={80}
              aria-label="Buscar negocios, productos, servicios y ofertas"
              placeholder="Buscar pizza, lavado, barbería, AirPods…"
              className="h-12 w-full rounded-xl border border-border bg-card pl-12 pr-4 text-base text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
          </div>
        </form>
      </search>

      {/* Pestañas: qué estás explorando */}
      <nav aria-label="Qué explorar">
        <ul className="relative no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {VISTAS.map((v) => {
            const activa = v.id === ver
            const Icon = v.icon
            return (
              <li key={v.id} className="shrink-0">
                <Link
                  href={href({ ver: v.id })}
                  aria-current={activa ? 'page' : undefined}
                  className={cn(
                    'inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-small font-semibold transition-colors',
                    activa ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground'
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {v.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Chips de categoría: UNA taxonomía para negocios, productos, servicios y ofertas */}
      {categorias.length > 0 && (
        <nav aria-label="Categorías">
          <ul className="relative no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {[{ slug: null, name: 'Todas' }, ...categorias].map((cat) => {
              const activa = cat.slug === (category || null)
              return (
                <li key={cat.slug ?? 'todas'} className="shrink-0">
                  <Link
                    href={href({ category: cat.slug })}
                    aria-current={activa ? 'page' : undefined}
                    className={cn(
                      'inline-flex min-h-10 items-center rounded-full px-4 text-small font-semibold transition-colors',
                      activa ? 'bg-retail-deep text-white' : 'border border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground'
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

      {/* ── Negocios ─────────────────────────────────────────────────────── */}
      {ver === 'negocios' &&
        (companies.length === 0 ? (
          <EmptyState
            icon={Store}
            title={search ? `Sin negocios para «${search}»` : 'Todavía no hay negocios aquí'}
            description={filtrando ? 'Prueba con otra palabra, otra categoría, o mira los productos y las ofertas.' : 'Vuelve pronto: se van sumando negocios nuevos.'}
            action={
              filtrando ? (
                <Button asChild variant="outline">
                  <Link href="/cliente/explorar">Ver todos</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <p className="text-small text-muted-foreground" role="status">
              {companies.length} {companies.length === 1 ? 'negocio' : 'negocios'}
              {categoriaActiva ? ` en ${categoriaActiva.name}` : ''}
              {search ? ` para «${search}»` : ''}
            </p>
            <ExplorarEmpresasList
              empresas={companies.map((c) => ({
                id: c.id,
                name: c.name,
                slug: c.slug,
                type: c.type,
                logoUrl: c.logoUrl,
                bannerUrl: c.bannerUrl,
                ciudad: c.ciudad,
                descripcion: c.description,
                totalMembersCount: c.totalMembersCount,
                activePromotionsCount: c.activePromotionsCount,
                averageRating: c.averageRating,
                isFeatured: c.isFeatured,
                desdePlan: c.desdePlan ?? null,
              }))}
              seguidasIds={[...seguidas]}
            />
          </>
        ))}

      {/* ── Productos / Servicios ────────────────────────────────────────── */}
      {(ver === 'productos' || ver === 'servicios') &&
        (items.items.length === 0 ? (
          <EmptyState
            icon={ShoppingBag}
            title={search ? `Sin ${ver} para «${search}»` : ver === 'servicios' ? 'Todavía no hay servicios publicados' : 'Todavía no hay productos publicados'}
            description={filtrando ? 'Prueba con otra palabra o quita los filtros.' : 'Los negocios van publicando su catálogo; vuelve pronto.'}
            action={
              filtrando ? (
                <Button asChild variant="outline">
                  <Link href={href({ q: null, category: null })}>Quitar filtros</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <p className="text-small text-muted-foreground" role="status">
              {items.items.length} {ver === 'servicios' ? (items.items.length === 1 ? 'servicio' : 'servicios') : items.items.length === 1 ? 'producto' : 'productos'}
              {categoriaActiva ? ` en ${categoriaActiva.name}` : ''}
              {search ? ` para «${search}»` : ''}
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {items.items.map((item) => (
                <TarjetaCatalogoPublica key={item.id} item={item} mostrarEmpresa oferta={ofertaPorItem.get(claveDeItem(item)) ?? null} />
              ))}
            </div>
            {(pagina > 0 || items.hayMas) && (
              <nav className="flex justify-between text-sm" aria-label="Paginación">
                {pagina > 0 ? (
                  <Link href={href({ pagina: pagina - 1 })} className="text-primary hover:underline">
                    ← Anteriores
                  </Link>
                ) : (
                  <span />
                )}
                {items.hayMas ? (
                  <Link href={href({ pagina: pagina + 1 })} className="text-primary hover:underline">
                    Siguientes →
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            )}
          </>
        ))}

      {/* ── Ofertas ──────────────────────────────────────────────────────── */}
      {ver === 'ofertas' &&
        (ofertas.length === 0 ? (
          <EmptyState
            icon={BadgePercent}
            title={search ? `Sin ofertas para «${search}»` : 'Por ahora no hay ofertas disponibles'}
            description={filtrando ? 'Prueba con otra palabra o quita los filtros.' : 'Los negocios publican ofertas sobre sus productos y servicios; vuelve pronto.'}
            action={
              filtrando ? (
                <Button asChild variant="outline">
                  <Link href={href({ q: null, category: null })}>Quitar filtros</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <p className="text-small text-muted-foreground" role="status">
              {ofertas.length} {ofertas.length === 1 ? 'oferta' : 'ofertas'}
              {categoriaActiva ? ` en ${categoriaActiva.name}` : ''}
              {search ? ` para «${search}»` : ''}
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {ofertas.map((o) => (
                <TarjetaOferta key={o.id} oferta={o} retorno={href({})} espacio="app" />
              ))}
            </div>
          </>
        ))}
    </div>
  )
}
