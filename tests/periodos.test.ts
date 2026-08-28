import test from 'node:test'
import assert from 'node:assert/strict'
import { periodEnd } from '../src/lib/periodos'

test('un plan mensual vence el mismo día del mes siguiente al final del día local', () => {
  const fin = periodEnd(new Date('2026-07-30T14:00:00.000Z'), 30)

  assert.equal(fin.toISOString(), '2026-08-31T03:59:59.999Z')
  assert.equal(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Santo_Domingo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).format(fin),
    '08/30/2026, 23:59:59'
  )
})

test('si el día no existe en el mes destino, vence el último día posible', () => {
  const fin = periodEnd(new Date('2026-01-31T15:00:00.000Z'), 30)

  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Santo_Domingo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(fin).map((p) => [p.type, p.value])
  )
  assert.deepEqual(
    { year: partes.year, month: partes.month, day: partes.day },
    { year: '2026', month: '02', day: '28' }
  )
})

test('una vigencia no mensual conserva el cálculo por días y cierra al final del día', () => {
  const fin = periodEnd(new Date('2026-07-30T14:00:00.000Z'), 7)

  assert.equal(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Santo_Domingo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).format(fin),
    '08/06/2026, 23:59:59'
  )
})
