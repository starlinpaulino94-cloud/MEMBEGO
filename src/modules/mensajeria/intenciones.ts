/**
 * INTENCIONES DE NEGOCIO sobre un texto entrante (portado de
 * `connect/whatsappInboundNucleo.ts`, que se eliminó en la reconciliación).
 *
 * Reglas puras: sin Prisma ni red, solo string matching. Simple y testeable.
 */

const PALABRAS_EXCURSION = [
  'excursion',
  'excursión',
  'excursiones',
  'tour',
  'tours',
  'actividad',
  'actividades',
  'parque',
  'parques',
  'reserva',
  'reservar',
  'catálogo',
  'catalogo',
  'combo',
  'combos',
] as const

/**
 * Detecta si un mensaje de texto contiene intención de consultar excursiones.
 *
 * Busca palabras clave case-insensitive en el texto normalizado (NFD, sin
 * acentos): "¿Tienen tours?" y "quiero reservar" matchean igual.
 */
export function detectarIntencionExcursiones(texto: string): boolean {
  const normalizado = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  return PALABRAS_EXCURSION.some((p) => normalizado.includes(p))
}
