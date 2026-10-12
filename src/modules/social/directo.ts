import { revalidatePath } from 'next/cache'
import { conEmpresa } from '@/lib/tenant'

/**
 * Seguir y favoritas con el `userId` EXPLÍCITO. Viven aparte, en un archivo SIN `'use server'`, a propósito: una función
 * exportada desde un archivo `'use server'` es un endpoint que cualquier navegador puede invocar, y estas dos reciben a
 * QUIÉN seguir como argumento. Las llaman las acciones de `actions.ts` (con el usuario de la sesión) y el BFF de la app
 * del cliente (con el usuario de su token).
 */

export interface SocialResult {
  error?: string
  following?: boolean
  esFavorita?: boolean
  guardada?: boolean
}

/** Seguir / dejar de seguir una empresa con userId explícito (BFF y actions). */
export async function toggleSeguirEmpresaDirecto(
  userId: string,
  companyId: string
): Promise<SocialResult> {
  try {
    return await conEmpresa(companyId, async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: { isActive: true, isPublished: true, esDemo: true },
      })
      if (!company || !company.isActive || !company.isPublished) {
        return { error: 'Empresa no disponible.' }
      }
      if (company.esDemo) return { error: 'Empresa no disponible.' }

      const existing = await tx.companyFollow.findUnique({
        where: { userId_companyId: { userId, companyId } },
        select: { id: true },
      })

      let following: boolean
      if (existing) {
        await tx.companyFollow.delete({ where: { id: existing.id } })
        following = false
      } else {
        await tx.companyFollow.create({ data: { userId, companyId } })
        following = true
      }

      return { following }
    }).then((result) => {
      if (!result.error) {
        try {
          revalidatePath('/cliente/empresas')
          revalidatePath('/cliente/explorar')
          revalidatePath('/mis-membresias')
          revalidatePath('/cliente/ayuda')
        } catch {}
      }
      return result
    })
  } catch (e) {
    console.error('[social] toggleSeguirEmpresaDirecto', e)
    return { error: 'No se pudo completar. Intenta de nuevo.' }
  }
}

/** Marcar / desmarcar una empresa seguida como favorita con userId explícito. */
export async function toggleFavoritaEmpresaDirecto(
  userId: string,
  companyId: string
): Promise<SocialResult> {
  try {
    return await conEmpresa(companyId, async (tx) => {
      const follow = await tx.companyFollow.findUnique({
        where: { userId_companyId: { userId, companyId } },
        select: { id: true, esFavorita: true },
      })
      if (!follow) {
        // Marcar favorita implica seguir.
        await tx.companyFollow.create({
          data: { userId, companyId, esFavorita: true },
        })
        try {
          revalidatePath('/cliente/empresas')
        } catch {}
        return { following: true, esFavorita: true }
      }

      const updated = await tx.companyFollow.update({
        where: { id: follow.id },
        data: { esFavorita: !follow.esFavorita },
        select: { esFavorita: true },
      })
      try {
        revalidatePath('/cliente/empresas')
      } catch {}
      return { following: true, esFavorita: updated.esFavorita }
    })
  } catch (e) {
    console.error('[social] toggleFavoritaEmpresaDirecto', e)
    return { error: 'No se pudo completar. Intenta de nuevo.' }
  }
}
