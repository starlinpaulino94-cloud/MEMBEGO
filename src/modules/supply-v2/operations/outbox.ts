import type { Prisma } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { sinEmpresa } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { claveDeEfecto, reprogramarTrasFallo, sanear, sanearError, type EfectoPendiente } from './domain'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · OUTBOX TRANSACCIONAL (§4C).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA PROPIEDAD QUE ESTO EXISTE PARA DAR
 *
 * Una notificación que falla NO puede revertir una compra confirmada. Hasta
 * ahora, cualquier efecto externo dentro de la transacción financiera tenía
 * ese poder: si el envío lanzaba, la transacción se iba atrás y el cliente
 * perdía su compra por un fallo del proveedor de correo.
 *
 * Con el outbox, la transacción que mueve el dinero solo APUNTA el efecto. El
 * envío ocurre después, fuera de ella, y puede fallar y reintentarse sin tocar
 * el estado financiero.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA ENTREGA NO SE REIMPLEMENTA
 *
 * Entregar es `encolar()` de `modules/jobs/cola.ts`: la cola que ya existe,
 * con sus reintentos de QStash, su deduplicación y su dead letter en
 * `trabajos_muertos`, que ya tiene panel para reencolar. Esta tabla es la
 * garantía de que el efecto quedó apuntado aunque el proceso muriera justo
 * después del `COMMIT`; la cola es la que lo lleva.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CANDADOS
 *
 * El outbox NUNCA se bloquea dentro de la transacción financiera: solo se
 * inserta. Al entregar, el worker reclama la fila con un `UPDATE` condicional
 * —sin `FOR UPDATE`— sobre el estado, de modo que dos workers no pueden
 * reclamar la misma fila: el segundo actualiza cero filas y se va.
 */

/**
 * Apunta un efecto externo DENTRO de la transacción de quien llama.
 *
 * Idempotente por `dedupeKey`: emitir dos veces el mismo efecto para la misma
 * operación deja UNA fila. Devuelve `repetido: true` la segunda vez, que es lo
 * que permite llamar a esto desde un camino que puede reintentarse.
 */
export async function emitirEfectoEnTx(
  tx: Tx,
  e: EfectoPendiente
): Promise<{ id: string; repetido: boolean }> {
  const dedupeKey = e.dedupeKey?.trim() || claveDeEfecto(e)
  const previo = await tx.supplyV2OutboxEvent.findUnique({ where: { dedupeKey }, select: { id: true } })
  if (previo) return { id: previo.id, repetido: true }

  const fila = await tx.supplyV2OutboxEvent.create({
    data: {
      eventType: e.eventType,
      aggregateType: e.aggregateType,
      aggregateId: e.aggregateId,
      payload: (sanear(e.payload) ?? {}) as Prisma.InputJsonValue,
      correlationId: e.correlationId,
      dedupeKey,
    },
    select: { id: true },
  })
  return { id: fila.id, repetido: false }
}

export interface EfectoReclamado {
  id: string
  eventType: string
  aggregateType: string
  aggregateId: string
  payload: Prisma.JsonValue
  correlationId: string
  attempts: number
}

/**
 * Reclama hasta `limite` efectos pendientes y los pone en PROCESSING.
 *
 * El `updateMany` condicionado al estado es el candado: dos workers que corran
 * a la vez no pueden llevarse la misma fila, porque el segundo encuentra cero
 * filas en estado reclamable. No hace falta `FOR UPDATE` ni advisory lock para
 * esto, y no tenerlo mantiene el outbox fuera del orden de candados que
 * comparten inbox, orden y beneficio.
 */
export async function reclamarEfectos(limite = 20, ahora = new Date()): Promise<EfectoReclamado[]> {
  return sinEmpresa('Supply 2.0: reclamar efectos del outbox', async (tx) => {
    const candidatos = await tx.supplyV2OutboxEvent.findMany({
      where: { status: { in: ['PENDING', 'FAILED'] }, availableAt: { lte: ahora } },
      orderBy: { availableAt: 'asc' },
      take: limite,
      select: { id: true },
    })
    const reclamados: EfectoReclamado[] = []
    for (const c of candidatos) {
      const tomado = await tx.supplyV2OutboxEvent.updateMany({
        where: { id: c.id, status: { in: ['PENDING', 'FAILED'] } },
        // `claimedAt` es el ARRIENDO (Bloque 2): sin él, una fila que un
        // proceso muerto dejó en PROCESSING es indistinguible de una que
        // alguien está entregando ahora mismo, y el rescate no podría correr
        // sin robarle el trabajo a un worker vivo. Un CHECK de la base exige
        // que toda fila en PROCESSING la tenga.
        data: { status: 'PROCESSING', claimedAt: ahora },
      })
      if (tomado.count === 0) continue // otro worker se lo llevó
      const fila = await tx.supplyV2OutboxEvent.findUniqueOrThrow({
        where: { id: c.id },
        select: { id: true, eventType: true, aggregateType: true, aggregateId: true, payload: true, correlationId: true, attempts: true },
      })
      reclamados.push(fila)
    }
    return reclamados
  })
}

/** El efecto se entregó. Estado final. */
export async function marcarEntregado(id: string): Promise<void> {
  await sinEmpresa('Supply 2.0: outbox entregado', (tx) =>
    tx.supplyV2OutboxEvent.update({
      where: { id },
      data: { status: 'DELIVERED', processedAt: new Date(), lastError: null, availableAt: new Date() },
    })
  )
}

/**
 * El efecto falló. Reprograma con la escalera compartida, o lo da por muerto
 * tras el octavo intento y lo deja auditado: un difunto necesita que alguien
 * decida, y para decidir hay que saber que existe.
 */
export async function marcarFallido(id: string, error: unknown, ctx: ContextoAuditoria, ahora = new Date()): Promise<'FAILED' | 'DEAD_LETTER'> {
  return sinEmpresa('Supply 2.0: outbox fallido', async (tx) => {
    const fila = await tx.supplyV2OutboxEvent.findUniqueOrThrow({
      where: { id },
      select: { id: true, attempts: true, eventType: true, aggregateType: true, aggregateId: true, correlationId: true },
    })
    const r = reprogramarTrasFallo(fila.attempts, fila.id, ahora)
    await tx.supplyV2OutboxEvent.update({
      where: { id },
      data: { status: r.status, attempts: r.intentos, lastError: sanearError(error), availableAt: r.nextAttemptAt ?? ahora },
    })
    if (r.status === 'DEAD_LETTER') {
      await auditarEnTx(tx, ctx, 'SUPPLY_V2_OUTBOX_DEAD_LETTER', 'SupplyV2OutboxEvent', id, {
        eventType: fila.eventType,
        aggregateType: fila.aggregateType,
        aggregateId: fila.aggregateId,
        correlationId: fila.correlationId,
        intentos: r.intentos,
        error: sanearError(error),
      }, null)
    }
    return r.status
  })
}

/**
 * Reintento MANUAL de un difunto, con nombre y apellido de quien lo pidió.
 *
 * Reinicia los intentos a propósito: un difunto agotó los ocho, y reenviarlo
 * sin devolverle escalera lo mataría otra vez al primer fallo —y quien pulsó
 * el botón leería, con razón, que su arreglo no sirvió—. Es la misma decisión
 * que `reenviarEntregaAhora` en Connect, y se toma por la misma razón.
 */
export async function reintentarEfecto(id: string, ctx: ContextoAuditoria): Promise<{ id: string; estaba: string }> {
  return sinEmpresa('Supply 2.0: reintentar un efecto del outbox', async (tx) => {
    const fila = await tx.supplyV2OutboxEvent.findUniqueOrThrow({
      where: { id },
      select: { id: true, status: true, eventType: true, aggregateId: true, correlationId: true },
    })
    await tx.supplyV2OutboxEvent.update({
      where: { id },
      data: {
        status: 'PENDING',
        attempts: 0,
        availableAt: new Date(),
        lastError: null,
        processedAt: null,
        retriedById: ctx.actorId,
        retriedAt: new Date(),
      },
    })
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_OUTBOX_RETRIED', 'SupplyV2OutboxEvent', id, {
      estaba: fila.status,
      eventType: fila.eventType,
      aggregateId: fila.aggregateId,
      correlationId: fila.correlationId,
    }, null)
    return { id, estaba: fila.status }
  })
}
