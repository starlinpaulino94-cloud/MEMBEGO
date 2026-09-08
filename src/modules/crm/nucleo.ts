/**
 * CRM · reglas puras (Meta · Fase 6). Sin base y sin red.
 *
 * El embudo es fijo por ahora y va en el color de la paleta del CRM: llega
 * (nuevo), se le contacta, se cotiza, se negocia y se cierra, o se pierde.
 */

export const ETAPAS = ['nuevo', 'contactado', 'cotizacion', 'negociacion', 'cerrado', 'perdido'] as const
export type Etapa = (typeof ETAPAS)[number]

export const ETIQUETA_ETAPA: Record<Etapa, string> = {
  nuevo: 'Nuevo',
  contactado: 'Contactado',
  cotizacion: 'Cotización',
  negociacion: 'Negociación',
  cerrado: 'Cerrado',
  perdido: 'Perdido',
}

/** Las que siguen en juego. Un prospecto cerrado o perdido ya no se trabaja. */
export const ETAPAS_ABIERTAS: readonly Etapa[] = ['nuevo', 'contactado', 'cotizacion', 'negociacion']

export function esEtapa(v: unknown): v is Etapa {
  return typeof v === 'string' && (ETAPAS as readonly string[]).includes(v)
}

export const TIPOS_SEGUIMIENTO = ['Llamada', 'Email', 'WhatsApp', 'Visita', 'Reunión'] as const
export type TipoSeguimiento = (typeof TIPOS_SEGUIMIENTO)[number]

export function esTipoSeguimiento(v: unknown): v is TipoSeguimiento {
  return typeof v === 'string' && (TIPOS_SEGUIMIENTO as readonly string[]).includes(v)
}

/**
 * ¿Nace un prospecto de este entrante? Solo si quien escribe todavía no es
 * cliente. Un cliente que pregunta algo por WhatsApp es un cliente, no una
 * oportunidad por trabajar.
 */
export function naceProspecto(contacto: { clienteId: string | null }): boolean {
  return !contacto.clienteId
}

export interface ParDeRespuesta {
  primerEntranteAt: Date
  primerSalienteAt: Date | null
}

/**
 * Mediana de minutos entre el primer mensaje del cliente y la primera
 * respuesta del negocio. Solo cuentan las conversaciones respondidas; la
 * mediana, y no la media, para que una conversación olvidada una semana no
 * arrastre el número.
 */
export function minutosMedianosDeRespuesta(pares: readonly ParDeRespuesta[]): number | null {
  const minutos = pares
    .filter((p): p is ParDeRespuesta & { primerSalienteAt: Date } => !!p.primerSalienteAt && p.primerSalienteAt >= p.primerEntranteAt)
    .map((p) => (p.primerSalienteAt.getTime() - p.primerEntranteAt.getTime()) / 60_000)
    .sort((a, b) => a - b)
  if (minutos.length === 0) return null
  const medio = Math.floor(minutos.length / 2)
  const mediana = minutos.length % 2 === 1 ? minutos[medio] : (minutos[medio - 1] + minutos[medio]) / 2
  return Math.round(mediana)
}

/** Porcentaje entero de cerrados sobre el total; null cuando no hay nada que medir. */
export function tasaDeConversion(cerrados: number, total: number): number | null {
  if (total <= 0) return null
  return Math.round((cerrados / total) * 100)
}

/** Primer ENTRANTE y primer SALIENTE posterior, por conversación, a partir de mensajes en orden. */
export function paresDeRespuesta(
  mensajes: readonly { conversacionId: string; direccion: string; timestamp: Date }[]
): ParDeRespuesta[] {
  const porConversacion = new Map<string, ParDeRespuesta>()
  for (const m of mensajes) {
    const actual = porConversacion.get(m.conversacionId)
    if (m.direccion === 'ENTRANTE') {
      if (!actual) porConversacion.set(m.conversacionId, { primerEntranteAt: m.timestamp, primerSalienteAt: null })
    } else if (actual && !actual.primerSalienteAt && m.timestamp >= actual.primerEntranteAt) {
      actual.primerSalienteAt = m.timestamp
    }
  }
  return [...porConversacion.values()]
}
