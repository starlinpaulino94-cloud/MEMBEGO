import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generarClavesVapid } from '../src/modules/notificaciones/web-push/protocolo'

// `server-only` lanza al importarse fuera de un componente de servidor de Next (ver api-cliente-bff.test.ts).
const rutaServerOnly: string = require.resolve('server-only')
require.cache[rutaServerOnly] = { id: rutaServerOnly, filename: rutaServerOnly, loaded: true, exports: {}, children: [], paths: [] } as unknown as NodeJS.Module

// Las claves se leen UNA vez por proceso: se fijan antes de la primera importación.
const claves = generarClavesVapid()
process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = claves.publica
process.env.VAPID_PRIVATE_KEY = claves.privada
process.env.VAPID_SUBJECT = 'mailto:pruebas@membego.com'

const RUTA = 'http://localhost/api/v1/notificaciones/push-web'

const suscripcionValida = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/' + 'a'.repeat(100),
  keys: { p256dh: 'B'.repeat(87), auth: 'c'.repeat(22) },
}

function peticion(method: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(RUTA, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

test('GET: entrega la clave pública VAPID cuando está configurada, sin cachear', async () => {
  const { GET } = await import('../src/app/api/v1/notificaciones/push-web/route')
  const res = await GET()
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await res.json(), { configurado: true, clavePublica: claves.publica })
})

test('POST: sin sesión responde 401 y no toca la base', async () => {
  const { POST } = await import('../src/app/api/v1/notificaciones/push-web/route')
  const res = await POST(peticion('POST', suscripcionValida))
  assert.equal(res.status, 401)
})

test('POST y DELETE: rechazan peticiones de otro origen (403) antes de mirar la sesión', async () => {
  const { POST, DELETE } = await import('../src/app/api/v1/notificaciones/push-web/route')
  const deOtroSitio = { Origin: 'https://malicioso.example' }
  assert.equal((await POST(peticion('POST', suscripcionValida, deOtroSitio))).status, 403)
  assert.equal((await DELETE(peticion('DELETE', { endpoint: suscripcionValida.endpoint }, deOtroSitio))).status, 403)
  assert.equal((await POST(peticion('POST', suscripcionValida, { 'Sec-Fetch-Site': 'cross-site' }))).status, 403)
})

test('esDelMismoOrigen: acepta el propio origen, sin Origin y navegaciones directas', async () => {
  const { esDelMismoOrigen } = await import('../src/lib/auth/mismo-origen')
  assert.equal(esDelMismoOrigen(peticion('POST', {}, { Origin: 'http://localhost' })), true)
  assert.equal(esDelMismoOrigen(peticion('POST', {}, { 'Sec-Fetch-Site': 'same-origin' })), true)
  assert.equal(esDelMismoOrigen(peticion('POST', {}, { 'Sec-Fetch-Site': 'none' })), true)
  assert.equal(esDelMismoOrigen(peticion('POST', {})), true)
  assert.equal(esDelMismoOrigen(peticion('POST', {}, { Origin: 'http://localhost:4000' })), false)
  assert.equal(esDelMismoOrigen(peticion('POST', {}, { Origin: 'no es una url' })), false)
})

test('DELETE: un cuerpo sin endpoint válido responde 400 (y no exige sesión: se usa al salir)', async () => {
  const { DELETE } = await import('../src/app/api/v1/notificaciones/push-web/route')
  assert.equal((await DELETE(peticion('DELETE', {}))).status, 400)
  assert.equal((await DELETE(peticion('DELETE', { endpoint: 'no-es-url' }))).status, 400)
  const sinJson = new Request(RUTA, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{' })
  assert.equal((await DELETE(sinJson)).status, 400)
})

/**
 * El service worker se comprueba por su código: no se puede ejecutar fuera del
 * navegador, y lo que importa es que las tres piezas de Web Push existan y que
 * la versión de la caché haya subido (sin eso, los navegadores que ya lo tienen
 * no reciben la versión con `push`).
 */
test('public/sw.js: trae los manejadores de Web Push y una versión de caché nueva', () => {
  const sw = readFileSync(join(__dirname, '..', 'public', 'sw.js'), 'utf8')
  assert.match(sw, /self\.addEventListener\('push'/)
  assert.match(sw, /self\.addEventListener\('notificationclick'/)
  assert.match(sw, /self\.addEventListener\('pushsubscriptionchange'/)
  assert.match(sw, /showNotification\(/)
  assert.doesNotMatch(sw, /const VERSION = 'v1'/)
  // El clic nunca saca a nadie de MembeGo: el destino se resuelve contra el propio origen.
  assert.match(sw, /self\.location\.origin/)
  // La renovación de la suscripción vuelve a registrarse en nuestra ruta.
  assert.match(sw, /\/api\/v1\/notificaciones\/push-web/)
})

test('public/manifest.json: lo mínimo para que Chrome ofrezca instalar', () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'public', 'manifest.json'), 'utf8'))
  assert.equal(manifest.display, 'standalone')
  assert.ok(manifest.start_url)
  assert.ok(manifest.icons.some((i: { sizes: string }) => i.sizes === '192x192'))
  assert.ok(manifest.icons.some((i: { sizes: string }) => i.sizes === '512x512'))
  assert.ok(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable'))
})
