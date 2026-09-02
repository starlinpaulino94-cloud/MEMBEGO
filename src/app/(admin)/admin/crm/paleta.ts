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
  nuevo: 'bg-info/10 text-info',
  contactado: 'bg-pending/15 text-pending',
  cotizacion: 'bg-warning/15 text-warning',
  negociacion: 'bg-primary/10 text-primary',
  cerrado: 'bg-success/10 text-success',
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

/** Prioridad del lead. Mismo criterio que el `Badge` de la ficha, que ya usaba
 *  `destructive` / `warning` / `success` para este mismo dato. */
export const PRIORIDAD_PUNTO = {
  alta: 'bg-destructive',
  media: 'bg-warning',
  baja: 'bg-success',
} as const

/**
 * Canales de conversación. No son los colores de marca de WhatsApp, Instagram
 * y Messenger: los iconos son genéricos de lucide, así que teñirlos de verde
 * de marca no aportaría reconocimiento, solo un color que no cambia con el
 * tema. Lo que hace falta aquí es distinguir tres canales entre sí.
 */
export const CANAL_TINTE = {
  whatsapp: { texto: 'text-success', fondo: 'bg-success/10' },
  instagram: { texto: 'text-primary', fondo: 'bg-primary/10' },
  messenger: { texto: 'text-info', fondo: 'bg-info/10' },
  email: { texto: 'text-muted-foreground', fondo: 'bg-muted' },
} as const

/** Tipo de actividad de seguimiento. WhatsApp comparte color con su canal. */
export const ACTIVIDAD_CHIP = {
  Llamada: 'bg-info/10 text-info',
  Email: 'bg-primary/10 text-primary',
  WhatsApp: 'bg-success/10 text-success',
  Visita: 'bg-warning/15 text-warning',
  Reunión: 'bg-pending/15 text-pending',
} as const
