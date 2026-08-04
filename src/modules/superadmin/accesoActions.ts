'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUser } from '@/lib/auth'
import { getAppUrl } from '@/lib/site'
import { sinEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'

/**
 * ACCESOS DEL SUPERADMIN: promover/quitar superadmins y "entrar como"
 * cualquier usuario (cliente, staff u otro superadmin) mediante un enlace
 * mágico de un solo uso. Ambas operaciones quedan en la bitácora.
 */

export interface AccesoState {
  error?: string
  success?: boolean
  /** Enlace de acceso generado por "entrar como". */
  url?: string
  /** A quién pertenece el enlace (para mostrarlo en la UI). */
  destinatario?: string
}

async function sesionSuperadmin() {
  const session = await getUser()
  if (!session || session.metadata.role !== 'SUPERADMIN') return null
  return session
}

/**
 * Hace superadmin a un usuario de staff, o le quita el rango (vuelve a
 * ADMINISTRADOR de su empresa). Nunca sobre uno mismo: así no puedes
 * quedarte fuera de tu propia plataforma por accidente.
 */
export async function alternarSuperadmin(
  _prev: AccesoState,
  formData: FormData
): Promise<AccesoState> {
  const session = await sesionSuperadmin()
  if (!session) return { error: 'No autorizado.' }

  const userId = String(formData.get('userId') ?? '').trim()
  if (!userId) return { error: 'Usuario no especificado.' }
  if (userId === session.metadata.dbUserId) {
    return { error: 'No puedes cambiar tu propio rol.' }
  }

  const target = await sinEmpresa('superadmin: buscar usuario por id', (tx) =>
    tx.user.findUnique({ where: { id: userId } })
  )
  if (!target) return { error: 'Usuario no encontrado.' }
  if (target.role === 'CLIENTE') {
    return { error: 'Una cuenta de cliente no puede ser superadmin. Crea una cuenta de staff.' }
  }

  const promover = target.role !== 'SUPERADMIN'
  if (!promover && !target.companyId) {
    return {
      error:
        'Este superadmin no tiene empresa asignada; al quitarle el rango quedaría sin panel. Asígnale una empresa primero.',
    }
  }
  const nuevoRol = promover ? 'SUPERADMIN' : 'ADMINISTRADOR'

  try {
    await sinEmpresa('superadmin: cambiar rol del usuario', (tx) =>
      tx.user.update({ where: { id: userId }, data: { role: nuevoRol } })
    )

    const admin = createAdminClient()
    const { error: authError } = await admin.auth.admin.updateUserById(target.supabaseId, {
      app_metadata: {
        role: nuevoRol,
        dbUserId: target.id,
        companyId: target.companyId ?? null,
      },
    })
    if (authError) {
      console.error('[superadmin-acceso] sync auth:', authError)
      return { error: 'Se guardó el rol, pero la sesión del usuario no sincronizó. Reintenta.' }
    }

    await sinEmpresa('superadmin: bitácora de cambio de rol', (tx) =>
      tx.auditLog
        .create({
          data: {
            companyId: target.companyId ?? null,
            userId: session.metadata.dbUserId || null,
            accion: promover ? 'SUPERADMIN_OTORGADO' : 'SUPERADMIN_RETIRADO',
            entidadTipo: 'User',
            entidadId: target.id,
            payload: { email: target.email, por: session.email },
          },
        })
        .catch(anotarFallo('superadmin:acceso:auditoria'))
    )

    revalidatePath('/superadmin/usuarios')
    return { success: true }
  } catch (e) {
    console.error('[superadmin-acceso] alternar:', e)
    return { error: 'No se pudo cambiar el rol. Intenta de nuevo.' }
  }
}

/**
 * ENTRAR COMO: genera un enlace de acceso de UN SOLO USO para el usuario del
 * email indicado (cliente, staff o superadmin). Quien abra el enlace queda con
 * la sesión de ESE usuario — ábrelo en una ventana de incógnito para no
 * reemplazar la tuya. El enlace expira solo y queda registrado en la bitácora.
 */
export async function generarEnlaceEntrarComo(
  _prev: AccesoState,
  formData: FormData
): Promise<AccesoState> {
  const session = await sesionSuperadmin()
  if (!session) return { error: 'No autorizado.' }

  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  if (!email || !email.includes('@')) return { error: 'Escribe el email del usuario.' }

  const target = await sinEmpresa('superadmin: buscar usuario por email', (tx) =>
    tx.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, role: true, companyId: true },
    })
  )
  if (!target) return { error: 'No existe ningún usuario con ese email.' }

  try {
    const admin = createAdminClient()
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: target.email,
    })
    const tokenHash = data?.properties?.hashed_token
    if (error || !tokenHash) {
      console.error('[superadmin-acceso] generateLink:', error)
      return { error: 'No se pudo generar el enlace. Intenta de nuevo.' }
    }

    // Mismo callback que la verificación de correo: abre la sesión y lleva al
    // home del ROL del usuario (cliente → su app, admin → su panel).
    const url = `${getAppUrl()}/confirmar?token_hash=${encodeURIComponent(tokenHash)}&type=magiclink`

    await sinEmpresa('superadmin: bitácora de entrar como', (tx) =>
      tx.auditLog
        .create({
          data: {
            companyId: target.companyId ?? null,
            userId: session.metadata.dbUserId || null,
            accion: 'ENTRAR_COMO_GENERADO',
            entidadTipo: 'User',
            entidadId: target.id,
            payload: { email: target.email, por: session.email },
          },
        })
        .catch(anotarFallo('superadmin:entrarComo:auditoria'))
    )

    return { success: true, url, destinatario: `${target.name} (${target.email})` }
  } catch (e) {
    console.error('[superadmin-acceso] entrar como:', e)
    return { error: 'No se pudo generar el enlace. Intenta de nuevo.' }
  }
}
