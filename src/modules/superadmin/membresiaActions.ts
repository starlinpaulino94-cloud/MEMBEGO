'use server'

/**
 * Ajuste manual de una membresía por el SUPERADMIN: fija la cantidad de
 * lavados/beneficios restantes del cliente (correcciones operativas:
 * cortesías, errores de canje, compensaciones). Queda auditado con el valor
 * anterior, el nuevo y el motivo.
 */

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { getRequestMeta } from '@/lib/server-utils'

export async function ajustarLavadosMembresia(input: {
  membershipId: string
  lavados: number
  motivo: string
}): Promise<{ ok?: true; error?: string }> {
  try {
    const session = await getUser()
    if (!session || session.metadata.role !== 'SUPERADMIN') {
      return { error: 'Solo el superadmin puede ajustar lavados.' }
    }

    const lavados = Math.trunc(Number(input.lavados))
    if (!Number.isFinite(lavados) || lavados < 0 || lavados > 9999) {
      return { error: 'Indica una cantidad válida (0 a 9999).' }
    }
    const motivo = String(input.motivo ?? '').trim().slice(0, 200)
    if (!motivo) return { error: 'Escribe el motivo del ajuste (queda en la auditoría).' }

    const membership = await prisma.membership.findUnique({
      where: { id: String(input.membershipId) },
      select: {
        id: true,
        companyId: true,
        lavadosRestantes: true,
        cliente: { select: { nombre: true } },
        plan: { select: { esIlimitado: true } },
      },
    })
    if (!membership) return { error: 'Membresía no encontrada.' }
    if (membership.plan.esIlimitado) {
      return { error: 'Este plan es ilimitado: no usa contador de lavados.' }
    }
    if (membership.lavadosRestantes === lavados) {
      return { error: 'La membresía ya tiene esa cantidad.' }
    }

    await prisma.membership.update({
      where: { id: membership.id },
      data: { lavadosRestantes: lavados },
    })

    const meta = await getRequestMeta()
    await prisma.auditLog
      .create({
        data: {
          companyId: membership.companyId,
          userId: session.metadata.dbUserId ?? null,
          accion: 'NOTA_INTERNA',
          entidadTipo: 'Membership',
          entidadId: membership.id,
          payload: {
            tipo: 'AJUSTE_LAVADOS',
            antes: membership.lavadosRestantes,
            despues: lavados,
            motivo,
            cliente: membership.cliente.nombre,
          },
          ...meta,
        },
      })
      .catch(() => {})

    revalidatePath('/superadmin/membresias')
    revalidatePath('/admin/membresias')
    return { ok: true }
  } catch (e) {
    console.error('[superadmin] ajustar lavados:', e)
    return { error: 'No se pudo ajustar. Intenta de nuevo.' }
  }
}
