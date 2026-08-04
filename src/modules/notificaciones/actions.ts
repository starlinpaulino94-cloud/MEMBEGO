'use server'

import { sinEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'

// Los helpers internos (crearNotificacion, notificarAdmins, etc.) viven en
// ./service.ts, fuera de 'use server', para no exponerlos como endpoints.

// ── Server actions ────────────────────────────────────────────────────────────

export async function getNotificaciones() {
  const user = await getUser()
  if (!user?.metadata.dbUserId) return []

  return sinEmpresa('notificaciones: listar por usuario (cross-tenant)', (tx) =>
    tx.notificacion.findMany({
      where: { userId: user.metadata.dbUserId },
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
        where: { userId: user.metadata.dbUserId, leida: false },
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
