import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  urlsTokens,
  montoEnteroMenor,
  interpretarCompraToken,
  exigeActivacionPrimero,
  desenvolverRespuesta,
  sinSensibles,
  extraerPerfiles as extraerPerfilesSync,
  perfilPendienteDeActivar,
  mismoPerfilCardnet,
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

test('un fallo TÉCNICO de la pasarela no se le cuelga a la tarjeta del cliente', async () => {
  // Respuesta REAL de CardNET (PurchaseId 99268, 05/08/2026), recortada. El
  // nivel de arriba solo dice `TransactionStatusId: 4` y ningún código: el
  // motivo está en `Transaction.Steps`, en el paso que cortó la cadena.
  //
  // Sin leer los pasos, esto salía por pantalla como «Verifica los datos o
  // intenta con otra tarjeta» — culpando a una tarjeta que estaba perfecta
  // (VISA, Enabled: true, recién capturada) y mandando al cliente a buscar
  // otra. Y de paso borraba la única pista de la respuesta.
  const { interpretarCompraToken, MENSAJE_FALLO_PASARELA } = await import(
    '../src/lib/payments/cardnet-tokens-core'
  )
  const real = {
    Errors: [],
    Response: {
      Order: 'cmsger7ao0001l404dwib9e1k',
      Amount: 160000,
      Capture: true,
      Currency: 'DOP',
      PurchaseId: 99268,
      Transaction: {
        Steps: [
          {
            Step: 'CardNet GetIdempotencyKey',
            Error: '',
            Status: 'Get Idempotency Key OK',
            ResponseCode: '0',
            ResponseMessage: 'OK',
            AuthorizationCode: null,
          },
          {
            Step: 'CardNet Authorization Without CVV',
            Error: '',
            Status: 'Authorization Fail',
            ResponseCode: 'BadRequest',
            ResponseMessage: 'Bad Request',
            AuthorizationCode: null,
          },
        ],
        Status: 'Rejected',
        Description: 'BadRequest Bad Request',
        ApprovalCode: null,
        TransactionID: 1208656,
        TransactionStatusId: 4,
      },
    },
  }
  const res = interpretarCompraToken(real)
  assert.equal(res.aprobada, false)
  assert.equal(res.autorizacion, null)
  // El código técnico se CONSERVA: es lo que hay que mandarle a CardNET.
  assert.equal(res.codigo, 'BadRequest')
  // Y al cliente se le dice la verdad, incluido lo único que le importa.
  assert.equal(res.motivo, MENSAJE_FALLO_PASARELA)
  assert.match(res.motivo ?? '', /no se te hizo ningún cargo/i)
  assert.doesNotMatch(res.motivo ?? '', /otra tarjeta|verifica los datos/i)
})

test('un rechazo REAL del emisor sigue diciendo lo del emisor, no lo de la pasarela', async () => {
  // La guardia del caso anterior no puede tragarse los rechazos de verdad: si
  // el banco dice «fondos insuficientes», eso es lo que hay que decir.
  const { interpretarCompraToken } = await import('../src/lib/payments/cardnet-tokens-core')
  const sinFondos = {
    Errors: [],
    Response: {
      Transaction: {
        Steps: [
          { Step: 'CardNet GetIdempotencyKey', Status: 'OK', ResponseCode: '0' },
          { Step: 'CardNet Authorization', Status: 'Authorization Fail', ResponseCode: '51' },
        ],
        Status: 'Rejected',
        TransactionStatusId: 4,
      },
    },
  }
  const res = interpretarCompraToken(sinFondos)
  assert.equal(res.aprobada, false)
  assert.equal(res.codigo, '51')
  assert.equal(res.motivo, 'Fondos insuficientes.')
})

test('un cobro con todos los pasos en orden sí aprueba', async () => {
  // La otra mitad de la guardia: leer los pasos no puede volverse un motivo
  // para rechazar cobros buenos. Un cliente al que se le cobró y no se le
  // activó la membresía es peor que uno al que no se le cobró.
  const { interpretarCompraToken } = await import('../src/lib/payments/cardnet-tokens-core')
  const aprobado = {
    Errors: [],
    Response: {
      Transaction: {
        Steps: [
          { Step: 'CardNet GetIdempotencyKey', Error: '', Status: 'Get Idempotency Key OK', ResponseCode: '0' },
          {
            Step: 'CardNet Authorization Without CVV',
            Error: '',
            Status: 'Authorization OK',
            ResponseCode: '00',
            ResponseMessage: 'Approved',
            AuthorizationCode: '123456',
          },
        ],
        Status: 'Approved',
        TransactionStatusId: 1,
      },
    },
  }
  const res = interpretarCompraToken(aprobado)
  assert.equal(res.aprobada, true)
  assert.equal(res.motivo, null)
})

test('la referencia del cobro cabe en los campos del adquirente', async () => {
  // Mandábamos el cuid completo (25 caracteres) en Order, Invoice y UniqueID.
  // CardNET devolvió el UniqueID como cadena VACÍA: estos campos tienen
  // límites que nadie documenta y que el servicio aplica en silencio.
  const { referenciaCobro, LARGO_REFERENCIA_COBRO } = await import(
    '../src/lib/payments/cardnet-tokens-core'
  )
  const id = 'cmsger7ao0001l404dwib9e1k'
  const ref = referenciaCobro(id)
  assert.equal(ref.length, LARGO_REFERENCIA_COBRO)
  assert.ok(LARGO_REFERENCIA_COBRO <= 12, 'no crecer sin confirmarlo con CardNET')
  assert.match(ref, /^[A-Za-z0-9]+$/, 'sin símbolos que puedan romper la trama')

  // Es un SUFIJO del id: conciliar sigue siendo una consulta directa.
  assert.ok(id.endsWith(ref), `${id} debe terminar en ${ref}`)

  // Se corta por el FINAL, que es la parte aleatoria del cuid. Cortando por
  // delante, dos intentos creados en el mismo segundo darían la misma
  // referencia — y dos cobros distintos con la misma referencia es
  // exactamente lo que no se puede conciliar después.
  const a = referenciaCobro('cmsger7ao0001l404dwib9e1k')
  const b = referenciaCobro('cmsger7ao0002l404zzzz1111')
  assert.notEqual(a, b)

  // Nunca vacío: un Order vacío rompería el cobro entero.
  assert.equal(referenciaCobro(''), 'MEMBEGO')
  assert.equal(referenciaCobro('---'), 'MEMBEGO')
})

// ── Activación (llaves CON autenticación · §4.1.2.3) ────────────────────────

test('activación: el código limpio de 6 caracteres pasa en mayúsculas', async () => {
  const { normalizarCodigoActivacion } = await import('../src/lib/payments/cardnet-tokens-core')
  assert.equal(normalizarCodigoActivacion('Z2R78V'), 'Z2R78V')
  assert.equal(normalizarCodigoActivacion('z2r78v'), 'Z2R78V')
})

test('activación: se admite la línea del estado de cuenta pegada entera', async () => {
  const { normalizarCodigoActivacion } = await import('../src/lib/payments/cardnet-tokens-core')
  // Como aparece en el banco («Cardnet:Z2R78V»), con espacios y minúsculas.
  assert.equal(normalizarCodigoActivacion('Cardnet:Z2R78V'), 'Z2R78V')
  assert.equal(normalizarCodigoActivacion('  cardnet : z2r78v  '), 'Z2R78V')
})

test('activación: lo que no reduce a 6 alfanuméricos se rechaza antes de gastar un intento', async () => {
  const { normalizarCodigoActivacion } = await import('../src/lib/payments/cardnet-tokens-core')
  assert.equal(normalizarCodigoActivacion(''), null)
  assert.equal(normalizarCodigoActivacion('12345'), null)
  assert.equal(normalizarCodigoActivacion('1234567'), null)
  // «cardnet» solo, sin código: no debe convertirse en cadena vacía válida.
  assert.equal(normalizarCodigoActivacion('Cardnet:'), null)
})


// ── CS012: la tarjeta existe pero falta activarla ──────────────────────────
//
// Este error es la fuente MÁS FIABLE de la pantalla del código de activación.
// La otra (`Enabled: false` en el listado de perfiles) es un campo que puede
// no venir, y cuando no viene se asume habilitado a propósito. Si CS012 no se
// reconociera, el cliente vería «no se pudo procesar el pago» con el código de
// su banco en la mano y ningún lugar donde escribirlo.

test('exigeActivacionPrimero reconoce el CS012 por código', () => {
  assert.equal(exigeActivacionPrimero([{ codigo: 'CS012', mensaje: '' }]), true)
  assert.equal(exigeActivacionPrimero([{ codigo: 'cs012', mensaje: '' }]), true)
  assert.equal(exigeActivacionPrimero([{ codigo: ' CS012 ', mensaje: '' }]), true)
})

test('exigeActivacionPrimero reconoce el CS012 por mensaje aunque falte el código', () => {
  assert.equal(
    exigeActivacionPrimero([{ codigo: '', mensaje: 'PROFILE_MUST_BE_ACTIVATED_FIRST' }]),
    true
  )
  assert.equal(
    exigeActivacionPrimero([{ codigo: '', mensaje: 'The profile must be activated first' }]),
    true
  )
})

test('exigeActivacionPrimero NO confunde otros errores con falta de activación', () => {
  assert.equal(exigeActivacionPrimero([]), false)
  assert.equal(exigeActivacionPrimero([{ codigo: 'TK011', mensaje: 'Cliente no válido' }]), false)
  assert.equal(exigeActivacionPrimero([{ codigo: 'PR001', mensaje: 'Medio de pago' }]), false)
})

test('interpretarCompraToken marca requiereActivacion ante CS012', () => {
  const r = interpretarCompraToken({
    Response: { Transaction: { TransactionStatusId: 4 } },
    Errors: [{ ErrorCode: 'CS012', Message: 'PROFILE_MUST_BE_ACTIVATED_FIRST' }],
  })
  assert.equal(r.aprobada, false)
  assert.equal(r.requiereActivacion, true)
})

test('una compra aprobada nunca pide activación', () => {
  const r = interpretarCompraToken({ Approved: true, AuthorizationCode: 'A1B2C3' })
  assert.equal(r.aprobada, true)
  assert.equal(r.requiereActivacion, false)
})

test('un rechazo del banco NO se confunde con falta de activación', () => {
  // Fondos insuficientes es un rechazo real: abrir la pantalla del código de
  // activación ahí mandaría al cliente a buscar un código que no existe.
  const r = interpretarCompraToken({ ResponseCode: '51' })
  assert.equal(r.aprobada, false)
  assert.equal(r.requiereActivacion, false)
})


// ── El presupuesto de abrir la ventana no es el de cobrar ──────────────────
//
// Compartían limitador (10/min entre las cinco rutas de pago) y la operación
// barata —pedir la sesión de captura, que el navegador precarga sola— agotaba
// el presupuesto de las caras. El cliente se quedaba sin poder COBRAR porque
// había abierto la pantalla de pago varias veces, y el 429 le llegaba
// disfrazado de «No se pudo iniciar la ventana de pago».
//
// Esta prueba fija la separación estructuralmente: si alguien vuelve a poner
// `paymentLimiter` en la ruta de sesión, o le quita el freno a una ruta que
// mueve dinero, se entera aquí y no en producción.

const RUTAS = 'src/app/api/pagos/cardnet-token'

test('las rutas que MUEVEN DINERO conservan el limitador de pagos', () => {
  for (const ruta of ['cobrar', 'confirmar', 'activar', 'guardar']) {
    const src = readFileSync(`${RUTAS}/${ruta}/route.ts`, 'utf8')
    assert.match(
      src,
      /await paymentLimiter\(/,
      `${ruta}: una ruta que cobra tiene que pasar por el limitador de pagos`
    )
  }
})

test('abrir la ventana de pago NO gasta el presupuesto de los cobros', () => {
  const src = readFileSync(`${RUTAS}/sesion/route.ts`, 'utf8')
  assert.match(src, /await paymentSessionLimiter\(/)
  // Y no puede colarse además el de los cobros: el objetivo es no tocarlo.
  assert.doesNotMatch(src, /await paymentLimiter\(/)
})

test('el limitador de sesión es más holgado que el de los cobros', () => {
  // Si fuera igual o más estrecho, separarlos no habría servido de nada.
  const src = readFileSync('src/lib/rate-limit.ts', 'utf8')
  const leerTope = (nombre: string) => {
    const bloque = new RegExp(
      `export const ${nombre} = createRateLimiter\\(\\{[^}]*maxRequests:\\s*(\\d+)`,
      'm'
    ).exec(src)
    assert.ok(bloque, `no se encontró el limitador ${nombre}`)
    return Number(bloque[1])
  }
  assert.ok(leerTope('paymentSessionLimiter') > leerTope('paymentLimiter'))
})

// ── El perfil que espera su código ──────────────────────────────────────────
//
// El criterio vive en UNA función porque lo consultan tres sitios: la
// activación real, el aviso de «tienes una tarjeta esperando» y la sonda de
// diagnóstico. Si divergieran, el aviso enseñaría los últimos 4 dígitos de una
// tarjeta y se activaría otra — y las dos pantallas se verían normales.

const perfil = (
  ultimos4: string,
  habilitado: boolean
): Parameters<typeof perfilPendienteDeActivar>[0][number] => ({
  paymentProfileId: `pp-${ultimos4}`,
  token: `CT__${ultimos4}`,
  marca: 'VISA',
  ultimos4,
  habilitado,
})

test('perfilPendienteDeActivar: sin perfiles no hay nada que activar', () => {
  assert.equal(perfilPendienteDeActivar([]), null)
})

test('perfilPendienteDeActivar: con todo habilitado devuelve null', () => {
  assert.equal(perfilPendienteDeActivar([perfil('1111', true), perfil('2222', true)]), null)
})

test('perfilPendienteDeActivar: elige el MÁS RECIENTE de los deshabilitados', () => {
  // Cada intento de registrar la tarjeta deja su perfil y CardNET no los
  // limpia. El que le importa al cliente es el último: es el cargo de RD$1.00
  // que tiene delante en la app del banco.
  const elegido = perfilPendienteDeActivar([
    perfil('1111', false),
    perfil('2222', false),
    perfil('3333', false),
  ])
  assert.equal(elegido?.ultimos4, '3333')
})

test('perfilPendienteDeActivar: ignora los habilitados aunque sean posteriores', () => {
  // Una tarjeta ya activa NO es candidata a activarse, esté donde esté en la
  // lista. Devolverla mandaría al cliente a teclear un código que no existe.
  const elegido = perfilPendienteDeActivar([
    perfil('1111', false),
    perfil('9999', true),
  ])
  assert.equal(elegido?.ultimos4, '1111')
})

// ── La sonda de diagnóstico no puede volver a abrirse ───────────────────────
//
// Esta ruta ejecutaba una activación REAL desde un GET, con el código en la
// barra de direcciones y sin ningún límite. Tres formas de que eso vuelva:
// alguien añade un atajo por GET «para probar rápido», alguien quita el
// limitador porque estorba, o alguien devuelve el override de `customerId` a
// todo el mundo. Las tres se ven aquí.

test('la sonda de diagnóstico tiene límite en sus DOS verbos', () => {
  const src = readFileSync(`${RUTAS}/estado/route.ts`, 'utf8')
  // El GET solo lee: le basta el presupuesto de las lecturas.
  assert.match(src, /await paymentSessionLimiter\(/)
  // El POST puede BORRAR una tarjeta al tercer código fallido: va con el
  // presupuesto estrecho de las rutas que mueven dinero.
  assert.match(src, /await paymentLimiter\(/)
})

test('la sonda NO ejecuta la activación desde un GET', () => {
  const src = readFileSync(`${RUTAS}/estado/route.ts`, 'utf8')
  const get = src.slice(src.indexOf('export async function GET'), src.indexOf('export async function POST'))
  assert.ok(get.length > 0, 'no se encontró el bloque del GET')
  // Un GET debe poder repetirse sin consecuencias: una precarga del navegador
  // o un volver-atrás no pueden quemar uno de los 3 intentos.
  assert.doesNotMatch(
    get,
    /activarPerfilCardnet\(/,
    'el GET volvió a ejecutar la activación: eso lo dispara una precarga'
  )
  // Y el código no puede volver a leerse de la URL, donde queda escrito en
  // registros de acceso, historial y cabecera Referer.
  assert.doesNotMatch(
    get,
    /searchParams\.get\('codigo'\)/,
    'el código de activación volvió a la query string'
  )
})

test('mirar el Customer de OTRO queda restringido a SUPERADMIN', () => {
  const src = readFileSync(`${RUTAS}/estado/route.ts`, 'utf8')
  const i = src.indexOf("searchParams.get('customerId')")
  assert.ok(i > 0, 'desapareció el override de customerId; si fue a propósito, actualiza esta prueba')
  // El parámetro solo puede leerse detrás de la comprobación de superadmin:
  // sin ella, cualquiera con sesión leía el correo y las tarjetas de otro.
  assert.match(
    src.slice(Math.max(0, i - 200), i),
    /esSuperadmin/,
    'el override de customerId dejó de estar detrás de la guardia de superadmin'
  )
})

// ── Reconocer la tarjeta después de activarla ───────────────────────────────
//
// EL FALLO REAL (24-08-2026, en vivo con CardNET): tras poner un código
// CORRECTO salía «La tarjeta se eliminó tras varios intentos fallidos».
//
// La comprobación era `!p.habilitado && p.paymentProfileId === …`, que mezcla
// «el perfil existe» con «el perfil sigue deshabilitado». Cuando la activación
// funcionaba, el perfil quedaba HABILITADO, la condición daba false y se
// concluía que la tarjeta había desaparecido. Se dispara con facilidad porque
// un `Enabled` AUSENTE se parsea como habilitado.

test('mismoPerfilCardnet: reconoce por PaymentProfileId', () => {
  assert.equal(
    mismoPerfilCardnet({ paymentProfileId: 'pp-1', token: 'A' }, { paymentProfileId: 'pp-1', token: 'B' }),
    true
  )
  assert.equal(
    mismoPerfilCardnet({ paymentProfileId: 'pp-1', token: 'A' }, { paymentProfileId: 'pp-2', token: 'A' }),
    false
  )
})

test('mismoPerfilCardnet: cae al Token cuando falta el id', () => {
  // El `PaymentProfileId` puede venir nulo. Antes, un nulo hacía que la
  // tarjeta «dejara de ser ella misma» y se diera por eliminada.
  assert.equal(
    mismoPerfilCardnet({ paymentProfileId: null, token: 'CT__x' }, { paymentProfileId: 'pp-1', token: 'CT__x' }),
    true
  )
  assert.equal(
    mismoPerfilCardnet({ paymentProfileId: null, token: 'CT__x' }, { paymentProfileId: null, token: 'CT__y' }),
    false
  )
})

test('mismoPerfilCardnet: sin ninguna referencia común NO afirma que son el mismo', () => {
  // Fallar cerrado: inventar una coincidencia sería peor que no encontrarla.
  assert.equal(
    mismoPerfilCardnet({ paymentProfileId: null, token: null }, { paymentProfileId: null, token: null }),
    false
  )
})

test('un Enabled AUSENTE se lee como habilitado (y por eso no puede significar «borrada»)', () => {
  // Esta es la pieza que convertía «se activó» en «se eliminó».
  const [p] = extraerPerfilesSync({
    PaymentProfiles: [{ PaymentProfileId: 'pp-1', Token: 'CT__x', LastFour: '1111' }],
  })
  assert.equal(p.habilitado, true, 'sin Enabled explícito el perfil se considera habilitado')
})

test('la activación distingue los TRES estados, no dos', () => {
  const src = readFileSync('src/modules/pagos/cardnetToken.ts', 'utf8')
  // La condición vieja mezclaba existencia con estado. Si vuelve, la tarjeta
  // activada se vuelve a anunciar como destruida.
  assert.doesNotMatch(
    src,
    /some\(\s*\(p\) => !p\.habilitado && p\.paymentProfileId/,
    'volvió la comprobación que confunde «habilitada» con «eliminada»'
  )
  assert.match(src, /mismoPerfilCardnet\(/)
})

// ── Un 200 NO significa que activó ─────────────────────────────────────────
//
// SEGUNDO REPORTE EN VIVO (24-08-2026): con el código que dio el propio
// CardNET salía «Tu tarjeta quedó registrada pero falta activarla» — o sea, el
// mensaje que pide hacer justo lo que se acababa de hacer.
//
// `activarPerfilCardnet` decidía el éxito SOLO por el estado HTTP. CardNET
// devuelve sus fallos dentro del cuerpo, en `Errors[]`, y puede hacerlo con un
// 200. El cobro ya se defendía de eso; la activación no. Un código rechazado
// se leía como activación exitosa → se pasaba a cobrar → CS012 → ese mensaje.

test('el activate no puede decidir el éxito solo por el estado HTTP', () => {
  const src = readFileSync('src/lib/payments/cardnet-tokens.ts', 'utf8')
  const i = src.indexOf('export async function activarPerfilCardnet')
  assert.ok(i > 0, 'no se encontró activarPerfilCardnet')
  const cuerpo = src.slice(i, i + 2000)
  // El cuerpo de la respuesta tiene que mirarse.
  assert.match(cuerpo, /desenvolverRespuesta\(/, 'el activate dejó de leer el cuerpo de la respuesta')
  // Y el `ok` que devuelve tiene que depender de que no haya errores.
  assert.match(
    cuerpo,
    /ok:\s*ok && errores\.length === 0/,
    'el activate volvió a dar por buena una respuesta con Errors dentro'
  )
})

test('desenvolverRespuesta encuentra los Errors vengan donde vengan', () => {
  // En la raíz…
  const a = desenvolverRespuesta({ Errors: [{ ErrorCode: 'CS013', Message: 'Invalid code' }] })
  assert.equal(a.errores.length, 1)
  assert.equal(a.errores[0].codigo, 'CS013')
  // …o dentro de Response, que es como los envuelve el servicio.
  const b = desenvolverRespuesta({
    Response: { Errors: [{ ErrorCode: 'CS013', Message: 'Invalid code' }] },
  })
  assert.equal(b.errores.length, 1)
  // Y una respuesta limpia no inventa errores.
  assert.equal(desenvolverRespuesta({ Response: { Enabled: true } }).errores.length, 0)
})

test('un activate con Errors y HTTP 200 NO puede terminar en cobro', () => {
  const src = readFileSync('src/modules/pagos/cardnetToken.ts', 'utf8')
  const i = src.indexOf('if (!activacion.ok)')
  assert.ok(i > 0)
  const bloque = src.slice(i, i + 3000)
  // Si el proveedor señaló el fallo, eso manda sobre lo que parezca el listado
  // de perfiles — donde un `Enabled` ausente se lee como habilitado.
  assert.match(
    bloque,
    /activacion\.errores\.length > 0/,
    'la clasificación dejó de mirar los errores que devuelve el proveedor'
  )
})
