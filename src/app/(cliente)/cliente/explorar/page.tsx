import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Search, Store } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { esMarcaUnica } from '@/modules/marketplace/marcaUnica'
import { getCompaniesPublic, getCategoriesPublic } from '@/modules/marketplace/cached'
import { getSeguidasIds } from '@/modules/social/queries'
import { ExplorarEmpresasList } from '@/components/cliente/ExplorarEmpresasList'
import { EmptyState } from '@/components/system/EmptyState'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Explorar empresas',
  description: 'Descubre negocios afiliados y únete a sus membresías',
}

export default async function ExplorarEmpresasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requireRole('CLIENTE')

  // Marca única: con UNA sola empresa publicada no se muestra el explorador
  // multi-empresa — el cliente va directo a las membresías del negocio.
  // Cuando haya más empresas, esta pantalla reaparece sola.
  if (await esMarcaUnica()) redirect('/cliente/planes')

  const params = await searchParams
  const search = typeof params.q === 'string' ? params.q.trim() : ''
  const category = typeof params.category === 'string' ? params.category : ''

  const [companies, seguidas, categorias] = await Promise.all([
    getCompaniesPublic({
      search: search || undefined,
      category: category || undefined,
      limit: 100,
    }),
    getSeguidasIds(user.metadata.dbUserId),
    getCategoriesPublic().catch(() => []),
  ])

  /** Chips: conservan la búsqueda activa al cambiar de categoría. */
  const chipHref = (slug: string | null) => {
    const qs = new URLSearchParams()
    if (search) qs.set('q', search)
    if (slug) qs.set('category', slug)
    const s = qs.toString()
    return `/cliente/explorar${s ? `?${s}` : ''}`
  }

  const filtrando = Boolean(search || category)
  const categoriaActiva = categorias.find((c) => c.slug === category)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Encuentra membresías"
        description="Suscríbete a los negocios cerca de ti y ahorra en cada visita."
      />

      {/* Buscador — método GET a propósito: la búsqueda queda en la URL, se
          puede compartir y el botón "atrás" funciona. */}
      <search>
        <form action="/cliente/explorar" role="search">
          {category && <input type="hidden" name="category" value={category} />}
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
            />
            <input
              name="q"
              type="search"
              defaultValue={search}
              aria-label="Buscar negocios"
              placeholder="Buscar lavados, peluquerías, gym…"
              className="h-12 w-full rounded-xl border border-border bg-card pl-12 pr-4 text-base text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
          </div>
        </form>
      </search>

      {/* Chips de categoría */}
      {categorias.length > 0 && (
        <nav aria-label="Categorías">
          <ul className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {[{ slug: null, name: 'Todas' }, ...categorias].map((cat) => {
              const activa = cat.slug === (category || null)
              return (
                <li key={cat.slug ?? 'todas'} className="shrink-0">
                  <Link
                    href={chipHref(cat.slug)}
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

      {/* Recuento: confirma que el filtro hizo algo. */}
      {companies.length > 0 && (
        <p className="text-small text-muted-foreground" role="status">
          {companies.length} {companies.length === 1 ? 'negocio' : 'negocios'}
          {categoriaActiva ? ` en ${categoriaActiva.name}` : ''}
          {search ? ` para «${search}»` : ''}
        </p>
      )}

      {companies.length === 0 ? (
        <EmptyState
          icon={Store}
          title={search ? `Sin resultados para «${search}»` : 'Todavía no hay negocios aquí'}
          description={
            filtrando
              ? 'Prueba con otra palabra o quita los filtros para ver todos.'
              : 'Vuelve pronto: se van sumando negocios nuevos.'
          }
          action={
            filtrando ? (
              <Button asChild variant="outline">
                <Link href="/cliente/explorar">Ver todos</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
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
      )}
    </div>
  )
}
