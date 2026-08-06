import 'server-only'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { anotarFallo, logErrorBd } from '@/lib/prisma-errors'
import { periodEnd } from '@/lib/server-utils'
import { puedeCobrarToken } from '@/modules/pagos/cardnetToken'
import {
  cobrarConCredencialGuardada,
  borrarPerfilCardnet,
} from '@/lib/payments/cardnet-tokens'

/**
 * FASE 2 — TARJETA GUARDADA Y RENOVACIÓN AUTOMÁTICA (CardNET tokenización).
 *
 * Guarda SOLO referencias de CardNET (customer/perfil) y datos de exhibición.
 * El cobro recurrente se hace server-to-server con esas referencias; la tarjeta
 * vive únicamente en CardNET. Nada de PAN/CVV toca este sistema.
 */

export interface GuardarTarjetaInput {
  companyId: string
  clienteId: string
  customerId: string
  paymentProfileId?: string | null
  token?: string | null
  marca?: string | null
  ultimos4?: string | null
  vencMes?: number | null
  vencAnio?: number | null
  /** Si se indica, enciende la renovación automática de esta membresía. */
  membershipId?: string | null
}

/** Persiste una tarjeta tokenizada y, si se pide, la ata a una membresía. */
export async function guardarTarjeta(input: GuardarTarjetaInput) {
  return conEmpresa(input.companyId, async (tx) => {
    const tarjeta = await tx.tarjetaTokenizada.create({
      data: {
        companyId: input.companyId,
        clienteId: input.clienteId,
        customerId: input.customerId,
        paymentProfileId: input.paymentProfileId ?? null,
        token: input.token ?? null,
        marca: input.marca ?? null,
        ultimos4: input.ultimos4 ?? null,
        vencMes: input.vencMes ?? null,
        vencAnio: input.vencAnio ?? null,
      },
    })

    if (input.membershipId) {
      await tx.membership
        .updateMany({
          // Solo si la membresía es de este cliente (barrera de pertenencia).
          where: { id: input.membershipId, clienteId: input.clienteId },
          data: { autoRenovar: true, tarjetaTokenizadaId: tarjeta.id },
        })
        .catch(anotarFallo('pagos:guardarTarjeta:ataMembresia', { membershipId: input.membershipId }))
    }

    return tarjeta
  })
}

/** Tarjetas activas del cliente (para "Mis tarjetas"). Nunca expone el token. */
export async function listarTarjetasCliente(clienteId: string, companyId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.tarjetaTokenizada.findMany({
      where: { clienteId, companyId, activa: true },
      select: {
        id: true,
        marca: true,
        ultimos4: true,
        vencMes: true,
        vencAnio: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })
  ).catch(() => [])
}

/** El cliente quita su tarjeta: se desactiva, se borra en CardNET y se apaga la renovación. */
export async function eliminarTarjeta(id: string, clienteId: string): Promise<boolean> {
  const tarjeta = await sinEmpresa(
    'pagos: localizar tarjeta tokenizada por id (su empresa se deriva de la tarjeta)',
    (tx) => tx.tarjetaTokenizada.findUnique({ where: { id } })
  ).catch(() => null)
  if (!tarjeta || tarjeta.clienteId !== clienteId || !tarjeta.activa) return false

  if (tarjeta.paymentProfileId) {
    await borrarPerfilCardnet({
      customerId: tarjeta.customerId,
      paymentProfileId: tarjeta.paymentProfileId,
    }).catch(() => false)
  }

  await conEmpresa(tarjeta.companyId, (tx) =>
    Promise.all([
      tx.membership.updateMany({
        where: { tarjetaTokenizadaId: id },
        data: { autoRenovar: false, tarjetaTokenizadaId: null },
      }),
      tx.tarjetaTokenizada.update({ where: { id }, data: { activa: false } }),
    ])
  ).catch(anotarFallo('pagos:eliminarTarjeta', { id }))
  return true
}

export type RenovacionResultado =
  | { estado: 'renovada'; nuevaVigencia: Date }
  | { estado: 'omitida'; motivo: string }
  | { estado: 'rechazada'; motivo: string }
  | { estado: 'error'; motivo: string }

// Margen: se renueva cuando faltan <= 1 día para vencer (o ya venció).
const MARGEN_MS = 24 * 60 * 60 * 1000
// Anti doble-cobro: no reintentar si ya hubo un intento en las últimas 12h.
const VENTANA_ANTIDUPLICADO_MS = 12 * 60 * 60 * 1000

/**
 * Cobra la tarjeta guardada de UNA membresía y la extiende si aprueba.
 *
 * Idempotencia práctica: al renovar, `fechaVencimiento` salta ~un período
 * adelante, así que el cron no la vuelve a elegir. Además, si ya hubo un intento
 * de renovación en las últimas 12h, se omite — evita el doble cobro si el cron
 * corre dos veces el mismo día.
 */
export async function renovarMembresiaPorTarjeta(
  membershipId: string,
  clienteIp = '0.0.0.0'
): Promise<RenovacionResultado> {
  const m = await sinEmpresa(
    'pagos: localizar membresía por id para renovación (su empresa se deriva de la membresía)',
    (tx) =>
      tx.membership.findUnique({
        where: { id: membershipId },
        include: { plan: true, tarjetaTokenizada: true },
      })
  ).catch(() => null)
  if (!m) return { estado: 'omitida', motivo: 'Membresía no encontrada.' }
  if (!m.autoRenovar || !m.tarjetaTokenizada || !m.tarjetaTokenizada.activa) {
    return { estado: 'omitida', motivo: 'Sin renovación automática o sin tarjeta activa.' }
  }
  if (!(await puedeCobrarToken(m.companyId))) {
    return { estado: 'omitida', motivo: 'La pasarela no está disponible para esta empresa.' }
  }

  // Guarda anti-duplicado: ¿ya intentamos renovarla hace poco?
  const reciente = await conEmpresa(m.companyId, (tx) =>
    tx.pagoIntento
      .findFirst({
        where: {
          membershipId,
          proveedor: 'CARDNET',
          createdAt: { gte: new Date(Date.now() - VENTANA_ANTIDUPLICADO_MS) },
        },
        select: { id: true },
      })
  ).catch(() => null)
  if (reciente) return { estado: 'omitida', motivo: 'Ya hubo un intento reciente.' }

  const pesos = Number(m.plan.precio)
  if (pesos <= 0) return { estado: 'omitida', motivo: 'Precio del plan no válido.' }

  const intento = await conEmpresa(m.companyId, (tx) =>
    tx.pagoIntento.create({
      data: {
        companyId: m.companyId,
        clienteId: m.clienteId,
        proveedor: 'CARDNET',
        membershipId,
        monto: pesos,
        moneda: 'DOP',
        estado: 'CREADO',
        ipAddress: clienteIp,
      },
    })
  )

  let cobro
  try {
    cobro = await cobrarConCredencialGuardada({
      customerId: m.tarjetaTokenizada.customerId,
      paymentProfileId: m.tarjetaTokenizada.paymentProfileId,
      token: m.tarjetaTokenizada.token,
      pesos,
      orden: intento.id,
      clienteIp,
    })
  } catch (e) {
    logErrorBd('pagos:renovacion:cobrar', e, { membershipId })
    await conEmpresa(m.companyId, (tx) =>
      tx.pagoIntento.update({ where: { id: intento.id }, data: { estado: 'ERROR', motivoRechazo: 'No se pudo contactar la pasarela.' } })
    ).catch(anotarFallo('pagos:renovacion:errorUpdate', { intentoId: intento.id }))
    return { estado: 'error', motivo: 'No se pudo contactar la pasarela.' }
  }

  if (!cobro.aprobada) {
    await conEmpresa(m.companyId, (tx) =>
      tx.pagoIntento
        .update({
          where: { id: intento.id },
          data: { estado: 'RECHAZADO', motivoRechazo: cobro.motivo ?? 'Rechazada', respuesta: (cobro.crudo ?? null) as never },
        })
    ).catch(anotarFallo('pagos:renovacion:rechazo', { intentoId: intento.id }))
    return { estado: 'rechazada', motivo: cobro.motivo ?? 'La tarjeta fue rechazada.' }
  }

  // Aprobada: extender la membresía (desde el vencimiento actual si aún es
  // futuro, si no desde hoy) y cerrar el intento de forma idempotente.
  const now = new Date()
  const base = m.fechaVencimiento && m.fechaVencimiento > now ? m.fechaVencimiento : now
  const nuevaVigencia = periodEnd(base, m.plan.vigenciaDias ?? 30)

  const marca = await conEmpresa(m.companyId, (tx) =>
    tx.pagoIntento.updateMany({
      where: { id: intento.id, activadoAt: null },
      data: {
        estado: 'APROBADO',
        activadoAt: now,
        autorizacion: cobro.autorizacion,
        respuesta: (cobro.crudo ?? null) as never,
      },
    })
  )
  if (marca.count === 0) return { estado: 'omitida', motivo: 'Ya estaba renovada.' }

  try {
    await conEmpresa(m.companyId, (tx) =>
      Promise.all([
        tx.membership.update({
          where: { id: membershipId },
          data: {
            estado: 'ACTIVA',
            fechaVencimiento: nuevaVigencia,
            lavadosRestantes: m.plan.esIlimitado ? 0 : m.plan.lavadosIncluidos,
            montoPagado: pesos,
            pagoConfirmado: true,
          },
        }),
        tx.auditLog.create({
          data: {
            companyId: m.companyId,
            userId: null,
            accion: 'PAGO_APROBADO',
            entidadTipo: 'Membership',
            entidadId: membershipId,
            payload: { motivo: 'renovacion_automatica_tarjeta', monto: pesos, intentoId: intento.id },
          },
        }),
      ])
    )
  } catch (e) {
    // El cobro SÍ ocurrió; no se revierte activadoAt. Se deja constancia.
    logErrorBd('pagos:renovacion:extension', e, { membershipId, intentoId: intento.id })
    await conEmpresa(m.companyId, (tx) =>
      tx.pagoIntento
        .update({ where: { id: intento.id }, data: { motivoRechazo: 'Cobrado, pero la extensión falló.' } })
    ).catch(anotarFallo('pagos:renovacion:extensionFallo', { intentoId: intento.id }))
    return { estado: 'error', motivo: 'Cobrado, pero la extensión falló. Revisar a mano.' }
  }

  // Recibo por correo al cliente (best-effort; el cobro ya está hecho).
  const { enviarConfirmacionPago } = await import('@/modules/pagos/correoConfirmacion')
  await enviarConfirmacionPago({
    companyId: m.companyId,
    clienteId: m.clienteId,
    planNombre: m.plan.nombre,
    monto: pesos,
    motivo: 'renovacion',
    vigenteHasta: nuevaVigencia,
  }).catch(anotarFallo('pagos:renovacion:correo', { membershipId }))

  return { estado: 'renovada', nuevaVigencia }
}

/** Membresías que toca renovar ahora (activas, con tarjeta, por vencer). */
export async function membresiasARenovar(limite = 200): Promise<string[]> {
  const corte = new Date(Date.now() + MARGEN_MS)
  const filas = await sinEmpresa(
    'pagos: el cron de renovación selecciona membresías por vencer de todas las empresas',
    (tx) =>
      tx.membership.findMany({
        where: {
          estado: 'ACTIVA',
          autoRenovar: true,
          tarjetaTokenizadaId: { not: null },
          tarjetaTokenizada: { activa: true },
          fechaVencimiento: { not: null, lte: corte },
        },
        select: { id: true },
        take: limite,
      })
  ).catch(() => [])
  return filas.map((f) => f.id)
}

/**
 * Corre una tanda de renovaciones. Lo llama el cron. Devuelve un resumen.
 */
export async function ejecutarRenovacionesTarjeta(): Promise<{
  candidatas: number
  renovadas: number
  rechazadas: number
  omitidas: number
  errores: number
}> {
  const ids = await membresiasARenovar()
  let renovadas = 0
  let rechazadas = 0
  let omitidas = 0
  let errores = 0
  for (const id of ids) {
    const r = await renovarMembresiaPorTarjeta(id)
    if (r.estado === 'renovada') renovadas++
    else if (r.estado === 'rechazada') rechazadas++
    else if (r.estado === 'omitida') omitidas++
    else errores++
  }
  return { candidatas: ids.length, renovadas, rechazadas, omitidas, errores }
}
