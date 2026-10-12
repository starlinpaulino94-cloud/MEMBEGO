'use server'

import { revalidatePath } from 'next/cache'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { toggleFavoritaEmpresaDirecto, toggleSeguirEmpresaDirecto, type SocialResult } from './directo'

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

export type { SocialResult }

/** Seguir / dejar de seguir una empresa (Server Action). */
export async function toggleSeguirEmpresa(
  companyId: string
): Promise<SocialResult> {
  const user = await getUser()
  if (!user?.metadata.dbUserId || user.metadata.role !== 'CLIENTE') {
    return { error: 'Inicia sesión como cliente para seguir empresas.' }
  }
  return toggleSeguirEmpresaDirecto(user.metadata.dbUserId, companyId)
}

/** Marcar / desmarcar una empresa seguida como favorita (Server Action). */
export async function toggleFavoritaEmpresa(
  companyId: string
): Promise<SocialResult> {
  const user = await getUser()
  if (!user?.metadata.dbUserId || user.metadata.role !== 'CLIENTE') {
    return { error: 'Inicia sesión como cliente.' }
  }
  return toggleFavoritaEmpresaDirecto(user.metadata.dbUserId, companyId)
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
