import { test } from 'node:test'
import assert from 'node:assert/strict'
import { claveDedup } from '../src/modules/jobs/cola'
import {
  ADAPTADOR_TEST_GATEWAY,
  adaptadorDe,
  tipoDesde,
} from '../src/modules/supply-v2/operations/adaptadores'
import {
  MAX_CORRELATION,
  correlationIdValido,
  normalizarCorrelationId,
} from '../src/modules/supply-v2/operations/correlacion'
import {
  VERIFICADOR_TEST_GATEWAY,
  dentroDeVentana,
  firmaHmac,
  maxBytesCuerpo,
  proveedoresConocidos,
  toleranciaSegundos,
  verificadorDe,
} from '../src/modules/supply-v2/operations/firma'
import { lineaSupply } from '../src/modules/supply-v2/operations/log'
import { codigoDeProceso } from '../src/modules/supply-v2/operations/entrada'
import {
  HTTP_DE_CODIGO,
  MENSAJE_DE_CODIGO,
  invitaAReintentar,
  quedaResuelto,
  type CodigoEntrada,
} from '../src/modules/supply-v2/operations/respuestas'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 2 · DOMINIO (§12).
 *
 * Lo que se prueba aquí no toca la base ni la red: firma, frescura, traducción
 * del adaptador, hilo de la operación, política de códigos HTTP, forma del log
 * y clave del trabajo. Todo puro, todo rápido, todo determinista.
 *
 * `npm test`.
 */

const SECRETO = 'sv2-secreto-de-prueba'
const AHORA = new Date('2026-10-02T12:00:00.000Z')
const SEG = Math.floor(AHORA.getTime() / 1000)

const CUERPO = JSON.stringify({
  event: { id: 'evt_abc123', kind: 'payment.updated' },
  transaction: {
    id: 'TX-9',
    status: 'APPROVED',
    amount: '1000.00',
    currency: 'DOP',
    order_reference: 'MBG-SO-000123',
  },
})

/** Pone el secreto solo durante la llamada: ninguna prueba deja entorno sucio. */
async function conSecreto<T>(valor: string | undefined, fn: () => Promise<T>): Promise<T> {
  const previo = process.env.SUPPLY_V2_TEST_GATEWAY_SECRET
  if (valor === undefined) delete process.env.SUPPLY_V2_TEST_GATEWAY_SECRET
  else process.env.SUPPLY_V2_TEST_GATEWAY_SECRET = valor
  try {
    return await fn()
  } finally {
    if (previo === undefined) delete process.env.SUPPLY_V2_TEST_GATEWAY_SECRET
    else process.env.SUPPLY_V2_TEST_GATEWAY_SECRET = previo
  }
}

function peticion(d: { cuerpo?: string; ts?: number; firma?: string; ahora?: Date }) {
  const ts = String(d.ts ?? SEG)
  const cuerpo = d.cuerpo ?? CUERPO
  return {
    provider: 'TEST_GATEWAY',
    cuerpoCrudo: cuerpo,
    cabeceras: {
      'x-sv2-timestamp': ts,
      'x-sv2-signature': d.firma ?? `v1=${firmaHmac(SECRETO, ts, cuerpo)}`,
    } as Record<string, string | null>,
    ahora: d.ahora ?? AHORA,
  }
}

// ── 1 a 4 · firma y frescura ────────────────────────────────────────────────

test('1 · una firma correcta sobre el cuerpo que llegó se acepta', async () => {
  const r = await conSecreto(SECRETO, () => VERIFICADOR_TEST_GATEWAY.verificar(peticion({})))
  assert.equal(r.ok, true)
  assert.ok(r.ok && r.firmadoEn.getTime() === SEG * 1000, 'devuelve cuándo se firmó')
})

test('2 · una firma que no cuadra se rechaza, y el cuerpo alterado también', async () => {
  await conSecreto(SECRETO, async () => {
    const mala = await VERIFICADOR_TEST_GATEWAY.verificar(peticion({ firma: 'v1=0000' }))
    assert.equal(mala.ok, false)
    assert.ok(!mala.ok && mala.codigo === 'INVALID_SIGNATURE')

    // El caso que de verdad importa: firma auténtica, cuerpo cambiado. Alguien
    // interceptó una petición válida y le subió el monto.
    const ts = String(SEG)
    const original = CUERPO
    const manipulado = original.replace('"1000.00"', '"100000.00"')
    assert.notEqual(original, manipulado, 'la prueba cambia algo de verdad')
    const conFirmaDelOriginal = {
      provider: 'TEST_GATEWAY',
      cuerpoCrudo: manipulado,
      cabeceras: {
        'x-sv2-timestamp': ts,
        'x-sv2-signature': `v1=${firmaHmac(SECRETO, ts, original)}`,
      } as Record<string, string | null>,
      ahora: AHORA,
    }
    const alterado = await VERIFICADOR_TEST_GATEWAY.verificar(conFirmaDelOriginal)
    assert.equal(alterado.ok, false, 'el cuerpo alterado NO pasa con la firma del original')

    // Y faltar la cabecera no es «firma vacía»: es firma inválida.
    const sinCabecera = await VERIFICADOR_TEST_GATEWAY.verificar({
      ...peticion({}),
      cabeceras: { 'x-sv2-timestamp': ts, 'x-sv2-signature': null },
    })
    assert.equal(sinCabecera.ok, false)
  })
})

test('2a · sin secreto configurado se falla CERRADO, no se deja pasar', async () => {
  const r = await conSecreto(undefined, () => VERIFICADOR_TEST_GATEWAY.verificar(peticion({})))
  assert.equal(r.ok, false)
  assert.ok(!r.ok && r.codigo === 'INVALID_SIGNATURE', 'una configuración olvidada cierra la puerta, no la abre')
})

test('2b · el secreto se puede rotar: valen el nuevo y el anterior', async () => {
  const viejo = 'secreto-viejo'
  const nuevo = 'secreto-nuevo'
  await conSecreto(`${viejo},${nuevo}`, async () => {
    for (const s of [viejo, nuevo]) {
      const ts = String(SEG)
      const r = await VERIFICADOR_TEST_GATEWAY.verificar({
        ...peticion({}),
        cabeceras: { 'x-sv2-timestamp': ts, 'x-sv2-signature': `v1=${firmaHmac(s, ts, CUERPO)}` },
      })
      assert.equal(r.ok, true, `la firma con ${s} vale durante la rotación`)
    }
  })
})

test('3 · la ventana de frescura acepta lo de ahora y rechaza lo de hace mucho y lo del futuro', () => {
  const tol = toleranciaSegundos()
  assert.ok(tol >= 60, 'la ventana por defecto es de minutos, no de segundos')
  assert.ok(dentroDeVentana(SEG, AHORA), 'ahora mismo')
  assert.ok(dentroDeVentana(SEG - tol, AHORA), 'el borde de la ventana entra')
  assert.ok(!dentroDeVentana(SEG - tol - 1, AHORA), 'un segundo más allá, no')
  // El futuro también se rechaza: un reloj adelantado —o un atacante— abriría
  // una ventana de reenvío de duración arbitraria.
  assert.ok(!dentroDeVentana(SEG + tol + 1, AHORA), 'el futuro tampoco')
  assert.ok(!dentroDeVentana(Number.NaN, AHORA))
})

test('4 · un evento BIEN firmado pero viejo se rechaza como replay, no como firma mala', async () => {
  await conSecreto(SECRETO, async () => {
    const viejo = SEG - toleranciaSegundos() - 60
    const r = await VERIFICADOR_TEST_GATEWAY.verificar(peticion({ ts: viejo }))
    assert.equal(r.ok, false)
    assert.ok(!r.ok && r.codigo === 'REPLAY_REJECTED', 'distinguir los dos casos es el punto')

    // Y el orden importa: con la firma MALA y el timestamp viejo, lo que se
    // dice es que la firma está mal. Si fuera al contrario, quien prueba
    // firmas sabría cuál de las dos cosas tiene mal.
    const ambas = await VERIFICADOR_TEST_GATEWAY.verificar(peticion({ ts: viejo, firma: 'v1=dead' }))
    assert.ok(!ambas.ok && ambas.codigo === 'INVALID_SIGNATURE')
  })
})

test('4a · la idempotencia NO es la protección contra replay, y por eso hacen falta las dos', async () => {
  // Una petición de ayer, perfectamente firmada, reenviada hoy. Su identidad
  // es nueva para el inbox —nunca la vimos— así que el índice único no la
  // pararía: lo único que la para es que el instante va DENTRO de la firma.
  await conSecreto(SECRETO, async () => {
    const ayer = SEG - 24 * 3600
    const r = await VERIFICADOR_TEST_GATEWAY.verificar(peticion({ ts: ayer }))
    assert.ok(!r.ok && r.codigo === 'REPLAY_REJECTED')
    // Y no se puede «refrescar» el timestamp sin romper la firma.
    const refrescado = await VERIFICADOR_TEST_GATEWAY.verificar({
      ...peticion({}),
      cabeceras: {
        'x-sv2-timestamp': String(SEG),
        'x-sv2-signature': `v1=${firmaHmac(SECRETO, String(ayer), CUERPO)}`,
      },
    })
    assert.ok(!refrescado.ok && refrescado.codigo === 'INVALID_SIGNATURE')
  })
})

// ── 5 · proveedores ─────────────────────────────────────────────────────────

test('5 · un proveedor desconocido no tiene verificador ni adaptador', () => {
  assert.equal(verificadorDe('CARDNET'), null, 'CardNET NO está conectado a Supply 2.0')
  assert.equal(adaptadorDe('CARDNET'), null)
  assert.equal(verificadorDe('lo-que-sea'), null)
  assert.ok(verificadorDe('test_gateway'), 'el nombre del proveedor no distingue mayúsculas')
  assert.ok(adaptadorDe(' TEST_GATEWAY '), 'ni espacios de sobra')
  assert.deepEqual([...proveedoresConocidos()], ['TEST_GATEWAY'], 'hoy hay uno y solo uno')
})

// ── 6 a 8 · el adaptador ────────────────────────────────────────────────────

test('6 · un cuerpo válido se traduce a NUESTRO vocabulario', () => {
  const r = ADAPTADOR_TEST_GATEWAY.adaptar({ provider: 'TEST_GATEWAY', cuerpoCrudo: CUERPO, cabeceras: {} })
  assert.equal(r.provider, 'TEST_GATEWAY')
  assert.equal(r.externalEventId, 'evt_abc123')
  assert.equal(r.eventType, 'PAYMENT_CONFIRMED', 'el proveedor dice APPROVED; nosotros decimos PAYMENT_CONFIRMED')
  assert.equal(r.payment.orderReference, 'MBG-SO-000123', 'order_reference es SU nombre, no el nuestro')
  assert.equal(r.payment.amount, '1000.00', 'el importe se conserva en texto: 1000.00 no es un double')
  assert.equal(r.payment.currency, 'DOP')
  assert.equal(r.payment.externalTransactionId, 'TX-9', 'el id de la transacción, para conciliar')
  assert.equal(r.payment.status, 'APPROVED')
})

test('7 · un cuerpo que no se puede leer se rechaza en la puerta', () => {
  const malos: [string, RegExp][] = [
    ['no-soy-json', /JSON/],
    ['[]', /objeto/],
    ['null', /objeto/],
    ['{}', /identificador/],
    [JSON.stringify({ event: { kind: 'payment.updated' } }), /identificador/],
    [JSON.stringify({ event: { id: '   ' } }), /identificador/],
  ]
  for (const [cuerpo, esperado] of malos) {
    assert.throws(
      () => ADAPTADOR_TEST_GATEWAY.adaptar({ provider: 'TEST_GATEWAY', cuerpoCrudo: cuerpo, cabeceras: {} }),
      esperado,
      `«${cuerpo}» no debe pasar`
    )
  }
})

test('7a · un evento sin identidad NUNCA recibe una inventada', () => {
  // Es la diferencia entre «no puedo saber si esto ya llegó» y «esto es nuevo».
  // Inventarle un id haría que dos entregas del mismo evento fueran dos cobros.
  assert.throws(() =>
    ADAPTADOR_TEST_GATEWAY.adaptar({
      provider: 'TEST_GATEWAY',
      cuerpoCrudo: JSON.stringify({ transaction: { status: 'APPROVED', amount: '1000.00' } }),
      cabeceras: {},
    })
  )
})

test('8 · la traducción de estados no adivina: lo que no conocemos queda sin manejar', () => {
  assert.equal(tipoDesde('PAYMENT.UPDATED', 'APPROVED'), 'PAYMENT_CONFIRMED')
  assert.equal(tipoDesde('PAYMENT.UPDATED', 'CAPTURED'), 'PAYMENT_CONFIRMED')
  assert.equal(tipoDesde('PAYMENT.UPDATED', 'DECLINED'), 'PAYMENT_REJECTED')
  assert.equal(tipoDesde('PAYMENT.UPDATED', 'FAILED'), 'PAYMENT_REJECTED')
  // Un estado raro NO se lee como aprobado «porque no dice lo contrario».
  assert.equal(tipoDesde('PAYMENT.UPDATED', 'PENDING_REVIEW'), 'PAYMENT_UNKNOWN')
  assert.equal(tipoDesde('PAYMENT.UPDATED', null), 'PAYMENT_UNKNOWN')
  // Y un evento que no es de pago tampoco, aunque traiga un estado conocido.
  assert.equal(tipoDesde('CUSTOMER.CREATED', 'APPROVED'), 'PAYMENT_UNKNOWN')
})

test('8a · lo que el adaptador conserva del cuerpo va saneado', () => {
  const conSecretos = JSON.stringify({
    event: { id: 'evt_x', kind: 'payment.updated' },
    transaction: { id: 'TX-1', status: 'APPROVED', amount: '10.00', currency: 'DOP', order_reference: 'MBG-SO-1' },
    signature: 'FIRMA-QUE-NO-SE-GUARDA',
    authorization: 'Bearer TOKEN-QUE-NO-SE-GUARDA',
    card: { pan: '4111111111111111', cvv: '123' },
  })
  const r = ADAPTADOR_TEST_GATEWAY.adaptar({ provider: 'TEST_GATEWAY', cuerpoCrudo: conSecretos, cabeceras: {} })
  const json = JSON.stringify(r.rawSanitizedPayload)
  for (const prohibido of ['FIRMA-QUE-NO-SE-GUARDA', 'TOKEN-QUE-NO-SE-GUARDA', '4111111111111111']) {
    assert.ok(!json.includes(prohibido), `el cuerpo conservado no lleva ${prohibido}`)
  }
  assert.ok(json.includes('MBG-SO-1'), 'lo que no es secreto sí se conserva: sin cuerpo no se investiga')
})

// ── 9 y 10 · el hilo de la operación ────────────────────────────────────────

test('9 · un correlationId utilizable se respeta', () => {
  const dado = 'sv2-de-la-pasarela-123'
  assert.ok(correlationIdValido(dado))
  assert.equal(normalizarCorrelationId(dado), dado)
  assert.equal(normalizarCorrelationId(`  ${dado}  `), dado, 'se recortan los espacios')
})

test('10 · lo que no sirve como hilo se sustituye por uno nuevo, nunca se sigue sin hilo', () => {
  const basura: unknown[] = [
    undefined,
    null,
    '',
    '   ',
    'corto',                       // por debajo del mínimo
    'x'.repeat(MAX_CORRELATION + 1), // una cabecera no es un sitio para meter texto
    'con espacios dentro',
    'con/barra',
    'con:dos-puntos',              // rompería una clave de deduplicación
    'con\nsalto',
    42,
    { id: 'objeto' },
  ]
  const generados = new Set<string>()
  for (const v of basura) {
    const r = normalizarCorrelationId(v)
    assert.ok(correlationIdValido(r), `«${String(v)}» → un hilo válido (${r})`)
    assert.notEqual(r, String(v))
    generados.add(r)
  }
  assert.equal(generados.size, basura.length, 'cada uno recibe el suyo: no se reutiliza ninguno')
})

test('10a · el hilo no es una credencial: su forma no permite colarse por él', () => {
  // No puede llevar nada que al concatenarlo cambie el significado de otra
  // cosa: ni dos puntos (claves de deduplicación), ni barras (rutas), ni
  // saltos de línea (inyección en logs).
  for (const peligroso of ['a:b:c:d:e', '../../etc/passwd', 'x".y', 'uno\ndos tres cuatro']) {
    assert.ok(!correlationIdValido(peligroso), `«${peligroso}» no es un hilo válido`)
  }
})

// ── 11 · la política de códigos HTTP ────────────────────────────────────────

test('11 · cada código tiene su HTTP, y la regla es una sola', () => {
  // Nos hacemos cargo: no hay nada que reintentar.
  for (const c of ['EVENT_ACCEPTED', 'EVENT_REPEATED', 'EVENT_REJECTED'] as CodigoEntrada[]) {
    assert.equal(HTTP_DE_CODIGO[c], 200, `${c} → 200`)
    assert.ok(quedaResuelto(c) && !invitaAReintentar(c))
  }
  // El que llama está equivocado: reintentar no lo arregla.
  assert.equal(HTTP_DE_CODIGO.INVALID_SIGNATURE, 401)
  assert.equal(HTTP_DE_CODIGO.REPLAY_REJECTED, 400)
  assert.equal(HTTP_DE_CODIGO.INVALID_PAYLOAD, 400)
  assert.equal(HTTP_DE_CODIGO.UNKNOWN_PROVIDER, 404)
  assert.equal(HTTP_DE_CODIGO.PAYLOAD_TOO_LARGE, 413)
  for (const c of ['INVALID_SIGNATURE', 'REPLAY_REJECTED', 'INVALID_PAYLOAD', 'UNKNOWN_PROVIDER', 'PAYLOAD_TOO_LARGE'] as CodigoEntrada[]) {
    assert.ok(!invitaAReintentar(c), `${c} no debe invitar a reintentar eternamente`)
  }
  // Fallamos nosotros, o estamos apagados: los dos casos en los que el
  // reintento del proveedor es exactamente lo que queremos.
  assert.equal(HTTP_DE_CODIGO.INTERNAL_ERROR, 500)
  // El bloque 4 añadió FEATURE_DISABLED (503). Es la segunda —y la única otra—
  // respuesta que invita a reintentar, y por la misma razón que la primera: el
  // evento NO se procesó, así que decirle al proveedor que quedó aceptado lo
  // tiraría a la basura. La regla no cambió: 4xx es «tú tienes algo mal»,
  // 2xx es «nos hacemos cargo», y lo demás pide que vuelvan.
  assert.equal(HTTP_DE_CODIGO.FEATURE_DISABLED, 503)
  const invitan = (Object.keys(HTTP_DE_CODIGO) as CodigoEntrada[]).filter(invitaAReintentar).sort()
  assert.deepEqual(invitan, ['FEATURE_DISABLED', 'INTERNAL_ERROR'], 'nuestro fallo y nuestro apagado; nada más')
})

test('11a · un evento rechazado por no cuadrar contesta 200, y es a propósito', () => {
  // Un 4xx/5xx haría que el proveedor lo reintentara durante horas un evento
  // que NUNCA vamos a aceptar. Ya decidimos; el rechazo está escrito y
  // auditado, y una persona lo mirará.
  assert.equal(codigoDeProceso('RECHAZADO', false), 'EVENT_REJECTED')
  assert.equal(codigoDeProceso('IGNORADO', false), 'EVENT_REJECTED')
  assert.equal(HTTP_DE_CODIGO[codigoDeProceso('RECHAZADO', false)], 200)
})

test('11b · del resultado del procesador al código, sin perder ningún caso', () => {
  assert.equal(codigoDeProceso('PROCESADO', false), 'EVENT_ACCEPTED')
  assert.equal(codigoDeProceso('REPETIDO', true), 'EVENT_REPEATED')
  // Un fallo transitorio en un evento nuevo sí pide reintento.
  assert.equal(codigoDeProceso('REINTENTABLE', false), 'INTERNAL_ERROR')
  // Pero si ya lo teníamos, no: repetirlo no haría nada.
  assert.equal(codigoDeProceso('REINTENTABLE', true), 'EVENT_REPEATED')
})

test('11c · el mensaje que sale no explica nada técnico', () => {
  for (const [codigo, mensaje] of Object.entries(MENSAJE_DE_CODIGO)) {
    assert.ok(mensaje.length > 0 && mensaje.length < 40, `${codigo}: un mensaje corto`)
    assert.ok(!/stack|sql|prisma|secret|hmac|undefined/i.test(mensaje), `${codigo} no filtra interioridades`)
  }
  // Y ningún código se queda sin mensaje ni sin HTTP.
  assert.deepEqual(Object.keys(MENSAJE_DE_CODIGO).sort(), Object.keys(HTTP_DE_CODIGO).sort())
})

// ── 12 · la clave del trabajo de la cola ────────────────────────────────────

test('12 · la clave del trabajo sale de la identidad estable del outbox', () => {
  const base = { tipo: 'supply-v2-efecto', outboxId: 'ob_1', correlationId: 'sv2-hilo-1', intentos: 0 } as const
  // Dos despachadores que publiquen el MISMO intento de la MISMA fila son un
  // solo trabajo, aunque el hilo sea distinto.
  assert.equal(claveDedup(base), claveDedup({ ...base, correlationId: 'sv2-otro-hilo-9' }))
  // El intento siguiente sí es otro mensaje.
  assert.notEqual(claveDedup(base), claveDedup({ ...base, intentos: 1 }))
  // Y otra fila, otro trabajo.
  assert.notEqual(claveDedup(base), claveDedup({ ...base, outboxId: 'ob_2' }))
  assert.match(claveDedup(base), /^sv2out:ob_1:0$/)
})

// ── Extra · la forma del log y el tope del cuerpo ───────────────────────────

test('13 · la línea de log lleva los identificadores del camino y nada más', () => {
  const linea = lineaSupply({
    event: 'evento_recibido',
    provider: 'TEST_GATEWAY',
    externalEventId: 'evt_abc123',
    correlationId: 'sv2-hilo-1',
    inboxId: 'cl_inbox',
    outboxId: 'cl_outbox',
    attempt: 3,
    status: 'PROCESSED',
  })
  assert.ok(linea.startsWith('sv2 '), 'se puede filtrar entre todo el ruido')
  const cuerpo = JSON.parse(linea.slice(4)) as Record<string, unknown>
  assert.deepEqual(Object.keys(cuerpo).sort(), [
    'attempt',
    'correlationId',
    'event',
    'externalEventId',
    'inboxId',
    'outboxId',
    'provider',
    'status',
  ])
  assert.equal(cuerpo.attempt, 3)
})

test('13a · por el log no cabe un secreto: no hay campo donde meterlo', () => {
  const linea = lineaSupply({
    event: 'efecto_fallido',
    errorCode: 'fallo al entregar signature=FIRMA-SECRETA token=TOKEN-SECRETO con monto 1000.00',
  })
  assert.ok(!linea.includes('FIRMA-SECRETA'), 'la firma no sale')
  assert.ok(!linea.includes('TOKEN-SECRETO'), 'el token tampoco')
  assert.ok(linea.includes('1000.00'), 'el dato que sirve para diagnosticar sí')
  // Un salto de línea en un identificador partiría la línea en dos y
  // falsificaría un registro.
  const partida = lineaSupply({ event: 'x', correlationId: 'uno\ndos' })
  assert.equal(partida.split('\n').length, 1)
})

test('14 · el tope del cuerpo y la ventana se pueden configurar, con valores por defecto sanos', () => {
  assert.equal(maxBytesCuerpo(), 64 * 1024)
  assert.equal(toleranciaSegundos(), 300)
  const previo = { max: process.env.SUPPLY_V2_WEBHOOK_MAX_BYTES, tol: process.env.SUPPLY_V2_WEBHOOK_TOLERANCIA_S }
  try {
    process.env.SUPPLY_V2_WEBHOOK_MAX_BYTES = '2048'
    process.env.SUPPLY_V2_WEBHOOK_TOLERANCIA_S = '60'
    assert.equal(maxBytesCuerpo(), 2048)
    assert.equal(toleranciaSegundos(), 60)
    // Un valor absurdo no apaga la protección: se vuelve al de siempre.
    process.env.SUPPLY_V2_WEBHOOK_TOLERANCIA_S = '0'
    assert.equal(toleranciaSegundos(), 300)
    process.env.SUPPLY_V2_WEBHOOK_MAX_BYTES = 'mucho'
    assert.equal(maxBytesCuerpo(), 64 * 1024)
  } finally {
    if (previo.max === undefined) delete process.env.SUPPLY_V2_WEBHOOK_MAX_BYTES
    else process.env.SUPPLY_V2_WEBHOOK_MAX_BYTES = previo.max
    if (previo.tol === undefined) delete process.env.SUPPLY_V2_WEBHOOK_TOLERANCIA_S
    else process.env.SUPPLY_V2_WEBHOOK_TOLERANCIA_S = previo.tol
  }
})
