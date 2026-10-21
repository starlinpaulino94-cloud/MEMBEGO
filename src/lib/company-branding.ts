const HEX_COLOR = /^#(?:[\da-f]{3}|[\da-f]{6})$/i

/**
 * El color de marca cuando la empresa no fijó ninguno: el violeta Vibe
 * (`--color-vibe-deep` en globals.css). Es el único sitio donde se escribe;
 * quien pinte con el color de una empresa lo importa de aquí.
 */
export const COLOR_MARCA_POR_DEFECTO = '#5b21b6'

export function normalizeCompanyBrandColor(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const color = value.trim().toLowerCase()
  if (!HEX_COLOR.test(color)) return null
  if (color.length === 4) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
  }
  return color
}

export function brandDisplayForeground(value: unknown, fallback: string): string {
  const resolved = normalizeCompanyBrandColor(value)
    ?? normalizeCompanyBrandColor(fallback)
    ?? COLOR_MARCA_POR_DEFECTO
  const channels = [1, 3, 5].map((offset) => Number.parseInt(resolved.slice(offset, offset + 2), 16) / 255)
  const chroma = Math.max(...channels) - Math.min(...channels)
  const linear = (channel: number) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  const luminance = 0.2126 * linear(channels[0]) + 0.7152 * linear(channels[1]) + 0.0722 * linear(channels[2])

  if (chroma >= 0.55 && luminance <= 0.65) return '#ffffff'

  const darkContrast = (luminance + 0.05) / 0.059
  const lightContrast = 1.05 / (luminance + 0.05)
  return darkContrast >= lightContrast ? '#111827' : '#ffffff'
}

export function withCompanyBrandColor(config: unknown, color: string | null): Record<string, unknown> {
  const next = config && typeof config === 'object' && !Array.isArray(config)
    ? { ...(config as Record<string, unknown>) }
    : {}

  if (color) next.color = color
  else delete next.color

  return next
}

// ── Fase 4 · paleta cerrada del color de empresa (docs/auditoria-admin/04 · F-07) ───────────────────────────────────────
// El color de una empresa colorea SUS objetos —tarjetas, QR, comprobantes—, nunca la interfaz del panel. Una paleta cerrada
// impide elegir uno que no se lea. Los valores se escriben AQUÍ (único sitio exento del auditor de hex) y el `SelectorColor`
// de `@membego/ui` los recibe ya calculados: no hay ni un hexadecimal en el paquete.

/** La paleta. El primero es el color por defecto: una empresa sin color elegido cae en uno de la paleta. */
export const PALETA_MARCA_EMPRESA = [
  { valor: COLOR_MARCA_POR_DEFECTO, nombre: 'Violeta' },
  { valor: '#0f6fd9', nombre: 'Azul' },
  { valor: '#0e7490', nombre: 'Turquesa' },
  { valor: '#047857', nombre: 'Verde' },
  { valor: '#b45309', nombre: 'Ámbar' },
  { valor: '#be123c', nombre: 'Frambuesa' },
  { valor: '#334155', nombre: 'Pizarra' },
  { valor: '#c2410c', nombre: 'Naranja' },
] as const

const TINTA_OSCURA_LUMINANCIA = 0.009 // luminancia relativa de la tinta oscura (`#111827`), la de `brandDisplayForeground`

function luminanciaRelativa(color: string): number {
  const canales = [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16) / 255)
  const lineal = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lineal(canales[0]) + 0.7152 * lineal(canales[1]) + 0.0722 * lineal(canales[2])
}

/**
 * Qué tinta se lee sobre un color de marca y con qué contraste (WCAG: (L1 + 0,05) / (L2 + 0,05)). La tinta la decide
 * `brandDisplayForeground`, la misma que usa el resto del producto: así el aviso del selector no puede contradecir lo que se
 * pinta después.
 */
export function contrasteDeMarca(value: unknown): { tinta: 'claro' | 'oscuro'; razon: number } {
  const resuelto = normalizeCompanyBrandColor(value) ?? COLOR_MARCA_POR_DEFECTO
  const claro = brandDisplayForeground(resuelto, COLOR_MARCA_POR_DEFECTO) === '#ffffff'
  const l = luminanciaRelativa(resuelto)
  return claro
    ? { tinta: 'claro', razon: 1.05 / (l + 0.05) }
    : { tinta: 'oscuro', razon: (l + 0.05) / (TINTA_OSCURA_LUMINANCIA + 0.05) }
}

/** La paleta lista para `SelectorColor`: color, nombre, tinta y contraste. */
export function paletaDeMarca(): { valor: string; nombre: string; tinta: 'claro' | 'oscuro'; razon: number }[] {
  return PALETA_MARCA_EMPRESA.map((c) => ({ ...c, ...contrasteDeMarca(c.valor) }))
}
