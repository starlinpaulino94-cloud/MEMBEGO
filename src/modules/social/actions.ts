'use server'

import { revalidatePath } from 'next/cache'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'

// ─── FASE 3: capa social — acciones de seguir/favorita/guardar ──────────────

export interface EstadoSeguimiento {
  authenticated: boolean
  following: boolean
  esFavorita: boolean
}

/**
 * Estado de seguimiento del usuario actual sobre una empresa. Se consulta
 * desde el cliente (el perfil público está cacheado y no puede renderizar
 * estado por-usuario en el servidor).
 */
export async function getEstadoSeguimiento(
  companyId: string
): Promise<EstadoSeguimiento> {
  const user = await getUser()
  if (!user?.metadata.dbUserId || user.metadata.role !== 'CLIENTE') {
    return { authenticated: false, following: false, esFavorita: false }
  }
  try {
    const follow = await conEmpresa(companyId, (tx) =>
      tx.companyFollow.findUnique({
        where: {
          userId_companyId: {
            userId: user.metadata.dbUserId,
            companyId,
          },
        },
        select: { esFavorita: true },
      })
    )
    return {
      authenticated: true,
      following: follow != null,
      esFavorita: follow?.esFavorita ?? false,
    }
  } catch (e) {
    console.error('[social] getEstadoSeguimiento', e)
    return { authenticated: true, following: false, esFavorita: false }
  }
}

export interface SocialResult {
  error?: string
  following?: boolean
  esFavorita?: boolean
  guardada?: boolean
}

/** Seguir / dejar de seguir una empresa. */
export async function toggleSeguirEmpresa(
  companyId: string
): Promise<SocialResult> {
  const user = await getUser()
  if (!user?.metadata.dbUserId || user.metadata.role !== 'CLIENTE') {
    return { error: 'Inicia sesión como cliente para seguir empresas.' }
  }
  const userId = user.metadata.dbUserId

  try {
    return await conEmpresa(companyId, async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: { isActive: true, isPublished: true, esDemo: true },
      })
      if (!company || !company.isActive || !company.isPublished) {
        return { error: 'Empresa no disponible.' }
      }
      // Una empresa de práctica no se sigue: seguirla la metería en el feed y en
      // "mis empresas" de alguien que nunca pidió verla. Al entrenamiento se
      // entra por el enlace de registro, que es otra cosa.
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
        revalidatePath('/cliente/empresas')
        revalidatePath('/cliente/explorar')
        revalidatePath('/mis-membresias')
        revalidatePath('/cliente/ayuda')
      }
      return result
    })
  } catch (e) {
    console.error('[social] toggleSeguirEmpresa', e)
    return { error: 'No se pudo completar. Intenta de nuevo.' }
  }
}

/** Marcar / desmarcar una empresa seguida como favorita. */
export async function toggleFavoritaEmpresa(
  companyId: string
): Promise<SocialResult> {
  const user = await getUser()
  if (!user?.metadata.dbUserId || user.metadata.role !== 'CLIENTE') {
    return { error: 'Inicia sesión como cliente.' }
  }
  const userId = user.metadata.dbUserId

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
        revalidatePath('/cliente/empresas')
        return { following: true, esFavorita: true }
      }

      const updated = await tx.companyFollow.update({
        where: { id: follow.id },
        data: { esFavorita: !follow.esFavorita },
        select: { esFavorita: true },
      })
      revalidatePath('/cliente/empresas')
      return { following: true, esFavorita: updated.esFavorita }
    })
  } catch (e) {
    console.error('[social] toggleFavoritaEmpresa', e)
    return { error: 'No se pudo completar. Intenta de nuevo.' }
  }
}

/** Guardar / quitar una promoción de "Mis promociones guardadas". */
export async function toggleGuardarPromocion(
  promocionId: string
): Promise<SocialResult> {
  const user = await getUser()
  if (!user?.metadata.dbUserId || user.metadata.role !== 'CLIENTE') {
    return { error: 'Inicia sesión como cliente para guardar promociones.' }
  }
  const userId = user.metadata.dbUserId

  try {
    return await sinEmpresa(
      'social: promociones guardadas del cliente cruzan sus empresas',
      async (tx) => {
        const existing = await tx.promocionGuardada.findUnique({
          where: { userId_promocionId: { userId, promocionId } },
          select: { id: true },
        })

        let guardada: boolean
        if (existing) {
          await tx.promocionGuardada.delete({ where: { id: existing.id } })
          guardada = false
        } else {
          const promo = await tx.promocion.findUnique({
            where: { id: promocionId },
            select: { activo: true },
          })
          if (!promo) return { error: 'Promoción no encontrada.' }
          await tx.promocionGuardada.create({ data: { userId, promocionId } })
          guardada = true
        }

        revalidatePath('/cliente/promociones')
        return { guardada }
      }
    )
  } catch (e) {
    console.error('[social] toggleGuardarPromocion', e)
    return { error: 'No se pudo completar. Intenta de nuevo.' }
  }
}
