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
import {
  calcularSaldo,
  ESTADOS_CERRADOS,
  type EstadoReserva,
} from '@/modules/excursiones/reservas/nucleo'
import {
  reglasAplicables,
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
/**
 * Core interno: confirma la venta de una reserva saldada y genera la comisión.
 */
export async function procesarVentaYComisionInterna(
  companyId: string,
  reservaId: string,
  userId: string | null
): Promise<{ ventaId?: string; comision?: { monto: number; desglose: string } | null; error?: string }> {
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
  if (ESTADOS_CERRADOS.includes(reserva.estado as EstadoReserva)) {
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
    return { ventaId: existente.id }
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

    const [reglas, excursion, config, ventasPreviasExcursion, ventasPreviasVendedor, vendedor] = await Promise.all([
      conEmpresa(companyId, (tx) =>
        tx.comisionRegla.findMany({ where: { companyId, activa: true } })
      ),
      conEmpresa(companyId, (tx) =>
        tx.excursion.findUnique({
          where: { id: reserva.excursionId },
          select: {
            nombre: true,
            categoria: true,
            // El precio NO vive en la excursión: vive en sus variantes. Es el
            // diseño del catálogo (una excursión puede tener varias tarifas),
            // y por eso `Excursion.precioAdulto` no existe.
            variantes: { select: { precioAdulto: true }, take: 1 },
          },
        })
      ),
      conEmpresa(companyId, (tx) =>
        tx.excursionesConfig.findUnique({
          where: { companyId },
          select: { reglaAprobacion: true },
        })
      ),
      conEmpresa(companyId, (tx) =>
        tx.ventaExc.count({
          where: {
            companyId,
            vendedorId: reserva.vendedorId,
            excursionId: reserva.excursionId,
            id: { not: venta.id },
          },
        })
      ),
      conEmpresa(companyId, (tx) =>
        tx.ventaExc.count({
          where: {
            companyId,
            vendedorId: reserva.vendedorId,
            id: { not: venta.id },
          },
        })
      ),
      conEmpresa(companyId, (tx) =>
        tx.vendedor.findUnique({
          where: { id: reserva.vendedorId! },
          select: { tipo: true },
        })
      ),
    ])

    // Precio base del paquete: la primera variante si la hay; si no, se deduce
    // del total de la reserva repartido entre sus pasajeros.
    const precioBasePaquete = Number(
      excursion?.variantes?.[0]?.precioAdulto ??
        Number(reserva.total) / Math.max(1, reserva.adultos + reserva.ninos)
    )

    const ctx = {
      vendedorId: reserva.vendedorId,
      excursionId: reserva.excursionId,
      categoria: excursion?.categoria ?? null,
      tipoVendedor: vendedor?.tipo ?? null,
      total: Number(reserva.total),
      baseComisionable: baseComisionable(Number(reserva.total), Number(reserva.impuestos)),
      adultos: reserva.adultos,
      ninos: reserva.ninos,
      fecha: new Date(),
      excursionNombre: excursion?.nombre ?? null,
      excursionPrecio: precioBasePaquete > 0 ? precioBasePaquete : Number(reserva.total),
      ventasPreviasExcursion,
      ventasPreviasVendedor,
    }

    const candidatas = reglasAplicables(
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
          tipoVendedor: r.tipoVendedor,
          vigenciaDesde: r.vigenciaDesde,
          vigenciaHasta: r.vigenciaHasta,
          createdAt: r.createdAt,
        })
      ),
      ctx
    )

    // Si la empresa no ha creado reglas específicas aplicables, usar regla GENERAL del 10% por defecto
    const reglasAEjecutar: ReglaComision[] =
      candidatas.length > 0
        ? candidatas
        : [
            {
              id: 'default-general',
              ambito: 'GENERAL',
              tipoCalculo: 'PORCENTAJE',
              valor: 10,
              activa: true,
              createdAt: new Date(),
            },
          ]

    comisionCreada = { monto: 0, desglose: '' }

    for (const regla of reglasAEjecutar) {
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

      if (regla.tipoCalculo === 'PAQUETE_REGALO' && c.monto > 0) {
        await conEmpresa(companyId, (tx) =>
          tx.vendedorBono.create({
            data: {
              companyId,
              vendedorId: reserva.vendedorId!,
              descripcion: `Paquete de regalo: ${excursion?.nombre || 'Excursión'}`,
              condicion: {
                cadaVentas: regla.valor,
                ventaId: venta.id,
                excursionId: reserva.excursionId,
                excursionNombre: excursion?.nombre,
              },
              monto: c.monto,
              moneda: reserva.moneda,
              estado: 'OTORGADO',
            },
          })
        ).catch(anotarFallo('excursiones:ventas:vendedorBono'))
      }

      comisionCreada.monto += c.monto
      comisionCreada.desglose = comisionCreada.desglose
        ? `${comisionCreada.desglose} | ${c.desglose}`
        : c.desglose
    }
  }

  await auditar(companyId, userId, venta.id, {
    tipo: 'VENTA_CONFIRMADA',
    numero: venta.numero,
    reserva: reserva.numero,
    comision: comisionCreada?.monto ?? null,
  })

  revalidatePath(`/admin/excursiones/reservas/${reserva.id}`)
  revalidatePath('/admin/excursiones/comisiones')
  revalidatePath('/vendedor/comisiones')
  revalidatePath('/vendedor/reservas')
  return {
    ventaId: venta.id,
    comision: comisionCreada,
  }
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
