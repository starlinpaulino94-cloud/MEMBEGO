import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validarExcursion,
  validarVariante,
  validarHorario,
  normalizarDias,
  precio,
  slugExcursion,
} from '../src/modules/excursiones/catalogo/nucleo'

/**
 * Excursiones · Fase 2 — el catálogo valida en el servidor todo lo que llega
 * del navegador. Estas pruebas fijan la frontera.
 */

test('una excursión válida sale normalizada', () => {
  const r = validarExcursion({
    nombre: '  Isla Saona  ',
    descripcion: 'Un día en la isla.',
    moneda: 'usd',
    duracionMin: '480',
    capacidad: '40',
    horaSalida: '08:30',
    horaRegreso: '17:00',
  })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.datos.nombre, 'Isla Saona')
    assert.equal(r.datos.moneda, 'USD')
    assert.equal(r.datos.duracionMin, 480)
    assert.equal(r.datos.horaSalida, '08:30')
  }
})

test('la basura no pasa: nombre corto, moneda inventada, horas y números inválidos', () => {
  assert.equal(validarExcursion({ nombre: 'ab' }).ok, false)
  const r = validarExcursion({
    nombre: 'Buggy Macao',
    moneda: 'BTC',
    duracionMin: '-5',
    capacidad: 'muchos',
    horaSalida: '25:99',
  })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.datos.moneda, 'DOP') // desconocida cae al defecto, no revienta
    assert.equal(r.datos.duracionMin, null)
    assert.equal(r.datos.capacidad, null)
    assert.equal(r.datos.horaSalida, null)
  }
  const imp = validarExcursion({ nombre: 'Buggy Macao', impuestoPct: '180' })
  assert.equal(imp.ok, false) // un impuesto de 180% es un error, no un dato
})

test('la variante exige precio de adulto mayor que cero y procesa tarifas de turistas y residentes', () => {
  assert.equal(validarVariante({ nombre: 'VIP', precioAdulto: '0' }).ok, false)
  assert.equal(validarVariante({ nombre: '', precioAdulto: '50' }).ok, false)
  const r = validarVariante({
    nombre: 'Doble',
    precioAdulto: '120.505',
    precioNino: '60',
    precioResidente: '80.00',
    precioNinoResidente: '40.00',
    capacidad: '2',
  })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.datos.precioAdulto, 120.51) // redondeo a 2 decimales, servidor
    assert.equal(r.datos.precioNino, 60)
    assert.equal(r.datos.precioResidente, 80)
    assert.equal(r.datos.precioNinoResidente, 40)
    assert.equal(r.datos.capacidad, 2)
  }
})

test('el horario exige al menos un día y hora válida; los días salen limpios', () => {
  assert.equal(validarHorario({ horaSalida: '09:00' }, []).ok, false)
  assert.equal(validarHorario({ horaSalida: '9am' }, ['1']).ok, false)
  assert.deepEqual(normalizarDias(['7', '1', '1', '9', 'x', '3']), [1, 3, 7])
  const r = validarHorario({ horaSalida: '09:00', cupo: '30' }, ['6', '7'])
  assert.equal(r.ok, true)
  if (r.ok) assert.deepEqual(r.datos, { diasSemana: [6, 7], horaSalida: '09:00', cupo: 30 })
})

test('precio() tolera vacíos y rechaza negativos y desbordes', () => {
  assert.equal(precio(''), null)
  assert.equal(precio('-1'), null)
  assert.equal(precio('99999999'), null)
  assert.equal(precio('80'), 80)
})

test('el slug sale del nombre pero sin acentos ni sorpresas', () => {
  assert.equal(slugExcursion('Isla Saona — Día Completo'), 'isla-saona-dia-completo')
  assert.equal(slugExcursion('¡¡¡'), 'excursion')
})

test('validarExcursion maneja PASE_DIA correctamente sin exigir horas fijas', () => {
  const r = validarExcursion({
    nombre: 'Day Pass Resort & Playa',
    tipoItem: 'PASE_DIA',
    descripcion: 'Pase de día con acceso a piscinas y playa.',
    capacidad: '100',
  })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.datos.nombre, 'Day Pass Resort & Playa')
    assert.equal(r.datos.tipoItem, 'PASE_DIA')
    assert.equal(r.datos.capacidad, 100)
    assert.equal(r.datos.horaSalida, null)
    assert.equal(r.datos.horaRegreso, null)
    assert.equal(r.datos.duracionMin, null)
  }
})
