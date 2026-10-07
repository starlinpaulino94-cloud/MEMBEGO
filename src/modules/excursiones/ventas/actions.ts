'use server'

/**
 * EXCURSIONES · Ventas — acciones.
 *
 * Confirmar una venta es el momento en que el dinero deja de ser una promesa,
 * y por eso es aquí donde nace la comisión. Tres cosas pasan a la vez y en el
 * mismo orden siempre:
 *
 *   1. Se crea la VENTA con su número, congelando el vendedor de la reserva.
 *   2. Se resuelve la REGLA que gobierna esa venta y se guarda su SNAPSHOT
 *      dentro de la comisión: cambiar la regla mañana no toca esta cifra.
 *   3. Se deja el hecho de COMPRA en el embudo del vendedor.
 *
 * Y una cuarta que no pasa nunca: recalcular comisiones ya generadas.
 */

import { revalidatePath } from 'next/cache'
import { conEmpresa } from '@/lib/tenant'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { netoComision, ajustePorCancelacion } from '@/modules/excursiones/comisiones/nucleo'
import { auditar, procesarVentaYComisionInterna } from './procesar'

export interface VentaActionState {
  error?: string
  success?: string
  ventaId?: string
}

/**
 * ADMIN · Confirmar la venta de una reserva saldada.
 */
export async function confirmarVenta(
  _prev: VentaActionState,
  formData: FormData
): Promise<VentaActionState> {
  try {
    const user = await requireSection('excursiones', 'venta_confirmar')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const reservaId = String(formData.get('reservaId') ?? '')

    const res = await procesarVentaYComisionInterna(companyId, reservaId, user.metadata.dbUserId ?? null)
    if (res.error) return { error: res.error }

    return {
      success: res.comision
        ? `Venta confirmada. Comisión generada: ${res.comision.monto} (${res.comision.desglose}).`
        : 'Venta confirmada.',
      ventaId: res.ventaId,
    }
  } catch (e) {
    console.error('[excursiones] confirmarVenta:', e)
    return { error: 'No se pudo confirmar la venta. Intenta de nuevo.' }
  }
}

/**
 * ADMIN · Cancelar una venta ya confirmada.
 *
 * Las comisiones NO se borran. Las que aún no se pagaron se anulan; las que ya
 * se pagaron reciben un AJUSTE negativo, porque ese dinero salió de verdad y
 * el histórico tiene que poder explicarlo (§27).
 */
export async function cancelarVenta(
  _prev: VentaActionState,
  formData: FormData
): Promise<VentaActionState> {
  try {
    const user = await requireSection('excursiones', 'venta_cancelar')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const ventaId = String(formData.get('ventaId') ?? '')
    const motivo = String(formData.get('motivo') ?? '').trim().slice(0, 300)
    if (!motivo) return { error: 'Escribe el motivo de la cancelación.' }

    const venta = await conEmpresa(companyId, (tx) =>
      tx.ventaExc.findFirst({
        where: { id: ventaId, companyId },
        select: {
          id: true,
          numero: true,
          estado: true,
          reservaId: true,
          comisiones: {
            select: {
              id: true,
              estado: true,
              monto: true,
              ajustes: { select: { monto: true } },
            },
          },
        },
      })
    )
    if (!venta) return { error: 'Venta no encontrada.' }
    if (venta.estado === 'CANCELADA') return { error: 'Esa venta ya está cancelada.' }

    await conEmpresa(companyId, (tx) =>
      tx.ventaExc.updateMany({
        where: { id: venta.id, companyId },
        data: { estado: 'CANCELADA', canceladaAt: new Date() },
      })
    )

    for (const c of venta.comisiones) {
      if (c.estado === 'PAGADA') {
        const neto = netoComision(
          Number(c.monto),
          c.ajustes.map((a) => ({ monto: Number(a.monto) }))
        )
        const ajuste = ajustePorCancelacion(neto, `Venta ${venta.numero} cancelada: ${motivo}`)
        if (ajuste) {
          await conEmpresa(companyId, (tx) =>
            tx.comisionAjuste.create({
              data: {
                companyId,
                comisionId: c.id,
                monto: ajuste.monto,
                motivo: ajuste.motivo,
                responsableId: user.metadata.dbUserId ?? null,
              },
            })
          )
        }
      } else if (c.estado !== 'ANULADA') {
        await conEmpresa(companyId, (tx) =>
          tx.comisionEntrada.updateMany({
            where: { id: c.id, companyId },
            data: { estado: 'ANULADA' },
          })
        )
      }
    }

    await auditar(companyId, user.metadata.dbUserId ?? null, venta.id, {
      tipo: 'VENTA_CANCELADA',
      numero: venta.numero,
      motivo,
      comisionesAfectadas: venta.comisiones.length,
    })
    revalidatePath(`/admin/excursiones/reservas/${venta.reservaId}`)
    revalidatePath('/admin/excursiones/comisiones')
    return { success: `Venta ${venta.numero} cancelada.` }
  } catch (e) {
    console.error('[excursiones] cancelarVenta:', e)
    return { error: 'No se pudo cancelar la venta.' }
  }
}
