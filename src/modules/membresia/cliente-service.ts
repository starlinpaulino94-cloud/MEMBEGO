import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { formSubmitLimiter } from '@/lib/rate-limit'
import { asegurarClienteEnEmpresa } from '@/modules/cliente/afiliacion'
import { notificarAdmins } from '@/modules/notificaciones/service'
import { rutaValida } from '@/modules/storage/comprobantes'
import { estaVigente } from '@/modules/membresia/vigencia'
import { calcularDescuentoBienvenida } from '@/lib/bienvenida'
import { categoriaDeEmpresa, vehiculosDe } from '@/modules/elegibilidad'
import { requisitosParaAccion, decidirPlan } from '@/modules/elegibilidad/decidir'
import { calcularPagoCambioPlan } from '@/modules/membresia/prorrateo'
import { getPlanesPublic } from '@/modules/marketplace/cached'
import type { SessionUser } from '@/types'

export type MembresiaClienteResult =
  | { success: true; membershipId: string; importeAPagar?: number }
  | { error: string }

function esCliente(user: SessionUser): boolean {
  return user.metadata.role === 'CLIENTE'
}

export async function solicitarMembresiaCliente(
  user: SessionUser,
  input: { planId: string; vehicleId?: string }
): Promise<MembresiaClienteResult> {
  if (!esCliente(user)) return { error: 'No autorizado.' }
  if (!input.planId) return { error: 'Selecciona un plan.' }

  const planRef = await sinEmpresa('membresía: validar plan para compra de cliente', (tx) =>
    tx.plan.findUnique({
      where: { id: input.planId },
      select: { id: true, companyId: true, activo: true },
    })
  )
  if (!planRef?.activo) return { error: 'Este plan ya no está disponible.' }
  if (planRef.companyId !== user.metadata.companyId) {
    const planesVisibles = await getPlanesPublic({ limit: 60 })
    if (!planesVisibles.some((plan) => plan.id === input.planId)) {
      return { error: 'Este plan ya no está disponible para solicitarse en línea.' }
    }
  }

  const afiliacion = await asegurarClienteEnEmpresa(
    user.supabaseId,
    user.email,
    planRef.companyId
  )
  if ('error' in afiliacion) return { error: afiliacion.error }
  const clienteId = afiliacion.clienteId

  if (!(await formSubmitLimiter(clienteId))) {
    return { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' }
  }

  const result = await conEmpresa(planRef.companyId, async (tx) => {
    const cliente = await tx.cliente.findUnique({
      where: { id: clienteId },
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
    if (!cliente || cliente.supabaseId !== user.supabaseId) {
      return { error: 'No se encontró tu ficha en este negocio.' } as MembresiaClienteResult
    }

    const plan = await tx.plan.findFirst({
      where: { id: input.planId, companyId: cliente.companyId, activo: true },
    })
    if (!plan) return { error: 'Plan no válido para este negocio.' } as MembresiaClienteResult

    const existing = await tx.membership.findUnique({
      where: { clienteId_companyId: { clienteId: cliente.id, companyId: cliente.companyId } },
    })
    if (existing && estaVigente(existing)) {
      return {
        error: 'Ya tienes una membresía activa en este negocio. Puedes cambiar a un plan superior desde su detalle.',
      } as MembresiaClienteResult
    }

    const categoria = await categoriaDeEmpresa(tx, cliente.companyId)
    const vehiculos = await vehiculosDe(tx, cliente.id)
    const completos = vehiculos.filter((v) => v.placaNormalizada && v.tipoVehiculoId)
    const esCompraNueva = !existing
    let vehiculoSel: (typeof vehiculos)[number] | null = null

    if (esCompraNueva) {
      const requisitos = requisitosParaAccion({ accion: 'COMPRAR_PLAN', categoria, vehiculos })
      if (!requisitos.canProceed) {
        return {
          error: 'Para comprar una membresía aquí primero registra un vehículo con su placa y categoría. Puedes hacerlo desde tu cuenta.',
        } as MembresiaClienteResult
      }
      if (input.vehicleId) {
        vehiculoSel = completos.find((v) => v.id === input.vehicleId) ?? null
        if (!vehiculoSel && vehiculos.some((v) => v.id === input.vehicleId)) {
          return {
            error: 'Ese vehículo necesita placa y categoría para asociarlo a la membresía. Complétalo o elige otro.',
          } as MembresiaClienteResult
        }
        if (!vehiculoSel) {
          return { error: 'No encontramos ese vehículo en este negocio.' } as MembresiaClienteResult
        }
      }
      vehiculoSel = vehiculoSel ?? completos[0] ?? null

      if (vehiculoSel) {
        const precioCategoria = await tx.planPrecioCategoria.findFirst({
          where: { planId: plan.id, tipoVehiculoId: vehiculoSel.tipoVehiculoId!, activo: true },
          select: { precio: true },
        })
        const decision = decidirPlan(
          {
            id: plan.id,
            precioBase: Number(plan.precio),
            precioCategoria: precioCategoria ? Number(precioCategoria.precio) : null,
            nivelTarifarioMax: plan.nivelTarifarioMax,
          },
          vehiculoSel
        )
        if (!decision.puedeComprar) {
          return {
            error: 'Este plan no aplica al tipo de tu vehículo. Elige un plan compatible o consulta con el negocio.',
          } as MembresiaClienteResult
        }
      }
    } else if (input.vehicleId) {
      vehiculoSel = completos.find((v) => v.id === input.vehicleId) ?? null
    }

    const elegibleBienvenida = !existing || existing.fechaInicio == null
    const descuento = elegibleBienvenida
      ? calcularDescuentoBienvenida(cliente.company, Number(plan.precio))
      : 0
    const descuentoBienvenida = descuento > 0 ? descuento : null

    let membershipId: string
    if (existing) {
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
      const userRecord = await tx.user.findUnique({
        where: { supabaseId: user.supabaseId },
        select: { id: true },
      })
      const created = await tx.membership.create({
        data: {
          clienteId: cliente.id,
          companyId: cliente.companyId,
          planId: plan.id,
          userId: userRecord?.id ?? null,
          estado: 'PENDIENTE',
          descuentoBienvenida,
        },
      })
      membershipId = created.id
    }

    if (vehiculoSel) {
      await tx.membresiaVehiculo.deleteMany({ where: { membershipId } })
      await tx.membresiaVehiculo.create({
        data: {
          membershipId,
          vehiculoId: vehiculoSel.id,
          nivelTarifarioComprado: vehiculoSel.nivelTarifario ?? 1,
        },
      })
    }

    return { success: true, membershipId } as MembresiaClienteResult
  })

  return result
}

export async function solicitarCambioPlanCliente(
  user: SessionUser,
  input: { membershipId: string; planId: string }
): Promise<MembresiaClienteResult> {
  if (!esCliente(user)) return { error: 'No autorizado.' }
  if (!input.membershipId || !input.planId) return { error: 'Selecciona el plan al que quieres cambiar.' }

  const membership = await sinEmpresa('membresía: validar titularidad y plan actual', (tx) =>
    tx.membership.findUnique({
      where: { id: input.membershipId },
      select: {
        id: true,
        clienteId: true,
        estado: true,
        planId: true,
        planIdSolicitado: true,
        fechaVencimiento: true,
        plan: { select: { nombre: true, precio: true, vigenciaDias: true } },
        cliente: { select: { supabaseId: true, companyId: true } },
      },
    })
  )
  if (!membership) return { error: 'Membresía no encontrada.' }
  if (membership.cliente.supabaseId !== user.supabaseId) return { error: 'No autorizado.' }
  if (!(await formSubmitLimiter(membership.clienteId))) {
    return { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' }
  }
  if (membership.estado !== 'ACTIVA') {
    return { error: 'Solo puedes cambiar de plan con una membresía activa.' }
  }

  const planDestino = await conEmpresa(membership.cliente.companyId, (tx) =>
    tx.plan.findFirst({
      where: { id: input.planId, companyId: membership.cliente.companyId, activo: true },
      select: { id: true, precio: true },
    })
  )
  if (!planDestino) return { error: 'Ese plan no está disponible en este negocio.' }
  if (planDestino.id === membership.planId) return { error: 'Ese ya es tu plan actual.' }
  if (Number(planDestino.precio) <= Number(membership.plan.precio)) {
    return { error: 'Solo puedes cambiar a un plan de mayor valor. Para bajar de plan, habla con el negocio.' }
  }

  const yaPedido = membership.planIdSolicitado === planDestino.id
  await conEmpresa(membership.cliente.companyId, (tx) =>
    tx.membership.update({
      where: { id: membership.id },
      data: {
        planIdSolicitado: planDestino.id,
        ...(yaPedido
          ? {}
          : {
              comprobanteUrl: null,
              comprobanteNota: null,
              metodoPagoId: null,
              rechazadoReason: null,
            }),
      },
    })
  )

  const importeAPagar = calcularPagoCambioPlan({
    precioNuevo: Number(planDestino.precio),
    precioVigente: Number(membership.plan.precio),
    fechaVencimiento: membership.fechaVencimiento,
    vigenciaDias: membership.plan.vigenciaDias,
  }).aPagar

  return { success: true, membershipId: membership.id, importeAPagar }
}

export async function registrarComprobanteMembresiaCliente(
  user: SessionUser,
  input: { membershipId: string; path: string; metodoPagoId?: string | null; nota?: string | null }
): Promise<MembresiaClienteResult> {
  if (!esCliente(user)) return { error: 'No autorizado.' }
  if (!input.membershipId) return { error: 'Membresía no especificada.' }
  if (!input.path) return { error: 'Adjunta el comprobante de pago.' }
  if (!(await rutaValida('membresia', input.membershipId, input.path))) {
    return { error: 'El comprobante adjunto no corresponde a este pago.' }
  }

  const membership = await sinEmpresa('membresía: comprobar propietario del comprobante', (tx) =>
    tx.membership.findUnique({
      where: { id: input.membershipId },
      include: { cliente: { select: { id: true, supabaseId: true, nombre: true, companyId: true } } },
    })
  )
  if (!membership) return { error: 'Membresía no encontrada.' }
  if (membership.cliente.supabaseId !== user.supabaseId) return { error: 'No autorizado.' }
  if (!(await formSubmitLimiter(membership.cliente.id))) {
    return { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' }
  }

  const esCambioDePlan = membership.estado === 'ACTIVA' && membership.planIdSolicitado != null
  if (!esCambioDePlan && !['PENDIENTE', 'RECHAZADA'].includes(membership.estado)) {
    return { error: 'Solo puedes enviar comprobante si el pago está pendiente o fue rechazado.' }
  }

  const metodoPagoId = input.metodoPagoId?.trim() || null
  if (metodoPagoId) {
    const metodoValido = await conEmpresa(membership.cliente.companyId, (tx) =>
      tx.metodoPago.findFirst({
        where: { id: metodoPagoId, companyId: membership.cliente.companyId, activo: true, tipo: 'TRANSFERENCIA' },
        select: { id: true },
      })
    )
    if (!metodoValido) return { error: 'La cuenta de pago seleccionada ya no está disponible.' }
  }

  await conEmpresa(membership.cliente.companyId, (tx) =>
    tx.membership.update({
      where: { id: membership.id },
      data: {
        comprobanteUrl: input.path,
        comprobanteNota: input.nota?.trim() || null,
        metodoPagoId,
        ...(esCambioDePlan ? {} : { estado: 'PENDIENTE_PAGO', rechazadoReason: null }),
      },
    })
  )

  await notificarAdmins(membership.cliente.companyId, {
    tipo: 'NUEVO_COMPROBANTE',
    titulo: esCambioDePlan ? 'Comprobante de cambio de plan' : 'Nuevo comprobante de pago',
    mensaje: esCambioDePlan
      ? `${membership.cliente.nombre} envió el comprobante para su cambio de plan. Revísalo para aplicarlo.`
      : `${membership.cliente.nombre} envió un comprobante para su membresía. Revísalo para activarla.`,
    href: '/admin/pagos',
  })

  return { success: true, membershipId: membership.id }
}
