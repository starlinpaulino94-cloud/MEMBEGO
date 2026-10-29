import sharp from 'sharp'
import { rgbAHex } from './banner-formatos'

/** Una foto de banner pesa menos de esto; más es una bomba de descompresión o un archivo equivocado. */
const MAX_BYTES = 8 * 1024 * 1024
const TIEMPO_MAX_MS = 4000

/**
 * EL COLOR DOMINANTE DE UNA FOTO (`#rrggbb`), o null si no se pudo sacar.
 *
 * Solo descarga imágenes que viven en NUESTRO almacenamiento público
 * (`prefijoPermitido`, el del bucket de Supabase): la URL sale de la base de
 * datos, pero una promoción puede traer una dirección cualquiera y este código
 * corre en el servidor, así que nunca sigue una URL que no sea la propia.
 *
 * La foto se reduce a 32×32 antes de medirla; `sharp` calcula el color
 * dominante con un histograma, que es más fiel que el promedio (un promedio de
 * una foto roja y azul sale morado, un color que no está en la foto). Para que
 * el texto del banner se lea, los tonos demasiado claros o demasiado apagados
 * se acercan a un punto medio: el banner usa este color de fondo.
 */
export async function colorDominanteDeUrl(url: string, prefijoPermitido: string): Promise<string | null> {
  if (!url.startsWith(prefijoPermitido)) return null
  const respuesta = await fetch(url, { signal: AbortSignal.timeout(TIEMPO_MAX_MS) })
  if (!respuesta.ok) return null
  const largo = Number(respuesta.headers.get('content-length') ?? 0)
  if (largo > MAX_BYTES) return null
  const buffer = Buffer.from(await respuesta.arrayBuffer())
  if (buffer.length > MAX_BYTES) return null
  const { dominant } = await sharp(buffer, { failOn: 'none', limitInputPixels: 40_000_000 })
    .resize(32, 32, { fit: 'inside' })
    .stats()
  return rgbAHex(...ajustarParaFondo(dominant.r, dominant.g, dominant.b))
}

/** Acerca los extremos (casi blanco, casi negro) a un tono con cuerpo; el resto se deja igual. */
export function ajustarParaFondo(r: number, g: number, b: number): [number, number, number] {
  const luz = (r + g + b) / 3
  if (luz > 225) return [r * 0.78, g * 0.78, b * 0.78]
  if (luz < 25) return [r + 30, g + 30, b + 30]
  return [r, g, b]
}
