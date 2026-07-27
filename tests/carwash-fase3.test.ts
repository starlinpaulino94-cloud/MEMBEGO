/**
 * App Car Wash · Fase 3 — pruebas de la lógica pura. Ejecutar: npm test
 *
 * QUÉ SE PROTEGE AQUÍ Y POR QUÉ:
 *
 *  · `siguienteNumero` — si repite un correlativo, el unique de la base
 *    rechaza la orden y el usuario ve un error sin explicación.
 *  · `cantidadAIngresar` — decide cuánto stock entra al recibir. Equivocarse
 *    aquí desajusta el inventario en silencio, que es la peor forma.
 *  · `horasDeTurno` / `costoPorVehiculo` — el costo laboral por lavado sale de
 *    aquí, y ese número se usa para poner precios.
 *  · `urgenciaDe` — decide qué equipo sale en rojo. Un umbral mal puesto
 *    convierte el panel en ruido que nadie mira.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ORDEN_ESTADOS,
  ORDEN_ESTADO_LABELS,
  ORDEN_TRANSICIONES,
  puedeEditarLineas,
  siguienteNumero,
  totalDeLineas,
  cantidadAIngresar,
  type OrdenEstado,
} from '../src/modules/carwash/compras'
import {
  ACTIVO_ESTADOS,
  ACTIVO_ESTADO_LABELS,
  MANTENIMIENTO_TIPOS,
  MANTENIMIENTO_TIPO_LABELS,
  calcularProximo,
  urgenciaDe,
} from '../src/modules/carwash/activos'
import { horasDeTurno, costoPorVehiculo } from '../src/modules/carwash/turnos'

const DIA = 24 * 60 * 60 * 1000

// ── Catálogos ────────────────────────────────────────────────────────────────

test('todo estado/tipo de la Fase 3 tiene etiqueta legible', () => {
  for (const e of ORDEN_ESTADOS) assert.ok(ORDEN_ESTADO_LABELS[e], `falta orden ${e}`)
  for (const e of ACTIVO_ESTADOS) assert.ok(ACTIVO_ESTADO_LABELS[e], `falta activo ${e}`)
  for (const t of MANTENIMIENTO_TIPOS) assert.ok(MANTENIMIENTO_TIPO_LABELS[t], `falta mant ${t}`)
})

// ── Flujo de la orden ────────────────────────────────────────────────────────

test('el flujo de la orden no vuelve atrás', () => {
  // Recibida y cancelada son terminales: una orden recibida ya movió el stock,
  // y "des-recibirla" tendría que restarlo — eso es un ajuste, no un estado.
  assert.deepEqual(ORDEN_TRANSICIONES.RECIBIDA, [])
  assert.deepEqual(ORDEN_TRANSICIONES.CANCELADA, [])
  assert.ok(ORDEN_TRANSICIONES.BORRADOR.includes('PEDIDA'))
  assert.ok(ORDEN_TRANSICIONES.PEDIDA.includes('RECIBIDA'))
  // No se puede saltar de borrador a recibida sin pasar por pedida.
  assert.ok(!ORDEN_TRANSICIONES.BORRADOR.includes('RECIBIDA'))
})

test('solo el borrador permite editar líneas', () => {
  assert.equal(puedeEditarLineas('BORRADOR'), true)
  for (const e of ['PEDIDA', 'RECIBIDA', 'CANCELADA'] as OrdenEstado[]) {
    assert.equal(puedeEditarLineas(e), false, `${e} no debería ser editable`)
  }
})

// ── Correlativo ──────────────────────────────────────────────────────────────

test('el primer número es OC-000001', () => {
  assert.equal(siguienteNumero(null), 'OC-000001')
  assert.equal(siguienteNumero(undefined), 'OC-000001')
})

test('el correlativo avanza de uno en uno y conserva el relleno', () => {
  assert.equal(siguienteNumero('OC-000001'), 'OC-000002')
  assert.equal(siguienteNumero('OC-000041'), 'OC-000042')
  assert.equal(siguienteNumero('OC-000999'), 'OC-001000')
})

test('un número con basura no rompe el correlativo', () => {
  // Si alguien mete a mano "OC-ABC", no debe explotar: vuelve a empezar.
  assert.equal(siguienteNumero('OC-ABC'), 'OC-000001')
})

// ── Totales ──────────────────────────────────────────────────────────────────

test('el total suma cantidad × costo y redondea a dos decimales', () => {
  assert.equal(
    totalDeLineas([
      { cantidad: 3, costoUnitario: 250 },
      { cantidad: 2, costoUnitario: 125.5 },
    ]),
    1001
  )
  assert.equal(totalDeLineas([]), 0)
})

// ── Cuánto entra al stock ────────────────────────────────────────────────────

test('sin cantidad recibida se asume la pedida', () => {
  assert.equal(cantidadAIngresar(10, null), 10)
  assert.equal(cantidadAIngresar(10, undefined), 10)
})

test('una entrega incompleta ingresa lo que llegó, no lo que se pidió', () => {
  // Este es el caso que obliga a tener dos columnas: el proveedor manda 8 de 10.
  assert.equal(cantidadAIngresar(10, 8), 8)
})

test('recibir cero ingresa cero, no la cantidad pedida', () => {
  // Ojo: 0 es un valor legítimo (no llegó nada de esa línea) y NO debe caer al
  // fallback de la cantidad pedida. Confundirlos inflaría el inventario.
  assert.equal(cantidadAIngresar(10, 0), 0)
})

test('una cantidad recibida negativa no resta stock', () => {
  assert.equal(cantidadAIngresar(10, -5), 0)
})

// ── Mantenimiento ────────────────────────────────────────────────────────────

test('sin frecuencia no hay próximo mantenimiento', () => {
  assert.equal(calcularProximo(new Date(), 0), null)
  assert.equal(calcularProximo(new Date(), -3), null)
})

test('el próximo mantenimiento se calcula desde la fecha dada', () => {
  const base = new Date('2026-01-01T00:00:00Z')
  const prox = calcularProximo(base, 30)
  assert.ok(prox)
  assert.equal(prox.toISOString().slice(0, 10), '2026-01-31')
})

test('la urgencia distingue vencido, pronto, al día y sin programa', () => {
  const ahora = new Date('2026-06-15T12:00:00Z')
  assert.equal(urgenciaDe(null, ahora), 'SIN_PROGRAMA')
  assert.equal(urgenciaDe(new Date(ahora.getTime() - 1 * DIA), ahora), 'VENCIDO')
  assert.equal(urgenciaDe(new Date(ahora.getTime() + 3 * DIA), ahora), 'PRONTO')
  assert.equal(urgenciaDe(new Date(ahora.getTime() + 30 * DIA), ahora), 'AL_DIA')
})

test('el umbral de "pronto" son 7 días: al octavo ya está al día', () => {
  const ahora = new Date('2026-06-15T12:00:00Z')
  assert.equal(urgenciaDe(new Date(ahora.getTime() + 7 * DIA), ahora), 'PRONTO')
  assert.equal(urgenciaDe(new Date(ahora.getTime() + 8 * DIA), ahora), 'AL_DIA')
})

// ── Turnos ───────────────────────────────────────────────────────────────────

test('un turno cerrado cuenta de entrada a salida', () => {
  const entrada = new Date('2026-06-15T08:00:00Z')
  const salida = new Date('2026-06-15T16:30:00Z')
  assert.equal(horasDeTurno(entrada, salida, new Date()), 8.5)
})

test('un turno abierto cuenta hasta AHORA', () => {
  const entrada = new Date('2026-06-15T08:00:00Z')
  const ahora = new Date('2026-06-15T11:00:00Z')
  assert.equal(horasDeTurno(entrada, null, ahora), 3)
})

test('un turno con salida anterior a la entrada da cero, nunca negativo', () => {
  // Horas negativas restarían en el costo total y abaratarían el lavado por
  // arte de magia. Cero es la respuesta honesta a un dato imposible.
  const entrada = new Date('2026-06-15T16:00:00Z')
  const salida = new Date('2026-06-15T08:00:00Z')
  assert.equal(horasDeTurno(entrada, salida, new Date()), 0)
})

test('costo por vehículo es null sin vehículos, no infinito', () => {
  assert.equal(costoPorVehiculo(5000, 0), null)
  assert.equal(costoPorVehiculo(0, 0), null)
})

test('costo por vehículo redondea a dos decimales', () => {
  assert.equal(costoPorVehiculo(1000, 3), 333.33)
  assert.equal(costoPorVehiculo(4800, 40), 120)
})
