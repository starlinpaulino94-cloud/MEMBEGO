import Link from 'next/link'
import Image from 'next/image'
import { Search, Store, Infinity as InfinityIcon, Check } from 'lucide-react'
import type { PlanConEmpresa } from '@/modules/marketplace/queries'
import type { CategoryPublic } from '@/modules/marketplace/types'
import { EmptyState } from '@/components/system/EmptyState'
import { Button } from '@/components/ui/button'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * EL CATÁLOGO DE MEMBRESÍAS DE TODA LA PLATAFORMA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ RESUELVE
 *
 * «Planes» enseñaba los de la empresa activa. Quien todavía no era cliente de
 * nadie —el estado normal desde que existe una cuenta de Membego sin empresa—
 * recibía un estado vacío al pedir ver membresías. Es la peor respuesta
 * posible a esa pregunta: la plataforma tiene planes, solo que ninguno era
 * «suyo» todavía.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AQUÍ SE MIRA; SE CONTRATA EN EL NEGOCIO
 *
 * Cada tarjeta lleva al perfil de su empresa. No es un rodeo: el precio que le
 * corresponde a una persona depende de la categoría de su vehículo y de su
 * historial en ESE negocio, y eso lo decide `planesElegibles` con su ficha
 * delante. Poner aquí un botón de comprar sería enseñar un precio que puede no
 * ser el suyo.
 *
 * Por eso el precio va con un «desde»: es el de catálogo, no una oferta
 * personal.
 */
export function CatalogoPlanesGlobal({
  planes,
  categorias,
  q,
  categoria,
  volverAMiEmpresa,
}: {
  planes: PlanConEmpresa[]
  categorias: CategoryPublic[]
  q: string
  categoria: string
  /** Nombre de su empresa activa, si tiene una a la que volver. */
  volverAMiEmpresa?: string | null
}) {
  const hrefCon = (cat: string | null) => {
    const qs = new URLSearchParams({ todos: '1' })
    if (q) qs.set('q', q)
    if (cat) qs.set('categoria', cat)
    return `/cliente/planes?${qs.toString()}`
  }
  const categoriaActiva = categorias.find((c) => c.slug === categoria)

  // Agrupadas por negocio: un cliente elige primero DÓNDE y después qué plan.
  // Una lista plana de planes de seis empresas distintas obliga a leer el
  // nombre del negocio en cada tarjeta para no perderse.
  const porEmpresa = new Map<string, { empresa: PlanConEmpresa['company']; planes: PlanConEmpresa[] }>()
  for (const p of planes) {
    const grupo = porEmpresa.get(p.company.id)
    if (grupo) grupo.planes.push(p)
    else porEmpresa.set(p.company.id, { empresa: p.company, planes: [p] })
  }

  return (
    // Sin `main` ni contenedor: los pone el CustomerShell.
    <div className="space-y-5 animate-fade-up">
      <header>
        {/* `flex-wrap` + truncado: el nombre de la empresa es texto ajeno y
            no puede decidir el ancho del documento a 390px. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-overline text-primary">Membresías</p>
          {volverAMiEmpresa && (
            <Link
              href="/cliente/planes"
              className="inline-flex min-h-9 max-w-full items-center rounded-full border border-border bg-card px-3 text-label-md font-semibold text-muted-foreground outline-none transition-colors duration-fast hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="truncate">Planes de {volverAMiEmpresa}</span>
            </Link>
          )}
        </div>
        <h1 className="mt-2 max-w-2xl text-h2 text-foreground">
          Membresías de todos los negocios
        </h1>
        <p className="mt-1 max-w-xl text-small text-muted-foreground">
          Paga menos por lo que ya haces. Elige el negocio y mira sus planes con
          todos los detalles.
        </p>
      </header>

      {/* GET: la búsqueda vive en la URL, se comparte y «atrás» funciona. */}
      <search className="block">
        <form action="/cliente/planes" role="search">
          <input type="hidden" name="todos" value="1" />
          {categoria && <input type="hidden" name="categoria" value={categoria} />}
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
            />
            <input
              name="q"
              type="search"
              defaultValue={q}
              aria-label="Buscar membresías"
              placeholder="Buscar por plan o por negocio…"
              className="h-12 w-full rounded-lg border border-border bg-card pl-12 pr-4 text-body text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
          </div>
        </form>
      </search>

      {categorias.length > 0 && (
        <nav aria-label="Categorías" className="mt-4">
          <ul className="relative no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {[{ slug: null, name: 'Todas' }, ...categorias].map((cat) => {
              const activa = cat.slug === (categoria || null)
              return (
                <li key={cat.slug ?? 'todas'} className="shrink-0">
                  <Link
                    href={hrefCon(cat.slug)}
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

      {planes.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={Store}
            title={q ? `Sin membresías para «${q}»` : 'Todavía no hay membresías publicadas'}
            description={
              q || categoria
                ? 'Prueba con otra palabra o quita los filtros.'
                : 'Los negocios van publicando sus planes. Vuelve pronto.'
            }
            action={
              q || categoria ? (
                <Button asChild variant="outline">
                  <Link href="/cliente/planes?todos=1">Ver todas</Link>
                </Button>
              ) : (
                <Button asChild variant="outline">
                  <Link href="/cliente/explorar">Explorar negocios</Link>
                </Button>
              )
            }
          />
        </div>
      ) : (
        <>
          <p className="mt-6 text-small text-muted-foreground" role="status">
            {planes.length} {planes.length === 1 ? 'plan' : 'planes'} en{' '}
            {porEmpresa.size} {porEmpresa.size === 1 ? 'negocio' : 'negocios'}
            {categoriaActiva ? ` · ${categoriaActiva.name}` : ''}
            {q ? ` para «${q}»` : ''}
          </p>

          <div className="mt-4 space-y-8">
            {[...porEmpresa.values()].map(({ empresa, planes: suyos }) => (
              <section key={empresa.id}>
                <div className="mb-3 flex items-center gap-3">
                  {empresa.logoUrl ? (
                    <Image
                      src={empresa.logoUrl}
                      alt=""
                      width={40}
                      height={40}
                      className="h-10 w-10 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-primary-soft text-primary">
                      <Store className="h-5 w-5" aria-hidden />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-h4 text-foreground">{empresa.name}</h2>
                    {empresa.ciudad && (
                      <p className="truncate text-caption">{empresa.ciudad}</p>
                    )}
                  </div>
                  <Button asChild variant="outline" size="sm" className="shrink-0 rounded-full">
                    <Link href={`/cliente/empresas/${empresa.slug}`}>Ver negocio</Link>
                  </Button>
                </div>

                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {suyos.map((p) => (
                    <li key={p.id} className="flex">
                      <Link
                        href={`/cliente/empresas/${empresa.slug}`}
                        className="flex w-full flex-col rounded-lg border border-border bg-card p-4 elevation-1 transition-colors duration-fast hover:border-primary/40"
                      >
                        <p className="text-h4 text-foreground">{p.nombre}</p>
                        <p className="mt-1 text-price-lg tabular-nums text-foreground">
                          <span className="text-overline">desde </span>
                          {formatMoney(p.precio, {
                            moneda: empresa.moneda,
                            idioma: empresa.idioma,
                          })}
                          <span className="text-small font-normal text-muted-foreground">
                            {' '}
                            / {p.vigenciaDias} días
                          </span>
                        </p>
                        <p className="mt-2 flex items-center gap-1.5 text-small text-muted-foreground">
                          {p.esIlimitado ? (
                            <>
                              <InfinityIcon className="h-4 w-4 text-primary" aria-hidden />
                              Uso ilimitado
                            </>
                          ) : (
                            <>
                              <Check className="h-4 w-4 text-primary" aria-hidden />
                              {p.lavadosIncluidos} incluidos
                            </>
                          )}
                        </p>
                        {p.descripcion && (
                          <p className="mt-2 line-clamp-2 text-small text-muted-foreground">
                            {p.descripcion}
                          </p>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
