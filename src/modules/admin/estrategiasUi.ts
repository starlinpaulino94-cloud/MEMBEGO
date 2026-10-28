import type { PlaybookCategory, PlaybookComplexity } from '@/lib/automation'

/**
 * Presentación de las Plantillas de automatización (playbooks): etiquetas legibles para las
 * categorías/complejidad/estado de los Automation Playbooks. Solo datos de UI;
 * la biblioteca vive en `@/lib/automation/playbooks`.
 */

export const CATEGORIA_LABELS: Record<PlaybookCategory, string> = {
  captacion: 'Captación',
  onboarding: 'Onboarding',
  primera_compra: 'Primera compra',
  frecuencia: 'Frecuencia',
  recuperacion: 'Recuperación',
  membresias: 'Membresías',
  referidos: 'Referidos',
  campanas: 'Campañas',
  gamificacion: 'Gamificación',
  decisiones: 'Inteligentes',
}

export const CATEGORIA_DESCRIPCION: Record<PlaybookCategory, string> = {
  captacion: 'Atrae nuevos clientes y convierte visitantes en registros.',
  onboarding: 'Convierte registros en clientes activos en sus primeros días.',
  primera_compra: 'Acompaña al cliente hasta su primera compra o visita.',
  frecuencia: 'Crea hábitos de consumo y aumenta el valor de cada cliente.',
  recuperacion: 'Detecta riesgo de abandono y recupera clientes inactivos.',
  membresias: 'Automatiza el ciclo de vida completo de las membresías.',
  referidos: 'Opera el programa de referidos de principio a fin.',
  campanas: 'Orquesta campañas que combinan varias estrategias a la vez.',
  gamificacion: 'Misiones, rachas, niveles y retos que cambian comportamientos.',
  decisiones: 'Recomendaciones y decisiones automáticas según tus datos.',
}

export const CATEGORIAS_ORDEN: PlaybookCategory[] = [
  'captacion', 'onboarding', 'primera_compra', 'frecuencia', 'recuperacion',
  'membresias', 'referidos', 'campanas', 'gamificacion', 'decisiones',
]

export const COMPLEJIDAD_LABELS: Record<PlaybookComplexity, string> = {
  basic: 'Básica',
  intermediate: 'Intermedia',
  advanced: 'Avanzada',
}

export const ESTADO_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  PUBLISHED: 'Activa',
  PAUSED: 'Pausada',
  ARCHIVED: 'Archivada',
}

/** Clases de badge por estado de la automatización instalada. */
export const ESTADO_BADGE: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  PUBLISHED: 'bg-success-soft text-success-ink',
  PAUSED: 'bg-warning-soft text-warning-foreground',
  ARCHIVED: 'bg-muted text-muted-foreground/60',
}
