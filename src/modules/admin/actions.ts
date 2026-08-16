'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminUser, requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRequestMeta, periodEnd } from '@/lib/server-utils'
import { crearNotificacion } from '@/modules/notificaciones/service'
import { activarMembresia } from '@/modules/pagos/activacion'
import { registrarVentaConfirmada } from '@/modules/pagos/venta'
import { paymentLimiter } from '@/lib/rate-limit'
import { ensureEmailIdentity } from '@/lib/supabase/identity'
import { INVITABLE_ROLES, type AppRole } from '@/types'
import { anotarFallo } from '@/lib/prisma-errors'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'

/**
 * Ensure the membership belongs to the admin's company (superadmin = any).
 *
 * La búsqueda por id se hace en modo omnisciente a propósito: todavía no se
 * conoce la empresa del admin cuando hay que validar la pertenencia, y la
 * comprobación de ownership es la app (el caller ya autorizó). La segunda
 * barrera (RLS) se aplica a TODAS las demás consultas de la acción, que sí
 * conocen `cliente.companyId`.
 */
async function assertOwnership(
  membershipId: string,
  user: NonNullable<Awaited<ReturnType<typeof requireAdminUser>>>
) {
  const membership = await sinEmpresa(
    'assertOwnership: buscar la membresía por id antes de conocer la empresa',
    (tx) =>
      tx.membership.findUnique({
        where: { id: membershipId },
        include: { plan: true, cliente: true },
      })
  )
  if (!membership) return null
  // Fail-closed: un admin no-superadmin sin companyId no posee ninguna empresa.
  if (
    user.metadata.role !== 'SUPERADMIN' &&
    membership.cliente.companyId !== user.metadata.companyId
  ) {
    return null
  }
  return membership
}

export interface AdminActionState {
  error?: string
  success?: boolean
}

/**
 * Confirmar pago: PENDIENTE | PENDIENTE_PAGO -> ACTIVA.
 * Genera el QR del cliente si todavía no tiene uno activo.
 * Registra auditoría.
 */
export async function confirmarPago(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const user = await requireSection('pagos', 'confirmar_pago')
    if (!user) return { error: 'No autorizado.' }

    const adminId = user.metadata.dbUserId || 'anonymous'
    const isAllowed = await paymentLimiter(adminId)
    if (!isAllowed) {
      return { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' }
    }

    const membershipId = String(formData.get('membershipId') ?? '')
    const meta = await getRequestMeta()

    const membership = await assertOwnership(membershipId, user)
    if (!membership) return { error: 'Membresía no encontrada.' }
    const companyId = membership.cliente.companyId

    // Datos del cobro ANTES de activar (la activación aplica el cambio de
    // plan y limpia planIdSolicitado): plan efectivo, descuento y método.
    const extras = await conEmpresa(companyId, (tx) =>
      tx.membership.findUnique({
        where: { id: membershipId },
        select: {
          planSolicitado: { select: { nombre: true, precio: true } },
          metodoPago: { select: { tipo: true, nombre: true } },
          sucursalPago: { select: { id: true, nombre: true } },
          comprobanteNota: true,
        },
      })
    )
    const esCambio = membership.estado === 'ACTIVA' && membership.planIdSolicitado != null
    const planCobrado = esCambio ? extras?.planSolicitado : membership.plan
    const descuento = membership.fechaInicio == null ? Number(membership.descuentoBienvenida ?? 0) : 0
    const monto = Math.max(0, Number(planCobrado?.precio ?? 0) - descuento)
    const esTransferencia =
      extras?.metodoPago?.tipo === 'TRANSFERENCIA' ||
      (!extras?.metodoPago && membership.comprobanteUrl != null)

    const result = await activarMembresia(membershipId, user.metadata.dbUserId ?? null, meta)
    if (!result.ok) return { error: result.error }

    // Venta oficial del cobro confirmado: ticket + factura imprimible.
    // Antes este camino activaba sin dejar Transaction y el pago quedaba
    // fuera de la facturación (solo la caja generaba ticket).
    await registrarVentaConfirmada({
      companyId: membership.cliente.companyId,
      clienteId: membership.cliente.id,
      clienteNombre: membership.cliente.nombre,
      empleadoId: user.metadata.dbUserId ?? null,
      detalle: `${esCambio ? 'Cambio a ' : 'Plan '}${planCobrado?.nombre ?? ''}`.trim(),
      monto,
      metodoCobro: esTransferencia ? 'TRANSFERENCIA' : 'OTRO',
      metodoCobroLabel: esTransferencia
        ? 'Transferencia'
        : extras?.metodoPago?.tipo === 'PRESENCIAL'
          ? 'Pago en el local'
          : 'Confirmado por el negocio',
      // Recibo de pago (G6): banco/método + nota de referencia del cliente.
      referenciaPago:
        [extras?.metodoPago?.nombre, extras?.comprobanteNota?.trim()]
          .filter(Boolean)
          .join(' · ') || null,
      sucursalId: extras?.sucursalPago?.id ?? null,
      sucursalNombre: extras?.sucursalPago?.nombre ?? null,
      membershipId: membership.id,
      auditoria: meta,
    })

    const clienteUser = await conEmpresa(companyId, (tx) =>
      tx.user.findUnique({
        where: { supabaseId: result.supabaseId },
        select: { id: true },
      })
    )
    if (clienteUser) {
      await crearNotificacion({
        userId: clienteUser.id,
        tipo: 'PAGO_APROBADO',
        titulo: '¡Tu membresía está activa!',
        mensaje: `Tu pago para el plan "${result.planNombre}" fue confirmado. Ya puedes usar tu membresía.`,
        href: '/cliente/membresia',
      })
    }

    // Fase E6: la conversión del referido ahora se procesa DENTRO de
    // activarMembresia (punto de activación único); cualquier vía de
    // activación la dispara sin depender de este caller.

    revalidatePath(`/admin/clientes/${result.clienteId}`)
    revalidatePath('/admin/clientes')
    revalidatePath('/admin/dashboard')
    revalidatePath('/admin/pagos')
    revalidatePath('/superadmin/membresias')
    return { success: true }
  } catch (e) {
    console.error('[admin] confirmarPago error:', e)
    return { error: 'Ocurrió un error inesperado. Intenta de nuevo.' }
  }
}

/**
 * Aprobar un cambio de plan solicitado por el cliente (membresía ACTIVA con
 * planIdSolicitado). Aplica el nuevo plan y reinicia el período/usos.
 */
export async function aprobarCambioPlan(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const user = await requireSection('pagos', 'aprobar_cambio_plan')
    if (!user) return { error: 'No autorizado.' }

    const membershipId = String(formData.get('membershipId') ?? '')
    const membership = await assertOwnership(membershipId, user)
    if (!membership) return { error: 'Membresía no encontrada.' }
    if (!membership.planIdSolicitado) {
      return { error: 'Esta membresía no tiene un cambio de plan pendiente.' }
    }
    const companyId = membership.cliente.companyId
    const planIdSolicitado = membership.planIdSolicitado

    const nuevoPlan = await conEmpresa(companyId, (tx) =>
      tx.plan.findUnique({
        where: { id: planIdSolicitado },
      })
    )
    if (!nuevoPlan) return { error: 'El plan solicitado ya no existe.' }

    const now = new Date()
    await conEmpresa(companyId, (tx) =>
      tx.membership.update({
        where: { id: membership.id },
        data: {
          planId: nuevoPlan.id,
          planIdSolicitado: null,
          estado: 'ACTIVA',
          pagoConfirmado: true,
          montoPagado: nuevoPlan.precio,
          fechaPago: now,
          fechaInicio: now,
          fechaVencimiento: periodEnd(now, nuevoPlan.vigenciaDias),
          lavadosRestantes: nuevoPlan.esIlimitado ? 0 : nuevoPlan.lavadosIncluidos,
          rechazadoReason: null,
        },
      })
    )

    await conEmpresa(companyId, (tx) =>
      tx.auditLog.create({
        data: {
          companyId,
          userId: user.metadata.dbUserId ?? null,
          accion: 'PAGO_APROBADO',
          entidadTipo: 'Membership',
          entidadId: membership.id,
          payload: {
            cambioDePlan: true,
            planAnterior: membership.planId,
            planNuevo: nuevoPlan.id,
            monto: Number(nuevoPlan.precio),
          },
        },
      })
    )

    // Venta oficial del cambio cobrado: ticket + factura imprimible.
    const sucursalPagoId = membership.sucursalPagoId
    const sucursalPago = sucursalPagoId
      ? await conEmpresa(companyId, (tx) =>
          tx.sucursal.findUnique({
            where: { id: sucursalPagoId },
            select: { id: true, nombre: true },
          })
        )
      : null
    await registrarVentaConfirmada({
      companyId,
      clienteId: membership.cliente.id,
      clienteNombre: membership.cliente.nombre,
      empleadoId: user.metadata.dbUserId ?? null,
      detalle: `Cambio a ${nuevoPlan.nombre}`,
      monto: Number(nuevoPlan.precio),
      metodoCobro: membership.comprobanteUrl != null ? 'TRANSFERENCIA' : 'OTRO',
      metodoCobroLabel:
        membership.comprobanteUrl != null ? 'Transferencia' : 'Confirmado por el negocio',
      sucursalId: sucursalPago?.id ?? null,
      sucursalNombre: sucursalPago?.nombre ?? null,
      membershipId: membership.id,
    })

    const clienteUser = await conEmpresa(companyId, (tx) =>
      tx.user.findUnique({
        where: { supabaseId: membership.cliente.supabaseId },
        select: { id: true },
      })
    )
    if (clienteUser) {
      await crearNotificacion({
        userId: clienteUser.id,
        tipo: 'PAGO_APROBADO',
        titulo: 'Cambio de plan aprobado',
        mensaje: `Tu cambio al plan "${nuevoPlan.nombre}" fue aprobado y ya está activo.`,
        href: '/mis-membresias',
      })
    }

    revalidatePath('/admin/pagos')
    revalidatePath('/admin/clientes')
    revalidatePath('/mis-membresias')
    return { success: true }
  } catch (e) {
    console.error('[admin] aprobarCambioPlan error:', e)
    return { error: 'Ocurrió un error inesperado. Intenta de nuevo.' }
  }
}

/**
 * Cambio de plan DIRECTO por el negocio (política: el cliente no puede
 * cambiar su plan desde la app; lo hace el administrador aquí). Aplica el
 * nuevo plan de inmediato reiniciando período y usos, audita y notifica.
 */
export async function cambiarPlanDeMembresia(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const user = await requireSection('membresias', 'cambiar_plan')
    if (!user) return { error: 'No autorizado.' }

    const membershipId = String(formData.get('membershipId') ?? '')
    const planId = String(formData.get('planId') ?? '')
    if (!planId) return { error: 'Selecciona el nuevo plan.' }

    const membership = await assertOwnership(membershipId, user)
    if (!membership) return { error: 'Membresía no encontrada.' }
    if (membership.planId === planId) {
      return { error: 'Ese ya es el plan actual de esta membresía.' }
    }
    const companyId = membership.cliente.companyId

    const nuevoPlan = await conEmpresa(companyId, (tx) =>
      tx.plan.findUnique({ where: { id: planId } })
    )
    if (
      !nuevoPlan ||
      nuevoPlan.companyId !== companyId ||
      !nuevoPlan.activo
    ) {
      return { error: 'El plan seleccionado no es válido para esta empresa.' }
    }

    const now = new Date()
    await conEmpresa(companyId, (tx) =>
      tx.membership.update({
        where: { id: membership.id },
        data: {
          planId: nuevoPlan.id,
          planIdSolicitado: null,
          estado: 'ACTIVA',
          pagoConfirmado: true,
          montoPagado: nuevoPlan.precio,
          fechaPago: now,
          fechaInicio: now,
          fechaVencimiento: periodEnd(now, nuevoPlan.vigenciaDias),
          lavadosRestantes: nuevoPlan.esIlimitado ? 0 : nuevoPlan.lavadosIncluidos,
          rechazadoReason: null,
        },
      })
    )

    await conEmpresa(companyId, (tx) =>
      tx.auditLog.create({
        data: {
          companyId,
          userId: user.metadata.dbUserId ?? null,
          accion: 'PAGO_APROBADO',
          entidadTipo: 'Membership',
          entidadId: membership.id,
          payload: {
            cambioDePlan: true,
            cambioDirectoPorAdmin: true,
            planAnterior: membership.planId,
            planNuevo: nuevoPlan.id,
            monto: Number(nuevoPlan.precio),
          },
        },
      })
    )

    // Venta oficial del cambio aplicado: ticket + factura imprimible.
    await registrarVentaConfirmada({
      companyId,
      clienteId: membership.cliente.id,
      clienteNombre: membership.cliente.nombre,
      empleadoId: user.metadata.dbUserId ?? null,
      detalle: `Cambio a ${nuevoPlan.nombre}`,
      monto: Number(nuevoPlan.precio),
      metodoCobro: 'OTRO',
      metodoCobroLabel: 'Aplicado por el negocio',
      membershipId: membership.id,
    })

    const clienteUser = await conEmpresa(companyId, (tx) =>
      tx.user.findUnique({
        where: { supabaseId: membership.cliente.supabaseId },
        select: { id: true },
      })
    )
    if (clienteUser) {
      await crearNotificacion({
        userId: clienteUser.id,
        tipo: 'PAGO_APROBADO',
        titulo: 'Tu plan fue actualizado',
        mensaje: `El negocio actualizó tu membresía al plan "${nuevoPlan.nombre}". Ya está activo.`,
        href: '/mis-membresias',
      })
    }

    revalidatePath('/admin/membresias')
    revalidatePath('/admin/pagos')
    revalidatePath('/admin/clientes')
    revalidatePath('/mis-membresias')
    revalidatePath('/cliente/planes')
    return { success: true }
  } catch (e) {
    console.error('[admin] cambiarPlanDeMembresia error:', e)
    return { error: 'Ocurrió un error inesperado. Intenta de nuevo.' }
  }
}

/** Rechazar un cambio de plan: limpia la solicitud; el plan vigente no cambia. */
export async function rechazarCambioPlan(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const user = await requireSection('pagos', 'rechazar_cambio_plan')
    if (!user) return { error: 'No autorizado.' }

    const membershipId = String(formData.get('membershipId') ?? '')
    const motivo = String(formData.get('motivo') ?? '').trim()
    const membership = await assertOwnership(membershipId, user)
    if (!membership) return { error: 'Membresía no encontrada.' }
    if (!membership.planIdSolicitado) {
      return { error: 'Esta membresía no tiene un cambio de plan pendiente.' }
    }
    const companyId = membership.cliente.companyId

    await conEmpresa(companyId, (tx) =>
      tx.membership.update({
        where: { id: membership.id },
        data: { planIdSolicitado: null },
      })
    )

    const clienteUser = await conEmpresa(companyId, (tx) =>
      tx.user.findUnique({
        where: { supabaseId: membership.cliente.supabaseId },
        select: { id: true },
      })
    )
    if (clienteUser) {
      await crearNotificacion({
        userId: clienteUser.id,
        tipo: 'PAGO_RECHAZADO',
        titulo: 'Cambio de plan rechazado',
        mensaje: motivo
          ? `Tu solicitud de cambio de plan fue rechazada: ${motivo}`
          : 'Tu solicitud de cambio de plan fue rechazada. Tu plan actual sigue vigente.',
        href: '/mis-membresias',
      })
    }

    revalidatePath('/admin/pagos')
    revalidatePath('/mis-membresias')
    return { success: true }
  } catch (e) {
    console.error('[admin] rechazarCambioPlan error:', e)
    return { error: 'Ocurrió un error inesperado. Intenta de nuevo.' }
  }
}

/** Create a PENDIENTE membership for a cliente with the given plan. */
export async function crearMembresia(
  clienteId: string,
  planId: string,
  _companyId: string
): Promise<AdminActionState> {
  try {
    const user = await requireSection('pagos', 'crear_membresia')
    if (!user) return { error: 'No autorizado.' }

    const cliente = await sinEmpresa(
      'crearMembresia: buscar el cliente por id antes de conocer su empresa',
      (tx) => tx.cliente.findUnique({ where: { id: clienteId } })
    )
    if (!cliente) return { error: 'Cliente no encontrado.' }
    if (
      user.metadata.role !== 'SUPERADMIN' &&
      user.metadata.companyId &&
      cliente.companyId !== user.metadata.companyId
    ) {
      return { error: 'No autorizado.' }
    }
    const companyId = cliente.companyId

    const plan = await conEmpresa(companyId, (tx) =>
      tx.plan.findUnique({ where: { id: planId } })
    )
    if (!plan || plan.companyId !== companyId) {
      return { error: 'Plan no válido.' }
    }

    await conEmpresa(companyId, (tx) =>
      tx.membership.create({
        data: {
          clienteId,
          companyId,
          planId,
          estado: 'PENDIENTE',
          lavadosRestantes: plan.esIlimitado ? 0 : plan.lavadosIncluidos,
        },
      })
    )

    revalidatePath(`/admin/clientes/${clienteId}`)
    revalidatePath('/admin/clientes')
    revalidatePath('/admin/membresias')
    return { success: true }
  } catch (e) {
    console.error('[admin] crearMembresia error:', e)
    return { error: 'Ocurrió un error inesperado. Intenta de nuevo.' }
  }
}

/** Cancel a membership: estado -> CANCELADA. */
export async function cancelarMembresia(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const user = await requireSection('pagos', 'cancelar_membresia')
    if (!user) return { error: 'No autorizado.' }

    const membershipId = String(formData.get('membershipId') ?? '')
    const membership = await assertOwnership(membershipId, user)
    if (!membership) return { error: 'Membresía no encontrada.' }
    if (membership.estado === 'CANCELADA') {
      return { error: 'La membresía ya está cancelada.' }
    }

    const meta = await getRequestMeta()
    await conEmpresa(membership.cliente.companyId, async (tx) => {
      await tx.membership.update({
        where: { id: membership.id },
        data: { estado: 'CANCELADA' },
      })
      await tx.auditLog.create({
        data: {
          companyId: membership.cliente.companyId,
          userId: user.metadata.dbUserId ?? null,
          accion: 'MEMBRESIA_CANCELADA',
          entidadTipo: 'Membership',
          entidadId: membership.id,
          payload: { clienteId: membership.clienteId, planId: membership.planId },
          ...meta,
        },
      })
    })

    revalidatePath(`/admin/clientes/${membership.clienteId}`)
    revalidatePath('/admin/clientes')
    revalidatePath('/admin/membresias')
    return { success: true }
  } catch (e) {
    console.error('[admin] cancelarMembresia error:', e)
    return { error: 'Ocurrió un error inesperado. Intenta de nuevo.' }
  }
}

/**
 * Rechazar pago: PENDIENTE_PAGO -> RECHAZADA con motivo.
 */
export async function rechazarPago(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const user = await requireSection('pagos', 'rechazar_pago')
    if (!user) return { error: 'No autorizado.' }

    const membershipId = String(formData.get('membershipId') ?? '')
    const motivo = String(formData.get('motivo') ?? '').trim()
    const meta = await getRequestMeta()

    if (!motivo) return { error: 'Indica el motivo del rechazo.' }

    const membership = await assertOwnership(membershipId, user)
    if (!membership) return { error: 'Membresía no encontrada.' }

    await conEmpresa(membership.cliente.companyId, async (tx) => {
      await tx.membership.update({
        where: { id: membership.id },
        data: { estado: 'RECHAZADA', rechazadoReason: motivo },
      })

      await tx.auditLog.create({
        data: {
          companyId: membership.cliente.companyId,
          userId: user.metadata.dbUserId ?? null,
          accion: 'PAGO_RECHAZADO',
          entidadTipo: 'Membership',
          entidadId: membership.id,
          payload: { motivo, clienteId: membership.clienteId },
          ...meta,
        },
      })
    })

    const clienteUserRejected = await conEmpresa(membership.cliente.companyId, (tx) =>
      tx.user.findUnique({
        where: { supabaseId: membership.cliente.supabaseId },
        select: { id: true },
      })
    )
    if (clienteUserRejected) {
      await crearNotificacion({
        userId: clienteUserRejected.id,
        tipo: 'PAGO_RECHAZADO',
        titulo: 'Tu comprobante fue rechazado',
        mensaje: `Motivo: ${motivo}. Por favor sube un nuevo comprobante para continuar.`,
        href: '/cliente/membresia',
      })
    }

    revalidatePath(`/admin/clientes/${membership.clienteId}`)
    revalidatePath('/admin/clientes')
    revalidatePath('/admin/pagos')
    revalidatePath('/superadmin/membresias')
    return { success: true }
  } catch (e) {
    console.error('[admin] rechazarPago error:', e)
    return { error: 'Ocurrió un error inesperado. Intenta de nuevo.' }
  }
}

/** Renovar: nuevo período, reset lavadosRestantes, mantiene QR. */
export async function renovarMembresia(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
  const user = await requireSection('membresias', 'renovar')
  if (!user) return { error: 'No autorizado.' }

  const membershipId = String(formData.get('membershipId') ?? '')
  const meta = await getRequestMeta()

  const membership = await assertOwnership(membershipId, user)
  if (!membership) return { error: 'Membresía no encontrada.' }

  // CANCELADA incluida: el negocio puede reactivar/renovar una membresía que
  // canceló (p. ej. cancelación por error o cliente que regresa).
  const ESTADOS_RENOVABLES = ['ACTIVA', 'VENCIDA', 'CANCELADA']
  if (!ESTADOS_RENOVABLES.includes(membership.estado)) {
    return { error: `No se puede renovar una membresía en estado ${membership.estado}.` }
  }

  const now = new Date()

  /**
   * EL MONTO LO DECIDE EL SERVIDOR, NO EL FORMULARIO.
   *
   * Venía de un `<input type="hidden" name="monto">` pintado con el precio del
   * plan en el momento de renderizar la página. Ese número acababa en
   * `montoPagado` junto a `pagoConfirmado: true`, es decir, EN LOS INGRESOS.
   *
   * No hace falta mala fe para que salga mal: basta con dejar la pestaña
   * abierta, que se cambie el precio del plan y renovar — se registra el precio
   * viejo, como cobrado, y nada avisa. `confirmarPago` ya lo calculaba aquí;
   * renovar era el que se había quedado atrás.
   */
  const monto = Number(membership.plan.precio)
  const vigenciaDias = membership.plan.vigenciaDias ?? 30

  /**
   * RENOVAR NO PUEDE QUITAR LOS DÍAS QUE QUEDAN.
   *
   * El período nuevo empezaba SIEMPRE hoy. A quien renovaba con 20 días por
   * delante se le daban 30 y se le quitaban 20 — y el único que lo iba a notar
   * era el cliente, semanas después.
   *
   * Ahora se encadena: si todavía está vigente, el período nuevo arranca donde
   * terminaba el anterior. Si ya venció (o nunca tuvo fecha), arranca hoy.
   *
   * `fechaInicio` sí pasa a ser el arranque del período nuevo, que es lo que
   * significa el campo; lo que no se pierde es el tiempo pagado.
   */
  const sigueVigente = membership.fechaVencimiento != null && membership.fechaVencimiento > now
  const arranque = sigueVigente ? membership.fechaVencimiento! : now

  await conEmpresa(membership.cliente.companyId, async (tx) => {
    await tx.membership.update({
      where: { id: membership.id },
      data: {
        estado: 'ACTIVA',
        fechaInicio: arranque,
        fechaVencimiento: periodEnd(arranque, vigenciaDias),
        lavadosRestantes: membership.plan.esIlimitado
          ? 0
          : membership.plan.lavadosIncluidos,
        montoPagado: monto,
        pagoConfirmado: true,
        fechaPago: now,
      },
    })

    await tx.auditLog.create({
      data: {
        companyId: membership.cliente.companyId,
        userId: user.metadata.dbUserId ?? null,
        accion: 'MEMBRESIA_RENOVADA',
        entidadTipo: 'Membership',
        entidadId: membership.id,
        payload: {
          monto,
          // Encadenada o desde hoy: es lo que explica la fecha resultante
          // cuando alguien la revise dentro de tres meses.
          desde: arranque.toISOString(),
          encadenada: sigueVigente,
        },
        ...meta,
      },
    })
  })

  revalidatePath(`/admin/clientes/${membership.clienteId}`)
  revalidatePath('/admin/clientes')
  revalidatePath('/superadmin/membresias')
  return { success: true }
  } catch (e) {
    console.error('[admin] renovarMembresia error:', e)
    return { error: 'Ocurrió un error inesperado. Intenta de nuevo.' }
  }
}

/** Create a team member (rol elegible): Supabase auth user + DB User in the admin's company. */
export async function crearEmpleado(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    // Gestión de equipo: solo admin pleno (no Supervisor/Marketing).
    const user = await requireAdminUser()
    if (!user) return { error: 'No autorizado.' }

    const companyId = user.metadata.companyId
    if (!companyId) {
      return { error: 'Tu cuenta no está asociada a una empresa.' }
    }

    const nombre = String(formData.get('nombre') ?? '').trim()
    const email = String(formData.get('email') ?? '').trim().toLowerCase()
    const password = String(formData.get('password') ?? '')
    // Rol elegible (antes siempre EMPLEADO): el rol de la BD y el de la
    // sesión (app_metadata) se escriben JUNTOS — si divergen, el usuario ve
    // el panel equivocado aunque la tabla diga "Administrador".
    const rolRaw = String(formData.get('rol') ?? 'EMPLEADO').trim() as AppRole
    if (!INVITABLE_ROLES.includes(rolRaw)) {
      return { error: 'Rol inválido.' }
    }

    if (!nombre || !email || !password) {
      return { error: 'Todos los campos son obligatorios.' }
    }
    if (password.length < 6) {
      return { error: 'La contraseña debe tener al menos 6 caracteres.' }
    }

    const existing = await sinEmpresa(
      'crearEmpleado: verificar unicidad de email (el correo no pertenece a ninguna empresa)',
      (tx) => tx.user.findUnique({ where: { email } })
    )
    if (existing) {
      return { error: 'Ya existe un usuario con ese correo.' }
    }

    const supabase = createAdminClient()
    const { data: created, error: createError } =
      await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })

    if (createError || !created.user) {
      console.error('[admin] crearEmpleado supabase error:', createError)
      return { error: 'No se pudo crear el usuario de acceso.' }
    }

    const supabaseId = created.user.id

    // Garantiza la fila de identity (email) para que el login funcione.
    await ensureEmailIdentity(supabaseId, email)

    let dbUser
    try {
      dbUser = await conEmpresa(companyId, (tx) =>
        tx.user.create({
          data: {
            supabaseId,
            email,
            name: nombre,
            role: rolRaw,
            companyId,
          },
        })
      )
    } catch (e) {
      // Roll back the auth user so we don't leave an orphan.
      await supabase.auth.admin.deleteUser(supabaseId).catch(anotarFallo('admin:user.create'))
      throw e
    }

    await supabase.auth.admin.updateUserById(supabaseId, {
      app_metadata: {
        role: rolRaw,
        dbUserId: dbUser.id,
        companyId,
      },
    })

    revalidatePath('/admin/empleados')
    return { success: true }
  } catch (e) {
    console.error('[admin] crearEmpleado error:', e)
    return { error: 'Ocurrió un error inesperado. Intenta de nuevo.' }
  }
}

/** Delete an EMPLEADO from Supabase auth and the DB. */
export async function eliminarEmpleado(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    // Gestión de equipo: solo admin pleno.
    const user = await requireAdminUser()
    if (!user) return { error: 'No autorizado.' }

    const empleadoId = String(formData.get('empleadoId') ?? '')
    const empleado = await sinEmpresa(
      'eliminarEmpleado: buscar al miembro del equipo por id (superadmin puede ver cualquiera)',
      (tx) => tx.user.findUnique({ where: { id: empleadoId } })
    )
    // El equipo ahora puede tener cualquier rol invitable (no solo EMPLEADO).
    // SUPERADMIN y CLIENTE siguen fuera del alcance de esta acción.
    if (!empleado || !INVITABLE_ROLES.includes(empleado.role)) {
      return { error: 'Miembro del equipo no encontrado.' }
    }
    if (empleado.id === user.metadata.dbUserId) {
      return { error: 'No puedes eliminar tu propia cuenta.' }
    }
    if (
      user.metadata.role !== 'SUPERADMIN' &&
      empleado.companyId !== user.metadata.companyId
    ) {
      return { error: 'No autorizado.' }
    }
    const companyId = empleado.companyId
    if (!companyId) return { error: 'Miembro del equipo sin empresa.' }

    const supabase = createAdminClient()
    const { error: delError } = await supabase.auth.admin.deleteUser(
      empleado.supabaseId
    )
    if (delError) {
      console.error('[admin] eliminarEmpleado supabase error:', delError)
    }

    await conEmpresa(companyId, (tx) => tx.user.delete({ where: { id: empleado.id } }))

    revalidatePath('/admin/empleados')
    return { success: true }
  } catch (e) {
    console.error('[admin] eliminarEmpleado error:', e)
    return { error: 'Ocurrió un error inesperado. Intenta de nuevo.' }
  }
}

/**
 * Solicitar nueva evidencia: mantiene PENDIENTE_PAGO → RECHAZADA
 * pero con mensaje específico solicitando reenvío del comprobante.
 */
export async function solicitarNuevaEvidencia(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  const user = await requireSection('pagos', 'solicitar_evidencia')
  if (!user) return { error: 'No autorizado.' }

  const membershipId = String(formData.get('membershipId') ?? '')
  const motivo = String(formData.get('motivo') ?? '').trim()
  const meta = await getRequestMeta()

  if (!motivo) return { error: 'Indica el motivo de la solicitud.' }

  const membership = await assertOwnership(membershipId, user)
  if (!membership) return { error: 'Membresía no encontrada.' }
  if (membership.estado !== 'PENDIENTE_PAGO') {
    return { error: 'Solo se puede solicitar nueva evidencia cuando hay un comprobante pendiente.' }
  }

  try {
    await conEmpresa(membership.cliente.companyId, async (tx) => {
      await tx.membership.update({
        where: { id: membership.id },
        data: { estado: 'RECHAZADA', rechazadoReason: motivo, comprobanteUrl: null },
      })

      await tx.auditLog.create({
        data: {
          companyId: membership.cliente.companyId,
          userId: user.metadata.dbUserId ?? null,
          accion: 'PAGO_RECHAZADO',
          entidadTipo: 'Membership',
          entidadId: membership.id,
          payload: { motivo, tipo: 'solicitud_nueva_evidencia', clienteId: membership.clienteId },
          ...meta,
        },
      })
    })

    const clienteUser = await conEmpresa(membership.cliente.companyId, (tx) =>
      tx.user.findUnique({
        where: { supabaseId: membership.cliente.supabaseId },
        select: { id: true },
      })
    )
    if (clienteUser) {
      await crearNotificacion({
        userId: clienteUser.id,
        tipo: 'PAGO_RECHAZADO',
        titulo: 'Se requiere una nueva evidencia',
        mensaje: `El equipo revisó tu comprobante y necesita una imagen más clara. Motivo: ${motivo}. Por favor sube un nuevo comprobante.`,
        href: '/cliente/membresia',
      })
    }

    revalidatePath('/admin/pagos')
    revalidatePath(`/admin/clientes/${membership.clienteId}`)
    return { success: true }
  } catch (e) {
    console.error('[admin-evidence]', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

/**
 * Guardar nota interna sobre una membresía (solo visible para admins).
 * XSS protection: adminNota is auto-escaped by React JSX when rendered.
 * No additional sanitization needed if not rendered as .innerHTML.
 */
export async function guardarNotaInterna(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  const user = await requireSection('clientes', 'nota_crear')
  if (!user) return { error: 'No autorizado.' }

  const membershipId = String(formData.get('membershipId') ?? '')
  const nota = String(formData.get('nota') ?? '').trim()

  const membership = await assertOwnership(membershipId, user)
  if (!membership) return { error: 'Membresía no encontrada.' }

  const meta = await getRequestMeta()
  try {
    await conEmpresa(membership.cliente.companyId, async (tx) => {
      await tx.membership.update({
        where: { id: membership.id },
        data: { adminNota: nota || null },
      })
      await tx.auditLog.create({
        data: {
          companyId: membership.cliente.companyId,
          userId: user.metadata.dbUserId ?? null,
          accion: 'NOTA_INTERNA',
          entidadTipo: 'Membership',
          entidadId: membership.id,
          payload: { nota: nota || null },
          ...meta,
        },
      })
    })

    revalidatePath('/admin/pagos')
    revalidatePath(`/admin/clientes/${membership.clienteId}`)
    return { success: true }
  } catch (e) {
    console.error('[admin-notes]', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

/**
 * O-13: guarda la configuración del beneficio de bienvenida de la empresa.
 * Config de precios → solo admin PLENO de una empresa (no roles acotados,
 * no superadmin sin empresa).
 */
export async function guardarBienvenida(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const user = await requireAdminUser()
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Esta configuración es por empresa.' }

    const activa = formData.get('activa') === 'on'
    const tipo = String(formData.get('tipo') ?? 'PORCENTAJE')
    const valorRaw = String(formData.get('valor') ?? '').trim()
    const valor = valorRaw ? Number(valorRaw) : null

    if (!['PORCENTAJE', 'MONTO'].includes(tipo)) {
      return { error: 'Tipo de beneficio no válido.' }
    }
    if (activa) {
      if (valor == null || !Number.isFinite(valor) || valor <= 0) {
        return { error: 'Indica un valor mayor que 0 para activar el beneficio.' }
      }
      if (tipo === 'PORCENTAJE' && valor > 100) {
        return { error: 'El porcentaje no puede superar 100.' }
      }
    }

    await conEmpresa(companyId, (tx) =>
      tx.company.update({
        where: { id: companyId },
        data: {
          bienvenidaActiva: activa,
          bienvenidaTipo: tipo,
          bienvenidaValor: valor,
        },
      })
    )

    revalidatePath('/admin/planes')
    revalidatePath('/cliente/planes')
    return { success: true }
  } catch (e) {
    console.error('[admin] guardarBienvenida error:', e)
    return { error: 'Ocurrió un error inesperado. Intenta de nuevo.' }
  }
}
