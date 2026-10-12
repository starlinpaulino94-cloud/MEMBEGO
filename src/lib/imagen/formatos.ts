/**
 * FORMATOS DE IMAGEN · LA FUENTE ÚNICA.
 *
 * Cada tipo de imagen de la plataforma tiene aquí su proporción, el tamaño de
 * las versiones que se generan y la resolución que pide para verse nítida. Lo
 * leen el editor del navegador, el servidor que genera las versiones y los
 * letreros del panel: así no pueden contradecirse.
 *
 * Y la geometría del recorte vive aquí, pura y sin dependencias (ni React ni
 * `sharp`): el navegador la usa para dibujar el encuadre y el servidor para
 * validar lo que el navegador mandó, con el mismo código.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL MODELO
 *
 * Se guarda la imagen ORIGINAL tal como la subió la persona y un RECORTE: un
 * rectángulo en píxeles de esa imagen. Las versiones (tarjeta, ficha,
 * compartir) se generan en el servidor a partir de original + recorte. Así,
 * reencuadrar después no degrada nada: se vuelve a partir del original.
 *
 * Las coordenadas son las de la imagen YA orientada (la que ve el navegador al
 * aplicar la rotación EXIF), no las del archivo en crudo.
 */

/** Rectángulo de recorte en píxeles de la imagen original, ya orientada. */
export interface Recorte {
  x: number
  y: number
  w: number
  h: number
}

export type NombreVariante = 'tarjeta' | 'ficha' | 'compartir'

export interface FormatoImagen {
  /** Nombre para mostrar en el panel. */
  etiqueta: string
  /** Proporción ancho/alto del encuadre que elige la persona. */
  aspecto: number
  /** Lado largo, en píxeles, de cada versión que se genera. */
  variantes: Partial<Record<NombreVariante, { ancho: number; alto: number }>>
  /** Con menos píxeles de ancho de recorte que esto, se avisa de que se verá borrosa. */
  recomendadoPx: number
  /** Por debajo de esto, la imagen se ve mal incluso en la tarjeta. */
  minimoPx: number
}

/**
 * Foto de producto del catálogo: cuadrada. Es el estándar de las tiendas
 * (Amazon, Mercado Libre, Shopify) y la misma decisión de las promociones.
 * La tarjeta, la ficha y el perfil de la empresa muestran el cuadrado entero.
 */
export const FORMATO_CATALOGO: FormatoImagen = {
  etiqueta: 'Foto de producto',
  aspecto: 1,
  variantes: {
    tarjeta: { ancho: 600, alto: 600 },
    ficha: { ancho: 1200, alto: 1200 },
    // La tarjeta de WhatsApp/Facebook es apaisada (1,91:1): sale de una franja
    // centrada del encuadre, y el editor la dibuja para que se vea qué se pierde.
    compartir: { ancho: 1200, alto: 630 },
  },
  recomendadoPx: 1200,
  minimoPx: 600,
}

/** Proporción de la tarjeta que se comparte por redes. */
export const ASPECTO_COMPARTIR = 1200 / 630

/** Tamaño máximo del original, en MB (el del bucket). */
export const MAX_ORIGINAL_MB = 5
/** Un original por encima de esto en píxeles se rechaza (protege al servidor de bombas de descompresión). */
export const MAX_PIXELES_ORIGINAL = 40_000_000
/** Zoom máximo del editor: más allá la imagen se ve a pedazos. */
export const ZOOM_MAXIMO = 4

// ── Geometría ────────────────────────────────────────────────────────────────

function entre(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/**
 * El encuadre más grande de la proporción pedida que cabe en la imagen, con
 * `zoom` aplicado (1 = todo lo que quepa) y centrado en (`cx`, `cy`), que son
 * fracciones 0–1 de la imagen. El centro se limita para que el recorte nunca se
 * salga: es la única función que usa el editor para saber qué se ve.
 */
export function recorteDesde(
  ancho: number,
  alto: number,
  aspecto: number,
  zoom = 1,
  cx = 0.5,
  cy = 0.5
): Recorte {
  const z = entre(zoom, 1, ZOOM_MAXIMO)
  // Lado del recorte a zoom 1: el rectángulo de esa proporción que llena la imagen.
  let w = ancho
  let h = ancho / aspecto
  if (h > alto) {
    h = alto
    w = alto * aspecto
  }
  w /= z
  h /= z
  const x = entre(cx * ancho - w / 2, 0, ancho - w)
  const y = entre(cy * alto - h / 2, 0, alto - h)
  return { x, y, w, h }
}

/** Centro (fracciones 0–1) de un recorte: el inverso de `recorteDesde`. */
export function centroDe(r: Recorte, ancho: number, alto: number): { cx: number; cy: number } {
  return { cx: (r.x + r.w / 2) / ancho, cy: (r.y + r.h / 2) / alto }
}

/** Zoom con el que un recorte se obtiene de `recorteDesde` (1 = el encuadre más grande). */
export function zoomDe(r: Recorte, ancho: number, alto: number, aspecto: number): number {
  const base = recorteDesde(ancho, alto, aspecto)
  return entre(base.w / r.w, 1, ZOOM_MAXIMO)
}

/**
 * Qué parte del encuadre se ve en una tarjeta APAISADA (la de compartir):
 * una franja centrada. Devuelve la franja como fracciones 0–1 del encuadre,
 * para que el editor oscurezca lo que queda fuera.
 */
export function zonaVisibleApaisada(aspectoEncuadre: number, aspectoZona: number): { x: number; y: number; w: number; h: number } {
  if (aspectoZona >= aspectoEncuadre) {
    // Más apaisada que el encuadre: se pierde arriba y abajo.
    const h = aspectoEncuadre / aspectoZona
    return { x: 0, y: (1 - h) / 2, w: 1, h }
  }
  // Más alta que el encuadre: se pierde a los lados.
  const w = aspectoZona / aspectoEncuadre
  return { x: (1 - w) / 2, y: 0, w, h: 1 }
}

/**
 * La franja del encuadre que alimenta la tarjeta apaisada de compartir, en
 * píxeles enteros del original. La usan el servidor (para generarla) y el
 * editor (para dibujar la «así se verá»): una sola cuenta, mismo resultado.
 */
export function franjaCompartir(r: Recorte, aspecto: number = ASPECTO_COMPARTIR): Recorte {
  const h = Math.min(r.h, Math.max(1, Math.round(r.w / aspecto)))
  return { x: r.x, y: r.y + Math.round((r.h - h) / 2), w: r.w, h }
}

/**
 * Cómo pintar un recorte dentro de una caja de su misma proporción, con la
 * imagen completa como fondo: porcentajes para `width`, `left` y `top` de la
 * imagen. Sirve a las miniaturas «así se verá» sin tocar un canvas.
 */
export function estiloDeVista(
  r: Recorte,
  ancho: number,
  alto: number
): { width: string; height: string; left: string; top: string } {
  return {
    width: `${(ancho / r.w) * 100}%`,
    height: `${(alto / r.h) * 100}%`,
    left: `${(-r.x / r.w) * 100}%`,
    top: `${(-r.y / r.h) * 100}%`,
  }
}

// ── Avisos de resolución ─────────────────────────────────────────────────────

export type NivelResolucion = 'ok' | 'justa' | 'baja'

export interface EvaluacionResolucion {
  nivel: NivelResolucion
  /** Mensaje para quien sube; null cuando todo está bien. */
  mensaje: string | null
}

/**
 * ¿Con este recorte se verá nítida la foto? Mide el ANCHO REAL del recorte en
 * píxeles del original, que es lo que de verdad se va a ampliar.
 */
export function evaluarResolucion(r: Recorte, formato: FormatoImagen): EvaluacionResolucion {
  const w = Math.round(r.w)
  const h = Math.round(r.h)
  if (w < formato.minimoPx) {
    return {
      nivel: 'baja',
      mensaje: `La zona que elegiste mide ${w}×${h} px: se verá borrosa, incluso en la tarjeta. Usa una foto más grande o acerca menos el zoom (recomendado ${formato.recomendadoPx}×${Math.round(formato.recomendadoPx / formato.aspecto)} px o más).`,
    }
  }
  if (w < formato.recomendadoPx) {
    return {
      nivel: 'justa',
      mensaje: `La zona mide ${w}×${h} px. En la tarjeta se ve bien, pero en la ficha del producto puede verse algo blanda. Recomendado: ${formato.recomendadoPx}×${Math.round(formato.recomendadoPx / formato.aspecto)} px o más.`,
    }
  }
  return { nivel: 'ok', mensaje: null }
}

// ── Validación (la usa el servidor con lo que manda el navegador) ───────────

const TOLERANCIA_ASPECTO = 0.03
const LADO_MINIMO_RECORTE = 64

/**
 * Valida un recorte llegado del navegador contra las dimensiones REALES de la
 * imagen. Devuelve el recorte redondeado a píxeles enteros (lo que necesita
 * `sharp`) o un mensaje de error. No se confía en nada: ni en que sean números
 * ni en que quepan ni en la proporción.
 */
export function validarRecorte(
  entrada: unknown,
  ancho: number,
  alto: number,
  aspecto: number
): { ok: true; recorte: Recorte } | { ok: false; error: string } {
  if (typeof entrada !== 'object' || entrada === null) return { ok: false, error: 'Falta el encuadre de la imagen.' }
  const { x, y, w, h } = entrada as Record<string, unknown>
  if (![x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return { ok: false, error: 'El encuadre de la imagen no es válido.' }
  }
  const r = {
    x: Math.round(x as number),
    y: Math.round(y as number),
    w: Math.round(w as number),
    h: Math.round(h as number),
  }
  if (r.w < LADO_MINIMO_RECORTE || r.h < LADO_MINIMO_RECORTE) {
    return { ok: false, error: 'El encuadre es demasiado pequeño.' }
  }
  // Tolerancia de 1 px por el redondeo del navegador al medir.
  if (r.x < -1 || r.y < -1 || r.x + r.w > ancho + 1 || r.y + r.h > alto + 1) {
    return { ok: false, error: 'El encuadre se sale de la imagen.' }
  }
  const dentro = {
    x: entre(r.x, 0, ancho - 1),
    y: entre(r.y, 0, alto - 1),
    w: 0,
    h: 0,
  }
  dentro.w = Math.min(r.w, ancho - dentro.x)
  dentro.h = Math.min(r.h, alto - dentro.y)
  const proporcion = dentro.w / dentro.h
  if (Math.abs(proporcion - aspecto) / aspecto > TOLERANCIA_ASPECTO) {
    return { ok: false, error: 'El encuadre no tiene la proporción de este tipo de imagen.' }
  }
  return { ok: true, recorte: dentro }
}

// ── Rutas de las versiones en Storage ────────────────────────────────────────

/**
 * Prefijo (sin extensión) de las versiones de una foto. Lleva un token propio
 * y cambia cada vez que se genera de nuevo: las versiones se suben con caché
 * larga, y reusar el nombre serviría la versión vieja desde el CDN.
 */
export function baseDeVariantes(rutaOriginal: string, token: string): string {
  return `${rutaOriginal.replace(/\.[^./]+$/, '')}-${token}`
}

export function rutaDeVariante(base: string, nombre: NombreVariante): string {
  return `${base}_${nombre}.webp`
}

/** Todas las rutas de las versiones de una base, para borrarlas juntas. */
export function rutasDeVariantes(base: string): string[] {
  return (['tarjeta', 'ficha', 'compartir'] as const).map((n) => rutaDeVariante(base, n))
}
