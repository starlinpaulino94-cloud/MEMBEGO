import { conEmpresa } from '@/lib/tenant'
import { registrarEventoMembresia } from '@/modules/membresia/eventos'
import { periodEnd } from '@/lib/server-utils'
import { nuevoTokenQr, vencimientoQr } from '@/modules/qr/token'

/**
 * LA ENTREGA DE UNA RENOVACIÓN AUTOMÁTICA: extender la membresía ya cobrada.
 *
 * Una renovación cobra con la tarjeta guardada y después EXTIENDE la membresía. Si el cobro pasa y la extensión falla, el
 * cliente pagó y su membresía sigue sin extenderse. Esa entrega se podía marcar como fallida, pero NO se podía reintentar:
 * la vía de reintento era `activarMembresia`, que rechaza una membresía ya ACTIVA («ya está activa») y dejaba el cobro
 * fallando para siempre, con reintentos del barrido y de la conciliación gastados en vano.
 *
 * Por eso la extensión vive aquí, aparte, y la usan los dos caminos: el cobro recién aprobado (`renovarMembresiaPorTarjeta`)
 * y el reintento (`reintentarEntrega`). Hace lo mismo que `activarMembresia` hace con una compra de pasarela:
 *
 *   · cierra la entrega (`PROCESANDO` → `COMPLETADA`) en la MISMA transacción que la extensión, bajo el candado del reclamo:
 *     o pasa todo o no pasa nada, y dos procesos a la vez no extienden dos veces;
 *   · fecha el pago en el momento en que la pasarela lo aprobó (`activadoAt`), no en el de la entrega: un reintento de días
 *     después no mueve el cobro de mes ni lo separa de su venta del libro;
 *   · cuenta el periodo desde el vencimiento vigente si todavía es futuro respecto al cobro, y desde el cobro si no.
 *
 * Nunca recobra. El importe es el que la pasarela cobró (`monto` del intento), no el precio actual del plan.
 */

export const RECLAMO_PERDIDO = 'FULFILLMENT_CLAIM_LOST'

export type ResultadoExtension =
  | { ok: true; nuevaVigencia: Date; planNombre: string; pesos: number }
  | { ok: false; error: string }

export async function extenderMembresiaCobrada(input: {
  companyId: string
  intentoId: string
  /** El reclamo de la entrega que se ganó (`updatedAt` con el que se marcó `PROCESANDO`). */
  claimAt: Date
}): Promise<ResultadoExtension> {
  const { companyId, intentoId, claimAt } = input
  const cerradoAt = new Date()

  return conEmpresa(companyId, async (tx): Promise<ResultadoExtension> => {
    // Primero se comprueba que hay algo que extender: cerrar la entrega y descubrir después que no había membresía la
    // dejaría COMPLETADA sin producto.
    const cobro = await tx.pagoIntento.findUnique({
      where: { id: intentoId },
      select: { companyId: true, membershipId: true, monto: true, activadoAt: true },
    })
    if (!cobro || cobro.companyId !== companyId || !cobro.membershipId) {
      return { ok: false, error: 'El cobro no tiene una membresía asociada.' }
    }
    const m = await tx.membership.findUnique({
      where: { id: cobro.membershipId },
      include: { plan: true },
    })
    if (!m || m.companyId !== companyId) return { ok: false, error: 'Membresía no encontrada.' }

    const reclamo = await tx.pagoIntento.updateMany({
      where: { id: intentoId, companyId, estado: 'APROBADO', fulfillmentEstado: 'PROCESANDO', updatedAt: claimAt },
      data: { fulfillmentEstado: 'COMPLETADA', fulfillmentAt: cerradoAt, fulfillmentError: null },
    })
    if (reclamo.count !== 1) throw new Error(RECLAMO_PERDIDO)

    const pagoEn = cobro.activadoAt ?? cerradoAt
    const pesos = Number(cobro.monto)
    const base = m.fechaVencimiento && m.fechaVencimiento > pagoEn ? m.fechaVencimiento : pagoEn
    const nuevaVigencia = periodEnd(base, m.plan.vigenciaDias ?? 30)

    await tx.membership.update({
      where: { id: m.id },
      data: {
        estado: 'ACTIVA',
        fechaVencimiento: nuevaVigencia,
        lavadosRestantes: m.plan.esIlimitado ? 0 : m.plan.lavadosIncluidos,
        montoPagado: pesos,
        pagoConfirmado: true,
        // La renovación es un cobro nuevo: pisa la fecha anterior a propósito, porque lo que interesa es cuándo
        // entró ESTE dinero.
        fechaPago: pagoEn,
      },
    })

    const qrVivo = await tx.qrToken.findFirst({
      where: { membresiaId: m.id, activo: true },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })

    let qrEmitidoId: string | null = null
    if (qrVivo) {
      await tx.qrToken.update({ where: { id: qrVivo.id }, data: { expiraAt: vencimientoQr() } })
    } else {
      const nuevoQr = await tx.qrToken.create({
        data: { clienteId: m.clienteId, membresiaId: m.id, token: nuevoTokenQr(), expiraAt: vencimientoQr() },
        select: { id: true },
      })
      qrEmitidoId = nuevoQr.id
      await tx.auditLog.create({
        data: {
          companyId,
          userId: null,
          accion: 'QR_GENERADO',
          entidadTipo: 'QrToken',
          entidadId: nuevoQr.id,
          payload: { clienteId: m.clienteId, membresiaId: m.id, motivo: 'renovacion_automatica_tarjeta' },
        },
      })
    }

    await tx.auditLog.create({
      data: {
        companyId,
        userId: null,
        accion: 'PAGO_APROBADO',
        entidadTipo: 'Membership',
        entidadId: m.id,
        payload: {
          motivo: 'renovacion_automatica_tarjeta',
          metodo: 'TARJETA',
          canal: 'RENOVACION_AUTOMATICA',
          monto: pesos,
          intentoId,
          qrEmitido: qrEmitidoId,
          qrRenovado: qrVivo?.id ?? null,
        },
      },
    })

    // `origen: 'CRON'` es lo que separa esto de una renovación en el mostrador. Son el mismo hecho comercial con dos
    // lecturas muy distintas: una la pidió alguien, la otra ocurrió sola con la tarjeta guardada. Sin ese campo,
    // «renovaciones automáticas» no se puede reportar y la primera vez que alguien pregunte habrá que adivinarlo.
    await registrarEventoMembresia(tx, {
      companyId,
      membershipId: m.id,
      clienteId: m.clienteId,
      tipo: 'RENOVADA',
      origen: 'CRON',
      estadoAnterior: m.estado,
      estadoNuevo: 'ACTIVA',
      planAnteriorId: m.planId,
      planNuevoId: m.planId,
      monto: pesos,
      actorUserId: null,
      ocurridoEn: pagoEn,
      payload: { automatica: true, intentoId },
    })

    return { ok: true, nuevaVigencia, planNombre: m.plan.nombre, pesos }
  })
}
