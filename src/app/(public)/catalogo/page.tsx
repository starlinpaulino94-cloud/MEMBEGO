import type { Metadata } from 'next'
import Link from 'next/link'
import { Package, Search } from 'lucide-react'
import { getCatalogoPublicoGlobal } from '@/modules/marketplace/cached'
import { normalizarBusqueda, normalizarPagina } from '@/modules/catalog/publico-nucleo'
import { TarjetaCatalogoPublica } from '@/components/catalogo/TarjetaCatalogoPublica'
import { SITE_NAME } from '@/lib/site'

export const metadata: Metadata = {
  title: `Productos y servicios · ${SITE_NAME}`,
  description: 'Descubre lo que ofrecen los negocios locales, con sus precios.',
}

const POR_PAGINA = 24
const DESTACADAS = 6

type Origen = 'supply' | 'empresas'
const ORIGENES: readonly { valor: Origen | null; texto: string }[] = [
  { valor: null, texto: 'Todo' },
  { valor: 'supply', texto: 'Ofertas MembeGo' },
  { valor: 'empresas', texto: 'De negocios' },
]

/**
 * Descubrimiento entre empresas del catálogo unificado. Solo aparecen los
 * negocios que lo publican (capacidad encendida) y solo lo que ellos mismos
 * marcaron como visible en el marketplace.
 */
export default async function CatalogoPublicoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const sp = await searchParams
  const q = normalizarBusqueda(sp.q)
  const pagina = normalizarPagina(sp.pagina)
  // Lo que llega por la URL es texto libre: solo valen los valores conocidos.
  const origen: Origen | null = sp.origen === 'supply' || sp.origen === 'empresas' ? sp.origen : null
  // Sin filtros, las ofertas de Membego van destacadas arriba y la lista general es de los negocios;
  // con búsqueda o con un origen elegido, se muestra lo que se pidió, sin duplicar.
  const conDestacadas = origen === null && !q && pagina === 0
  const [destacadas, { items, hayMas }] = await Promise.all([
    conDestacadas ? getCatalogoPublicoGlobal({ origen: 'SUPPLY', limite: DESTACADAS }) : Promise.resolve({ items: [], hayMas: false }),
    getCatalogoPublicoGlobal({
      q,
      pagina,
      limite: POR_PAGINA,
      ...(origen === 'supply' ? { origen: 'SUPPLY' as const } : origen === 'empresas' || (origen === null && !q) ? { origen: 'EMPRESAS' as const } : {}),
    }),
  ])

  const enlace = (p: number, o: Origen | null = origen) => {
    const u = new URLSearchParams()
    if (q) u.set('q', q)
    if (o) u.set('origen', o)
    if (p > 0) u.set('pagina', String(p))
    const s = u.toString()
    return `/catalogo${s ? `?${s}` : ''}`
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-h1 text-foreground">Productos y servicios</h1>
      <p className="mt-2 text-muted-foreground">Lo que ofrecen los negocios de MembeGo, con sus precios.</p>

      <form method="get" action="/catalogo" className="mt-6 flex max-w-md gap-2" role="search">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden />
          <input
            name="q"
            defaultValue={q ?? ''}
            aria-label="Buscar productos y servicios"
            placeholder="Buscar"
            maxLength={80}
            className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm"
          />
        </div>
        {origen && <input type="hidden" name="origen" value={origen} />}
        <button type="submit" className="h-10 rounded-lg border border-border bg-card px-4 text-sm font-medium">
          Buscar
        </button>
      </form>

      <nav className="mt-4 flex flex-wrap gap-2" aria-label="Origen">
        {ORIGENES.map((o) => (
          <Link
            key={o.texto}
            href={enlace(0, o.valor)}
            aria-current={o.valor === origen ? 'page' : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${o.valor === origen ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border text-muted-foreground'}`}
          >
            {o.texto}
          </Link>
        ))}
      </nav>

      {destacadas.items.length > 0 && (
        <section className="mt-8" aria-labelledby="ofertas-membego">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="ofertas-membego" className="text-h3 text-foreground">
              Ofertas MembeGo
            </h2>
            <Link href={enlace(0, 'supply')} className="text-sm underline">
              Ver todas
            </Link>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {destacadas.items.map((item) => (
              <TarjetaCatalogoPublica key={item.id} item={item} mostrarEmpresa />
            ))}
          </div>
        </section>
      )}

      {items.length === 0 && destacadas.items.length > 0 ? null : items.length === 0 ? (
        <div className="mt-12 rounded-lg border border-border py-16 text-center text-muted-foreground">
          <Package className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden />
          <p className="font-medium">{q || origen ? 'Nada coincide con tu búsqueda' : 'Todavía no hay productos publicados'}</p>
          {(q || origen) && (
            <Link href="/catalogo" className="mt-2 inline-block text-sm underline">
              Quitar filtros
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <TarjetaCatalogoPublica key={item.id} item={item} mostrarEmpresa />
            ))}
          </div>
          <nav className="mt-8 flex justify-between text-sm" aria-label="Paginación">
            {pagina > 0 ? <Link href={enlace(pagina - 1)}>← Anteriores</Link> : <span />}
            {hayMas ? <Link href={enlace(pagina + 1)}>Siguientes →</Link> : <span />}
          </nav>
        </>
      )}
    </main>
  )
}
