import sharp from 'sharp'
import {
  FORMATO_CATALOGO,
  MAX_PIXELES_ORIGINAL,
  VARIANTES_CATALOGO,
  dimensionesGiradas,
  validarEncuadre,
  type Encuadre,
  type NombreVariante,
} from '@/lib/imagen/formatos'

/**
 * COMMERCE CORE · catálogo — versiones de una foto (tarjeta, ficha, compartir).
 *
 * A partir del ORIGINAL y del encuadre que eligió la persona, genera las
 * versiones en WebP. Nada de esto toca Storage ni la base: recibe bytes y
 * devuelve bytes, para poder probarlo con imágenes sintéticas.
 *
 * Detalles que importan:
 *  - El encuadre viene en píxeles de la foto ORIENTADA (la que ve el
 *    navegador al aplicar la rotación EXIF) y ya GIRADA. `sharp` mide el
 *    archivo en crudo, así que aquí se orienta, se gira y solo entonces se mide.
 *  - Si la persona alejó la foto, el encuadre se sale de ella: lo que sobra se
 *    rellena con el color de fondo elegido. Se compone a la escala FINAL, no a
 *    la del original, para no reservar un lienzo de miles de píxeles.
 *  - Las versiones salen sin metadatos: se va el GPS que traen las fotos de
 *    celular, que de otro modo quedaría publicado en un bucket público.
 *  - `limitInputPixels` corta las «bombas de descompresión»: un PNG de pocos
 *    KB que declara 60 000×60 000 px se rechaza antes de decodificarlo.
 */

export interface VarianteGenerada {
  nombre: NombreVariante
  buffer: Buffer
  ancho: number
  alto: number
}

export interface ResultadoVariantes {
  /** Dimensiones del original, ya orientado y SIN girar. */
  ancho: number
  alto: number
  encuadre: Encuadre
  variantes: VarianteGenerada[]
}

const CALIDAD_WEBP = 82
const OPCIONES_ENTRADA = { limitInputPixels: MAX_PIXELES_ORIGINAL } as const

/** Dimensiones del original tal como las ve el navegador (con la rotación EXIF aplicada, sin giro). */
export async function dimensionesOrientadas(original: Buffer): Promise<{ ancho: number; alto: number }> {
  const meta = await sharp(original, OPCIONES_ENTRADA).metadata()
  if (!meta.width || !meta.height) throw new Error('No se pudieron leer las dimensiones de la imagen.')
  // Orientaciones EXIF 5–8 giran la imagen 90°: alto y ancho se intercambian.
  const girada = (meta.orientation ?? 1) >= 5
  return girada ? { ancho: meta.height, alto: meta.width } : { ancho: meta.width, alto: meta.height }
}

/** La foto orientada y girada, lista para recortar. */
function fotoGirada(original: Buffer, giro: Encuadre['giro']) {
  const base = sharp(original, OPCIONES_ENTRADA).autoOrient()
  return giro === 0 ? base : base.rotate(giro)
}

/**
 * Pinta el encuadre a un tamaño dado: la parte de la foto que cae dentro, sobre
 * un lienzo del color de fondo. Si el encuadre cabe en la foto, no hay fondo.
 */
async function pintarEncuadre(
  original: Buffer,
  enc: Encuadre,
  dimsGiradas: { ancho: number; alto: number },
  salida: { ancho: number; alto: number }
): Promise<Buffer> {
  const escala = salida.ancho / enc.w
  // La parte del encuadre que cae dentro de la foto, en píxeles de la foto.
  const izq = Math.max(0, enc.x)
  const arr = Math.max(0, enc.y)
  const der = Math.min(dimsGiradas.ancho, enc.x + enc.w)
  const aba = Math.min(dimsGiradas.alto, enc.y + enc.h)
  const interior = { left: izq, top: arr, width: Math.max(1, der - izq), height: Math.max(1, aba - arr) }

  const cubreTodo = enc.x >= 0 && enc.y >= 0 && enc.x + enc.w <= dimsGiradas.ancho && enc.y + enc.h <= dimsGiradas.alto
  if (cubreTodo) {
    return fotoGirada(original, enc.giro)
      .extract(interior)
      .resize({ width: salida.ancho, height: salida.alto, fit: 'cover' })
      .webp({ quality: CALIDAD_WEBP })
      .toBuffer()
  }

  // Foto alejada: se reduce lo que cae dentro y se pone sobre el lienzo del fondo.
  const anchoDentro = Math.max(1, Math.round(interior.width * escala))
  const altoDentro = Math.max(1, Math.round(interior.height * escala))
  const pieza = await fotoGirada(original, enc.giro)
    .extract(interior)
    .resize({ width: anchoDentro, height: altoDentro, fit: 'fill' })
    .toBuffer()
  return sharp({ create: { width: salida.ancho, height: salida.alto, channels: 3, background: enc.fondo } })
    .composite([{ input: pieza, left: Math.round((izq - enc.x) * escala), top: Math.round((arr - enc.y) * escala) }])
    .webp({ quality: CALIDAD_WEBP })
    .toBuffer()
}

/**
 * La tarjeta que se ve al compartir el enlace (apaisada): la foto cuadrada
 * ENTERA, centrada, sobre una versión desenfocada de sí misma. Nada se recorta.
 */
async function pintarCompartir(ficha: Buffer, salida: { ancho: number; alto: number }): Promise<Buffer> {
  const fondo = await sharp(ficha)
    .resize({ width: salida.ancho, height: salida.alto, fit: 'cover' })
    .blur(24)
    .modulate({ brightness: 0.92 })
    .toBuffer()
  const centro = await sharp(ficha).resize({ height: salida.alto, fit: 'inside' }).toBuffer({ resolveWithObject: true })
  return sharp(fondo)
    .composite([{ input: centro.data, left: Math.round((salida.ancho - centro.info.width) / 2), top: 0 }])
    .webp({ quality: CALIDAD_WEBP })
    .toBuffer()
}

/**
 * Genera todas las versiones del catálogo. Lanza si el archivo no se puede
 * decodificar o el encuadre no es válido; quien llama traduce el error.
 */
export async function generarVariantesCatalogo(original: Buffer, encuadreEntrada: unknown): Promise<ResultadoVariantes> {
  const { ancho, alto } = await dimensionesOrientadas(original)

  const valido = validarEncuadre(encuadreEntrada, ancho, alto, FORMATO_CATALOGO.aspecto)
  if (!valido.ok) throw new ErrorDeImagen(valido.error)
  const encuadre = valido.encuadre
  const dims = dimensionesGiradas(ancho, alto, encuadre.giro)

  const variantes: VarianteGenerada[] = []
  for (const nombre of ['tarjeta', 'ficha'] as const) {
    const medida = VARIANTES_CATALOGO[nombre]
    const buffer = await pintarEncuadre(original, encuadre, dims, medida)
    variantes.push({ nombre, buffer, ancho: medida.ancho, alto: medida.alto })
  }
  const ficha = variantes.find((v) => v.nombre === 'ficha')!.buffer
  const medidaCompartir = VARIANTES_CATALOGO.compartir
  variantes.push({
    nombre: 'compartir',
    buffer: await pintarCompartir(ficha, medidaCompartir),
    ancho: medidaCompartir.ancho,
    alto: medidaCompartir.alto,
  })
  return { ancho, alto, encuadre, variantes }
}

/** Error con un mensaje que SÍ se puede enseñar a quien sube la imagen. */
export class ErrorDeImagen extends Error {}
