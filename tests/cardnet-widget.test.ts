import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokenDe, refsGuardado, CLAVES_TOKEN } from '../src/lib/payments/cardnet-widget'

/**
 * Estas pruebas existen por un fallo real que costó días.
 *
 * El widget de CardNET entrega `{ TokenId: "OT_01_…" }` — así lo define el
 * manual §7.1 y así lo lee su propio ejemplo. Nuestra lista de nombres no
 * incluía `TokenId`, la extracción devolvía cadena vacía, y el cobro no se
 * intentaba nunca. No quedaba ni una fila en la base (el intento se registra
 * recién al ir a cobrar), y la pantalla decía «tarjeta declinada».
 *
 * La función vivía dentro del componente React, así que nunca tuvo pruebas.
 * Ahora es un módulo puro y esto lo fija.
 */

test('lee el TokenId del objeto Token del manual §7.1', () => {
  // Exactamente lo que entrega el widget, según el ejemplo oficial del §3.3.
  const payload = {
    TokenId: 'OT_01_kYv0qTHckRiZ4wjCz5NguZRuwFLSIrQc4jiYpVJ8SzQ_',
    Created: '2026-08-04T16:23:51.000',
    Type: 'OneTime',
    Brand: 'VISA',
    Last4: '1111',
    CardExpMonth: 12,
    CardExpYear: 29,
  }
  assert.equal(tokenDe(payload), 'OT_01_kYv0qTHckRiZ4wjCz5NguZRuwFLSIrQc4jiYpVJ8SzQ_')
})

test('TokenId va PRIMERO en la lista de nombres', () => {
  // El orden importa: es el nombre documentado. Si otro se le adelantara y
  // ambos vinieran en el payload, se cobraría con el equivocado.
  assert.equal(CLAVES_TOKEN[0], 'TokenId')
})

test('sigue leyendo las otras grafías conocidas', () => {
  // El token de un perfil guardado viene como `Token` (prefijo CT__).
  assert.equal(
    tokenDe({ Token: 'CT__ESaYPfpM3YF27RUCF_UOC9EHMDHCwxfBfllRSJv38SnV' }),
    'CT__ESaYPfpM3YF27RUCF_UOC9EHMDHCwxfBfllRSJv38SnV'
  )
  assert.equal(tokenDe({ TrxToken: 'OT_01_abcdefghijklmnop' }), 'OT_01_abcdefghijklmnop')
})

test('encuentra el token aunque venga envuelto o como JSON en texto', () => {
  assert.equal(tokenDe({ Response: { TokenId: 'OT_01_envuelto_1234567' } }), 'OT_01_envuelto_1234567')
  assert.equal(tokenDe({ detail: { data: { TokenId: 'OT_01_anidado_1234567' } } }), 'OT_01_anidado_1234567')
  assert.equal(tokenDe('{"TokenId":"OT_01_desde_texto_12345"}'), 'OT_01_desde_texto_12345')
  // Un string suelto en el primer nivel ES el token.
  assert.equal(tokenDe('OT_01_string_directo_123'), 'OT_01_string_directo_123')
})

test('no confunde un id corto con un token', () => {
  // `Token: 5` en una respuesta de otro tipo no debe intentar cobrar: mandar
  // eso a CardNET solo produce un rechazo que nadie sabe interpretar.
  assert.equal(tokenDe({ Token: '5' }), '')
  assert.equal(tokenDe({ TokenId: 'corto' }), '')
  assert.equal(tokenDe({}), '')
  assert.equal(tokenDe(null), '')
  assert.equal(tokenDe(undefined), '')
  assert.equal(tokenDe({ otraCosa: 'OT_01_no_es_un_campo_de_token' }), '')
})

test('las referencias para renovar salen del objeto Token, sin datos de tarjeta', () => {
  const refs = refsGuardado({
    TokenId: 'CT__perfil_guardado_1234567',
    Brand: 'MASTERCARD',
    Last4: '4444',
    CardExpMonth: 9,
    CardExpYear: 30,
    CustomerId: 112027,
    PaymentProfileId: 5552,
  })
  assert.equal(refs.token, 'CT__perfil_guardado_1234567')
  assert.equal(refs.marca, 'MASTERCARD')
  assert.equal(refs.ultimos4, '4444')
  assert.equal(refs.customerId, '112027')
  assert.equal(refs.paymentProfileId, '5552')

  // Lo que NUNCA debe salir de aquí, ni aunque el payload lo trajera.
  const conTarjeta = refsGuardado({
    TokenId: 'CT__x_1234567890',
    CardNumber: '4111111111111111',
    CVV: '123',
  })
  const texto = JSON.stringify(conTarjeta)
  assert.doesNotMatch(texto, /4111111111111111/)
  assert.doesNotMatch(texto, /"123"/)
})

test('un payload vacío no inventa referencias', () => {
  const refs = refsGuardado(null)
  assert.equal(refs.token, null)
  assert.equal(refs.customerId, null)
  assert.equal(refs.paymentProfileId, null)
})

test('el nombre del comercio no puede romper la URL de la ventana de captura', async () => {
  // El widget arrastra los valores de SetProperties a la URL de la ventana
  // (`Capture/?key=…&name=…`) SIN escaparlos. «CARTOWN Wash & Detailing» parte
  // la consulta en ese `&`, CardNET recibe una URL rota y responde 500 — que
  // en pantalla se lee como INTERNAL_SERVER_ERROR, sin ninguna pista de que la
  // culpa es un carácter del nombre. Pasó de verdad.
  const { textoSeguroWidget } = await import('../src/lib/payments/cardnet-widget')
  assert.equal(textoSeguroWidget('CARTOWN Wash & Detailing'), 'CARTOWN Wash Detailing')
  for (const malo of ['a&b', 'a?b', 'a#b', 'a=b', 'a+b', 'a%b']) {
    assert.doesNotMatch(textoSeguroWidget(malo), /[&?#=+%]/, malo)
  }
  // Los acentos se conservan: son legítimos y no rompen nada.
  assert.equal(textoSeguroWidget('Membresía Cartown'), 'Membresía Cartown')
  // Vacío o solo símbolos cae a la reserva, nunca a cadena vacía.
  assert.equal(textoSeguroWidget('', 'Pago seguro'), 'Pago seguro')
  assert.equal(textoSeguroWidget('&&&', 'Pago seguro'), 'Pago seguro')
  // Un texto larguísimo tampoco debe tumbar la petición.
  assert.ok(textoSeguroWidget('x'.repeat(500)).length <= 60)
})

test('un logo con parámetros en la URL se omite antes que romper el pago', async () => {
  const { imagenSeguraWidget } = await import('../src/lib/payments/cardnet-widget')
  assert.equal(imagenSeguraWidget('https://cdn.x.com/logo.png'), 'https://cdn.x.com/logo.png')
  // Perder el logo es mejor que perder el cobro.
  assert.equal(imagenSeguraWidget('https://cdn.x.com/l.png?w=200&h=200'), null)
  assert.equal(imagenSeguraWidget('http://inseguro.com/l.png'), null, 'solo https')
  assert.equal(imagenSeguraWidget(null), null)
})
