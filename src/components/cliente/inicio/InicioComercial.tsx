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
      return <RetailDestacadas empresas={data.empresas} />
    case 'MEMBRESIAS':
      return <RetailMembresias planes={data.planes} />
    case 'BANNER_QR':
      return <RetailQrBanner />
    case 'EXPERIENCIAS':
      return <RetailExperiencias excursiones={data.excursiones} />
    default:
      return assertNever(tipo)
  }
}

export function InicioComercial({ data }: { data: InicioVista }) {
  return (
    <div className="retail min-w-0 overflow-x-hidden bg-background text-foreground">
      {data.bloques.map((tipo) => (
        <Fragment key={tipo}>
          {tipo === 'DESTACADAS' && data.relampago ? (
            <RetailRelampago relampago={data.relampago} />
          ) : null}
          {renderBlock(tipo, data)}
        </Fragment>
      ))}
    </div>
  )
}
