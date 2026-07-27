/**
 * App Car Wash · Fase 2 — pruebas de la ARITMÉTICA DE COMISIONES y de la
 * normalización de placas. Ejecutar: npm test
 *
 * POR QUÉ ESTAS DOS COSAS Y NO OTRAS:
 *
 *  · `calcularComision` produce el número que termina en el sobre de pago de
 *    una persona. Un error de redondeo o una regla mal aplicada no se ve en un
 *    log: se discute con quien lavó el carro.
 *
 *  · `normalizarPlaca` decide si un vehículo se cobra en caja o se carga a la
 *    flota. Si la normalización de guardar y la de buscar no coinciden, el
 *    camión de la flota se cobra al chofer — o peor, nadie lo cobra.
 *
 * Las dos son puras: se prueban sin base de datos, que es exactamente lo que
 * uno quiere de la lógica que mueve dinero.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  calcularComision,
  COMISION_ESTADOS,
  COMISION_ESTADO_LABELS,
  type LineaComisionable,
} from '../src/modules/carwash/comisiones'
import { normalizarPlaca, CARGO_ESTADOS, CARGO_ESTADO_LABELS } from '../src/modules/carwash/cuentas'
import {
  INCIDENCIA_TIPOS,
  INCIDENCIA_TIPO_LABELS,
  INCIDENCIA_ESTADOS,
  INCIDENCIA_ESTADO_LABELS,
  GRAVEDADES,
  GRAVEDAD_LABELS,
} from '../src/modules/carwash/incidencias'

function linea(p: Partial<LineaComisionable> = {}): LineaComisionable {
  return {
    nombre: 'Lavado',
    precio: 500,
    cantidad: 1,
    comisionPorcentaje: null,
    comisionMonto: null,
    ...p,
  }
}

// ── Catálogos: nada sin etiqueta ─────────────────────────────────────────────

test('todo estado de comisión tiene etiqueta legible', () => {
  for (const e of COMISION_ESTADOS) {
    assert.ok(COMISION_ESTADO_LABELS[e], `falta COMISION_ESTADO_LABELS[${e}]`)
  }
})

test('todo estado de cargo tiene etiqueta legible', () => {
  for (const e of CARGO_ESTADOS) {
    assert.ok(CARGO_ESTADO_LABELS[e], `falta CARGO_ESTADO_LABELS[${e}]`)
  }
})

test('todo tipo, estado y gravedad de incidencia tiene etiqueta legible', () => {
  for (const t of INCIDENCIA_TIPOS) assert.ok(INCIDENCIA_TIPO_LABELS[t], `falta tipo ${t}`)
  for (const e of INCIDENCIA_ESTADOS) assert.ok(INCIDENCIA_ESTADO_LABELS[e], `falta estado ${e}`)
  for (const g of GRAVEDADES) assert.ok(GRAVEDAD_LABELS[g], `falta gravedad ${g}`)
})

// ── Comisión: el caso base ───────────────────────────────────────────────────

test('sin tarifa configurada, la comisión es cero', () => {
  const r = calcularComision([linea(), linea({ nombre: 'Cera', precio: 300 })])
  assert.equal(r.monto, 0)
  // La base SÍ se acumula: sirve para explicar por qué el pago es cero.
  assert.equal(r.base, 800)
  assert.match(r.detalle, /Sin servicios con comisión/)
})

test('sin líneas, todo es cero y no revienta', () => {
  const r = calcularComision([])
  assert.equal(r.base, 0)
  assert.equal(r.monto, 0)
})

// ── Porcentaje ───────────────────────────────────────────────────────────────

test('el porcentaje se aplica sobre el precio cobrado', () => {
  const r = calcularComision([linea({ precio: 500, comisionPorcentaje: 10 })])
  assert.equal(r.base, 500)
  assert.equal(r.monto, 50)
})

test('el porcentaje toma en cuenta la cantidad', () => {
  const r = calcularComision([linea({ precio: 500, cantidad: 3, comisionPorcentaje: 10 })])
  assert.equal(r.base, 1500)
  assert.equal(r.monto, 150)
})

// ── Monto fijo ───────────────────────────────────────────────────────────────

test('el monto fijo se paga por unidad, no por línea', () => {
  const r = calcularComision([linea({ precio: 500, cantidad: 4, comisionMonto: 25 })])
  assert.equal(r.monto, 100)
})

test('el porcentaje MANDA sobre el monto fijo en la misma línea', () => {
  // Regla explícita: si están los dos, gana el porcentaje. Tener ambos activos
  // sería ambiguo, y la ambigüedad en nómina se paga cara.
  const r = calcularComision([linea({ precio: 1000, comisionPorcentaje: 10, comisionMonto: 999 })])
  assert.equal(r.monto, 100)
})

test('un porcentaje en cero no paga (no es "sin configurar", es cero)', () => {
  const r = calcularComision([linea({ precio: 1000, comisionPorcentaje: 0, comisionMonto: 50 })])
  // Con porcentaje 0 se cae al monto fijo: 0 no puede significar "cobra el 0%"
  // y a la vez bloquear el monto, porque entonces poner 0 sería una trampa.
  assert.equal(r.monto, 50)
})

// ── Mezcla y redondeo ────────────────────────────────────────────────────────

test('mezcla porcentaje, monto fijo y líneas sin comisión', () => {
  const r = calcularComision([
    linea({ nombre: 'Lavado full', precio: 800, comisionPorcentaje: 10 }), // 80
    linea({ nombre: 'Cera', precio: 400, comisionMonto: 50 }), // 50
    linea({ nombre: 'Aromatizante', precio: 100 }), // 0
  ])
  assert.equal(r.base, 1300)
  assert.equal(r.monto, 130)
  assert.match(r.detalle, /Lavado full/)
  assert.match(r.detalle, /Cera/)
  // Lo que no paga no ensucia el desglose.
  assert.doesNotMatch(r.detalle, /Aromatizante/)
})

test('redondea a dos decimales, sin arrastrar centavos fantasma', () => {
  // 333.33 × 7% = 23.3331 → 23.33
  const r = calcularComision([linea({ precio: 333.33, comisionPorcentaje: 7 })])
  assert.equal(r.monto, 23.33)
})

test('cada línea se redondea antes de sumar (así se paga, así se explica)', () => {
  // Dos líneas de 23.3331 → 23.33 + 23.33 = 46.66, no 46.67.
  // Importa que el total coincida con la suma del desglose que se le enseña al
  // lavador: si no, el papel y la pantalla dicen cosas distintas.
  const r = calcularComision([
    linea({ precio: 333.33, comisionPorcentaje: 7 }),
    linea({ nombre: 'Otro', precio: 333.33, comisionPorcentaje: 7 }),
  ])
  assert.equal(r.monto, 46.66)
})

test('un precio en cero no genera comisión aunque tenga tarifa', () => {
  const r = calcularComision([linea({ precio: 0, comisionPorcentaje: 20 })])
  assert.equal(r.monto, 0)
})

// ── Placas ───────────────────────────────────────────────────────────────────

test('la placa se normaliza a mayúsculas sin espacios ni guiones', () => {
  assert.equal(normalizarPlaca('a123456'), 'A123456')
  assert.equal(normalizarPlaca(' A-123 456 '), 'A123456')
  assert.equal(normalizarPlaca('A 1 2 3 4 5 6'), 'A123456')
})

test('formas distintas de escribir la MISMA placa colapsan al mismo valor', () => {
  // Este es el invariante que decide si el camión de la flota se cobra en caja
  // por error: guardar y buscar tienen que caer en la misma cadena.
  const formas = ['A123456', 'a123456', 'A-123456', ' a 123 456 ', 'A--123456']
  const normalizadas = new Set(formas.map(normalizarPlaca))
  assert.equal(normalizadas.size, 1, `no colapsan: ${[...normalizadas].join(', ')}`)
})

test('placas distintas siguen siendo distintas', () => {
  assert.notEqual(normalizarPlaca('A123456'), normalizarPlaca('A123457'))
})
