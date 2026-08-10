/**
 * MDS · Membego Design System — tokens como datos.
 *
 * Fuente única de los valores de diseño para consumidores que NO pasan por
 * CSS (app móvil nativa, emails, generación de imágenes OG, PDFs). En la web
 * la fuente de verdad son las variables CSS de `globals.css`; este archivo
 * las refleja en sRGB/hex para plataformas sin soporte OKLCH.
 *
 * Regla: si un valor cambia aquí, debe cambiar también en `globals.css`
 * (y viceversa). Ver docs/MDS.md § Tokens.
 */

/**
 * Escala de marca (azul Membego). 600 es el primary de modo claro; en modo
 * oscuro se aclara hasta ~400 para mantener contraste sobre el lienzo negro.
 *
 * DS 2.0 · Fase 0: esta escala era esmeralda. El azul ya era la marca en la
 * web pública (vivía aparte, con su propio token) y ahora es el color base
 * de todo el producto. El verde quedó exclusivamente como estado de éxito,
 * en `state.success`.
 */
export const primary = {
  50: '#eff4ff',
  100: '#dbe6fe',
  200: '#bfd3fe',
  300: '#93b4fd',
  400: '#608cfa',
  500: '#3b6bf6',
  600: '#2563eb',
  700: '#1d4ed8',
  800: '#1e40af',
  900: '#1e3a8a',
} as const

/** Secundario: cyan del degradado del logo. */
export const cyanBrand = {
  300: '#7dd8e8',
  500: '#22b8cf',
  700: '#0e7f96',
} as const

/**
 * Semánticos de estado (modo claro).
 *
 * DS 2.0 · `info` se desplazó de #2563eb a un cian: ese hex es ahora el
 * azul DE MARCA (`primary.600`), y un aviso informativo no debe parecer un
 * CTA. El verde de `success` es el único verde que sobrevive en el sistema.
 */
export const state = {
  /**
   * Sincronizados con `globals.css` tras la Fase 19, que los oscureció para
   * que sirvan como TEXTO: los valores anteriores daban 3.62:1, 2.28:1 y
   * 3.44:1 sobre blanco, por debajo del 4.5:1 de AA. Este espejo alimenta
   * correos, imágenes OG y PDFs — sitios donde nadie va a revisar el
   * contraste después, así que tienen que nacer bien.
   */
  success: '#00864d',
  warning: '#ab6300',
  danger: '#e7000b',
  info: '#00809b',
} as const

/** Navy profundo del logo (sidebar / fondos hero). */
export const navy = '#0b1220'

/** Espaciado — escala base 4px. Usar SIEMPRE estos pasos. */
export const spacing = [0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64, 80, 96] as const

/** Radios (px). */
export const radius = {
  xs: 6,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 14,
  '2xl': 20,
  pill: 999,
  circle: '50%',
} as const

/** Tipografía: familias y escala (px, peso, line-height). */
export const typography = {
  families: {
    display: 'Plus Jakarta Sans', // títulos y números protagonistas
    sans: 'Geist',                // texto de lectura y UI
    mono: 'Geist Mono',           // códigos, referencias, montos tabulares
  },
  scale: {
    displayXl: { size: 72, weight: 800, lineHeight: 1.05, tracking: -0.03 },
    display: { size: 48, weight: 800, lineHeight: 1.05, tracking: -0.03 },
    headingXl: { size: 32, weight: 800, lineHeight: 1.15, tracking: -0.02 },
    headingL: { size: 24, weight: 700, lineHeight: 1.25, tracking: -0.015 },
    headingM: { size: 17, weight: 700, lineHeight: 1.3, tracking: -0.01 },
    headingS: { size: 15, weight: 600, lineHeight: 1.35, tracking: 0 },
    bodyXl: { size: 17, weight: 400, lineHeight: 1.6, tracking: 0 },
    bodyL: { size: 16, weight: 400, lineHeight: 1.6, tracking: 0 },
    bodyM: { size: 16, weight: 400, lineHeight: 1.6, tracking: 0 },
    bodyS: { size: 14, weight: 400, lineHeight: 1.5, tracking: 0 },
    caption: { size: 12.5, weight: 400, lineHeight: 1.45, tracking: 0 },
    overline: { size: 12, weight: 600, lineHeight: 1.4, tracking: 0.08 },
    button: { size: 14, weight: 500, lineHeight: 1, tracking: 0 },
    label: { size: 13, weight: 500, lineHeight: 1.4, tracking: 0 },
    /** Navegación lateral — rol propio: era el peor infractor con 13px. */
    nav: { size: 14.5, weight: 500, lineHeight: 1.4, tracking: 0 },
  },
} as const

/**
 * Suelo tipográfico del sistema (px). DS 2.0 · Fase 0.
 *
 * NADA de la interfaz baja de aquí: ni microcopy, ni etiquetas, ni
 * navegación. La auditoría encontró 218 tamaños escritos a mano por debajo
 * de este valor; se migran módulo a módulo en las fases siguientes.
 */
export const minFontSize = 12

/** Motion (MMS): duraciones (ms) y curvas. Espejo de los tokens CSS. */
export const motion = {
  duration: { instant: 100, fast: 150, base: 200, slow: 350, hero: 500, celebration: 900 },
  easing: {
    outExpo: [0.16, 1, 0.3, 1],
    inQuint: [0.64, 0, 0.78, 0],
    inOut: [0.65, 0, 0.35, 1],
    spring: [0.34, 1.56, 0.64, 1],
    bounce: [0.68, -0.55, 0.27, 1.55],
    elastic: [0.5, 1.5, 0.5, 1],
  },
} as const

/** Área táctil mínima (px) — accesibilidad. */
export const minTouchTarget = 44

export const tokens = {
  primary,
  cyanBrand,
  state,
  navy,
  spacing,
  radius,
  typography,
  motion,
  minTouchTarget,
  minFontSize,
} as const

export type MdsTokens = typeof tokens
