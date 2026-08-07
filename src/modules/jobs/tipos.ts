import type { NotifTipo } from '@prisma/client'

/**
 * CATÁLOGO DE TRABAJOS EN SEGUNDO PLANO (auditoría · C-06 y C-07).
 *
 * Un trabajo es una unidad ACOTADA: un lote de notificaciones, una empresa del
 * cron. Nunca "todo". Esa es la diferencia con lo que había antes, donde una
 * sola petición intentaba insertar 100.000 filas o recorrer mil empresas dentro
 * del presupuesto de una función serverless.
 *
 * Tipos aparte del ejecutor para que el emisor (una server action) pueda
 * importarlos sin arrastrar Prisma ni el motor de automatizaciones.
 */

/** Cuántos destinatarios entran en un lote de notificaciones. */
export const TAMANO_LOTE_NOTIF = 1000

export interface CargaNotificar {
  tipo: 'notificar'
  companyId: string
  /** A quién: todos los clientes de la empresa o solo sus seguidores. */
  audiencia: 'clientes' | 'seguidores'
  payload: { tipo: NotifTipo; titulo: string; mensaje: string; href?: string }
  /**
   * Desplazamiento del lote. El trabajo procesa `TAMANO_LOTE_NOTIF`
   * destinatarios desde aquí y, si quedan más, se encola a sí mismo con el
   * siguiente desplazamiento. Encadenar en vez de encolar todos los lotes de
   * golpe evita que un envío a 100.000 personas produzca cien mensajes en la
   * cola antes de saber si el primero funcionó.
   */
  desde: number
}

export interface CargaAutomatizaciones {
  tipo: 'automatizaciones'
  /** Una empresa por trabajo. El cron solo reparte. */
  companyId: string
}

/**
 * Correo transaccional (Resend) fuera del request. Fase 4 · Componente 5.
 * El payload lleva el correo YA armado: el emisor conoce el HTML (recibos,
 * invitaciones) y el worker solo lo entrega vía `sendEmail`, que conserva el
 * bloqueo de empresas demo y la degradación sin RESEND_API_KEY.
 */
export interface CargaEmail {
  tipo: 'email'
  to: string
  subject: string
  html?: string
  text?: string
  companyId?: string | null
}

/**
 * Evento del bus de estrategias pendiente de despachar. Fase 4 · Componente 5.
 * Se persiste el evento (processed=false) y se encola su id: el worker hace el
 * flip atómico y despacha. El índice [companyId, type, processed] de
 * automation_events es el que permite barrer los estancados desde el cron.
 */
export interface CargaEvento {
  tipo: 'evento-estrategia'
  eventoId: string
  /** Empresa del evento (para la observabilidad del trabajo). */
  companyId: string
}

/**
 * Cálculo y asignación de recompensas de referido. Fase 4 · Componente 5.
 * `procesarReferidoCompletado` deja la transición COMPLETADO (fuente de
 * verdad) en línea y mueve aquí el loop pesado de reglas. El referidoId hace
 * que cada conversión tenga su propio trabajo (dos conversiones del mismo
 * referente no se colapsan en la deduplicación).
 */
export interface CargaRecompensas {
  tipo: 'recompensas-referido'
  companyId: string
  referenteClienteId: string
  referidoId: string
}

/**
 * Lote del fan-out de una campaña dirigida (docs/GEOLOCALIZACION.md §28).
 * Un trabajo por lote; si el lote quedó lleno, el worker se encadena a sí
 * mismo con el siguiente desplazamiento (mismo patrón que `notificar`).
 */
export interface CargaCampanaDirigida {
  tipo: 'campana-dirigida'
  companyId: string
  campanaId: string
  /** Desplazamiento del lote sobre el orden estable por `id`. */
  desde: number
}

export type CargaTrabajo =
  | CargaNotificar
  | CargaAutomatizaciones
  | CargaEmail
  | CargaEvento
  | CargaRecompensas
  | CargaCampanaDirigida

/** Tipos aceptados por el endpoint `/api/jobs` (cada caso del ejecutor). */
export const TIPOS_TRABAJO = [
  'notificar',
  'automatizaciones',
  'email',
  'evento-estrategia',
  'recompensas-referido',
  'campana-dirigida',
] as const

/** Ruta del endpoint que ejecuta los trabajos. */
export const RUTA_TRABAJOS = '/api/jobs'
