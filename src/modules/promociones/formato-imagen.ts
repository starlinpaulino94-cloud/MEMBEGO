/**
 * EL FORMATO DE LA IMAGEN DE PROMOCIÓN. La fuente única.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ CUADRADA (1080×1080, el formato de Instagram)
 *
 * Decisión de producto (12-08-2026): la imagen debe verse bien en PC y en
 * celular, y darle a los diseñadores un lienzo que conocen. El formato
 * horizontal de las tarjetas compartidas (OG_SIZE, 1728×910) fallaba en las
 * dos direcciones posibles según cómo se mostrara: recortado con `cover`,
 * diminuto con `contain` — un banner apaisado nunca va a llenar la pantalla
 * de un teléfono, que es vertical. El cuadrado de Instagram sí: llena el
 * ancho del celular por completo y en PC queda centrado y equilibrado.
 *
 * Compartir por WhatsApp/Facebook no se rompe: el enlace entrega la imagen
 * ORIGINAL entera como vista previa (ver opengraph-image.tsx, «como Temu»),
 * así que la vista previa simplemente pasa a ser cuadrada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUIÉN LEE ESTO
 *
 * - El formulario de subida (PromoImagenUpload): EXIGE el formato — rechaza
 *   con mensaje claro en vez de aceptar y que se vea mal después.
 * - El detalle de la promoción (PromotionDetail): su caja MIDE este formato,
 *   para que una imagen bien subida llene el espacio sin recorte ni franjas.
 *
 * Sin dependencias a propósito: lo importan componentes de cliente.
 */

export const PROMO_IMG = { width: 1080, height: 1080 } as const

/**
 * Tolerancia de proporción: ±4 %. Un 1080×1080 exacto, un 2000×2000 o un
 * recorte a mano alzada de un editor pasan; un 4:5 o un banner apaisado, no.
 * La exigencia es la PROPORCIÓN y el tamaño mínimo, no el píxel exacto:
 * exigir 1080 clavados rechazaría exportaciones a 2x que son mejores.
 */
const TOLERANCIA_PROPORCION = 0.04

/** Lado mínimo: por debajo de esto la imagen se ve borrosa en pantallas 2x/3x. */
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
  if (Math.abs(proporcion - 1) > TOLERANCIA_PROPORCION) {
    return (
      `La imagen debe ser cuadrada, como una publicación de Instagram ` +
      `(ideal ${PROMO_IMG.width}×${PROMO_IMG.height} px). La tuya mide ${width}×${height}.`
    )
  }
  if (Math.min(width, height) < LADO_MINIMO) {
    return (
      `La imagen es muy pequeña: mínimo ${LADO_MINIMO} px por lado para que se vea ` +
      `nítida en celulares. La tuya mide ${width}×${height}.`
    )
  }
  return null
}
