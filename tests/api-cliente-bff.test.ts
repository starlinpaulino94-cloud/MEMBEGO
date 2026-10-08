import { test } from 'node:test'
import assert from 'node:assert/strict'

// `server-only` lanza al importarse fuera de un componente de servidor de Next. Estas pruebas corren con `tsx --test` (Node), no con
// Bun: se deja el paquete ya «cargado» y vacío en la caché de módulos ANTES de importar `api-guard`.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const rutaServerOnly: string = require.resolve('server-only')
require.cache[rutaServerOnly] = { id: rutaServerOnly, filename: rutaServerOnly, loaded: true, exports: {}, children: [], paths: [] } as unknown as NodeJS.Module

test('getApiClientUser: rechaza peticiones sin cabecera Authorization', async () => {
  const { getApiClientUser } = await import('../src/lib/auth/api-guard')
  const req = new Request('http://localhost/api/v1/cliente/inicio')
  const user = await getApiClientUser(req)
  assert.equal(user, null)
})

test('getApiClientUser: rechaza peticiones con Bearer token vacío o mal formado', async () => {
  const { getApiClientUser } = await import('../src/lib/auth/api-guard')
  const req1 = new Request('http://localhost/api/v1/cliente/inicio', {
    headers: { Authorization: 'Bearer ' },
  })
  const user1 = await getApiClientUser(req1)
  assert.equal(user1, null)

  const req2 = new Request('http://localhost/api/v1/cliente/inicio', {
    headers: { Authorization: 'Basic dXNlcjpwYXNz' },
  })
  const user2 = await getApiClientUser(req2)
  assert.equal(user2, null)
})

test('GET /api/v1/cliente/inicio admite peticiones de invitados y devuelve vitrina comercial', async () => {
  const { GET: getInicio } = await import('../src/app/api/v1/cliente/inicio/route')
  const req = new Request('http://localhost/api/v1/cliente/inicio')
  const res = await getInicio(req)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.ok('comercial' in body)
  assert.equal(body.personal, null)
})

test('GET /api/v1/cliente/menu admite peticiones de invitados y devuelve categorías e items', async () => {
  const { GET: getMenu } = await import('../src/app/api/v1/cliente/menu/route')
  const req = new Request('http://localhost/api/v1/cliente/menu')
  const res = await getMenu(req)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.ok(Array.isArray(body.items))
  assert.equal(body.usuario, null)
})

test('GET /api/v1/cliente/qr rechaza peticiones sin autenticación con 401', async () => {
  const { GET: getQr } = await import('../src/app/api/v1/cliente/qr/route')
  const req = new Request('http://localhost/api/v1/cliente/qr')
  const res = await getQr(req)
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.ok(body.error)
})

test('GET /api/v1/cliente/perfil rechaza peticiones sin autenticación con 401', async () => {
  const { GET: getPerfil } = await import('../src/app/api/v1/cliente/perfil/route')
  const req = new Request('http://localhost/api/v1/cliente/perfil')
  const res = await getPerfil(req)
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.ok(body.error)
})

const RUTAS_401: Array<[string, string]> = [
  ['explorar', 'http://localhost/api/v1/cliente/explorar'],
  ['buscar', 'http://localhost/api/v1/cliente/buscar?q=lavado'],
  ['novedades', 'http://localhost/api/v1/cliente/novedades'],
  ['intereses', 'http://localhost/api/v1/cliente/intereses'],
  ['geo/cercanos', 'http://localhost/api/v1/cliente/geo/cercanos?contexto=MANUAL&lat=18.4&lng=-69.9'],
  ['geo/autocompletar', 'http://localhost/api/v1/cliente/geo/autocompletar?q=sa'],
  ['referidos', 'http://localhost/api/v1/cliente/referidos'],
  ['regalos', 'http://localhost/api/v1/cliente/regalos'],
  ['regalos/giftcard', 'http://localhost/api/v1/cliente/regalos/giftcard'],
  ['ruleta', 'http://localhost/api/v1/cliente/ruleta'],
  ['celebracion', 'http://localhost/api/v1/cliente/celebracion'],
  ['bienvenida', 'http://localhost/api/v1/cliente/bienvenida'],
]

for (const [nombre, url] of RUTAS_401) {
  test(`GET /api/v1/cliente/${nombre} rechaza peticiones sin autenticación con 401`, async () => {
    const { GET } = await import(`../src/app/api/v1/cliente/${nombre}/route`)
    const res = await GET(new Request(url))
    assert.equal(res.status, 401)
    const body = await res.json()
    assert.equal(body.error, 'No autorizado')
  })
}

const RUTAS_POST_401: Array<[string, string]> = [
  ['intereses', 'http://localhost/api/v1/cliente/intereses'],
  ['regalos/enviar', 'http://localhost/api/v1/cliente/regalos/enviar'],
  ['regalos/regalar', 'http://localhost/api/v1/cliente/regalos/regalar'],
  ['ruleta', 'http://localhost/api/v1/cliente/ruleta'],
]

for (const [nombre, url] of RUTAS_POST_401) {
  test(`POST /api/v1/cliente/${nombre} rechaza peticiones sin autenticación con 401`, async () => {
    const { POST } = await import(`../src/app/api/v1/cliente/${nombre}/route`)
    const req = new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const res = await POST(req)
    assert.equal(res.status, 401)
    const body = await res.json()
    assert.equal(body.error, 'No autorizado')
  })
}

test('POST /api/v1/cliente/intereses rechaza peticiones sin autenticación con 401', async () => {
  const { POST } = await import('../src/app/api/v1/cliente/intereses/route')
  const req = new Request('http://localhost/api/v1/cliente/intereses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ categoryIds: [] }),
  })
  const res = await POST(req)
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.equal(body.error, 'No autorizado')
})
