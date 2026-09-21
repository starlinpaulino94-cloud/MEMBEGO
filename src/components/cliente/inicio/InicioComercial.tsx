import Link from 'next/link'
import { Store } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import type { TipoBloque } from '@/modules/home/esquema'
import type { InicioVista } from '@/modules/home/vista'
import { VibeCategorias } from './VibeCategorias'
import { VibeHero } from './VibeHero'
import { VibeRelacionado } from './VibeRelacionado'
import { VibeRelampago } from './VibeRelampago'
import { VibePromocionesNovedades } from './VibePromocionesNovedades'
import { VibeEmpresasScroll } from './VibeEmpresasScroll'

function assertNever(value: never): never {
  throw new TypeError(`Bloque de inicio no soportado: ${String(value)}`)
}

/**
 * REDISEÑO VIOLETA (Stitch «amazon style» enriquecido):
 *
 * - CATEGORIAS → chips violeta (solo las píldoras, van arriba del todo).
 * - HERO → héroe a foto completa con asomo + Novedades y promociones debajo.
 * - DESTACADAS → scroll horizontal de empresas (híbrido mis empresas + destacadas) con botón "Ver más".
 * - MEMBRESIAS → «Membresías recomendadas para ti» con badges contextuales.
 * - EXPERIENCIAS → cabecera de excursiones + tarjeta «Ofertas Relámpago» con timer.
 */
function renderBlock(tipo: TipoBloque, data: InicioVista): ReactNode {
  switch (tipo) {
    case 'CABECERA':
      return null
    case 'HERO':
      return (
        <>
          <VibeHero heroes={data.heroes} categoriaActiva={data.categoriaActiva} />
          {data.promocionesNovedades ? (
            <VibePromocionesNovedades
              promociones={data.promocionesNovedades}
              categoriaActiva={data.categoriaActiva}
            />
          ) : null}
        </>
      )
    case 'CATEGORIAS':
      return (
        <VibeCategorias
          categorias={data.categorias}
          categoriaActiva={data.categoriaActiva}
        />
      )
    case 'DESTACADAS':
      return (
        <VibeEmpresasScroll
          empresas={data.empresasScroll}
          total={data.empresasTotal}
          categoriaActiva={data.categoriaActiva}
        />
      )
    case 'MEMBRESIAS':
      return (
        <VibeRelacionado
          planes={data.planes}
          total={data.planesTotal}
          categoriaActiva={data.categoriaActiva}
        />
      )
    case 'BANNER_QR':
      return null
    case 'EXPERIENCIAS':
      return <VibeRelampago relampago={data.relampago} />
    default:
      return assertNever(tipo)
  }
}

/**
 * La mitad COMERCIAL del Inicio: los bloques que la empresa compone y
 * publica, en el mapa del rediseño violeta.
 */
export function InicioComercial({ data }: { data: InicioVista }) {
  const sinContenidoEnCategoria =
    Boolean(data.categoriaActiva) &&
    data.empresasScroll.length === 0 &&
    data.planes.length === 0 &&
    data.heroes.length === 0 &&
    data.promocionesNovedades.total === 0

  const categoriaNombre =
    data.categorias.find((c) => c.slug === data.categoriaActiva)?.name ?? data.categoriaActiva

  return (
    <>
      {data.bloques.map((tipo) => (
        <Fragment key={tipo}>{renderBlock(tipo, data)}</Fragment>
      ))}

      {sinContenidoEnCategoria && (
        <div className="mx-4 my-8 rounded-2xl border border-dashed border-vibe-borde bg-card/60 p-8 text-center">
          <Store className="mx-auto size-10 text-muted-foreground/60" aria-hidden />
          <h3 className="mt-3 text-h3 text-foreground">
            No hay negocios en «{categoriaNombre}» todavía
          </h3>
          <p className="mt-1 text-small text-muted-foreground">
            Pronto se sumarán más opciones y membresías en esta categoría. Mientras tanto, puedes explorar todo el catálogo.
          </p>
          <Link
            href="/cliente/inicio"
            scroll={false}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-vibe-violet px-4 py-2 text-label-sm font-bold text-white shadow-sm hover:bg-vibe-deep"
          >
            Ver todas las categorías
          </Link>
        </div>
      )}
    </>
  )
}
