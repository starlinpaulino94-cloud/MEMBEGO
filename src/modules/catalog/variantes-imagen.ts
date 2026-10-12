import sharp from 'sharp'
import {
  FORMATO_CATALOGO,
  MAX_PIXELES_ORIGINAL,
  validarRecorte,
  type NombreVariante,
  type Recorte,
} from '@/lib/imagen/formatos'

/**
 * COMMERCE CORE · catálogo — versiones de una foto (tarjeta, ficha, compartir).
 *
 * A partir del ORIGINAL y del recorte que eligió la persona, genera las
 * versiones en WebP. Nada de esto toca Storage ni la base: recibe bytes y
 * devuelve bytes, para poder probarlo con imágenes sintéticas.
 *
 * Detalles que importan:
 *  - El recorte viene en píxeles de la imagen ORIENTADA (la que ve el
 *    navegador al aplicar la rotación EXIF). `sharp` mide el archivo en crudo,
 *    así que aquí se calcula la orientación y se rota ANTES de recortar.
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
  /** Dimensiones del original, ya orientado. */
  ancho: number
  alto: number
  recorte: Recorte
  variantes: VarianteGenerada[]
}

const CALIDAD_WEBP = 82

/** Dimensiones del original tal como las ve el navegador (con la rotación EXIF aplicada). */
export async function dimensionesOrientadas(original: Buffer): Promise<{ ancho: number; alto: number }> {
  const meta = await sharp(original, { limitInputPixels: MAX_PIXELES_ORIGINAL }).metadata()
  if (!meta.width || !meta.height) throw new Error('No se pudieron leer las dimensiones de la imagen.')
  // Orientaciones EXIF 5–8 giran la imagen 90°: alto y ancho se intercambian.
  const girada = (meta.orientation ?? 1) >= 5
  return girada ? { ancho: meta.height, alto: meta.width } : { ancho: meta.width, alto: meta.height }
}

/**
 * Genera todas las versiones del formato del catálogo. Lanza si el archivo no
 * se puede decodificar o el recorte no es válido; quien llama traduce el error.
 */
export async function generarVariantesCatalogo(original: Buffer, recorteEntrada: unknown): Promise<ResultadoVariantes> {
  const { ancho, alto } = await dimensionesOrientadas(original)

  const valido = validarRecorte(recorteEntrada, ancho, alto, FORMATO_CATALOGO.aspecto)
  if (!valido.ok) throw new ErrorDeImagen(valido.error)
  const recorte = valido.recorte

  const variantes: VarianteGenerada[] = []
  for (const [nombre, medida] of Object.entries(FORMATO_CATALOGO.variantes) as [NombreVariante, { ancho: number; alto: number }][]) {
    // Región del original que alimenta esta versión: el encuadre entero, o (compartir)
    // una franja centrada de él con la proporción de la tarjeta que se comparte.
    let region = recorte
    if (nombre === 'compartir') {
      const alturaFranja = Math.min(recorte.h, Math.round((recorte.w * medida.alto) / medida.ancho))
      region = { x: recorte.x, y: recorte.y + Math.round((recorte.h - alturaFranja) / 2), w: recorte.w, h: alturaFranja }
    }
    const { data, info } = await sharp(original, { limitInputPixels: MAX_PIXELES_ORIGINAL })
      .rotate() // aplica la orientación EXIF antes de recortar
      .extract({ left: region.x, top: region.y, width: region.w, height: region.h })
      .resize({ width: medida.ancho, height: medida.alto, fit: 'cover' })
      .webp({ quality: CALIDAD_WEBP })
      .toBuffer({ resolveWithObject: true })
    variantes.push({ nombre, buffer: data, ancho: info.width, alto: info.height })
  }
  return { ancho, alto, recorte, variantes }
}

/** Error con un mensaje que SÍ se puede enseñar a quien sube la imagen. */
export class ErrorDeImagen extends Error {}
