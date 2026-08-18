import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluarCheckin,
  diasDeDiferencia,
  pasajerosQueEmbarcan,
  resumenManifiesto,
  codigoDeCheckin,
  tokenDesdeCodigo,
} from '../src/modules/excursiones/checkin/nucleo'

/**
 * Excursiones · Fase 11 — el check-in se decide en el muelle, con el bus
 * esperando. Estas pruebas fijan qué se rechaza, qué se avisa y qué se deja
 * pasar.
 */

// 17 de agosto de 2026, 8 de la mañana en RD.
const AHORA = new Date('2026-08-17T12:00:00.000Z')
const hoy = new Date('2026-08-17T16:00:00.000Z')

const reserva = (p: Partial<Parameters<typeof evaluarCheckin>[0]> = {}) => ({
  estado: 'PAGADA',
  fecha: hoy,
  checkinAt: null,
  totalPasajeros: 3,
  ...p,
})

test('una reserva cancelada no embarca, y punto', () => {
  const r = evaluarCheckin(reserva({ estado: 'CANCELADA' }), AHORA)
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /cancelada/i)
})

test('una reserva sin pasajeros tampoco', () => {
  assert.equal(evaluarCheckin(reserva({ totalPasajeros: 0 }), AHORA).ok, false)
})

test('el día de la excursión embarca sin avisos', () => {
  const r = evaluarCheckin(reserva(), AHORA)
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.aviso, null)
    assert.equal(r.yaEstaba, false)
  }
})

test('la víspera y el día siguiente entran en la ventana', () => {
  const vispera = evaluarCheckin(reserva({ fecha: new Date('2026-08-18T16:00:00.000Z') }), AHORA)
  const siguiente = evaluarCheckin(reserva({ fecha: new Date('2026-08-16T16:00:00.000Z') }), AHORA)
  assert.equal(vispera.ok, true)
  assert.equal(siguiente.ok, true)
  if (vispera.ok) assert.equal(vispera.aviso, null)
  if (siguiente.ok) assert.equal(siguiente.aviso, null)
})

test('fuera de la ventana avisa pero NO bloquea: decide el operador', () => {
  const lejos = evaluarCheckin(reserva({ fecha: new Date('2026-08-25T16:00:00.000Z') }), AHORA)
  assert.equal(lejos.ok, true)
  if (lejos.ok) assert.match(lejos.aviso ?? '', /dentro de 8 días/)

  const vieja = evaluarCheckin(reserva({ fecha: new Date('2026-08-01T16:00:00.000Z') }), AHORA)
  assert.equal(vieja.ok, true)
  if (vieja.ok) assert.match(vieja.aviso ?? '', /hace 16 días/)
})

test('escanear dos veces no es un error: avisa que ya estaba embarcada', () => {
  const r = evaluarCheckin(reserva({ checkinAt: new Date('2026-08-17T13:00:00.000Z') }), AHORA)
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.yaEstaba, true)
})

test('la diferencia de días se cuenta en día local, no en horas', () => {
  // Excursión del 17 a las 9 de la noche en RD (= 18 en UTC): sigue siendo hoy.
  assert.equal(diasDeDiferencia(new Date('2026-08-18T01:00:00.000Z'), AHORA), 0)
})

test('no se puede subir a más gente de la que la reserva tiene', () => {
  assert.equal(pasajerosQueEmbarcan('5', 3), 3)
  assert.equal(pasajerosQueEmbarcan('2', 3), 2)
  assert.equal(pasajerosQueEmbarcan('-1', 3), 0)
  assert.equal(pasajerosQueEmbarcan('todos', 3), 3) // dato roto → el total
})

test('el manifiesto suma reservas, embarques y personas', () => {
  const r = resumenManifiesto([
    { totalPasajeros: 3, presentes: 3, checkinAt: AHORA },
    { totalPasajeros: 4, presentes: 3, checkinAt: AHORA },
    { totalPasajeros: 2, presentes: 0, checkinAt: null },
  ])
  assert.deepEqual(r, { reservas: 3, embarcadas: 2, pasajeros: 9, presentes: 6 })
})

test('el código dice qué es, y el lector físico puede ensuciarlo', () => {
  const codigo = codigoDeCheckin('abc123XYZ_-9')
  assert.equal(codigo, 'EXC:abc123XYZ_-9')
  assert.equal(tokenDesdeCodigo(codigo), 'abc123XYZ_-9')
  assert.equal(tokenDesdeCodigo('  EXC:abc123XYZ_-9\n'), 'abc123XYZ_-9')
  assert.equal(tokenDesdeCodigo('abc123XYZ_-9'), 'abc123XYZ_-9') // sin prefijo también
  assert.equal(tokenDesdeCodigo(''), null)
  assert.equal(tokenDesdeCodigo('EXC:corto'), null) // demasiado corto para ser un token
  assert.equal(tokenDesdeCodigo('EXC:tiene espacios y símbolos!'), null)
})
