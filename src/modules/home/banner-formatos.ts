/**
 * LOS FORMATOS (PLANTILLAS) DEL BANNER DEL INICIO.
 *
 * Aprobado 2026-10-29 en dos pasos: primero «la tarjeta es la imagen» (tres
 * formatos: solo imagen, titular arriba, texto encima); después la biblioteca
 * de diez plantillas, la cola automática de novedades y los valores por rubro.
 *
 * La tarjeta ES la imagen. Cómo va el texto lo decide, banner a banner, el
 * negocio, o estas reglas cuando el banner se fabrica solo a partir de lo que
 * publicó (`plantillaAutomatica`).
 *
 * Este archivo es PURO (sin Prisma ni Next): lo importan el esquema, el
 * cliente y el editor, y lo prueban `tests/banner-formatos.test.ts` y
 * `tests/banner-novedades.test.ts`.
 */

import type { CategoriaNegocio } from '@/modules/capacidades/catalogo'

export const FORMATOS_BANNER = [
  'SOLO_IMAGEN',
  'TITULAR_ARRIBA',
  'TEXTO_ENCIMA',
  'PRECIO_GRANDE',
  'ANTES_AHORA',
  'DESCUENTO_SELLO',
  'CUENTA_ATRAS',
  'TRES_EN_UNO',
  'COLLAGE',
  'MEMBRESIA',
] as const
export type FormatoBanner = (typeof FORMATOS_BANNER)[number]

/** Lo que ya estaba guardado no tenía formato: era (y sigue siendo) texto encima. */
export const FORMATO_BANNER_POR_DEFECTO: FormatoBanner = 'TEXTO_ENCIMA'

/** Para un banner NUEVO a medida: la imagen manda, y el texto solo si el negocio lo pide. */
export const FORMATO_BANNER_NUEVO: FormatoBanner = 'SOLO_IMAGEN'

export interface InfoFormato {
  readonly nombre: string
  readonly descripcion: string
  /** Hay titular que escribir (o que tomar de la pieza). */
  readonly requiereTexto: boolean
  /** Bajo la tarjeta cabe el pie con el negocio y el botón. */
  readonly admitePie: boolean
}

export const FORMATOS_BANNER_INFO: Record<FormatoBanner, InfoFormato> = {
  SOLO_IMAGEN: { nombre: 'Solo imagen', descripcion: 'La imagen ya lo dice todo. No se añade nada.', requiereTexto: false, admitePie: true },
  TITULAR_ARRIBA: { nombre: 'Titular arriba', descripcion: 'Texto en un panel de color, sobre la foto.', requiereTexto: true, admitePie: true },
  TEXTO_ENCIMA: { nombre: 'Texto encima', descripcion: 'Velo oscuro, titular y botón sobre la foto.', requiereTexto: true, admitePie: false },
  PRECIO_GRANDE: { nombre: 'Precio grande', descripcion: 'Nombre y precio arriba, con el color de la foto; la foto entera debajo.', requiereTexto: true, admitePie: false },
  ANTES_AHORA: { nombre: 'Antes y ahora', descripcion: 'El precio de oferta grande y el anterior tachado.', requiereTexto: true, admitePie: false },
  DESCUENTO_SELLO: { nombre: 'Descuento con sello', descripcion: 'La foto con un sello redondo con el descuento.', requiereTexto: true, admitePie: true },
  CUENTA_ATRAS: { nombre: 'Cuenta atrás', descripcion: 'Días, horas y minutos para que venza.', requiereTexto: true, admitePie: true },
  TRES_EN_UNO: { nombre: 'Tres en uno', descripcion: 'Un titular y tres fotos: una colección.', requiereTexto: true, admitePie: true },
  COLLAGE: { nombre: 'Collage', descripcion: 'Dos fotos del mismo trabajo: antes y después.', requiereTexto: true, admitePie: true },
  MEMBRESIA: { nombre: 'Membresía', descripcion: 'Precio por periodo y lo que incluye, sobre el degradado de marca.', requiereTexto: true, admitePie: false },
}

/** Los tres formatos de un banner a medida (una imagen y un texto); los otros siete nacen de una pieza. */
export const FORMATOS_A_MEDIDA: readonly FormatoBanner[] = ['SOLO_IMAGEN', 'TITULAR_ARRIBA', 'TEXTO_ENCIMA']

/**
 * El panel de «Titular arriba»: los fondos suaves del sistema de diseño, que
 * ya traen su versión de modo oscuro; el texto va en `text-foreground`, así
 * que se lee en los dos modos. Nada de hex a mano: un color escrito a mano no
 * tiene modo oscuro (y la guardia de deuda de diseño lo cuenta).
 */
export const COLORES_PANEL = ['CELESTE', 'MENTA', 'AMARILLO', 'LAVANDA', 'ROSA'] as const
export type ColorPanel = (typeof COLORES_PANEL)[number]
export const COLOR_PANEL_POR_DEFECTO: ColorPanel = 'CELESTE'

export const COLORES_PANEL_INFO: Record<ColorPanel, { nombre: string; clase: string }> = {
  CELESTE: { nombre: 'Celeste', clase: 'bg-info-soft' },
  MENTA: { nombre: 'Menta', clase: 'bg-success-soft' },
  AMARILLO: { nombre: 'Amarillo', clase: 'bg-warning-soft' },
  LAVANDA: { nombre: 'Lavanda', clase: 'bg-brand-primary-soft' },
  ROSA: { nombre: 'Rosa', clase: 'bg-danger-soft' },
}

export function clasePanel(color: ColorPanel | null | undefined): string {
  return COLORES_PANEL_INFO[color ?? COLOR_PANEL_POR_DEFECTO].clase
}

/**
 * La plantilla que de verdad se puede pintar con los datos que hay: una
 * plantilla que pide lo que falta (fotos, precio, fecha) cae a la más parecida
 * en vez de pintar un hueco. Pasa cuando una imagen deja de existir o cuando
 * una pieza cambia de estado entre que se eligió la plantilla y se pinta.
 */
export function formatoRealizable(
  formato: FormatoBanner,
  datos: {
    readonly imagen: string | null | undefined
    readonly nImagenes: number
    readonly precio: boolean
    readonly precioAntes: boolean
    readonly vence: boolean
  },
): FormatoBanner {
  let actual = formato
  for (let i = 0; i < 4; i++) {
    let siguiente = actual
    if (actual === 'SOLO_IMAGEN' && !datos.imagen) siguiente = 'TEXTO_ENCIMA'
    else if (actual === 'DESCUENTO_SELLO' && !datos.imagen) siguiente = 'TITULAR_ARRIBA'
    else if (actual === 'COLLAGE' && datos.nImagenes < 2) siguiente = 'TITULAR_ARRIBA'
    else if (actual === 'TRES_EN_UNO' && datos.nImagenes < 3) siguiente = datos.nImagenes >= 2 ? 'COLLAGE' : 'TITULAR_ARRIBA'
    else if (actual === 'CUENTA_ATRAS' && !datos.vence) siguiente = 'TEXTO_ENCIMA'
    else if (actual === 'ANTES_AHORA' && !datos.precioAntes) siguiente = 'PRECIO_GRANDE'
    else if (actual === 'PRECIO_GRANDE' && !datos.precio) siguiente = 'TITULAR_ARRIBA'
    if (siguiente === actual) return actual
    actual = siguiente
  }
  return actual
}

/** Con «Solo imagen» no hay titular que escribir: la imagen lo trae. */
export function formatoRequiereTexto(formato: FormatoBanner): boolean {
  return FORMATOS_BANNER_INFO[formato].requiereTexto
}

/**
 * El pie (negocio + «Ver beneficio» bajo la tarjeta) solo tiene sentido cuando
 * la tarjeta no lleva ya su propia tarjeta blanca y su botón.
 */
export function formatoAdmitePie(formato: FormatoBanner): boolean {
  return FORMATOS_BANNER_INFO[formato].admitePie
}

// ── La cola automática ───────────────────────────────────────────────────────

/** De qué nace un banner automático. */
export const ORIGENES_BANNER = ['PROMOCION', 'CATALOGO', 'OFERTA', 'PLAN'] as const
export type OrigenBanner = (typeof ORIGENES_BANNER)[number]

export const ORIGEN_BANNER_INFO: Record<OrigenBanner, { nombre: string }> = {
  PROMOCION: { nombre: 'Promoción' },
  CATALOGO: { nombre: 'Producto o servicio' },
  OFERTA: { nombre: 'Oferta' },
  PLAN: { nombre: 'Membresía' },
}

/** Cuántas tarjetas ve el cliente como máximo: más de seis nadie desliza. */
export const MAX_CARRUSEL = 6

/** Una empresa no pone más de esto en el carrusel: si publica mucho, el resto se reparte (lo fijado no cuenta). */
export const MAX_POR_EMPRESA = 3

/** Un producto, servicio o plan es «novedad» este tiempo; después sale solo (salvo fijado). */
export const DIAS_NOVEDAD = 30

/** Una promoción u oferta que vence en menos de esto pide la cuenta atrás. */
export const HORAS_CUENTA_ATRAS = 72

/** Las plantillas que se le pueden poner a mano a una pieza de cada origen. */
export const PLANTILLAS_POR_ORIGEN: Record<OrigenBanner, readonly FormatoBanner[]> = {
  PROMOCION: ['SOLO_IMAGEN', 'DESCUENTO_SELLO', 'TITULAR_ARRIBA', 'TEXTO_ENCIMA', 'CUENTA_ATRAS', 'COLLAGE', 'TRES_EN_UNO'],
  CATALOGO: ['PRECIO_GRANDE', 'TITULAR_ARRIBA', 'TEXTO_ENCIMA', 'SOLO_IMAGEN', 'COLLAGE', 'TRES_EN_UNO'],
  OFERTA: ['ANTES_AHORA', 'DESCUENTO_SELLO', 'CUENTA_ATRAS', 'TEXTO_ENCIMA'],
  PLAN: ['MEMBRESIA', 'TITULAR_ARRIBA'],
}

/**
 * Las plantillas que de verdad caben en una pieza: las de fotos solo si hay
 * las fotos (Collage pide 2, Tres en uno pide 3), «Solo imagen» solo si hay
 * una, y la cuenta atrás solo si la pieza vence.
 */
export function plantillasDisponibles(pieza: {
  readonly origen: OrigenBanner
  readonly nImagenes: number
  readonly vence: boolean
}): FormatoBanner[] {
  return PLANTILLAS_POR_ORIGEN[pieza.origen].filter((f) => {
    if (f === 'COLLAGE') return pieza.nImagenes >= 2
    if (f === 'TRES_EN_UNO') return pieza.nImagenes >= 3
    if (f === 'SOLO_IMAGEN') return pieza.nImagenes >= 1
    if (f === 'CUENTA_ATRAS') return pieza.vence
    return true
  })
}

/**
 * La plantilla que se elige SOLA para una pieza, por reglas y sin preguntar:
 *
 *  · Promoción con arte propio → Solo imagen: el arte de marketing suele traer
 *    su texto, y ponerle más encima es amontonar. Sin arte → Descuento con
 *    sello si tiene descuento, si no Titular arriba. Si vence en menos de
 *    72 h, Cuenta atrás gana.
 *  · Producto o servicio → Precio grande: una foto de producto rara vez trae
 *    texto, y el precio es lo que se mira.
 *  · Oferta → Antes y ahora (o Cuenta atrás si está por vencer).
 *  · Membresía → Membresía.
 */
export function plantillaAutomatica(pieza: {
  readonly origen: OrigenBanner
  readonly tieneImagen: boolean
  readonly tieneDescuento?: boolean
  /** Horas hasta que venza; null = no vence. */
  readonly horasParaVencer?: number | null
}): FormatoBanner {
  const porVencer = pieza.horasParaVencer != null && pieza.horasParaVencer > 0 && pieza.horasParaVencer <= HORAS_CUENTA_ATRAS
  switch (pieza.origen) {
    case 'PROMOCION':
      if (porVencer) return 'CUENTA_ATRAS'
      if (pieza.tieneImagen) return 'SOLO_IMAGEN'
      return pieza.tieneDescuento ? 'DESCUENTO_SELLO' : 'TITULAR_ARRIBA'
    case 'CATALOGO':
      return 'PRECIO_GRANDE'
    case 'OFERTA':
      return porVencer ? 'CUENTA_ATRAS' : 'ANTES_AHORA'
    case 'PLAN':
      return 'MEMBRESIA'
  }
}

/** Lo que el editor sabe de cada pieza para ordenarla; es lo que `ordenarNovedades` recibe. */
export interface PiezaOrdenable {
  readonly clave: string
  readonly origen: OrigenBanner
  readonly publicadoEn: Date
  /** Cuándo deja de valer la pieza misma (vigencia de la promoción, fin de la oferta). null = no vence. */
  readonly vence: Date | null
  readonly fijado: boolean
  readonly oculto: boolean
  readonly orden: number
}

/** Una pieza sin vencimiento propio deja de ser novedad a los `DIAS_NOVEDAD`, salvo fijada. */
export function esNovedadVigente(p: Pick<PiezaOrdenable, 'origen' | 'publicadoEn' | 'vence' | 'fijado'>, ahora: Date): boolean {
  if (p.vence && p.vence.getTime() <= ahora.getTime()) return false
  if (p.fijado) return true
  if (p.origen === 'PROMOCION' || p.origen === 'OFERTA') return true
  const limite = p.publicadoEn.getTime() + DIAS_NOVEDAD * 24 * 60 * 60 * 1000
  return limite > ahora.getTime()
}

/**
 * El orden del carrusel: fuera lo oculto y lo vencido; primero lo fijado (por
 * su orden), después lo demás de lo más reciente a lo más viejo; y el tope.
 */
export function ordenarNovedades<T extends PiezaOrdenable>(piezas: readonly T[], ahora: Date, limite = MAX_CARRUSEL): T[] {
  return piezas
    .filter((p) => !p.oculto && esNovedadVigente(p, ahora))
    .sort((a, b) => {
      if (a.fijado !== b.fijado) return a.fijado ? -1 : 1
      if (a.fijado && b.fijado && a.orden !== b.orden) return a.orden - b.orden
      return b.publicadoEn.getTime() - a.publicadoEn.getTime()
    })
    .slice(0, limite)
}

// ── Color ───────────────────────────────────────────────────────────────────

/**
 * Los colores de respaldo por RUBRO, para cuando la pieza no trae foto de la
 * que sacar uno y la empresa no fijó color de marca. Son colores de CONTENIDO
 * (como el de marca de una empresa), no de interfaz: van siempre bajo texto
 * blanco, así que no tienen modo oscuro que respetar. Se escriben en `hsl()`
 * para que la guardia de deuda de diseño, que cuenta hex en la interfaz, no
 * los confunda con un color de interfaz.
 */
export const RUBRO_BANNER: Record<CategoriaNegocio, { readonly color: string; readonly verbo: string; readonly etiquetaNuevo: string }> = {
  CAR_WASH: { color: 'hsl(201 90% 24%)', verbo: 'Reserva', etiquetaNuevo: 'Nuevo' },
  BARBERIA: { color: 'hsl(20 10% 10%)', verbo: 'Agenda', etiquetaNuevo: 'Nuevo' },
  RESTAURANTE: { color: 'hsl(17 80% 34%)', verbo: 'Pide', etiquetaNuevo: 'Nuevo en el menú' },
  GYM: { color: 'hsl(143 61% 20%)', verbo: 'Únete', etiquetaNuevo: 'Nuevo' },
  EXCURSIONES: { color: 'hsl(175 60% 19%)', verbo: 'Reserva', etiquetaNuevo: 'Nueva salida' },
}

/** El color de fondo de una tarjeta automática: el de la foto, si no el de marca, si no el del rubro. */
export function colorDeFondo(opciones: {
  readonly dominante?: string | null
  readonly marca?: string | null
  readonly rubro?: CategoriaNegocio | null
}): string {
  if (opciones.dominante && esHex(opciones.dominante)) return opciones.dominante
  if (opciones.marca && esHex(opciones.marca)) return opciones.marca
  return RUBRO_BANNER[opciones.rubro ?? 'CAR_WASH'].color
}

/** [r, g, b] (0–255) a `#rrggbb`. */
export function rgbAHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

export function esHex(valor: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(valor)
}

/**
 * Qué texto se lee sobre un color: claro (blanco) sobre fondos oscuros y
 * oscuro sobre fondos claros. Luminancia relativa de WCAG; el corte en 0.4
 * manda al blanco un poco antes que el 0.5 del contraste puro porque el texto
 * del banner es grande y en negrita, y el blanco sobre medio tono se lee mejor
 * que el negro.
 */
export function textoSobre(color: string): 'claro' | 'oscuro' {
  const rgb = aRgb(color)
  if (!rgb) return 'claro'
  const lin = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  const luminancia = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
  return luminancia > 0.4 ? 'oscuro' : 'claro'
}

/** `#rrggbb` o `hsl(h s% l%)` a [r, g, b]. null si no se entiende. */
export function aRgb(color: string): [number, number, number] | null {
  if (esHex(color)) {
    return [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)]
  }
  const m = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/.exec(color)
  if (!m) return null
  const h = Number(m[1]) / 360
  const s = Number(m[2]) / 100
  const l = Number(m[3]) / 100
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const canal = (t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [Math.round(canal(h + 1 / 3) * 255), Math.round(canal(h) * 255), Math.round(canal(h - 1 / 3) * 255)]
}

/**
 * Los banners que el negocio CONFIGURÓ van primero; los automáticos (las
 * novedades y, de relleno, las promociones destacadas) rellenan hasta el
 * límite. Un destino repetido se queda con la primera versión.
 */
export function combinarHeroes<T extends { readonly href: string }>(
  publicados: readonly T[],
  porDefecto: readonly T[],
  limite = MAX_CARRUSEL,
): T[] {
  const vistos = new Set<string>()
  const salida: T[] = []
  for (const hero of [...publicados, ...porDefecto]) {
    if (vistos.has(hero.href)) continue
    vistos.add(hero.href)
    salida.push(hero)
    if (salida.length >= limite) break
  }
  return salida
}
