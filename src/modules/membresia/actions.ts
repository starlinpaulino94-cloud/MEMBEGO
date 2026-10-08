'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { notificarAdmins } from '@/modules/notificaciones/service'
import { formSubmitLimiter } from '@/lib/rate-limit'
import { generarCodigo } from '@/lib/codes'
import { NAV_CLIENTE_TAG } from '@/modules/cliente/cacheTags'
import { registrarEventoMembresia } from '@/modules/membresia/eventos'
import {
  registrarComprobanteMembresiaCliente,
  solicitarCambioPlanCliente,
  solicitarMembresiaCliente,
} from '@/modules/membresia/cliente-service'

export interface SeleccionState {
  error?: string
  success?: boolean
  membershipId?: string
}

export async function seleccionarPlan(
  _prev: SeleccionState,
  formData: FormData
): Promise<SeleccionState> {
  try {
    const user = await getUser()
    if (!user) return { error: 'No autorizado.' }

    const result = await solicitarMembresiaCliente(user, {
      planId: String(formData.get('planId') ?? '').trim(),
      vehicleId: String(formData.get('vehiculoId') ?? '').trim() || undefined,
    })
    if ('error' in result) return result

    revalidatePath('/mis-membresias')
    revalidatePath('/cliente/planes')
    revalidateTag(NAV_CLIENTE_TAG, 'max')
    return result
  } catch (e) {
    console.error('[membresia] seleccionarPlan error:', e)
    return { error: 'Ocurrió un error inesperado. Intenta de nuevo.' }
  }
}

/**
 * El cliente con membresía ACTIVA solicita subir de plan. Revertida la política
 * que lo deshabilitaba (decisión del usuario, 18-09-2026).
 *
 * No toca el plan vigente —solo registra `planIdSolicitado`—, así que conserva
 * el acceso mientras el cambio se procesa. SOLO SUBIR: si el plan destino no
 * cuesta más que el vigente, se rechaza sin registrar nada. El importe a pagar
 * NO viaja desde el navegador: lo resuelve `calcularPagoCambioPlan` en servidor.
 */
export async function solicitarCambioPlan(
  _prev: SeleccionState,
  formData: FormData
): Promise<SeleccionState> {
  try {
    const user = await getUser()
    if (!user) return { error: 'No autorizado.' }

    const result = await solicitarCambioPlanCliente(user, {
      membershipId: String(formData.get('membershipId') ?? '').trim(),
      planId: String(formData.get('planId') ?? '').trim(),
    })
    if ('error' in result) return result

    revalidatePath('/mis-membresias')
    revalidatePath(`/membresia/${result.membershipId}`)
    revalidatePath('/cliente/planes')
    revalidateTag(NAV_CLIENTE_TAG, 'max')
    return result
  } catch (e) {
    console.error('[membresia] solicitarCambioPlan error:', e)
    return { error: 'Ocurrió un error inesperado. Intenta de nuevo.' }
  }
}

export interface ComprobanteState {
  error?: string
  success?: boolean
}

/**
 * El cliente sube el comprobante de pago.
 * Cambia el estado de PENDIENTE → PENDIENTE_PAGO.
 */
export async function enviarComprobante(
  _prev: ComprobanteState,
  formData: FormData
): Promise<ComprobanteState> {
  try {
    const user = await getUser()
    if (!user) return { error: 'No autorizado.' }

    const result = await registrarComprobanteMembresiaCliente(user, {
      membershipId: String(formData.get('membershipId') ?? '').trim(),
      path: String(formData.get('comprobanteUrl') ?? '').trim(),
      metodoPagoId: String(formData.get('metodoPagoId') ?? '').trim() || null,
      nota: String(formData.get('nota') ?? '').trim() || null,
    })
    if ('error' in result) return result

    revalidatePath('/mis-membresias')
    revalidatePath('/cliente/pagos')
    revalidatePath(`/membresia/${result.membershipId}`)
    return { success: true }
  } catch (e) {
    console.error('[membresia] enviarComprobante error:', e)
    return { error: 'Ocurrió un error inesperado. Intenta de nuevo.' }
  }
}

export interface PresencialState {
  error?: string
  success?: boolean
  /** Referencia única para mostrar en caja (ORD-XXXXXX). */
  referencia?: string
}

/** Referencia corta, legible y sin ambigüedades (sin 0/O ni 1/I/L). */
function generarReferencia(): string {
  return `ORD-${generarCodigo(6)}`
}

/**
 * Pago presencial: el cliente avisa que pagará en la sucursal. No cambia el
 * estado a PENDIENTE_PAGO (no hay comprobante que validar): queda en
 * PENDIENTE con el método presencial registrado y una nota, y el encargado
 * lo activa con "Confirmar pago" al recibir el dinero en el local.
 */
export async function avisarPagoPresencial(
  _prev: PresencialState,
  formData: FormData
): Promise<PresencialState> {
  const user = await getUser()
  if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId) {
    return { error: 'No autorizado.' }
  }
  if (!(await formSubmitLimiter(user.metadata.clienteId))) {
    return { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' }
  }

  const membershipId = String(formData.get('membershipId') ?? '').trim()
  const metodoPagoId = String(formData.get('metodoPagoId') ?? '').trim() || null
  const sucursalId = String(formData.get('sucursalId') ?? '').trim() || null
  if (!membershipId) return { error: 'Membresía no especificada.' }

  const membership = await sinEmpresa('membresia: buscar membresía para pago presencial', (tx) =>
    tx.membership.findUnique({
      where: { id: membershipId },
      include: { cliente: { select: { id: true, nombre: true, companyId: true } } },
    })
  )
  if (!membership) return { error: 'Membresía no encontrada.' }
  if (membership.clienteId !== user.metadata.clienteId) {
    return { error: 'No autorizado.' }
  }

  const esCambioDePlan =
    membership.estado === 'ACTIVA' && membership.planIdSolicitado != null
  if (!esCambioDePlan && !['PENDIENTE', 'RECHAZADA'].includes(membership.estado)) {
    return { error: 'Esta membresía no tiene un pago pendiente.' }
  }

  // El método (si viene) debe ser presencial, activo y de la misma empresa.
  if (metodoPagoId) {
    const metodo = await conEmpresa(membership.cliente.companyId, (tx) =>
      tx.metodoPago.findFirst({
        where: {
          id: metodoPagoId,
          companyId: membership.cliente.companyId,
          tipo: 'PRESENCIAL',
          activo: true,
        },
        select: { id: true },
      })
    )
    if (!metodo) return { error: 'Método de pago no válido.' }
  }

  // Sucursal elegida por el cliente (si la empresa tiene varias).
  if (sucursalId) {
    const sucursal = await conEmpresa(membership.cliente.companyId, (tx) =>
      tx.sucursal.findFirst({
        where: { id: sucursalId, companyId: membership.cliente.companyId, activa: true },
        select: { id: true },
      })
    )
    if (!sucursal) return { error: 'Sucursal no válida.' }
  }

  // Referencia única para el cobro en caja (se conserva entre reintentos).
  let referencia = membership.referencia
  if (!referencia) {
    for (let intento = 0; intento < 5 && !referencia; intento++) {
      const candidata = generarReferencia()
      const ocupada = await sinEmpresa('membresia: verificar referencia única', (tx) =>
        tx.membership.findUnique({
          where: { referencia: candidata },
          select: { id: true },
        })
      )
      if (!ocupada) referencia = candidata
    }
    if (!referencia) return { error: 'No se pudo generar la referencia. Intenta de nuevo.' }
  }

  await conEmpresa(membership.cliente.companyId, (tx) =>
    tx.membership.update({
      where: { id: membershipId },
      data: {
        metodoPagoId,
        referencia,
        sucursalPagoId: sucursalId,
        comprobanteNota: 'El cliente pagará en la sucursal (pago presencial).',
        ...(membership.estado === 'RECHAZADA'
          ? { estado: 'PENDIENTE', rechazadoReason: null }
          : {}),
      },
    })
  )

  await notificarAdmins(membership.cliente.companyId, {
    // NUEVO_COMPROBANTE: mismo canal que la cola de validación de pagos (el
    // enum NotifTipo vive en la BD; no ameritaba una migración).
    tipo: 'NUEVO_COMPROBANTE',
    titulo: 'Pago presencial anunciado',
    mensaje: esCambioDePlan
      ? `${membership.cliente.nombre} pagará su cambio de plan en la sucursal. Al recibir el pago, confírmalo para aplicarlo.`
      : `${membership.cliente.nombre} pagará su membresía en la sucursal. Al recibir el pago, confírmalo para activarla.`,
    href: `/admin/pagos`,
  })

  revalidatePath('/mis-membresias')
  revalidatePath(`/membresia/${membershipId}`)
  return { success: true, referencia }
}

export interface CancelarPagoState {
  error?: string
  success?: boolean
  /** true = se canceló un cambio de plan; la membresía sigue activa. */
  eraCambioDePlan?: boolean
}

/**
 * El cliente cancela un pago pendiente que ya no quiere hacer.
 *
 * Dos casos, según en qué esté la membresía:
 *  · Membresía nueva esperando pago (PENDIENTE / PENDIENTE_PAGO / RECHAZADA):
 *    se marca CANCELADA. No se borra — `seleccionarPlan` la puede reabrir si el
 *    cliente cambia de opinión.
 *  · Membresía ACTIVA con un cambio de plan pendiente: se cancela SOLO el
 *    cambio (la membresía vigente no se toca).
 *
 * Nunca cancela una membresía ya activa "a secas": pagar y disfrutar el período
 * son cosas distintas; anular lo segundo no es "cancelar un pago".
 */
export async function cancelarPago(
  _prev: CancelarPagoState,
  formData: FormData
): Promise<CancelarPagoState> {
  const user = await getUser()
  if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId) {
    return { error: 'No autorizado.' }
  }
  if (!(await formSubmitLimiter(user.metadata.clienteId))) {
    return { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' }
  }

  const membershipId = String(formData.get('membershipId') ?? '').trim()
  if (!membershipId) return { error: 'Membresía no especificada.' }

  const membership = await sinEmpresa('membresia: buscar membresía a cancelar', (tx) =>
    tx.membership.findUnique({
      where: { id: membershipId },
      select: {
        id: true,
        clienteId: true,
        estado: true,
        planIdSolicitado: true,
        cliente: { select: { companyId: true } },
      },
    })
  )
  if (!membership) return { error: 'Membresía no encontrada.' }
  if (membership.clienteId !== user.metadata.clienteId) return { error: 'No autorizado.' }

  const esCambioDePlan =
    membership.estado === 'ACTIVA' && membership.planIdSolicitado != null

  if (esCambioDePlan) {
    // Solo se descarta el cambio; el plan vigente y su período no se tocan.
    await conEmpresa(membership.cliente.companyId, (tx) =>
      tx.membership.update({
        where: { id: membershipId },
        data: {
          planIdSolicitado: null,
          comprobanteUrl: null,
          comprobanteNota: null,
          metodoPagoId: null,
        },
      })
    )
    revalidatePath('/mis-membresias')
    revalidatePath(`/membresia/${membershipId}`)
    return { success: true, eraCambioDePlan: true }
  }

  if (!['PENDIENTE', 'PENDIENTE_PAGO', 'RECHAZADA'].includes(membership.estado)) {
    return { error: 'Esta membresía no tiene un pago pendiente para cancelar.' }
  }

  await conEmpresa(membership.cliente.companyId, (tx) =>
    tx.membership.update({
      where: { id: membershipId },
      data: {
        estado: 'CANCELADA',
        comprobanteUrl: null,
        comprobanteNota: null,
        metodoPagoId: null,
        rechazadoReason: null,
      },
    })
  )
  revalidatePath('/mis-membresias')
  revalidatePath(`/membresia/${membershipId}`)
  return { success: true, eraCambioDePlan: false }
}

// ── Cancelación por el cliente, con efecto a fin de período ─────────────────

export interface CancelarMembresiaState {
  error?: string
  success?: boolean
}

/**
 * EL CLIENTE CANCELA SU PROPIA MEMBRESÍA (decisión de producto, 12-08-2026).
 *
 * No pierde nada hoy: la membresía sigue ACTIVA con sus usos hasta
 * `fechaVencimiento`. Lo que cambia es el futuro — se apaga la renovación
 * automática y queda la marca `canceladaAlVencimiento`, visible para él y
 * para el negocio. Al vencer, muere sola (el flujo de vencimiento de
 * siempre); los servicios restantes se van con el período, como pidió el
 * dueño.
 *
 * La pertenencia es DE LA PERSONA, no de la ficha activa (cliente global):
 * la misma regla que usa la pantalla del detalle — el `supabaseId` del
 * dueño de la ficha debe ser el del usuario.
 */
export async function cancelarMiMembresia(
  _prev: CancelarMembresiaState,
  formData: FormData
): Promise<CancelarMembresiaState> {
  try {
    const user = await getUser()
    if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId) {
      return { error: 'No autorizado.' }
    }
    if (!(await formSubmitLimiter(user.metadata.clienteId))) {
      return { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' }
    }

    const membershipId = String(formData.get('membershipId') ?? '')
    if (!membershipId) return { error: 'Falta la membresía.' }

    const membership = await sinEmpresa(
      'cancelar membresía: la persona la busca entre todas sus fichas',
      (tx) =>
        tx.membership.findUnique({
          where: { id: membershipId },
          select: {
            id: true,
            estado: true,
            planId: true,
            fechaVencimiento: true,
            canceladaAlVencimiento: true,
            cliente: { select: { id: true, supabaseId: true, companyId: true } },
          },
        })
    )
    if (!membership) return { error: 'Membresía no encontrada.' }
    const esSuya =
      membership.cliente.supabaseId === user.supabaseId ||
      membership.cliente.id === user.metadata.clienteId
    if (!esSuya) return { error: 'No autorizado.' }

    if (membership.estado !== 'ACTIVA') {
      return { error: 'Solo se puede cancelar una membresía activa.' }
    }
    if (membership.canceladaAlVencimiento) {
      return { error: 'Esta membresía ya tiene la cancelación programada.' }
    }

    await conEmpresa(membership.cliente.companyId, async (tx) => {
      await tx.membership.update({
        where: { id: membership.id },
        data: { canceladaAlVencimiento: new Date(), autoRenovar: false },
      })
      await tx.auditLog.create({
        data: {
          companyId: membership.cliente.companyId,
          userId: null,
          accion: 'MEMBRESIA_CANCELADA',
          entidadTipo: 'Membership',
          entidadId: membership.id,
          payload: {
            tipo: 'cancelacion_programada_por_cliente',
            detalle:
              'Sigue activa hasta el vencimiento, sin renovación. Pedida por el cliente desde la app.',
          },
        },
      })

      /**
       * EL EVENTO REGISTRA LA DECISIÓN; EL ESTADO, LA SITUACIÓN.
       *
       * Aquí la membresía sigue ACTIVA —el cliente conserva sus usos hasta el
       * vencimiento, decisión de producto del 12-08-2026—, así que el evento
       * dice la verdad: `estadoNuevo: 'ACTIVA'`. Lo que cambió no es el estado,
       * es el futuro.
       *
       * Y aun así el tipo es `CANCELADA`, porque para el negocio ESTO es la
       * cancelación: es el momento en que el cliente decide irse, semanas antes
       * de que el estado lo refleje. Un reporte de bajas que esperase al
       * vencimiento vería el problema cuando ya no se puede hacer nada.
       *
       * `programada: true` lo distingue de un corte inmediato, para que un
       * reporte pueda contar las dos cosas por separado si algún día hace
       * falta.
       */
      await registrarEventoMembresia(tx, {
        companyId: membership.cliente.companyId,
        membershipId: membership.id,
        clienteId: membership.cliente.id,
        tipo: 'CANCELADA',
        origen: 'CLIENTE',
        estadoAnterior: membership.estado,
        estadoNuevo: membership.estado,
        planAnteriorId: membership.planId,
        payload: {
          programada: true,
          efectivaEn: membership.fechaVencimiento?.toISOString() ?? null,
        },
      })
    })

    revalidatePath(`/membresia/${membership.id}`)
    revalidatePath('/mis-membresias')
    return { success: true }
  } catch (e) {
    console.error('[membresia] cancelarMiMembresia:', e)
    return { error: 'No se pudo programar la cancelación. Intenta de nuevo.' }
  }
}
