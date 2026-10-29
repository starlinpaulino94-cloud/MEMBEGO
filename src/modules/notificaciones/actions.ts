'use server'

import { sinEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { NOTIFICACIONES_VISIBLES } from './visibles'

// Los helpers internos (crearNotificacion, notificarAdmins, etc.) viven en
// ./service.ts, fuera de 'use server', para no exponerlos como endpoints.

// ── Server actions ────────────────────────────────────────────────────────────

export async function getNotificaciones() {
  const user = await getUser()
  if (!user?.metadata.dbUserId) return []

  return sinEmpresa('notificaciones: listar por usuario (cross-tenant)', (tx) =>
    tx.notificacion.findMany({
      where: { userId: user.metadata.dbUserId, ...NOTIFICACIONES_VISIBLES },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
  )
}

export async function getUnreadCount(): Promise<number> {
  try {
    const user = await getUser()
    if (!user?.metadata.dbUserId) return 0

    return await sinEmpresa('notificaciones: contar por usuario (cross-tenant)', (tx) =>
      tx.notificacion.count({
        where: { userId: user.metadata.dbUserId, leida: false, ...NOTIFICACIONES_VISIBLES },
      })
    )
  } catch (e) {
    console.error('[notificacion] getUnreadCount error', e)
    return 0
  }
}

export async function marcarTodasLeidas() {
  const user = await getUser()
  if (!user?.metadata.dbUserId) return

  await sinEmpresa('notificaciones: marcar leidas por usuario (cross-tenant)', (tx) =>
    tx.notificacion.updateMany({
      where: { userId: user.metadata.dbUserId, leida: false },
      data: { leida: true },
    })
  )
  // Sin revalidatePath: el NotificationBell actualiza su estado local y los
  // layouts privados son dinámicos. La purga global anterior ('/','layout')
  // invalidaba también las páginas públicas ISR en cada click.
}

export async function marcarLeida(id: string) {
  try {
    const user = await getUser()
    if (!user?.metadata.dbUserId) return

    const result = await sinEmpresa('notificaciones: marcar leida por usuario (cross-tenant)', (tx) =>
      tx.notificacion.updateMany({
        where: { id, userId: user.metadata.dbUserId },
        data: { leida: true },
      })
    )
    if (result.count === 0) {
      console.warn('[notificacion] marcarLeida: notification not found or not owned by user', id)
    }
  } catch (e) {
    console.error('[notificacion] marcarLeida error', e)
  }
}

/**
 * ELIMINAR UN AVISO de mi bandeja. Se marca, no se borra (ver `visibles.ts`), y
 * solo si es MÍO: el `userId` sale de la sesión, nunca del navegador. Devuelve
 * cuántos sin leer quedan, para que el contador se corrija sin recargar.
 */
export async function eliminarNotificacion(id: string): Promise<{ ok: boolean; noLeidas: number }> {
  try {
    const user = await getUser()
    const userId = user?.metadata.dbUserId
    if (!userId || typeof id !== 'string' || id.length === 0 || id.length > 128) return { ok: false, noLeidas: 0 }
    return await sinEmpresa('notificaciones: eliminar una de mi bandeja (cross-tenant)', async (tx) => {
      const r = await tx.notificacion.updateMany({
        where: { id, userId, ...NOTIFICACIONES_VISIBLES },
        data: { eliminadaEn: new Date() },
      })
      const noLeidas = await tx.notificacion.count({ where: { userId, leida: false, ...NOTIFICACIONES_VISIBLES } })
      return { ok: r.count > 0, noLeidas }
    })
  } catch (e) {
    console.error('[notificacion] eliminarNotificacion error', e)
    return { ok: false, noLeidas: 0 }
  }
}

/** ELIMINAR TODOS los avisos de mi bandeja (los míos, de cualquier empresa). */
export async function eliminarTodasNotificaciones(): Promise<{ ok: boolean; eliminadas: number }> {
  try {
    const user = await getUser()
    const userId = user?.metadata.dbUserId
    if (!userId) return { ok: false, eliminadas: 0 }
    const r = await sinEmpresa('notificaciones: eliminar toda mi bandeja (cross-tenant)', (tx) =>
      tx.notificacion.updateMany({
        where: { userId, ...NOTIFICACIONES_VISIBLES },
        data: { eliminadaEn: new Date() },
      })
    )
    return { ok: true, eliminadas: r.count }
  } catch (e) {
    console.error('[notificacion] eliminarTodasNotificaciones error', e)
    return { ok: false, eliminadas: 0 }
  }
}
