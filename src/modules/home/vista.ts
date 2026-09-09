import type { TipoBloque } from './esquema'

/**
 * EL MODELO DE VISTA DEL INICIO, UNA FORMA POR TIPO DE TARJETA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Antes había una sola `TarjetaInicio` para empresas, planes y excursiones.
 * Salió caro: en la tarjeta de empresa, `titulo` y `empresa` eran el mismo
 * nombre, y la pantalla lo pintaba DOS VECES —una como sobretítulo y otra
 * como título— porque el tipo no distinguía entre «de quién es esto» y «qué
 * es esto».
 *
 * Cada tarjeta del diseño enseña hechos distintos: la de empresa lleva
 * valoración, reseñas y planes; la de plan lleva precio y periodo; la de
 * experiencia lleva duración. Un tipo por cada una dice qué hace falta para
 * pintarla, y el compilador avisa cuando falta.
 */

export interface EmpresaInicio {
  readonly id: string
  readonly nombre: string
  /** Rubro o descripción corta: «Lavado, nanocerámica y estética». */
  readonly rubro: string | null
  readonly ciudad: string | null
  readonly imagen: string | null
  readonly href: string
  readonly valoracion: number | null
  readonly resenas: number
  readonly planes: number
  /** El plan más barato, como gancho: «Lavado ilimitado». */
  readonly planDesde: string | null
}

export interface PlanInicio {
  readonly id: string
  readonly nombre: string
  readonly empresa: string
  readonly descripcion: string | null
  readonly imagen: string | null
  readonly href: string
  /** Ya formateado con su moneda: «RD$1,850». */
  readonly precio: string
  /** «/mes», «/30 días». */
  readonly periodo: string
}

export interface ExperienciaInicio {
  readonly id: string
  readonly nombre: string
  readonly empresa: string
  readonly descripcion: string | null
  readonly imagen: string | null
  readonly href: string
  readonly precio: string | null
  /** «4 horas», «Full Day». Null cuando la excursión no la declara. */
  readonly duracion: string | null
}

export interface HeroInicio {
  readonly titulo: string
  readonly subtitulo: string
  readonly empresa: string
  readonly ciudad: string | null
  readonly imagen: string | null
  readonly href: string
  readonly cta: string
  /** «Planes desde RD$1,850 / mes». Null si la empresa no tiene planes. */
  readonly planDesde: string | null
  /** Color de marca del negocio (#rrggbb): tiñe suave la tarjeta, como hace
   *  Amazon con el arte de cada campaña. Null = sin tinte. */
  readonly color: string | null
}

export interface CategoriaInicio {
  readonly id: string
  readonly name: string
  readonly slug: string
  readonly icon: string | null
}

export interface InicioVista {
  readonly revisionId: string | null
  readonly territorio: string | null
  readonly bloques: readonly TipoBloque[]
  readonly heroes: readonly HeroInicio[]
  readonly categorias: readonly CategoriaInicio[]
  readonly empresas: readonly EmpresaInicio[]
  /** Total de empresas publicadas, para «Explorar más de N empresas». */
  readonly empresasTotal: number
  readonly planes: readonly PlanInicio[]
  /** Total de planes activos, para «Ver todas las N membresías». */
  readonly planesTotal: number
  readonly experiencias: readonly ExperienciaInicio[]
  readonly relampago: { readonly hasta: string; readonly href: string } | null
}
