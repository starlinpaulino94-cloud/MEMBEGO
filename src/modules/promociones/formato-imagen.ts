/**
 * EL FORMATO DE LA IMAGEN DE PROMOCIÓN. La fuente única.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ «FORMATO INSTAGRAM» (cuadrado 1:1 a vertical 4:5)
 *
 * Decisión de producto (12-08-2026, corregida el mismo día): la imagen debe
 * verse bien en PC y en celular, y darle a los diseñadores el lienzo que ya
 * conocen — el de una publicación de Instagram. Ese formato NO es solo el
 * cuadrado: Instagram publica desde 1:1 (1080×1080) hasta 4:5 vertical
 * (1080×1350), y la primera versión de esta regla, cerrada solo al cuadrado,
 * rechazó arte 4:5 perfectamente válido en producción. Aquí se acepta el
 * rango completo.
 *
 * Lo APAISADO sigue rechazado: un banner horizontal nunca llena la pantalla
 * de un teléfono, que es vertical — se veía recortado o diminuto, que es el
 * problema que originó todo esto. (El formato horizontal de las tarjetas
 * compartidas, OG_SIZE, es de las tarjetas GENERADAS; no aplica aquí.)
 *
 * Compartir por WhatsApp/Facebook no se rompe: el enlace entrega la imagen
 * ORIGINAL entera como vista previa (ver opengraph-image.tsx, «como Temu»).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUIÉN LEE ESTO
 *
 * - El formulario de subida (PromoImagenUpload): EXIGE el formato — rechaza
 *   con mensaje claro en vez de aceptar y que se vea mal después.
 * - El letrero del formulario de la promoción (PromocionForm) y la pista del
 *   botón de subida: los dos leen PROMO_IMG_DESCRIPCION para no volver a
 *   contradecirse entre sí ni con el validador.
 * - El detalle de la promoción (PromotionDetail) muestra la imagen a su
 *   proporción real — con un rango permitido ya no hay una caja única.
 *
 * Sin dependencias a propósito: lo importan componentes de cliente.
 */

/** El lienzo canónico que se recomienda (el cuadrado clásico de Instagram). */
export const PROMO_IMG = { width: 1080, height: 1080 } as const

/** Texto único para letreros del panel: validador y UI dicen lo mismo. */
export const PROMO_IMG_DESCRIPCION =
  'Formato Instagram: cuadrada (1080×1080) o vertical hasta 4:5 (1080×1350)'

/**
 * Rango de proporción (ancho/alto) permitido, con ±4 % de tolerancia en cada
 * extremo: del 4:5 vertical (0.8) al cuadrado (1.0). Un 1080×1080, un
 * 2000×2000, un 1080×1350 o un recorte a mano alzada pasan; un banner
 * apaisado o un vertical extremo (9:16 de historia), no.
 */
const PROPORCION_MIN = 0.8 * 0.96
const PROPORCION_MAX = 1.0 * 1.04

/** Lado menor mínimo: por debajo, la imagen se ve borrosa en pantallas 2x/3x. */
const LADO_MINIMO = 1080

/**
 * Valida las dimensiones de una imagen de promoción.
 *
 * @returns `null` si es válida; si no, el mensaje de error PARA EL USUARIO —
 *   dice qué se necesita y qué midió lo que subió, porque «formato inválido»
 *   a secas obliga a adivinar.
 */
export function validarDimensionesPromo(width: number, height: number): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 'No se pudieron leer las dimensiones de la imagen. Prueba con otro archivo.'
  }
  const proporcion = width / height
  if (proporcion < PROPORCION_MIN || proporcion > PROPORCION_MAX) {
    return `${PROMO_IMG_DESCRIPCION}. La tuya mide ${width}×${height}.`
  }
  if (Math.min(width, height) < LADO_MINIMO) {
    return (
      `La imagen es muy pequeña: mínimo ${LADO_MINIMO} px en su lado menor para que ` +
      `se vea nítida en celulares. La tuya mide ${width}×${height}.`
    )
  }
  return null
}
