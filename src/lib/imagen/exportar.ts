/**
 * EXPORTAR UN ENCUADRE A LA IMAGEN FINAL, EN EL NAVEGADOR.
 *
 * Las secciones que no guardan el original (promociones, planes, excursiones,
 * logos, banners, avatares…) suben UNA imagen del tamaño único de la sección.
 * Aquí se produce: el encuadre que eligió la persona, pintado sobre un lienzo
 * del color de fondo y exportado a WebP.
 *
 * La cuenta del punto a punto (`matrizDeExportacion`) es pura y está probada:
 * canvas solo ejecuta el resultado.
 */

import { FONDO_TRANSPARENTE, dimensionesGiradas, type Encuadre } from './formatos'

/** [a, b, c, d, e, f] de `ctx.setTransform`: (x, y) de la foto → píxel del lienzo. */
export type Matriz = [number, number, number, number, number, number]

/**
 * Lleva un punto de la foto ORIENTADA y SIN girar al lienzo final: primero el
 * giro (que la deja en el sistema del encuadre), luego el desplazamiento al
 * rectángulo elegido y la escala al tamaño de salida.
 */
export function matrizDeExportacion(ancho: number, alto: number, enc: Encuadre, salidaAncho: number): Matriz {
  const s = salidaAncho / enc.w
  // (x, y) → (u, v) en la foto girada.
  const giro: Record<Encuadre['giro'], Matriz> = {
    0: [1, 0, 0, 1, 0, 0],
    90: [0, 1, -1, 0, alto, 0], // u = alto - y, v = x
    180: [-1, 0, 0, -1, ancho, alto],
    270: [0, -1, 1, 0, 0, ancho], // u = y, v = ancho - x
  }
  const [a, b, c, d, e, f] = giro[enc.giro]
  return [a * s, b * s, c * s, d * s, (e - enc.x) * s, (f - enc.y) * s]
}

/** Dimensiones de la foto sobre las que se mide el encuadre (ya giradas). */
export function dimensionesDelEncuadre(ancho: number, alto: number, enc: Encuadre) {
  return dimensionesGiradas(ancho, alto, enc.giro)
}

export interface OpcionesExportar {
  /** Tamaño único de la sección. */
  salida: { ancho: number; alto: number }
  /** 0–1. Por defecto 0,9. */
  calidad?: number
}

/**
 * Pinta el encuadre y devuelve el archivo. `img` debe estar cargada y, si vino
 * de una URL de otro origen, con `crossOrigin="anonymous"` (si no, el lienzo
 * queda «contaminado» y el navegador no deja exportarlo).
 */
export async function exportarEncuadre(
  img: HTMLImageElement,
  enc: Encuadre,
  { salida, calidad = 0.9 }: OpcionesExportar
): Promise<File> {
  const ancho = img.naturalWidth
  const alto = img.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = salida.ancho
  canvas.height = salida.alto
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No se pudo preparar la imagen en este navegador.')
  // Con fondo transparente el lienzo se deja vacío (WebP guarda el canal alfa).
  if (enc.fondo !== FONDO_TRANSPARENTE) {
    ctx.fillStyle = enc.fondo
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.setTransform(...matrizDeExportacion(ancho, alto, enc, salida.ancho))
  ctx.drawImage(img, 0, 0)
  ctx.setTransform(1, 0, 0, 1, 0, 0)

  const aBlob = (tipo: string, q: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, tipo, q))
  const webp = await aBlob('image/webp', calidad)
  // Safari antiguo no exporta WebP y devuelve PNG: se queda con JPEG para no inflar el archivo.
  const blob = webp && webp.type === 'image/webp' ? webp : await aBlob('image/jpeg', calidad)
  if (!blob) throw new Error('No se pudo generar la imagen.')
  const extension = blob.type === 'image/webp' ? 'webp' : 'jpg'
  return new File([blob], `imagen.${extension}`, { type: blob.type })
}
