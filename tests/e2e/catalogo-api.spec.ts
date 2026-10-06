import { test, expect } from '@playwright/test'
import { cerrarPrisma, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'
import { claveApi, empresaCatalogo, itemSembrado, type EmpresaCatalogo, type ItemSembrado } from './catalogo-arnes'

/**
 * CATÁLOGO UNIFICADO · la API v1 con CLAVES DE EMPRESA reales (F1.3).
 *
 * Sin navegador: llama a las rutas por HTTP, contra el servidor de verdad y la
 * base de verdad. Las claves se siembran con Prisma (el límite `api_keys.max`
 * es una regla del panel, no de la API).
 *
 * Lo que se vigila:
 *  · el COSTO solo sale hacia la clave de la propia empresa;
 *  · la API arma BORRADORES: nunca publica, ignora `status`, `companyId` y
 *    `source` del cuerpo, y no agrega variantes a un ítem ya publicado;
 *  · aislamiento: un id de otra empresa contesta igual que uno inventado;
 *  · una empresa sin la capacidad responde `catalog_not_enabled`.
 *
 * (No se prueba «sin credenciales → 401»: en una app sin firma de tokens de
 * satélite configurada la respuesta es 503, igual que en `/branches`.)
 */

const sufijo = Date.now().toString(36)

/** Lo que estas pruebas leen de las respuestas JSON de la API (sin `any`). */
interface Json {
  error: { code: string; message: string; reason?: string; requestId: string }
  items: Fila[]
  variants: Variante[]
  page: { limit: number; nextCursor: string | null }
  id: string
  slug: string
  status: string
  source: string
  itemId: string
}
interface Variante {
  sku: string
  price: string
  cost?: string
  itemId: string
}
interface Fila {
  id: string
  name: string
  status: string
  variants: Variante[]
}
const API = '/api/platform/v1'

test.describe('Catálogo unificado · API v1', () => {
  test.describe.configure({ mode: 'serial' })
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!SESION_LOCAL_DISPONIBLE, 'requiere DATABASE_URL para sembrar empresas y claves')
    test.skip(testInfo.project.name !== 'escritorio', 'es HTTP puro: no depende del dispositivo, corre una vez')
  })
  test.afterAll(async () => {
    await cerrarPrisma()
  })

  let a: EmpresaCatalogo
  let b: EmpresaCatalogo
  let keyGestion = ''
  let keyLectura = ''
  let keyB = ''
  const it: Record<string, ItemSembrado> = {}

  const llamar = async (request: import('@playwright/test').APIRequestContext, metodo: 'GET' | 'POST', ruta: string, key: string | null, body?: unknown) => {
    const r = await request.fetch(`${API}${ruta}`, {
      method: metodo,
      headers: { ...(key ? { authorization: `Bearer ${key}` } : {}) },
      ...(body !== undefined ? { data: body } : {}),
    })
    let json: Json = {} as Json
    try {
      json = (await r.json()) as Json
    } catch {
      /* sin cuerpo JSON */
    }
    return { status: r.status(), json, headers: r.headers() }
  }

  test('siembra: empresa con capacidad, sin capacidad, y tres claves', async () => {
    a = await empresaCatalogo(sufijo, 'api-a', { capacidad: true })
    b = await empresaCatalogo(sufijo, 'api-b', { capacidad: false })
    it.lavado = await itemSembrado(a.id, { name: `Lavado API ${sufijo}`, slug: `lavado-api-${sufijo}`, variantes: [{ name: 'Default', sku: `LAV-${sufijo}`, price: 650.5, cost: 300.11, porDefecto: true }] })
    it.camiseta = await itemSembrado(a.id, {
      name: `Camiseta API ${sufijo}`, slug: `camiseta-api-${sufijo}`,
      variantes: [{ name: 'M', sku: `CM-${sufijo}`, price: 800, cost: 400.22 }, { name: 'L', sku: `CL-${sufijo}`, price: 850, status: 'OUT_OF_STOCK' }],
    })
    it.borrador = await itemSembrado(a.id, { name: `Borrador API ${sufijo}`, slug: `borrador-api-${sufijo}`, status: 'DRAFT', variantes: [{ name: 'Default', sku: `BOR-${sufijo}`, price: 1, porDefecto: true }] })
    it.deB = await itemSembrado(b.id, { name: `De B ${sufijo}`, slug: `de-b-api-${sufijo}`, variantes: [{ name: 'Default', sku: `DB-${sufijo}`, price: 9, porDefecto: true }] })
    keyGestion = await claveApi(a.id, ['catalog:read', 'catalog:manage'])
    keyLectura = await claveApi(a.id, ['catalog:read'])
    keyB = await claveApi(b.id, ['catalog:read', 'catalog:manage'])
  })

  test('GET lista: sus ítems con el costo, paginada, filtrable y sin cache', async ({ request }) => {
    let r = await llamar(request, 'GET', '/catalog-items?limit=50', keyLectura)
    expect(r.status).toBe(200)
    const nombres: string[] = r.json.items.map((i: Fila) => i.name)
    expect(nombres).toEqual(expect.arrayContaining([`Lavado API ${sufijo}`, `Camiseta API ${sufijo}`, `Borrador API ${sufijo}`]))
    expect(nombres.some((n) => n.startsWith('De B'))).toBe(false)
    expect(r.json.items.find((i: Fila) => i.name === `Lavado API ${sufijo}`)?.variants[0].cost).toBe('300.11')
    expect(r.json.page).toEqual(expect.objectContaining({ limit: 50 }))
    expect(r.headers['cache-control']).toMatch(/no-store/)

    r = await llamar(request, 'GET', '/catalog-items?limit=1', keyLectura)
    expect(r.json.items).toHaveLength(1)
    expect(r.json.page.nextCursor).toBeTruthy()
    const sig = await llamar(request, 'GET', `/catalog-items?limit=1&cursor=${encodeURIComponent(r.json.page.nextCursor ?? '')}`, keyLectura)
    expect(sig.json.items[0].id).not.toBe(r.json.items[0].id)

    r = await llamar(request, 'GET', '/catalog-items?status=DRAFT&limit=50', keyLectura)
    expect(r.json.items.every((i: Fila) => i.status === 'DRAFT')).toBe(true)
    r = await llamar(request, 'GET', '/catalog-items?status=ROTO', keyLectura)
    expect(r.status).toBe(400)
    expect(r.json.error.code).toBe('INVALID_REQUEST')
  })

  test('GET por id y variantes; un id de otra empresa contesta igual que uno inventado', async ({ request }) => {
    let r = await llamar(request, 'GET', `/catalog-items/${it.camiseta.id}`, keyLectura)
    expect(r.status).toBe(200)
    expect(r.json.variants).toHaveLength(2)

    r = await llamar(request, 'GET', `/catalog-variants?itemId=${it.camiseta.id}`, keyLectura)
    expect(r.status).toBe(200)
    expect(r.json.variants.every((v: Variante) => v.itemId === it.camiseta.id)).toBe(true)

    const ajeno = await llamar(request, 'GET', `/catalog-items/${it.deB.id}`, keyLectura)
    const inventado = await llamar(request, 'GET', '/catalog-items/cinexistente000000000000', keyLectura)
    expect(ajeno.status).toBe(404)
    const sinId = (j: Json) => ({ ...j, error: { ...j.error, requestId: 'x' } })
    expect(sinId(ajeno.json)).toEqual(sinId(inventado.json))

    const otra = await llamar(request, 'GET', `/catalog-items?companyId=${b.id}`, keyLectura)
    expect(otra.status).toBeGreaterThanOrEqual(400)
    expect(otra.status).toBeLessThan(500)
  })

  test('una empresa SIN la capacidad responde 404 catalog_not_enabled, también al escribir', async ({ request }) => {
    let r = await llamar(request, 'GET', '/catalog-items', keyB)
    expect(r.status).toBe(404)
    expect(r.json.error.reason).toBe('catalog_not_enabled')
    r = await llamar(request, 'POST', '/catalog-items', keyB, { name: 'x', type: 'SERVICE', price: 1 })
    expect(r.status).toBe(404)
    expect(r.json.error.reason).toBe('catalog_not_enabled')
  })

  test('POST: solo con catalog:manage; crea un BORRADOR e ignora status, companyId y source', async ({ request }) => {
    let r = await llamar(request, 'POST', '/catalog-items', keyLectura, { name: 'No debería', type: 'SERVICE', price: 1 })
    expect(r.status).toBe(403)
    expect(r.json.error.code).toBe('INSUFFICIENT_SCOPE')

    const sku = `API-${sufijo.toUpperCase()}`
    r = await llamar(request, 'POST', '/catalog-items', keyGestion, { name: `Creado por API ${sufijo}`, type: 'SERVICE', price: '99.90', cost: 40, sku, status: 'ACTIVE', companyId: b.id, source: 'SUPPLY' })
    expect(r.status).toBe(201)
    expect(r.json.status).toBe('DRAFT')
    expect(r.json.source).toBe('MERCHANT')
    expect(r.json.variants[0].sku).toBe(sku)
    it.creado = { id: r.json.id, slug: r.json.slug }

    // Quedó en SU empresa y no en la que pidió el cuerpo.
    expect((await llamar(request, 'GET', `/catalog-items/${it.creado.id}`, keyLectura)).status).toBe(200)
    expect((await llamar(request, 'GET', `/catalog-items/${it.creado.id}`, keyB)).status).toBe(404)

    // SKU repetido: no duplica y lo dice.
    r = await llamar(request, 'POST', '/catalog-items', keyGestion, { name: 'Duplicado', type: 'SERVICE', price: 1, sku })
    expect(r.status).toBe(400)
    expect(r.json.error.reason).toBe('duplicate')

    expect((await llamar(request, 'POST', '/catalog-items', keyGestion, { name: '', type: 'SERVICE', price: 1 })).status).toBe(400)
    const roto = await request.fetch(`${API}/catalog-items`, { method: 'POST', headers: { authorization: `Bearer ${keyGestion}`, 'content-type': 'application/json' }, data: '{no es json' })
    expect(roto.status()).toBe(400)
  })

  test('POST de variantes: a un borrador sí; a un ítem publicado o ajeno, no; el precio publicado no cambia', async ({ request }) => {
    let r = await llamar(request, 'POST', '/catalog-variants', keyGestion, { itemId: it.creado.id, name: 'Premium', price: 150 })
    expect(r.status).toBe(201)
    expect(r.json.itemId).toBe(it.creado.id)

    r = await llamar(request, 'POST', '/catalog-variants', keyGestion, { itemId: it.lavado.id, name: 'Intrusa', price: 1 })
    expect(r.status).toBe(400)
    expect(r.json.error.message).toMatch(/DRAFT/)
    r = await llamar(request, 'POST', '/catalog-variants', keyGestion, { itemId: it.deB.id, name: 'Ajena', price: 1 })
    expect(r.status).toBe(404)
    expect((await llamar(request, 'POST', '/catalog-variants', keyGestion, { name: 'sin item', price: 1 })).status).toBe(400)

    const vivo = await llamar(request, 'GET', `/catalog-items/${it.lavado.id}`, keyLectura)
    expect(vivo.json.variants).toHaveLength(1)
    expect(vivo.json.variants[0].price).toBe('650.50')
  })

  test('lo creado por la API NO se publica: la vitrina pública no lo ve', async ({ request }) => {
    const r = await request.get(`/empresas/${a.slug}/catalogo/${it.creado.slug}`)
    const html = await r.text()
    expect(html).not.toContain(`Creado por API ${sufijo}`)
  })
})
