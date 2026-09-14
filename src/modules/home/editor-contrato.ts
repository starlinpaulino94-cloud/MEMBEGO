import { z } from 'zod'
import { HeroSlide } from './esquema'

const SlidesGuardados = z.object({ slides: z.array(HeroSlide).max(3) })

export function leerSlidesEditor(config: unknown) {
  return SlidesGuardados.parse(config).slides.map((slide) => ({
    titulo: slide.titulo,
    subtitulo: slide.subtitulo,
    imagenUrl: slide.imagenUrl ?? '',
    ctaTexto: slide.ctaTexto,
    ctaTipo: slide.ctaDestino.tipo,
    ctaId: slide.ctaDestino.id,
  }))
}

export function fechaEditorialIso(fechaLocal: string): string | null {
  if (!fechaLocal) return null
  return z.coerce.date().parse(fechaLocal).toISOString()
}
