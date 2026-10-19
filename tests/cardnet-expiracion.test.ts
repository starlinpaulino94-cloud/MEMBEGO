import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { tarjetaCardnetVencida } from '../src/modules/pagos/cardnet-expiracion'

const ahora = new Date(2026, 9, 19, 12, 0, 0)

test('CardNET mantiene vigente la tarjeta hasta el último día del mes indicado', () => {
  assert.equal(tarjetaCardnetVencida(10, 2026, ahora), false)
})

test('CardNET considera vencido el mes anterior y cualquier año anterior', () => {
  assert.equal(tarjetaCardnetVencida(9, 2026, ahora), true)
  assert.equal(tarjetaCardnetVencida(12, 2025, ahora), true)
})

test('no infiere vencimiento cuando CardNET no devuelve una fecha completa válida', () => {
  assert.equal(tarjetaCardnetVencida(null, 2026, ahora), false)
  assert.equal(tarjetaCardnetVencida(13, 2026, ahora), false)
  assert.equal(tarjetaCardnetVencida(1, null, ahora), false)
})

test('el servidor verifica vencimiento antes de permitir predeterminar o cobrar una tarjeta guardada', () => {
  const source = readFileSync(join('src', 'modules', 'pagos', 'cardnetTokenGuardado.ts'), 'utf8')
  const selectDefault = source.indexOf('export async function establecerTarjetaPredeterminada')
  const renewal = source.indexOf('export async function renovarMembresiaPorTarjeta')
  assert.ok(selectDefault >= 0 && renewal > selectDefault)

  const defaultCardFlow = source.slice(selectDefault, renewal)
  const renewalFlow = source.slice(renewal)
  assert.match(defaultCardFlow, /tarjetaCardnetVencida\(tarjeta\.vencMes, tarjeta\.vencAnio\)/)
  assert.match(renewalFlow, /tarjetaCardnetVencida\(m\.tarjetaTokenizada\.vencMes, m\.tarjetaTokenizada\.vencAnio\)/)
  assert.ok(
    renewalFlow.indexOf('tarjetaCardnetVencida(') < renewalFlow.indexOf('cobrarConCredencialGuardada('),
    'una tarjeta vencida debe detener la renovación antes de contactar a CardNET'
  )
})
