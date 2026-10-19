import { test, expect } from '@playwright/test'
import { cerrarPrisma, SESION_LOCAL_DISPONIBLE } from './supply-v2-sesion'
import { claveApi, empresaCatalogo, itemSembrado, sucursalSembrada, varianteDe, type EmpresaCatalogo } from './catalogo-arnes'

/**
 * INVENTARIO · la API v1 con CLAVES DE EMPRESA reales (INV-5e).
 *
 * Sin navegador: llama a las rutas por HTTP, contra el servidor de verdad y la base de verdad.
 *
 * Lo que se vigila:
 *  · una clave de solo lectura LEE pero no mueve nada; la de gestión mueve y devuelve el saldo;
 *  · escribir sin `Idempotency-Key` se rechaza; repetirla no suma dos veces; usarla con otra operación se rechaza;
 *  · el ajuste exige su código de motivo; un faltante no baja de cero;
 *  · aislamiento: la clave de otra empresa no ve ni mueve estas existencias; una empresa sin la capacidad responde `catalog_not_enabled`;
 *  · ningún costo cruza la frontera.
 */

const sufijo = Date.now().toString(36)
const API = '/api/platform/v1'

interface Json {
  error: { code: string; reason?: string }
  levels: { variantId: string; branchId: string; onHand: number; available: number }[]
  movements: { type: string; quantity: number; reference: { type: string } | null }[]
  page: { limit: number; nextCursor: string | null }
  level: { available: number; onHand: number }
  movementId: string
  repeated: boolean
}

test.describe('Inventario · API v1', () => {
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
  let suc = ''
  let variante = ''
  let keyGestion = ''
  let keyLectura = ''
  let keyB = ''

  const llamar = async (request: import('@playwright/test').APIRequestContext, metodo: 'GET' | 'POST', ruta: string, key: string | null, body?: unknown, idem?: string) => {
    const r = await request.fetch(`${API}${ruta}`, {
      method: metodo,
      headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(idem ? { 'idempotency-key': idem } : {}) },
      ...(body !== undefined ? { data: body } : {}),
    })
    let json = {} as Json
    try {
      json = (await r.json()) as Json
    } catch {
      /* sin cuerpo JSON */
    }
    return { status: r.status(), json, texto: JSON.stringify(json) }
  }

  test('siembra: empresa con capacidad, sin capacidad, un producto con inventario y tres claves', async () => {
    a = await empresaCatalogo(sufijo, 'inv-api-a', { capacidad: true })
    b = await empresaCatalogo(sufijo, 'inv-api-b', { capacidad: false })
    suc = (await sucursalSembrada(a.id, 'Principal')).id
    const it = await itemSembrado(a.id, { name: `Inv API ${sufijo}`, slug: `inv-api-${sufijo}`, controlaInventario: true, variantes: [{ name: 'Default', sku: `IA-${sufijo}`, price: 10, cost: 4.25, porDefecto: true }] })
    variante = await varianteDe(it.id)
    keyGestion = await claveApi(a.id, ['inventory:read', 'inventory:manage'])
    keyLectura = await claveApi(a.id, ['inventory:read'])
    keyB = await claveApi(b.id, ['inventory:read', 'inventory:manage'])
  })

  test('entrada: suma, devuelve el saldo, exige Idempotency-Key y un reintento no suma dos veces', async ({ request }) => {
    const cuerpo = { variantId: variante, branchId: suc, quantity: 8, note: 'Pedido del proveedor' }
    let r = await llamar(request, 'POST', '/inventory/receipts', keyGestion, cuerpo)
    expect(r.status).toBe(400)
    expect(r.json.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')

    r = await llamar(request, 'POST', '/inventory/receipts', keyGestion, cuerpo, `e2e-${sufijo}-1`)
    expect(r.status).toBe(201)
    expect(r.json.level).toEqual(expect.objectContaining({ onHand: 8, available: 8 }))
    expect(r.json.repeated).toBe(false)
    const movimiento = r.json.movementId

    r = await llamar(request, 'POST', '/inventory/receipts', keyGestion, cuerpo, `e2e-${sufijo}-1`)
    expect(r.status).toBe(200)
    expect(r.json.repeated).toBe(true)
    expect(r.json.movementId).toBe(movimiento)
    expect(r.json.level.onHand).toBe(8)

    r = await llamar(request, 'POST', '/inventory/receipts', keyGestion, { ...cuerpo, quantity: 9 }, `e2e-${sufijo}-1`)
    expect(r.status).toBe(400)
    expect(r.json.error.reason).toBe('idempotency_key_reused')
  })

  test('ajuste: faltante con motivo; sin motivo, con motivo que no es de faltante o de más, se rechaza', async ({ request }) => {
    const base = { variantId: variante, branchId: suc }
    let r = await llamar(request, 'POST', '/inventory/adjustments', keyGestion, { ...base, change: -3, reasonCode: 'LOST', note: 'No apareció' }, `e2e-${sufijo}-2`)
    expect(r.status).toBe(201)
    expect(r.json.level.onHand).toBe(5)

    r = await llamar(request, 'POST', '/inventory/adjustments', keyGestion, { ...base, change: -1 }, `e2e-${sufijo}-3`)
    expect(r.status).toBe(400)
    r = await llamar(request, 'POST', '/inventory/adjustments', keyGestion, { ...base, change: -1, reasonCode: 'FOUND' }, `e2e-${sufijo}-4`)
    expect(r.status).toBe(400)
    r = await llamar(request, 'POST', '/inventory/adjustments', keyGestion, { ...base, change: -50, reasonCode: 'LOST' }, `e2e-${sufijo}-5`)
    expect(r.status).toBe(400)
    expect(r.json.error.reason).toBe('insufficient_stock')
    r = await llamar(request, 'POST', '/inventory/adjustments', keyGestion, { ...base, change: 0, reasonCode: 'LOST' }, `e2e-${sufijo}-6`)
    expect(r.status).toBe(400)
  })

  test('una clave de solo lectura lee pero no mueve; un costo en el cuerpo se rechaza', async ({ request }) => {
    const cuerpo = { variantId: variante, branchId: suc, quantity: 1 }
    let r = await llamar(request, 'POST', '/inventory/receipts', keyLectura, cuerpo, `e2e-${sufijo}-7`)
    expect(r.status).toBe(403)
    expect(r.json.error.code).toBe('INSUFFICIENT_SCOPE')

    r = await llamar(request, 'POST', '/inventory/receipts', keyGestion, { ...cuerpo, cost: 3 }, `e2e-${sufijo}-8`)
    expect(r.status).toBe(400)

    r = await llamar(request, 'GET', `/inventory/levels?variantId=${variante}`, keyLectura)
    expect(r.status).toBe(200)
    expect(r.json.levels).toHaveLength(1)
    expect(r.json.levels[0]).toEqual(expect.objectContaining({ variantId: variante, branchId: suc, onHand: 5, available: 5 }))
    expect(r.texto.toLowerCase()).not.toContain('cost')
  })

  test('movimientos: el libro trae la entrada y el ajuste, atribuidos a la clave, paginado y sin costos', async ({ request }) => {
    let r = await llamar(request, 'GET', `/inventory/movements?variantId=${variante}&branchId=${suc}&limit=50`, keyLectura)
    expect(r.status).toBe(200)
    expect(r.json.movements.map((m) => m.type).sort()).toEqual(['ADJUSTMENT', 'PURCHASE'])
    expect(r.json.movements.every((m) => m.reference?.type === 'API')).toBe(true)
    expect(r.texto.toLowerCase()).not.toContain('cost')

    r = await llamar(request, 'GET', `/inventory/movements?variantId=${variante}&limit=1`, keyLectura)
    expect(r.json.movements).toHaveLength(1)
    expect(r.json.page.nextCursor).toBeTruthy()
    const sig = await llamar(request, 'GET', `/inventory/movements?variantId=${variante}&limit=1&cursor=${encodeURIComponent(r.json.page.nextCursor ?? '')}`, keyLectura)
    expect(sig.json.movements).toHaveLength(1)
  })

  test('aislamiento: la clave de otra empresa no ve ni mueve estas existencias, y sin la capacidad responde catalog_not_enabled', async ({ request }) => {
    const ajena = await llamar(request, 'GET', `/inventory/levels?variantId=${variante}`, keyB)
    expect(ajena.status).toBe(404)
    expect(ajena.json.error.reason).toBe('catalog_not_enabled')
    const mover = await llamar(request, 'POST', '/inventory/receipts', keyB, { variantId: variante, branchId: suc, quantity: 1 }, `e2e-${sufijo}-9`)
    expect(mover.status).toBe(404)

    const otra = await llamar(request, 'GET', `/inventory/levels?companyId=${b.id}`, keyLectura)
    expect(otra.status).toBeGreaterThanOrEqual(400)
    expect(otra.status).toBeLessThan(500)
    const sinClave = await llamar(request, 'GET', '/inventory/levels', null)
    expect(sinClave.status).toBeGreaterThanOrEqual(400)
    expect(sinClave.status).toBeLessThan(600)
  })
})
