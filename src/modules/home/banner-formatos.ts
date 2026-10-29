/**
 * LOS FORMATOS DEL BANNER DEL INICIO (aprobado 2026-10-29, «como Amazon»).
 *
 * La tarjeta ES la imagen. El negocio decide, banner a banner, cómo va el
 * texto:
 *
 *  · SOLO_IMAGEN    → la imagen ya trae su texto; MembeGo no pone nada encima.
 *  · TITULAR_ARRIBA → el titular va en un panel de color SOBRE la foto, nunca
 *                     encima de ella (las tarjetas «Todo para tu belleza»).
 *  · TEXTO_ENCIMA   → el formato de antes: velo oscuro, sello, titular,
 *                     tarjeta del negocio y botón sobre la foto. Solo para
 *                     fotos de ambiente sin texto; si la foto lo trae, se pisa.
 *
 * Este archivo es PURO (sin Prisma ni Next): lo importan el esquema, el
 * cliente y el editor, y lo prueba `tests/banner-formatos.test.ts`.
 */

export const FORMATOS_BANNER = ['SOLO_IMAGEN', 'TITULAR_ARRIBA', 'TEXTO_ENCIMA'] as const
export type FormatoBanner = (typeof FORMATOS_BANNER)[number]

/** Lo que ya estaba guardado no tenía formato: era (y sigue siendo) texto encima. */
export const FORMATO_BANNER_POR_DEFECTO: FormatoBanner = 'TEXTO_ENCIMA'

/** Para un banner NUEVO: la imagen manda, y el texto solo si el negocio lo pide. */
export const FORMATO_BANNER_NUEVO: FormatoBanner = 'SOLO_IMAGEN'

export const FORMATOS_BANNER_INFO: Record<FormatoBanner, { nombre: string; descripcion: string }> = {
  SOLO_IMAGEN: { nombre: 'Solo imagen', descripcion: 'La imagen ya lo dice todo. No se añade nada.' },
  TITULAR_ARRIBA: { nombre: 'Titular arriba', descripcion: 'Texto en un panel de color, sobre la foto.' },
  TEXTO_ENCIMA: { nombre: 'Texto encima', descripcion: 'Velo oscuro, titular y botón sobre la foto.' },
}

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

/** Con «Solo imagen» no hay titular que escribir: la imagen lo trae. */
export function formatoRequiereTexto(formato: FormatoBanner): boolean {
  return formato !== 'SOLO_IMAGEN'
}

/**
 * El pie (negocio + «Ver beneficio» bajo la tarjeta) solo tiene sentido cuando
 * la tarjeta no lleva ya su propia tarjeta blanca y su botón.
 */
export function formatoAdmitePie(formato: FormatoBanner): boolean {
  return formato !== 'TEXTO_ENCIMA'
}

/**
 * Los banners que el negocio CONFIGURÓ van primero; los automáticos (las
 * promociones destacadas) rellenan hasta el límite. Antes era al revés y el
 * banner que alguien había preparado con esmero salía detrás de uno automático
 * con texto encima de su propia imagen. Un destino repetido se queda con la
 * versión configurada.
 */
export function combinarHeroes<T extends { readonly href: string }>(
  publicados: readonly T[],
  porDefecto: readonly T[],
  limite = 4,
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
