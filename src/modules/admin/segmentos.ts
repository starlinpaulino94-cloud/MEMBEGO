import { conEmpresa, type Tx } from '@/lib/tenant'
import type { ConteoSegmentos, SegmentoValue } from '@/modules/admin/segmentos-def'

// F4.5: segmentación inteligente de clientes por empresa. Los segmentos se
// calculan al vuelo (sin tablas nuevas) y devuelven userIds notificables.
// Módulo interno sin 'use server' — no expone endpoints.
//
// OJO: este archivo importa Prisma, así que es SOLO de servidor. Las
// definiciones compartibles con el navegador (catálogo de segmentos, tipos)
// viven en ./segmentos-def — un componente cliente que importe de AQUÍ
// arrastra Prisma al navegador y revienta la página.

export { SEGMENTOS, esSegmentoValido } from '@/modules/admin/segmentos-def'
export type { SegmentoValue, ConteoSegmentos } from '@/modules/admin/segmentos-def'

/** Mapea clientes (supabaseId) a userIds notificables, dentro del tx de la empresa. */
async function userIdsDeClientes(tx: Tx, supabaseIds: string[]): Promise<string[]> {
  if (supabaseIds.length === 0) return []
  const users = await tx.user.findMany({
    where: { supabaseId: { in: [...new Set(supabaseIds)] } },
    select: { id: true },
  })
  return users.map((u) => u.id)
}

/** Resuelve los userIds destinatarios de un segmento para una empresa. */
export async function resolverSegmento(
  companyId: string,
  segmento: SegmentoValue,
  planId?: string
): Promise<string[]> {
  return conEmpresa(companyId, async (tx) => {
    const hace30dias = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const en7dias = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const ahora = new Date()

    switch (segmento) {
      case 'seguidores': {
        const rows = await tx.companyFollow.findMany({
          where: { companyId },
          select: { userId: true },
        })
        return rows.map((r) => r.userId)
      }
      case 'todos': {
        const rows = await tx.cliente.findMany({
          where: { companyId },
          select: { supabaseId: true },
        })
        return userIdsDeClientes(tx, rows.map((r) => r.supabaseId))
      }
      case 'activos': {
        const rows = await tx.cliente.findMany({
          where: { companyId, memberships: { some: { estado: 'ACTIVA' } } },
          select: { supabaseId: true },
        })
        return userIdsDeClientes(tx, rows.map((r) => r.supabaseId))
      }
      case 'por_vencer': {
        const rows = await tx.cliente.findMany({
          where: {
            companyId,
            memberships: {
              some: {
                estado: 'ACTIVA',
                fechaVencimiento: { gte: ahora, lte: en7dias },
              },
            },
          },
          select: { supabaseId: true },
        })
        return userIdsDeClientes(tx, rows.map((r) => r.supabaseId))
      }
      case 'nuevos': {
        const rows = await tx.cliente.findMany({
          where: { companyId, createdAt: { gte: hace30dias } },
          select: { supabaseId: true },
        })
        return userIdsDeClientes(tx, rows.map((r) => r.supabaseId))
      }
      case 'inactivos': {
        const rows = await tx.cliente.findMany({
          where: {
            companyId,
            visits: { none: { fechaVisita: { gte: hace30dias } } },
          },
          select: { supabaseId: true },
        })
        return userIdsDeClientes(tx, rows.map((r) => r.supabaseId))
      }
      case 'plan': {
        if (!planId) return []
        const rows = await tx.cliente.findMany({
          where: {
            companyId,
            memberships: { some: { estado: 'ACTIVA', planId } },
          },
          select: { supabaseId: true },
        })
        return userIdsDeClientes(tx, rows.map((r) => r.supabaseId))
      }
    }
  })
}

/** Conteos de cada segmento para mostrar en el formulario. */
export async function contarSegmentos(companyId: string): Promise<ConteoSegmentos> {
  return conEmpresa(companyId, async (tx) => {
    const hace30dias = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const en7dias = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const ahora = new Date()

    const [seguidores, todos, activos, porVencer, nuevos, inactivos] =
      await Promise.all([
        tx.companyFollow.count({ where: { companyId } }),
        tx.cliente.count({ where: { companyId } }),
        tx.cliente.count({
          where: { companyId, memberships: { some: { estado: 'ACTIVA' } } },
        }),
        tx.cliente.count({
          where: {
            companyId,
            memberships: {
              some: {
                estado: 'ACTIVA',
                fechaVencimiento: { gte: ahora, lte: en7dias },
              },
            },
          },
        }),
        tx.cliente.count({
          where: { companyId, createdAt: { gte: hace30dias } },
        }),
        tx.cliente.count({
          where: {
            companyId,
            visits: { none: { fechaVisita: { gte: hace30dias } } },
          },
        }),
      ])

    return {
      seguidores,
      todos,
      activos,
      por_vencer: porVencer,
      nuevos,
      inactivos,
    }
  })
}
