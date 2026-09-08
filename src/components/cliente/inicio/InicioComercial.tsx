import { Fragment, type ReactNode } from 'react'
import type { TipoBloque } from '@/modules/home/esquema'
import type { InicioVista } from '@/modules/home/vista'
import { RetailCategorias } from './RetailCategorias'
import { RetailDestacadas } from './RetailDestacadas'
import { RetailExperiencias } from './RetailExperiencias'
import { RetailHero } from './RetailHero'
import { RetailMembresias } from './RetailMembresias'
import { RetailQrBanner } from './RetailQrBanner'
import { RetailRelampago } from './RetailRelampago'

function assertNever(value: never): never {
  throw new TypeError(`Bloque de inicio no soportado: ${String(value)}`)
}

function renderBlock(tipo: TipoBloque, data: InicioVista): ReactNode {
  switch (tipo) {
    case 'CABECERA':
      return null
    case 'HERO':
      return <RetailHero heroes={data.heroes} />
    case 'CATEGORIAS':
      return <RetailCategorias categorias={data.categorias} />
    case 'DESTACADAS':
      return <RetailDestacadas empresas={data.empresas} total={data.empresasTotal} />
    case 'MEMBRESIAS':
      return <RetailMembresias planes={data.planes} total={data.planesTotal} />
    case 'BANNER_QR':
      return <RetailQrBanner />
    case 'EXPERIENCIAS':
      return <RetailExperiencias experiencias={data.experiencias} />
    default:
      return assertNever(tipo)
  }
}

/**
 * La mitad COMERCIAL del Inicio: los bloques que la empresa compone y publica.
 *
 * El ámbito `.retail` y el contenedor los pone `InicioRetail`, que es quien
 * intercala esta mitad con la personal. Aquí solo van los bloques, para que
 * anidar dos veces el mismo ámbito no duplique fondo ni tipografía.
 */
export function InicioComercial({ data }: { data: InicioVista }) {
  return (
    <>
      {data.bloques.map((tipo) => (
        <Fragment key={tipo}>
          {tipo === 'DESTACADAS' && data.relampago ? (
            <RetailRelampago relampago={data.relampago} />
          ) : null}
          {renderBlock(tipo, data)}
        </Fragment>
      ))}
    </>
  )
}
