'use server'

/**
 * Dar y quitar acceso de un administrador EXISTENTE a una empresa.
 *
 * Fila a fila, no reemplazando el conjunto completo. La pantalla de usuarios
 * (`/superadmin/usuarios/[id]`) ya permite reasignar todas las empresas de una
 * persona de golpe; eso sirve para arreglar a alguien, pero es peligroso para
 * la operación normal: si se abre esa pantalla para sumar una empresa y se
 * guarda con una casilla desmarcada por accidente, se le quita el acceso a un
 * negocio real. Aquí solo se toca la empresa que se está mirando.
 */

import { revalidatePath } from 'next/cache'
import { getUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { sinEmpresa } from '@/lib/tenant'
import { filasDeAcceso } from '@/modules/empresas/accesos'

export interface AccesoState {
  error?: string
  success?: boolean
  mensaje?: string
}

async function requireSuperadmin() {
  const user = await getUser()
  if (!user || user.metadata.role !== 'SUPERADMIN') return null
  return user
}

/**
 * Le da acceso a una empresa a un administrador que ya existe.
 *
 * NO le cambia la empresa activa: sigue en su negocio de siempre y entra a la
 * nueva cuando quiere, con el selector de arriba del panel. Cambiársela por
 * detrás sería meterlo en otra empresa sin avisarle.
 */
export async function darAccesoAEmpresa(
  _prev: AccesoState,
  formData: FormData
): Promise<AccesoState> {
  try {
    const admin = await requireSuperadmin()
    if (!admin) return { error: 'No autorizado.' }

    const companyId = String(formData.get('companyId') ?? '').trim()
    const userId = String(formData.get('userId') ?? '').trim()
    if (!companyId || !userId) return { error: 'Falta la empresa o la persona.' }

    const [empresa, persona] = await sinEmpresa(
      'superadmin: validar empresa y usuario para dar acceso',
      (tx) =>
        Promise.all([
          tx.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } }),
          tx.user.findUnique({
            where: { id: userId },
            select: { id: true, name: true, role: true, companyId: true },
          }),
        ])
    )
    if (!empresa) return { error: 'Empresa no encontrada.' }
    if (!persona) return { error: 'Usuario no encontrado.' }
    if (persona.role === 'CLIENTE') {
      return { error: 'Esa cuenta es de cliente, no puede administrar una empresa.' }
    }
    if (persona.role === 'SUPERADMIN') {
      return { error: 'El superadmin ya entra a todas las empresas; no necesita acceso.' }
    }

    // Se escribe también la fila de su empresa de siempre: ver el comentario
    // largo en `filasDeAcceso`. Sin eso, al cambiar de empresa pierde el
    // camino de vuelta.
    await sinEmpresa('superadmin: crear filas de acceso', (tx) =>
      tx.userCompanyAccess.createMany({
        data: filasDeAcceso(persona.id, companyId, persona.companyId),
        skipDuplicates: true,
      })
    )

    revalidatePath('/superadmin/demo')
    revalidatePath('/superadmin/empresas')
    revalidatePath('/superadmin/usuarios')
    return {
      success: true,
      mensaje: `${persona.name} ya puede entrar a "${empresa.name}" desde el selector de empresas de su panel.`,
    }
  } catch (e) {
    console.error('[accesos] darAccesoAEmpresa:', e)
    return { error: 'No se pudo dar el acceso. Intenta de nuevo.' }
  }
}

/**
 * Quita el acceso.
 *
 * EL CASO QUE HAY QUE CUIDAR: que esa empresa sea justo la que la persona
 * tiene abierta ahora mismo. Borrar la fila y ya la dejaría dentro de una
 * empresa a la que ya no tiene acceso, y sin forma de salir — el selector se
 * arma con lo que puede ver. Por eso, si es su empresa activa, primero se le
 * devuelve a otra de las suyas; y si no le queda ninguna, se rechaza en vez de
 * dejarla sin panel.
 */
export async function quitarAccesoAEmpresa(
  _prev: AccesoState,
  formData: FormData
): Promise<AccesoState> {
  try {
    const admin = await requireSuperadmin()
    if (!admin) return { error: 'No autorizado.' }

    const companyId = String(formData.get('companyId') ?? '').trim()
    const userId = String(formData.get('userId') ?? '').trim()
    if (!companyId || !userId) return { error: 'Falta la empresa o la persona.' }

    const persona = await sinEmpresa('superadmin: buscar usuario para quitar acceso', (tx) =>
      tx.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, role: true, companyId: true, supabaseId: true },
      })
    )
    if (!persona) return { error: 'Usuario no encontrado.' }

    if (persona.companyId === companyId) {
      const otra = await sinEmpresa('superadmin: buscar otra empresa de la persona', (tx) =>
        tx.userCompanyAccess.findFirst({
          where: { userId, companyId: { not: companyId } },
          select: { companyId: true },
        })
      )
      if (!otra) {
        return {
          error: `${persona.name} tiene esta empresa como su empresa activa y no le queda ninguna otra. Asígnale primero otra empresa desde Usuarios.`,
        }
      }
      await sinEmpresa('superadmin: mover empresa activa de la persona', (tx) =>
        tx.user.update({
          where: { id: userId },
          data: { companyId: otra.companyId },
        })
      )
      const sb = createAdminClient()
      const { error: authError } = await sb.auth.admin.updateUserById(persona.supabaseId, {
        app_metadata: {
          role: persona.role,
          dbUserId: persona.id,
          companyId: otra.companyId,
        },
      })
      if (authError) {
        console.error('[accesos] auth sync:', authError)
        return { error: 'No se pudo mover a la persona fuera de esta empresa. Intenta de nuevo.' }
      }
    }

    await sinEmpresa('superadmin: borrar fila de acceso', (tx) =>
      tx.userCompanyAccess.deleteMany({ where: { userId, companyId } })
    )

    revalidatePath('/superadmin/demo')
    revalidatePath('/superadmin/empresas')
    revalidatePath('/superadmin/usuarios')
    return { success: true, mensaje: `${persona.name} ya no puede entrar a esta empresa.` }
  } catch (e) {
    console.error('[accesos] quitarAccesoAEmpresa:', e)
    return { error: 'No se pudo quitar el acceso. Intenta de nuevo.' }
  }
}
