/**
 * App Car Wash · pruebas del STOCK del inventario. Ejecutar: npm test
 *
 * Lógica pura (src/modules/carwash/inventario.ts), la misma que usa
 * `registrarMovimiento` en producción dentro de su transacción. Lo que se
 * protege aquí es que el stock guardado y el `stockResultante` congelado en
 * el movimiento nunca se separen: son el rastro de auditoría del inventario.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MOV_TIPOS,
  MOV_TIPO_LABELS,
  calcularNuevoStock,
  esStockBajo,
  parseCantidad,
} from '../src/modules/carwash/inventario'

// ── Catálogo ─────────────────────────────────────────────────────────────────

test('todo tipo de movimiento tiene etiqueta legible', () => {
  for (const t of MOV_TIPOS) {
    assert.ok(MOV_TIPO_LABELS[t], `falta MOV_TIPO_LABELS[${t}]`)
  }
})

// ── Lectura de cantidades escritas por el usuario ────────────────────────────

test('parseCantidad acepta punto y coma decimal', () => {
  assert.equal(parseCantidad('12.5'), 12.5)
  assert.equal(parseCantidad('12,5'), 12.5, 'en RD se escribe con coma')
  assert.equal(parseCantidad(' 8 '), 8)
})

test('parseCantidad rechaza negativos y basura', () => {
  assert.equal(parseCantidad('-5'), null)
  assert.equal(parseCantidad('abc'), null)
  assert.equal(parseCantidad(''), null)
  assert.equal(parseCantidad(null), null)
  assert.equal(parseCantidad(undefined), null)
})

test('parseCantidad redondea a centésimas', () => {
  assert.equal(parseCantidad('3.456'), 3.46)
})

// ── Movimientos ──────────────────────────────────────────────────────────────

test('ENTRADA suma al stock', () => {
  assert.equal(calcularNuevoStock('ENTRADA', 10, 5), 15)
})

test('SALIDA resta del stock', () => {
  assert.equal(calcularNuevoStock('SALIDA', 10, 8), 2)
})

test('AJUSTE FIJA el stock (es un conteo físico, no un delta)', () => {
  // Si alguien lo tratara como suma, el inventario se duplicaría en cada
  // conteo. Este es el caso que más fácil se programa mal.
  assert.equal(calcularNuevoStock('AJUSTE', 10, 3), 3)
  assert.equal(calcularNuevoStock('AJUSTE', 0, 25), 25)
})

test('una salida mayor al stock da negativo (el llamador debe rechazarla)', () => {
  // La función reporta el resultado real; la acción es la que corta con
  // "Stock insuficiente". Esta prueba fija ese contrato.
  assert.equal(calcularNuevoStock('SALIDA', 5, 8), -3)
  assert.ok(calcularNuevoStock('SALIDA', 5, 8) < 0)
})

test('las cantidades decimales no arrastran error de coma flotante', () => {
  // 0.1 + 0.2 === 0.30000000000000004 sin redondeo: el stock guardado y el
  // stockResultante del movimiento dejarían de cuadrar en la auditoría.
  assert.equal(calcularNuevoStock('ENTRADA', 0.1, 0.2), 0.3)
  assert.equal(calcularNuevoStock('SALIDA', 1.3, 1.1), 0.2)
})

test('una salida exacta deja el stock en cero, no en negativo', () => {
  assert.equal(calcularNuevoStock('SALIDA', 7, 7), 0)
})

// ── Alerta de stock bajo ─────────────────────────────────────────────────────

test('stock bajo: se activa al llegar al mínimo, no solo al pasarlo', () => {
  assert.equal(esStockBajo(3, 3), true, 'igual al mínimo ya es bajo')
  assert.equal(esStockBajo(2, 3), true)
  assert.equal(esStockBajo(4, 3), false)
})

test('sin mínimo configurado no hay alerta (0 = sin umbral)', () => {
  assert.equal(esStockBajo(0, 0), false)
  assert.equal(esStockBajo(100, 0), false)
})

// ── Recorrido completo de un producto ────────────────────────────────────────

test('recorrido real: compra, consumo, alerta y conteo físico', () => {
  let stock = 0
  stock = calcularNuevoStock('ENTRADA', stock, 10) // llega el pedido
  assert.equal(stock, 10)
  assert.equal(esStockBajo(stock, 3), false)

  stock = calcularNuevoStock('SALIDA', stock, 8) // consumo de la semana
  assert.equal(stock, 2)
  assert.equal(esStockBajo(stock, 3), true, 'debe alertar para reponer')

  stock = calcularNuevoStock('AJUSTE', stock, 1.5) // conteo físico: había menos
  assert.equal(stock, 1.5)
})
