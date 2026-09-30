import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ordenarFefo, repartirFefo } from '../src/modules/supply-v2/core/fefo'
import { calcularLineaCliente, calcularPrecioOferta, margenEstimado, montoCuadra, validarPreciosOferta } from '../src/modules/supply-v2/core/precios'
import {
  estadoInicialOferta,
  exigirTransicion,
  motivoNoComprable,
  TRANSICIONES_OFERTA,
  TRANSICIONES_ORDEN_CLIENTE,
  unidadesQueCuentanParaLimite,
  validarLimitePorCliente,
} from '../src/modules/supply-v2/core/estados'
import { aplicarMovimiento, cubetasVacias, invarianteCumplido } from '../src/modules/supply-v2/core/ledger'
import { ttlReservaMinutos, vencimientoDeReserva } from '../src/modules/supply-v2/core/config'
import { unidadesLibres, validarOferta, slugDeOferta } from '../src/modules/supply-v2/offers/domain'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 2 · pruebas de dominio PURAS (§55).
 */

const DIA = 86_400_000
const hoy = new Date('2026-06-01T12:00:00Z')
const en = (dias: number) => new Date(hoy.getTime() + dias * DIA)

// ── FEFO ────────────────────────────────────────────────────────────────────

test('FEFO · vence antes primero; sin vencimiento, recepción más antigua', () => {
  const orden = ordenarFefo([
    { id: 'sin-venc-nuevo', disponible: 1, expiresAt: null, receivedAt: en(-1) },
    { id: 'vence-tarde', disponible: 1, expiresAt: en(60), receivedAt: en(-10) },
    { id: 'vence-pronto', disponible: 1, expiresAt: en(30), receivedAt: en(-2) },
    { id: 'sin-venc-viejo', disponible: 1, expiresAt: null, receivedAt: en(-20) },
  ])
  assert.deepEqual(orden.map((c) => c.id), ['vence-pronto', 'vence-tarde', 'sin-venc-viejo', 'sin-venc-nuevo'])
})

test('FEFO · 100 entre LOT-A (60) y LOT-B (50) → 60 + 40, quedan 10 en B', () => {
  const reparto = repartirFefo(
    [
      { id: 'B', disponible: 50, expiresAt: en(60), receivedAt: en(-1) },
      { id: 'A', disponible: 60, expiresAt: en(30), receivedAt: en(-1) },
    ],
    100
  )
  assert.deepEqual(reparto, [
    { id: 'A', cantidad: 60 },
    { id: 'B', cantidad: 40 },
  ])
})

test('FEFO · asignar 1.001 de 1.000 falla y no reparte a medias', () => {
  assert.throws(() => repartirFefo([{ id: 'A', disponible: 1000, expiresAt: null, receivedAt: hoy }], 1001), /Solo hay 1.000|Solo hay 1,000/)
  assert.throws(() => repartirFefo([{ id: 'A', disponible: 1, expiresAt: null, receivedAt: hoy }], 0), /entero positivo/)
})

// ── Precios ─────────────────────────────────────────────────────────────────

test('precio · 600 → 399: ahorro 201, descuento 33.5 %, margen estimado 99 con costo 300', () => {
  const p = calcularPrecioOferta(600, '399')
  assert.equal(p.discount.toFixed(2), '201.00')
  assert.equal(p.discountPercentage, 33.5)
  assert.equal(margenEstimado(399, 300).toFixed(2), '99.00')
})

test('precio · Membego no puede superar al público ni ser negativo', () => {
  assert.match(validarPreciosOferta(600, 601)!, /no puede ser mayor/)
  assert.match(validarPreciosOferta(-1, 0)!, /negativo/)
  assert.equal(validarPreciosOferta(600, 600), null)
})

test('línea del cliente · 1 × (600 → 399): subtotal 600, descuento 201, total 399; 3 unidades multiplican', () => {
  const l = calcularLineaCliente(600, 399, 1)
  assert.equal(l.subtotal.toFixed(2), '600.00')
  assert.equal(l.discount.toFixed(2), '201.00')
  assert.equal(l.total.toFixed(2), '399.00')
  const t = calcularLineaCliente('600', '399', 3)
  assert.equal(t.total.toFixed(2), '1197.00')
  assert.equal(t.discount.toFixed(2), '603.00')
})

test('monto visto · cuadra con un centavo de tolerancia', () => {
  assert.equal(montoCuadra('399.00', 399), true)
  assert.equal(montoCuadra(398.995, 399), true)
  assert.equal(montoCuadra(398, 399), false)
})

// ── Oferta ──────────────────────────────────────────────────────────────────

test('oferta · futura nace SCHEDULED, vigente ACTIVE', () => {
  assert.equal(estadoInicialOferta(en(1), hoy), 'SCHEDULED')
  assert.equal(estadoInicialOferta(en(-1), hoy), 'ACTIVE')
})

test('oferta · no comprable si es futura, vencida, pausada, agotada o sin unidades', () => {
  const base = { status: 'ACTIVE' as const, startsAt: en(-1), endsAt: en(10) }
  assert.equal(motivoNoComprable(base, 5, hoy), null)
  assert.match(motivoNoComprable({ ...base, status: 'SCHEDULED', startsAt: en(1) }, 5, hoy)!, /todavía no/)
  assert.match(motivoNoComprable({ ...base, endsAt: en(-1) }, 5, hoy)!, /terminó/)
  assert.match(motivoNoComprable({ ...base, status: 'PAUSED' }, 5, hoy)!, /pausada/)
  assert.match(motivoNoComprable({ ...base, status: 'SOLD_OUT' }, 5, hoy)!, /agotó/)
  assert.match(motivoNoComprable(base, 0, hoy)!, /agotó/)
})

test('oferta · transiciones: pausar y reanudar; finalizada y cancelada son terminales', () => {
  exigirTransicion(TRANSICIONES_OFERTA, 'ACTIVE', 'PAUSED', 'Oferta')
  exigirTransicion(TRANSICIONES_OFERTA, 'PAUSED', 'ACTIVE', 'Oferta')
  exigirTransicion(TRANSICIONES_OFERTA, 'ACTIVE', 'ENDED', 'Oferta')
  assert.throws(() => exigirTransicion(TRANSICIONES_OFERTA, 'ENDED', 'ACTIVE', 'Oferta'), /no se puede pasar/)
  assert.throws(() => exigirTransicion(TRANSICIONES_OFERTA, 'CANCELLED', 'ACTIVE', 'Oferta'), /no se puede pasar/)
})

test('oferta · validación: cantidad, límite por persona y vigencia', () => {
  const ok = { catalogItemId: 'i', title: 'Pizza', publicPrice: 600, salePrice: 399, quantity: 100, perCustomerLimit: 2, startsAt: en(-1), endsAt: en(30) }
  assert.equal(validarOferta(ok), null)
  assert.match(validarOferta({ ...ok, quantity: 0 })!, /entero positivo/)
  assert.match(validarOferta({ ...ok, perCustomerLimit: 101 })!, /no puede superar/)
  assert.match(validarOferta({ ...ok, endsAt: en(-2) })!, /posterior/)
  assert.match(validarOferta({ ...ok, salePrice: 700 })!, /no puede ser mayor/)
  assert.equal(slugDeOferta('Pizza Grande Pepperoni', 'MBG-OF-2026-000001'), 'pizza-grande-pepperoni-mbg-of-2026-000001')
})

test('oferta · unidades libres = asignadas − reservadas − emitidas − liberadas', () => {
  assert.equal(unidadesLibres({ allocatedQuantity: 100, reservedQuantity: 1, issuedQuantity: 2, releasedQuantity: 0 }), 97)
  assert.equal(unidadesLibres({ allocatedQuantity: 100, reservedQuantity: 0, issuedQuantity: 0, releasedQuantity: 100 }), 0)
})

// ── Orden del cliente y límite ──────────────────────────────────────────────

test('orden cliente · PENDING → AWAITING_PAYMENT → PAID; cancelar y expirar son terminales', () => {
  exigirTransicion(TRANSICIONES_ORDEN_CLIENTE, 'PENDING', 'AWAITING_PAYMENT', 'Compra')
  exigirTransicion(TRANSICIONES_ORDEN_CLIENTE, 'AWAITING_PAYMENT', 'PAID', 'Compra')
  exigirTransicion(TRANSICIONES_ORDEN_CLIENTE, 'PENDING', 'PAID', 'Compra')
  assert.throws(() => exigirTransicion(TRANSICIONES_ORDEN_CLIENTE, 'EXPIRED', 'PAID', 'Compra'), /no se puede pasar/)
  assert.throws(() => exigirTransicion(TRANSICIONES_ORDEN_CLIENTE, 'CANCELLED', 'PENDING', 'Compra'), /no se puede pasar/)
})

test('límite por cliente · cuentan pagadas y reservas vivas; expiradas y canceladas no', () => {
  const ya = unidadesQueCuentanParaLimite([
    { status: 'PAID', quantity: 1 },
    { status: 'PENDING', quantity: 1 },
    { status: 'EXPIRED', quantity: 5 },
    { status: 'CANCELLED', quantity: 5 },
  ])
  assert.equal(ya, 2)
  assert.equal(validarLimitePorCliente(2, 1, 1), null)
  assert.match(validarLimitePorCliente(2, 1, 2)!, /Solo puedes comprar 1 más/)
  assert.match(validarLimitePorCliente(2, 2, 1)!, /alcanzaste el máximo/)
})

// ── Ledger del Slice 2 ──────────────────────────────────────────────────────

test('ledger · AVAILABLE → ALLOCATED → RESERVED → ISSUED mantiene el invariante; RESERVED vuelve a ALLOCATED', () => {
  let b = aplicarMovimiento(cubetasVacias(), { type: 'RECEIPT', sourceBucket: null, destinationBucket: 'AVAILABLE', quantity: 1000 })
  b = aplicarMovimiento(b, { type: 'ALLOCATION', sourceBucket: 'AVAILABLE', destinationBucket: 'ALLOCATED', quantity: 100 })
  assert.deepEqual([b.AVAILABLE, b.ALLOCATED], [900, 100])
  b = aplicarMovimiento(b, { type: 'RESERVATION', sourceBucket: 'ALLOCATED', destinationBucket: 'RESERVED', quantity: 1 })
  assert.deepEqual([b.ALLOCATED, b.RESERVED], [99, 1])
  const cancelada = aplicarMovimiento(b, { type: 'RELEASE_RESERVATION', sourceBucket: 'RESERVED', destinationBucket: 'ALLOCATED', quantity: 1 })
  assert.deepEqual([cancelada.ALLOCATED, cancelada.RESERVED], [100, 0])
  b = aplicarMovimiento(b, { type: 'ISSUE', sourceBucket: 'RESERVED', destinationBucket: 'ISSUED', quantity: 1 })
  assert.deepEqual([b.AVAILABLE, b.ALLOCATED, b.RESERVED, b.ISSUED], [900, 99, 0, 1])
  assert.ok(invarianteCumplido(1000, b))
  // RESERVED nunca queda en negativo, y un ISSUE no puede saltarse la reserva.
  assert.throws(() => aplicarMovimiento(b, { type: 'ISSUE', sourceBucket: 'RESERVED', destinationBucket: 'ISSUED', quantity: 1 }), /No hay 1 unidades/)
  assert.throws(() => aplicarMovimiento(b, { type: 'ISSUE', sourceBucket: 'AVAILABLE', destinationBucket: 'RESERVED', quantity: 1 }), /no puede ir/)
})

// ── Configuración ───────────────────────────────────────────────────────────

test('TTL · 15 minutos por defecto, configurable por entorno, y el vencimiento se calcula con él', () => {
  const previo = process.env.SUPPLY_V2_RESERVATION_TTL_MINUTES
  delete process.env.SUPPLY_V2_RESERVATION_TTL_MINUTES
  assert.equal(ttlReservaMinutos(), 15)
  process.env.SUPPLY_V2_RESERVATION_TTL_MINUTES = '3'
  assert.equal(ttlReservaMinutos(), 3)
  assert.equal(vencimientoDeReserva(hoy).getTime(), hoy.getTime() + 3 * 60_000)
  process.env.SUPPLY_V2_RESERVATION_TTL_MINUTES = 'no'
  assert.equal(ttlReservaMinutos(), 15)
  if (previo === undefined) delete process.env.SUPPLY_V2_RESERVATION_TTL_MINUTES
  else process.env.SUPPLY_V2_RESERVATION_TTL_MINUTES = previo
})
