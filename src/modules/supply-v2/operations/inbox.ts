import type { Prisma, SupplyV2ExternalEventStatus } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { sinEmpresa } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { fallo } from '../core/errores'
import { confirmarPagoEnTx, rechazarPagoEnTx } from '../commerce/checkout'
import {
  claseDeFallo,
  claveDeEvento,
  EVENTO_RESUELTO,
  huellaDePayload,
  identidadDeEvento,
  identidadValida,
  MENSAJES_DE_FALLO,
  nuevoCorrelationId,
  reprogramarTrasFallo,
  sanear,
  sanearError,
  validarEventoContraOrden,
  type CodigoDeFallo,
  type EventoDePago,
  type IdentidadEvento,
} from './domain'
import { emitirEfectoEnTx } from './outbox'
import { conciliarPagoExternoEnTx, transaccionYaUsadaEnTx } from './conciliacion'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · INBOX DE EVENTOS EXTERNOS (§4A, §4B).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * GENÉRICO A PROPÓSITO, Y NO CARDNET
 *
 * Supply 2.0 no cobra hoy con CardNET: sus pagos son transferencia, depósito,
 * efectivo o manual, y los confirma finanzas. Lo que falta no es «meter
 * CardNET», es poder RECIBIR un evento de pago de cualquier pasarela sin que
 * el dominio sepa de cuál.
 *
 * Por eso `provider` es texto y no un enum: conectar una pasarela mañana no
 * debe pedir una migración, y el dominio no importa nada de ningún proveedor.
 * Lo que un adaptador concreto tendrá que hacer —verificar la firma, traducir
 * su vocabulario al nuestro— es su trabajo, no el de esta capa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ORDEN DE CANDADOS (§5)
 *
 *   1. INBOX     advisory lock sobre `provider:idExterno:tipo`
 *   2. INBOX     `FOR UPDATE` sobre la fila del evento
 *   3. ORDEN     lo toma `confirmarPagoEnTx` (`ordenBloqueada`)
 *   4. oferta / lote / beneficio — lo que ya hacía el checkout
 *   5. OUTBOX    solo INSERT, nunca se bloquea
 *
 * El candado del inbox es el MÁS EXTERNO y solo lo pide este camino. Ningún
 * checkout lo toma, así que no puede haber abrazo mortal con una compra en
 * curso: para que lo hubiera, alguien tendría que tomar la orden ANTES del
 * inbox, y el único que toca el inbox es esto.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL PROVEEDOR EXTERNO NO ES LA FUENTE DE LA VERDAD
 *
 * Dice que cobró 1 000. Lo que decide si eso corresponde a esta compra es el
 * total de la compra, que es nuestro. Si no cuadran —otro monto, otra moneda,
 * una orden que no existe, un estado imposible— NO se toca el dinero: el
 * evento queda rechazado con su código y su rastro, y una persona lo mira.
 */

/**
 * Los tipos de evento con proceso propio. Lo que no está aquí se recibe, se
 * guarda y se ignora a propósito: recibir un aviso que no sabemos interpretar
 * no autoriza a adivinar qué quiso decir.
 */
const TIPOS_QUE_MANEJAMOS: readonly string[] = ['PAYMENT_CONFIRMED', 'PAYMENT_REJECTED']

/** Lo que entra por la puerta, ya traducido por el adaptador del proveedor. */
export interface EventoExternoEntrante extends IdentidadEvento {
  /** El cuerpo tal como lo manda el proveedor. Se guarda SANEADO. */
  payload: Record<string, unknown>
  /** La parte del cuerpo que el adaptador ya interpretó. */
  pago: EventoDePago
  /** Hilo de la operación. Si no viene, se acuña uno. */
  correlationId?: string | null
}

export interface EventoRegistrado {
  id: string
  status: SupplyV2ExternalEventStatus
  correlationId: string
  /** true cuando esta entrega es una repetición de una que ya llegó. */
  repetido: boolean
  /** true cuando el cuerpo no coincide con el de la primera entrega. */
  cuerpoDistinto: boolean
}

/**
 * PASO 1 · GUARDAR QUE LLEGÓ, antes de decidir nada.
 *
 * Se hace en su propia transacción corta y a propósito: si el procesamiento
 * falla, o el proceso muere, la prueba de que el evento llegó ya está escrita.
 * Un webhook que llegó y no dejó rastro es exactamente lo que impide responder
 * «¿llegó el aviso?» al investigar un pago.
 *
 * La identidad `(provider, externalEventId, eventType)` la sostiene un índice
 * único: cinco entregas del mismo evento son UNA fila. La carrera entre dos
 * entregas simultáneas la resuelve la base con P2002, no una comprobación
 * previa que las dos pasarían.
 */
export async function registrarEventoExterno(e: EventoExternoEntrante): Promise<EventoRegistrado> {
  const error = identidadValida(e)
  if (error) fallo('EVENTO_INVALIDO', error)
  const id = identidadDeEvento(e)
  const hash = huellaDePayload(e.payload)
  const correlationId = e.correlationId?.trim() || nuevoCorrelationId()

  const leerPrevio = () =>
    sinEmpresa('Supply 2.0: leer un evento externo ya registrado', (tx) =>
      tx.supplyV2ExternalEvent.findUniqueOrThrow({
        where: { provider_externalEventId_eventType: id },
        select: { id: true, status: true, correlationId: true, payloadHash: true },
      })
    )

  // Atajo para el caso común —el proveedor reintenta un evento que ya
  // procesamos—: responder sin intentar un `INSERT` que se sabe que va a
  // chocar. Es solo un atajo: la corrección NO depende de él, porque dos
  // entregas simultáneas pasan las dos por aquí. De eso responde el índice.
  const yaEstaba = await sinEmpresa('Supply 2.0: ¿este evento ya llegó?', (tx) =>
    tx.supplyV2ExternalEvent.findUnique({
      where: { provider_externalEventId_eventType: id },
      select: { id: true, status: true, correlationId: true, payloadHash: true },
    })
  )
  if (yaEstaba) {
    return {
      id: yaEstaba.id,
      status: yaEstaba.status,
      correlationId: yaEstaba.correlationId,
      repetido: true,
      cuerpoDistinto: yaEstaba.payloadHash !== hash,
    }
  }

  try {
    return await sinEmpresa('Supply 2.0: registrar un evento externo', async (tx) => {
      const fila = await tx.supplyV2ExternalEvent.create({
        data: {
          ...id,
          payloadHash: hash,
          payload: cuerpoGuardado(e),
          correlationId,
          status: 'RECEIVED',
        },
        select: { id: true, status: true, correlationId: true },
      })
      return { ...fila, repetido: false, cuerpoDistinto: false }
    })
  } catch (err) {
    if (!esClaveDuplicada(err)) throw err
    // La identidad ya estaba: o llegó antes, o otra entrega simultánea ganó la
    // carrera. Es idempotencia funcionando, no un error.
    //
    // La lectura va FUERA de la transacción que falló, y eso no es un detalle:
    // en PostgreSQL un `INSERT` que viola el índice único ABORTA la transacción
    // entera, y Prisma no abre savepoints, así que cualquier consulta que se
    // intentara después dentro de ella respondería 25P02 —«transacción
    // abortada»— y la quinta entrega simultánea de un webhook acabaría
    // devolviendo un error de infraestructura en vez de «esto ya llegó».
    const ganadora = await leerPrevio()
    return {
      id: ganadora.id,
      status: ganadora.status,
      correlationId: ganadora.correlationId,
      repetido: true,
      cuerpoDistinto: ganadora.payloadHash !== hash,
    }
  }
}

/** P2002 de Prisma o 23505 de PostgreSQL: la identidad ya existe. */
function esClaveDuplicada(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  if (code === 'P2002' || code === '23505') return true
  // Un `$executeRaw` envuelve el 23505 en el mensaje, sin código propio.
  return typeof (err as { message?: unknown }).message === 'string' && /23505/.test((err as { message: string }).message)
}

export type ResultadoProceso =
  | { resultado: 'PROCESADO'; orderId: string; correlationId: string }
  | { resultado: 'REPETIDO'; status: SupplyV2ExternalEventStatus; correlationId: string }
  | { resultado: 'IGNORADO'; codigo: CodigoDeFallo; motivo: string; correlationId: string }
  /** `incidentId` desde el bloque 3: el rechazo ya viene con su tarea abierta. */
  | { resultado: 'RECHAZADO'; codigo: CodigoDeFallo; motivo: string; correlationId: string; incidentId: string | null }
  | { resultado: 'REINTENTABLE'; motivo: string; proximoIntento: Date | null; correlationId: string }

/**
 * PASO 2 · PROCESARLO, con el candado puesto.
 *
 * Todo lo que mueve dinero ocurre en UNA transacción: confirmar el pago, emitir
 * los derechos (ya lo hace `confirmarPagoEnTx`), reconocer la economía y
 * apuntar el efecto en el outbox. Lo que NO ocurre dentro es el envío: eso lo
 * hace la cola después, y por eso una notificación caída no puede revertir una
 * compra.
 */
export async function procesarEventoExterno(
  eventoId: string,
  ctx: ContextoAuditoria,
  ahora = new Date()
): Promise<ResultadoProceso> {
  return sinEmpresa('Supply 2.0: procesar un evento externo', async (tx) => {
    const fila = await bloquearEvento(tx, eventoId)

    // Ya resuelto: no vuelve a entrar al camino del dinero. Esta es la otra
    // mitad de la idempotencia —la primera es el índice único—.
    if (EVENTO_RESUELTO.includes(fila.status)) {
      return { resultado: 'REPETIDO' as const, status: fila.status, correlationId: fila.correlationId }
    }

    await tx.supplyV2ExternalEvent.update({ where: { id: fila.id }, data: { status: 'PROCESSING' } })

    const pago = leerPago(fila.payload)
    const orden = await buscarOrden(tx, pago)

    // El TIPO se mira ANTES que el dinero. Validar el importe de un evento que
    // no vamos a atender diría «el monto no cuadra» de algo que nunca iba a
    // mover un peso: la razón de no hacer nada sería falsa, y quien leyera la
    // bitácora buscaría un descuadre que no existe. Lo que no sabemos manejar
    // se deja dicho y punto.
    if (!TIPOS_QUE_MANEJAMOS.includes(fila.eventType)) {
      await tx.supplyV2ExternalEvent.update({
        where: { id: fila.id },
        data: {
          status: 'IGNORED',
          orderId: orden?.id ?? null,
          lastError: `TIPO_NO_MANEJADO: ${MENSAJES_DE_FALLO.TIPO_NO_MANEJADO}`,
          nextAttemptAt: null,
        },
      })
      await auditarEnTx(tx, ctx, 'SUPPLY_V2_EXTERNAL_EVENT_IGNORED', 'SupplyV2ExternalEvent', fila.id, {
        provider: fila.provider,
        eventType: fila.eventType,
        codigo: 'TIPO_NO_MANEJADO',
        clase: 'DESCARTABLE',
        correlationId: fila.correlationId,
        orderNumber: orden?.number ?? null,
      }, null)
      return {
        resultado: 'IGNORADO' as const,
        codigo: 'TIPO_NO_MANEJADO' as const,
        motivo: MENSAJES_DE_FALLO.TIPO_NO_MANEJADO,
        correlationId: fila.correlationId,
      }
    }

    const codigo = validarEventoContraOrden(pago, orden)

    if (codigo) {
      const clase = claseDeFallo(codigo)
      const motivo = MENSAJES_DE_FALLO[codigo]
      // Ni DESCARTABLE ni INCIDENTE tocan el dinero. La diferencia es qué hay
      // que hacer después: lo descartable no necesita a nadie; lo que no cuadra
      // sí, y por eso queda en la bitácora con su código.
      const status: SupplyV2ExternalEventStatus = 'IGNORED'
      await tx.supplyV2ExternalEvent.update({
        where: { id: fila.id },
        data: { status, lastError: `${codigo}: ${motivo}`, orderId: orden?.id ?? null, nextAttemptAt: null },
      })
      await auditarEnTx(
        tx,
        ctx,
        clase === 'INCIDENTE' ? 'SUPPLY_V2_EXTERNAL_EVENT_FAILED' : 'SUPPLY_V2_EXTERNAL_EVENT_IGNORED',
        'SupplyV2ExternalEvent',
        fila.id,
        { provider: fila.provider, eventType: fila.eventType, codigo, clase, correlationId: fila.correlationId, orderNumber: orden?.number ?? null },
        null
      )
      // ── SLICE 9 · BLOQUE 3: el rechazo deja TAREA, no solo rastro ────────
      //
      // Hasta el bloque 2 esto acababa aquí: evento rechazado, bitácora puesta,
      // cero efecto financiero. Evitaba el daño y no dejaba nada que nadie
      // pudiera trabajar. Lo que no cuadra abre ahora un incidente —en ESTA
      // misma transacción, para que el rechazo y su explicación sean la misma
      // escritura— con dueño, severidad y motivo.
      //
      // Solo lo DESCARTABLE se queda sin incidente, y es deliberado: una orden
      // ya pagada o un tipo que no manejamos no son desacuerdos financieros.
      // Lo de la puerta —firma, frescura, cuerpo, proveedor— no llega hasta
      // aquí y tampoco debe: eso es seguridad de la integración, no finanzas.
      let incidentId: string | null = null
      if (clase === 'INCIDENTE') {
        const r = await conciliarPagoExternoEnTx(
          tx,
          {
            provider: fila.provider,
            externalTransactionId: transaccionDelPayload(fila.payload),
            externalEventRowId: fila.id,
            orderId: orden?.id ?? null,
            correlationId: fila.correlationId,
            externo: {
              estado: fila.eventType === 'PAYMENT_REJECTED' ? 'FAILED' : 'PAID',
              monto: pago.amount ?? null,
              moneda: pago.currency ?? null,
            },
          },
          ctx,
          ahora
        )
        incidentId = r.incidentId
      }

      return clase === 'INCIDENTE'
        ? { resultado: 'RECHAZADO' as const, codigo, motivo, correlationId: fila.correlationId, incidentId }
        : { resultado: 'IGNORADO' as const, codigo, motivo, correlationId: fila.correlationId }
    }

    if (!orden) fallo('ORDEN_DESCONOCIDA', MENSAJES_DE_FALLO.ORDEN_DESCONOCIDA)

    // ── El dinero, en la misma transacción ───────────────────────────────
    if (fila.eventType === 'PAYMENT_CONFIRMED') {
      // ── SLICE 9 · BLOQUE 3: ¿esta transacción ya era de otra compra? ────
      //
      // Se mira ANTES de confirmar, y ese orden es la regla: una vez pagada la
      // compra, descubrir que el cobro era de otra es un problema que ya costó
      // dinero. Un identificador de transacción es único en el sistema del
      // proveedor; verlo en dos compras significa que o se reutilizó, o el
      // proveedor se equivocó, o estamos a punto de dar por pagadas dos
      // compras con un solo cobro. La segunda asociación NO se acepta.
      const transaccion = transaccionDelPayload(fila.payload)
      if (transaccion) {
        const yaUsada = await transaccionYaUsadaEnTx(tx, fila.provider, transaccion, orden.id)
        if (yaUsada) {
          const r = await conciliarPagoExternoEnTx(
            tx,
            {
              provider: fila.provider,
              externalTransactionId: transaccion,
              externalEventRowId: fila.id,
              orderId: orden.id,
              correlationId: fila.correlationId,
              externo: { estado: 'PAID', monto: pago.amount ?? null, moneda: pago.currency ?? null },
            },
            ctx,
            ahora
          )
          await tx.supplyV2ExternalEvent.update({
            where: { id: fila.id },
            data: {
              status: 'IGNORED',
              orderId: orden.id,
              lastError: `TRANSACCION_DUPLICADA: ya estaba asociada a ${yaUsada.numero}`,
              nextAttemptAt: null,
            },
          })
          await auditarEnTx(tx, ctx, 'SUPPLY_V2_EXTERNAL_EVENT_FAILED', 'SupplyV2ExternalEvent', fila.id, {
            provider: fila.provider,
            eventType: fila.eventType,
            codigo: 'TRANSACCION_DUPLICADA',
            clase: 'INCIDENTE',
            correlationId: fila.correlationId,
            ordenOriginal: yaUsada.numero,
          }, null)
          return {
            resultado: 'RECHAZADO' as const,
            codigo: 'ESTADO_IMPOSIBLE' as const,
            motivo: `Esa transacción ya estaba asociada a la compra ${yaUsada.numero}.`,
            correlationId: fila.correlationId,
            incidentId: r.incidentId,
          }
        }
      }

      await confirmarPagoEnTx(tx, { orderId: orden.id, amountSeen: String(pago.amount ?? orden.total) }, ctx)
      await emitirEfectoEnTx(tx, {
        eventType: 'supply.order.paid',
        aggregateType: 'SupplyV2CustomerOrder',
        aggregateId: orden.id,
        correlationId: fila.correlationId,
        payload: { orderNumber: orden.number, provider: fila.provider, externalEventId: fila.externalEventId },
      })
    } else if (fila.eventType === 'PAYMENT_REJECTED') {
      await rechazarPagoEnTx(tx, orden.id, `Rechazado por ${fila.provider} (evento ${fila.externalEventId}).`, ctx)
      await emitirEfectoEnTx(tx, {
        eventType: 'supply.order.payment_rejected',
        aggregateType: 'SupplyV2CustomerOrder',
        aggregateId: orden.id,
        correlationId: fila.correlationId,
        payload: { orderNumber: orden.number, provider: fila.provider, externalEventId: fila.externalEventId },
      })
    } else {
      // Inalcanzable: el tipo ya se filtró arriba. Está aquí para que añadir un
      // tipo a `TIPOS_QUE_MANEJAMOS` sin darle camino falle a la vista.
      fallo('TIPO_SIN_CAMINO', `El tipo ${fila.eventType} está declarado como manejado pero no tiene proceso.`)
    }

    // La comprobación de lo que SÍ cuadró (bloque 3). No es contabilidad
    // decorativa: esta tabla es el registro de las asociaciones ACEPTADAS, y es
    // lo que permite ver, la próxima vez, que una transacción ya se usó.
    await conciliarPagoExternoEnTx(
      tx,
      {
        provider: fila.provider,
        externalTransactionId: transaccionDelPayload(fila.payload),
        externalEventRowId: fila.id,
        orderId: orden.id,
        correlationId: fila.correlationId,
        externo: {
          estado: fila.eventType === 'PAYMENT_REJECTED' ? 'FAILED' : 'PAID',
          monto: pago.amount ?? null,
          moneda: pago.currency ?? null,
        },
      },
      ctx,
      ahora
    )

    await tx.supplyV2ExternalEvent.update({
      where: { id: fila.id },
      data: { status: 'PROCESSED', processedAt: ahora, orderId: orden.id, lastError: null, nextAttemptAt: null },
    })
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_EXTERNAL_EVENT_PROCESSED', 'SupplyV2ExternalEvent', fila.id, {
      provider: fila.provider,
      eventType: fila.eventType,
      orderId: orden.id,
      orderNumber: orden.number,
      correlationId: fila.correlationId,
    }, null)
    return { resultado: 'PROCESADO' as const, orderId: orden.id, correlationId: fila.correlationId }
  })
}

/**
 * El procesamiento falló por algo transitorio. Reprograma con la escalera
 * compartida, o lo da por muerto tras el octavo intento.
 *
 * Va en su propia transacción porque la que falló ya se fue atrás: anotar el
 * fallo dentro de ella se perdería con el `ROLLBACK`.
 */
export async function anotarFalloDeProceso(
  eventoId: string,
  error: unknown,
  ctx: ContextoAuditoria,
  ahora = new Date()
): Promise<{ status: 'FAILED' | 'DEAD_LETTER'; proximoIntento: Date | null }> {
  return sinEmpresa('Supply 2.0: anotar el fallo de un evento externo', async (tx) => {
    const fila = await tx.supplyV2ExternalEvent.findUniqueOrThrow({
      where: { id: eventoId },
      select: { id: true, attempts: true, provider: true, eventType: true, correlationId: true },
    })
    const r = reprogramarTrasFallo(fila.attempts, fila.id, ahora)
    await tx.supplyV2ExternalEvent.update({
      where: { id: eventoId },
      data: { status: r.status, attempts: r.intentos, lastError: sanearError(error), nextAttemptAt: r.nextAttemptAt },
    })
    await auditarEnTx(
      tx,
      ctx,
      r.status === 'DEAD_LETTER' ? 'SUPPLY_V2_EXTERNAL_EVENT_DEAD_LETTER' : 'SUPPLY_V2_EXTERNAL_EVENT_FAILED',
      'SupplyV2ExternalEvent',
      eventoId,
      { provider: fila.provider, eventType: fila.eventType, intentos: r.intentos, correlationId: fila.correlationId, error: sanearError(error) },
      null
    )
    return { status: r.status, proximoIntento: r.nextAttemptAt }
  })
}

/**
 * Reintento MANUAL, con nombre de quien lo pidió.
 *
 * Reinicia los intentos por la misma razón que el outbox y que Connect: un
 * difunto agotó los ocho, y reenviarlo sin devolverle escalera lo mataría otra
 * vez al primer fallo. Pasa de nuevo por `procesarEventoExterno`, así que
 * vuelve a pasar por la idempotencia: reintentar nunca duplica dinero.
 */
export async function reintentarEvento(eventoId: string, ctx: ContextoAuditoria): Promise<{ id: string; estaba: SupplyV2ExternalEventStatus }> {
  return sinEmpresa('Supply 2.0: reintentar un evento externo', async (tx) => {
    const fila = await tx.supplyV2ExternalEvent.findUniqueOrThrow({
      where: { id: eventoId },
      select: { id: true, status: true, provider: true, eventType: true, correlationId: true },
    })
    if (EVENTO_RESUELTO.includes(fila.status)) {
      fallo('EVENTO_RESUELTO', 'Ese evento ya está resuelto: reintentarlo no haría nada.')
    }
    await tx.supplyV2ExternalEvent.update({
      where: { id: eventoId },
      data: { status: 'RECEIVED', attempts: 0, nextAttemptAt: null, lastError: null, retriedById: ctx.actorId, retriedAt: new Date() },
    })
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_EXTERNAL_EVENT_RETRIED', 'SupplyV2ExternalEvent', eventoId, {
      estaba: fila.status,
      provider: fila.provider,
      eventType: fila.eventType,
      correlationId: fila.correlationId,
    }, null)
    return { id: eventoId, estaba: fila.status }
  })
}

// ── Internos ────────────────────────────────────────────────────────────────

/**
 * Candado del inbox: advisory por la identidad del evento, y después
 * `FOR UPDATE` sobre la fila.
 *
 * El advisory va PRIMERO porque la fila puede no existir todavía cuando dos
 * entregas simultáneas entran: el advisory serializa por identidad aunque no
 * haya fila que bloquear. `$executeRaw` y no `$queryRaw`: la función devuelve
 * `void` y Prisma no sabe deserializar esa columna.
 */
async function bloquearEvento(tx: Tx, eventoId: string) {
  const base = await tx.supplyV2ExternalEvent.findUnique({
    where: { id: eventoId },
    select: { provider: true, externalEventId: true, eventType: true },
  })
  if (!base) fallo('EVENTO_NO_ENCONTRADO', 'Ese evento externo no existe.')
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${claveDeEvento(base)}))`
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_external_events" WHERE "id" = ${eventoId} FOR UPDATE`
  return tx.supplyV2ExternalEvent.findUniqueOrThrow({
    where: { id: eventoId },
    select: {
      id: true,
      provider: true,
      externalEventId: true,
      eventType: true,
      payload: true,
      status: true,
      attempts: true,
      correlationId: true,
    },
  })
}

/**
 * Lo que se GUARDA del evento: dos partes separadas a propósito.
 *
 *   · `pago`   — lo que el adaptador del proveedor YA interpretó, en nuestro
 *                vocabulario. Es lo que el procesador lee.
 *   · `cuerpo` — lo que llegó, saneado, para poder investigar después.
 *
 * Se separan porque el nombre de los campos es del proveedor, no nuestro: uno
 * manda `order_reference`, otro `invoice`, otro lo trae dentro de `metadata`.
 * Traducirlo es trabajo del adaptador, y si su traducción no se guardara, el
 * procesador tendría que volver a adivinarla desde el cuerpo crudo —y toda
 * pasarela que no nombre los campos como nosotros acabaría con sus eventos
 * marcados SIN_REFERENCIA aunque trajeran la referencia dentro—.
 */
function cuerpoGuardado(e: EventoExternoEntrante): Prisma.InputJsonValue {
  return {
    pago: {
      orderId: e.pago.orderId ?? null,
      orderNumber: e.pago.orderNumber ?? null,
      amount: e.pago.amount === undefined ? null : (e.pago.amount as string | number | null),
      currency: e.pago.currency ?? null,
    },
    cuerpo: (sanear(e.payload) ?? {}) as Prisma.InputJsonValue,
  }
}

/**
 * Lo que el adaptador dejó en el payload, leído con cuidado.
 *
 * Mira primero `payload.pago` —la traducción del adaptador— y acepta además el
 * cuerpo plano, para que una fila escrita a mano (una prueba, un reproceso
 * manual desde la bitácora) siga resolviéndose.
 */
function leerPago(payload: Prisma.JsonValue | null): EventoDePago {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {}
  const raiz = payload as Record<string, unknown>
  const p =
    raiz.pago && typeof raiz.pago === 'object' && !Array.isArray(raiz.pago)
      ? (raiz.pago as Record<string, unknown>)
      : raiz
  const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  return {
    orderId: texto(p.orderId),
    orderNumber: texto(p.orderNumber),
    amount: typeof p.amount === 'number' || typeof p.amount === 'string' ? p.amount : null,
    currency: texto(p.currency),
  }
}

async function buscarOrden(tx: Tx, pago: EventoDePago) {
  const select = { id: true, number: true, status: true, currency: true, total: true } as const
  if (pago.orderId) {
    return tx.supplyV2CustomerOrder.findUnique({ where: { id: pago.orderId }, select })
  }
  if (pago.orderNumber) {
    return tx.supplyV2CustomerOrder.findUnique({ where: { number: pago.orderNumber }, select })
  }
  return null
}


/**
 * El id de transacción del proveedor, tal como el adaptador lo dejó en el
 * cuerpo conservado. Null cuando el proveedor no lo manda: entonces la
 * identidad del problema cae en el id del evento, que siempre existe.
 */
function transaccionDelPayload(payload: Prisma.JsonValue | null): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const raiz = payload as Record<string, unknown>
  const directo = raiz.externalTransactionId
  if (typeof directo === 'string' && directo.trim()) return directo.trim()
  const cuerpo = raiz.cuerpo
  if (cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo)) {
    const dentro = (cuerpo as Record<string, unknown>).externalTransactionId
    if (typeof dentro === 'string' && dentro.trim()) return dentro.trim()
  }
  return null
}
