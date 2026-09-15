import { Fragment, type ReactNode } from 'react'
import type { TipoBloque } from '@/modules/home/esquema'
import type { InicioVista } from '@/modules/home/vista'
import { VibeCategorias } from './VibeCategorias'
import { VibeDescubre } from './VibeDescubre'
import { VibeDestacadas } from './VibeDestacadas'
import { VibeHero } from './VibeHero'
import { VibeNovedades } from './VibeNovedades'
import { VibeRelacionado } from './VibeRelacionado'
import { VibeRelampago } from './VibeRelampago'

function assertNever(value: never): never {
  throw new TypeError(`Bloque de inicio no soportado: ${String(value)}`)
}

/**
 * El mapa de bloques del Inicio. La curación publicada decide QUÉ bloques y en
 * qué orden; este mapa decide CÓMO se pinta cada uno.
 *
 * - CATEGORIAS → chips, ahora con el color de cada rubro.
 * - HERO → héroe a foto completa con asomo.
 * - NOVEDADES → lo vigente de toda la vitrina (2026-09-15).
 * - DESCUBRE → las empresas que el cliente todavía no conoce (2026-09-15).
 * - DESTACADAS → las que el negocio promociona. Estuvo apagada con un
 *   `return null` desde el rediseño del 10-09-2026; vuelve por petición
 *   expresa, con su componente propio.
 * - MEMBRESIAS → «Relacionado con los artículos que viste».
 * - EXPERIENCIAS → excursiones + tarjeta «Ofertas Relámpago».
 * - BANNER_QR → sigue apagado: el QR tiene su pestaña en el dock y repetirlo
 *   aquí sería un atajo a un sitio al que ya se llega de un toque. Se deja el
 *   `case` explícito para que no parezca un olvido.
 */
function renderBlock(tipo: TipoBloque, data: InicioVista): ReactNode {
  switch (tipo) {
    case 'CABECERA':
      return null
    case 'HERO':
      return <VibeHero heroes={data.heroes} />
    case 'CATEGORIAS':
      return <VibeCategorias categorias={data.categorias} />
    case 'NOVEDADES':
      return <VibeNovedades novedades={data.novedades} />
    case 'DESCUBRE':
      return <VibeDescubre empresas={data.porDescubrir} total={data.empresasTotal} />
    case 'DESTACADAS':
      return <VibeDestacadas empresas={data.empresas} total={data.empresasTotal} />
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
