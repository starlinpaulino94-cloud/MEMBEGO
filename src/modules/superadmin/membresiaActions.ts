'use server'

/**
 * Ajuste manual de una membresía por el SUPERADMIN: fija la cantidad de
 * lavados/beneficios restantes del cliente (correcciones operativas:
 * cortesías, errores de canje, compensaciones). Queda auditado con el valor
 * anterior, el nuevo y el motivo.
 */

import { revalidatePath } from 'next/cache'
import { getUser } from '@/lib/auth'
import { getRequestMeta } from '@/lib/server-utils'
import { anotarFallo } from '@/lib/prisma-errors'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { fechaInputLocal, finDelDiaLocal } from '@/lib/periodos'
import { nuevoTokenQr, vencimientoQr } from '@/modules/qr/token'

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

    const membership = await sinEmpresa('superadmin: buscar membresía por id', (tx) =>
      tx.membership.findUnique({
        where: { id: String(input.membershipId) },
        select: {
          id: true,
          companyId: true,
          lavadosRestantes: true,
          cliente: { select: { nombre: true } },
          plan: { select: { esIlimitado: true } },
        },
      })
    )
    if (!membership) return { error: 'Membresía no encontrada.' }
    if (membership.plan.esIlimitado) {
      return { error: 'Este plan es ilimitado: no usa contador de lavados.' }
    }
    if (membership.lavadosRestantes === lavados) {
      return { error: 'La membresía ya tiene esa cantidad.' }
    }

    const meta = await getRequestMeta()
    await conEmpresa(membership.companyId, async (tx) => {
      await tx.membership.update({
        where: { id: membership.id },
        data: { lavadosRestantes: lavados },
      })

      await tx.auditLog
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
        .catch(anotarFallo('superadmin:auditoria-membresia'))
    })

    revalidatePath('/superadmin/membresias')
    revalidatePath('/admin/membresias')
    return { ok: true }
  } catch (e) {
    console.error('[superadmin] ajustar lavados:', e)
    return { error: 'No se pudo ajustar. Intenta de nuevo.' }
  }
}

export async function ajustarVencimientoMembresia(input: {
  membershipId: string
  fecha: string
  motivo: string
}): Promise<{ ok?: true; error?: string }> {
  try {
    const session = await getUser()
    if (!session || session.metadata.role !== 'SUPERADMIN') {
      return { error: 'Solo el superadmin puede ajustar vencimientos.' }
    }

    const motivo = String(input.motivo ?? '').trim().slice(0, 200)
    if (!motivo) return { error: 'Escribe el motivo del ajuste (queda en la auditoría).' }

    const membership = await sinEmpresa('superadmin: buscar membresía por id para vencimiento', (tx) =>
      tx.membership.findUnique({
        where: { id: String(input.membershipId) },
        select: {
          id: true,
          clienteId: true,
          companyId: true,
          estado: true,
          pagoConfirmado: true,
          fechaVencimiento: true,
          lavadosRestantes: true,
          lavadosBonoRestantes: true,
          cliente: { select: { nombre: true } },
          company: { select: { zonaHoraria: true } },
          plan: { select: { esIlimitado: true } },
        },
      })
    )
    if (!membership) return { error: 'Membresía no encontrada.' }
    if (!membership.pagoConfirmado) {
      return { error: 'No se puede alargar una membresía sin pago confirmado.' }
    }
    if (membership.estado === 'CANCELADA') {
      return { error: 'No se puede alargar una membresía cancelada. Renueva el plan.' }
    }

    const zonaHoraria = membership.company.zonaHoraria ?? undefined
    const nuevaFecha = finDelDiaLocal(String(input.fecha ?? '').trim(), zonaHoraria)
    if (!nuevaFecha) return { error: 'Indica una fecha válida.' }

    const now = new Date()
    if (nuevaFecha <= now) {
      return { error: 'La nueva fecha debe quedar en el futuro.' }
    }
    if (membership.fechaVencimiento && nuevaFecha <= membership.fechaVencimiento) {
      return { error: 'La nueva fecha debe ser posterior al vencimiento actual.' }
    }

    const saldo = membership.lavadosRestantes + membership.lavadosBonoRestantes
    const meta = await getRequestMeta()
    await conEmpresa(membership.companyId, async (tx) => {
      await tx.membership.update({
        where: { id: membership.id },
        data: {
          estado: 'ACTIVA',
          fechaVencimiento: nuevaFecha,
        },
      })

      const qrVivo = await tx.qrToken.findFirst({
        where: { membresiaId: membership.id, activo: true },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      })
      let qrEmitidoId: string | null = null
      if (!qrVivo && (membership.plan.esIlimitado || saldo > 0)) {
        const nuevoQr = await tx.qrToken.create({
          data: {
            clienteId: membership.clienteId,
            membresiaId: membership.id,
            token: nuevoTokenQr(),
            expiraAt: vencimientoQr(),
          },
          select: { id: true },
        })
        qrEmitidoId = nuevoQr.id
      }

      await tx.auditLog
        .create({
          data: {
            companyId: membership.companyId,
            userId: session.metadata.dbUserId ?? null,
            accion: 'NOTA_INTERNA',
            entidadTipo: 'Membership',
            entidadId: membership.id,
            payload: {
              tipo: 'AJUSTE_VENCIMIENTO',
              antes: membership.fechaVencimiento
                ? fechaInputLocal(membership.fechaVencimiento, zonaHoraria)
                : null,
              despues: fechaInputLocal(nuevaFecha, zonaHoraria),
              motivo,
              cliente: membership.cliente.nombre,
              estadoAnterior: membership.estado,
              qrEmitido: qrEmitidoId,
            },
            ...meta,
          },
        })
        .catch(anotarFallo('superadmin:auditoria-vencimiento-membresia'))
    })

    revalidatePath('/superadmin/membresias')
    revalidatePath('/admin/membresias')
    revalidatePath(`/admin/clientes/${membership.clienteId}`)
    return { ok: true }
  } catch (e) {
    console.error('[superadmin] ajustar vencimiento:', e)
    return { error: 'No se pudo ajustar el vencimiento. Intenta de nuevo.' }
  }
}
