/**
 * Paleta del CRM · sobre los tokens del sistema, no sobre la escala cruda.
 *
 * El esqueleto llegó con pares como `bg-blue-100 text-blue-800`. Esa escala no
 * cambia con el tema: en modo oscuro queda un rectángulo claro con texto oscuro
 * flotando sobre un lienzo negro. Los tokens de aquí sí cambian, y los cinco
 * que llevan texto (`info`, `pending`, `warning`, `primary`, `success`) están
 * verificados a AA como texto en los dos temas — ver el bloque de estados
 * semánticos en `globals.css`.
 *
 * Dos familias, y la diferencia importa:
 *
 *   · ETAPAS y TIPOS llevan texto encima → tokens semánticos.
 *   · Los PUNTOS de color son manchas sólidas → ahí sí entra la paleta de
 *     gráficos (`chart-1..6`), que es categórica y no está pensada para texto
 *     (`chart-5` es un azul oscuro: legible sobre blanco, ilegible sobre negro).
 *
 * Las clases se escriben enteras a propósito. Tailwind lee el código fuente
 * como texto: un `bg-${color}` armado en tiempo de ejecución no genera nada.
 */

/** El embudo, en orden. El recorrido se lee en el color: llega (info), se le
 *  contacta (pending), se cotiza (warning), se negocia (marca) y se cierra
 *  (success). */
export const ETAPA_CHIP = {
  // Legacy lowercase (configuración del pipeline)
  nuevo: 'bg-info-soft text-info-ink',
  contactado: 'bg-pending/15 text-pending',
  cotizacion: 'bg-warning-soft text-warning-ink',
  negociacion: 'bg-primary/10 text-primary',
  cerrado: 'bg-success-soft text-success-ink',
  // DB values (UPPERCASE — Lead.etapa)
  NUEVO: 'bg-info-soft text-info-ink',
  CONTACTADO: 'bg-pending/15 text-pending',
  INTERESADO: 'bg-warning-soft text-warning-ink',
  PROPUESTA: 'bg-primary/10 text-primary',
  NEGOCIACION: 'bg-primary/15 text-primary',
  GANADO: 'bg-success-soft text-success-ink',
  PERDIDO: 'bg-danger-soft text-danger-ink',
} as const

/** El mismo recorrido cuando solo es un punto (configuración del embudo). */
export const ETAPA_PUNTO = {
  nuevo: 'bg-info',
  contactado: 'bg-pending',
  cotizacion: 'bg-warning',
  negociacion: 'bg-primary',
  cerrado: 'bg-success',
} as const

/**
 * Colores para las etapas que el usuario cree él mismo. Ocho, no diez: las
 * cinco del embudo por defecto más tres de la paleta de gráficos. Se recorren
 * en ciclo, así que la longitud solo decide cada cuánto se repite un color.
 */
export const COLORES_ETAPA: readonly string[] = [
  ETAPA_PUNTO.nuevo,
  ETAPA_PUNTO.contactado,
  ETAPA_PUNTO.cotizacion,
  ETAPA_PUNTO.negociacion,
  ETAPA_PUNTO.cerrado,
  'bg-chart-2',
  'bg-chart-5',
  'bg-destructive',
]

export const PRIORIDAD_PUNTO = {
  alta: 'bg-destructive',
  media: 'bg-warning',
  baja: 'bg-success',
  ALTA: 'bg-destructive',
  MEDIA: 'bg-warning',
  BAJA: 'bg-success',
  URGENTE: 'bg-destructive',
} as const

/**
 * Canales de conversación. No son los colores de marca de WhatsApp, Instagram
 * y Messenger: los iconos son genéricos de lucide, así que teñirlos de verde
 * de marca no aportaría reconocimiento, solo un color que no cambia con el
 * tema. Lo que hace falta aquí es distinguir tres canales entre sí.
 */
export const CANAL_TINTE = {
  whatsapp: { texto: 'text-success', fondo: 'bg-success-soft' },
  instagram: { texto: 'text-primary', fondo: 'bg-primary/10' },
  messenger: { texto: 'text-info', fondo: 'bg-info-soft' },
  email: { texto: 'text-muted-foreground', fondo: 'bg-muted' },
} as const

/** Tipo de actividad de seguimiento. WhatsApp comparte color con su canal. */
export const ACTIVIDAD_CHIP = {
  Llamada: 'bg-info-soft text-info-ink',
  Email: 'bg-primary/10 text-primary',
  WhatsApp: 'bg-success-soft text-success-ink',
  Visita: 'bg-warning-soft text-warning-ink',
  Reunión: 'bg-pending/15 text-pending',
} as const
