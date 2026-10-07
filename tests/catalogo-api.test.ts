import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { INVENTARIO_API, SCOPES, SCOPES_POR_CAPABILITY, CAPABILITIES } from '@membego/contracts'
import { catalogItemDTO, catalogVariantDTO } from '../src/modules/plataforma/catalogo-dto'
import { itemDeCuerpo, leerFiltros, varianteDeCuerpo } from '../src/modules/plataforma/catalogo'

/**
 * PLATAFORMA · catálogo unificado en la API v1 (F1.3).
 *
 * El COSTO es el dato a vigilar: lo ve la clave de la propia empresa y jamás un
 * satélite. Y las escrituras solo arman borradores.
 */

const dec = (n: number) => ({ toFixed: (d: number) => n.toFixed(d) })
const v = { id: 'v1', catalogItemId: 'i1', name: 'M', sku: 'S-1', barcode: null, price: dec(10), cost: dec(4), compareAtPrice: null, attributes: { talla: 'M', n: 3 }, isDefault: false, status: 'ACTIVE' as const }

test('el costo sale hacia la clave de la empresa y NO hacia un satélite', () => {
  assert.equal(catalogVariantDTO(v, true).cost, '4.00')
  assert.ok(!('cost' in catalogVariantDTO(v, false)), 'un satélite no debe ni ver la clave «cost»')
  const item = {
    id: 'i1', name: 'X', slug: 'x', description: null, type: 'SERVICE' as const, status: 'DRAFT' as const, currency: 'DOP',
    source: 'MERCHANT' as const, capabilities: { availablePOS: true, raro: 'no' }, publishedAt: null, createdAt: new Date(0),
    variants: [v], images: [{ path: 'a/b.jpg' }],
  }
  assert.ok(!JSON.stringify(catalogItemDTO(item, false)).includes('"cost"'))
  assert.deepEqual(catalogItemDTO(item, true).capabilities, { availablePOS: true }, 'solo booleanos')
  assert.deepEqual(catalogVariantDTO(v, true).attributes, { talla: 'M' }, 'solo texto')
})

test('el contrato: dos capabilities nuevas con sus scopes, y manage incluye read', () => {
  assert.ok((CAPABILITIES as readonly string[]).includes('CATALOG_LOOKUP'))
  assert.deepEqual(SCOPES_POR_CAPABILITY.CATALOG_LOOKUP, ['catalog:read'])
  assert.deepEqual(SCOPES_POR_CAPABILITY.CATALOG_MANAGE, ['catalog:read', 'catalog:manage'])
  assert.ok(SCOPES.includes('catalog:read') && SCOPES.includes('catalog:manage'))
})

test('el inventario documenta los 5 recursos, con el principal correcto y sin idempotencia falsa', () => {
  const r = (m: string, ruta: string) => INVENTARIO_API.find((x) => x.metodo === m && x.ruta === ruta)
  for (const [m, ruta, scope, principal] of [
    ['GET', '/catalog-items', 'catalog:read', 'sistema-o-empresa'],
    ['GET', '/catalog-items/{id}', 'catalog:read', 'sistema-o-empresa'],
    ['POST', '/catalog-items', 'catalog:manage', 'empresa'],
    ['GET', '/catalog-variants', 'catalog:read', 'sistema-o-empresa'],
    ['POST', '/catalog-variants', 'catalog:manage', 'empresa'],
  ] as const) {
    const e = r(m, ruta)
    assert.ok(e, `falta ${m} ${ruta}`)
    assert.equal(e.scope, scope)
    assert.equal(e.principal, principal)
    assert.ok(!e.idempotente, 'la idempotencia es de satélites: no se declara aquí')
  }
  assert.equal(r('GET', '/catalog-items')?.paginado, true)
  assert.equal(r('GET', '/catalog-variants')?.paginado, true)
})

// ── Las rutas, leídas ────────────────────────────────────────────────────────

const ruta = (p: string) => readFileSync(`src/app/api/platform/v1/${p}/route.ts`, 'utf8')

test('GET: scope de lectura, abiertas a clave de empresa, capacidad comprobada y la empresa sale de la clave', () => {
  for (const p of ['catalog-items', 'catalog-items/[id]', 'catalog-variants']) {
    const s = ruta(p)
    assert.match(s, /autenticarSobreEmpresa\(req, 'catalog:read',/, p)
    assert.match(s, /claveDeEmpresa: true/, p)
    assert.match(s, /catalogoHabilitado\(companyId\)/, `${p} no comprueba la capacidad`)
    assert.ok(s.indexOf('catalogoHabilitado(') < s.indexOf('respuestaApi('), p)
    assert.match(s, /ctx\.principal\.tipo === 'empresa'/, `${p} no decide el costo por principal`)
  }
})

test('POST: scope de gestión, SOLO clave de empresa, capacidad y cuerpo comprobados ANTES de escribir', () => {
  for (const p of ['catalog-items', 'catalog-variants']) {
    const s = ruta(p)
    const post = s.slice(s.indexOf('export async function POST'))
    assert.match(post, /autenticarSobreEmpresa\(req, 'catalog:manage', null,/, p)
    const iPrincipal = post.indexOf("ctx.principal.tipo !== 'empresa'")
    const iCapacidad = post.indexOf('catalogoHabilitado(')
    const iEscribe = Math.max(post.indexOf('crearItemEnBorrador('), post.indexOf('agregarVarianteABorrador('))
    assert.ok(iPrincipal > 0 && iCapacidad > iPrincipal && iEscribe > iCapacidad, `${p}: el orden de guardias cambió`)
    assert.match(post, /status: 201/)
    assert.doesNotMatch(post, /exigeEmpresa\(/, 'exigeEmpresa LANZA con un satélite (500); aquí se contesta un error de API')
  }
})

test('las escrituras de la API solo arman BORRADORES y no publican', () => {
  const l = readFileSync('src/modules/plataforma/catalogo.ts', 'utf8')
  assert.match(l, /item\.status !== 'DRAFT'/)
  assert.doesNotMatch(l, /cambiarEstadoItemEnTx|status: 'ACTIVE'|publishedAt/, 'la API no debe publicar')
  assert.match(l, /userAgent: 'platform-api'/, 'el rastro de auditoría debe decir que vino de la API')
})

test('el catálogo de la API nunca importa de supply-v2', () => {
  for (const f of ['src/modules/plataforma/catalogo.ts', 'src/modules/plataforma/catalogo-dto.ts']) {
    const imports = [...readFileSync(f, 'utf8').matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])
    for (const o of imports) assert.doesNotMatch(o, /supply/i, `${f} importa ${o}`)
  }
})

// ── Entrada de la red ────────────────────────────────────────────────────────

test('el cuerpo de la API solo pasa campos conocidos; lo demás no llega al dominio', () => {
  const i = itemDeCuerpo({ name: 'X', type: 'SERVICE', price: 1, companyId: 'ajeno', status: 'ACTIVE', source: 'SUPPLY', id: 'forzado' })!
  assert.ok(!('companyId' in i) && !('status' in i) && !('source' in i) && !('id' in i))
  assert.equal(itemDeCuerpo('texto'), null)
  assert.equal(itemDeCuerpo(null), null)
  assert.equal(itemDeCuerpo([1]), null)
  const vs = itemDeCuerpo({ name: 'X', type: 'SERVICE', variants: [{ name: 'A', price: 1 }, 'basura', null] })!
  assert.equal(vs.variants?.length, 1, 'los elementos que no son objetos se descartan')
  const vr = varianteDeCuerpo({ name: 'A', price: 1, isDefault: true, companyId: 'x' })!
  assert.ok(!('isDefault' in vr) && !('companyId' in vr))
})

test('filtros de la lista: solo valores conocidos', () => {
  assert.deepEqual(leerFiltros(new URLSearchParams('status=ACTIVE&type=SERVICE')), { ok: true, status: 'ACTIVE', type: 'SERVICE' })
  assert.deepEqual(leerFiltros(new URLSearchParams('')), { ok: true })
  assert.equal(leerFiltros(new URLSearchParams('status=ROTO')).ok, false)
  assert.equal(leerFiltros(new URLSearchParams('type=x')).ok, false)
})
