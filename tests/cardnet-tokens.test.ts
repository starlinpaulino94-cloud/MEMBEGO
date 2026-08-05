import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  urlsTokens,
  montoEnteroMenor,
  interpretarCompraToken,
  desenvolverRespuesta,
  sinSensibles,
  extraerPerfiles as extraerPerfilesSync,
} from '../src/lib/payments/cardnet-tokens-core'

/**
 * Pruebas de la tokenización HOSPEDADA. Fijan lo verificable sin llamar a
 * CardNET: las URLs por ambiente, el monto en centavos ENTERO que espera el
 * Purchase, la interpretación conservadora del "aprobado", y —clave— que un
 * token nunca queda en claro en un log.
 */

test('urlsTokens usa los hosts del MANUAL §11, no un middleware ajeno', () => {
  // Manual técnico v1.7 §11. El §3.1 prohíbe además cargar la librería desde
  // un host de terceros: si el SDK y la ventana de captura quedan en dominios
  // distintos, el token no puede volver del iframe y el cobro nunca ocurre.
  const qa = urlsTokens('pruebas')
  assert.equal(qa.api, 'https://lab.cardnet.com.do/servicios/tokens/v1/api')
  assert.equal(qa.capture, 'https://lab.cardnet.com.do/servicios/tokens/v1/Capture/')
  assert.equal(qa.script, 'https://lab.cardnet.com.do/servicios/tokens/v1/Scripts/PWCheckout.js')

  const prod = urlsTokens('produccion')
  assert.equal(prod.api, 'https://servicios.cardnet.com.do/servicios/tokens/v1/api')
  assert.equal(prod.script, 'https://servicios.cardnet.com.do/servicios/tokens/v1/Scripts/PWCheckout.js')

  for (const u of [qa.api, qa.capture, qa.script, prod.api, prod.capture, prod.script]) {
    assert.ok(u.includes('cardnet.com.do'), `${u} debe servirse desde CardNET`)
    assert.ok(!u.includes('gtp-seglan'), `${u} no puede venir de un tercero`)
  }
})

test('el script SIEMPRE sale del mismo origen que la ventana de captura', async () => {
  // Es LA invariante de esta integración. CardNET devuelve el CaptureURL en la
  // respuesta y varía según el host consultado (lab / labservicios); derivar
  // el script de él impide que se desalineen.
  const { scriptDesdeCaptura } = await import('../src/lib/payments/cardnet-tokens-core')
  assert.equal(
    scriptDesdeCaptura('https://labservicios.cardnet.com.do/servicios/tokens/v1/Capture'),
    'https://labservicios.cardnet.com.do/servicios/tokens/v1/Scripts/PWCheckout.js'
  )
  // Con barra final (la forma que arma nuestro código) da lo mismo.
  assert.equal(
    scriptDesdeCaptura('https://lab.cardnet.com.do/servicios/tokens/v1/Capture/'),
    'https://lab.cardnet.com.do/servicios/tokens/v1/Scripts/PWCheckout.js'
  )
  const origen = (u: string) => new URL(u).origin
  for (const cap of [
    'https://lab.cardnet.com.do/servicios/tokens/v1/Capture/',
    'https://labservicios.cardnet.com.do/servicios/tokens/v1/Capture',
    'https://servicios.cardnet.com.do/servicios/tokens/v1/Capture/',
  ]) {
    assert.equal(origen(scriptDesdeCaptura(cap)), origen(cap))
  }
})

test('el monto sigue la tabla de codificación del manual §10.4', () => {
  // «parte entera más 2 decimales sin signos de puntuación entre ambos».
  // Los cuatro casos son los del propio manual.
  assert.equal(montoEnteroMenor(100), 10000)
  assert.equal(montoEnteroMenor(1237.52), 123752)
  assert.equal(montoEnteroMenor(3200.5), 320050)
  assert.equal(montoEnteroMenor(0.01), 1)
  // Y sin arrastrar errores de coma flotante.
  assert.equal(montoEnteroMenor(19.99), 1999)
  assert.equal(montoEnteroMenor(1600), 160000)
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

test('desenvolverRespuesta saca los datos de { Response, Errors } (forma real del QA)', () => {
  // Forma observada en vivo contra el ambiente de prueba.
  const { datos, errores } = desenvolverRespuesta({
    Response: {
      CustomerId: 111924,
      CaptureURL: 'https://labservicios.cardnet.com.do/servicios/tokens/v1/Capture',
      UniqueID: 'UI_xxx',
    },
    Errors: [{ ErrorCode: 'CS005', Message: 'Email ya registrado' }],
  })
  assert.equal(datos.CustomerId, 111924)
  assert.equal(datos.UniqueID, 'UI_xxx')
  assert.equal(errores.length, 1)
  assert.equal(errores[0].codigo, 'CS005')
})

test('interpretarCompraToken con errores del proveedor NUNCA aprueba', () => {
  const r = interpretarCompraToken({
    Response: { Approved: true, AuthorizationCode: 'A1' },
    Errors: [{ ErrorCode: 'TK004', Message: 'Sesión inválida' }],
  })
  assert.equal(r.aprobada, false)
  assert.equal(r.motivo, 'Sesión inválida')
})

test('interpretarCompraToken aprueba una respuesta envuelta y limpia', () => {
  const r = interpretarCompraToken({
    Response: { Transaction: { AuthorizationCode: '00551Z', ResponseCode: '00' } },
    Errors: [],
  })
  assert.equal(r.aprobada, true)
  assert.equal(r.autorizacion, '00551Z')
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

test('extraerPerfiles saca token y referencias de PaymentProfiles (camino confirmado por CardNET)', async () => {
  const { extraerPerfiles } = await import('../src/lib/payments/cardnet-tokens-core')
  const perfiles = extraerPerfiles({
    Response: {
      CustomerId: 111924,
      Email: 'cliente@x.com',
      PaymentProfiles: [
        {
          PaymentProfileId: 5551,
          Token: 'CT__viejoToken_aaaaaaaaaaaaaaaa',
          Brand: 'VISA',
          CardNumber: '411111******1111',
        },
        {
          PaymentProfileId: 5552,
          Token: 'CT__nuevoToken_bbbbbbbbbbbbbbbb',
          Brand: 'MASTERCARD',
          LastFour: '4444',
        },
      ],
    },
    Errors: [],
  })
  assert.equal(perfiles.length, 2)
  assert.equal(perfiles[0].paymentProfileId, '5551')
  assert.equal(perfiles[0].ultimos4, '1111') // sacado del número enmascarado
  const ultimo = perfiles[perfiles.length - 1]
  assert.equal(ultimo.token, 'CT__nuevoToken_bbbbbbbbbbbbbbbb')
  assert.equal(ultimo.marca, 'MASTERCARD')
  assert.equal(ultimo.ultimos4, '4444')
})

test('extraerPerfiles con respuesta sin perfiles o malformada devuelve []', async () => {
  const { extraerPerfiles } = await import('../src/lib/payments/cardnet-tokens-core')
  assert.deepEqual(extraerPerfiles({ Response: { CustomerId: 1 } }), [])
  assert.deepEqual(extraerPerfiles({}), [])
  assert.deepEqual(extraerPerfiles({ Response: { PaymentProfiles: 'no-array' } }), [])
})

test('la IP del antifraude no se manda si no es una IP', async () => {
  // `getClientIdentifier` devuelve la cadena 'unknown' cuando falta la
  // cabecera. Mandar eso como CustomerIP puede hacer que CardNET rechace por
  // validación, y ese rechazo se le muestra al cliente como "tarjeta
  // declinada" — un fallo carísimo de diagnosticar.
  const { esIpValida } = await import('../src/lib/payments/cardnet-tokens-core')
  assert.equal(esIpValida('190.80.12.4'), true)
  assert.equal(esIpValida('2800:bf0:8000::1'), true)
  assert.equal(esIpValida('unknown'), false)
  assert.equal(esIpValida(''), false)
  assert.equal(esIpValida('   '), false)
  assert.equal(esIpValida('999.1.1.1'), false, 'octeto fuera de rango')
  assert.equal(esIpValida('no-soy-una-ip'), false)
})

test('el estado final de la transacción manda sobre cualquier otro indicio', async () => {
  // Manual §10.6: 1 Approved · 2 Pending · 3 Preauthorized · 4 Rejected.
  // Pending y Preauthorized NO son cobros — el dinero todavía no está. Si se
  // tomaran por aprobados se entregaría la membresía sin haber cobrado, y eso
  // solo se descubre cuadrando la caja a fin de mes.
  const aprobada = interpretarCompraToken({
    Response: { Transaction: { TransactionStatusId: 1, AuthorizationCode: '00551Z', ResponseCode: '00' } },
    Errors: [],
  })
  assert.equal(aprobada.aprobada, true)

  for (const [estado, etiqueta] of [
    [2, 'Pending'],
    [3, 'Preauthorized'],
    [4, 'Rejected'],
  ] as const) {
    const r = interpretarCompraToken({
      // Con código '00' y autorización presentes: sin mirar el estado, esto
      // se habría aprobado.
      Response: {
        Transaction: { TransactionStatusId: estado, AuthorizationCode: 'A1B2C3', ResponseCode: '00' },
      },
      Errors: [],
    })
    assert.equal(r.aprobada, false, `${etiqueta} no es un cobro`)
    assert.ok((r.motivo ?? '').length > 0, `${etiqueta} debe explicar algo al cliente`)
  }
})

test('sin estado de transacción se cae a los indicios de siempre', async () => {
  // No todas las respuestas traen TransactionStatusId; el camino viejo tiene
  // que seguir funcionando o se rechazarían cobros buenos.
  assert.equal(interpretarCompraToken({ Approved: true, AuthorizationCode: 'A1' }).aprobada, true)
  assert.equal(interpretarCompraToken({ ResponseCode: '00', RRN: '1' }).aprobada, true)
  assert.equal(interpretarCompraToken({ ResponseCode: '51' }).aprobada, false)
})

test('los códigos de rechazo del §9.2 se traducen a algo accionable', () => {
  // Un cliente no puede hacer nada con «internal-response-code 99». Sí puede
  // hacer algo con «el CVV no es correcto».
  const casos: Array<[string, RegExp]> = [
    ['51', /fondos/i],
    ['54', /vencida/i],
    ['99', /cvv|seguridad/i],
    ['94', /ya se procesó/i],
    ['91', /disponible/i],
  ]
  for (const [codigo, esperado] of casos) {
    const r = interpretarCompraToken({ ResponseCode: codigo })
    assert.equal(r.aprobada, false)
    assert.match(r.motivo ?? '', esperado, `código ${codigo}`)
  }
  // Un código desconocido no filtra detalle técnico del emisor.
  const raro = interpretarCompraToken({ ResponseCode: 'ZZ' })
  assert.doesNotMatch(raro.motivo ?? '', /ZZ/)
})

test('un perfil deshabilitado se reconoce: no se puede cobrar con él', async () => {
  // MANUAL §4.1.2.2 punto 12: «el objeto PaymentProfile podrá estar marcado
  // como deshabilitado (Enabled=false), por lo que para que dicho perfil
  // (Token) pueda ser utilizado, deberá ser activado».
  //
  // Con las llaves CON autenticación 3DS la tarjeta recién capturada nace así.
  // Sin mirar este campo, se intenta cobrar con un token muerto y el fallo
  // llega al cliente como un rechazo genérico que no le dice qué hacer.
  const { extraerPerfiles } = await import('../src/lib/payments/cardnet-tokens-core')
  const perfiles = extraerPerfiles({
    Response: {
      PaymentProfiles: [
        { PaymentProfileId: 50330, Token: 'CT__viejo_habilitado_1234', Enabled: true },
        { PaymentProfileId: 50331, Token: 'CT__nuevo_sin_activar_5678', Enabled: false },
      ],
    },
    Errors: [],
  })
  assert.equal(perfiles[0].habilitado, true)
  assert.equal(perfiles[1].habilitado, false, 'el recién capturado espera activación')
})

test('sin el campo Enabled se asume habilitado', () => {
  // Es lo que ocurre con las llaves SIN autenticación: el token queda activo
  // solo. Un campo ausente no puede bloquear un cobro que sí habría pasado.
  const perfiles = extraerPerfilesSync({
    Response: { PaymentProfiles: [{ PaymentProfileId: 1, Token: 'CT__sin_campo_enabled_1' }] },
    Errors: [],
  })
  assert.equal(perfiles[0].habilitado, true)
})

test('«El token no está activo» se traduce a instrucciones, no se repite tal cual', () => {
  // Es el mensaje real que devolvió CardNET en el primer cobro que llegó hasta
  // el Purchase. Es exacto y completamente inútil para quien acaba de digitar
  // su tarjeta: no dice qué es un token ni qué hacer. Detrás está el flujo de
  // activación del §4.1.2.3, que sí se puede explicar.
  const r = interpretarCompraToken({
    Response: {},
    Errors: [{ ErrorCode: 'TK010', Message: 'El token no está activo' }],
  })
  assert.equal(r.aprobada, false)
  assert.match(r.motivo ?? '', /RD\$1\.00/)
  assert.match(r.motivo ?? '', /6 dígitos/)
  assert.doesNotMatch(r.motivo ?? '', /^El token no está activo$/)
})

test('los demás errores del proveedor se muestran tal cual', () => {
  // Solo se reescribe lo que sabemos explicar mejor. Inventar traducciones
  // para errores que no conocemos escondería información útil.
  const r = interpretarCompraToken({
    Response: {},
    Errors: [{ ErrorCode: 'TK004', Message: 'Sesión inválida' }],
  })
  assert.equal(r.motivo, 'Sesión inválida')
})
