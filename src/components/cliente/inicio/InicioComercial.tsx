import { Fragment, type ReactNode } from 'react'
import type { TipoBloque } from '@/modules/home/esquema'
import type { InicioVista } from '@/modules/home/vista'
import { VibeCategorias } from './VibeCategorias'
import { VibeHero } from './VibeHero'
import { VibeRelacionado } from './VibeRelacionado'
import { VibeRelampago } from './VibeRelampago'

function assertNever(value: never): never {
  throw new TypeError(`Bloque de inicio no soportado: ${String(value)}`)
}

/**
 * REDISEÑO VIOLETA (Stitch «amazon style», aprobado 2026-09-10): los tipos
 * del contrato se mapean a los bloques del nuevo diseño.
 *
 * - HERO → héroe a foto completa con asomo.
 * - CATEGORIAS → chips violeta.
 * - MEMBRESIAS → «Relacionado con los artículos que viste».
 * - EXPERIENCIAS → cabecera de excursiones + tarjeta «Ofertas Relámpago»
 *   (las filas son las promociones comprables vigentes).
 * - DESTACADAS y BANNER_QR → el diseño nuevo NO los trae: se apagan aquí,
 *   no se inventa dónde ponerlos. Las empresas viven en Explorar y el QR en
 *   su pestaña del dock. La curación publicada sigue decidiendo qué bloques
 *   y en qué orden, sobre este mapa.
 */
function renderBlock(tipo: TipoBloque, data: InicioVista): ReactNode {
  switch (tipo) {
    case 'CABECERA':
      return null
    case 'HERO':
      return <VibeHero heroes={data.heroes} />
    case 'CATEGORIAS':
      return <VibeCategorias categorias={data.categorias} />
    case 'DESTACADAS':
      return null
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
