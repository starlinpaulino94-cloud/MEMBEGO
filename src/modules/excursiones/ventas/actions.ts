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
import type { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { getRequestMeta } from '@/lib/server-utils'
import { anotarFallo } from '@/lib/prisma-errors'
import { calcularSaldo, ESTADOS_CERRADOS } from '@/modules/excursiones/reservas/nucleo'
import {
  reglaAplicable,
  calcularComision,
  netoComision,
  ajustePorCancelacion,
  type ReglaComision,
} from '@/modules/excursiones/comisiones/nucleo'
import { numeroVenta, baseComisionable } from './nucleo'

export interface VentaActionState {
  error?: string
  success?: string
  ventaId?: string
}

async function auditar(
  companyId: string,
  userId: string | null,
  entidadId: string,
  payload: Record<string, unknown>
) {
  const meta = await getRequestMeta()
  await conEmpresa(companyId, (tx) =>
    tx.auditLog.create({
      data: {
        companyId,
        userId,
        accion: 'NOTA_INTERNA',
        entidadTipo: 'VentaExc',
        entidadId,
        payload: payload as Prisma.InputJsonObject,
        ...meta,
      },
    })
  ).catch(anotarFallo('excursiones:ventas:auditLog'))
}

/**
 * ADMIN · Confirmar la venta de una reserva saldada.
 *
 * Exige saldo cero a propósito: generar una comisión sobre dinero que todavía
 * no entró es prometer un pago que la empresa aún no puede respaldar. Si el
 * negocio quiere adelantarla, el camino es cobrar el resto, no bajar la regla.
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

    const reserva = await conEmpresa(companyId, (tx) =>
      tx.reservaExc.findFirst({
        where: { id: reservaId, companyId },
        select: {
          id: true,
          numero: true,
          estado: true,
          clienteId: true,
          vendedorId: true,
          excursionId: true,
          adultos: true,
          ninos: true,
          total: true,
          impuestos: true,
          moneda: true,
          fecha: true,
          pagos: { select: { monto: true, estado: true } },
        },
      })
    )
    if (!reserva) return { error: 'Reserva no encontrada.' }
    if (ESTADOS_CERRADOS.includes(reserva.estado as any)) {
      return { error: 'Esa reserva está cerrada (cancelada, completada o no-show): no genera venta.' }
    }

    const { saldo } = calcularSaldo(
      Number(reserva.total),
      reserva.pagos.map((p) => ({ monto: Number(p.monto), estado: p.estado }))
    )
    if (saldo > 0) {
      return {
        error: `Falta cobrar ${saldo} para confirmar la venta. La comisión nace del dinero que ya entró.`,
      }
    }

    // Idempotencia: una reserva tiene UNA venta (índice único). Repetir el
    // botón no crea una segunda ni duplica comisiones.
    const existente = await conEmpresa(companyId, (tx) =>
      tx.ventaExc.findFirst({ where: { reservaId: reserva.id, companyId }, select: { id: true, numero: true } })
    )
    if (existente) {
      return { success: `Esta reserva ya tiene la venta ${existente.numero}.`, ventaId: existente.id }
    }

    const venta = await conEmpresa(companyId, async (tx) => {
      let intento = (await tx.ventaExc.count({ where: { companyId } })) + 1
      for (let i = 0; i < 5; i++) {
        try {
          return await tx.ventaExc.create({
            data: {
              companyId,
              numero: numeroVenta('SAL', intento),
              reservaId: reserva.id,
              clienteId: reserva.clienteId,
              vendedorId: reserva.vendedorId,
              excursionId: reserva.excursionId,
              pasajeros: reserva.adultos + reserva.ninos,
              total: reserva.total,
              moneda: reserva.moneda,
              estado: 'CONFIRMADA',
              confirmadaAt: new Date(),
            },
            select: { id: true, numero: true },
          })
        } catch (e) {
          const esUnique = e instanceof Error && 'code' in e && (e as { code?: string }).code === 'P2002'
          if (!esUnique || i === 4) throw e
          intento += 1
        }
      }
      throw new Error('sin_numero')
    })

    // La reserva queda pagada y cerrada como completada por la venta.
    await conEmpresa(companyId, (tx) =>
      tx.reservaExc.updateMany({
        where: { id: reserva.id, companyId },
        data: { estado: 'COMPLETADA' },
      })
    )

    let comisionCreada: { monto: number; desglose: string } | null = null

    if (reserva.vendedorId) {
      // Hecho de COMPRA en el embudo del vendedor.
      await conEmpresa(companyId, (tx) =>
        tx.vendedorAtribucion.create({
          data: {
            companyId,
            vendedorId: reserva.vendedorId!,
            clienteId: reserva.clienteId,
            etapa: 'COMPRA',
          },
        })
      ).catch(anotarFallo('excursiones:ventas:atribucion'))

      const [reglas, excursion, config] = await Promise.all([
        conEmpresa(companyId, (tx) =>
          tx.comisionRegla.findMany({ where: { companyId, activa: true } })
        ),
        conEmpresa(companyId, (tx) =>
          tx.excursion.findUnique({
            where: { id: reserva.excursionId },
            select: { categoria: true },
          })
        ),
        conEmpresa(companyId, (tx) =>
          tx.excursionesConfig.findUnique({
            where: { companyId },
            select: { reglaAprobacion: true },
          })
        ),
      ])

      const ctx = {
        vendedorId: reserva.vendedorId,
        excursionId: reserva.excursionId,
        categoria: excursion?.categoria ?? null,
        total: Number(reserva.total),
        baseComisionable: baseComisionable(Number(reserva.total), Number(reserva.impuestos)),
        adultos: reserva.adultos,
        ninos: reserva.ninos,
        fecha: new Date(),
      }
      const regla = reglaAplicable(
        reglas.map(
          (r): ReglaComision => ({
            id: r.id,
            ambito: r.ambito,
            tipoCalculo: r.tipoCalculo,
            valor: Number(r.valor),
            escalones: r.escalones,
            activa: r.activa,
            excursionId: r.excursionId,
            vendedorId: r.vendedorId,
            categoria: r.categoria,
            vigenciaDesde: r.vigenciaDesde,
            vigenciaHasta: r.vigenciaHasta,
            createdAt: r.createdAt,
          })
        ),
        ctx
      )

      // Sin regla NO se inventa una comisión: la venta queda registrada igual
      // y la empresa verá que le falta definir cuánto paga.
      if (regla) {
        const c = calcularComision(regla, ctx)
        await conEmpresa(companyId, (tx) =>
          tx.comisionEntrada.create({
            data: {
              companyId,
              ventaId: venta.id,
              vendedorId: reserva.vendedorId!,
              base: c.base,
              monto: c.monto,
              moneda: reserva.moneda,
              reglaSnapshot: c.snapshot as unknown as Prisma.InputJsonObject,
              desglose: c.desglose,
              estado: config?.reglaAprobacion === 'AUTOMATICA' ? 'APROBADA' : 'GENERADA',
            },
          })
        )
        comisionCreada = { monto: c.monto, desglose: c.desglose }
      }
    }

    await auditar(companyId, user.metadata.dbUserId ?? null, venta.id, {
      tipo: 'VENTA_CONFIRMADA',
      numero: venta.numero,
      reserva: reserva.numero,
      comision: comisionCreada?.monto ?? null,
    })
    revalidatePath(`/admin/excursiones/reservas/${reserva.id}`)
    revalidatePath('/admin/excursiones/comisiones')
    return {
      success: comisionCreada
        ? `Venta ${venta.numero} confirmada. Comisión: ${comisionCreada.monto} (${comisionCreada.desglose}).`
        : `Venta ${venta.numero} confirmada.`,
      ventaId: venta.id,
    }
  } catch (e) {
    console.error('[excursiones] confirmarVenta:', e)
    return { error: 'No se pudo confirmar la venta.' }
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
