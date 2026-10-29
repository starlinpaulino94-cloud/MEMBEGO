/**
 * LAS IMÁGENES PROPIAS DE UN BANNER (subidas desde el editor de inicio).
 *
 * Archivo PURO (sin Next ni Prisma): lo importan la acción de subida, la
 * validación del banner y su prueba.
 */

export const BUCKET_BANNERS = 'promociones'

/** Lo que llega con el nombre de archivo que genera `uniqueFileName`: un solo segmento, sin puntos iniciales. */
const ARCHIVO_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * ¿Esta URL es una imagen de banner SUBIDA por esta empresa?
 *
 * Es la única vía, además de las imágenes que la empresa ya tiene
 * (`hero-publico`), por la que una URL manual entra en un banner. Se exige:
 *  · el prefijo exacto del bucket público + `<companyId>/banners/`, y
 *  · que lo que sigue sea UN archivo (sin `/`, sin `..`, sin `%`): una URL
 *    como `…/banners/../<otraEmpresa>/x.png` pasaría un `startsWith` ingenuo y
 *    el CDN la normalizaría a la imagen de otro negocio.
 */
export function esImagenDeBannerPropia(url: string, companyId: string, supabaseUrl: string): boolean {
  const base = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${BUCKET_BANNERS}/${companyId}/banners/`
  if (!url.startsWith(base)) return false
  const archivo = url.slice(base.length)
  return ARCHIVO_VALIDO.test(archivo) && !archivo.includes('..')
}
