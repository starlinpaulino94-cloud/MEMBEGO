'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'

export interface EmpresaActivaState {
  error?: string
  success?: boolean
}

/**
 * Cambia la empresa ACTIVA de un usuario de staff con acceso multi-empresa.
 * Solo permite cambiar a empresas a las que el usuario tiene acceso
 * (UserCompanyAccess o su empresa actual); el superadmin puede cualquiera.
 * Actualiza User.companyId y el app_metadata de la sesión: el resto del
 * panel ya filtra todo por ese companyId, así que no hay más cambios.
 */
export async function cambiarEmpresaActiva(
  companyId: string
): Promise<EmpresaActivaState> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }

  const target = String(companyId ?? '').trim()
  if (!target) return { error: 'Empresa requerida.' }

  const company = await sinEmpresa('empresa por id al cambiar la activa', (tx) =>
    tx.company.findUnique({
      where: { id: target },
      select: { id: true },
    })
  )
  if (!company) return { error: 'Empresa no encontrada.' }

  if (user.metadata.role !== 'SUPERADMIN') {
    const tieneAcceso =
      user.metadata.companyId === target ||
      (await sinEmpresa('acceso multi-empresa del usuario', (tx) =>
        tx.userCompanyAccess
          .findUnique({
            where: {
              userId_companyId: { userId: user.metadata.dbUserId, companyId: target },
            },
            select: { id: true },
          })
          .then((r) => !!r)
          .catch(() => false)
      ))
    if (!tieneAcceso) return { error: 'No tienes acceso a esa empresa.' }
  }

  try {
    await sinEmpresa('actualizar empresa activa del usuario', (tx) =>
      tx.user.update({
        where: { id: user.metadata.dbUserId },
        data: { companyId: target },
      })
    )

    const admin = createAdminClient()
    const { error: authError } = await admin.auth.admin.updateUserById(
      user.supabaseId,
      {
        app_metadata: {
          role: user.metadata.role,
          dbUserId: user.metadata.dbUserId,
          ...(user.metadata.clienteId ? { clienteId: user.metadata.clienteId } : {}),
          companyId: target,
        },
      }
    )
    if (authError) {
      console.error('[empresa-activa] auth sync error:', authError)
      return { error: 'No se pudo cambiar de empresa. Intenta de nuevo.' }
    }

    revalidatePath('/admin', 'layout')
    return { success: true }
  } catch (e) {
    console.error('[empresa-activa] error:', e)
    return { error: 'No se pudo cambiar de empresa. Intenta de nuevo.' }
  }
}
