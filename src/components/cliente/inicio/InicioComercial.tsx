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
 * - HERO → héroe a foto completa con asomo.
 * - CATEGORIAS → chips violeta + Novedades con promociones activas por afinidad.
 * - DESTACADAS → scroll horizontal de empresas (híbrido mis empresas + destacadas) con botón "Ver más".
 * - MEMBRESIAS → «Membresías recomendadas para ti» con badges contextuales.
 * - EXPERIENCIAS → cabecera de excursiones + tarjeta «Ofertas Relámpago» con timer.
 */
function renderBlock(tipo: TipoBloque, data: InicioVista): ReactNode {
  switch (tipo) {
    case 'CABECERA':
      return null
    case 'HERO':
      return <VibeHero heroes={data.heroes} />
    case 'CATEGORIAS':
      return (
        <>
          <VibeCategorias categorias={data.categorias} />
          {data.promocionesNovedades ? (
            <VibePromocionesNovedades promociones={data.promocionesNovedades} />
          ) : null}
        </>
      )
    case 'DESTACADAS':
      return (
        <VibeEmpresasScroll
          empresas={data.empresasScroll}
          total={data.empresasTotal}
        />
      )
    case 'MEMBRESIAS':
      return <VibeRelacionado planes={data.planes} total={data.planesTotal} />
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
  return (
    <>
      {data.bloques.map((tipo) => (
        <Fragment key={tipo}>{renderBlock(tipo, data)}</Fragment>
      ))}
    </>
  )
}
