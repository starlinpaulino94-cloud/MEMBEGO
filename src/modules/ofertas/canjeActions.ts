'use server'

/**
 * REGALO VIP · canje desde el escáner — el MISMO proceso de QR que las
 * compras de promoción, con una diferencia de fondo: el cupo es POR PERÍODO
 * (semanal/mensual/total) y se renueva solo, así que el QR se regenera tras
 * CADA canje mientras la oferta siga vigente — nunca se «consume» del todo.
 *
 * Atómico como el canje de compras: invalidar el QR de un solo uso, verificar
 * el cupo del período y registrar el uso viven en la misma transacción; si el
 * cupo está agotado, el rollback deja el QR activo (no se quema un token por
 * un intento fuera de cupo).
 */

import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { getRequestMeta } from '@/lib/server-utils'
import { SCANNER_ROLES } from '@/types'
import { inicioPeriodo } from '@/modules/ofertas/periodo'
import { ofertaVigente } from '@/modules/ofertas/queries'
import { nuevoTokenQr, vencimientoQr } from '@/modules/qr/token'
import { registrarEntregaBeneficio } from '@/modules/transacciones/entrega'
import { registrarEvento } from '@/modules/observabilidad/eventos'

export interface CanjeRegaloState {
  error?: string
  success?: boolean
  /** Usos restantes del período tras este canje. */
  restantes?: number
  transaccionId?: string
  ticketNumero?: string
}

export async function confirmarCanjeRegalo(
  _prev: CanjeRegaloState,
  formData: FormData
): Promise<CanjeRegaloState> {
  const t0 = Date.now()
  let empresaEvento: string | null = null
  const evento = (ok: boolean, motivo?: string) =>
    registrarEvento({
      dominio: 'escaneo',
      accion: 'canje_regalo',
      ok,
      ms: Date.now() - t0,
      companyId: empresaEvento,
      motivo,
    })

  try {
    const user = await getUser()
    if (!user || !SCANNER_ROLES.includes(user.metadata.role)) {
      return { error: 'No tienes permisos para confirmar canjes.' }
    }

    const invitadoId = String(formData.get('invitadoId') ?? '')
    const qrTokenId = String(formData.get('qrTokenId') ?? '')
    const notas = String(formData.get('notas') ?? '').trim() || null
    if (!invitadoId || !qrTokenId) return { error: 'Datos del canje incompletos.' }

    const invitado = await sinEmpresa(
      'regalo VIP: lookup de invitación para canjear (su empresa se deriva de la oferta)',
      (tx) =>
        tx.ofertaInvitado.findUnique({
          where: { id: invitadoId },
          include: {
            oferta: { include: { company: { select: { name: true, zonaHoraria: true } } } },
            cliente: { select: { nombre: true } },
          },
        })
    )
    if (!invitado) {
      evento(false, 'invitacion_no_encontrada')
      return { error: 'Regalo no encontrado.' }
    }
    const { oferta } = invitado
    empresaEvento = oferta.companyId
    if (
      user.metadata.role !== 'SUPERADMIN' &&
      user.metadata.companyId &&
      oferta.companyId !== user.metadata.companyId
    ) {
      return { error: 'Este regalo pertenece a otra empresa.' }
    }
    if (!(oferta.estado === 'ACTIVA' && ofertaVigente(oferta))) {
      evento(false, 'oferta_no_vigente')
      return { error: 'Este regalo ya no está disponible.' }
    }

    const meta = await getRequestMeta()
    const empleadoId = user.metadata.dbUserId ?? null

    const resultado = await conEmpresa(oferta.companyId, async (tx) => {
      // QR de un solo uso: guard atómico anti doble-canje.
      const qrUpd = await tx.qrToken.updateMany({
        where: { id: qrTokenId, activo: true, ofertaInvitadoId: invitado.id },
        data: { activo: false },
      })
      if (qrUpd.count === 0) throw new Error('QR_YA_USADO')

      // Cupo del período DENTRO de la transacción: si está agotado, el
      // rollback devuelve el QR a activo (el token no se quema en vano).
      const usados = await tx.ofertaUso.count({
        where: {
          invitadoId: invitado.id,
          createdAt: { gte: inicioPeriodo(oferta.periodo, oferta.company.zonaHoraria) },
        },
      })
      if (usados >= oferta.usosPorPeriodo) throw new Error('CUPO_AGOTADO')

      await tx.ofertaUso.create({
        data: {
          invitadoId: invitado.id,
          companyId: oferta.companyId,
          registradoPorId: empleadoId,
        },
      })

      // El cupo se renueva por período: el QR SIEMPRE se regenera (a
      // diferencia de una compra, el regalo no queda «consumido»).
      const nuevoQr = await tx.qrToken.create({
        data: {
          clienteId: invitado.clienteId,
          ofertaInvitadoId: invitado.id,
          token: nuevoTokenQr(),
          expiraAt: vencimientoQr(),
        },
      })

      await tx.auditLog.create({
        data: {
          companyId: oferta.companyId,
          userId: empleadoId,
          accion: 'QR_USADO',
          entidadTipo: 'OfertaInvitado',
          entidadId: invitado.id,
          payload: {
            ofertaId: oferta.id,
            clienteId: invitado.clienteId,
            restantesPeriodo: oferta.usosPorPeriodo - usados - 1,
          },
          ...meta,
        },
      })
      await tx.auditLog.create({
        data: {
          companyId: oferta.companyId,
          userId: empleadoId,
          accion: 'QR_GENERADO',
          entidadTipo: 'QrToken',
          entidadId: nuevoQr.id,
          payload: { ofertaInvitadoId: invitado.id, motivo: 'regeneracion_post_canje_regalo' },
          ...meta,
        },
      })

      return { restantes: oferta.usosPorPeriodo - usados - 1 }
    })

    // Registro oficial + comprobante (Transaction Engine). Fail-open igual
    // que el canje manual del admin: el regalo ya se entregó y un tropiezo
    // de facturación no lo revierte (registrarEntregaBeneficio nunca lanza).
    const txEntrega = await registrarEntregaBeneficio({
      tipo: 'BENEFIT_USE',
      companyId: oferta.companyId,
      clienteId: invitado.clienteId,
      clienteNombre: invitado.cliente.nombre,
      empleadoId,
      beneficio: oferta.titulo,
      detalle: `Regalo VIP: ${oferta.titulo}`,
      restantes: resultado.restantes,
      observaciones: notas,
      auditoria: { ...meta },
    })

    evento(true)
    return {
      success: true,
      restantes: resultado.restantes,
      transaccionId: txEntrega?.id,
      ticketNumero: txEntrega?.ticketNumero,
    }
  } catch (e) {
    if (e instanceof Error && e.message === 'QR_YA_USADO') {
      evento(false, 'qr_ya_usado')
      return { error: 'Este QR ya fue utilizado. Pide al cliente su QR actualizado.' }
    }
    if (e instanceof Error && e.message === 'CUPO_AGOTADO') {
      evento(false, 'cupo_agotado')
      return { error: 'El cupo del período está agotado. Se renueva solo al empezar el próximo.' }
    }
    evento(false, 'error_interno')
    console.error('[ofertas] confirmarCanjeRegalo:', e)
    return { error: 'Error interno al confirmar el canje. Intenta de nuevo.' }
  }
}
