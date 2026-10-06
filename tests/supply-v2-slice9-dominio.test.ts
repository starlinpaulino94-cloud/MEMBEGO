import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import {
  claseDeFallo,
  claveDeEfecto,
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
  tocaIntentar,
  TRANSICIONES_EVENTO_EXTERNO,
  TRANSICIONES_OUTBOX,
  validarEventoContraOrden,
  type CodigoDeFallo,
  type OrdenParaConciliar,
} from '../src/modules/supply-v2/operations/domain'
import { ESPERAS_S, MAX_INTENTOS } from '../src/modules/integraciones/reintentos'
import { puedeTransicionar } from '../src/modules/supply-v2/core/estados'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 1: el núcleo operativo, sin base.
 *
 * Lo que se prueba aquí son las DECISIONES: qué identidad tiene un evento
 * externo, cuándo se reintenta, cuándo se da por muerto, qué puede y qué no
 * puede acabar en un log, y qué se considera «no cuadra» frente a una compra.
 *
 * `npm test`.
 */

const D = (n: number | string) => new Prisma.Decimal(n)

const ORDEN: OrdenParaConciliar = {
  id: 'ord_1',
  number: 'MBG-SO-2026-000001',
  status: 'AWAITING_PAYMENT',
  currency: 'DOP',
  total: D(1000),
}

// ── A · identidad idempotente ───────────────────────────────────────────────

test('1 · la identidad de un evento es proveedor + id externo + tipo, normalizada', () => {
  const a = identidadDeEvento({ provider: ' test_gateway ', externalEventId: ' abc123 ', eventType: 'payment_confirmed' })
  assert.deepEqual(a, { provider: 'TEST_GATEWAY', externalEventId: 'abc123', eventType: 'PAYMENT_CONFIRMED' })
  // El mismo evento escrito de dos formas es EL MISMO evento: tratarlo como
  // dos sería confirmar el pago dos veces.
  assert.equal(
    claveDeEvento({ provider: 'TEST_GATEWAY', externalEventId: 'abc123', eventType: 'PAYMENT_CONFIRMED' }),
    claveDeEvento({ provider: 'test_gateway', externalEventId: 'abc123', eventType: 'payment_confirmed' })
  )
})

test('1a · el id externo NO se pasa a minúsculas: puede ser sensible del lado del proveedor', () => {
  const a = identidadDeEvento({ provider: 'X', externalEventId: 'AbC', eventType: 'T' })
  assert.equal(a.externalEventId, 'AbC')
})

test('1b · un evento sin proveedor, sin id externo o sin tipo se rechaza con su motivo', () => {
  assert.match(identidadValida({ provider: '', externalEventId: 'a', eventType: 't' })!, /de qué proveedor/)
  assert.match(identidadValida({ provider: 'p', externalEventId: '  ', eventType: 't' })!, /identificador externo/)
  assert.match(identidadValida({ provider: 'p', externalEventId: 'a', eventType: '' })!, /qué tipo/)
  assert.equal(identidadValida({ provider: 'p', externalEventId: 'a', eventType: 't' }), null)
  // Un id larguísimo es una forma barata de llenarnos la tabla.
  assert.match(identidadValida({ provider: 'p', externalEventId: 'x'.repeat(201), eventType: 't' })!, /demasiado largo/)
})

test('2 · la huella del cuerpo distingue «lo mismo otra vez» de «otra cosa con el id de antes»', () => {
  const a = huellaDePayload({ orderId: 'o1', amount: '1000.00' })
  assert.equal(a, huellaDePayload({ orderId: 'o1', amount: '1000.00' }))
  assert.notEqual(a, huellaDePayload({ orderId: 'o1', amount: '900.00' }))
  assert.equal(a.length, 64, 'sha-256 en hexadecimal')
})

test('2a · cada correlationId es único y se reconoce a simple vista', () => {
  const a = nuevoCorrelationId()
  assert.notEqual(a, nuevoCorrelationId())
  assert.match(a, /^sv2-/)
})

// ── B · máquinas de estado del inbox y del outbox ───────────────────────────

test('3 · el inbox: PROCESSED, IGNORED y DEAD_LETTER son finales salvo reintento manual', () => {
  assert.ok(puedeTransicionar(TRANSICIONES_EVENTO_EXTERNO, 'RECEIVED', 'PROCESSING'))
  assert.ok(puedeTransicionar(TRANSICIONES_EVENTO_EXTERNO, 'PROCESSING', 'PROCESSED'))
  assert.ok(puedeTransicionar(TRANSICIONES_EVENTO_EXTERNO, 'FAILED', 'DEAD_LETTER'))
  // Lo esencial: un evento ya procesado NO vuelve al camino del dinero.
  assert.equal(TRANSICIONES_EVENTO_EXTERNO.PROCESSED.length, 0)
  assert.equal(TRANSICIONES_EVENTO_EXTERNO.IGNORED.length, 0)
  assert.ok(!puedeTransicionar(TRANSICIONES_EVENTO_EXTERNO, 'PROCESSED', 'PROCESSING'))
  // Un difunto solo revive si alguien lo decide.
  assert.deepEqual(TRANSICIONES_EVENTO_EXTERNO.DEAD_LETTER, ['PROCESSING'])
})

test('3a · los estados resueltos son exactamente los que no deben reprocesarse', () => {
  assert.deepEqual([...EVENTO_RESUELTO].sort(), ['IGNORED', 'PROCESSED'])
})

test('4 · el outbox: DELIVERED es final y DEAD_LETTER solo revive por decisión', () => {
  assert.ok(puedeTransicionar(TRANSICIONES_OUTBOX, 'PENDING', 'PROCESSING'))
  assert.ok(puedeTransicionar(TRANSICIONES_OUTBOX, 'PROCESSING', 'DELIVERED'))
  assert.ok(puedeTransicionar(TRANSICIONES_OUTBOX, 'FAILED', 'PROCESSING'))
  assert.equal(TRANSICIONES_OUTBOX.DELIVERED.length, 0)
  assert.deepEqual(TRANSICIONES_OUTBOX.DEAD_LETTER, ['PROCESSING'])
})

test('4a · toda máquina de estados del bloque tiene al menos un estado final', () => {
  for (const [nombre, m] of [['inbox', TRANSICIONES_EVENTO_EXTERNO], ['outbox', TRANSICIONES_OUTBOX]] as const) {
    const finales = Object.entries(m).filter(([, destinos]) => (destinos as string[]).length === 0)
    assert.ok(finales.length > 0, `${nombre} no tiene estado final: algo podría girar para siempre`)
  }
})

// ── C · reintentos: se usa la escalera COMPARTIDA ───────────────────────────

test('5 · se reutiliza la escalera de Connect, no una nueva: 8 intentos de 30 s a 24 h', () => {
  assert.equal(MAX_INTENTOS, 8)
  assert.equal(ESPERAS_S[0], 30)
  assert.equal(ESPERAS_S[ESPERAS_S.length - 1], 86_400)
  assert.equal(ESPERAS_S.length, MAX_INTENTOS - 1, 'el primer intento no espera')
})

test('5a · tras un fallo se reprograma con backoff creciente', () => {
  const ahora = new Date('2026-10-02T12:00:00Z')
  const uno = reprogramarTrasFallo(0, 'semilla', ahora)
  const dos = reprogramarTrasFallo(1, 'semilla', ahora)
  const tres = reprogramarTrasFallo(2, 'semilla', ahora)
  assert.equal(uno.status, 'FAILED')
  assert.equal(uno.intentos, 1)
  assert.ok(uno.nextAttemptAt! > ahora)
  // Creciente: cada escalón espera más que el anterior.
  assert.ok(dos.nextAttemptAt! > uno.nextAttemptAt!)
  assert.ok(tres.nextAttemptAt! > dos.nextAttemptAt!)
})

test('5b · el jitter reparte la avalancha: dos filas distintas no vuelven en el mismo instante', () => {
  const ahora = new Date('2026-10-02T12:00:00Z')
  const a = reprogramarTrasFallo(3, 'fila-a', ahora).nextAttemptAt!
  const b = reprogramarTrasFallo(3, 'fila-b', ahora).nextAttemptAt!
  assert.notEqual(a.getTime(), b.getTime(), 'sin dispersión, mil fallos vuelven todos al mismo segundo')
})

test('6 · al octavo intento se da por muerto, y no se reintenta más', () => {
  const ahora = new Date('2026-10-02T12:00:00Z')
  // Séptimo fallo: todavía queda escalera.
  assert.equal(reprogramarTrasFallo(6, 's', ahora).status, 'FAILED')
  // Octavo: muerto, y sin próxima fecha.
  const muerto = reprogramarTrasFallo(7, 's', ahora)
  assert.equal(muerto.status, 'DEAD_LETTER')
  assert.equal(muerto.intentos, MAX_INTENTOS)
  assert.equal(muerto.nextAttemptAt, null)
  // Y no hay vuelta atrás automática por mucho que se insista.
  assert.equal(reprogramarTrasFallo(20, 's', ahora).status, 'DEAD_LETTER')
})

test('6a · NULL en la próxima fecha significa «vencido», no «nunca»', () => {
  const ahora = new Date('2026-10-02T12:00:00Z')
  assert.equal(tocaIntentar(null, ahora), true, 'misma convención que EntregaWebhook y EventoSaliente')
  assert.equal(tocaIntentar(new Date('2026-10-02T11:59:00Z'), ahora), true)
  assert.equal(tocaIntentar(new Date('2026-10-02T12:01:00Z'), ahora), false)
})

// ── D · clasificación de errores ────────────────────────────────────────────

test('7 · cada fallo se clasifica según QUÉ hay que hacer con él', () => {
  // Lo que no cuadra con nuestra operación necesita a una persona.
  for (const c of ['ORDEN_DESCONOCIDA', 'MONTO_NO_CUADRA', 'MONEDA_NO_CUADRA', 'ESTADO_IMPOSIBLE', 'SIN_REFERENCIA'] as CodigoDeFallo[]) {
    assert.equal(claseDeFallo(c), 'INCIDENTE', `${c} no puede resolverse solo`)
  }
  // Lo que es válido pero no produce efecto no necesita a nadie.
  assert.equal(claseDeFallo('ORDEN_YA_PAGADA'), 'DESCARTABLE')
  assert.equal(claseDeFallo('TIPO_NO_MANEJADO'), 'DESCARTABLE')
  // Lo transitorio se reintenta.
  assert.equal(claseDeFallo('ERROR_TRANSITORIO'), 'REINTENTABLE')
})

test('7a · todo código de fallo tiene su mensaje en castellano', () => {
  const codigos = Object.keys(MENSAJES_DE_FALLO) as CodigoDeFallo[]
  for (const c of codigos) {
    const m = MENSAJES_DE_FALLO[c]
    assert.ok(m && m.length > 10, `${c} sin mensaje legible`)
    assert.ok(!/[A-Z_]{6,}/.test(m), `${c} enseña el código técnico en el mensaje: «${m}»`)
  }
})

// ── E · el proveedor externo NO es la fuente de la verdad ───────────────────

test('8 · un evento que cuadra con la compra se acepta', () => {
  assert.equal(validarEventoContraOrden({ orderId: 'ord_1', amount: '1000.00', currency: 'DOP' }, ORDEN), null)
})

test('9 · el monto lo decide NUESTRA compra, no lo que diga el proveedor', () => {
  assert.equal(validarEventoContraOrden({ orderId: 'ord_1', amount: '900.00', currency: 'DOP' }, ORDEN), 'MONTO_NO_CUADRA')
  assert.equal(validarEventoContraOrden({ orderId: 'ord_1', amount: '1100.00', currency: 'DOP' }, ORDEN), 'MONTO_NO_CUADRA')
  // Un centavo de diferencia se tolera, igual que al confirmar a mano.
  assert.equal(validarEventoContraOrden({ orderId: 'ord_1', amount: '1000.01', currency: 'DOP' }, ORDEN), null)
  assert.equal(validarEventoContraOrden({ orderId: 'ord_1', amount: '1000.02', currency: 'DOP' }, ORDEN), 'MONTO_NO_CUADRA')
})

test('9a · sin monto no se confirma nada', () => {
  assert.equal(validarEventoContraOrden({ orderId: 'ord_1', currency: 'DOP' }, ORDEN), 'MONTO_NO_CUADRA')
  assert.equal(validarEventoContraOrden({ orderId: 'ord_1', amount: 'no-es-un-numero', currency: 'DOP' }, ORDEN), 'MONTO_NO_CUADRA')
})

test('10 · otra moneda NO es la misma compra', () => {
  assert.equal(validarEventoContraOrden({ orderId: 'ord_1', amount: '1000.00', currency: 'USD' }, ORDEN), 'MONEDA_NO_CUADRA')
  // Mayúsculas/minúsculas no cambian la moneda.
  assert.equal(validarEventoContraOrden({ orderId: 'ord_1', amount: '1000.00', currency: 'dop' }, ORDEN), null)
})

test('11 · una compra que ya estaba pagada no se vuelve a pagar: es descartable, no un error', () => {
  const pagada = { ...ORDEN, status: 'PAID' }
  const codigo = validarEventoContraOrden({ orderId: 'ord_1', amount: '1000.00', currency: 'DOP' }, pagada)
  assert.equal(codigo, 'ORDEN_YA_PAGADA')
  assert.equal(claseDeFallo(codigo!), 'DESCARTABLE')
})

test('12 · un estado imposible no se fuerza: se rechaza', () => {
  for (const status of ['CANCELLED', 'EXPIRED', 'REFUNDED']) {
    assert.equal(validarEventoContraOrden({ orderId: 'ord_1', amount: '1000.00', currency: 'DOP' }, { ...ORDEN, status }), 'ESTADO_IMPOSIBLE')
  }
  // Y los dos que sí admiten pago, lo admiten.
  for (const status of ['PENDING', 'AWAITING_PAYMENT']) {
    assert.equal(validarEventoContraOrden({ orderId: 'ord_1', amount: '1000.00', currency: 'DOP' }, { ...ORDEN, status }), null)
  }
})

test('13 · un evento sin referencia y uno con referencia desconocida NO son el mismo problema', () => {
  // No dice a qué compra se refiere: el proveedor mandó basura.
  assert.equal(validarEventoContraOrden({ amount: '1000.00' }, null), 'SIN_REFERENCIA')
  // Dice una compra que no existe: eso hay que investigarlo.
  assert.equal(validarEventoContraOrden({ orderNumber: 'MBG-SO-9999', amount: '1000.00' }, null), 'ORDEN_DESCONOCIDA')
})

// ── F · saneamiento: nada de secretos ───────────────────────────────────────

test('14 · sanear tapa firmas, tokens, claves y datos de tarjeta', () => {
  const sucio = {
    orderId: 'ord_1',
    amount: '1000.00',
    signature: 'f1rm4-v4l1d4',
    Authorization: 'Bearer abc',
    api_key: 'sk_live_123',
    card: { pan: '4111111111111111', cvv: '123' },
    anidado: { secreto: 'x', password: 'y' },
  }
  const limpio = sanear(sucio) as Record<string, unknown>
  assert.equal(limpio.orderId, 'ord_1', 'lo que no es secreto se conserva')
  assert.equal(limpio.amount, '1000.00')
  assert.equal(limpio.signature, '[oculto]', 'con la firma dentro, un volcado permite fabricar eventos')
  assert.equal(limpio.Authorization, '[oculto]')
  assert.equal(limpio.api_key, '[oculto]')
  assert.equal(limpio.card, '[oculto]')
  const anidado = limpio.anidado as Record<string, unknown>
  assert.equal(anidado.secreto, '[oculto]')
  assert.equal(anidado.password, '[oculto]')
  // Y ninguna de las cadenas prohibidas sobrevive en el JSON resultante.
  const texto = JSON.stringify(limpio)
  for (const s of ['f1rm4-v4l1d4', 'Bearer abc', 'sk_live_123', '4111111111111111']) {
    assert.ok(!texto.includes(s), `se filtró «${s}»`)
  }
})

test('14a · sanear recorta textos largos y no baja hasta el infinito', () => {
  const largo = sanear({ nota: 'x'.repeat(2000) }) as Record<string, string>
  assert.ok(largo.nota.length < 600)
  assert.ok(largo.nota.endsWith('…'))
  // Un objeto anidado sin fin se corta en vez de llenarnos la base.
  let profundo: Record<string, unknown> = { fin: 1 }
  for (let i = 0; i < 20; i++) profundo = { dentro: profundo }
  assert.ok(JSON.stringify(sanear(profundo)).includes('profundidad máxima'))
})

test('15 · un error que trae la petición entera no se guarda con el secreto dentro', () => {
  const e = new Error('POST /pay failed: {"signature":"abc123","token":"t0k3n","amount":"1000"}')
  const limpio = sanearError(e)
  assert.ok(!limpio.includes('abc123'), `se filtró la firma: ${limpio}`)
  assert.ok(!limpio.includes('t0k3n'), `se filtró el token: ${limpio}`)
  assert.ok(limpio.includes('1000'), 'lo que no es secreto se conserva para poder investigar')
})

test('15a · sanear un error nunca devuelve vacío ni se desborda', () => {
  assert.ok(sanearError(null).length > 0)
  assert.ok(sanearError(new Error('')).length > 0)
  assert.ok(sanearError(new Error('x'.repeat(5000))).length < 600)
})

// ── G · identidad del outbox ────────────────────────────────────────────────

test('16 · la clave de un efecto NO depende del hilo: dos intentos de confirmar la misma orden emiten UN efecto', () => {
  const a = claveDeEfecto({ eventType: 'supply.order.paid', aggregateType: 'SupplyV2CustomerOrder', aggregateId: 'ord_1' })
  const b = claveDeEfecto({ eventType: 'supply.order.paid', aggregateType: 'SupplyV2CustomerOrder', aggregateId: 'ord_1' })
  assert.equal(a, b)
  // Pero dos efectos DISTINTOS sobre la misma orden sí son dos.
  assert.notEqual(a, claveDeEfecto({ eventType: 'supply.order.payment_rejected', aggregateType: 'SupplyV2CustomerOrder', aggregateId: 'ord_1' }))
  // Y el mismo efecto sobre otra orden, también.
  assert.notEqual(a, claveDeEfecto({ eventType: 'supply.order.paid', aggregateType: 'SupplyV2CustomerOrder', aggregateId: 'ord_2' }))
})
