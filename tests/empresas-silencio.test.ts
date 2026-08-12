import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DIAS_SILENCIO, estaEnSilencio } from '../src/modules/empresas/silencio'

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
