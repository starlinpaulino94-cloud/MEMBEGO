import 'server-only'

import { conEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { reintentarEntrega } from '@/modules/pagos/intentos'
import { asegurarVentaDelIntento } from '@/modules/pagos/venta-tarjeta'
import { situacionDeEntrega, type EstadoDeEntrega } from '@/modules/observabilidad/conciliacion-entrega'

/**
 * LAS ACCIONES DE LA CONCILIACIÓN — resolver un caso, con rastro.
 *
 * La lectura (`conciliacion.ts`) dice QUÉ no cuadra. Estas tres funciones son lo que una persona puede hacer al
 * respecto, y todas cumplen lo mismo:
 *
 *   · no recobran nada: el dinero ya entró por la pasarela; aquí solo se alinean el libro y la entrega;
 *   · son idempotentes: repetir el clic no duplica ni el comprobante ni la entrega;
 *   · se comprueban OTRA VEZ en el servidor: que la pantalla ofrezca un botón no basta para ejecutarlo;
 *   · dejan un asiento en la bitácora con quién la hizo y qué encontró.
 *
 * No llevan `'use server'` ni leen la sesión (`conciliacion-actions.ts` lo hace): reciben la empresa y el actor ya
 * resueltos, para poder probarse contra la base sin un navegador.
 */

export interface ActorDeConciliacion {
  /** `User.id` de quien actúa (no el id de autenticación). */
  userId: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

export type ResultadoDeAccion =
  | { ok: true; mensaje: string; ticketNumero?: string; /** La venta (para imprimir su comprobante sin salir de la pantalla). */ transactionId?: string }
  | { ok: false; error: string }

const falla = (error: string): ResultadoDeAccion => ({ ok: false, error })

async function cargarCobro(companyId: string, intentoId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.pagoIntento.findFirst({
      where: { id: intentoId, companyId },
      select: {
        id: true,
        estado: true,
        monto: true,
        fulfillmentEstado: true,
        fulfillmentError: true,
        updatedAt: true,
        activadoAt: true,
        membership: { select: { pagoConfirmado: true, fechaPago: true } },
        compra: { select: { pagoConfirmado: true, fechaActivacion: true } },
      },
    })
  )
}
type Cobro = NonNullable<Awaited<ReturnType<typeof cargarCobro>>>

const situacionDe = (c: Cobro, ahora: Date) =>
  situacionDeEntrega(
    { estado: c.fulfillmentEstado as EstadoDeEntrega, actualizadoAt: c.updatedAt, activadoAt: c.activadoAt, membership: c.membership, compra: c.compra },
    ahora
  )

type AccionDeBitacora = 'CONCILIACION_COMPROBANTE_GENERADO' | 'CONCILIACION_ENTREGA_REINTENTADA' | 'CONCILIACION_ENTREGA_MARCADA'

/** Asienta la acción en la bitácora. Un fallo aquí no deshace lo hecho (ya ocurrió): se deja en el log del servidor. */
async function asentar(companyId: string, actor: ActorDeConciliacion, accion: AccionDeBitacora, intentoId: string, payload: Record<string, unknown>) {
  await conEmpresa(companyId, (tx) =>
    tx.auditLog.create({
      data: {
        companyId,
        userId: actor.userId,
        accion,
        entidadTipo: 'PagoIntento',
        entidadId: intentoId,
        payload: payload as object,
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
      },
    })
  ).catch(anotarFallo('conciliacion:bitacora', { intentoId, accion }))
}

/** GENERAR COMPROBANTE — escribe la venta (con su ticket) de un cobro con tarjeta ya entregado que no la tenía. */
export async function generarComprobanteDeCobro(companyId: string, intentoId: string, actor: ActorDeConciliacion): Promise<ResultadoDeAccion> {
  const cobro = await cargarCobro(companyId, intentoId)
  if (!cobro) return falla('Cobro no encontrado.')
  if (cobro.estado !== 'APROBADO') return falla('Solo se genera el comprobante de un cobro aprobado.')
  if (cobro.fulfillmentEstado !== 'COMPLETADA') {
    return falla('El cliente todavía no recibió su producto: primero se entrega («Reintentar entrega» o «Marcar entregada»).')
  }
  const venta = await asegurarVentaDelIntento(intentoId)
  if (!venta) return falla('No se pudo registrar el comprobante. Revisa el registro del servidor e inténtalo de nuevo.')
  if (!venta.nueva) return { ok: true, mensaje: `Este cobro ya tenía su comprobante (${venta.ticketNumero}).`, ticketNumero: venta.ticketNumero, transactionId: venta.id }
  await asentar(companyId, actor, 'CONCILIACION_COMPROBANTE_GENERADO', intentoId, {
    ticketNumero: venta.ticketNumero,
    codigo: venta.codigo,
    monto: Number(cobro.monto),
    cobradoEn: cobro.activadoAt?.toISOString() ?? null,
  })
  return { ok: true, mensaje: `Comprobante generado (${venta.ticketNumero}).`, ticketNumero: venta.ticketNumero, transactionId: venta.id }
}

/** REINTENTAR ENTREGA — vuelve a activar el producto de un cliente que pagó y no lo tiene. Nunca recobra. */
export async function reintentarEntregaDeCobro(companyId: string, intentoId: string, actor: ActorDeConciliacion): Promise<ResultadoDeAccion> {
  const ahora = new Date()
  const cobro = await cargarCobro(companyId, intentoId)
  if (!cobro) return falla('Cobro no encontrado.')
  if (cobro.estado !== 'APROBADO') return falla('Solo se reintenta la entrega de un cobro aprobado.')
  const situacion = situacionDe(cobro, ahora)
  if (situacion === 'ENTREGADA') return { ok: true, mensaje: 'Este cobro ya estaba entregado.' }
  if (situacion === 'EN_CURSO') return falla('La entrega sigue en curso. Espera un par de minutos antes de reintentarla.')
  if (situacion === 'REGISTRO_SIN_CERRAR') {
    return falla('El producto ya está activo: no hay nada que reintentar. Usa «Marcar entregada» para cerrar el registro.')
  }

  const r = await reintentarEntrega(intentoId)
  await asentar(companyId, actor, 'CONCILIACION_ENTREGA_REINTENTADA', intentoId, {
    estadoAnterior: cobro.fulfillmentEstado,
    errorAnterior: cobro.fulfillmentError,
    resultado: r.entrega,
    error: r.error ?? null,
  })
  if (r.ok && r.entrega === 'COMPLETADA') return { ok: true, mensaje: 'Entrega completada: el cliente ya tiene su producto.' }
  return falla(r.error ? `La entrega no se pudo completar: ${r.error}` : 'La entrega no se pudo completar. Revisa la ficha del cliente.')
}

/**
 * MARCAR ENTREGADA — cierra el registro de un cobro cuyo producto YA está activo. Exige una nota y solo se permite con
 * evidencia: marcar «entregado» un cobro cuyo cliente no tiene su producto taparía justo el caso que la conciliación existe
 * para encontrar.
 */
export async function marcarCobroEntregado(companyId: string, intentoId: string, actor: ActorDeConciliacion, nota: string): Promise<ResultadoDeAccion> {
  const texto = nota.trim()
  if (texto.length < 5) return falla('Escribe una nota (al menos 5 caracteres) con el motivo de cerrar este cobro.')
  if (texto.length > 300) return falla('La nota es demasiado larga (máximo 300 caracteres).')

  const ahora = new Date()
  const cobro = await cargarCobro(companyId, intentoId)
  if (!cobro) return falla('Cobro no encontrado.')
  if (cobro.estado !== 'APROBADO') return falla('Solo se cierra un cobro aprobado.')
  const situacion = situacionDe(cobro, ahora)
  if (situacion === 'ENTREGADA') return { ok: true, mensaje: 'Este cobro ya estaba entregado.' }
  if (situacion === 'EN_CURSO') return falla('La entrega sigue en curso. Espera un par de minutos.')
  if (situacion === 'CLIENTE_ESPERANDO') {
    return falla('El cliente todavía no tiene su producto activo: no se puede marcar como entregado. Usa «Reintentar entrega».')
  }

  const evidencia = cobro.membership?.fechaPago ?? cobro.compra?.fechaActivacion ?? ahora
  const cerrado = await conEmpresa(companyId, (tx) =>
    tx.pagoIntento.updateMany({
      where: { id: intentoId, companyId, estado: 'APROBADO', fulfillmentEstado: { not: 'COMPLETADA' } },
      // La fecha de entrega es la de la ACTIVACIÓN que lo prueba, no la de hoy: el registro dice lo que pasó.
      data: { fulfillmentEstado: 'COMPLETADA', fulfillmentAt: evidencia, fulfillmentError: null },
    })
  )
  if (cerrado.count === 0) return falla('El cobro cambió mientras lo revisabas. Recarga la pantalla.')
  await asentar(companyId, actor, 'CONCILIACION_ENTREGA_MARCADA', intentoId, {
    nota: texto,
    estadoAnterior: cobro.fulfillmentEstado,
    entregadoEn: evidencia.toISOString(),
  })
  // Con la entrega cerrada, el cobro ya se puede facturar: si no tenía su comprobante, se escribe ahora.
  const venta = await asegurarVentaDelIntento(intentoId)
  return {
    ok: true,
    mensaje: venta?.nueva ? `Cobro cerrado y comprobante generado (${venta.ticketNumero}).` : 'Cobro cerrado como entregado.',
    ...(venta ? { ticketNumero: venta.ticketNumero, transactionId: venta.id } : {}),
  }
}
