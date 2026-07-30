import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  urlsTokens,
  montoEnteroMenor,
  interpretarCompraToken,
  sinSensibles,
} from '../src/lib/payments/cardnet-tokens-core'

/**
 * Pruebas de la tokenización HOSPEDADA. Fijan lo verificable sin llamar a
 * CardNET: las URLs por ambiente, el monto en centavos ENTERO que espera el
 * Purchase, la interpretación conservadora del "aprobado", y —clave— que un
 * token nunca queda en claro en un log.
 */

test('urlsTokens usa los hosts de GTP/Seglan por ambiente', () => {
  const qa = urlsTokens('pruebas')
  assert.equal(qa.api, 'https://tr-tsp-test.gtp-seglan.com/tr-tsp-mw-cardnet/v1/api')
  assert.equal(qa.capture, 'https://tr-tsp-test.gtp-seglan.com/tr-tsp-mw-cardnet/v1/Capture/')
  assert.equal(qa.script, 'https://tr-tsp-test.gtp-seglan.com/tr-tsp-mw-cardnet/v1/Scripts/PWCheckout.js')

  const prod = urlsTokens('produccion')
  assert.equal(prod.api, 'https://tr-tsp.gtp-seglan.com/tr-tsp-mw-cardnet/v1/api')
  assert.ok(prod.script.startsWith('https://tr-tsp.gtp-seglan.com/'))
})

test('montoEnteroMenor da centavos como entero (10000 = RD$100)', () => {
  assert.equal(montoEnteroMenor(100), 10000)
  assert.equal(montoEnteroMenor(1600), 160000)
  // Sin errores de coma flotante.
  assert.equal(montoEnteroMenor(19.99), 1999)
  assert.equal(montoEnteroMenor(0.1), 10)
})

test('interpretarCompraToken aprueba con Approved=true', () => {
  const r = interpretarCompraToken({ Approved: true, AuthorizationCode: 'A1B2C3' })
  assert.equal(r.aprobada, true)
  assert.equal(r.autorizacion, 'A1B2C3')
})

test('interpretarCompraToken aprueba con ResponseCode 00', () => {
  const r = interpretarCompraToken({ ResponseCode: '00', RRN: '123456' })
  assert.equal(r.aprobada, true)
})

test('interpretarCompraToken NO aprueba ante respuesta ambigua o vacía', () => {
  assert.equal(interpretarCompraToken({}).aprobada, false)
  assert.equal(interpretarCompraToken({ ResponseCode: '05' }).aprobada, false)
  assert.equal(interpretarCompraToken(null).aprobada, false)
  // Da un mensaje para el cliente, no técnico.
  assert.ok((interpretarCompraToken({ ResponseCode: '51' }).motivo ?? '').length > 0)
})

test('sinSensibles enmascara tokens y datos de tarjeta', () => {
  const limpio = sinSensibles({
    TrxToken: 'CT__ESaYPfpM3YF27RUCF_UOC9EHMDHCwxfBfllRSJv38SnV',
    Amount: 10000,
    anidado: { CardNumber: '4111111111111111', ok: 'visible' },
  })
  assert.ok(!String(limpio.TrxToken).includes('ESaY'))
  assert.equal(limpio.Amount, 10000)
  const anidado = limpio.anidado as Record<string, unknown>
  assert.ok(!String(anidado.CardNumber).includes('4111'))
  assert.equal(anidado.ok, 'visible')
})
