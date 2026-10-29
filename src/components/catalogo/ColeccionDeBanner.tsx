import Link from 'next/link'
import { ArrowRight, Package } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ItemPublicoResumen } from '@/modules/catalog/publico-nucleo'
import type { OfertaPublica } from '@/modules/deals/publico-nucleo'
import { claveDeItem, indiceDeOfertas } from '@/modules/comercio/vitrina'
import { rutaDeEmpresa, type Espacio } from '@/modules/comercio/rutas'
import { TarjetaCatalogoPublica } from './TarjetaCatalogoPublica'

/**
 * LA COLECCIÓN DE UN BANNER (aprobado 2026-10-29).
 *
 * Al tocar un banner del Inicio con destino «Productos y servicios» se llega
 * aquí: arriba, LOS PRINCIPALES (lo que el negocio enganchó al banner, en su
 * orden); debajo, lo que venden EMPRESAS RELACIONADAS (misma categoría de
 * negocio). Es la misma pantalla en la app y en la landing: cambia el
 * `espacio`, que decide adónde lleva cada tarjeta.
 *
 * Componente de servidor y sin estado: recibe proyecciones públicas ya
 * resueltas. Si no queda ningún principal (se pausaron todos), la página que
 * lo monta responde «no encontrado»: una colección vacía no es una pantalla.
 */
export function ColeccionDeBanner({
  titulo,
  empresa,
  principales,
  relacionados,
  ofertas,
  espacio,
  ranuraTraspaso,
}: {
  /** El titular del banner, si lo trajo; si no, el nombre del negocio. */
  titulo: string | null
  empresa: { name: string; slug: string }
  principales: readonly ItemPublicoResumen[]
  relacionados: readonly ItemPublicoResumen[]
  /** Ofertas vivas para enseñar «antes / ahora» en las tarjetas que la tengan. */
  ofertas: readonly OfertaPublica[]
  espacio: Espacio
  /** En la landing: el traspaso a la app donde irían las acciones. */
  ranuraTraspaso?: ReactNode
}) {
  const ofertaPorItem = indiceDeOfertas(ofertas)
  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
      <nav aria-label="Volver" className="text-small">
        <Link href={rutaDeEmpresa(espacio, empresa.slug)} className="text-primary hover:underline">
          ← {empresa.name}
        </Link>
      </nav>
      <h1 className="mt-3 text-h1 text-foreground">{titulo ?? `Lo destacado de ${empresa.name}`}</h1>
      <p className="mt-2 text-muted-foreground">
        {titulo ? `De ${empresa.name}. ` : ''}
        {principales.length === 1 ? 'Lo que este banner te trae, con su precio.' : 'Lo que este banner te trae, con sus precios.'}
      </p>

      <section aria-label="Principales" className="mt-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {principales.map((item) => (
            <TarjetaCatalogoPublica key={item.id} item={item} espacio={espacio} oferta={ofertaPorItem.get(claveDeItem(item)) ?? null} />
          ))}
        </div>
        <Link
          href={rutaDeEmpresa(espacio, empresa.slug)}
          className="mt-4 inline-flex items-center gap-1.5 text-label-md font-semibold text-primary hover:underline"
        >
          Ver todo lo de {empresa.name}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </section>

      {ranuraTraspaso}

      {relacionados.length > 0 ? (
        <section aria-label="De empresas relacionadas" className="mt-12">
          <h2 className="text-h2 text-foreground">También te puede interesar</h2>
          <p className="mt-2 text-muted-foreground">Productos y servicios de negocios relacionados con {empresa.name}.</p>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {relacionados.map((item) => (
              <TarjetaCatalogoPublica
                key={item.id}
                item={item}
                espacio={espacio}
                mostrarEmpresa
                oferta={ofertaPorItem.get(claveDeItem(item)) ?? null}
              />
            ))}
          </div>
        </section>
      ) : (
        <p className="mt-12 flex items-center gap-2 text-small text-muted-foreground">
          <Package className="size-4" aria-hidden />
          Todavía no hay negocios relacionados con catálogo publicado.
        </p>
      )}
    </main>
  )
}
