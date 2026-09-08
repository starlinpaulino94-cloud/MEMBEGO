import type { TipoBloque } from './esquema'

export interface TarjetaInicio {
  readonly id: string
  readonly titulo: string
  readonly descripcion: string | null
  readonly empresa: string
  readonly imagen: string | null
  readonly href: string
  readonly precio: string | null
  readonly rating: number | null
}

export interface HeroInicio {
  readonly titulo: string
  readonly subtitulo: string
  readonly empresa: string
  readonly imagen: string | null
  readonly href: string
  readonly cta: string
}

export interface InicioVista {
  readonly revisionId: string | null
  readonly territorio: string | null
  readonly bloques: readonly TipoBloque[]
  readonly heroes: readonly HeroInicio[]
  readonly categorias: readonly { id: string; name: string; slug: string; icon: string | null }[]
  readonly empresas: readonly TarjetaInicio[]
  readonly planes: readonly TarjetaInicio[]
  readonly excursiones: readonly TarjetaInicio[]
  readonly relampago: { readonly hasta: string; readonly href: string } | null
}
