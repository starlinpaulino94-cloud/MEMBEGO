import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COLAS_TICKET,
  COLA_LABEL,
  TICKET_ESTADOS,
  colaDeEstado,
  type ColaTicket,
} from '../src/lib/soporte'

/**
 * COLAS DE LA BANDEJA DE SOPORTE (DS 2.0 · Fase 15).
 *
 * EL DEFECTO QUE SE ARREGLÓ: la pantalla enseñaba cuatro tarjetas —Total,
 * Nuevos, En proceso, Resueltos— que contaban TRES de los cinco estados. Un
 * ticket en ESPERANDO_CLIENTE (o CERRADO) no aparecía en ninguna, así que el
 * desglose no sumaba el total. Un desglose que no cuadra enseña a no mirarlo.
 *
 * Las colas lo sustituyen, y por eso esta prueba existe: si mañana se añade un
 * estado al enum y nadie lo asigna a una cola, sus tickets desaparecerían de la
 * bandeja SIN ERROR — se quedarían fuera de las tres pestañas y nadie los
 * volvería a ver. Es justo la clase de fallo silencioso que ya pasó una vez.
 */

test('todo estado pertenece exactamente a una cola', () => {
  for (const estado of TICKET_ESTADOS) {
    const colas = Object.entries(COLAS_TICKET).filter(([, estados]) =>
      (estados as readonly string[]).includes(estado)
    )
    assert.equal(
      colas.length,
      1,
      `${estado} está en ${colas.length} colas (${colas.map(([c]) => c).join(', ') || 'ninguna'}). ` +
        'Un estado sin cola desaparece de la bandeja sin dar error.'
    )
  }
})

test('las colas no inventan estados que no existen', () => {
  for (const [cola, estados] of Object.entries(COLAS_TICKET)) {
    for (const e of estados) {
      assert.ok(
        (TICKET_ESTADOS as readonly string[]).includes(e),
        `la cola "${cola}" declara "${e}", que no está en TicketEstado`
      )
    }
  }
})

test('los conteos de las colas suman el total', () => {
  // Es exactamente lo que las cuatro tarjetas NO hacían.
  const tickets = [
    'NUEVO',
    'NUEVO',
    'EN_PROCESO',
    'ESPERANDO_CLIENTE',
    'RESUELTO',
    'CERRADO',
  ]
  const acc: Record<ColaTicket, number> = { pendientes: 0, esperando: 0, cerrados: 0 }
  for (const t of tickets) {
    const c = colaDeEstado(t)
    if (c) acc[c] += 1
  }
  assert.deepEqual(acc, { pendientes: 3, esperando: 1, cerrados: 2 })
  assert.equal(acc.pendientes + acc.esperando + acc.cerrados, tickets.length)
})

test('un estado desconocido no se cuela en ninguna cola', () => {
  // Sin esto, un valor raro llegado de la base caería en la primera cola por
  // accidente y aparecería como trabajo pendiente que nadie puede resolver.
  assert.equal(colaDeEstado('ARCHIVADO_2027'), null)
  assert.equal(colaDeEstado(''), null)
})

test('cada cola tiene nombre visible', () => {
  for (const cola of Object.keys(COLAS_TICKET) as ColaTicket[]) {
    assert.ok(COLA_LABEL[cola]?.trim(), `la cola "${cola}" no tiene etiqueta`)
  }
})

test('las colas se nombran desde quien las lee, no desde el estado interno', () => {
  // "Te toca a ti" contesta la pregunta del administrador al abrir la bandeja.
  // "NUEVO / EN_PROCESO" describe la fila de la base de datos, que es otra
  // cosa y no le sirve para decidir por dónde empezar.
  assert.equal(COLA_LABEL.pendientes, 'Te toca a ti')
})
