/**
 * FORMATOS DE IMAGEN · LA FUENTE ÚNICA.
 *
 * Cada sección de la plataforma que recibe una imagen tiene aquí UN formato:
 * una proporción y un tamaño final. Lo leen el editor del navegador, el
 * servidor que genera las versiones y los letreros del panel: así no pueden
 * contradecirse.
 *
 * Y la geometría del encuadre vive aquí, pura y sin dependencias (ni React ni
 * `sharp`): el navegador la usa para dibujar el encuadre y el servidor para
 * validar lo que el navegador mandó, con el mismo código.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL MODELO
 *
 * La persona elige DÓNDE se ve su foto: la mueve, la acerca, la aleja hasta
 * verla entera y la gira. Eso se resume en un ENCUADRE: un rectángulo
 * (en píxeles de la foto ya girada) más el giro y el color de fondo que rellena
 * lo que la foto no cubre.
 *
 *  - Catálogo: se guarda el ORIGINAL y el encuadre; el servidor genera las
 *    versiones desde ahí. Reencuadrar no degrada la foto.
 *  - Resto de secciones: el navegador produce la imagen final en el tamaño único
 *    de la sección (`exportar.ts`) y esa es la que se sube.
 *
 * Las coordenadas son las de la imagen YA orientada (rotación EXIF aplicada),
 * que es la que ve el navegador, y después del giro elegido.
 */

/** Rectángulo en píxeles de la foto (ya orientada y girada). Puede salirse de ella si se aleja la foto. */
export interface Recorte {
  x: number
  y: number
  w: number
  h: number
}

export type Giro = 0 | 90 | 180 | 270

/** Lo que se guarda de una foto: el rectángulo, cuánto se giró y de qué color se rellena lo que sobra. */
export interface Encuadre extends Recorte {
  giro: Giro
  fondo: string
}

export type NombreVariante = 'tarjeta' | 'ficha' | 'compartir'

/** Una parte de la imagen que, en alguna pantalla, se recorta: el editor la dibuja para que se vea qué se pierde. */
export interface ZonaSegura {
  etiqueta: string
  /** Proporción ancho/alto de lo que SÍ se ve en esa pantalla. */
  aspecto: number
}

export interface FormatoImagen {
  id: string
  /** Nombre para mostrar en el panel. */
  etiqueta: string
  /** Una línea para letreros: «Cuadrada (1:1) · 1200×1200 px». */
  descripcion: string
  /** Proporción ancho/alto del encuadre. */
  aspecto: number
  /** El tamaño ÚNICO de la imagen final de esta sección. */
  salida: { ancho: number; alto: number }
  /** Con menos píxeles de ancho de recorte que esto, se avisa de que se verá borrosa. */
  recomendadoPx: number
  /** Por debajo de esto, la imagen se ve mal incluso en pequeño. */
  minimoPx: number
  /** Pantallas que recortan la imagen distinto del formato (p. ej. el banner en móvil y en escritorio). */
  zonas?: ZonaSegura[]
  /** Cómo se enseña la vista previa: un círculo para los avatares. */
  forma?: 'cuadro' | 'circulo'
}

function formato(
  id: string,
  etiqueta: string,
  aspectoTexto: string,
  ancho: number,
  alto: number,
  extra: Partial<FormatoImagen> & { recomendadoPx?: number; minimoPx?: number } = {}
): FormatoImagen {
  return {
    id,
    etiqueta,
    descripcion: `${aspectoTexto} · ${ancho}×${alto} px`,
    aspecto: ancho / alto,
    salida: { ancho, alto },
    recomendadoPx: extra.recomendadoPx ?? ancho,
    minimoPx: extra.minimoPx ?? Math.round(ancho / 2),
    ...(extra.zonas ? { zonas: extra.zonas } : {}),
    ...(extra.forma ? { forma: extra.forma } : {}),
  }
}

/**
 * UN tamaño por sección. El tamaño sale de cómo se muestra la imagen en esa
 * sección, no del gusto: lo que se pinta cuadrado es cuadrado, lo que se pinta
 * a 16:9 es 16:9. Cambiar un formato aquí cambia el editor, el aviso de
 * resolución y los letreros a la vez.
 */
export const FORMATOS = {
  /** Foto de producto: el estándar de las tiendas; tarjeta, ficha, perfil y ofertas muestran el cuadrado entero. */
  catalogo: formato('catalogo', 'Foto de producto', 'Cuadrada (1:1)', 1200, 1200, { minimoPx: 600 }),
  /** Promoción: el «formato Instagram» que ya usaban las promociones. */
  promocion: formato('promocion', 'Imagen de la promoción', 'Cuadrada (1:1)', 1080, 1080, { minimoPx: 540 }),
  /** Plan de membresía: la tarjeta del plan la pinta a 16:9. */
  plan: formato('plan', 'Imagen del plan', 'Panorámica (16:9)', 1600, 900, { minimoPx: 800 }),
  /** Excursión: portada a 16:9. */
  excursion: formato('excursion', 'Portada de la excursión', 'Panorámica (16:9)', 1600, 900, { minimoPx: 800 }),
  /** Fotos extra de la excursión y de la galería de la empresa: cuadrícula cuadrada. */
  galeria: formato('galeria', 'Foto de galería', 'Cuadrada (1:1)', 1000, 1000, { minimoPx: 500 }),
  /** Logo de la empresa: se pinta cuadrado. */
  logo: formato('logo', 'Logo', 'Cuadrado (1:1)', 512, 512, { minimoPx: 256 }),
  /**
   * Banner del perfil de la empresa: ocupa todo el ancho, 224 px de alto en
   * móvil (≈1,7:1) y 288 px en escritorio (≈4,4:1). Una sola imagen 3:1 y las
   * dos zonas dibujadas en el editor para poner lo importante en el centro.
   */
  banner: formato('banner', 'Banner del perfil', 'Banner (3:1)', 1800, 600, {
    minimoPx: 900,
    zonas: [
      { etiqueta: 'Se ve en móvil', aspecto: 390 / 224 },
      { etiqueta: 'Se ve en escritorio', aspecto: 1280 / 288 },
    ],
  }),
  /** Imagen que se ve al compartir el enlace de una campaña: la proporción de las tarjetas de WhatsApp y Facebook. */
  compartir: formato('compartir', 'Imagen para compartir', 'Apaisada (1,91:1)', 1200, 630, { minimoPx: 600 }),
  /** Fondo del landing y de las campañas de marketing. */
  fondo: formato('fondo', 'Fondo de la campaña', 'Panorámica (16:9)', 1600, 900, { minimoPx: 800 }),
  /** Foto de perfil del cliente: se pinta en círculo. */
  avatar: formato('avatar', 'Foto de perfil', 'Cuadrada (1:1)', 400, 400, { minimoPx: 200, forma: 'circulo' }),
} as const satisfies Record<string, FormatoImagen>

export type IdFormato = keyof typeof FORMATOS

/** El formato del catálogo, que además genera versiones (ver `VARIANTES_CATALOGO`). */
export const FORMATO_CATALOGO: FormatoImagen = FORMATOS.catalogo

/**
 * Versiones que se generan de una foto de catálogo. Mismo encuadre, tres
 * tamaños: la tarjeta (listas), la ficha (detalle) y, para el enlace que se
 * comparte, la foto entera centrada sobre un fondo desenfocado de sí misma.
 */
export const VARIANTES_CATALOGO: Record<NombreVariante, { ancho: number; alto: number }> = {
  tarjeta: { ancho: 600, alto: 600 },
  ficha: { ancho: 1200, alto: 1200 },
  compartir: { ancho: 1200, alto: 630 },
}

/** Tamaño máximo del original, en MB (el del bucket). */
export const MAX_ORIGINAL_MB = 5
/** Un original por encima de esto en píxeles se rechaza (protege al servidor de bombas de descompresión). */
export const MAX_PIXELES_ORIGINAL = 40_000_000
/** Zoom máximo del editor: más allá la imagen se ve a pedazos. */
export const ZOOM_MAXIMO = 4

export const FONDO_PREDETERMINADO = '#ffffff'
/** Colores de fondo que ofrece el editor para lo que la foto no cubre. */
export const FONDOS: readonly { valor: string; etiqueta: string }[] = [
  { valor: '#ffffff', etiqueta: 'Blanco' },
  { valor: '#f1f5f9', etiqueta: 'Gris claro' },
  { valor: '#0f172a', etiqueta: 'Oscuro' },
]

// ── Geometría ────────────────────────────────────────────────────────────────

function entre(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** Las dimensiones de una foto después de girarla: a 90° y 270° alto y ancho se intercambian. */
export function dimensionesGiradas(ancho: number, alto: number, giro: Giro): { ancho: number; alto: number } {
  return giro === 90 || giro === 270 ? { ancho: alto, alto: ancho } : { ancho, alto }
}

export function siguienteGiro(giro: Giro, sentido: 1 | -1): Giro {
  return ((((giro + 90 * sentido) % 360) + 360) % 360) as Giro
}

/** Ancho del encuadre más grande de esa proporción que cabe DENTRO de la foto (zoom 1). */
function anchoBase(ancho: number, alto: number, aspecto: number): number {
  return Math.min(ancho, alto * aspecto)
}

/** Ancho del encuadre más chico que contiene la foto ENTERA: el zoom más alejado. */
function anchoContenedor(ancho: number, alto: number, aspecto: number): number {
  return Math.max(ancho, alto * aspecto)
}

/**
 * El zoom más alejado: el que deja ver la foto entera dentro del marco (con
 * fondo en lo que sobra). En una foto de la misma proporción que el marco es 1:
 * no hay nada que alejar.
 */
export function zoomMinimo(ancho: number, alto: number, aspecto: number): number {
  return Math.min(1, anchoBase(ancho, alto, aspecto) / anchoContenedor(ancho, alto, aspecto))
}

function posicionEnEje(centro: number, lado: number, total: number): number {
  const p = centro * total - lado / 2
  // Foto más grande que el marco: el marco no se sale de ella. Más chica: la foto no se sale del marco.
  return lado <= total ? entre(p, 0, total - lado) : entre(p, total - lado, 0)
}

/**
 * El encuadre de la proporción pedida, con `zoom` aplicado (1 = el más grande
 * que cabe dentro de la foto; menos de 1 = alejado, con fondo) y centrado en
 * (`cx`, `cy`), que son fracciones de la foto. Es la única función que usa el
 * editor para saber qué se ve, y limita el centro para que nunca quede una
 * esquina vacía sin querer: la foto se mueve libremente dentro de lo que cubre.
 */
export function recorteDesde(ancho: number, alto: number, aspecto: number, zoom = 1, cx = 0.5, cy = 0.5): Recorte {
  const z = entre(zoom, zoomMinimo(ancho, alto, aspecto), ZOOM_MAXIMO)
  const w = anchoBase(ancho, alto, aspecto) / z
  const h = w / aspecto
  return { x: posicionEnEje(cx, w, ancho), y: posicionEnEje(cy, h, alto), w, h }
}

/** Centro (fracciones de la foto) de un recorte: el inverso de `recorteDesde`. */
export function centroDe(r: Recorte, ancho: number, alto: number): { cx: number; cy: number } {
  return { cx: (r.x + r.w / 2) / ancho, cy: (r.y + r.h / 2) / alto }
}

/** Zoom con el que un recorte se obtiene de `recorteDesde`. */
export function zoomDe(r: Recorte, ancho: number, alto: number, aspecto: number): number {
  return entre(anchoBase(ancho, alto, aspecto) / r.w, zoomMinimo(ancho, alto, aspecto), ZOOM_MAXIMO)
}

/**
 * Qué parte del encuadre se ve en una pantalla de OTRA proporción (por ejemplo
 * el banner en el móvil): una franja centrada. Devuelve la franja como
 * fracciones 0–1 del encuadre, para que el editor oscurezca lo que queda fuera.
 */
export function zonaVisible(aspectoEncuadre: number, aspectoZona: number): { x: number; y: number; w: number; h: number } {
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
 * Cómo pintar un recorte dentro de una caja de su misma proporción, con la
 * foto entera como fondo: porcentajes para `width`, `height`, `left` y `top`.
 * Sirve a la vista del editor y a las miniaturas sin tocar un canvas.
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

/**
 * Estilo del `<img>` DENTRO de la caja que pinta `estiloDeVista` con las
 * dimensiones YA giradas. A 0° y 180° ocupa la caja; a 90° y 270° la caja tiene
 * ancho y alto intercambiados respecto a la foto, así que la imagen se dimensiona
 * al revés y se gira desde el centro.
 */
export function estiloDeImagenGirada(giro: Giro, ancho: number, alto: number): Record<string, string> {
  const rot = `rotate(${giro}deg)`
  if (giro === 0 || giro === 180) {
    return { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', transform: rot }
  }
  // Caja = alto×ancho de la foto; la foto sin girar mide ancho×alto.
  return {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: `${(ancho / alto) * 100}%`,
    height: `${(alto / ancho) * 100}%`,
    transform: `translate(-50%, -50%) ${rot}`,
  }
}

/**
 * Lee el encuadre guardado en la base (JSON sin tipo). Las filas anteriores al
 * giro y al fondo solo traen el rectángulo: se completan con 0° y blanco.
 * Devuelve null si no hay uno utilizable: el editor empieza centrado.
 */
export function encuadreGuardado(json: unknown): Encuadre | null {
  if (typeof json !== 'object' || json === null) return null
  const { x, y, w, h, giro, fondo } = json as Record<string, unknown>
  if (![x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  if ((w as number) <= 0 || (h as number) <= 0) return null
  return {
    x: x as number,
    y: y as number,
    w: w as number,
    h: h as number,
    giro: giro === 90 || giro === 180 || giro === 270 ? giro : 0,
    fondo: typeof fondo === 'string' && /^#[0-9a-f]{6}$/i.test(fondo) ? fondo : FONDO_PREDETERMINADO,
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
 * píxeles de la foto, que es lo que de verdad se va a ampliar.
 */
export function evaluarResolucion(r: Recorte, f: FormatoImagen): EvaluacionResolucion {
  const w = Math.round(r.w)
  const h = Math.round(r.h)
  const recomendado = `${f.recomendadoPx}×${Math.round(f.recomendadoPx / f.aspecto)} px`
  if (w < f.minimoPx) {
    return {
      nivel: 'baja',
      mensaje: `La zona que elegiste mide ${w}×${h} px: se verá borrosa. Usa una foto más grande o acerca menos el zoom (recomendado ${recomendado} o más).`,
    }
  }
  if (w < f.recomendadoPx) {
    return {
      nivel: 'justa',
      mensaje: `La zona mide ${w}×${h} px. Se ve bien en tamaño pequeño, pero puede verse algo blanda en pantallas grandes. Recomendado: ${recomendado} o más.`,
    }
  }
  return { nivel: 'ok', mensaje: null }
}

// ── Validación (la usa el servidor con lo que manda el navegador) ───────────

const TOLERANCIA_ASPECTO = 0.03
const LADO_MINIMO_RECORTE = 64

/**
 * Valida un encuadre llegado del navegador contra las dimensiones REALES de la
 * foto ya orientada (SIN girar: el giro se valida aquí y se aplica al medir).
 * Devuelve el encuadre con el rectángulo en enteros, o un mensaje de error. No
 * se confía en nada: ni en que sean números, ni en que quepan, ni en la
 * proporción, ni en el color.
 */
export function validarEncuadre(
  entrada: unknown,
  ancho: number,
  alto: number,
  aspecto: number
): { ok: true; encuadre: Encuadre } | { ok: false; error: string } {
  if (typeof entrada !== 'object' || entrada === null) return { ok: false, error: 'Falta el encuadre de la imagen.' }
  const { x, y, w, h, giro: giroEntrada, fondo: fondoEntrada } = entrada as Record<string, unknown>
  if (![x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return { ok: false, error: 'El encuadre de la imagen no es válido.' }
  }
  const giro: Giro = giroEntrada === undefined ? 0 : giroEntrada === 90 || giroEntrada === 180 || giroEntrada === 270 || giroEntrada === 0 ? giroEntrada : (NaN as never)
  if (Number.isNaN(giro)) return { ok: false, error: 'El giro de la imagen no es válido.' }
  const fondo = fondoEntrada === undefined ? FONDO_PREDETERMINADO : fondoEntrada
  if (typeof fondo !== 'string' || !/^#[0-9a-f]{6}$/i.test(fondo)) return { ok: false, error: 'El color de fondo no es válido.' }

  const dims = dimensionesGiradas(ancho, alto, giro)
  const r = { x: Math.round(x as number), y: Math.round(y as number), w: Math.round(w as number), h: Math.round(h as number) }
  if (r.w < LADO_MINIMO_RECORTE || r.h < LADO_MINIMO_RECORTE) return { ok: false, error: 'El encuadre es demasiado pequeño.' }
  if (Math.abs(r.w / r.h - aspecto) / aspecto > TOLERANCIA_ASPECTO) {
    return { ok: false, error: 'El encuadre no tiene la proporción de este tipo de imagen.' }
  }
  // No se puede alejar más de lo que hace falta para ver la foto entera.
  if (r.w > anchoContenedor(dims.ancho, dims.alto, aspecto) * 1.01 + 1) {
    return { ok: false, error: 'El encuadre se aleja más de lo permitido.' }
  }
  // Por eje: si el marco cabe en la foto, no se sale; si la foto cabe en el marco, la foto no se sale. Tolerancia de 1 px.
  const ejeValido = (p: number, lado: number, total: number) =>
    lado <= total + 1 ? p >= -1 && p + lado <= total + 1 : p <= 1 && p + lado >= total - 1
  if (!ejeValido(r.x, r.w, dims.ancho) || !ejeValido(r.y, r.h, dims.alto)) {
    return { ok: false, error: 'El encuadre se sale de la imagen.' }
  }
  return { ok: true, encuadre: { ...r, giro, fondo: fondo.toLowerCase() } }
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
