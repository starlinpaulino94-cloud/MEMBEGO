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

export type CargaTrabajo = CargaNotificar | CargaAutomatizaciones

/** Ruta del endpoint que ejecuta los trabajos. */
export const RUTA_TRABAJOS = '/api/jobs'
