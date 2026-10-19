import { conEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { revalidateTag } from 'next/cache'
import { NAV_CLIENTE_TAG } from '@/modules/cliente/cacheTags'
import { registrarEventoMembresia } from '@/modules/membresia/eventos'
import { datosDeCambioDePlan } from '@/modules/membresia/cambio-plan-aplicar'
import { crearNotificacion } from '@/modules/notificaciones/service'
import { CAMBIO_DE_PLAN_PAGADO } from '@/modules/observabilidad/conciliacion-entrega'
import { RECLAMO_PERDIDO } from '@/modules/pagos/renovacion-extension'

/**
 * LA ENTREGA DE UN CAMBIO DE PLAN PAGADO CON TARJETA: aplicar el plan que el cliente pagó.
 *
 * Un cliente con la membresía activa pide un plan mayor y paga la DIFERENCIA prorrateada con tarjeta. Esa entrega no es una
 * «activación» (la membresía ya está activa, y `activarMembresia` la rechaza): es aplicar el cambio. Hasta ahora lo hacía una
 * persona desde Pagos; ahora lo hace el propio cobro, con las mismas garantías que las demás entregas de pasarela:
 *
 *   · aplica EXACTAMENTE el plan que se pagó (`pago_intentos.planDestinoId`, guardado al crear el intento) y solo si la
 *     membresía sigue pidiéndolo. Si el cliente cambió su pedido entre el cobro y la entrega, o el cobro es anterior a que
 *     se guardara el plan, NO se aplica a ciegas: queda para una persona, con su mensaje;
 *   · cierra la entrega (`PROCESANDO` → `COMPLETADA`) en la MISMA transacción que aplica el cambio, bajo el candado del
 *     reclamo: o pasa todo o nada, y dos procesos a la vez no aplican dos veces;
 *   · el importe es el que la pasarela cobró (`monto` del intento), no una cuenta nueva: el prorrateo depende del día y
 *     recalcularlo daría otro número al reintentar;
 *   · el pago se fecha en el cobro (`activadoAt`), como en las demás entregas: el periodo nuevo empieza al aplicarse;
 *   · deja los mismos rastros que el cambio por el panel: auditoría, evento de ciclo de vida y aviso al cliente.
 *
 * Nunca recobra. Lo que cambia en la membresía lo define `datosDeCambioDePlan`, compartida con el panel.
 */

export type ResultadoCambioDePlan = { ok: true; planNombre: string } | { ok: false; error: string }

const PEDIDO_CAMBIO = 'CAMBIO_DE_PLAN_PEDIDO_CAMBIO'

export async function aplicarCambioDePlanCobrado(input: {
  companyId: string
  intentoId: string
  /** El reclamo de la entrega que se ganó (`updatedAt` con el que se marcó `PROCESANDO`). */
  claimAt: Date
}): Promise<ResultadoCambioDePlan> {
  const { companyId, intentoId, claimAt } = input
  const ahora = new Date()

  let resultado: { planNombre: string; clienteSupabaseId: string }
  try {
    resultado = await conEmpresa(companyId, async (tx) => {
      const cobro = await tx.pagoIntento.findUnique({
        where: { id: intentoId },
        select: { companyId: true, membershipId: true, planDestinoId: true, monto: true, activadoAt: true, canal: true },
      })
      if (!cobro || cobro.companyId !== companyId || !cobro.membershipId || !cobro.planDestinoId) throw new Error(PEDIDO_CAMBIO)

      const m = await tx.membership.findUnique({
        where: { id: cobro.membershipId },
        include: { plan: true, cliente: { select: { supabaseId: true } } },
      })
      // La membresía debe seguir ACTIVA y seguir pidiendo exactamente el plan que se pagó.
      if (!m || m.companyId !== companyId || m.estado !== 'ACTIVA' || m.planIdSolicitado !== cobro.planDestinoId) {
        throw new Error(PEDIDO_CAMBIO)
      }
      const nuevoPlan = await tx.plan.findFirst({ where: { id: cobro.planDestinoId, companyId } })
      if (!nuevoPlan) throw new Error(PEDIDO_CAMBIO)

      const reclamo = await tx.pagoIntento.updateMany({
        where: { id: intentoId, companyId, estado: 'APROBADO', fulfillmentEstado: 'PROCESANDO', updatedAt: claimAt },
        data: { fulfillmentEstado: 'COMPLETADA', fulfillmentAt: ahora, fulfillmentError: null },
      })
      if (reclamo.count !== 1) throw new Error(RECLAMO_PERDIDO)

      const monto = Number(cobro.monto)
      const pagoEn = cobro.activadoAt ?? ahora
      // Con la misma condición de arriba en el WHERE: si el pedido cambió entre la lectura y la escritura, no toca nada.
      const aplicado = await tx.membership.updateMany({
        where: { id: m.id, estado: 'ACTIVA', planId: m.planId, planIdSolicitado: cobro.planDestinoId },
        data: datosDeCambioDePlan({ nuevoPlan, monto, ahora, fechaPago: pagoEn }),
      })
      if (aplicado.count !== 1) throw new Error(PEDIDO_CAMBIO)

      await tx.auditLog.create({
        data: {
          companyId,
          userId: null,
          accion: 'PAGO_APROBADO',
          entidadTipo: 'Membership',
          entidadId: m.id,
          payload: {
            cambioDePlan: true,
            planAnterior: m.planId,
            planNuevo: nuevoPlan.id,
            monto,
            metodo: 'TARJETA',
            canal: cobro.canal,
            intentoId,
          },
        },
      })

      // El MISMO evento que escribe el cambio por el panel: el reporte de ciclo de vida no distingue cómo se pagó.
      await registrarEventoMembresia(tx, {
        companyId,
        membershipId: m.id,
        clienteId: m.clienteId,
        tipo: 'CAMBIO_PLAN',
        origen: 'API',
        estadoAnterior: m.estado,
        estadoNuevo: 'ACTIVA',
        planAnteriorId: m.planId,
        planNuevoId: nuevoPlan.id,
        precioAnterior: Number(m.plan.precio),
        precioNuevo: Number(nuevoPlan.precio),
        monto,
        actorUserId: null,
        ocurridoEn: pagoEn,
        payload: {
          planAnteriorNombre: m.plan.nombre,
          planNuevoNombre: nuevoPlan.nombre,
          solicitadoPorCliente: true,
          intentoId,
        },
      })

      return { planNombre: nuevoPlan.nombre, clienteSupabaseId: m.cliente.supabaseId }
    })
  } catch (error) {
    if (error instanceof Error && error.message === RECLAMO_PERDIDO) throw error
    if (error instanceof Error && error.message === PEDIDO_CAMBIO) return { ok: false, error: CAMBIO_DE_PLAN_PAGADO }
    throw error
  }

  // Aviso al cliente: mejor esfuerzo, el cambio ya está hecho y cobrado.
  try {
    const usuario = await conEmpresa(companyId, (tx) =>
      tx.user.findUnique({ where: { supabaseId: resultado.clienteSupabaseId }, select: { id: true } })
    )
    if (usuario) {
      await crearNotificacion({
        userId: usuario.id,
        tipo: 'PAGO_APROBADO',
        titulo: 'Cambio de plan aplicado',
        mensaje: `Tu pago fue aprobado y tu plan ya es "${resultado.planNombre}".`,
        href: '/mis-membresias',
        dedupeKey: `cambio-plan-cobrado:${intentoId}`,
      })
    }
  } catch (e) {
    anotarFallo('pagos:cambio-plan:aviso', { intentoId })(e)
  }
  revalidateTag(NAV_CLIENTE_TAG, 'max')

  return { ok: true, planNombre: resultado.planNombre }
}
