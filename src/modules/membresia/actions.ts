'use server'

import { revalidatePath } from 'next/cache'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { notificarAdmins } from '@/modules/notificaciones/service'
import { formSubmitLimiter } from '@/lib/rate-limit'
import { rutaValida } from '@/modules/storage/comprobantes'
import { calcularDescuentoBienvenida } from '@/lib/bienvenida'
import { generarCodigo } from '@/lib/codes'

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
    if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId) {
      return { error: 'No autorizado.' }
    }

    // Rate limit form submissions to prevent spam
    const clientId = user.metadata.clienteId
    if (!(await formSubmitLimiter(clientId))) {
      return { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' }
    }

    const planId = String(formData.get('planId') ?? '')
    if (!planId) return { error: 'Selecciona un plan.' }

    const companyId = user.metadata.companyId
    if (!companyId) return { error: 'Empresa requerida.' }

    const result = await conEmpresa(companyId, async (tx) => {
      const cliente = await tx.cliente.findUnique({
        where: { id: clientId },
        include: {
          company: {
            select: {
              bienvenidaActiva: true,
              bienvenidaTipo: true,
              bienvenidaValor: true,
            },
          },
        },
      })
      if (!cliente) return { error: 'Cliente no encontrado.' } as SeleccionState

      const plan = await tx.plan.findUnique({ where: { id: planId } })
      // Validate: plan must exist, belong to client's company, and be active
      if (!plan || plan.companyId !== cliente.companyId || !plan.activo) {
        return { error: 'Plan no válido para tu empresa.' } as SeleccionState
      }

      // Block if there's already an active membership IN THIS COMPANY
      const existing = await tx.membership.findUnique({
        where: {
          clienteId_companyId: {
            clienteId: cliente.id,
            companyId: cliente.companyId,
          },
        },
      })

      if (existing?.estado === 'ACTIVA') {
        return {
          error: 'Ya tienes una membresía activa en esta empresa. Espera a que venza para cambiar.',
        } as SeleccionState
      }

      // O-13: beneficio de bienvenida — solo para la PRIMERA activación. Una
      // fila nunca activada tiene fechaInicio null (la activación lo fija y la
      // renovación jamás lo vuelve a null). Se congela aquí el importe para que
      // cambios posteriores de configuración no alteren solicitudes en curso.
      const elegibleBienvenida = !existing || existing.fechaInicio == null
      const descuento = elegibleBienvenida
        ? calcularDescuentoBienvenida(cliente.company, Number(plan.precio))
        : 0
      const descuentoBienvenida = descuento > 0 ? descuento : null

      let membershipId: string
      if (existing) {
        // Reuse existing membership (PENDIENTE or PENDIENTE_PAGO). Si estaba
        // CANCELADA/VENCIDA/RECHAZADA, la solicitud la REABRE: vuelve a
        // PENDIENTE para entrar de nuevo al flujo de pago (renovación que el
        // cliente reclama tras una cancelación del admin).
        await tx.membership.update({
          where: { id: existing.id },
          data: {
            planId: plan.id,
            montoPagado: null,
            pagoConfirmado: false,
            descuentoBienvenida,
            ...(['CANCELADA', 'VENCIDA', 'RECHAZADA'].includes(existing.estado)
              ? { estado: 'PENDIENTE' as const, rechazadoReason: null }
              : {}),
          },
        })
        membershipId = existing.id
      } else {
        // Create new membership with companyId
        const created = await tx.membership.create({
          data: {
            clienteId: cliente.id,
            companyId: cliente.companyId,
            planId: plan.id,
            userId: user.metadata.dbUserId || null,
            estado: 'PENDIENTE',
            descuentoBienvenida,
          },
        })
        membershipId = created.id
      }

      return { success: true, membershipId }
    })
    if (result.error) return result

    revalidatePath('/mis-membresias')
    revalidatePath('/cliente/planes')
    return result
  } catch (e) {
    console.error('[membresia] seleccionarPlan error:', e)
    return { error: 'Ocurrió un error inesperado. Intenta de nuevo.' }
  }
}

/**
 * El cliente con membresía ACTIVA solicita cambiar de plan (subir o bajar).
 * No toca el plan vigente: solo registra `planIdSolicitado`. El cambio se aplica
 * cuando el admin aprueba el comprobante del nuevo plan. Así el cliente no pierde
 * acceso mientras se procesa el cambio.
 */
/**
 * POLÍTICA (deshabilitada por decisión de negocio): una vez adquirido el plan,
 * el cliente NO puede cambiarlo desde la app. El cambio de plan lo realiza
 * únicamente el negocio desde su panel (cambiarPlanDeMembresia en
 * modules/admin/actions.ts). Se conserva la acción devolviendo un error claro
 * como defensa en profundidad ante clientes/formularios antiguos.
 */
export async function solicitarCambioPlan(
  _prev: SeleccionState,
  _formData: FormData
): Promise<SeleccionState> {
  return {
    error:
      'El cambio de plan lo gestiona el negocio. Solicítalo en el local y el equipo lo aplicará por ti.',
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
  const user = await getUser()
  if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId) {
    return { error: 'No autorizado.' }
  }

  // Rate limit form submissions to prevent spam
  const clientId = user.metadata.clienteId
  if (!(await formSubmitLimiter(clientId))) {
    return { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' }
  }

  const membershipId = String(formData.get('membershipId') ?? '').trim()
  const comprobanteUrl = String(formData.get('comprobanteUrl') ?? '').trim()
  const metodoPagoId = String(formData.get('metodoPagoId') ?? '').trim() || null
  const nota = String(formData.get('nota') ?? '').trim() || null

  if (!membershipId) return { error: 'Membresía no especificada.' }
  if (!comprobanteUrl) return { error: 'Adjunta el comprobante de pago.' }

  // El campo ya NO es una URL pública, es la RUTA dentro del bucket privado
  // que generó el servidor al firmar la subida (auditoría · C-01). Se
  // comprueba que corresponda a ESTA membresía: si no, alguien pidió una
  // subida legítima para lo suyo y luego intentó declararla como comprobante
  // de otro pago.
  if (!(await rutaValida('membresia', membershipId, comprobanteUrl))) {
    return { error: 'El comprobante adjunto no corresponde a este pago.' }
  }

  const membership = await sinEmpresa('membresia: buscar membresía para comprobante', (tx) =>
    tx.membership.findUnique({
      where: { id: membershipId },
      include: { cliente: { select: { id: true, nombre: true, companyId: true } } },
    })
  )
  if (!membership) return { error: 'Membresía no encontrada.' }
  if (membership.clienteId !== user.metadata.clienteId) {
    return { error: 'No autorizado.' }
  }

  // Comprobante de un cambio de plan: la membresía está ACTIVA y tiene un cambio
  // solicitado. No se cambia el estado (no pierde acceso); el admin lo aprueba.
  const esCambioDePlan =
    membership.estado === 'ACTIVA' && membership.planIdSolicitado != null

  if (!esCambioDePlan && !['PENDIENTE', 'RECHAZADA'].includes(membership.estado)) {
    return { error: 'Solo puedes enviar comprobante en estado Pendiente o Rechazado.' }
  }

  await conEmpresa(membership.cliente.companyId, (tx) =>
    tx.membership.update({
      where: { id: membershipId },
      data: {
        comprobanteUrl,
        comprobanteNota: nota,
        metodoPagoId: metodoPagoId || null,
        // En un cambio de plan la membresía sigue ACTIVA; en un pago normal pasa a
        // PENDIENTE_PAGO para entrar a la cola de validación del admin.
        ...(esCambioDePlan
          ? {}
          : { estado: 'PENDIENTE_PAGO', rechazadoReason: null }),
      },
    })
  )

  await notificarAdmins(membership.cliente.companyId, {
    tipo: 'NUEVO_COMPROBANTE',
    titulo: esCambioDePlan
      ? 'Comprobante de cambio de plan'
      : 'Nuevo comprobante de pago',
    mensaje: esCambioDePlan
      ? `${membership.cliente.nombre} envió el comprobante para su cambio de plan. Revísalo para aplicarlo.`
      : `${membership.cliente.nombre} envió un comprobante para su membresía. Revísalo para activarla.`,
    href: `/admin/pagos`,
  })

  revalidatePath('/mis-membresias')
  revalidatePath('/cliente/pagos')
  return { success: true }
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
