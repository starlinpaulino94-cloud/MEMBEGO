import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DIAS_SILENCIO, desdeHace, estaEnSilencio } from '../src/modules/empresas/silencio'

const AHORA = new Date('2026-08-12T12:00:00Z')
const haceDias = (d: number) => new Date(AHORA.getTime() - d * 86_400_000)

test('una empresa activa sin actividad reciente está en silencio', () => {
  assert.equal(
    estaEnSilencio({ isActive: true, ultimaActividad: haceDias(DIAS_SILENCIO + 1) }, AHORA),
    true
  )
  assert.equal(
    estaEnSilencio({ isActive: true, ultimaActividad: haceDias(DIAS_SILENCIO - 1) }, AHORA),
    false
  )
})

/**
 * UNA EMPRESA DADA DE BAJA NO ESTÁ EN SILENCIO, ESTÁ CERRADA.
 *
 * Sin esta distinción el aviso contaría para siempre a todas las que se dieron
 * de baja: un número que nunca baja deja de mirarse, y entonces tampoco se ven
 * las que sí necesitaban una llamada.
 */
test('una empresa suspendida nunca cuenta como en silencio', () => {
  assert.equal(estaEnSilencio({ isActive: false, ultimaActividad: null }, AHORA), false)
  assert.equal(estaEnSilencio({ isActive: false, ultimaActividad: haceDias(400) }, AHORA), false)
})

test('activa y sin ninguna actividad: en silencio', () => {
  assert.equal(estaEnSilencio({ isActive: true, ultimaActividad: null }, AHORA), true)
})

test('desdeHace: minutos, horas, días y meses', () => {
  assert.equal(desdeHace(null), 'sin actividad')
  assert.equal(desdeHace(5 * 60_000), 'hace un momento')
  assert.equal(desdeHace(3 * 3_600_000), 'hace 3 h')
  assert.equal(desdeHace(1 * 86_400_000), 'hace 1 día')
  assert.equal(desdeHace(23 * 86_400_000), 'hace 23 días')
  assert.equal(desdeHace(90 * 86_400_000), 'hace 3 meses')
})
