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
import { cifrarTokenCardnet, descifrarTokenCardnet } from '@/lib/payments/cardnet-vault'

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
  cardnetCaptureSessionId?: string | null
}

/**
 * Persiste un perfil ya consultado directamente en CardNET. No acepta datos
 * del perfil enviados por el navegador y nunca activa la renovación.
 */
export async function guardarTarjeta(input: GuardarTarjetaInput) {
  if (!input.companyId || !input.clienteId || !input.customerId || !input.paymentProfileId || !input.token || input.token.length > 512) {
    throw new Error('CardNET no devolvió un perfil reusable válido.')
  }
  const tokenCifrado = cifrarTokenCardnet(input.token)
  return conEmpresa(input.companyId, async (tx) => {
    const existing = input.paymentProfileId
      ? await tx.tarjetaTokenizada.findFirst({
          where: {
            companyId: input.companyId,
            clienteId: input.clienteId,
            customerId: input.customerId,
            paymentProfileId: input.paymentProfileId,
            activa: true,
          },
        })
      : null
    if (existing) {
      return tx.tarjetaTokenizada.update({
        where: { id: existing.id },
        data: {
          tokenCifrado: existing.tokenCifrado ?? tokenCifrado,
          token: null,
          marca: input.marca?.slice(0, 32) ?? existing.marca,
          ultimos4: input.ultimos4 && /^\d{4}$/.test(input.ultimos4) ? input.ultimos4 : existing.ultimos4,
          vencMes: input.vencMes && input.vencMes >= 1 && input.vencMes <= 12 ? input.vencMes : existing.vencMes,
          vencAnio: input.vencAnio && input.vencAnio >= 2000 && input.vencAnio <= 9999 ? input.vencAnio : existing.vencAnio,
          consentimientoGuardadoAt: existing.consentimientoGuardadoAt ?? new Date(),
          ...(input.cardnetCaptureSessionId ? { cardnetCaptureSessionId: input.cardnetCaptureSessionId } : {}),
        },
      })
    }

    const primera = !(await tx.tarjetaTokenizada.findFirst({
      where: { companyId: input.companyId, clienteId: input.clienteId, activa: true },
      select: { id: true },
    }))
    try {
      return await tx.tarjetaTokenizada.create({
        data: {
          companyId: input.companyId,
          clienteId: input.clienteId,
          customerId: input.customerId,
          proveedorCuenta: 'CARDNET',
          paymentProfileId: input.paymentProfileId ?? null,
          tokenCifrado,
          cardnetCaptureSessionId: input.cardnetCaptureSessionId ?? null,
          marca: input.marca?.slice(0, 32) ?? null,
          ultimos4: input.ultimos4 && /^\d{4}$/.test(input.ultimos4) ? input.ultimos4 : null,
          vencMes: input.vencMes && input.vencMes >= 1 && input.vencMes <= 12 ? input.vencMes : null,
          vencAnio: input.vencAnio && input.vencAnio >= 2000 && input.vencAnio <= 9999 ? input.vencAnio : null,
          predeterminada: primera,
          consentimientoGuardadoAt: new Date(),
        },
      })
    } catch (error) {
      // El índice parcial arbitra dos solicitudes concurrentes que registran
      // el mismo perfil; se recupera la fila ganadora y no se duplica.
      if (input.paymentProfileId) {
        const winner = await tx.tarjetaTokenizada.findFirst({
          where: {
            companyId: input.companyId,
            clienteId: input.clienteId,
            customerId: input.customerId,
            paymentProfileId: input.paymentProfileId,
            activa: true,
          },
        })
        if (winner) return winner
      }
      // Otra tarjeta del mismo cliente pudo ganar el índice parcial del
      // predeterminado. El perfil nuevo sigue siendo válido; guárdalo sin
      // predeterminar y deja que el cliente lo elija desde su billetera.
      return tx.tarjetaTokenizada.create({
        data: {
          companyId: input.companyId,
          clienteId: input.clienteId,
          customerId: input.customerId,
          proveedorCuenta: 'CARDNET',
          paymentProfileId: input.paymentProfileId,
          tokenCifrado,
          cardnetCaptureSessionId: input.cardnetCaptureSessionId ?? null,
          marca: input.marca?.slice(0, 32) ?? null,
          ultimos4: input.ultimos4 && /^\d{4}$/.test(input.ultimos4) ? input.ultimos4 : null,
          vencMes: input.vencMes && input.vencMes >= 1 && input.vencMes <= 12 ? input.vencMes : null,
          vencAnio: input.vencAnio && input.vencAnio >= 2000 && input.vencAnio <= 9999 ? input.vencAnio : null,
          predeterminada: false,
          consentimientoGuardadoAt: new Date(),
        },
      }).catch(() => { throw error })
    }
  })
}

/** Tarjetas activas del cliente (para "Mis tarjetas"). Nunca expone el token. */
export async function listarTarjetasCliente(clienteId: string, companyId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.tarjetaTokenizada.findMany({
      where: { clienteId, companyId, OR: [{ activa: true }, { eliminacionPendiente: true }] },
      select: {
        id: true,
        marca: true,
        ultimos4: true,
        vencMes: true,
        vencAnio: true,
        createdAt: true,
        predeterminada: true,
        eliminacionPendiente: true,
      },
      orderBy: { createdAt: 'desc' },
    })
  )
}

/** Marca una tarjeta como predeterminada sin exponer ni aceptar referencias CardNET. */
export async function establecerTarjetaPredeterminada(id: string, clienteId: string, companyId: string): Promise<boolean> {
  return conEmpresa(companyId, async (tx) => {
    const tarjeta = await tx.tarjetaTokenizada.findFirst({
      where: { id, clienteId, companyId, activa: true, eliminacionPendiente: false },
      select: { id: true },
    })
    if (!tarjeta) return false
    await tx.tarjetaTokenizada.updateMany({
      where: { clienteId, companyId, activa: true, predeterminada: true },
      data: { predeterminada: false },
    })
    await tx.tarjetaTokenizada.update({ where: { id: tarjeta.id }, data: { predeterminada: true } })
    return true
  })
}

/** El cliente quita su tarjeta: se desactiva, se borra en CardNET y se apaga la renovación. */
export async function eliminarTarjeta(
  id: string,
  clienteId: string,
  companyId: string
): Promise<'eliminada' | 'pendiente' | 'no_encontrada'> {
  const tarjeta = await conEmpresa(companyId,
    (tx) => tx.tarjetaTokenizada.findFirst({ where: { id, companyId, clienteId } })
  ).catch(() => null)
  if (!tarjeta || (!tarjeta.activa && !tarjeta.eliminacionPendiente)) return 'no_encontrada'

  // Se revoca localmente antes de la llamada remota: aunque CardNET falle, el
  // backend deja de ofrecer esta referencia y registra el borrado pendiente.
  await conEmpresa(tarjeta.companyId, async (tx) => {
    await tx.tarjetaTokenizada.updateMany({
      where: { id, clienteId, activa: true },
      data: {
        activa: false,
        predeterminada: false,
        eliminacionPendiente: true,
        tokenCifrado: null,
        token: null,
      },
    })
    await tx.membership.updateMany({
      where: { tarjetaTokenizadaId: id },
      data: { autoRenovar: false, tarjetaTokenizadaId: null },
    })
    if (tarjeta.predeterminada) {
      const siguiente = await tx.tarjetaTokenizada.findFirst({
        where: { companyId: tarjeta.companyId, clienteId, activa: true, eliminacionPendiente: false },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      })
      if (siguiente) {
        await tx.tarjetaTokenizada.update({ where: { id: siguiente.id }, data: { predeterminada: true } })
      }
    }
  }).catch((error) => {
    anotarFallo('pagos:eliminarTarjeta:revocarLocal', { id })(error)
    throw error
  })

  const remotoEliminado = !tarjeta.paymentProfileId || await borrarPerfilCardnet({
    customerId: tarjeta.customerId,
    paymentProfileId: tarjeta.paymentProfileId,
  }).catch(() => false)
  if (remotoEliminado) {
    await conEmpresa(tarjeta.companyId, (tx) =>
      tx.tarjetaTokenizada.updateMany({ where: { id, clienteId }, data: { eliminacionPendiente: false } })
    )
    return 'eliminada'
  }
  return 'pendiente'
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
      token: m.tarjetaTokenizada.tokenCifrado
        ? descifrarTokenCardnet(m.tarjetaTokenizada.tokenCifrado)
        : m.tarjetaTokenizada.token,
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
