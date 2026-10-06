import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  aDetallePublico,
  aResumenPublico,
  normalizarBusqueda,
  normalizarPagina,
  precioDesde,
  variantesPublicas,
} from '../src/modules/catalog/publico-nucleo'

/**
 * COMMERCE CORE · catálogo — lo que ve el público (F1.3). Lo que no puede salir
 * jamás (costo, SKU, código de barras, capacidades internas, rutas de Storage)
 * se prueba aquí como lista blanca, y las condiciones de visibilidad se leen del
 * código; el comportamiento contra la base está en
 * `tests/postgres/catalog-publico.db.test.ts`.
 */

const dec = (n: number) => ({ toFixed: (d: number) => n.toFixed(d), toNumber: () => n })
const variante = (id: string, price: number, status: 'ACTIVE' | 'OUT_OF_STOCK' | 'DISCONTINUED', extra: object = {}) => ({
  id, name: `V ${id}`, price: dec(price), compareAtPrice: null, attributes: {}, status, ...extra,
})
const fila = (variants: ReturnType<typeof variante>[]) => ({
  id: 'i1', slug: 'lavado', name: 'Lavado', description: 'Texto', type: 'SERVICE' as const, currency: 'DOP',
  company: { slug: 'car-town', name: 'Car Town' },
  variants,
  images: [{ path: 'emp/catalogo/i1/a.jpg' }],
  categories: [{ category: { name: 'Lavados', slug: 'lavados' } }],
  source: 'MERCHANT' as const,
})

test('la variante descontinuada no existe para el público; la agotada se enseña como agotada', () => {
  const vs = variantesPublicas([variante('a', 10, 'ACTIVE'), variante('b', 5, 'OUT_OF_STOCK'), variante('c', 1, 'DISCONTINUED')])
  assert.deepEqual(vs.map((v) => [v.id, v.available]), [['a', true], ['b', false]])
})

test('el precio anterior solo sale si de verdad es mayor que el actual', () => {
  const [normal, falso, igual] = variantesPublicas([
    variante('a', 100, 'ACTIVE', { compareAtPrice: dec(150) }),
    variante('b', 100, 'ACTIVE', { compareAtPrice: dec(90) }),
    variante('c', 100, 'ACTIVE', { compareAtPrice: dec(100) }),
  ])
  assert.equal(normal.compareAtPrice, '150.00')
  assert.equal(falso.compareAtPrice, null)
  assert.equal(igual.compareAtPrice, null)
})

test('«desde»: el menor precio entre las disponibles; si ninguna lo está, entre las visibles', () => {
  assert.equal(precioDesde(variantesPublicas([variante('a', 900, 'ACTIVE'), variante('b', 300, 'ACTIVE'), variante('c', 10, 'OUT_OF_STOCK')])), '300.00')
  assert.equal(precioDesde(variantesPublicas([variante('a', 900, 'OUT_OF_STOCK'), variante('b', 300, 'OUT_OF_STOCK')])), '300.00')
  assert.equal(precioDesde([]), null)
})

test('un ítem sin ninguna variante visible no existe para el público', () => {
  assert.equal(aResumenPublico(fila([variante('c', 1, 'DISCONTINUED')])), null)
  assert.equal(aDetallePublico(fila([])), null)
})

test('LISTA BLANCA: ni el resumen ni el detalle llevan costo, SKU, código de barras, capacidades ni rutas', () => {
  const f = fila([variante('a', 10, 'ACTIVE', { cost: dec(3), sku: 'SKU-1', barcode: '123', isDefault: true, catalogItemId: 'x' })])
  const resumen = aResumenPublico({ ...f, capabilities: { availablePOS: true }, companyId: 'secreto', source: 'MERCHANT' } as never)!
  const detalle = aDetallePublico({ ...f, capabilities: { availablePOS: true }, companyId: 'secreto' } as never)!
  const claves = (o: unknown): string[] => {
    if (Array.isArray(o)) return o.flatMap(claves)
    if (o && typeof o === 'object') return Object.entries(o).flatMap(([k, v]) => [k, ...claves(v)])
    return []
  }
  const todas = [...claves(resumen), ...claves(detalle)]
  for (const prohibida of ['cost', 'sku', 'barcode', 'capabilities', 'companyId', 'isDefault', 'catalogItemId', 'path', 'source', 'position']) {
    assert.ok(!todas.includes(prohibida), `el público ve «${prohibida}»`)
  }
  const texto = JSON.stringify([resumen, detalle])
  assert.ok(!texto.includes('SKU-1') && !texto.includes('secreto'), 'un valor interno se coló por otro campo')
})

test('la imagen pública es una URL del bucket, no la ruta interna', () => {
  const r = aResumenPublico(fila([variante('a', 10, 'ACTIVE')]))!
  const antes = process.env.NEXT_PUBLIC_SUPABASE_URL
  // sin configuración no se inventa una URL
  if (!antes) assert.equal(r.imageUrl, null)
  else assert.match(r.imageUrl ?? '', /\/storage\/v1\/object\/public\/promociones\/emp\/catalogo\/i1\/a\.jpg$/)
})

test('búsqueda y página de la URL: texto recortado, entero acotado, nada raro', () => {
  assert.equal(normalizarBusqueda('  pizza  '), 'pizza')
  assert.equal(normalizarBusqueda('x'.repeat(200))?.length, 80)
  assert.equal(normalizarBusqueda(''), undefined)
  assert.equal(normalizarBusqueda(['a'] as never), undefined)
  assert.equal(normalizarPagina('3'), 3)
  assert.equal(normalizarPagina('-4'), 0)
  assert.equal(normalizarPagina('abc'), 0)
  assert.equal(normalizarPagina('99999'), 200)
  assert.equal(normalizarPagina(undefined), 0)
})

// ── Condiciones de visibilidad, leídas del código ────────────────────────────

const publico = readFileSync('src/modules/catalog/publico.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

test('todo lo público exige empresa publicada/activa/no demo, ítem ACTIVO y visible en marketplace', () => {
  assert.match(publico, /EMPRESA_VISIBLE = \{ isPublished: true, isActive: true, esDemo: false \}/)
  assert.match(publico, /status: 'ACTIVE'/)
  assert.match(publico, /capabilities: \{ path: \['availableMarketplace'\], equals: true \}/)
  assert.match(publico, /variants: \{ some: \{ status: \{ in: \[\.\.\.ESTADOS_VARIANTE_VISIBLES\] \} \} \}/)
})

test('las tres lecturas públicas comprueban la capacidad de la empresa', () => {
  for (const fn of ['catalogoPublicoDeEmpresa', 'itemCatalogoPublico', 'catalogoPublicoGlobal']) {
    const desde = publico.indexOf(`export async function ${fn}`)
    const cuerpo = publico.slice(desde, publico.indexOf('\n}\n', desde))
    assert.match(cuerpo, /empresaPublicaCatalogo\(/, `${fn} no comprueba la capacidad`)
    assert.match(cuerpo, /itemVisible\(/, `${fn} no filtra por ítem visible`)
    assert.match(cuerpo, /EMPRESA_VISIBLE/, `${fn} no filtra por empresa visible`)
  }
  assert.match(publico, /tieneCapacidad\(companyId, 'CATALOGO_UNIFICADO'\)/)
})

test('el descubrimiento filtra por las empresas permitidas ANTES de paginar (sin huecos ni ítems de empresas apagadas)', () => {
  const desde = publico.indexOf('export async function catalogoPublicoGlobal')
  const cuerpo = publico.slice(desde)
  assert.ok(cuerpo.indexOf('permitidas.push') < cuerpo.indexOf('skip: pagina * limite'))
  assert.match(cuerpo, /companyId: \{ in: permitidas \}/)
})

test('el código público nunca pide el costo, el SKU ni el código de barras a la base', () => {
  for (const f of ['publico.ts', 'publico-nucleo.ts']) {
    const s = readFileSync(`src/modules/catalog/${f}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.doesNotMatch(s, /\bcost:|\.cost\b|\bsku:|\.sku\b|\bbarcode:|\.barcode\b/, `${f} toca un campo interno`)
  }
})

test('las páginas públicas: detalle da 404 uniforme, no usan el cliente global y el buscador tiene nombre accesible', () => {
  const detalle = readFileSync('src/app/(public)/empresas/[companySlug]/catalogo/[itemSlug]/page.tsx', 'utf8')
  assert.match(detalle, /if \(!item\) notFound\(\)/)
  assert.doesNotMatch(detalle, /\bprisma\./)
  const lista = readFileSync('src/app/(public)/catalogo/page.tsx', 'utf8')
  assert.match(lista, /aria-label="Buscar productos y servicios"/)
  assert.doesNotMatch(lista, /\bprisma\./)
})

test('el panel refresca la vitrina pública al mutar (tag del marketplace), no espera el TTL', () => {
  const a = readFileSync('src/modules/catalog/actions.ts', 'utf8')
  assert.match(a, /revalidateTag\(MARKETPLACE_TAG, 'max'\)/)
  assert.doesNotMatch(a, /revalidatePath\(RUTA\)\s*\n\s*return/, 'quedó una mutación que no refresca la vitrina')
})

// ── Ítems puente (Fase 2.5) ──────────────────────────────────────────────────

const filaPuente = (estadoOferta: string | null, vs = [variante('a', 650, 'ACTIVE')]) => ({
  ...fila(vs),
  source: 'SUPPLY' as const,
  supplyOffer: estadoOferta ? { slug: 'lavado-mbg-of-2026-000001', status: estadoOferta } : null,
})

test('un ítem puente sale con su origen y el slug de la oferta (la ruta de compra la arma la página)', () => {
  const r = aResumenPublico(filaPuente('ACTIVE'))
  assert.equal(r?.origen, 'SUPPLY')
  assert.equal(r?.ofertaSlug, 'lavado-mbg-of-2026-000001')
  const normal = aResumenPublico(fila([variante('a', 10, 'ACTIVE')]))
  assert.equal(normal?.origen, 'EMPRESA')
  assert.equal(normal?.ofertaSlug, null)
})

test('la oferta EN VIVO manda: agotada en Supply = agotada para el público aunque la copia diga ACTIVE', () => {
  const d = aDetallePublico(filaPuente('SOLD_OUT', [variante('a', 650, 'ACTIVE')]))
  assert.deepEqual(d?.variants.map((v) => v.available), [false])
  const viva = aDetallePublico(filaPuente('ACTIVE'))
  assert.deepEqual(viva?.variants.map((v) => v.available), [true])
})

test('un ítem puente sin su oferta no existe para el público', () => {
  assert.equal(aResumenPublico(filaPuente(null)), null)
  assert.equal(aDetallePublico(filaPuente(null)), null)
})

test('la lista blanca sigue sin filtrar la oferta de origen (solo su slug) ni el id de la oferta', () => {
  const json = JSON.stringify(aDetallePublico(filaPuente('ACTIVE')))
  assert.doesNotMatch(json, /supplyV2OfferId|supplyOffer|"status"/)
})

test('la visibilidad pública de un ítem puente cruza la oferta en vivo: estado, inicio y fin', () => {
  const cuerpo = publico.slice(publico.indexOf('function itemVisible'), publico.indexOf('const INCLUIR'))
  assert.match(cuerpo, /source: 'SUPPLY'/)
  assert.match(cuerpo, /status: \{ in: \['ACTIVE', 'SOLD_OUT'\] \}/)
  assert.match(cuerpo, /startsAt: \{ lte: ahora \}/)
  assert.match(cuerpo, /endsAt: null \}, \{ endsAt: \{ gt: ahora \}/)
  // Y no pisa el `OR` de la búsqueda de texto del descubrimiento.
  assert.match(cuerpo, /AND: \[/)
})
