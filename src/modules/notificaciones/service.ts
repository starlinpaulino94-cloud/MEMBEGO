import { prisma } from '@/lib/prisma'
import type { NotifTipo } from '@prisma/client'
import { FULL_ADMIN_ROLES } from '@/types'

// Helpers internos de notificación. IMPORTANTE: este archivo NO lleva
// 'use server' — así estas funciones no quedan expuestas como endpoints
// invocables; solo pueden llamarse desde código de servidor (actions guarded).

export async function crearNotificacion(data: {
  userId: string
  tipo: NotifTipo
  titulo: string
  mensaje: string
  href?: string
}) {
  try {
    await prisma.notificacion.create({ data })
  } catch (e) {
    console.error('[notificacion] create error', e)
  }
}

/**
 * Notifica a los administradores PLENOS de una empresa.
 *
 * Antes filtraba `role: 'ADMIN_EMPRESA'`, que es el rol LEGACY (así está
 * marcado en el esquema). Los administradores que crea `crearEmpresa` nacen
 * como `ADMINISTRADOR`, así que ninguna empresa dada de alta por el flujo
 * actual recibía un solo aviso: ni pago pendiente, ni comprobante subido, ni
 * nada. El fallo no daba error — simplemente la campanita nunca sonaba.
 *
 * `FULL_ADMIN_ROLES` incluye el legacy, así que las empresas antiguas siguen
 * recibiendo lo suyo.
 */
export async function notificarAdmins(
  companyId: string,
  payload: { tipo: NotifTipo; titulo: string; mensaje: string; href?: string }
) {
  try {
    const admins = await prisma.user.findMany({
      where: { companyId, role: { in: FULL_ADMIN_ROLES } },
      select: { id: true },
    })
    if (admins.length === 0) return
    await prisma.notificacion.createMany({
      data: admins.map((a) => ({ userId: a.id, ...payload })),
    })
  } catch (e) {
    console.error('[notificacion] notificarAdmins error', e)
  }
}

/**
 * Notifica a todo CLIENTE con cuenta en la empresa (cualquier fila cliente
 * con ese companyId, soporte multi-empresa).
 */
export async function notificarClientesEmpresa(
  companyId: string,
  payload: { tipo: NotifTipo; titulo: string; mensaje: string; href?: string }
) {
  try {
    const clientes = await prisma.cliente.findMany({
      where: { companyId },
      select: { supabaseId: true },
    })
    if (clientes.length === 0) return

    const users = await prisma.user.findMany({
      where: { supabaseId: { in: clientes.map((c) => c.supabaseId) } },
      select: { id: true },
    })
    if (users.length === 0) return

    await prisma.notificacion.createMany({
      data: users.map((u) => ({ userId: u.id, ...payload })),
    })
  } catch (e) {
    console.error('[notificacion] notificarClientesEmpresa error', e)
  }
}

/**
 * FASE 3: Notifica únicamente a los seguidores de la empresa (CompanyFollow).
 * Regla del marketplace social: nunca notificar a usuarios que no siguen la
 * empresa. Los clientes existentes se convirtieron en seguidores vía backfill.
 */
export async function notificarSeguidoresEmpresa(
  companyId: string,
  payload: { tipo: NotifTipo; titulo: string; mensaje: string; href?: string }
) {
  try {
    const seguidores = await prisma.companyFollow.findMany({
      where: { companyId },
      select: { userId: true },
    })
    if (seguidores.length === 0) return

    await prisma.notificacion.createMany({
      data: seguidores.map((s) => ({ userId: s.userId, ...payload })),
    })
  } catch (e) {
    console.error('[notificacion] notificarSeguidoresEmpresa error', e)
  }
}
