import Link from 'next/link'
import {
  AlertCircle,
  Heart,
  Star,
  Sparkles,
  Clock,
  Compass,
  ThumbsUp,
  Flame,
  Tag,
  Search,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import {
  getPromoFeed,
  getPromocionesGuardadas,
  getGuardadasIds,
  buscarEnMisEmpresas,
  type PromoFeed,
} from '@/modules/social/queries'
import { getPromotionsPublic, getCategoriesPublic } from '@/modules/marketplace/cached'
import { cn } from '@/lib/utils'
import type { CategoryPublic } from '@/modules/marketplace/types'
import { PromotionCard } from '@/components/public/PromotionCard'
import { EmptyState } from '@/components/system/EmptyState'
import { BusinessCard } from '@/components/marketplace/BusinessCard'
import { PageHeader } from '@/components/ui/page-header'
import { SectionHeader } from '@/components/ui/section-header'
import { SavePromoButton } from '@/components/cliente/SavePromoButton'
import { Button } from '@/components/ui/button'
import type { PromotionPublic } from '@/modules/marketplace/types'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Ofertas',
  description: 'Ofertas y beneficios disponibles para ti',
}

function PromoGridConGuardar({
  promociones,
  guardadasIds,
}: {
  promociones: PromotionPublic[]
  guardadasIds: Set<string>
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {promociones.map((p) => (
        <div key={p.id} className="relative">
          <PromotionCard promotion={p} hrefBase="/cliente/promociones" />
          <SavePromoButton promocionId={p.id} guardada={guardadasIds.has(p.id)} />
        </div>
      ))}
    </div>
  )
}

/**
 * Sección del feed de ofertas.
 *
 * DS 2.0 · Fase 4: antes cada sección recibía su propio `iconBg` e `iconClass`
 * y acababa eligiendo colores sueltos —`fill-rose-500`, `fill-amber-400`— sin
 * más razón que decorar. Ahora el icono es siempre de marca y lo que distingue
 * a una sección de otra es su TÍTULO, que es lo que la gente lee.
 */
function SeccionPromos({
  icon: Icon,
  titulo,
  descripcion,
  promociones,
  guardadasIds,
}: {
  icon: LucideIcon
  titulo: string
  descripcion?: string
  promociones: PromotionPublic[]
  guardadasIds: Set<string>
}) {
  if (promociones.length === 0) return null
  return (
    <section>
      <SectionHeader
        title={titulo}
        description={descripcion}
        action={
          <span className="inline-flex items-center gap-1.5 text-caption">
            <Icon className="h-4 w-4 text-primary" aria-hidden />
            {promociones.length}
            <span className="sr-only">ofertas</span>
          </span>
        }
      />
      <PromoGridConGuardar promociones={promociones} guardadasIds={guardadasIds} />
    </section>
  )
}

/**
 * BUSCAR ES OTRA PANTALLA, AUNQUE SEA LA MISMA RUTA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SIN FILTROS: EL FEED
 *
 * Secciones curadas —tus empresas, destacadas, nuevas, expiran pronto,
 * recomendadas—. Es lo que sirve cuando alguien entra a ver qué hay.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CON FILTROS: UNA LISTA PLANA
 *
 * Quien escribe «barbería» no quiere sus resultados repartidos en seis
 * secciones con nombres que ya no significan nada: quiere una lista y un
 * número. Las secciones curadas se apagan y aparece el resultado.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TODO VA EN LA URL
 *
 * `?q=`, `?categoria=`, `?empresa=`. El formulario es GET a propósito: la
 * búsqueda se puede compartir, el botón «atrás» funciona y recargar no la
 * pierde. Es el mismo criterio que ya seguía Explorar.
 */
export default async function PromocionesDisponiblesPage({
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
  const buscando = Boolean(q || categoria || empresa)

  let feed: PromoFeed | null = null
  let guardadas: PromotionPublic[] = []
  let guardadasIds = new Set<string>()
  let categorias: CategoryPublic[] = []
  let resultados: PromotionPublic[] = []
  let loadError = false
  try {
    ;[guardadasIds, categorias] = await Promise.all([
      getGuardadasIds(user.metadata.dbUserId),
      getCategoriesPublic().catch(() => []),
    ])
    if (buscando) {
      // Dos fuentes, y las dos hacen falta. La vitrina pública trae lo de
      // cualquier negocio; `buscarEnMisEmpresas` trae lo que solo esta persona
      // puede ver —las privadas de los negocios donde es cliente—. Sin la
      // segunda, buscar el nombre de una oferta que tiene delante en su inicio
      // devolvería «sin resultados».
      const [publicas, mias] = await Promise.all([
        getPromotionsPublic({
          search: q || undefined,
          category: categoria || undefined,
          company: empresa || undefined,
          limit: 60,
        }),
        empresa
          ? Promise.resolve([])
          : buscarEnMisEmpresas(user.metadata.dbUserId, { texto: q, categoria }),
      ])
      const porId = new Map<string, PromotionPublic>()
      for (const p of [...mias, ...publicas]) porId.set(p.id, p)
      resultados = [...porId.values()]
    } else {
      ;[feed, guardadas] = await Promise.all([
        getPromoFeed(user.metadata.dbUserId),
        getPromocionesGuardadas(user.metadata.dbUserId),
      ])
    }
  } catch (e) {
    loadError = true
    console.error('[cliente-promociones]', e)
  }

  /** Enlaces de los chips: cambiar de categoría no borra lo que se escribió. */
  const hrefCon = (cambios: { categoria?: string | null }) => {
    const qs = new URLSearchParams()
    if (q) qs.set('q', q)
    if (empresa) qs.set('empresa', empresa)
    const cat = cambios.categoria === undefined ? categoria : cambios.categoria
    if (cat) qs.set('categoria', cat)
    const s = qs.toString()
    return `/cliente/promociones${s ? `?${s}` : ''}`
  }
  const categoriaActiva = categorias.find((c) => c.slug === categoria)

  const sinPromos =
    feed != null &&
    feed.misEmpresas.length === 0 &&
    feed.destacadas.length === 0 &&
    feed.nuevas.length === 0 &&
    feed.expiranPronto.length === 0 &&
    feed.recomendadas.length === 0

  return (
    <div>
      <PageHeader
        eyebrow="Beneficios"
        title="Ofertas para ti"
        description="Lo de tus empresas favoritas primero. Todo canjeable con tu QR."
        action={
          <Button asChild variant="outline">
            <Link href="/cliente/explorar">
              <Compass aria-hidden />
              Explorar empresas
            </Link>
          </Button>
        }
      />

      {/* Buscador — GET a propósito: la búsqueda queda en la URL, se puede
          compartir y el botón «atrás» funciona. */}
      <search className="mt-6 block">
        <form action="/cliente/promociones" role="search">
          {categoria && <input type="hidden" name="categoria" value={categoria} />}
          {empresa && <input type="hidden" name="empresa" value={empresa} />}
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
            />
            <input
              name="q"
              type="search"
              defaultValue={q}
              aria-label="Buscar ofertas"
              placeholder="Buscar ofertas: lavado, pizza, corte…"
              className="h-12 w-full rounded-xl border border-border bg-card pl-12 pr-4 text-base text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
          </div>
        </form>
      </search>

      {/* Chips de categoría: son del NEGOCIO que publica, no de la oferta.
          Quien busca «barbería» busca ofertas de barberías. */}
      {categorias.length > 0 && (
        <nav aria-label="Categorías" className="mt-4">
          <ul className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {[{ slug: null, name: 'Todas' }, ...categorias].map((cat) => {
              const activa = cat.slug === (categoria || null)
              return (
                <li key={cat.slug ?? 'todas'} className="shrink-0">
                  <Link
                    href={hrefCon({ categoria: cat.slug })}
                    aria-current={activa ? 'page' : undefined}
                    className={cn(
                      'inline-flex min-h-11 items-center rounded-full px-4 text-small font-semibold transition-colors',
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
          title="No pudimos cargar las promociones"
          description="Intenta de nuevo en unos momentos."
          action={
            <Button asChild variant="outline">
              <Link href="/cliente/promociones">Reintentar</Link>
            </Button>
          }
        />
      ) : buscando ? (
        /* ── Resultados ─────────────────────────────────────────────────── */
        <div className="mt-6 space-y-6">
          <p className="text-small text-muted-foreground" role="status">
            {resultados.length} {resultados.length === 1 ? 'oferta' : 'ofertas'}
            {categoriaActiva ? ` en ${categoriaActiva.name}` : ''}
            {q ? ` para «${q}»` : ''}
          </p>
          {resultados.length === 0 ? (
            <EmptyState
              icon={Tag}
              title={q ? `Sin resultados para «${q}»` : 'Sin ofertas con esos filtros'}
              description="Prueba con otra palabra, cambia de categoría o mira todas las ofertas."
              action={
                <Button asChild variant="outline">
                  <Link href="/cliente/promociones">Ver todas las ofertas</Link>
                </Button>
              }
            />
          ) : (
            <PromoGridConGuardar promociones={resultados} guardadasIds={guardadasIds} />
          )}
        </div>
      ) : feed == null ? (
        <EmptyState
          icon={AlertCircle}
          title="No pudimos cargar las promociones"
          description="Intenta de nuevo en unos momentos."
          action={
            <Button asChild variant="outline">
              <Link href="/cliente/promociones">Reintentar</Link>
            </Button>
          }
        />
      ) : (
        <div className="mt-6 space-y-10">
          {/* Guardadas */}
          <SeccionPromos
            icon={Heart}
            titulo="Guardadas"
            promociones={guardadas}
            guardadasIds={guardadasIds}
          />

          {/* Mis empresas: donde soy cliente + las que sigo */}
          <SeccionPromos
            icon={Star}
            titulo="De tus empresas"
            descripcion="Donde eres cliente y las que sigues. Tus favoritas primero."
            promociones={feed.misEmpresas}
            guardadasIds={guardadasIds}
          />

          {/* Destacadas */}
          <SeccionPromos
            icon={Flame}
            titulo="Destacadas"
            promociones={feed.destacadas}
            guardadasIds={guardadasIds}
          />

          {/* Nuevas */}
          <SeccionPromos
            icon={Sparkles}
            titulo="Nuevas"
            descripcion="Publicadas en los últimos 14 días."
            promociones={feed.nuevas}
            guardadasIds={guardadasIds}
          />

          {/* Expiran pronto */}
          <SeccionPromos
            icon={Clock}
            titulo="Expiran pronto"
            descripcion="Aprovéchalas antes de que venzan."
            promociones={feed.expiranPronto}
            guardadasIds={guardadasIds}
          />

          {/* Recomendadas */}
          <SeccionPromos
            icon={ThumbsUp}
            titulo="Recomendadas para ti"
            descripcion="De empresas parecidas a las que sigues."
            promociones={feed.recomendadas}
            guardadasIds={guardadasIds}
          />

          {/* Sin promociones */}
          {sinPromos && guardadas.length === 0 && (
            <EmptyState
              icon={Tag}
              title="Sin promociones activas"
              description="Sigue empresas para recibir sus promociones apenas se publiquen."
              action={
                <Button asChild size="lg">
                  <Link href="/cliente/explorar">Explorar empresas</Link>
                </Button>
              }
            />
          )}

          {/* Descubrir empresas */}
          {feed.empresasRecomendadas.length > 0 && (
            <section>
              <SectionHeader
                title="Descubrir empresas"
                description="También podrían interesarte."
                action={
                  <Button asChild variant="ghost" size="sm">
                    <Link href="/cliente/explorar">Ver todas</Link>
                  </Button>
                }
              />
              <ul className="grid gap-3 sm:grid-cols-2">
                {feed.empresasRecomendadas.map((c) => (
                  <li key={c.id} className="flex">
                    <BusinessCard
                      variant="compact"
                      hrefBase="/cliente/empresas"
                      className="w-full"
                      company={{
                        id: c.id,
                        name: c.name,
                        slug: c.slug,
                        type: c.type,
                        logoUrl: c.logoUrl,
                        bannerUrl: c.bannerUrl,
                        ciudad: c.ciudad,
                        activePromotionsCount: c.activePromotionsCount,
                        totalMembersCount: c.totalMembersCount,
                      }}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
