'use server'

/**
 * SUMAR O RESTAR LAVADOS A UNA MEMBRESÍA, DESDE EL PANEL DE LA EMPRESA.
 *
 * Ya existía en el panel del superadmin, y ahí se queda: esto no lo sustituye,
 * lo pone donde de verdad se usa. Quien atiende el mostrador es quien sabe que
 * a un cliente se le cobró un lavado que no se hizo, o que hay que regalarle
 * uno por una máquina averiada — y hasta hoy tenía que pedírselo a alguien.
 *
 * TRES DIFERENCIAS CON EL DE SUPERADMIN, Y LAS TRES A PROPÓSITO:
 *
 * 1. Se suma o se resta, no se fija. «Ponlo en 4» exige saber cuánto había y
 *    se equivoca en cuanto dos personas lo tocan a la vez; «súmale 1» dice lo
 *    que pasó. El total lo calcula el servidor leyendo el valor del momento.
 *
 * 2. El motivo es obligatorio y viaja al comprobante. No es burocracia: un
 *    contador que ve «−2 lavados» sin explicación no puede cuadrar nada.
 *
 * 3. Devuelve el id del asiento de auditoría. Ése es el número del
 *    comprobante imprimible: el papel y el registro son la misma cosa, no dos
 *    que puedan separarse.
 */

import { revalidatePath } from 'next/cache'
import { requireSection } from '@/lib/auth/guards'
import { getRequestMeta } from '@/lib/server-utils'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'

export interface AjusteLavadosState {
  error?: string
  /** Id del asiento de auditoría = número del comprobante. */
  comprobanteId?: string
}

/** Tope por operación. No es el saldo máximo: es cuánto puede mover UN ajuste. */
const MAX_POR_AJUSTE = 99

export async function ajustarLavados(
  _prev: AjusteLavadosState,
  formData: FormData
): Promise<AjusteLavadosState> {
  try {
    const user = await requireSection('membresias', 'ajustar_lavados')
    if (!user) return { error: 'No autorizado.' }

    const membershipId = String(formData.get('membershipId') ?? '').trim()
    const delta = Math.trunc(Number(formData.get('delta') ?? 0))
    const motivo = String(formData.get('motivo') ?? '').trim().slice(0, 300)

    if (!membershipId) return { error: 'Membresía requerida.' }
    if (!Number.isFinite(delta) || delta === 0) {
      return { error: 'Indica cuántos lavados sumar o restar.' }
    }
    if (Math.abs(delta) > MAX_POR_AJUSTE) {
      return { error: `Un ajuste no puede mover más de ${MAX_POR_AJUSTE} lavados.` }
    }
    if (!motivo) {
      return { error: 'Escribe el motivo. Va en el comprobante y en la auditoría.' }
    }

    // La empresa se deriva de la membresía, nunca del formulario: el navegador
    // no decide sobre qué empresa se escribe.
    const membership = await sinEmpresa(
      'ajuste de lavados: localizar la membresía antes de conocer su empresa',
      (tx) =>
        tx.membership.findUnique({
          where: { id: membershipId },
          select: {
            id: true,
            companyId: true,
            lavadosRestantes: true,
            cliente: { select: { id: true, nombre: true } },
            plan: { select: { nombre: true, esIlimitado: true } },
          },
        })
    ).catch(() => null)

    if (!membership) return { error: 'Membresía no encontrada.' }
    if (user.metadata.role !== 'SUPERADMIN' && membership.companyId !== user.metadata.companyId) {
      return { error: 'Membresía no encontrada.' }
    }
    if (membership.plan.esIlimitado) {
      return { error: 'Este plan es ilimitado: no lleva contador de lavados.' }
    }

    const antes = membership.lavadosRestantes ?? 0
    const despues = antes + delta
    if (despues < 0) {
      // Restar más de lo que hay dejaría un saldo negativo, que en el mostrador
      // no significa nada: el escáner ya rechaza en cero.
      return { error: `Solo quedan ${antes}. No se pueden restar ${Math.abs(delta)}.` }
    }

    const meta = await getRequestMeta()
    const comprobanteId = await conEmpresa(membership.companyId, async (tx) => {
      await tx.membership.update({
        where: { id: membership.id },
        data: { lavadosRestantes: despues },
      })

      const asiento = await tx.auditLog.create({
        data: {
          companyId: membership.companyId,
          userId: user.metadata.dbUserId ?? null,
          accion: 'NOTA_INTERNA',
          entidadTipo: 'Membership',
          entidadId: membership.id,
          payload: {
            tipo: 'AJUSTE_LAVADOS',
            delta,
            antes,
            despues,
            motivo,
            cliente: membership.cliente.nombre,
            clienteId: membership.cliente.id,
            plan: membership.plan.nombre,
          },
          ...meta,
        },
        select: { id: true },
      })
      return asiento.id
    })

    revalidatePath('/admin/membresias')
    revalidatePath(`/admin/clientes/${membership.cliente.id}`)
    return { comprobanteId }
  } catch {
    return { error: 'Ocurrió un error inesperado. Intenta de nuevo.' }
  }
}
