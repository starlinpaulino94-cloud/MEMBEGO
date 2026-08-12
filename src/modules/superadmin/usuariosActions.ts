'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUser } from '@/lib/auth'
import { sinEmpresa } from '@/lib/tenant'
import { INVITABLE_ROLES, type AppRole } from '@/types'

export interface UsuarioStaffState {
  error?: string
  success?: boolean
}

/**
 * Edición de un usuario por el SUPERADMIN: nombre, rol, empresas a las que
 * tiene acceso (multi-empresa), empresa activa y contraseña opcional.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ SE PROTEGE AQUÍ, Y QUÉ NO.
 *
 * Antes se rechazaba a los superadmin de plano, y con eso se protegía su nombre
 * —que no hacía falta proteger— al precio de tener que entrar en la base de
 * datos para corregir una letra. Lo que de verdad no puede pasar por este
 * formulario es el RANGO: darse superadmin desde aquí sería saltarse la
 * confirmación de `alternarSuperadmin` y su regla de no tocarse a uno mismo.
 *
 * Así que el rol de un superadmin no se lee del formulario: se le conserva. Lo
 * que llegue en ese campo se ignora, venga de la pantalla o de otra pestaña.
 *
 * Los CLIENTES siguen fuera: su ficha es otra cosa y vive en el panel de la
 * empresa.
 */
export async function actualizarUsuarioStaff(
  _prev: UsuarioStaffState,
  formData: FormData
): Promise<UsuarioStaffState> {
  const session = await getUser()
  if (!session || session.metadata.role !== 'SUPERADMIN') {
    return { error: 'No autorizado.' }
  }

  const userId = String(formData.get('userId') ?? '').trim()
  const nombre = String(formData.get('nombre') ?? '').trim()
  const rolEnviado = String(formData.get('role') ?? '').trim() as AppRole
  const companyIds = formData.getAll('companyIds').map(String).filter(Boolean)
  const empresaActiva = String(formData.get('empresaActiva') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  if (!userId || !nombre) return { error: 'Nombre requerido.' }
  if (password && password.length < 6) {
    return { error: 'La contraseña debe tener al menos 6 caracteres.' }
  }

  const target = await sinEmpresa('superadmin: buscar usuario de staff por id', (tx) =>
    tx.user.findUnique({ where: { id: userId } })
  )
  if (!target) return { error: 'Usuario no encontrado.' }
  if (target.role === 'CLIENTE') {
    return { error: 'Este usuario no se puede editar desde aquí.' }
  }

  const esSuperadmin = target.role === 'SUPERADMIN'

  // El rango se conserva; no se acepta del formulario ni para subirlo ni para
  // bajarlo. Para el resto, el rol tiene que ser uno de los asignables.
  const role: AppRole = esSuperadmin ? 'SUPERADMIN' : rolEnviado
  if (!esSuperadmin && !INVITABLE_ROLES.includes(role)) return { error: 'Rol inválido.' }

  /**
   * Un superadmin PUEDE no tener empresa —ve toda la plataforma—, y de hecho
   * `alternarSuperadmin` se niega a degradar a uno que no la tenga porque
   * quedaría sin panel. Para el staff sigue siendo obligatoria: un
   * administrador sin empresa no tiene a dónde entrar.
   */
  if (!esSuperadmin && companyIds.length === 0) {
    return { error: 'Asigna al menos una empresa.' }
  }
  if (empresaActiva && !companyIds.includes(empresaActiva)) {
    return { error: 'La empresa activa debe estar entre las asignadas.' }
  }
  if (!esSuperadmin && !empresaActiva) {
    return { error: 'Elige la empresa activa.' }
  }

  // Todas las empresas asignadas deben existir.
  const existentes = await sinEmpresa('superadmin: verificar empresas asignadas', (tx) =>
    tx.company.count({
      where: { id: { in: companyIds } },
    })
  )
  if (existentes !== companyIds.length) {
    return { error: 'Alguna de las empresas seleccionadas no existe.' }
  }

  try {
    await sinEmpresa('superadmin: actualizar usuario y accesos multi-empresa', async (tx) => {
      await Promise.all([
        tx.user.update({
          where: { id: userId },
          data: { name: nombre, role, companyId: empresaActiva || null },
        }),
        // Set completo de accesos: se reemplaza por lo marcado en el formulario.
        tx.userCompanyAccess.deleteMany({ where: { userId } }),
        tx.userCompanyAccess.createMany({
          data: companyIds.map((companyId) => ({ userId, companyId })),
          skipDuplicates: true,
        }),
      ])
    })

    // Sincroniza Supabase Auth: rol/empresa activa en app_metadata, nombre y
    // contraseña (solo si se escribió una nueva).
    const admin = createAdminClient()
    const { error: authError } = await admin.auth.admin.updateUserById(
      target.supabaseId,
      {
        app_metadata: {
          role,
          dbUserId: target.id,
          companyId: empresaActiva || null,
        },
        user_metadata: { name: nombre },
        ...(password ? { password } : {}),
      }
    )
    if (authError) {
      console.error('[superadmin-usuarios] auth sync error:', authError)
      return {
        error:
          'Los datos se guardaron, pero no se pudo sincronizar la sesión del usuario. Intenta de nuevo.',
      }
    }

    revalidatePath('/superadmin/usuarios')
    return { success: true }
  } catch (e) {
    console.error('[superadmin-usuarios] actualizar error:', e)
    return { error: 'No se pudo guardar. Intenta de nuevo.' }
  }
}

