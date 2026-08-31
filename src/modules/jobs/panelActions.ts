'use server'

import { revalidatePath } from 'next/cache'
import { getUser } from '@/lib/auth'
import {
  auditarCola,
  descartarTrabajoMuerto,
  reencolarTrabajoMuerto,
} from '@/modules/jobs/muertos'

/**
 * Acciones del superadmin sobre los trabajos difuntos de la cola.
 *
 * Solo SUPERADMIN, con guard NO-redirect DENTRO de la acción (una server
 * action se despacha por su id desde cualquier path; el middleware no la
 * protege). Mismo contrato que las acciones del panel de integraciones.
 *
 * Reencolar no es inocuo: re-ejecuta un trabajo con efectos reales
 * (notificaciones a miles de personas, correos). Por eso ambas decisiones
 * quedan en la bitácora de auditoría con quién y cuándo.
 */

async function superadmin(): Promise<{ dbUserId: string | null } | null> {
  const user = await getUser()
  if (user?.metadata.role !== 'SUPERADMIN') return null
  return { dbUserId: user.metadata.dbUserId ?? null }
}

export interface DifuntoState {
  error?: string
  /** El mensaje de éxito. `success` es el nombre que BotonConfirmado espera. */
  success?: string
}

export async function reencolarMuertoAction(
  _prev: DifuntoState,
  formData: FormData
): Promise<DifuntoState> {
  const quien = await superadmin()
  if (!quien) return { error: 'No autorizado.' }
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Falta el trabajo.' }

  const res = await reencolarTrabajoMuerto(id)
  if (!res.ok) {
    return {
      error:
        res.motivo === 'no_existe'
          ? 'Ese trabajo ya no existe.'
          : 'Ese trabajo ya fue reencolado o descartado.',
    }
  }

  await auditarCola('COLA_REENCOLADA', id, quien.dbUserId, { via: res.via })
  revalidatePath('/superadmin/integraciones')
  return {
    success:
      res.via === 'cola'
        ? 'Devuelto a la cola: QStash lo ejecutará en segundos.'
        : 'Ejecutado en línea (la cola no está configurada en este entorno).',
  }
}

export async function descartarMuertoAction(
  _prev: DifuntoState,
  formData: FormData
): Promise<DifuntoState> {
  const quien = await superadmin()
  if (!quien) return { error: 'No autorizado.' }
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Falta el trabajo.' }

  const res = await descartarTrabajoMuerto(id)
  if (!res.ok) return { error: 'Ese trabajo ya fue reencolado o descartado.' }

  await auditarCola('COLA_DESCARTADA', id, quien.dbUserId, {})
  revalidatePath('/superadmin/integraciones')
  return { success: 'Descartado. No se volverá a ejecutar.' }
}
