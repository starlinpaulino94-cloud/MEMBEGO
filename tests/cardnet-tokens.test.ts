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

  const prod = urlsTokens('produccion')
  assert.equal(prod.api, 'https://servicios.cardnet.com.do/servicios/tokens/v1/api')
  assert.equal(prod.capture, 'https://servicios.cardnet.com.do/servicios/tokens/v1/Capture/')

  // La API y la captura sí van en cardnet.com.do. El script es la excepción
  // (ver la prueba siguiente): lo exige el propio widget.
  for (const u of [qa.api, qa.capture, prod.api, prod.capture]) {
    assert.ok(u.includes('cardnet.com.do'), `${u} debe servirse desde CardNET`)
    assert.ok(!u.includes('gtp-seglan'), `${u} no puede venir del middleware`)
  }
})

test('el script del widget se carga del middleware que el propio widget exige', async () => {
  // El widget rechaza cualquier otro origen y lo grita en la consola:
  // «PWCheckout.js debe ser cargado desde la URL https://tr-tsp-test.gtp-seglan
  //  .com/… No puede ser descargado o importado desde un servidor propio o
  //  dominio de terceros distinto».
  //
  // Es la excepción a la regla: API y captura en cardnet.com.do, script en el
  // middleware. Yo lo había unificado por un razonamiento que sonaba bien
  // (mismo origen para que el token cruce) y que el widget desmiente.
  const { scriptWidget } = await import('../src/lib/payments/cardnet-tokens-core')
  assert.equal(
    scriptWidget('pruebas'),
    'https://tr-tsp-test.gtp-seglan.com/tr-tsp-mw-cardnet/v1/Scripts/PWCheckout.js'
  )
  assert.equal(
    scriptWidget('produccion'),
    'https://tr-tsp.gtp-seglan.com/tr-tsp-mw-cardnet/v1/Scripts/PWCheckout.js'
  )
  assert.equal(urlsTokens('pruebas').script, scriptWidget('pruebas'))
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
  // Respuesta REAL capturada en producción de pruebas (05/08/2026): el código
  // es PR001 y el texto lleva punto final. Se empareja por código, que no
  // depende de la redacción ni del idioma.
  const r = interpretarCompraToken({
    Response: { TrxToken: '***', Amount: null },
    Errors: [{ ErrorCode: 'PR001', Message: 'El token no está activo.' }],
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

test('el CustomerId guardado NO se reutiliza al cambiar de cuenta de CardNET', async () => {
  // Cada juego de llaves (pruebas con 3DS, pruebas sin 3DS, producción) es una
  // CUENTA distinta, y un CustomerId solo vale dentro de la suya. Reutilizarlo
  // tras cambiar de llaves abre la ventana con un session_id que la cuenta
  // nueva no reconoce → INTERNAL_SERVER_ERROR, sin ninguna pista de que el
  // culpable es un dato viejo en la base. Pasó de verdad.
  const { marcarCustomerIdConCuenta, leerCustomerIdDeCuenta } = await import(
    '../src/lib/payments/cardnet-tokens-core'
  )
  const PUB_A = '3-whMGoDQeLbIZPYm9KZvW_I56ONV7HQ' // con autenticación
  const PRIV_A = '573h-JheWH2bkL9bx59i8Lp-0YATxJdw4pfF3UorkpXaO3G3FDxsxr__'
  const PUB_B = 'J_eHXPYlDo9wlFpFXjgalm_I56ONV7HQ' // sin autenticación
  const PRIV_B = 'on3smurlSFA-_xT9IRGDv6v17bAY8Ri6acwsmjpjIojkNmByKuUJkA__'

  const guardado = marcarCustomerIdConCuenta('112027', PUB_A, PRIV_A)
  assert.equal(
    leerCustomerIdDeCuenta(guardado, PUB_A, PRIV_A),
    '112027',
    'misma cuenta: se reutiliza'
  )
  assert.equal(leerCustomerIdDeCuenta(guardado, PUB_B, PRIV_B), null, 'otra cuenta: se descarta')

  // EL CASO QUE FALLÓ: par mezclado. El Customer lo crea la PRIVADA, así que
  // etiquetar solo con la pública guardaba un cliente de la cuenta A rotulado
  // como de la B. Al arreglar el par, la etiqueta seguía coincidiendo y se
  // reutilizaba un id que la cuenta buena rechaza con TK011.
  const conParMezclado = marcarCustomerIdConCuenta('112001', PUB_B, PRIV_A)
  assert.equal(
    leerCustomerIdDeCuenta(conParMezclado, PUB_B, PRIV_B),
    null,
    'lo guardado con un par mezclado no sirve cuando el par se arregla'
  )
})

test('un CustomerId sin etiqueta de cuenta se descarta', async () => {
  // Valores anteriores a este cambio: no se puede saber de qué cuenta son.
  // Registrar un Customer de más es barato; abrir una ventana muerta cuesta
  // una sesión entera de depuración.
  const { leerCustomerIdDeCuenta } = await import('../src/lib/payments/cardnet-tokens-core')
  const PUB = '3-whMGoDQeLbIZPYm9KZvW_I56ONV7HQ'
  const PRIV = '573h-JheWH2bkL9bx59i8Lp-0YATxJdw4pfF3UorkpXaO3G3FDxsxr__'
  assert.equal(leerCustomerIdDeCuenta('112027', PUB, PRIV), null)
  assert.equal(leerCustomerIdDeCuenta('', PUB, PRIV), null)
  assert.equal(leerCustomerIdDeCuenta(null, PUB, PRIV), null)
  assert.equal(leerCustomerIdDeCuenta(':', PUB, PRIV), null)
})

test('las rutas se prueban en ambas grafías (el servicio no es consistente)', async () => {
  // El manual y el Postman escriben `/Customer`; el ambiente de pruebas
  // responde 200 a `/customer`. Un 404 por la grafía hacía que se descartara
  // el host entero y la sesión terminara en un 502 nuestro con el mensaje
  // «No se pudo iniciar la ventana de pago», que no dice nada de la causa.
  const { variantesDeRuta: variantesDeRutaParaPrueba } = await import(
    '../src/lib/payments/cardnet-tokens-core'
  )
  assert.deepEqual(variantesDeRutaParaPrueba('/Customer'), ['/Customer', '/customer'])
  assert.deepEqual(variantesDeRutaParaPrueba('/customer'), ['/customer', '/Customer'])
  assert.deepEqual(variantesDeRutaParaPrueba('/Customer/112065'), [
    '/Customer/112065',
    '/customer/112065',
  ])
  // Sin letra que cambiar, no se inventa una segunda llamada.
  assert.deepEqual(variantesDeRutaParaPrueba('/123'), ['/123'])
})

test('un cobro sin respuesta NO se repite: repetirlo puede cobrar dos veces', async () => {
  // Probar la otra grafía es gratis cuando el servicio contestó 404: la ruta
  // no existe, así que del otro lado no pasó nada.
  //
  // Cuando NO hubo respuesta (status 0: timeout, conexión cortada) la
  // situación es distinta y depende de qué se llamó. En una consulta, repetir
  // es inofensivo. En un COBRO no: CardNET pudo recibir el Purchase,
  // procesarlo, y perderse la respuesta de vuelta. Repetir ahí es la forma
  // exacta de cobrarle dos veces al cliente por una compra.
  const { reintentarConOtraGrafia } = await import('../src/lib/payments/cardnet-tokens-core')
  const CONSULTA = false
  const COBRO = true

  // Ruta inexistente: nada se ejecutó, se puede reintentar siempre.
  assert.equal(reintentarConOtraGrafia(404, CONSULTA), true)
  assert.equal(reintentarConOtraGrafia(404, COBRO), true)

  // Sin respuesta: aquí está la diferencia que importa.
  assert.equal(reintentarConOtraGrafia(0, CONSULTA), true)
  assert.equal(reintentarConOtraGrafia(0, COBRO), false, 'un cobro sin respuesta NO se repite')

  // Cualquier respuesta real del servicio (aunque sea un error) significa que
  // la ruta existe: cambiar de grafía solo enturbiaría el diagnóstico.
  for (const status of [200, 400, 401, 403, 409, 500, 502]) {
    assert.equal(reintentarConOtraGrafia(status, CONSULTA), false, `consulta ${status}`)
    assert.equal(reintentarConOtraGrafia(status, COBRO), false, `cobro ${status}`)
  }
})
