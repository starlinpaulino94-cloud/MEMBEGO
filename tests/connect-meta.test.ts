import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PERMISOS_META,
  TTL_CODIGO_MS,
  VERSION_GRAPH_POR_DEFECTO,
  codigoCaducado,
  configMetaDesdeEntorno,
  firmaWebhookValida,
  leerRespuestaAlta,
  metaConfigurado,
  respuestaDeVerificacion,
  urlGraph,
} from '../src/modules/connect/metaNucleo'
import { proveedorDe } from '../src/modules/connect/proveedores/indice'

/**
 * MEMBEGO CONNECT · Fase 14 (Alta Incrustada de Meta).
 *
 * ADVERTENCIA que vale para toda esta suite: NADA de la Fase 14 se ha
 * ejecutado contra Meta. Lo que se prueba aquí es lo que se puede probar sin
 * la app: el núcleo puro, la firma del webhook y las guardias que impiden
 * ofrecer un alta que este despliegue no puede completar.
 */

const leer = (r: string) => readFileSync(join(__dirname, '..', r), 'utf8')
const codigo = (r: string) =>
  leer(r)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const ENTORNO_COMPLETO: Record<string, string | undefined> = {
  NEXT_PUBLIC_META_APP_ID: '123456',
  NEXT_PUBLIC_META_CONFIG_ID: '987654',
  META_APP_SECRET: 'secreto-de-la-app',
}

// ─── Configuración: la regla de «lo que no está configurado no se ofrece» ────

test('meta: sin las tres variables, el alta incrustada NO existe', () => {
  assert.equal(metaConfigurado({}), false)
  for (const falta of ['NEXT_PUBLIC_META_APP_ID', 'NEXT_PUBLIC_META_CONFIG_ID', 'META_APP_SECRET']) {
    const parcial = { ...ENTORNO_COMPLETO }
    delete parcial[falta]
    assert.equal(metaConfigurado(parcial), false, `falta ${falta} y aun así se ofrecería`)
  }
  assert.equal(metaConfigurado(ENTORNO_COMPLETO), true)
})

test('meta: el SECRETO no viaja en la configuración, solo el nombre de su variable', () => {
  const c = configMetaDesdeEntorno(ENTORNO_COMPLETO)!
  assert.equal(c.appSecretEnv, 'META_APP_SECRET')
  // Un secreto dentro de una estructura acaba, tarde o temprano, en un log.
  assert.ok(!JSON.stringify(c).includes('secreto-de-la-app'))
})

test('meta: la versión de la Graph API se puede fijar, y tiene un defecto', () => {
  assert.equal(configMetaDesdeEntorno(ENTORNO_COMPLETO)!.versionGraph, VERSION_GRAPH_POR_DEFECTO)
  assert.equal(
    configMetaDesdeEntorno({ ...ENTORNO_COMPLETO, META_GRAPH_VERSION: 'v26.0' })!.versionGraph,
    'v26.0'
  )
})

test('meta: se piden DOS permisos y ni uno más', () => {
  // Meta avisa de que pedir permisos innecesarios es causa habitual de rechazo
  // en la revisión de la app: añadir uno aquí cuesta semanas de trámite.
  assert.deepEqual([...PERMISOS_META], [
    'whatsapp_business_management',
    'whatsapp_business_messaging',
  ])
})

test('meta: las URLs de la Graph API se arman sin barras dobles', () => {
  assert.equal(urlGraph('v25.0', '/oauth/access_token'), 'https://graph.facebook.com/v25.0/oauth/access_token')
  assert.equal(urlGraph('v25.0', '123/register'), 'https://graph.facebook.com/v25.0/123/register')
})

// ─── Lo que devuelve el diálogo viene de una ventana ajena ───────────────────

test('meta: la respuesta del alta se valida en FORMA antes de tocar nada', () => {
  const buena = { code: 'AQD...', wabaId: '102290129340398', phoneNumberId: '106540352242922' }
  assert.deepEqual(leerRespuestaAlta(buena), { ok: true, datos: buena })

  for (const malo of [null, 'texto', 42, [], {}]) {
    assert.equal(leerRespuestaAlta(malo).ok, false, `${JSON.stringify(malo)} debería rechazarse`)
  }
  assert.deepEqual(leerRespuestaAlta({ ...buena, code: '' }), { ok: false, motivo: 'incompleta' })
  assert.deepEqual(leerRespuestaAlta({ ...buena, wabaId: undefined }), {
    ok: false,
    motivo: 'incompleta',
  })
})

test('meta: un identificador no numérico NO llega a formar parte de una URL', () => {
  // Sin esto, una cadena arbitraria de una ventana ajena acabaría dentro de una
  // llamada a la Graph API.
  for (const veneno of ['../me', '123/../otro', 'abc', '1 2', '12345678901234567890123456789012345']) {
    assert.deepEqual(
      leerRespuestaAlta({ code: 'x', wabaId: veneno, phoneNumberId: '123' }),
      { ok: false, motivo: 'formato' },
      `${veneno} no debería aceptarse como WABA`
    )
  }
})

test('meta: el código caduca a los 30 segundos, con margen', () => {
  assert.equal(TTL_CODIGO_MS, 30_000)
  const ahora = 1_000_000
  assert.equal(codigoCaducado(ahora - 1_000, ahora), false)
  assert.equal(codigoCaducado(ahora - 29_000, ahora), true, 'el margen debería adelantarse al corte')
  assert.equal(codigoCaducado(ahora - 31_000, ahora), true)
})

// ─── Firma del webhook ───────────────────────────────────────────────────────

const SECRETO = 'secreto-de-la-app'
const firmar = (cuerpo: string, secreto = SECRETO) =>
  `sha256=${createHmac('sha256', secreto).update(cuerpo, 'utf8').digest('hex')}`

test('webhook: una firma correcta pasa; una de otro secreto, no', () => {
  const cuerpo = '{"entry":[{"id":"102290129340398"}]}'
  assert.equal(firmaWebhookValida(cuerpo, firmar(cuerpo), SECRETO), true)
  assert.equal(firmaWebhookValida(cuerpo, firmar(cuerpo, 'otro'), SECRETO), false)
})

test('webhook: un byte alterado del cuerpo invalida la firma', () => {
  const cuerpo = '{"entry":[{"id":"102290129340398"}]}'
  const firma = firmar(cuerpo)
  assert.equal(firmaWebhookValida(cuerpo + ' ', firma, SECRETO), false)
})

test('webhook: sin cabecera, con otro algoritmo o con basura, se rechaza', () => {
  const cuerpo = '{}'
  for (const cabecera of [
    null,
    '',
    'sha1=abc',
    'abc',
    'sha256=',
    'sha256=nohex',
    `sha256=${randomBytes(32).toString('hex')}`,
  ]) {
    assert.equal(firmaWebhookValida(cuerpo, cabecera, SECRETO), false, `${cabecera} debería fallar`)
  }
  // Y sin secreto configurado, jamás valida.
  assert.equal(firmaWebhookValida(cuerpo, firmar(cuerpo), ''), false)
})

test('webhook: el apretón de manos exige modo, token y challenge', () => {
  const ok = new URLSearchParams({
    'hub.mode': 'subscribe',
    'hub.verify_token': 'tok',
    'hub.challenge': '12345',
  })
  assert.deepEqual(respuestaDeVerificacion(ok, 'tok'), { ok: true, challenge: '12345' })
  assert.deepEqual(respuestaDeVerificacion(ok, 'otro'), { ok: false })
  // Un token esperado vacío nunca valida: si no está configurado, no se abre.
  assert.deepEqual(respuestaDeVerificacion(ok, ''), { ok: false })
  const sinChallenge = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tok' })
  assert.deepEqual(respuestaDeVerificacion(sinChallenge, 'tok'), { ok: false })
})

// ─── El guion depende del despliegue ─────────────────────────────────────────

test('whatsapp: sin app de Meta, el guion es el del token manual', () => {
  const previo = { ...process.env }
  for (const k of ['NEXT_PUBLIC_META_APP_ID', 'NEXT_PUBLIC_META_CONFIG_ID', 'META_APP_SECRET']) {
    delete process.env[k]
  }
  try {
    const wa = proveedorDe('whatsapp')!
    const pasos = wa.pasos()
    assert.equal(pasos.find((p) => p.id === 'credencial')?.componente, 'AltaWhatsapp')
    // Y la interfaz lo dice en voz alta en vez de disfrazarlo.
    assert.equal(wa.autorizacion.tipo, 'API_KEY')
    assert.ok(wa.autorizacion.provisional)
  } finally {
    Object.assign(process.env, previo)
  }
})

test('whatsapp: con app de Meta, el guion es el alta incrustada y el patrón POPUP', () => {
  const previo = { ...process.env }
  Object.assign(process.env, ENTORNO_COMPLETO)
  try {
    const wa = proveedorDe('whatsapp')!
    assert.equal(wa.pasos().find((p) => p.id === 'credencial')?.componente, 'AltaMetaWhatsapp')
    // POPUP y no REDIRECCIÓN: el alta incrustada es un diálogo del SDK que
    // devuelve el resultado a la ventana que lo abrió.
    assert.equal(wa.autorizacion.patron, 'POPUP')
    assert.equal(wa.autorizacion.tipo, 'OAUTH2')
    // Ya no es provisional: éste ES el camino bueno.
    assert.ok(!wa.autorizacion.provisional)
  } finally {
    for (const k of Object.keys(ENTORNO_COMPLETO)) delete process.env[k]
    Object.assign(process.env, previo)
  }
})

test('whatsapp: el paso de Meta se cumple porque EXISTE la credencial', () => {
  const previo = { ...process.env }
  Object.assign(process.env, ENTORNO_COMPLETO)
  try {
    const paso = proveedorDe('whatsapp')!.pasos().find((p) => p.id === 'credencial')!
    // No porque alguien apuntara que pasó por ahí: si el canje falla, el paso
    // sigue sin cumplirse y la persona reintenta.
    assert.equal(paso.cumpleCon, 'autorizado')
  } finally {
    for (const k of Object.keys(ENTORNO_COMPLETO)) delete process.env[k]
    Object.assign(process.env, previo)
  }
})

// ─── Guardias estructurales ──────────────────────────────────────────────────

test('meta: el secreto de la app NUNCA baja al navegador', () => {
  // Al cliente solo llega lo público. El secreto lo usa la acción del canje.
  const asistente = codigo('src/app/(admin)/admin/integraciones/[slug]/conectar/page.tsx')
  assert.match(asistente, /appId: c\.appId, configId: c\.configId, versionGraph: c\.versionGraph/)
  assert.ok(!asistente.includes('META_APP_SECRET'))

  const componente = codigo('src/components/connect/AltaMetaWhatsapp.tsx')
  assert.ok(!componente.includes('META_APP_SECRET'))
  assert.ok(!componente.includes('appSecret'))
})

test('meta: el diálogo filtra los mensajes por ORIGEN', () => {
  const src = codigo('src/components/connect/AltaMetaWhatsapp.tsx')
  // Aceptar mensajes de cualquier ventana sería dejar que otra pestaña nos
  // dicte qué cuenta de WhatsApp conectar.
  assert.match(src, /if \(e\.origin !== ORIGEN_META\) return/)
  assert.match(src, /const ORIGEN_META = 'https:\/\/www\.facebook\.com'/)
})

test('meta: el canje se dispara SOLO, no al pulsar «siguiente»', () => {
  const src = codigo('src/components/connect/AltaMetaWhatsapp.tsx')
  // Los 30 segundos no dan para una confirmación humana.
  assert.match(src, /formRef\.current\?\.requestSubmit\(\)/)
})

test('meta: la acción del canje comprueba sesión y configuración', () => {
  const src = codigo('src/modules/connect/altaActions.ts')
  const accion = src.slice(src.indexOf('export async function altaMetaAction'))
  assert.match(accion, /requireSection\('integraciones', 'app_conectar'\)/)
  // Si la plataforma no lo tiene configurado, la acción no existe para nadie —
  // aunque alguien la llame a mano.
  assert.match(accion, /if \(!metaConfigurado\(\)\) return/)
  assert.ok(!accion.includes("formData.get('companyId')"))
})

test('meta: nada de lo que devuelve Meta en un error se registra en crudo', () => {
  const src = codigo('src/modules/connect/metaEmbedded.ts')
  // En el cuerpo de un error de Meta puede viajar el número del cliente y, en
  // un eco de autorización fallida, el propio token.
  assert.ok(!src.includes('await resp.text()'))
  assert.match(src, /m\.slice\(0, 160\)/)
  // Y el mensaje de una excepción puede llevar la URL con el secreto dentro.
  assert.match(src, /'No se pudo contactar con Meta\.'/)
})

test('meta: una conexión a medias NO se guarda', () => {
  const src = codigo('src/modules/connect/metaEmbedded.ts')
  const completar = src.slice(src.indexOf('export async function completarAltaMeta'))
  // Con token pero sin número registrado parecería sana y fallaría en el primer
  // envío. Cada paso corta antes de llegar a guardar.
  const orden = ['canjearCodigo', 'registrarNumero', 'suscribirWebhooks', 'guardarCredencial']
  let anterior = -1
  for (const fn of orden) {
    const i = completar.indexOf(fn)
    assert.ok(i > anterior, `${fn} está fuera de orden en el alta`)
    anterior = i
  }
  assert.match(completar, /if \(!canje\.ok\) return canje/)
  assert.match(completar, /if \(!registro\.ok\) return registro/)
  assert.match(completar, /if \(!suscripcion\.ok\) return suscripcion/)
})

test('webhook: sin secreto configurado la ruta no existe, y la firma va ANTES de leer', () => {
  const src = codigo('src/app/api/connect/meta/webhook/route.ts')
  assert.match(src, /if \(!secreto\) return new NextResponse\('Not found', \{ status: 404 \}\)/)
  // El cuerpo CRUDO y una sola vez; la firma antes de parsear nada.
  const post = src.slice(src.indexOf('export async function POST'))
  assert.ok(
    post.indexOf('firmaWebhookValida') < post.indexOf('JSON.parse'),
    'se estaría leyendo el contenido antes de comprobar la firma'
  )
})

test('webhook: del contenido de Meta no se guarda nada identificable', () => {
  const src = codigo('src/app/api/connect/meta/webhook/route.ts')
  // En `value` viaja el número de teléfono de clientes finales.
  assert.ok(!/detalle: \{[^}]*value/.test(src))
  assert.match(src, /detalle: \{ wabaId \}/)
})
