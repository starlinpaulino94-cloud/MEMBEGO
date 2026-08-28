/**
 * Punto de activación único para membresías.
 * Tanto la aprobación manual del admin como futuras pasarelas de pago
 * deben invocar esta función para garantizar un flujo consistente.
 *
 * IMPORTANTE: este módulo NO lleva la directiva 'use server'. `activarMembresia`
 * es una función interna de servidor que confía en el llamador para haber
 * autorizado la operación (p. ej. `confirmarPago` en admin/actions.ts, que valida
 * rol y pertenencia a la empresa). Exponerla como Server Action pública
 * permitiría activar membresías sin pagar. Solo debe invocarse server-to-server.
 */

import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { emitirEventoEstrategia } from '@/modules/estrategias/eventos'
import { procesarReferidoCompletado } from '@/modules/referidos/actions'
import { procesarConversionGrowth } from '@/modules/growth/registro'
import { registrarHitoInvitacion } from '@/modules/invitaciones/hitosConversion'
import { periodEnd } from '@/lib/server-utils'
import { anotarFallo } from '@/lib/prisma-errors'
import { nuevoTokenQr, vencimientoQr } from '@/modules/qr/token'
import { revalidateTag } from 'next/cache'
import { NAV_CLIENTE_TAG } from '@/modules/cliente/cacheTags'

type Meta = { ipAddress: string | null; userAgent: string | null }

type ActivarResult =
  | { ok: true; clienteId: string; companyId: string; supabaseId: string; planNombre: string; esPrimera: boolean }
  | { ok: false; error: string }

// Estados desde los que se permite activar una membresía.
const ESTADOS_ACTIVABLES = new Set(['PENDIENTE', 'PENDIENTE_PAGO', 'RECHAZADA', 'VENCIDA'])

export async function activarMembresia(
  membershipId: string,
  userId: string | null,
  meta: Meta
): Promise<ActivarResult> {
  // Se busca la membresía por id sin conocer aún la empresa (cross-tenant por
  // diseño: el caller ya autorizó; aquí solo se revalida estado y se lee el
  // contexto). Toda la mutación siguiente corre dentro de `conEmpresa`.
  const membership = await sinEmpresa(
    'activarMembresia: buscar la membresía por id antes de conocer su empresa',
    (tx) =>
      tx.membership.findUnique({
        where: { id: membershipId },
        include: { plan: true, cliente: true },
      })
  )
  if (!membership) return { ok: false, error: 'Membresía no encontrada.' }
  if (membership.estado === 'ACTIVA') return { ok: false, error: 'La membresía ya está activa.' }
  if (!ESTADOS_ACTIVABLES.has(membership.estado)) {
    return { ok: false, error: `No se puede activar una membresía en estado ${membership.estado}.` }
  }

  const now = new Date()
  const vigenciaDias = membership.plan.vigenciaDias ?? 30

  // O-13: el descuento de bienvenida solo aplica en la PRIMERA activación de
  // esta membresía (fechaInicio aún null); reactivaciones tras VENCIDA o
  // renovaciones pagan el precio completo aunque el campo siga con valor.
  const descuentoBienvenida =
    membership.fechaInicio == null ? Number(membership.descuentoBienvenida ?? 0) : 0
  const montoNeto = Math.max(0, Number(membership.plan.precio) - descuentoBienvenida)

  // esPrimera se calcula dentro de la transacción para evitar race condition
  // con activaciones concurrentes del mismo cliente EN ESTA EMPRESA.
  const { esPrimera } = await conEmpresa(membership.companyId, async (tx) => {
    const previasConfirmadas = await tx.membership.count({
      where: {
        clienteId: membership.clienteId,
        companyId: membership.companyId,
        pagoConfirmado: true,
      },
    })
    const esPrimera = previasConfirmadas === 0

    await tx.membership.update({
      where: { id: membership.id },
      data: {
        estado: 'ACTIVA',
        fechaInicio: now,
        fechaVencimiento: periodEnd(now, vigenciaDias),
        lavadosRestantes: membership.plan.esIlimitado ? 0 : membership.plan.lavadosIncluidos,
        montoPagado: montoNeto,
        pagoConfirmado: true,
        // Cuándo entró el dinero, de una vez y para siempre: los reportes
        // fechaban el cobro por `updatedAt`, así que cualquier edición
        // posterior lo movía de mes (auditoría · A-6).
        fechaPago: now,
        rechazadoReason: null,
        adminNota: null,
      },
    })

    // Create QR for this specific membership
    const newQr = await tx.qrToken.create({
      data: {
        clienteId: membership.clienteId,
        membresiaId: membership.id,
        token: nuevoTokenQr(), expiraAt: vencimientoQr(),
      },
    })

    await tx.auditLog.create({
      data: {
        companyId: membership.companyId,
        userId,
        accion: 'QR_GENERADO',
        entidadTipo: 'QrToken',
        entidadId: newQr.id,
        payload: {
          clienteId: membership.clienteId,
          membresiaId: membership.id,
          motivo: 'activacion_membresia',
        },
        ...meta,
      },
    })

    await tx.auditLog.create({
      data: {
        companyId: membership.companyId,
        userId,
        accion: 'PAGO_APROBADO',
        entidadTipo: 'Membership',
        entidadId: membership.id,
        payload: { planId: membership.planId, clienteId: membership.clienteId, monto: Number(membership.plan.precio) },
        ...meta,
      },
    })

    return { esPrimera }
  })

  // Bus de estrategias: pago aprobado = compra + membresía activa. Se emite
  // fuera de la transacción y nunca rompe la activación (el helper captura
  // sus propios errores).
  // Los hechos llevan también lo que los SISTEMAS SATÉLITE necesitan para
  // sincronizar (contacto del cliente, identidad y vigencia de la membresía).
  // Agregar claves es aditivo: las automatizaciones existentes no se afectan.
  const factsCliente = {
    nombre: membership.cliente.nombre,
    compras: esPrimera ? 1 : 2,
    email: membership.cliente.email ?? null,
    telefono: membership.cliente.telefono ?? null,
  }
  const factsMembresia = {
    plan: membership.plan.nombre,
    // `plan` es el NOMBRE (puede cambiar); `planId` es la identidad estable
    // con la que un sistema satélite casa el plan contra su catálogo.
    planId: membership.planId,
    id: membership.id,
    precio: montoNeto,
    esDePago: montoNeto > 0,
    vigenteHasta: periodEnd(now, vigenciaDias).toISOString(),
  }
  await emitirEventoEstrategia({
    companyId: membership.companyId,
    type: 'cliente.compro_servicio',
    subjectId: membership.clienteId,
    payload: { cliente: factsCliente, membresia: factsMembresia, compra: { tipo: 'membresia', monto: montoNeto } },
  })
  if (esPrimera) {
    await emitirEventoEstrategia({
      companyId: membership.companyId,
      type: 'cliente.primera_compra',
      subjectId: membership.clienteId,
      payload: { cliente: factsCliente, membresia: factsMembresia, compra: { tipo: 'membresia', monto: montoNeto } },
    })
  }
  await emitirEventoEstrategia({
    companyId: membership.companyId,
    type: 'membresia.activada',
    subjectId: membership.clienteId,
    payload: { cliente: factsCliente, membresia: factsMembresia },
  })

  // Fase E6: la conversión del referido se procesa en el punto de activación
  // ÚNICO (antes dependía de que cada caller lo recordara). Primera compra
  // confirmada = referido completado + recompensas, para CUALQUIER vía.
  if (esPrimera) {
    await procesarReferidoCompletado(membership.clienteId, membership.companyId, {
      origen: 'MEMBRESIA',
      monto: montoNeto,
    }).catch(anotarFallo('pagos:referido-completado'))
  }
  // Growth Engine 3.0: recompensas configurables del evento MEMBRESIA (incluye
  // reglas por plan específico, ej. Plan Gold → créditos). No bloquea.
  await procesarConversionGrowth(membership.clienteId, membership.companyId, {
    trigger: 'MEMBRESIA',
    planId: membership.planId,
  }).catch(anotarFallo('pagos:conversion-growth'))
  // Campañas "Invita y Gana": si este cliente llegó por una campaña de
  // invitación, su primera membresía es un hito del embudo (nunca rompe la
  // activación).
  await registrarHitoInvitacion(membership.clienteId, 'MEMBRESIA_ADQUIRIDA')

  // Regalos P2P (R3): si esta membresía fue un regalo, se marca entregado y
  // se notifica a ambas partes. Nunca rompe la activación.
  const { resolverRegaloPagado } = await import('@/modules/regalos/entrega')
  await resolverRegaloPagado({ membershipId })

  // Recibo por correo al cliente: sale por CUALQUIER vía de pago (tarjeta,
  // transferencia aprobada, sucursal) porque este es el punto único. Nunca
  // rompe la activación.
  const { enviarConfirmacionPago } = await import('@/modules/pagos/correoConfirmacion')
  await enviarConfirmacionPago({
    companyId: membership.companyId,
    clienteId: membership.clienteId,
    planNombre: membership.plan.nombre,
    monto: montoNeto,
    motivo: 'activacion',
    vigenteHasta: periodEnd(now, vigenciaDias),
  }).catch(anotarFallo('pagos:correo-confirmacion'))
  revalidateTag(NAV_CLIENTE_TAG, 'max')

  return {
    ok: true,
    clienteId: membership.clienteId,
    companyId: membership.cliente.companyId,
    supabaseId: membership.cliente.supabaseId,
    planNombre: membership.plan.nombre,
    esPrimera,
  }
}
