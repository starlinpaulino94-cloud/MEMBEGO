/**
 * MEMBEGO SUPPLY · el cobro a nombre de la plataforma (Fases 22-23).
 *
 * Estas pruebas EJECUTAN la aritmética, no leen el archivo. Todo lo que hay aquí
 * decide si Membego cobra bien o regala dinero sin enterarse.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  desglosarVenta,
  esFinal,
  montoCuadra,
  TEXTO_ESTADO_PEDIDO,
  TRANSICIONES_PEDIDO,
  transicionLegal,
  type EstadoPedido,
} from '../src/modules/supply/cobro-nucleo'

const fuente = (f: string) => readFileSync(join(process.cwd(), 'src/modules/supply', f), 'utf8')

// ── El monto se compara, no se confía ───────────────────────────────────────

test('un monto igual cuadra', () => {
  assert.equal(montoCuadra(399, 399), true)
  assert.equal(montoCuadra(0, 0), true)
})

test('la coma flotante no rechaza un pago correcto', () => {
  // Lo que de verdad llega cuando el monto pasa por Decimal y vuelve.
  assert.equal(montoCuadra(398.99999999999994, 399), true)
  assert.equal(montoCuadra(0.1 + 0.2, 0.3), true)
})

test('un comprobante por menos NO cuadra, y por poco tampoco', () => {
  assert.equal(montoCuadra(39, 399), false)
  assert.equal(montoCuadra(395, 399), false, 'un 1% de tolerancia regalaría 4 pesos por venta')
  assert.equal(montoCuadra(398.98, 399), false)
})

test('un comprobante por MÁS tampoco cuadra', () => {
  // Cobrar de más no es «mejor»: es un descuadre, y el cliente tiene razón en
  // reclamarlo. Se para y lo mira una persona.
  assert.equal(montoCuadra(500, 399), false)
})

test('basura no cuadra con nada', () => {
  assert.equal(montoCuadra(Number.NaN, 399), false)
  assert.equal(montoCuadra(399, Number.NaN), false)
  assert.equal(montoCuadra(Number.POSITIVE_INFINITY, 399), false)
})

// ── La máquina de estados ───────────────────────────────────────────────────

test('de PAGADO no se sale', () => {
  assert.equal(esFinal('PAGADO'), true)
  for (const hacia of ['INICIADO', 'EN_REVISION', 'RECHAZADO', 'EXPIRADO', 'CANCELADO'] as const) {
    assert.equal(transicionLegal('PAGADO', hacia), false, `PAGADO → ${hacia} no puede ser legal`)
  }
})

test('de EXPIRADO no se sale: la unidad ya volvió al pool', () => {
  assert.equal(esFinal('EXPIRADO'), true)
  assert.equal(transicionLegal('EXPIRADO', 'PAGADO'), false)
})

test('solo un pedido en revisión se puede pagar', () => {
  assert.equal(transicionLegal('EN_REVISION', 'PAGADO'), true)
  assert.equal(transicionLegal('INICIADO', 'PAGADO'), false, 'sin comprobante no se paga')
  assert.equal(transicionLegal('CANCELADO', 'PAGADO'), false)
})

test('el cliente puede cancelar antes de pagar, y expirar siempre es posible', () => {
  assert.equal(transicionLegal('INICIADO', 'CANCELADO'), true)
  assert.equal(transicionLegal('INICIADO', 'EXPIRADO'), true)
  assert.equal(transicionLegal('EN_REVISION', 'EXPIRADO'), true)
  // Pero un pedido con comprobante NO lo cancela el cliente: puede haber dinero
  // transferido, y eso se rechaza con motivo y revisor, no se borra.
  assert.equal(transicionLegal('EN_REVISION', 'CANCELADO'), false)
})

test('los cuatro estados finales son exactamente cuatro', () => {
  const finales = (Object.keys(TRANSICIONES_PEDIDO) as EstadoPedido[]).filter(esFinal)
  assert.deepEqual(finales.sort(), ['CANCELADO', 'EXPIRADO', 'PAGADO', 'RECHAZADO'])
})

test('cada estado tiene texto para el cliente', () => {
  for (const e of Object.keys(TRANSICIONES_PEDIDO) as EstadoPedido[]) {
    assert.ok(TEXTO_ESTADO_PEDIDO[e]?.length > 0, `falta el texto de ${e}`)
  }
})

// ── Venta completa ≠ subsidio (Fase 24, ADR-0003) ───────────────────────────

test('en una venta completa el comercio no recibe nada del cliente', () => {
  const d = desglosarVenta(399, 300)
  assert.equal(d.aporteClienteAlComercio, 0, 'si esto no es 0, es un subsidio, no una venta')
  assert.equal(d.margen, 99)
})

test('los números del encargo', () => {
  // Pizza pública RD$700, costo Membego RD$300, Membego vende a RD$399.
  const d = desglosarVenta(399, 300)
  assert.equal(d.precioCliente, 399)
  assert.equal(d.costoMembego, 300)
  assert.equal(d.margen, 99)
})

test('vender por debajo del costo da margen negativo, y no se redondea', () => {
  // Liquidar un lote que vence es legítimo. Esconder la pérdida no.
  const d = desglosarVenta(250, 300)
  assert.equal(d.margen, -50)
})

test('un regalo es precio 0, y su margen es el costo en negativo', () => {
  const d = desglosarVenta(0, 300)
  assert.equal(d.margen, -300, 'un regalo cuesta 300: eso es el CAC, no un cero')
})

test('no se desglosa un precio ni un costo negativo', () => {
  assert.throws(() => desglosarVenta(-1, 300), /no puede ser negativo/)
  assert.throws(() => desglosarVenta(399, -1), /no puede ser negativo/)
})

// ── Promesas estructurales ──────────────────────────────────────────────────

test('el hold se pone ANTES de crear el pedido', () => {
  const src = fuente('cobro.ts')
  const posHold = src.indexOf('const hold = await retener(')
  const posPedido = src.indexOf('tx.supplyPedido.create(')
  assert.ok(posHold > 0 && posPedido > 0)
  assert.ok(
    posHold < posPedido,
    'al revés habría un instante con un pedido cobrable sobre una unidad que otro puede llevarse'
  )
})

test('si el pedido no se puede crear, la unidad se suelta ya', () => {
  const src = fuente('cobro.ts')
  assert.match(src, /catch \(e\)[\s\S]{0,400}cancelarDerecho\(/)
})

test('un comprobante que llega tarde no revive el pedido', () => {
  const src = fuente('cobro.ts')
  assert.match(src, /pedido\.expiraAt <= new Date\(\)/)
})
