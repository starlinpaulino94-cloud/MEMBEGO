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
  /** Valoración de la empresa (las estrellas del diseño). Null = sin dato. */
  readonly valoracion: number | null
  readonly resenas: number
  /** Motivo contextual de recomendación: «De tus negocios», «Por tus intereses», «Más popular». */
  readonly motivoRecomendacion?: string | null
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
  /** Valoración de la empresa para el sello del héroe. Null = no se pinta. */
  readonly valoracion: number | null
}

/** Fila de la tarjeta «Ofertas Relámpago» del rediseño violeta. */
export interface RelampagoInicio {
  readonly id: string
  readonly titulo: string
  readonly empresa: string
  readonly imagen: string | null
  readonly href: string
  /** Ya formateado: «RD$2,900». Null = sin venta en línea. */
  readonly precio: string | null
  /** Sello ya formateado («−31%», «2×1»). Null = sin descuento declarado. */
  readonly descuento: string | null
  /** Fin de vigencia de ESTA oferta (ISO). */
  readonly hasta: string
}

export interface CategoriaInicio {
  readonly id: string
  readonly name: string
  readonly slug: string
  readonly icon: string | null
}

export interface EmpresaScrollItem {
  readonly id: string
  readonly nombre: string
  readonly slug: string
  readonly rubro: string | null
  readonly ciudad: string | null
  readonly logoUrl: string | null
  readonly bannerUrl: string | null
  readonly href: string
  readonly valoracion: number | null
  readonly resenas: number
  readonly esMia: boolean
  readonly etiquetaRelacion: string | null
}

export interface PromoNovedadItem {
  readonly id: string
  readonly titulo: string
  readonly slug: string | null
  readonly descripcion: string
  readonly imagenUrl: string | null
  readonly tipo: string
  readonly tipoEtiqueta: string
  readonly descuentoTexto: string | null
  readonly precioTexto: string | null
  readonly vigenciaHasta: string | null
  readonly diasRestantes: number | null
  readonly href: string
  readonly empresa: {
    readonly id: string
    readonly nombre: string
    readonly slug: string
    readonly logoUrl: string | null
  }
  readonly esPrivadaMiembros: boolean
  readonly esDeMiEmpresa: boolean
  readonly motivo: 'afinidad' | 'exclusiva' | 'descuento' | 'vencimiento'
}

export interface PromocionesNovedadesVista {
  readonly paraTi: readonly PromoNovedadItem[]
  readonly exclusivas: readonly PromoNovedadItem[]
  readonly descuentos: readonly PromoNovedadItem[]
  readonly porVencer: readonly PromoNovedadItem[]
  readonly total: number
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
  readonly empresasScroll: readonly EmpresaScrollItem[]
  readonly promocionesNovedades: PromocionesNovedadesVista
  readonly planes: readonly PlanInicio[]
  /** Total de planes activos, para «Ver todas las N membresías». */
  readonly planesTotal: number
  readonly experiencias: readonly ExperienciaInicio[]
  /** La tarjeta relámpago: countdown global (la que vence antes) + filas. */
  readonly relampago: { readonly hasta: string; readonly promos: readonly RelampagoInicio[] } | null
}

