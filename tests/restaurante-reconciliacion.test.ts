import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  reconciliar,
  seEstaQuedandoAtras,
  type AlmacenReconciliacion,
  type FilaAReconciliar,
} from '../apps/restaurant/src/reconciliacion'
import { aplicarEvento } from '../apps/restaurant/src/proyeccion'
import { MembegoError } from '@membego/platform-sdk'
import type { SobreEvento } from '@membego/contracts'

/**
 * RECONCILIACIÓN · el único de los tres problemas de una proyección que no se
 * arregla recibiendo mejor.
 *
 * El inbox evita procesar dos veces. El orden evita que un evento viejo pise a
 * uno nuevo. Ninguno hace nada si el evento NO LLEGA — y puede no llegar: el
 * satélite caído más de lo que dura la política de reintentos, un DEAD_LETTER,
 * una partición larga. Entonces la copia queda vieja para siempre, y nada avisa.
 */

// ── Doble ───────────────────────────────────────────────────────────────────

function almacenFalso(iniciales: { customerId: string; vigenteDesde: Date; nombre?: string }[] = []) {
  const filas = new Map(
    iniciales.map((f) => [
      f.customerId,
      { companyId: 'emp-1', vigenteDesde: f.vigenteDesde, nombre: f.nombre ?? 'viejo' },
    ])
  )
  const olvidados: string[] = []

  const almacen: AlmacenReconciliacion = {
    async vigenciaDe(id) {
      return filas.get(id)?.vigenteDesde ?? null
    },
    async guardar(f) {
      filas.set(f.customerId, {
        companyId: f.companyId,
        vigenteDesde: f.vigenteDesde,
        nombre: f.nombre,
      })
    },
    async masViejas(limite) {
      return [...filas.entries()]
        .sort((a, b) => a[1].vigenteDesde.getTime() - b[1].vigenteDesde.getTime())
        .slice(0, limite)
        .map(([customerId, v]): FilaAReconciliar => ({
          customerId,
          companyId: v.companyId,
          vigenteDesde: v.vigenteDesde,
        }))
    },
    async olvidar(id) {
      filas.delete(id)
      olvidados.push(id)
    },
  }
  return { almacen, filas, olvidados }
}

const HORA = 60 * 60 * 1000
const AHORA = new Date('2026-08-11T12:00:00.000Z')
const ahora = () => AHORA

function coreCon(respuesta: Record<string, unknown>) {
  const pedidos: string[] = []
  const membego = {
    async customer(_c: string, id: string) {
      pedidos.push(id)
      return { id, nombre: 'Ana María', telefono: '+18095551234', email: '', ...respuesta }
    },
  }
  return { membego, pedidos }
}

// ── Lo que arregla ──────────────────────────────────────────────────────────

test('una copia vieja se refresca contra el Core', async () => {
  const { almacen, filas } = almacenFalso([
    { customerId: 'cli-1', vigenteDesde: new Date(AHORA.getTime() - 72 * HORA), nombre: 'Ana' },
  ])
  const { membego, pedidos } = coreCon({})

  const r = await reconciliar(membego as never, almacen, { ahora })

  assert.deepEqual(pedidos, ['cli-1'])
  assert.equal(r.actualizadas, 1)
  assert.equal(
    filas.get('cli-1')?.nombre,
    'Ana María',
    'Sin esto, un webhook perdido deja la copia vieja PARA SIEMPRE y nada avisa.'
  )
})

test('lo refrescado hace un momento no gasta presupuesto', async () => {
  const { almacen } = almacenFalso([
    { customerId: 'reciente', vigenteDesde: new Date(AHORA.getTime() - 60 * 1000) },
  ])
  const { membego, pedidos } = coreCon({})

  const r = await reconciliar(membego as never, almacen, { ahora })

  assert.deepEqual(
    pedidos,
    [],
    'Sin umbral de frescura, la tarea gasta su presupuesto releyendo justo lo ' +
      'que acaba de llegar por webhook: lo que MÁS al día está.'
  )
  assert.equal(r.revisadas, 0)
})

test('el presupuesto acota la carga sobre el Core', async () => {
  const muchas = Array.from({ length: 200 }, (_, i) => ({
    customerId: `cli-${i}`,
    vigenteDesde: new Date(AHORA.getTime() - (100 + i) * HORA),
  }))
  const { almacen } = almacenFalso(muchas)
  const { membego, pedidos } = coreCon({})

  await reconciliar(membego as never, almacen, { presupuesto: 10, ahora })

  assert.equal(
    pedidos.length,
    10,
    'Releer todo sería un ataque a MembeGo desde dentro, y peor cuanto más ' +
      'creciera el negocio.'
  )
  assert.equal(pedidos[0], 'cli-199', 'Se empieza por la MÁS vieja: ahí vive el problema.')
})

// ── La sutileza que decide si arregla o rompe ───────────────────────────────

test('el sello es la hora de ENVÍO, no la de llegada', async () => {
  const { almacen, filas } = almacenFalso([
    { customerId: 'cli-1', vigenteDesde: new Date(AHORA.getTime() - 72 * HORA) },
  ])

  // El Core tarda: durante el vuelo pasan cinco minutos.
  let reloj = AHORA.getTime()
  const membego = {
    async customer(_c: string, id: string) {
      reloj += 5 * 60 * 1000
      return { id, nombre: 'Ana María', telefono: null, email: '' }
    },
  }

  await reconciliar(membego as never, almacen, { ahora: () => new Date(reloj) })

  const sello = filas.get('cli-1')!.vigenteDesde
  assert.equal(
    sello.getTime(),
    AHORA.getTime(),
    'Sellando con la hora de LLEGADA, un cambio ocurrido durante el vuelo queda ' +
      'marcado como más viejo que la copia, y su webhook —que trae el ' +
      '`occurredAt` real— se descarta por «evento viejo». Un cambio real ' +
      'perdido, sin error, por haber intentado arreglar la copia.'
  )
})

test('un webhook llegado durante el vuelo no se pierde', async () => {
  // La secuencia completa, que es lo que de verdad importa: se reconcilia, y
  // mientras tanto llega un evento con un cambio POSTERIOR a la lectura.
  const { almacen, filas } = almacenFalso([
    { customerId: 'cli-1', vigenteDesde: new Date(AHORA.getTime() - 72 * HORA) },
  ])
  let reloj = AHORA.getTime()
  const membego = {
    async customer(_c: string, id: string) {
      reloj += 5 * 60 * 1000
      return { id, nombre: 'de la lectura', telefono: null, email: '' }
    },
  }

  await reconciliar(membego as never, almacen, { ahora: () => new Date(reloj) })

  const evento: SobreEvento = {
    eventId: 'ev-vuelo',
    eventType: 'customer.updated',
    version: 1,
    // Ocurrió DESPUÉS de que se enviara la lectura.
    occurredAt: new Date(AHORA.getTime() + 60 * 1000).toISOString(),
    companyId: 'emp-1',
    customerId: 'cli-1',
    source: 'membego',
    traceId: 'tr-1',
    data: { cliente: { nombre: 'del webhook' } },
  }
  const r = await aplicarEvento(almacen, evento)

  assert.equal(r.aplicado, true)
  assert.equal(
    filas.get('cli-1')?.nombre,
    'del webhook',
    'El evento ocurrió después de la lectura y tiene que ganar. Con el sello de ' +
      'llegada se habría descartado y el cambio se habría perdido.'
  )
})

test('el sello nunca retrocede', async () => {
  // Mientras se pedía, un webhook dejó la copia MÁS nueva que la lectura.
  const masNueva = new Date(AHORA.getTime() + 10 * 60 * 1000)
  const { almacen, filas } = almacenFalso([
    { customerId: 'cli-1', vigenteDesde: new Date(AHORA.getTime() - 72 * HORA) },
  ])
  const membego = {
    async customer(_c: string, id: string) {
      // Simula el webhook que aterrizó durante el vuelo.
      await almacen.guardar({
        customerId: 'cli-1',
        companyId: 'emp-1',
        nombre: 'del webhook',
        telefono: null,
        email: null,
        vigenteDesde: masNueva,
      })
      return { id, nombre: 'de la lectura', telefono: null, email: '' }
    },
  }

  await reconciliar(membego as never, almacen, { ahora })

  assert.equal(
    filas.get('cli-1')!.vigenteDesde.getTime(),
    masNueva.getTime(),
    'Retroceder el sello vuelve a abrir la puerta a que un evento viejo pise a ' +
      'uno nuevo — justo lo que el orden por `occurredAt` existe para impedir.'
  )
})

// ── Fallos ──────────────────────────────────────────────────────────────────

test('un cliente que ya no está en el Core se olvida', async () => {
  const { almacen, olvidados } = almacenFalso([
    { customerId: 'borrado', vigenteDesde: new Date(AHORA.getTime() - 72 * HORA) },
  ])
  const membego = {
    async customer() {
      throw new MembegoError('NOT_FOUND', 'No existe', 404, null)
    },
  }

  const r = await reconciliar(membego as never, almacen, { ahora })

  assert.deepEqual(olvidados, ['borrado'])
  assert.equal(r.olvidadas, 1)
})

test('un fallo del Core NO borra la copia', async () => {
  const { almacen, olvidados, filas } = almacenFalso([
    { customerId: 'cli-1', vigenteDesde: new Date(AHORA.getTime() - 72 * HORA) },
  ])
  const membego = {
    async customer() {
      throw new MembegoError('INTERNAL_ERROR', 'Se cayó', 500, null)
    },
  }

  const r = await reconciliar(membego as never, almacen, { ahora })

  assert.deepEqual(
    olvidados,
    [],
    'Un 500 o un corte de red NO significan que el cliente no exista. Borrar por ' +
      'un fallo del Core es perder la copia justo cuando más falta hace.'
  )
  assert.equal(r.fallidas, 1)
  assert.ok(filas.has('cli-1'))
})

// ── Saber si sirve ──────────────────────────────────────────────────────────

test('el resumen distingue lo revisado de lo cambiado', async () => {
  const { almacen } = almacenFalso([
    { customerId: 'cli-1', vigenteDesde: new Date(AHORA.getTime() - 72 * HORA), nombre: 'Ana María' },
  ])
  const { membego } = coreCon({})

  const r = await reconciliar(membego as never, almacen, { ahora })

  assert.equal(r.revisadas, 1)
  assert.equal(
    r.actualizadas + r.sinCambios + r.olvidadas + r.fallidas,
    r.revisadas,
    'Las categorías del resumen tienen que sumar lo revisado, o el número no ' +
      'significa nada.'
  )
})

test('se sabe si la tarea se está quedando atrás', async () => {
  const muchas = Array.from({ length: 100 }, (_, i) => ({
    customerId: `cli-${i}`,
    vigenteDesde: new Date(AHORA.getTime() - (48 + i) * HORA),
  }))
  const { almacen } = almacenFalso(muchas)
  const { membego } = coreCon({})

  const r = await reconciliar(membego as never, almacen, { presupuesto: 5, ahora })

  assert.ok(
    (r.desfaseMaximoPendiente ?? 0) > 24 * HORA,
    'Hace falta saber la antigüedad de la MÁS VIEJA que quedó sin revisar.'
  )
  assert.equal(
    seEstaQuedandoAtras(r),
    true,
    'Una tarea que corre cada hora y no llega a lo de hace tres días está ' +
      '«funcionando» —no falla, no da error— y no sirve para nada. Sin esta ' +
      'señal, nadie se entera.'
  )
})

test('cuando va sobrada, no hay desfase pendiente', async () => {
  const { almacen } = almacenFalso([
    { customerId: 'cli-1', vigenteDesde: new Date(AHORA.getTime() - 72 * HORA) },
  ])
  const { membego } = coreCon({})

  const r = await reconciliar(membego as never, almacen, { presupuesto: 10, ahora })

  assert.equal(r.desfaseMaximoPendiente, null)
  assert.equal(seEstaQuedandoAtras(r), false)
})
