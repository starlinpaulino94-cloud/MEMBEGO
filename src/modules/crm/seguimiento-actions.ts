'use server'

import { revalidatePath } from 'next/cache'
import { requireSection } from '@/lib/auth/guards'
import { conEmpresa } from '@/lib/tenant'
import { createNota, deleteNota } from './nota-actions'
import type { NotaActionState } from './nota-actions'

// ── Actions ────────────────────────────────────────────────────────────────

/**
 * Crea una actividad reutilizando createNota y configurando el estado.
 */
export async function createActividad(
  _prev: NotaActionState,
  formData: FormData
): Promise<NotaActionState> {
  const result = await createNota({} as NotaActionState, formData)
  if (!result.notaId) return result

  const user = await requireSection('leads')
  if (user?.metadata.companyId && result.notaId) {
    const estado = String(formData.get('estado') ?? 'PENDIENTE')
    if (estado !== 'PENDIENTE') {
      await conEmpresa(user.metadata.companyId, (tx) =>
        tx.notaSeguimiento.update({
          where: { id: result.notaId },
          data: { estado },
        })
      ).catch(() => {})
    }
  }

  revalidatePath('/admin/crm/seguimientos')
  return result
}

/**
 * Actualiza el estado de una actividad (pendiente ↔ completada).
 */
export async function updateActividadEstado(
  _prev: NotaActionState,
  formData: FormData
): Promise<NotaActionState> {
  const user = await requireSection('leads')
  if (!user) return { error: 'No autorizado.' }

  const companyId = user.metadata.companyId
  if (!companyId) return { error: 'Empresa no especificada.' }

  const notaId = String(formData.get('notaId') ?? '').trim()
  const nuevoEstado = String(formData.get('estado') ?? '').trim()

  if (!notaId) return { error: 'Nota no especificada.' }
  if (!nuevoEstado) return { error: 'Estado no especificado.' }

  try {
    await conEmpresa(companyId, (tx) =>
      tx.notaSeguimiento.update({
        where: { id: notaId },
        data: { estado: nuevoEstado },
      })
    )

    revalidatePath('/admin/crm/seguimientos')
    return { success: true, notaId }
  } catch (e) {
    console.error('[crm] updateActividadEstado', e)
    return { error: 'Error al actualizar estado.' }
  }
}

/**
 * Elimina una actividad reutilizando deleteNota.
 */
export async function deleteActividad(
  _prev: NotaActionState,
  formData: FormData
): Promise<NotaActionState> {
  const result = await deleteNota({} as NotaActionState, formData)
  if (result.success) {
    revalidatePath('/admin/crm/seguimientos')
  }
  return result
}
