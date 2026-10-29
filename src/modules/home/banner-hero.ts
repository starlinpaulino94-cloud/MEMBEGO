/**
 * DE UNA PIEZA (promoción, producto o servicio, oferta, plan) A LA TARJETA DEL
 * CARRUSEL. Puro: sin Prisma ni Next, para que se pueda probar.
 *
 * Aprobado 2026-10-29: el banner se fabrica solo con lo que la empresa
 * publica. La tarjeta adopta la imagen y el color de la pieza, y la plantilla
 * se elige por reglas (`plantillaAutomatica`) salvo que la empresa haya
 * decidido otra.
 */

import type { CategoriaNegocio } from '@/modules/capacidades/catalogo'
import {
  MAX_CARRUSEL,
  MAX_POR_EMPRESA,
  RUBRO_BANNER,
  colorDeFondo,
  esNovedadVigente,
  ordenarNovedades,
  plantillaAutomatica,
  type FormatoBanner,
  type OrigenBanner,
  type PiezaOrdenable,
} from './banner-formatos'
import type { HeroInicio } from './vista'

/** Una pieza publicada, ya reducida a lo que el banner necesita. */
export interface PiezaBanner {
  /** `ORIGEN:id`, estable: es la clave de los ajustes de la empresa. */
  readonly clave: string
  readonly origen: OrigenBanner
  readonly id: string
  readonly companyId: string
  readonly empresa: {
    readonly nombre: string
    readonly slug: string
    /** Color de marca `#rrggbb`, si la empresa lo fijó. */
    readonly colorMarca: string | null
    readonly rubro: CategoriaNegocio | null
  }
  readonly titulo: string
  readonly subtitulo: string
  readonly imagen: string | null
  /** Todas las fotos (la primera es `imagen`), para Collage y Tres en uno. */
  readonly imagenes: readonly string[]
  /** «RD$1,200», ya formateado. */
  readonly precio: string | null
  /** El precio anterior de una oferta. */
  readonly precioAntes: string | null
  /** «-30%», «2×1», «Gratis». */
  readonly descuento: string | null
  /** «4 lavados · 1 encerado». */
  readonly detalle: string | null
  readonly vence: Date | null
  readonly publicadoEn: Date
  readonly href: string
  /** Verbo del botón propio de la pieza (si no, el del rubro). */
  readonly verbo?: string | null
}

/** Lo que la empresa decidió sobre una pieza (fila de `banners_inicio`). */
export interface AjusteBanner {
  readonly plantilla: FormatoBanner | null
  readonly fijado: boolean
  readonly oculto: boolean
  readonly orden: number
  readonly colorDominante: string | null
}

export const SIN_AJUSTE: AjusteBanner = { plantilla: null, fijado: false, oculto: false, orden: 0, colorDominante: null }

export function horasParaVencer(vence: Date | null, ahora: Date): number | null {
  return vence ? (vence.getTime() - ahora.getTime()) / 3_600_000 : null
}

/** La plantilla que lleva la pieza: la que la empresa eligió, o la automática. */
export function plantillaDePieza(p: PiezaBanner, ajuste: AjusteBanner, ahora: Date): FormatoBanner {
  return (
    ajuste.plantilla ??
    plantillaAutomatica({
      origen: p.origen,
      tieneImagen: !!p.imagen,
      tieneDescuento: !!p.descuento,
      horasParaVencer: horasParaVencer(p.vence, ahora),
    })
  )
}

export function aOrdenable(p: PiezaBanner, ajuste: AjusteBanner): PiezaOrdenable & { readonly pieza: PiezaBanner } {
  return {
    clave: p.clave,
    origen: p.origen,
    publicadoEn: p.publicadoEn,
    vence: p.vence,
    fijado: ajuste.fijado,
    oculto: ajuste.oculto,
    orden: ajuste.orden,
    pieza: p,
  }
}

/** ¿Cuenta hoy como novedad? (Para la lista del panel: lo que está dentro y lo que ya salió.) */
export function estaVigente(p: PiezaBanner, ajuste: AjusteBanner, ahora: Date): boolean {
  return esNovedadVigente({ origen: p.origen, publicadoEn: p.publicadoEn, vence: p.vence, fijado: ajuste.fijado }, ahora)
}

/**
 * La tarjeta de una pieza. El fondo de las plantillas con panel de color es el
 * dominante de la foto, si no el de marca, si no el del rubro; el texto se
 * pinta claro u oscuro según ese fondo (`textoSobre`, en la tarjeta).
 */
export function heroDePieza(p: PiezaBanner, plantilla: FormatoBanner, ajuste: AjusteBanner): HeroInicio {
  const rubro = p.empresa.rubro
  const verbo = p.verbo ?? (rubro ? RUBRO_BANNER[rubro].verbo : 'Ver beneficio')
  const etiqueta =
    p.origen === 'PLAN'
      ? 'Membresía'
      : p.origen === 'OFERTA'
        ? 'Oferta'
        : p.origen === 'PROMOCION'
          ? p.descuento
            ? 'Oferta destacada'
            : 'Novedad destacada'
          : rubro
            ? RUBRO_BANNER[rubro].etiquetaNuevo
            : 'Nuevo'
  return {
    titulo: p.titulo,
    subtitulo: p.subtitulo,
    empresa: p.empresa.nombre,
    ciudad: null,
    imagen: p.imagen,
    href: p.href,
    cta: verbo,
    planDesde: null,
    color: p.empresa.colorMarca,
    valoracion: null,
    descuento: p.descuento,
    precio: p.precio,
    etiqueta,
    formato: plantilla,
    mostrarPie: true,
    precioAntes: p.precioAntes,
    vence: p.vence ? p.vence.toISOString() : null,
    imagenes: p.imagenes,
    detalle: p.detalle,
    colorFondo: colorDeFondo({ dominante: ajuste.colorDominante, marca: p.empresa.colorMarca, rubro }),
    origen: { tipo: p.origen, id: p.id },
  }
}

export interface PiezaElegida {
  pieza: PiezaBanner
  plantilla: FormatoBanner
  ajuste: AjusteBanner
}

/**
 * LA REGLA DE LA COLA, sola y sin base de datos: se ordena de sobra y después
 * se reparte, de modo que el tope por empresa se aplica al ORDENADO (lo fijado
 * y lo más reciente de cada empresa entran antes que lo viejo de otra).
 */
export function armarCola(
  piezas: readonly PiezaBanner[],
  ajustes: ReadonlyMap<string, AjusteBanner>,
  ahora: Date,
  opciones: { limite?: number; maxPorEmpresa?: number } = {},
): PiezaElegida[] {
  const limite = opciones.limite ?? MAX_CARRUSEL
  const maxPorEmpresa = opciones.maxPorEmpresa ?? MAX_POR_EMPRESA
  const ordenables = piezas.map((p) => aOrdenable(p, ajustes.get(p.clave) ?? SIN_AJUSTE))
  const ordenadas = ordenarNovedades(ordenables, ahora, piezas.length)
  const porEmpresa = new Map<string, number>()
  const elegidas: PiezaElegida[] = []
  for (const o of ordenadas) {
    const n = porEmpresa.get(o.pieza.companyId) ?? 0
    // Lo fijado por la empresa no cuenta contra su tope: lo decidió ella.
    if (!o.fijado && n >= maxPorEmpresa) continue
    porEmpresa.set(o.pieza.companyId, n + 1)
    const ajuste = ajustes.get(o.clave) ?? SIN_AJUSTE
    elegidas.push({ pieza: o.pieza, plantilla: plantillaDePieza(o.pieza, ajuste, ahora), ajuste })
    if (elegidas.length >= limite) break
  }
  return elegidas
}

/**
 * Dónde se edita la pieza de origen: el carrusel solo decide cómo se ve, el
 * contenido (precio, fotos, vigencia) se cambia donde se creó.
 */
export function rutaDeEdicionDePieza(origen: OrigenBanner, id: string): string {
  const e = encodeURIComponent(id)
  switch (origen) {
    case 'PROMOCION':
      return `/admin/promociones/${e}/editar`
    case 'CATALOGO':
      return `/admin/catalogo/${e}`
    case 'OFERTA':
      return `/admin/ofertas/${e}`
    case 'PLAN':
      return `/admin/planes/${e}/editar`
  }
}
