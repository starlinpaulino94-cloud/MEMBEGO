import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import {
  MAX_CANTIDAD_MOSTRADOR,
  MAX_LINEAS_MOSTRADOR,
  claveDeVenta,
  claveDelEnvioValida,
  esMetodoPos,
  metodoDeCaja,
  metodoDePedido,
  metodoVerifica,
  validarCarrito,
  validarCobroPos,
} from '../src/modules/pos/domain'
import { pagoVerificado } from '../src/modules/orders/domain'

const D = (v: string | number) => new Prisma.Decimal(v)

test('métodos: cómo los llama el pedido y cómo los llama la caja (que no distingue la tarjeta)', () => {
  assert.deepEqual(['EFECTIVO', 'TRANSFERENCIA', 'TARJETA'].map((m) => metodoDePedido(m as never)), ['CASH', 'TRANSFER', 'CARD'])
  assert.deepEqual(['EFECTIVO', 'TRANSFERENCIA', 'TARJETA'].map((m) => metodoDeCaja(m as never)), ['EFECTIVO', 'TRANSFERENCIA', 'OTRO'])
  assert.equal(esMetodoPos('EFECTIVO'), true)
  for (const raro of ['efectivo', 'CASH', '', null, undefined, 3]) assert.equal(esMetodoPos(raro), false)
})

test('solo la transferencia y la tarjeta pueden verificar un pago: el efectivo deja constancia pero no verifica', () => {
  assert.deepEqual([metodoVerifica('EFECTIVO'), metodoVerifica('TRANSFERENCIA'), metodoVerifica('TARJETA')], [false, true, true])
  // Y la regla del dominio de pedidos es la misma: con referencia y por el monto.
  assert.equal(pagoVerificado(250, { method: 'CASH', amount: 250, reference: 'x' }), false)
  assert.equal(pagoVerificado(250, { method: 'TRANSFER', amount: 250, reference: 'TRF' }), true)
  assert.equal(pagoVerificado(250, { method: 'CARD', amount: 250, reference: null }), false)
})

test('cobro: transferencia y tarjeta EXIGEN su referencia; el efectivo no', () => {
  const total = D(250)
  assert.equal(validarCobroPos({ metodo: 'TRANSFERENCIA' }, total).ok, false)
  assert.equal(validarCobroPos({ metodo: 'TARJETA', referencia: '   ' }, total).ok, false)
  const t = validarCobroPos({ metodo: 'TRANSFERENCIA', referencia: '  TRF   123  ' }, total)
  assert.ok(t.ok)
  if (t.ok) assert.equal(t.cobro.referencia, 'TRF 123', 'espacios normalizados')
  const e = validarCobroPos({ metodo: 'EFECTIVO' }, total)
  assert.ok(e.ok)
  if (e.ok) assert.deepEqual({ r: e.cobro.referencia, rec: e.cobro.recibido, c: e.cobro.cambio }, { r: null, rec: null, c: null })
})

test('cobro: la referencia no pasa del máximo y un método desconocido se rechaza', () => {
  assert.equal(validarCobroPos({ metodo: 'TRANSFERENCIA', referencia: 'x'.repeat(81) }, D(1)).ok, false)
  assert.equal(validarCobroPos({ metodo: 'TRANSFERENCIA', referencia: 'x'.repeat(80) }, D(1)).ok, true)
  assert.equal(validarCobroPos({ metodo: 'CRIPTO', referencia: 'a' }, D(1)).ok, false)
  assert.equal(validarCobroPos({ metodo: undefined }, D(1)).ok, false)
})

test('efectivo: lo recibido tiene que alcanzar y el cambio sale exacto con dos decimales', () => {
  const r = validarCobroPos({ metodo: 'EFECTIVO', recibido: '1000' }, D('799.99'))
  assert.ok(r.ok)
  if (r.ok) assert.equal(r.cobro.cambio?.toFixed(2), '200.01')
  const justo = validarCobroPos({ metodo: 'EFECTIVO', recibido: 250 }, D(250))
  assert.ok(justo.ok)
  if (justo.ok) assert.equal(justo.cobro.cambio?.toFixed(2), '0.00')
  for (const malo of ['100', '249.99', 'mucho', '1e3', '-5', '1,000']) assert.equal(validarCobroPos({ metodo: 'EFECTIVO', recibido: malo }, D(250)).ok, false, malo)
})

test('carrito: une los renglones iguales, exige enteros entre 1 y el máximo y no deja pasar un carrito vacío', () => {
  const r = validarCarrito([{ varianteId: 'a', cantidad: 2 }, { varianteId: 'b', cantidad: 1 }, { varianteId: 'a', cantidad: 3 }])
  assert.ok(r.ok)
  if (r.ok) assert.deepEqual(r.lineas, [{ varianteId: 'a', cantidad: 5 }, { varianteId: 'b', cantidad: 1 }])
  for (const malo of [[], null, 'x', [{ varianteId: '', cantidad: 1 }], [{ varianteId: 'a', cantidad: 0 }], [{ varianteId: 'a', cantidad: 1.5 }], [{ varianteId: 'a', cantidad: MAX_CANTIDAD_MOSTRADOR + 1 }], [{ varianteId: 'a', cantidad: -1 }], [{ varianteId: 'a', cantidad: 'dos' }]]) {
    assert.equal(validarCarrito(malo).ok, false, JSON.stringify(malo))
  }
  assert.equal(validarCarrito(Array.from({ length: MAX_LINEAS_MOSTRADOR + 1 }, (_, i) => ({ varianteId: `v${i}`, cantidad: 1 }))).ok, false)
  // Dos renglones que sumados pasan el máximo también se rechazan.
  assert.equal(validarCarrito([{ varianteId: 'a', cantidad: 600 }, { varianteId: 'a', cantidad: 600 }]).ok, false)
})

test('el carrito ignora cualquier campo que no sea la variante y la cantidad (precio, descuento)', () => {
  const r = validarCarrito([{ varianteId: 'a', cantidad: 1, precio: 1, descuento: 99 }])
  assert.ok(r.ok)
  if (r.ok) assert.deepEqual(Object.keys(r.lineas[0]).sort(), ['cantidad', 'varianteId'])
})

test('clave del envío: solo caracteres seguros y de largo razonable; la clave de venta es por caja', () => {
  for (const ok of ['abcd1234', 'a-b_c-1234567', 'x'.repeat(80)]) assert.equal(claveDelEnvioValida(ok), true)
  for (const malo of ['corta', 'x'.repeat(81), 'con espacio 123', 'raro;--drop', '', null, 12345678]) assert.equal(claveDelEnvioValida(malo), false, String(malo))
  assert.equal(claveDeVenta('caja1', 'clave1234'), 'pos:caja1:clave1234')
  assert.notEqual(claveDeVenta('caja1', 'clave1234'), claveDeVenta('caja2', 'clave1234'))
})
