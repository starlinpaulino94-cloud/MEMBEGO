import 'server-only'

import { conEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { reintentarEntrega } from '@/modules/pagos/intentos'
import { asegurarVentaDelIntento } from '@/modules/pagos/venta-tarjeta'
import {
  CAMBIO_DE_PLAN_PAGADO,
  DEMORA_SOSPECHOSA_MS,
  MOTIVOS_DE_CIERRE,
  NOTA_DE_CIERRE_MIN,
  entregaRequierePersona,
  esMotivoDeCierre,
  evidenciaDeEntrega,
  productoEliminado,
  situacionDeEntrega,
  type EstadoDeEntrega,
} from '@/modules/observabilidad/conciliacion-entrega'
import { activacionesEnBitacora } from '@/modules/observabilidad/conciliacion-bitacora'

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

/** El cobro con la MISMA evidencia que enseña la pantalla (bitácora incluida): el servidor no decide con menos datos que la persona. */
async function cargarCobro(companyId: string, intentoId: string) {
  return conEmpresa(companyId, async (tx) => {
    const cobro = await tx.pagoIntento.findFirst({
      where: { id: intentoId, companyId },
      select: {
        id: true,
        companyId: true,
        estado: true,
        monto: true,
        fulfillmentEstado: true,
        fulfillmentError: true,
        fulfillmentIntentos: true,
        updatedAt: true,
        activadoAt: true,
        canal: true,
        planDestinoId: true,
        membershipId: true,
        compraId: true,
        membership: { select: { pagoConfirmado: true, fechaPago: true, estado: true, planIdSolicitado: true } },
        compra: { select: { pagoConfirmado: true, fechaActivacion: true } },
      },
    })
    if (!cobro) return null
    const activaciones = await activacionesEnBitacora(tx, [cobro])
    return { ...cobro, activacionRegistrada: activaciones.get(cobro.id) ?? null }
  })
}
type Cobro = NonNullable<Awaited<ReturnType<typeof cargarCobro>>>

const situacionDe = (c: Cobro, ahora: Date) =>
  situacionDeEntrega(
    {
      estado: c.fulfillmentEstado as EstadoDeEntrega,
      actualizadoAt: c.updatedAt,
      activadoAt: c.activadoAt,
      membership: c.membership,
      compra: c.compra,
      activacionRegistrada: c.activacionRegistrada,
    },
    ahora
  )

export type AccionDeBitacora =
  | 'CONCILIACION_COMPROBANTE_GENERADO'
  | 'CONCILIACION_ENTREGA_REINTENTADA'
  | 'CONCILIACION_ENTREGA_MARCADA'
  | 'CONCILIACION_ENTREGA_CERRADA_SIN_ENTREGAR'

/** Asienta la acción en la bitácora. Un fallo aquí no deshace lo hecho (ya ocurrió): se deja en el log del servidor. */
export async function asentarEnBitacora(
  companyId: string,
  actor: ActorDeConciliacion,
  accion: AccionDeBitacora,
  intentoId: string,
  payload: Record<string, unknown>
) {
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
  const venta = await asegurarVentaDelIntento(intentoId, { explicito: true })
  if (!venta) return falla('No se pudo registrar el comprobante. Revisa el registro del servidor e inténtalo de nuevo.')
  if (!venta.nueva) return { ok: true, mensaje: `Este cobro ya tenía su comprobante (${venta.ticketNumero}).`, ticketNumero: venta.ticketNumero, transactionId: venta.id }
  await asentarEnBitacora(companyId, actor, 'CONCILIACION_COMPROBANTE_GENERADO', intentoId, {
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
  if (situacion === 'DESCARTADA') return falla('Este cobro ya se cerró sin entregar: no se reintenta.')
  if (situacion === 'EN_CURSO') return falla('La entrega sigue en curso. Espera un par de minutos antes de reintentarla.')
  if (situacion === 'REGISTRO_SIN_CERRAR') {
    // También cuando la membresía de HOY parece sin pagar: la bitácora dice que este cobro ya la activó, y reintentar le daría
    // otro periodo con el mismo pago.
    return falla('El producto de este cobro ya se activó: no hay nada que reintentar. Usa «Marcar entregada» para cerrar el registro.')
  }
  if (situacion === 'SIN_PRODUCTO') {
    return falla('La membresía o compra de este cobro ya no existe: no hay nada que entregar. Usa «Cerrar sin entregar».')
  }

  // Un cambio de plan pagado lo aplica una persona: reintentar solo toparía con «ya está activa».
  if (entregaRequierePersona({ canal: cobro.canal, planDestinoId: cobro.planDestinoId, membership: cobro.membership })) return falla(CAMBIO_DE_PLAN_PAGADO)

  const r = await reintentarEntrega(intentoId)
  await asentarEnBitacora(companyId, actor, 'CONCILIACION_ENTREGA_REINTENTADA', intentoId, {
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
  if (situacion === 'DESCARTADA') return falla('Este cobro ya se cerró sin entregar.')
  if (situacion === 'EN_CURSO') return falla('La entrega sigue en curso. Espera un par de minutos.')
  if (situacion === 'CLIENTE_ESPERANDO') {
    return falla('El cliente todavía no tiene su producto activo: no se puede marcar como entregado. Usa «Reintentar entrega».')
  }
  if (situacion === 'SIN_PRODUCTO') {
    return falla('No hay registro de que este producto se activara: no se puede marcar como entregado. Usa «Cerrar sin entregar».')
  }

  // La evidencia con la que se cierra, tal cual: qué activación se usó como prueba y cuánto tardó después del cobro. Una demora
  // larga no impide cerrar (puede ser la entrega perdida de verdad), pero queda dicho en la bitácora a nombre de quien la firmó.
  const prueba = evidenciaDeEntrega({
    activadoAt: cobro.activadoAt,
    membership: cobro.membership,
    compra: cobro.compra,
    activacionRegistrada: cobro.activacionRegistrada,
  })
  const evidencia = prueba?.fecha ?? cobro.membership?.fechaPago ?? cobro.compra?.fechaActivacion ?? ahora
  const cerrado = await conEmpresa(companyId, (tx) =>
    tx.pagoIntento.updateMany({
      where: { id: intentoId, companyId, estado: 'APROBADO', fulfillmentEstado: { in: ['PENDIENTE', 'PROCESANDO', 'FALLIDA'] } },
      // La fecha de entrega es la de la ACTIVACIÓN que lo prueba, no la de hoy: el registro dice lo que pasó.
      data: { fulfillmentEstado: 'COMPLETADA', fulfillmentAt: evidencia, fulfillmentError: null },
    })
  )
  if (cerrado.count === 0) return falla('El cobro cambió mientras lo revisabas. Recarga la pantalla.')
  await asentarEnBitacora(companyId, actor, 'CONCILIACION_ENTREGA_MARCADA', intentoId, {
    nota: texto,
    estadoAnterior: cobro.fulfillmentEstado,
    entregadoEn: evidencia.toISOString(),
    evidencia: prueba
      ? {
          fuente: prueba.fuente,
          fecha: prueba.fecha.toISOString(),
          demoraMs: prueba.demoraMs,
          demoraSospechosa: prueba.demoraMs >= DEMORA_SOSPECHOSA_MS,
        }
      : null,
  })
  // Con la entrega cerrada, el cobro ya se puede facturar: si no tenía su comprobante, se escribe ahora.
  const venta = await asegurarVentaDelIntento(intentoId, { explicito: true })
  return {
    ok: true,
    mensaje: venta?.nueva ? `Cobro cerrado y comprobante generado (${venta.ticketNumero}).` : 'Cobro cerrado como entregado.',
    ...(venta ? { ticketNumero: venta.ticketNumero, transactionId: venta.id } : {}),
  }
}

/**
 * CERRAR SIN ENTREGAR — quita de la conciliación un cobro cuya entrega NO va a ocurrir, por una causa que reintentar no
 * arregla: el dinero se devolvió en la pasarela, fue un cobro de prueba, el producto o la cuenta del cliente ya no existe, se
 * resolvió con el cliente por otra vía.
 *
 * No es «ocultar el aviso»: es cerrar el caso con una decisión firmada. Exige un motivo de la lista y una nota, deja el cobro
 * en `DESCARTADA` (estado final, sin venta: no se vendió nada) y el asiento de la bitácora se escribe en la MISMA transacción
 * que el cambio de estado —si la bitácora no lo acepta, el cobro no se cierra—: un cobro cerrado sin entregar sin saber
 * quién ni por qué sería exactamente el error invisible que la conciliación existe para evitar.
 *
 * Nunca para un producto que SÍ está activo: ése se cierra con «Marcar entregada» (y queda facturado). Uno que se activó y
 * después se borró admite las dos salidas: lo decide quien comprueba en la pasarela si el dinero se devolvió.
 */
export async function cerrarCobroSinEntregar(
  companyId: string,
  intentoId: string,
  actor: ActorDeConciliacion,
  motivo: unknown,
  nota: string
): Promise<ResultadoDeAccion> {
  if (!esMotivoDeCierre(motivo)) return falla('Elige el motivo por el que este cobro no se va a entregar.')
  const texto = nota.trim()
  if (texto.length < NOTA_DE_CIERRE_MIN) {
    return falla(`Escribe una nota (al menos ${NOTA_DE_CIERRE_MIN} caracteres) con lo que comprobaste: por ejemplo, la referencia del reembolso.`)
  }
  if (texto.length > 300) return falla('La nota es demasiado larga (máximo 300 caracteres).')

  const ahora = new Date()
  const cobro = await cargarCobro(companyId, intentoId)
  if (!cobro) return falla('Cobro no encontrado.')
  if (cobro.estado !== 'APROBADO') return falla('Solo se cierra un cobro aprobado.')
  const situacion = situacionDe(cobro, ahora)
  if (situacion === 'DESCARTADA') return { ok: true, mensaje: 'Este cobro ya estaba cerrado sin entregar.' }
  if (situacion === 'ENTREGADA') return falla('Este cobro ya está entregado: no hay nada que cerrar.')
  if (situacion === 'EN_CURSO') return falla('La entrega sigue en curso. Espera un par de minutos.')
  // Un producto que se activó y SIGUE existiendo contradice «no se entregó». Si ya se borró, no hay nada que lo contradiga:
  // la persona decide si fue entregado (y se factura) o si el dinero se devolvió.
  if (situacion === 'REGISTRO_SIN_CERRAR' && !productoEliminado(cobro)) {
    return falla('El producto de este cobro sí se activó: ciérralo con «Marcar entregada», que deja la venta en el libro.')
  }

  const etiqueta = MOTIVOS_DE_CIERRE.find((m) => m.codigo === motivo)?.etiqueta ?? motivo
  try {
    const cerrado = await conEmpresa(companyId, async (tx) => {
      const r = await tx.pagoIntento.updateMany({
        // `updatedAt` tal como se leyó: si el barrido o un reintento lo tocó mientras la persona decidía, no se cierra a ciegas.
        where: { id: intentoId, companyId, estado: 'APROBADO', fulfillmentEstado: cobro.fulfillmentEstado, updatedAt: cobro.updatedAt },
        data: { fulfillmentEstado: 'DESCARTADA', fulfillmentError: `Cerrado sin entregar: ${etiqueta}` },
      })
      if (r.count === 0) return false
      await tx.auditLog.create({
        data: {
          companyId,
          userId: actor.userId,
          accion: 'CONCILIACION_ENTREGA_CERRADA_SIN_ENTREGAR',
          entidadTipo: 'PagoIntento',
          entidadId: intentoId,
          payload: {
            motivo,
            nota: texto,
            monto: Number(cobro.monto),
            cobradoEn: cobro.activadoAt?.toISOString() ?? null,
            estadoAnterior: cobro.fulfillmentEstado,
            errorAnterior: cobro.fulfillmentError,
            intentosAnteriores: cobro.fulfillmentIntentos,
            situacion,
          },
          ipAddress: actor.ipAddress ?? null,
          userAgent: actor.userAgent ?? null,
        },
      })
      return true
    })
    if (!cerrado) return falla('El cobro cambió mientras lo revisabas. Recarga la pantalla.')
  } catch (e) {
    anotarFallo('conciliacion:cerrar-sin-entregar', { intentoId })(e)
    return falla('No se pudo cerrar el cobro. Revisa el registro del servidor e inténtalo de nuevo.')
  }
  return { ok: true, mensaje: 'Cobro cerrado sin entregar. Queda en la bitácora con tu motivo y tu nota.' }
}

export type ResultadoDeLote =
  | { ok: true; generados: number; yaTenian: number; fallidos: number; pendientes: number; mensaje: string }
  | { ok: false; error: string }

/** Cuántos comprobantes se generan por pulsación. Lo que sobre se genera pulsando otra vez: una pasada no puede durar de más. */
export const TOPE_DE_LOTE = 200

/**
 * GENERAR LOS COMPROBANTES PENDIENTES — la versión «todos a la vez» de «Generar comprobante», para ponerse al día con los pagos
 * con tarjeta anteriores a que existiera el comprobante.
 *
 * Es una ACCIÓN EXPLÍCITA de una persona, con la cifra a la vista antes de pulsar, y no una migración que corra sola: escribir
 * ventas con fecha pasada mueve los reportes de esos meses y por eso la decide el negocio. Cada comprobante lleva la fecha del
 * cobro, queda en la bitácora a nombre de quien pulsó (con `origen: 'LOTE'`) y repetir la acción no duplica nada.
 */
export async function generarComprobantesPendientes(
  companyId: string,
  ventanaDias: number,
  actor: ActorDeConciliacion,
  opciones: { ahora?: Date; tope?: number } = {}
): Promise<ResultadoDeLote> {
  if (!Number.isInteger(ventanaDias) || ventanaDias < 1 || ventanaDias > 366) return { ok: false, error: 'El periodo no es válido.' }
  const ahora = opciones.ahora ?? new Date()
  const tope = Math.min(opciones.tope ?? TOPE_DE_LOTE, TOPE_DE_LOTE)
  const desde = new Date(ahora.getTime() - ventanaDias * 86_400_000)

  const filas = await conEmpresa(companyId, (tx) =>
    tx.pagoIntento.findMany({
      where: { companyId, estado: 'APROBADO', fulfillmentEstado: 'COMPLETADA', transaccion: { is: null }, activadoAt: { gte: desde } },
      select: { id: true },
      orderBy: [{ activadoAt: 'asc' }, { id: 'asc' }],
      take: tope + 1,
    })
  )
  const aHacer = filas.slice(0, tope)
  let generados = 0
  let yaTenian = 0
  let fallidos = 0
  for (const { id } of aHacer) {
    const venta = await asegurarVentaDelIntento(id, { explicito: true })
    if (!venta) fallidos++
    else if (!venta.nueva) yaTenian++
    else {
      generados++
      await asentarEnBitacora(companyId, actor, 'CONCILIACION_COMPROBANTE_GENERADO', id, {
        origen: 'LOTE',
        ticketNumero: venta.ticketNumero,
        codigo: venta.codigo,
      })
    }
  }
  const pendientes = Math.max(0, filas.length - aHacer.length)
  const partes = [`${generados} ${generados === 1 ? 'comprobante generado' : 'comprobantes generados'}`]
  if (yaTenian > 0) partes.push(`${yaTenian} ya lo tenían`)
  if (fallidos > 0) partes.push(`${fallidos} no se pudieron generar (revisa el registro del servidor)`)
  if (pendientes > 0) partes.push(`quedan más: pulsa otra vez`)
  return { ok: true, generados, yaTenian, fallidos, pendientes, mensaje: `${partes.join(' · ')}.` }
}
