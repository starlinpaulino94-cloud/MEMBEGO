import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { crearNotificacion } from '@/modules/notificaciones/service'

/**
 * Regalos P2P · Fase R3 — entrega de regalos PAGADOS (compra o membresía).
 *
 * El regalo pagado vive vinculado a su orden (compra bajo el COMPRADOR con
 * `beneficiarioClienteId`, o membresía creada a nombre del amigo). Cuando el
 * pago se valida —caja, panel o transferencia—, la ACTIVACIÓN llama aquí:
 *  - `entregarCompraABeneficiario`: reasigna la compra a la wallet del amigo
 *    ANTES de activar (QR y notificaciones le llegan a él).
 *  - `resolverRegaloPagado`: marca el Regalo como ACEPTADO y avisa a ambos.
 * Nada aquí lanza: la activación jamás debe romperse por el regalo.
 */

/** Notifica al User dueño de un Cliente (si tiene cuenta vinculada). */
export async function notificarClienteRegalo(
  clienteId: string,
  titulo: string,
  mensaje: string,
  href: string
) {
  try {
    const userId = await sinEmpresa(
      'regalos: buscar user del destinatario por id (cross-tenant)',
      async (tx) => {
        const cliente = await tx.cliente.findUnique({
          where: { id: clienteId },
          select: { supabaseId: true },
        })
        if (!cliente?.supabaseId) return null
        const u = await tx.user.findUnique({
          where: { supabaseId: cliente.supabaseId },
          select: { id: true },
        })
        return u?.id ?? null
      }
    )
    if (userId) await crearNotificacion({ userId, tipo: 'SISTEMA', titulo, mensaje, href })
  } catch (e) {
    console.error('[regalos] notificar', e)
  }
}

/**
 * Si la compra es un regalo (beneficiario ≠ comprador), la reasigna al
 * beneficiario. Llamar ANTES de activar. Devuelve true si hubo reasignación.
 */
export async function entregarCompraABeneficiario(compra: {
  id: string
  clienteId: string
  companyId: string
  beneficiarioClienteId: string | null
}): Promise<boolean> {
  try {
    if (!compra.beneficiarioClienteId || compra.beneficiarioClienteId === compra.clienteId) {
      return false
    }
    return await conEmpresa(compra.companyId, async (tx) => {
      const beneficiario = await tx.cliente.findFirst({
        where: { id: compra.beneficiarioClienteId, companyId: compra.companyId },
        select: { id: true },
      })
      // Beneficiario borrado: la compra queda con el comprador (mejor que perderla).
      if (!beneficiario) return false
      await tx.productoCompra.update({
        where: { id: compra.id },
        data: { clienteId: beneficiario.id },
      })
      return true
    })
  } catch (e) {
    console.error('[regalos] entregarCompraABeneficiario', e)
    return false
  }
}

/**
 * Resuelve el Regalo pagado vinculado a una compra o membresía recién
 * activada: PENDIENTE → ACEPTADO + notificación a ambas partes.
 */
export async function resolverRegaloPagado(vinculo: {
  compraId?: string
  membershipId?: string
}) {
  try {
    const regalo = await sinEmpresa(
      'regalos: buscar regalo pagado por id del vínculo (empresa no conocida)',
      (tx) =>
        tx.regalo.findFirst({
          where: {
            estado: 'PENDIENTE',
            ...(vinculo.compraId
              ? { tipo: 'REGALO_COMPRA', compraDestinoId: vinculo.compraId }
              : { tipo: 'REGALO_MEMBRESIA', membershipDestinoId: vinculo.membershipId }),
          },
          include: {
            remitente: { select: { id: true, nombre: true } },
            destinatario: { select: { id: true, nombre: true } },
          },
        })
    )
    if (!regalo || !regalo.destinatarioId) return

    const upd = await conEmpresa(regalo.companyId, (tx) =>
      tx.regalo.updateMany({
        where: { id: regalo.id, estado: 'PENDIENTE' },
        data: { estado: 'ACEPTADO', resueltoAt: new Date() },
      })
    )
    if (upd.count === 0) return

    let etiqueta = 'tu regalo'
    if (regalo.promocionId) {
      const p = await conEmpresa(regalo.companyId, (tx) =>
        tx.promocion.findUnique({
          where: { id: regalo.promocionId },
          select: { titulo: true },
        })
      )
      etiqueta = p?.titulo ?? etiqueta
    } else if (regalo.planId) {
      const p = await conEmpresa(regalo.companyId, (tx) =>
        tx.plan.findUnique({
          where: { id: regalo.planId },
          select: { nombre: true },
        })
      )
      etiqueta = p ? `tu membresía ${p.nombre}` : 'tu membresía'
    }

    const remitenteNombre = regalo.remitente.nombre.split(/\s+/)[0]
    await notificarClienteRegalo(
      regalo.destinatarioId,
      `🎁 ${remitenteNombre} te hizo un regalo`,
      `Ya tienes ${etiqueta} en tu cuenta${regalo.mensaje ? `: “${regalo.mensaje}”` : '.'}`,
      regalo.compraDestinoId
        ? `/cliente/mis-promociones/${regalo.compraDestinoId}`
        : '/mis-membresias'
    )
    await notificarClienteRegalo(
      regalo.remitenteId,
      '🎉 Tu regalo fue entregado',
      `${regalo.destinatario?.nombre.split(/\s+/)[0] ?? 'Tu amigo'} ya recibió ${etiqueta}.`,
      '/cliente/regalos'
    )
  } catch (e) {
    console.error('[regalos] resolverRegaloPagado', e)
  }
}

/**
 * R4 · Regalos a personas SIN cuenta: cuando alguien se registra, los regalos
 * PENDIENTES enviados a su correo/teléfono (destinatarioContacto) se le
 * asignan automáticamente para que los acepte desde /cliente/regalos. Se llama
 * tras crear el Cliente en el registro; nunca lanza (el registro no puede
 * romperse por un regalo).
 */
export async function vincularRegalosPorContacto(params: {
  clienteId: string
  companyId: string
  email?: string | null
  telefono?: string | null
}): Promise<number> {
  try {
    const contactos: string[] = []
    const email = params.email?.trim().toLowerCase()
    if (email) contactos.push(email)
    const digits = params.telefono?.replace(/\D/g, '') ?? ''
    if (digits.length >= 7) contactos.push(digits)
    if (contactos.length === 0) return 0

    const pendientes = await conEmpresa(params.companyId, (tx) =>
      tx.regalo.findMany({
        where: {
          companyId: params.companyId,
          estado: 'PENDIENTE',
          destinatarioId: null,
          destinatarioContacto: { in: contactos },
          expiraAt: { gt: new Date() },
        },
        select: { id: true, remitenteId: true, remitente: { select: { nombre: true } } },
      })
    )

    let vinculados = 0
    for (const r of pendientes) {
      // Guard: solo si sigue pendiente y sin reclamar (otro registro simultáneo
      // con el mismo contacto no lo duplica).
      const upd = await conEmpresa(params.companyId, (tx) =>
        tx.regalo.updateMany({
          where: { id: r.id, estado: 'PENDIENTE', destinatarioId: null },
          data: { destinatarioId: params.clienteId },
        })
      )
      if (upd.count === 0) continue
      vinculados++
      await notificarClienteRegalo(
        r.remitenteId,
        '🎉 Tu regalo ya tiene dueño',
        'La persona a la que le enviaste el regalo ya se registró: puede aceptarlo desde su cuenta.',
        '/cliente/regalos'
      )
    }

    if (vinculados > 0) {
      await notificarClienteRegalo(
        params.clienteId,
        '🎁 Te estaba esperando un regalo',
        `Tienes ${vinculados} regalo${vinculados !== 1 ? 's' : ''} pendiente${vinculados !== 1 ? 's' : ''} de aceptar. Hazlo antes de que expire.`,
        '/cliente/regalos'
      )
    }

    // Gift cards enviadas a este contacto: se asignan igual (no expiran; las
    // PENDIENTE_PAGO quedan listas para cuando el comprador pague).
    const giftCards = await conEmpresa(params.companyId, (tx) =>
      tx.giftCard.updateMany({
        where: {
          companyId: params.companyId,
          destinatarioClienteId: null,
          destinatarioContacto: { in: contactos },
          estado: { in: ['PENDIENTE_PAGO', 'ACTIVA'] },
        },
        data: { destinatarioClienteId: params.clienteId },
      })
    )
    if (giftCards.count > 0) {
      await notificarClienteRegalo(
        params.clienteId,
        '💳 Tienes una gift card',
        `Te regalaron ${giftCards.count} gift card${giftCards.count !== 1 ? 's' : ''}: revisa su saldo y úsala mostrando el código al pagar.`,
        '/cliente/regalos'
      )
    }

    return vinculados + giftCards.count
  } catch (e) {
    console.error('[regalos] vincularRegalosPorContacto', e)
    return 0
  }
}
