import { test } from 'node:test'
import assert from 'node:assert/strict'
import { finDeVentanaCampana } from '../src/modules/engagement/ventana-campana'

const base = {
  fechaInicio: new Date('2026-10-09T00:00:00.000Z'),
  fechaFin: new Date('2026-10-10T00:00:00.000Z'),
  horaInicioMin: null,
  horaFinMin: null,
  diasSemana: [],
}

test('la ventana general respeta fechas y fin inclusivo', () => {
  assert.equal(finDeVentanaCampana(base, new Date('2026-10-08T23:59:59.999Z')), null)
  assert.equal(finDeVentanaCampana(base, new Date('2026-10-09T14:00:00.000Z'))?.toISOString(), base.fechaFin.toISOString())
  assert.equal(finDeVentanaCampana(base, new Date('2026-10-10T00:00:00.001Z')), null)
})

test('la ventana diaria usa la hora y el día de República Dominicana', () => {
  const happyHour = { ...base, horaInicioMin: 600, horaFinMin: 660, diasSemana: [5] }
  assert.equal(finDeVentanaCampana(happyHour, new Date('2026-10-09T13:59:00.000Z')), null)
  assert.equal(finDeVentanaCampana(happyHour, new Date('2026-10-09T14:00:00.000Z'))?.toISOString(), '2026-10-09T15:00:00.000Z')
  assert.equal(finDeVentanaCampana(happyHour, new Date('2026-10-09T15:00:00.000Z')), null)
  assert.equal(finDeVentanaCampana({ ...happyHour, diasSemana: [4] }, new Date('2026-10-09T14:00:00.000Z')), null)
})
