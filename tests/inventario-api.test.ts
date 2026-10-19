import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CAPABILITIES, INVENTARIO_API, SCOPES, SCOPES_POR_CAPABILITY } from '@membego/contracts'
import { InventarioError } from '../src/modules/inventory/errores'
import { ajusteDeCuerpo, claveDeCabecera, clasificarErrorDeInventario, entradaDeCuerpo, lotesDeCuerpo, lotesDeSalidaDeCuerpo, movimientoDTO, nivelDTO } from '../src/modules/plataforma/inventario-dto'

/**
 * PLATAFORMA · inventario en la API v1 (INV-5e).
 *
 * Lo que se vigila: que NADA de costos cruce la frontera, que escribir sea solo de la clave de empresa y con `Idempotency-Key`, que el
 * orden de guardias no cambie (autenticar → principal → capacidad → cabecera → cuerpo → escribir) y que el contrato diga lo que hacen
 * las rutas. El comportamiento contra la base está en `tests/postgres/inventory-api.db.test.ts`.
 */

const nivel = { id: 'n1', onHand: 10, reserved: 3, damaged: 1, lowStockThreshold: 2, locationId: 's1', location: { nombre: 'Principal' }, variant: { id: 'v1', sku: 'S-1', name: 'M', item: { name: 'Camiseta' }, cost: '4.00', averageCost: '4.5' } }

test('el nivel sale con lo vendible ya calculado y sin costos', () => {
  const dto = nivelDTO(nivel)
  assert.equal(dto.available, 7)
  assert.equal(dto.branchName, 'Principal')
  assert.ok(!JSON.stringify(dto).toLowerCase().includes('cost'), 'ni «cost» ni «averageCost» cruzan la frontera')
  assert.deepEqual(Object.keys(dto).sort(), ['available', 'branchId', 'branchName', 'damaged', 'id', 'itemName', 'lowStockThreshold', 'onHand', 'reserved', 'sku', 'variantId', 'variantName'])
})

test('el movimiento sale sin costo unitario y con su referencia', () => {
  const dto = movimientoDTO({
    id: 'm1', type: 'PURCHASE', sourceBucket: null, destinationBucket: 'AVAILABLE', quantity: 5, previousOnHand: 1, newOnHand: 6, reasonCode: null, reason: 'x', referenceType: 'API', referenceId: 'k1',
    createdAt: new Date('2030-01-01T00:00:00Z'), level: { catalogVariantId: 'v1', locationId: 's1' }, unitCost: '3.00',
  } as Parameters<typeof movimientoDTO>[0])
  assert.deepEqual(dto.reference, { type: 'API', id: 'k1' })
  assert.equal(dto.createdAt, '2030-01-01T00:00:00.000Z')
  assert.ok(!JSON.stringify(dto).toLowerCase().includes('cost'))
  assert.equal(movimientoDTO({ ...({} as Parameters<typeof movimientoDTO>[0]), referenceType: 'API', referenceId: null, createdAt: new Date(0), level: { catalogVariantId: 'v', locationId: 's' } }).reference, null)
})

test('la Idempotency-Key: obligatoria, imprimible, acotada y con prefijo propio', () => {
  assert.deepEqual(claveDeCabecera('abc-123'), { ok: true, clave: 'api:abc-123' })
  assert.deepEqual(claveDeCabecera('  trim  '), { ok: true, clave: 'api:trim' })
  for (const mala of [null, '', '   ', 'con espacio', 'ta\tb', 'ñandú', 'x'.repeat(101)]) assert.deepEqual(claveDeCabecera(mala), { ok: false }, String(mala))
  assert.deepEqual(claveDeCabecera('x'.repeat(100)).ok, true)
})

test('el cuerpo de una entrada: solo campos conocidos, y un costo se rechaza en vez de ignorarse', () => {
  const e = entradaDeCuerpo({ variantId: 'v', branchId: 's', quantity: 3, note: 'n', lots: [{ code: 'L1', expiresOn: '2030-01-01', quantity: 3 }], companyId: 'ajeno', unitCost: 9 })!
  assert.equal(e.varianteId, 'v')
  assert.equal(e.cantidad, 3)
  assert.deepEqual(e.lotes, [{ codigo: 'L1', vencimiento: '2030-01-01', cantidad: 3 }])
  assert.ok(!('companyId' in e))
  assert.equal(entradaDeCuerpo({ variantId: 'v', branchId: 's', quantity: 1, cost: 5 }), null, 'un cost explícito no se traga en silencio')
  for (const malo of [null, 'x', [], {}, { variantId: 'v' }, { branchId: 's' }, { variantId: '', branchId: 's' }, { variantId: 1, branchId: 's' }]) assert.equal(entradaDeCuerpo(malo), null, JSON.stringify(malo))
})

test('el cuerpo de un ajuste exige el código de motivo', () => {
  const a = ajusteDeCuerpo({ variantId: 'v', branchId: 's', change: -2, reasonCode: ' LOST ', note: 'n', lotsOut: [{ lotId: 'l1', quantity: 2 }] })!
  assert.equal(a.cambio, -2)
  assert.equal(a.motivoCodigo, 'LOST')
  assert.deepEqual(a.lotesSalida, [{ loteId: 'l1', cantidad: 2 }])
  assert.equal(ajusteDeCuerpo({ variantId: 'v', branchId: 's', change: -2 }), null)
  assert.equal(ajusteDeCuerpo({ variantId: 'v', branchId: 's', change: -2, reasonCode: '  ' }), null)
  assert.equal(ajusteDeCuerpo({ variantId: 'v', branchId: 's', change: -2, reasonCode: 5 }), null)
})

test('los lotes se traducen sin inventar nada y lo raro se pasa para que el servicio lo rechace', () => {
  assert.equal(lotesDeCuerpo(undefined), undefined)
  assert.equal(lotesDeCuerpo(null), undefined)
  assert.equal(lotesDeCuerpo('x'), 'x')
  assert.deepEqual(lotesDeCuerpo([{ code: 'A', quantity: 1 }, 7]), [{ codigo: 'A', vencimiento: null, cantidad: 1 }, 7])
  assert.deepEqual(lotesDeSalidaDeCuerpo([{ lotId: 'x', quantity: 2 }]), [{ loteId: 'x', cantidad: 2 }])
})

test('los errores del dominio se traducen; lo desconocido no se disfraza', () => {
  assert.equal(clasificarErrorDeInventario(new InventarioError('VARIANTE_NO_ENCONTRADA', 'x'))?.codigo, 'NOT_FOUND')
  assert.equal(clasificarErrorDeInventario(new InventarioError('SUCURSAL_NO_ENCONTRADA', 'x'))?.codigo, 'NOT_FOUND')
  assert.equal(clasificarErrorDeInventario(new InventarioError('STOCK_INSUFICIENTE', 'x'))?.reason, 'insufficient_stock')
  assert.equal(clasificarErrorDeInventario(new InventarioError('CLAVE_REUTILIZADA', 'x'))?.reason, 'idempotency_key_reused')
  assert.equal(clasificarErrorDeInventario(new InventarioError('CANTIDAD_INVALIDA', 'x'))?.codigo, 'INVALID_REQUEST')
  assert.equal(clasificarErrorDeInventario(new Error('boom')), null)
  assert.equal(clasificarErrorDeInventario('texto'), null)
})

test('el contrato: dos capabilities, y manage incluye read', () => {
  assert.ok((CAPABILITIES as readonly string[]).includes('INVENTORY_LOOKUP') && (CAPABILITIES as readonly string[]).includes('INVENTORY_MANAGE'))
  assert.deepEqual(SCOPES_POR_CAPABILITY.INVENTORY_LOOKUP, ['inventory:read'])
  assert.deepEqual(SCOPES_POR_CAPABILITY.INVENTORY_MANAGE, ['inventory:read', 'inventory:manage'])
  assert.ok(SCOPES.includes('inventory:read') && SCOPES.includes('inventory:manage'))
})

test('el inventario documenta los 4 recursos de inventario con su principal, scope e idempotencia', () => {
  const r = (m: string, ruta: string) => INVENTARIO_API.find((x) => x.metodo === m && x.ruta === ruta)
  for (const [m, ruta, scope, principal, idem] of [
    ['GET', '/inventory/levels', 'inventory:read', 'sistema-o-empresa', false],
    ['GET', '/inventory/movements', 'inventory:read', 'sistema-o-empresa', false],
    ['POST', '/inventory/receipts', 'inventory:manage', 'empresa', true],
    ['POST', '/inventory/adjustments', 'inventory:manage', 'empresa', true],
  ] as const) {
    const e = r(m, ruta)
    assert.ok(e, `falta ${m} ${ruta}`)
    assert.equal(e.scope, scope)
    assert.equal(e.principal, principal)
    assert.equal(Boolean(e.idempotente), idem)
  }
  assert.equal(r('GET', '/inventory/levels')?.paginado, true)
  assert.equal(r('GET', '/inventory/movements')?.paginado, true)
})

// ── Las rutas, leídas ────────────────────────────────────────────────────────

const ruta = (p: string) => readFileSync(`src/app/api/platform/v1/inventory/${p}/route.ts`, 'utf8')

test('GET: scope de lectura, abiertas a clave de empresa, capacidad comprobada antes de leer', () => {
  for (const p of ['levels', 'movements']) {
    const s = ruta(p)
    assert.match(s, /autenticarSobreEmpresa\(req, 'inventory:read',/, p)
    assert.match(s, /claveDeEmpresa: true/, p)
    assert.match(s, /catalogoHabilitado\(companyId\)/, `${p} no comprueba la capacidad`)
    assert.ok(s.indexOf('catalogoHabilitado(') < s.indexOf('await listar'), p)
    assert.doesNotMatch(s, /export async function (POST|PUT|PATCH|DELETE)/, `${p} no debe escribir`)
  }
})

test('POST: scope de gestión, SOLO clave de empresa, capacidad, cabecera y cuerpo comprobados ANTES de escribir', () => {
  for (const p of ['receipts', 'adjustments']) {
    const s = ruta(p)
    assert.match(s, /autenticarSobreEmpresa\(req, 'inventory:manage', null,/, p)
    const orden = ["ctx.principal.tipo !== 'empresa'", 'catalogoHabilitado(', 'claveDeCabecera(', 'DeCuerpo(', 'PorApi('].map((t) => s.indexOf(t))
    assert.ok(orden.every((i) => i > 0) && orden.every((i, k) => k === 0 || i > orden[k - 1]), `${p}: el orden de guardias cambió (${orden})`)
    assert.match(s, /IDEMPOTENCY_KEY_REQUIRED/, p)
    assert.match(s, /status: r\.repeated \? 200 : 201/, p)
    assert.doesNotMatch(s, /exigeEmpresa\(/, 'exigeEmpresa LANZA con un satélite (500); aquí se contesta un error de API')
  }
})

test('la API mueve existencias por el MISMO servicio del panel, atribuida a la clave, y sin costos', () => {
  const m = readFileSync('src/modules/plataforma/inventario.ts', 'utf8')
  assert.match(m, /from '@\/modules\/inventory\/service'/)
  assert.match(m, /referencia: \{ tipo: 'API', id: clave\.id \}/)
  assert.match(m, /userAgent: 'platform-api'/)
  assert.match(m, /exigirMotivoCodificado: true/, 'el ajuste por API exige el código de motivo')
  assert.doesNotMatch(m, /costo:|costoEntrada|unitCost|averageCost/, 'la API no lee ni escribe costos')
  assert.doesNotMatch(readFileSync('src/modules/plataforma/inventario-dto.ts', 'utf8'), /unitCost: f\.|averageCost: f\./)
  for (const f of ['src/modules/plataforma/inventario.ts', 'src/modules/plataforma/inventario-dto.ts']) {
    for (const o of [...readFileSync(f, 'utf8').matchAll(/from\s+'([^']+)'/g)].map((x) => x[1])) assert.doesNotMatch(o, /supply/i, `${f} importa ${o}`)
  }
})

test('el panel de claves ofrece los dos scopes y la acción los admite como excepciones nombradas', () => {
  const panel = readFileSync('src/components/connect/ClavesApiPanel.tsx', 'utf8')
  assert.match(panel, /valor: 'inventory:read'/)
  assert.match(panel, /valor: 'inventory:manage'/)
  assert.match(readFileSync('src/modules/connect/adminActions.ts', 'utf8'), /SCOPES_DE_ADMINISTRACION = \[[^\]]*'inventory:manage'/)
})
