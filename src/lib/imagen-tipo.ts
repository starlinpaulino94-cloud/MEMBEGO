/**
 * Tipo REAL de una imagen, leído de sus primeros bytes.
 *
 * El navegador manda `file.type` y `file.name`: son texto que escribe quien
 * sube el archivo, así que no prueban nada. Un `.exe` con `type: image/png`
 * llega con cara de PNG. Aquí se mira lo único que no se falsifica sin dejar
 * de ser esa imagen: la firma binaria del formato.
 *
 * Solo JPG, PNG y WebP. SVG queda fuera a propósito: es XML y puede llevar
 * scripts.
 *
 * Una firma válida no garantiza que el resto del archivo sea una imagen
 * decodificable (un políglota pasaría). Lo que sí garantiza es que el tipo con
 * el que se guarda lo decide el servidor y no el cliente.
 */

export type TipoImagen = 'image/jpeg' | 'image/png' | 'image/webp'

export const EXTENSION_DE_IMAGEN: Record<TipoImagen, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

const FIRMA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function ascii(bytes: Uint8Array, desde: number, hasta: number): string {
  let s = ''
  for (let i = desde; i < hasta; i++) s += String.fromCharCode(bytes[i])
  return s
}

export function detectarTipoImagen(bytes: Uint8Array): TipoImagen | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (bytes.length >= FIRMA_PNG.length && FIRMA_PNG.every((b, i) => bytes[i] === b)) {
    return 'image/png'
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  return null
}
