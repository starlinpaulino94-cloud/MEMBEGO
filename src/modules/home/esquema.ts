import { z } from 'zod'

/**
 * Los bloques del feed, EN EL ORDEN EN QUE SALEN cuando nadie ha curado nada.
 *
 * Este array no es solo un catálogo de tipos válidos: es el Inicio por defecto.
 * `getInicioVista` lo usa tal cual cuando no hay composición publicada, así que
 * cambiar el orden de aquí cambia la pantalla de todo el mundo.
 *
 * El orden lo fijó el negocio (2026-09-15): las categorías para orientarse, el
 * héroe para enganchar, lo que está vigente ahora, las empresas que todavía no
 * conoces, las destacadas, y al final las membresías y las experiencias, que son
 * la conversión.
 *
 * Nada de esto quita la curación: el panel sigue pudiendo publicar otro orden.
 * Esto es el punto de partida, no un candado.
 */
export const TIPOS_BLOQUE = [
  'CABECERA',
  'CATEGORIAS',
  'HERO',
  'NOVEDADES',
  'DESCUBRE',
  'DESTACADAS',
  'MEMBRESIAS',
  'EXPERIENCIAS',
  'BANNER_QR',
] as const

export type TipoBloque = (typeof TIPOS_BLOQUE)[number]

const DestinoCTA = z.object({
  tipo: z.enum(['promocion', 'empresa', 'plan', 'excursion']),
  id: z.string().min(1).max(64),
})

export const HeroSlide = z.object({
  titulo: z.string().trim().min(1).max(80),
  subtitulo: z.string().trim().max(140).default(''),
  empresaId: z.string().min(1).max(64),
  /** NULL = se usa la imagen de la entidad destino. URL manual debe ser del storage de la empresa. */
  imagenUrl: z.string().trim().max(500).nullable().default(null),
  ctaTexto: z.string().trim().min(1).max(40),
  ctaDestino: DestinoCTA,
})

export type HeroSlide = z.infer<typeof HeroSlide>

const BloqueInput = z.object({
  tipo: z.enum(TIPOS_BLOQUE),
  activo: z.boolean().default(true),
  titulo: z.string().trim().max(80).nullable().default(null),
  /** CABECERA lleva la segmentación; HERO lleva { slides }. */
  config: z.record(z.string(), z.unknown()).default({}),
})

export const Segmentacion = z.object({
  membresia: z.enum(['SIN_PLAN', 'CUALQUIERA']).default('CUALQUIERA'),
  radioKm: z.number().min(1).max(100).default(15),
  hasta: z.string().datetime({ offset: true }).nullable().default(null),
})

export type Segmentacion = z.infer<typeof Segmentacion>

export const ComposicionInput = z
  .object({
    territorio: z.string().trim().min(1).max(80),
    // El tope es el número de tipos que existen, leído de la lista: escribirlo
    // a mano es cómo un bloque nuevo queda imposible de publicar y nadie
    // entiende por qué el formulario lo rechaza.
    bloques: z.array(BloqueInput).min(1).max(TIPOS_BLOQUE.length),
    segmentacion: Segmentacion.default({ membresia: 'CUALQUIERA', radioKm: 15, hasta: null }),
  })
  .superRefine((v, ctx) => {
    const tipos = v.bloques.map((b) => b.tipo)
    if (new Set(tipos).size !== tipos.length) {
      ctx.addIssue({ code: 'custom', message: 'Cada bloque aparece una sola vez.' })
    }
    if (tipos[0] !== 'CABECERA') {
      ctx.addIssue({ code: 'custom', message: 'El primer bloque es la cabecera del sistema.' })
    }
    const hero = v.bloques.find((b) => b.tipo === 'HERO')
    const slides = (hero?.config as { slides?: unknown })?.slides ?? []
    const parsed = z.array(HeroSlide).min(1).max(3).safeParse(slides)
    if (!parsed.success) {
      ctx.addIssue({ code: 'custom', message: 'El hero trae 1–3 diapositivas válidas.' })
    }
    if (v.segmentacion.hasta && new Date(v.segmentacion.hasta).getTime() <= Date.now()) {
      ctx.addIssue({ code: 'custom', message: 'La vigencia termina en el futuro.' })
    }
  })

export type ComposicionInput = z.infer<typeof ComposicionInput>
