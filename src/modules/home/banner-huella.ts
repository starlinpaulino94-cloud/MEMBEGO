/**
 * LA HUELLA DE UN BANNER A MEDIDA. Los banners a medida no tienen id propio:
 * viven como diapositivas dentro del bloque HERO de una revisión. Para quitar
 * uno desde la lista sin pisar otro (la empresa pudo editar en otra pestaña),
 * la acción manda su posición Y esta huella, y el servidor exige que las dos
 * coincidan con lo guardado. Puro: se prueba sin base de datos.
 */

export interface SlideConHuella {
  titulo: string
  imagenUrl: string | null
  ctaTexto: string
  ctaDestino: { tipo: string; id: string }
}

export function huellaDeSlide(s: SlideConHuella): string {
  return [s.ctaDestino.tipo, s.ctaDestino.id, s.titulo, s.ctaTexto, s.imagenUrl ?? ''].join('|')
}

/**
 * Las diapositivas que quedan al quitar la de la posición `indice`, o un error
 * legible. Nunca deja el hero vacío: una página de inicio con el bloque de
 * banners sin ninguno no es una composición válida (ver `ComposicionInput`).
 */
export function quitarSlide<T extends SlideConHuella>(
  slides: readonly T[],
  indice: number,
  huella: string,
): { ok: true; quedan: T[] } | { ok: false; error: string } {
  const objetivo = slides[indice]
  if (!objetivo || huellaDeSlide(objetivo) !== huella) {
    return { ok: false, error: 'Ese banner ya cambió. Recarga la página y vuelve a intentarlo.' }
  }
  if (slides.length <= 1) {
    return {
      ok: false,
      error: 'Tu inicio necesita al menos un banner a medida. Crea otro en el editor antes de quitar este, o desactiva el bloque de banners.',
    }
  }
  return { ok: true, quedan: slides.filter((_, i) => i !== indice) }
}
