import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, createHmac, sign } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CODIGOS_ERROR, SCOPES, materialFirmado } from '@membego/contracts'
import { MembegoClient, MembegoError } from '@membego/platform-sdk/cliente'
import { verificarWebhook } from '@membego/platform-sdk/webhooks'
import { InboxEnMemoria, procesarUnaVez } from '@membego/platform-sdk/inbox'
import { clavePublicaPem, clavePrivadaDesde } from '../src/modules/plataforma/firma'
import { CODIGOS_ERROR as CODIGOS_CORE } from '../src/modules/plataforma/errores'
import { SCOPES as SCOPES_CORE } from '../src/modules/plataforma/conceptos'

/**
 * SDK Y CONTRATOS (Fase 4).
 *
 * El paquete es la FUENTE del vocabulario; el Core lo reexporta. Estas pruebas
 * vigilan que esa dirección se mantenga —una copia se queda atrás en cuanto
 * alguien tiene prisa— y que el cliente haga las cuatro cosas que un cliente
 * escrito a mano olvida.
 */

// ── Una sola fuente ─────────────────────────────────────────────────────────

/**
 * LA PRUEBA QUE JUSTIFICA EL PAQUETE.
 *
 * Si el Core volviera a tener su propia tabla de códigos, la del satélite y la
 * suya empezarían iguales y se separarían a la tercera semana — y el satélite
 * ramificaría sobre un código que ya no existe.
 */
test('el Core no tiene su propia copia del vocabulario', () => {
  // Identidad de referencia, no igualdad estructural: si fueran objetos
  // distintos con el mismo contenido, la prueba pasaría hoy y mentiría mañana.
  assert.equal(CODIGOS_CORE, CODIGOS_ERROR, 'los códigos de error deben ser el MISMO objeto')
  assert.deepEqual(SCOPES_CORE, SCOPES)
})

test('los módulos de plataforma reexportan, no redefinen', () => {
  const RE = /^\s*export (const|interface|type) (CODIGOS_ERROR|CAPABILITIES|SCOPES|VERSION_SOBRE|SobreEvento|CuerpoError|CompanyDTO|CustomerDTO)\b/m
  for (const archivo of ['conceptos.ts', 'errores.ts', 'eventos.ts', 'dto.ts', 'firma.ts']) {
    const src = readFileSync(join('src', 'modules', 'plataforma', archivo), 'utf8')
    assert.ok(!RE.test(src), `${archivo} redefine algo que pertenece a @membego/contracts`)
  }
})

test('los contratos no arrastran nada del Core', () => {
  // Un satélite instala este paquete. Si importara Prisma, Next o `@/…`, se
  // llevaría medio MembeGo detrás y dejaría de poder instalarse fuera.
  const dir = join('packages', 'contracts', 'src')
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.ts')) continue
    const src = readFileSync(join(dir, f), 'utf8')
    for (const prohibido of ["from '@/", "from 'next", "from '@prisma", "from 'node:", "from 'crypto'"]) {
      assert.ok(!src.includes(prohibido), `contracts/${f} importa ${prohibido}`)
    }
  }
})

// ── El cliente ──────────────────────────────────────────────────────────────

interface Llamada {
  url: string
  metodo: string
  cabeceras: Record<string, string>
  cuerpo: string | null
}

/** Servidor falso: guarda lo que le piden y responde lo que se le indique. */
function servidor(respuestas: (n: number, ll: Llamada) => Response) {
  const llamadas: Llamada[] = []
  let n = 0
  const fetchFalso = (async (url: string | URL, init?: RequestInit) => {
    const ll: Llamada = {
      url: String(url),
      metodo: init?.method ?? 'GET',
      cabeceras: (init?.headers ?? {}) as Record<string, string>,
      cuerpo: typeof init?.body === 'string' ? init.body : null,
    }
    llamadas.push(ll)
    return respuestas(n++, ll)
  }) as unknown as typeof fetch
  return { llamadas, fetchFalso }
}

const json = (cuerpo: unknown, status = 200, cabeceras: Record<string, string> = {}) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json', ...cabeceras },
  })

const TOKEN_OK = { access_token: 'tk1', token_type: 'Bearer', expires_in: 900, scope: 'customers:read' }

function cliente(fetchFalso: typeof fetch, extra: Record<string, unknown> = {}) {
  return new MembegoClient({
    baseUrl: 'https://membego.test',
    clientId: 'mgc_x',
    clientSecret: 'mgs_y',
    dormir: async () => {},
    ...extra,
    fetch: fetchFalso,
  })
}

test('pide el token una vez y lo reutiliza', () => {
  const { llamadas, fetchFalso } = servidor((n) =>
    n === 0 ? json(TOKEN_OK) : json({ slug: 'restaurant' })
  )
  const c = cliente(fetchFalso)
  return (async () => {
    await c.systemsMe()
    await c.systemsMe()
    const tokens = llamadas.filter((l) => l.url.includes('/oauth/token'))
    assert.equal(tokens.length, 1, 'el token se pidió más de una vez')
    assert.equal(llamadas[2].cabeceras.Authorization, 'Bearer tk1')
  })()
})

/**
 * Veinte llamadas al arrancar no pueden ser veinte tokens: además de ser
 * gratuito, el límite del endpoint de token es estrecho a propósito y un
 * arranque en paralelo se auto-bloquearía.
 */
test('las peticiones simultáneas comparten UNA sola petición de token', async () => {
  const { llamadas, fetchFalso } = servidor((n) => (n === 0 ? json(TOKEN_OK) : json({ ok: true })))
  const c = cliente(fetchFalso)
  await Promise.all([c.systemsMe(), c.systemsMe(), c.systemsMe(), c.systemsMe()])
  assert.equal(llamadas.filter((l) => l.url.includes('/oauth/token')).length, 1)
})

test('renueva el token ANTES de que caduque, no después', async () => {
  // Con margen cero, una petición que sale en el último segundo llega caducada
  // y el satélite ve un 401 que no entiende.
  let ahora = 1_000_000
  const { llamadas, fetchFalso } = servidor((_n, ll) =>
    ll.url.includes('/oauth/token') ? json(TOKEN_OK) : json({ ok: true })
  )
  const c = cliente(fetchFalso, { ahora: () => ahora })
  await c.systemsMe()
  // A falta de 59 s para caducar (el margen es 60) ya toca renovar.
  ahora += (900 - 59) * 1000
  await c.systemsMe()
  assert.equal(llamadas.filter((l) => l.url.includes('/oauth/token')).length, 2)
})

/**
 * LA PRUEBA QUE MÁS IMPORTA DEL CLIENTE.
 *
 * Un cliente que reintenta generando una clave nueva tiene idempotencia en el
 * papel y consume el beneficio dos veces en la práctica — y desde fuera todo
 * parece correcto: el servidor cumplió su contrato y el cliente reintentó como
 * debía.
 */
test('un reintento usa la MISMA clave de idempotencia', async () => {
  const { llamadas, fetchFalso } = servidor((n, ll) => {
    if (ll.url.includes('/oauth/token')) return json(TOKEN_OK)
    // Primer intento: 500. Segundo: bien.
    return n === 1
      ? json({ error: { code: 'INTERNAL_ERROR', message: 'x', requestId: 'r1' } }, 500)
      : json({ redemptionId: 'r' })
  })
  const c = cliente(fetchFalso)
  await c.redeem({ companyId: 'e1', membershipId: 'm1', servicio: 'X' }, 'comanda-7')

  const canjes = llamadas.filter((l) => l.url.includes('/redemptions'))
  assert.equal(canjes.length, 2, 'debería haber reintentado')
  assert.equal(canjes[0].cabeceras['Idempotency-Key'], 'comanda-7')
  assert.equal(canjes[1].cabeceras['Idempotency-Key'], 'comanda-7')
})

test('un fallo de red también se reintenta con la misma clave', async () => {
  // Es el caso en que NO se sabe si llegó. Con la clave puesta, reintentar es
  // seguro; sin ella sería una lotería.
  let intentos = 0
  const { llamadas, fetchFalso } = servidor((_n, ll) => {
    if (ll.url.includes('/oauth/token')) return json(TOKEN_OK)
    if (intentos++ === 0) throw new Error('ECONNRESET')
    return json({ redemptionId: 'r' })
  })
  const c = cliente(fetchFalso)
  await c.redeem({ companyId: 'e1', membershipId: 'm1', servicio: 'X' }, 'comanda-8')
  const canjes = llamadas.filter((l) => l.url.includes('/redemptions'))
  assert.equal(canjes.length, 2)
  assert.ok(canjes.every((l) => l.cabeceras['Idempotency-Key'] === 'comanda-8'))
})

test('un 4xx del negocio NO se reintenta', async () => {
  // Reintentar algo que el servidor rechazó por su contenido solo gasta cuota y
  // retrasa el error real.
  const { llamadas, fetchFalso } = servidor((_n, ll) =>
    ll.url.includes('/oauth/token')
      ? json(TOKEN_OK)
      : json(
          { error: { code: 'BENEFIT_NOT_ELIGIBLE', message: 'sin usos', requestId: 'r2', reason: 'SIN_USOS' } },
          422
        )
  )
  const c = cliente(fetchFalso)
  await assert.rejects(
    () => c.redeem({ companyId: 'e1', membershipId: 'm1', servicio: 'X' }, 'k'),
    (e: MembegoError) => {
      assert.equal(e.code, 'BENEFIT_NOT_ELIGIBLE')
      assert.equal(e.reason, 'SIN_USOS')
      assert.equal(e.status, 422)
      assert.equal(e.requestId, 'r2')
      return true
    }
  )
  assert.equal(llamadas.filter((l) => l.url.includes('/redemptions')).length, 1)
})

test('el 429 sí se reintenta', async () => {
  const { llamadas, fetchFalso } = servidor((n, ll) => {
    if (ll.url.includes('/oauth/token')) return json(TOKEN_OK)
    return n === 1
      ? json({ error: { code: 'RATE_LIMITED', message: 'x', requestId: 'r' } }, 429)
      : json({ branches: [] })
  })
  const c = cliente(fetchFalso)
  await c.branches('e1')
  assert.equal(llamadas.filter((l) => l.url.includes('/branches')).length, 2)
})

test('canjear sin clave falla ANTES de tocar la red', async () => {
  const { llamadas, fetchFalso } = servidor(() => json(TOKEN_OK))
  const c = cliente(fetchFalso)
  await assert.rejects(() => c.redeem({ companyId: 'e', membershipId: 'm', servicio: 's' }, ''))
  assert.equal(llamadas.length, 0, 'no debería haber salido ninguna petición')
})

test('una respuesta que no es de MembeGo se distingue', async () => {
  // Un 502 de un balanceador no trae nuestro JSON. Confundirlo con una
  // respuesta de MembeGo haría que el satélite ramificara sobre un código
  // inventado.
  const { fetchFalso } = servidor((_n, ll) =>
    ll.url.includes('/oauth/token') ? json(TOKEN_OK) : new Response('<html>502</html>', { status: 502 })
  )
  const c = cliente(fetchFalso, { reintentos: 0 })
  await assert.rejects(
    () => c.branches('e1'),
    (e: MembegoError) => e.code === 'UNEXPECTED_RESPONSE' && e.status === 502
  )
})

test('el companyId viaja escapado en la URL', async () => {
  const { llamadas, fetchFalso } = servidor((_n, ll) =>
    ll.url.includes('/oauth/token') ? json(TOKEN_OK) : json({ branches: [] })
  )
  await cliente(fetchFalso).branches('a b&c=d')
  const url = llamadas.find((l) => l.url.includes('/branches'))!.url
  assert.ok(url.includes('companyId=a%20b%26c%3Dd'), url)
})

// ── Webhooks ────────────────────────────────────────────────────────────────

const { privateKey } = generateKeyPairSync('ed25519')
const PRIV = clavePrivadaDesde(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())!
const PUB = clavePublicaPem(PRIV)!

const CUERPO = JSON.stringify({
  eventId: 'evt_1', eventType: 'visit.completed', version: 1,
  occurredAt: '2026-08-10T15:00:00.000Z', companyId: 'emp1', source: 'membego',
  traceId: 't1', data: {}, id: 'evt_1', tipo: 'cliente.visita', payload: {},
  emitidoEn: '2026-08-10T15:00:00.000Z',
})

function firmar(cuerpo: string, ts: number, eventId = 'evt_1') {
  return sign(null, Buffer.from(materialFirmado(ts, eventId, cuerpo), 'utf8'), PRIV).toString('base64')
}

test('un webhook legítimo verifica y devuelve el evento', () => {
  const ts = 1_000_000
  const r = verificarWebhook(
    CUERPO,
    { 'X-Membego-Signature': firmar(CUERPO, ts), 'X-Membego-Timestamp': String(ts), 'X-Membego-Event-Id': 'evt_1' },
    { clavePublicaPem: PUB, ahoraEpoch: ts }
  )
  assert.ok(r.ok)
  assert.equal(r.evento.eventId, 'evt_1')
  assert.equal(r.evento.eventType, 'visit.completed')
})

/**
 * El error de integración más común con webhooks firmados: reparsear y volver a
 * serializar el cuerpo. El código «parece» correcto y la firma no valida nunca.
 */
test('reserializar el cuerpo invalida la firma', () => {
  const ts = 1_000_000
  const reserializado = JSON.stringify(JSON.parse(CUERPO))
  const r = verificarWebhook(
    reserializado === CUERPO ? `${CUERPO} ` : reserializado,
    { 'X-Membego-Signature': firmar(CUERPO, ts), 'X-Membego-Timestamp': String(ts), 'X-Membego-Event-Id': 'evt_1' },
    { clavePublicaPem: PUB, ahoraEpoch: ts }
  )
  assert.deepEqual(r, { ok: false, fallo: 'FIRMA_INVALIDA' })
})

test('fuera de la ventana se distingue de una firma mala', () => {
  // Son dos problemas distintos: uno es un reloj mal puesto y el otro un
  // impostor. Un único «no válido» manda a mirar donde no es.
  const ts = 1_000_000
  const r = verificarWebhook(
    CUERPO,
    { 'X-Membego-Signature': firmar(CUERPO, ts), 'X-Membego-Timestamp': String(ts), 'X-Membego-Event-Id': 'evt_1' },
    { clavePublicaPem: PUB, ahoraEpoch: ts + 400 }
  )
  assert.deepEqual(r, { ok: false, fallo: 'FUERA_DE_VENTANA' })
})

test('sin verificador configurado NO se acepta nada', () => {
  // Fallo cerrado: un satélite que olvide la clave no puede quedarse aceptando
  // cualquier cosa que le llegue.
  const r = verificarWebhook(CUERPO, {}, {})
  assert.deepEqual(r, { ok: false, fallo: 'SIN_VERIFICADOR' })
})

test('la firma HMAC se acepta durante la ventana de migración', () => {
  const hmac = createHmac('sha256', 'secreto').update(CUERPO, 'utf8').digest('hex')
  const r = verificarWebhook(CUERPO, { 'X-Membego-Firma': hmac }, { secretoCompartido: 'secreto' })
  assert.ok(r.ok)
  assert.equal(verificarWebhook(CUERPO, { 'X-Membego-Firma': 'mala' }, { secretoCompartido: 'secreto' }).ok, false)
})

test('con las dos disponibles, manda Ed25519', () => {
  // Con el HMAC, quien puede verificar puede falsificar. Mientras se acepte,
  // cualquiera con ese secreto fabrica eventos; la asimétrica tiene prioridad.
  const ts = 1_000_000
  const r = verificarWebhook(
    CUERPO,
    {
      'X-Membego-Signature': 'firma-falsa',
      'X-Membego-Timestamp': String(ts),
      'X-Membego-Event-Id': 'evt_1',
      'X-Membego-Firma': createHmac('sha256', 's').update(CUERPO, 'utf8').digest('hex'),
    },
    { clavePublicaPem: PUB, secretoCompartido: 's', ahoraEpoch: ts }
  )
  assert.deepEqual(r, { ok: false, fallo: 'FIRMA_INVALIDA' }, 'el HMAC válido no debe salvar una Ed25519 mala')
})

test('las cabeceras se leen vengan como vengan', () => {
  const ts = 1_000_000
  const h = new Headers({
    'X-Membego-Signature': firmar(CUERPO, ts),
    'X-Membego-Timestamp': String(ts),
    'X-Membego-Event-Id': 'evt_1',
  })
  assert.ok(verificarWebhook(CUERPO, h, { clavePublicaPem: PUB, ahoraEpoch: ts }).ok)
  // Node las baja a minúsculas.
  assert.ok(
    verificarWebhook(
      CUERPO,
      { 'x-membego-signature': firmar(CUERPO, ts), 'x-membego-timestamp': String(ts), 'x-membego-event-id': 'evt_1' },
      { clavePublicaPem: PUB, ahoraEpoch: ts }
    ).ok
  )
})

// ── Inbox ───────────────────────────────────────────────────────────────────

test('el mismo evento no se procesa dos veces', async () => {
  // MembeGo reintenta hasta ocho veces y el panel puede reencolar. Todos esos
  // intentos son legítimos y traen el MISMO eventId.
  const inbox = new InboxEnMemoria()
  let veces = 0
  const manejar = async () => {
    veces++
  }
  assert.equal(await procesarUnaVez(inbox, 'evt_1', manejar), 'PROCESADO')
  assert.equal(await procesarUnaVez(inbox, 'evt_1', manejar), 'DUPLICADO')
  assert.equal(await procesarUnaVez(inbox, 'evt_2', manejar), 'PROCESADO')
  assert.equal(veces, 2)
})

/**
 * Si el manejador falla, el evento se DESMARCA. Dejarlo marcado haría que el
 * reintento de MembeGo se descartara como duplicado y el evento se perdiera
 * para siempre: MembeGo lo daría por entregado y el satélite nunca lo procesó.
 */
test('un evento que falla se puede reintentar', async () => {
  const inbox = new InboxEnMemoria()
  await assert.rejects(() =>
    procesarUnaVez(inbox, 'evt_x', async () => {
      throw new Error('la base del satélite estaba caída')
    })
  )
  let procesado = false
  assert.equal(
    await procesarUnaVez(inbox, 'evt_x', async () => {
      procesado = true
    }),
    'PROCESADO'
  )
  assert.ok(procesado, 'el reintento se descartó como duplicado: el evento se habría perdido')
})

test('el inbox en memoria no crece sin límite', async () => {
  // Sin poda, un proceso de larga vida acumula todos los ids que ha visto: una
  // fuga de memoria con forma de defensa.
  const inbox = new InboxEnMemoria(3)
  for (const id of ['a', 'b', 'c', 'd']) await inbox.marcarSiEsNuevo(id)
  assert.equal(await inbox.marcarSiEsNuevo('a'), true, '«a» debería haberse podado')
  assert.equal(await inbox.marcarSiEsNuevo('d'), false, '«d» es reciente y debe seguir')
})

// ── Guardias del paquete ────────────────────────────────────────────────────

test('el SDK no importa nada del Core', () => {
  const dir = join('packages', 'platform-sdk', 'src')
  const recorrer = (d: string): string[] =>
    readdirSync(d).flatMap((f) => {
      const p = join(d, f)
      return statSync(p).isDirectory() ? recorrer(p) : p.endsWith('.ts') ? [p] : []
    })
  for (const archivo of recorrer(dir)) {
    const src = readFileSync(archivo, 'utf8')
    for (const prohibido of ["from '@/", "from 'next", "from '@prisma"]) {
      assert.ok(!src.includes(prohibido), `${archivo} importa ${prohibido}`)
    }
  }
})

test('el cliente no fabrica claves de idempotencia', () => {
  // La clave identifica LA OPERACIÓN DEL NEGOCIO —la comanda—, no la llamada
  // HTTP. Si la generara el SDK, un reintento del satélite entero (tras un
  // reinicio) traería una clave nueva y el beneficio se consumiría dos veces.
  const src = readFileSync(join('packages', 'platform-sdk', 'src', 'cliente.ts'), 'utf8')
  assert.ok(!src.includes('randomUUID'), 'el SDK no puede generar la clave')
  assert.match(src, /idempotencyKey: string/)
})

test('todos los códigos del contrato tienen un estado HTTP válido', () => {
  for (const [code, status] of Object.entries(CODIGOS_ERROR)) {
    assert.ok(status >= 400 && status < 600, `${code} → ${status}`)
  }
})
