import { z } from 'zod'
import {
  COLORES_PANEL,
  COLOR_PANEL_POR_DEFECTO,
  FORMATOS_BANNER,
  FORMATO_BANNER_POR_DEFECTO,
  formatoRequiereTexto,
} from './banner-formatos'

/**
 * Los 7 bloques del feed, en orden canónico (contrato Stitch A05).
 *
 * Las categorías van ANTES del hero: son la puerta de entrada al catálogo y
 * el hero es una tarjeta alta que empuja todo lo demás fuera de pantalla.
 */
export const TIPOS_BLOQUE = [
  'CABECERA',
  'CATEGORIAS',
  'HERO',
  'DESTACADAS',
  'MEMBRESIAS',
  'BANNER_QR',
  'EXPERIENCIAS',
] as const

export type TipoBloque = (typeof TIPOS_BLOQUE)[number]

const DestinoCTA = z.object({
  tipo: z.enum(['promocion', 'empresa', 'plan', 'excursion']),
  id: z.string().min(1).max(64),
})

export const HeroSlide = z
  .object({
    /** Obligatorio salvo con «Solo imagen», donde la imagen trae el texto (ver el refine). */
    titulo: z.string().trim().max(80).default(''),
    subtitulo: z.string().trim().max(140).default(''),
    empresaId: z.string().min(1).max(64),
    /** NULL = se usa la imagen de la entidad destino. URL manual debe ser del storage de la empresa. */
    imagenUrl: z.string().trim().max(500).nullable().default(null),
    ctaTexto: z.string().trim().min(1).max(40),
    ctaDestino: DestinoCTA,
    /** Cómo va el texto sobre la imagen (ver `banner-formatos.ts`). Lo guardado sin formato era texto encima. */
    formato: z.enum(FORMATOS_BANNER).default(FORMATO_BANNER_POR_DEFECTO),
    /** Solo «Titular arriba»: el color del panel donde va el titular. */
    colorPanel: z.enum(COLORES_PANEL).default(COLOR_PANEL_POR_DEFECTO),
    /** Bajo la tarjeta: negocio y botón. No aplica a «Texto encima», que ya los lleva dentro. */
    mostrarPie: z.boolean().default(true),
  })
  .superRefine((slide, ctx) => {
    if (formatoRequiereTexto(slide.formato) && slide.titulo.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['titulo'], message: 'El titular es obligatorio salvo con «Solo imagen».' })
    }
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
    bloques: z.array(BloqueInput).min(1).max(7),
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
