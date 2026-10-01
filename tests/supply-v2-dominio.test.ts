import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aplicarMovimiento,
  cubetasVacias,
  invarianteCumplido,
  saldoDeAsientos,
  validarMovimiento,
  type LedgerMove,
} from '../src/modules/supply-v2/core/ledger'
import {
  estadoTrasRecepcion,
  exigirTransicion,
  puedeAprobar,
  TRANSICIONES_ORDEN,
  validarCantidadRecibida,
} from '../src/modules/supply-v2/core/estados'
import { calcularTotales, validarLinea, valorDeLotes } from '../src/modules/supply-v2/core/dinero'
import { formatearNumero, secuenciaDeNumero } from '../src/modules/supply-v2/core/numeracion'
import { acuerdoCompatible, validarAcuerdo } from '../src/modules/supply-v2/agreements/domain'
import { normalizarProveedor, validarProveedorExterno } from '../src/modules/supply-v2/suppliers/domain'
import { normalizarItemCatalogo, slugDeNombre, validarItemCatalogo } from '../src/modules/supply-v2/catalog/domain'

/**
 * MEMBEGO SUPPLY 2.0 · pruebas de dominio PURAS (§48). Sin base de datos: lo
 * que aquí se prueba es lo que decide qué es válido y cuánto queda.
 */

const recibir = (q: number): LedgerMove => ({ type: 'RECEIPT', sourceBucket: null, destinationBucket: 'AVAILABLE', quantity: q })

// ── Ledger ──────────────────────────────────────────────────────────────────

test('ledger · una recepción entra en AVAILABLE y el invariante cuadra', () => {
  const despues = aplicarMovimiento(cubetasVacias(), recibir(500))
  assert.equal(despues.AVAILABLE, 500)
  assert.ok(invarianteCumplido(500, despues))
})

test('ledger · tres recepciones suman lo recibido (500 + 300 + 200 = 1.000)', () => {
  const saldo = saldoDeAsientos([recibir(500), recibir(300), recibir(200)])
  assert.equal(saldo.AVAILABLE, 1000)
  assert.ok(invarianteCumplido(1000, saldo))
})

test('ledger · los balances nunca quedan negativos', () => {
  const b = aplicarMovimiento(cubetasVacias(), recibir(10))
  assert.throws(
    () => aplicarMovimiento(b, { type: 'CANCELLATION', sourceBucket: 'AVAILABLE', destinationBucket: 'CLOSED', quantity: 11, reason: 'prueba' }),
    /No hay 11 unidades/
  )
})

test('ledger · rechaza cantidades no positivas, traslados no declarados y ajustes sin motivo', () => {
  assert.match(validarMovimiento({ ...recibir(0) })!, /entera positiva/)
  assert.match(validarMovimiento({ type: 'RECEIPT', sourceBucket: 'AVAILABLE', destinationBucket: 'CLOSED', quantity: 1 })!, /no puede ir/)
  assert.match(validarMovimiento({ type: 'ADJUSTMENT', sourceBucket: 'AVAILABLE', destinationBucket: 'CLOSED', quantity: 1 })!, /motivo/)
  assert.equal(validarMovimiento({ type: 'ADJUSTMENT', sourceBucket: 'AVAILABLE', destinationBucket: 'CLOSED', quantity: 1, reason: 'descuadre' }), null)
})

test('ledger · el invariante detecta un descuadre', () => {
  const b = { ...cubetasVacias(), AVAILABLE: 400, CLOSED: 50 }
  assert.equal(invarianteCumplido(500, b), false)
  assert.equal(invarianteCumplido(450, b), true)
})

// ── Máquina de estados de la orden ───────────────────────────────────────────

test('orden · DRAFT → PENDING_APPROVAL → APPROVED; no se salta la aprobación', () => {
  exigirTransicion(TRANSICIONES_ORDEN, 'DRAFT', 'PENDING_APPROVAL', 'Orden')
  exigirTransicion(TRANSICIONES_ORDEN, 'PENDING_APPROVAL', 'APPROVED', 'Orden')
  assert.throws(() => exigirTransicion(TRANSICIONES_ORDEN, 'DRAFT', 'APPROVED', 'Orden'), /no se puede pasar/)
  assert.throws(() => exigirTransicion(TRANSICIONES_ORDEN, 'RECEIVED', 'DRAFT', 'Orden'), /no se puede pasar/)
})

test('orden · el creador no puede autoaprobar salvo que la política lo permita', () => {
  assert.match(puedeAprobar({ createdById: 'u1' }, 'u1')!, /no la puede aprobar/)
  assert.equal(puedeAprobar({ createdById: 'u1' }, 'u2'), null)
  assert.equal(puedeAprobar({ createdById: 'u1' }, 'u1', true), null)
})

test('recepción · 500 de 1.000 deja PARTIALLY_RECEIVED; completar deja RECEIVED', () => {
  assert.equal(estadoTrasRecepcion([{ quantity: 1000, receivedQuantity: 500 }]), 'PARTIALLY_RECEIVED')
  assert.equal(estadoTrasRecepcion([{ quantity: 1000, receivedQuantity: 800 }]), 'PARTIALLY_RECEIVED')
  assert.equal(estadoTrasRecepcion([{ quantity: 1000, receivedQuantity: 1000 }]), 'RECEIVED')
})

test('recepción · nunca por encima de lo comprado (1.001 falla, 0 falla)', () => {
  const linea = { quantity: 1000, receivedQuantity: 800 }
  assert.equal(validarCantidadRecibida(200, linea), null)
  assert.match(validarCantidadRecibida(201, linea)!, /Solo quedan 200/)
  assert.match(validarCantidadRecibida(0, linea)!, /entero positivo/)
  assert.match(validarCantidadRecibida(1, { quantity: 1000, receivedQuantity: 1000 })!, /ya se recibió/)
})

// ── Dinero ──────────────────────────────────────────────────────────────────

test('dinero · 1.000 × 300 = 300.000 sin impuestos; con 18 % son 354.000', () => {
  const t = calcularTotales([{ quantity: 1000, unitCost: 300 }])
  assert.equal(t.subtotal.toFixed(2), '300000.00')
  assert.equal(t.taxes.toFixed(2), '0.00')
  assert.equal(t.total.toFixed(2), '300000.00')
  const con = calcularTotales([{ quantity: 1000, unitCost: '300' }], 18)
  assert.equal(con.taxes.toFixed(2), '54000.00')
  assert.equal(con.total.toFixed(2), '354000.00')
})

test('dinero · usa Decimal, no floats: 3 × 0.10 = 0.30 exacto', () => {
  const t = calcularTotales([{ quantity: 3, unitCost: '0.10' }])
  assert.equal(t.subtotal.toString(), '0.3')
})

test('dinero · rechaza cantidad ≤ 0, costo negativo e impuestos fuera de rango', () => {
  assert.match(validarLinea({ quantity: 0, unitCost: 1 })!, /entero positivo/)
  assert.match(validarLinea({ quantity: 1, unitCost: -1 })!, /negativo/)
  assert.throws(() => calcularTotales([{ quantity: 1, unitCost: 1 }], -1), /entre 0 y 100/)
  assert.throws(() => calcularTotales([], 0), /sin líneas/)
})

test('dinero · valor adquirido = unidades × costo congelado de cada lote', () => {
  assert.equal(valorDeLotes([{ quantity: 500, unitCost: 300 }, { quantity: 300, unitCost: '280' }]).toFixed(2), '234000.00')
})

// ── Numeración ──────────────────────────────────────────────────────────────

test('numeración · formato MBG-PO-2026-000001 y lectura de la secuencia', () => {
  assert.equal(formatearNumero('MBG-PO', 2026, 1), 'MBG-PO-2026-000001')
  assert.equal(secuenciaDeNumero('MBG-PO-2026-000127'), 127)
  assert.equal(secuenciaDeNumero('LOT-2026-000009'), 9)
  assert.equal(formatearNumero('LOT', 2026, secuenciaDeNumero('LOT-2026-000009') + 1), 'LOT-2026-000010')
})

// ── Acuerdos ────────────────────────────────────────────────────────────────

const hoy = new Date('2026-06-01T12:00:00Z')
const baseAcuerdo = {
  status: 'ACTIVE',
  type: 'PREPAID_PURCHASE' as const,
  scope: 'ITEM' as const,
  catalogItemId: 'item-1',
  category: null,
  startsAt: new Date('2026-01-01'),
  endsAt: new Date('2026-12-31'),
}

test('acuerdo · compatible solo si vigente, del tipo del Slice 1 y cubre el ítem', () => {
  const item = { id: 'item-1', category: 'Pizzas' }
  assert.equal(acuerdoCompatible(baseAcuerdo, item, hoy), true)
  assert.equal(acuerdoCompatible({ ...baseAcuerdo, catalogItemId: 'otro' }, item, hoy), false)
  assert.equal(acuerdoCompatible({ ...baseAcuerdo, status: 'DRAFT' }, item, hoy), false)
  assert.equal(acuerdoCompatible({ ...baseAcuerdo, endsAt: new Date('2026-05-01') }, item, hoy), false)
  assert.equal(acuerdoCompatible({ ...baseAcuerdo, type: 'COMMISSION' }, item, hoy), false)
  assert.equal(acuerdoCompatible({ ...baseAcuerdo, scope: 'CATEGORY', catalogItemId: null, category: 'pizzas' }, item, hoy), true)
  assert.equal(acuerdoCompatible({ ...baseAcuerdo, scope: 'CATALOG', catalogItemId: null }, { id: 'x', category: null }, hoy), true)
})

test('acuerdo · valida fechas, costo y tipos del Slice 1', () => {
  const ok = { supplierId: 's', type: 'PREPAID_PURCHASE' as const, catalogItemId: 'i', negotiatedUnitCost: 300, startsAt: new Date('2026-01-01'), endsAt: new Date('2026-12-31') }
  assert.equal(validarAcuerdo(ok), null)
  assert.match(validarAcuerdo({ ...ok, endsAt: new Date('2025-12-31') })!, /posterior/)
  assert.match(validarAcuerdo({ ...ok, negotiatedUnitCost: -1 })!, /negativo/)
  // Slice 5 abrió COMMISSION (con sus propias reglas); HYBRID y OPEN_DEPOSIT siguen fuera.
  assert.match(validarAcuerdo({ ...ok, type: 'HYBRID' })!, /solo se pueden crear/)
  assert.match(validarAcuerdo({ ...ok, type: 'COMMISSION', negotiatedUnitCost: null })!, /porcentaje/)
  assert.match(validarAcuerdo({ ...ok, catalogItemId: null })!, /necesita el producto/)
})

// ── Proveedor y catálogo ────────────────────────────────────────────────────

test('proveedor · exige nombre, valida correo y normaliza moneda y país', () => {
  assert.match(validarProveedorExterno({ commercialName: '  ' })!, /nombre comercial/)
  assert.match(validarProveedorExterno({ commercialName: 'Little Pizza', email: 'no-es-correo' })!, /correo/)
  const n = normalizarProveedor({ commercialName: ' Little Pizza ', email: 'Hola@LittlePizza.do', currency: 'dop', countryCode: 'do' })
  assert.equal(n.commercialName, 'Little Pizza')
  assert.equal(n.email, 'hola@littlepizza.do')
  assert.equal(n.currency, 'DOP')
  assert.equal(n.countryCode, 'DO')
})

test('catálogo · el nombre no es el identificador: el slug se deriva y el SKU se normaliza', () => {
  assert.equal(slugDeNombre('Pizza Grande Pepperoni'), 'pizza-grande-pepperoni')
  assert.equal(slugDeNombre('Ñoquis à la crème!'), 'noquis-a-la-creme')
  assert.match(validarItemCatalogo({ supplierId: 's', type: 'PRODUCT', name: '' })!, /nombre/)
  assert.match(validarItemCatalogo({ supplierId: 's', type: 'PRODUCT', name: 'x', publicPrice: -5 })!, /negativo/)
  const n = normalizarItemCatalogo({ supplierId: 's', type: 'PRODUCT', name: ' Pizza ', sku: ' piz-pep-g ', publicPrice: '600' })
  assert.equal(n.sku, 'PIZ-PEP-G')
  assert.equal(n.publicPrice, '600')
  assert.equal(n.unit, 'UNIT')
})
