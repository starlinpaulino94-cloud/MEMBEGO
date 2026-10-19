import 'server-only'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { marcarEntrega } from '@/modules/pagos/intentos'
import { RECLAMO_PERDIDO, extenderMembresiaCobrada } from '@/modules/pagos/renovacion-extension'
import { asegurarVentaDelIntento } from '@/modules/pagos/venta-tarjeta'
import { anotarFallo, logErrorBd } from '@/lib/prisma-errors'
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

// Margen: se renueva cuando faltan <= 1 día para vencer.
const MARGEN_MS = 24 * 60 * 60 * 1000

/**
 * CUÁNTO ATRÁS SE PUEDE MIRAR. El suelo que faltaba.
 *
 * La selección pedía `fechaVencimiento <= ahora + 1 día` y nada más. Sin suelo,
 * eso no significa «vence mañana»: significa «vence mañana O venció en
 * cualquier momento del pasado». Una membresía que caducó en marzo y seguía
 * diciendo ACTIVA —porque el job diario que las vence no había pasado— entraba
 * en la tanda y se le COBRABA LA TARJETA meses después.
 *
 * El cron corre a diario, así que tres días cubren de sobra que un día falle,
 * se retrase o la cola se atasque. Lo que queda fuera es justo lo que nadie
 * quiere: resucitar cobrando algo que el cliente dio por terminado hace
 * semanas. Ésa renueva por el camino normal, con el cliente delante.
 */
const GRACIA_VENCIDA_MS = 3 * 24 * 60 * 60 * 1000
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

  // Guarda anti-duplicado: ¿ya intentamos renovarla hace poco? Y, aunque ya pasara esa ventana, ¿hay una renovación
  // aprobada de esta membresía que todavía no se entregó? Si la extensión falló, la membresía sigue por vencer y el cron la volvería a
  // elegir pasada la ventana: cobrar OTRA vez el mismo periodo. Ese cobro se resuelve con su entrega (reintento o
  // conciliación), no con un cobro nuevo.
  const reciente = await conEmpresa(m.companyId, (tx) =>
    tx.pagoIntento
      .findFirst({
        where: {
          membershipId,
          proveedor: 'CARDNET',
          OR: [
            { createdAt: { gte: new Date(Date.now() - VENTANA_ANTIDUPLICADO_MS) } },
            // Solo renovaciones recientes: un registro viejo sin cerrar de otro canal no debe frenar la renovación para siempre.
            {
              estado: 'APROBADO',
              canal: 'RENOVACION_AUTOMATICA',
              fulfillmentEstado: { not: 'COMPLETADA' },
              activadoAt: { gte: new Date(Date.now() - 30 * 86_400_000) },
            },
          ],
        },
        select: { id: true, estado: true },
      })
  ).catch(() => null)
  if (reciente) {
    return {
      estado: 'omitida',
      motivo: reciente.estado === 'APROBADO' ? 'Hay un cobro aprobado sin entregar: se resuelve en Conciliación.' : 'Ya hubo un intento reciente.',
    }
  }

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
        canal: 'RENOVACION_AUTOMATICA',
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

  // Aprobada: cerrar el cobro y extender la membresía (desde el vencimiento actual si aún es futuro, si no desde el
  // cobro). El cobro se reclama como cualquier entrega de pasarela —`PROCESANDO` con su `claimAt`—: si la extensión falla,
  // la entrega queda FALLIDA y `reintentarEntrega` la rehace sin recobrar (ver `renovacion-extension.ts`).
  const now = new Date()
  const claimAt = now
  const marca = await conEmpresa(m.companyId, (tx) =>
    tx.pagoIntento.updateMany({
      where: { id: intento.id, activadoAt: null },
      data: {
        estado: 'APROBADO',
        updatedAt: claimAt,
        activadoAt: now,
        fulfillmentEstado: 'PROCESANDO',
        fulfillmentIntentos: { increment: 1 },
        autorizacion: cobro.autorizacion,
        respuesta: (cobro.crudo ?? null) as never,
      },
    })
  )
  if (marca.count === 0) return { estado: 'omitida', motivo: 'Ya estaba renovada.' }

  let extension: Awaited<ReturnType<typeof extenderMembresiaCobrada>>
  try {
    extension = await extenderMembresiaCobrada({ companyId: m.companyId, intentoId: intento.id, claimAt })
  } catch (e) {
    extension = { ok: false, error: e instanceof Error && e.message === RECLAMO_PERDIDO ? RECLAMO_PERDIDO : 'Cobrado, pero la extensión falló.' }
    logErrorBd('pagos:renovacion:extension', e, { membershipId, intentoId: intento.id })
  }
  if (!extension.ok) {
    // El cobro SÍ ocurrió; no se revierte activadoAt. Si otro proceso ganó el reclamo, él decide el resultado. Si no, la
    // entrega queda FALLIDA con su motivo: caso de conciliación con reintento explícito.
    if (extension.error !== RECLAMO_PERDIDO) {
      await marcarEntrega(m.companyId, intento.id, false, 'Cobrado, pero la extensión falló.', claimAt)
      await conEmpresa(m.companyId, (tx) =>
        tx.pagoIntento
          .update({ where: { id: intento.id }, data: { motivoRechazo: 'Cobrado, pero la extensión falló.' } })
      ).catch(anotarFallo('pagos:renovacion:extensionFallo', { intentoId: intento.id }))
    }
    return { estado: 'error', motivo: 'Cobrado, pero la extensión falló. Revisar a mano.' }
  }
  const nuevaVigencia = extension.nuevaVigencia

  // El cobro automático también es una venta del libro, con su ticket y comprobante.
  await asegurarVentaDelIntento(intento.id)

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
  const ahora = Date.now()
  const corte = new Date(ahora + MARGEN_MS)
  const suelo = new Date(ahora - GRACIA_VENCIDA_MS)
  const filas = await sinEmpresa(
    'pagos: el cron de renovación selecciona membresías por vencer de todas las empresas',
    (tx) =>
      tx.membership.findMany({
        where: {
          estado: 'ACTIVA',
          autoRenovar: true,
          tarjetaTokenizadaId: { not: null },
          tarjetaTokenizada: { activa: true },
          // Una ventana, no una media recta: entre «venció hace poco» y
          // «vence mañana». Ver `GRACIA_VENCIDA_MS`.
          fechaVencimiento: { not: null, gte: suelo, lte: corte },
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
