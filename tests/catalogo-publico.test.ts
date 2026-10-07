import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  RUTA_OFERTAS_MEMBEGO,
  aDetallePublico,
  aResumenPublico,
  normalizarBusqueda,
  normalizarPagina,
  precioDesde,
  variantesPublicas,
} from '../src/modules/catalog/publico-nucleo'
import { RUTA_OFERTAS_PUBLICAS } from '../src/modules/supply-v2/core/catalogo'

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

// ── Fase 3: «agotado» a partir del inventario ────────────────────────────────

const nivel = (onHand: number, reserved = 0, activa = true) => ({ onHand, reserved, location: { activa } })
const conInventario = (niveles: ReturnType<typeof nivel>[], status: 'ACTIVE' | 'OUT_OF_STOCK' = 'ACTIVE') =>
  variante('v', 100, status, { inventoryLevels: niveles })

test('un producto que controla inventario se ve agotado si no hay nada DISPONIBLE (existencia − apartado) en una sucursal abierta', () => {
  const disp = (niveles: ReturnType<typeof nivel>[]) => variantesPublicas([conInventario(niveles)], false, true)[0].available
  assert.equal(disp([nivel(5)]), true)
  assert.equal(disp([nivel(5, 4)]), true, 'queda una unidad sin apartar')
  assert.equal(disp([nivel(5, 5)]), false, 'todo está apartado por pedidos')
  assert.equal(disp([nivel(0)]), false)
  assert.equal(disp([]), false, 'controla inventario y no hay ni una fila de saldo: no hay existencias')
  assert.equal(disp([nivel(0), nivel(3)]), true, 'basta con que una sucursal tenga')
  assert.equal(disp([nivel(9, 0, false)]), false, 'una sucursal cerrada no despacha')
})

test('sin controlar inventario, o sin datos de inventario, nada cambia (la variante manda por su estado)', () => {
  assert.equal(variantesPublicas([conInventario([nivel(0)])], false, false)[0].available, true)
  assert.equal(variantesPublicas([variante('a', 1, 'ACTIVE')], false, true)[0].available, false, 'una fila sin saldos de un producto controlado es agotado')
  assert.equal(variantesPublicas([variante('a', 1, 'ACTIVE')])[0].available, true)
})

test('el estado manual OUT_OF_STOCK sigue mandando aunque haya existencias', () => {
  assert.equal(variantesPublicas([conInventario([nivel(50)], 'OUT_OF_STOCK')], false, true)[0].available, false)
})

test('aResumenPublico: solo un ítem de la EMPRESA con la capacidad trackInventory se evalúa por existencias; el «desde» se corrige', () => {
  const base = { ...fila([conInventario([nivel(0)])]), type: 'PHYSICAL_PRODUCT' as const, capabilities: { trackInventory: true } }
  assert.equal(aResumenPublico(base)?.priceFrom, '100.00')
  assert.equal(aDetallePublico(base)?.variants[0].available, false)
  const sinControl = { ...base, capabilities: { trackInventory: false } }
  assert.equal(aDetallePublico(sinControl)?.variants[0].available, true)
  // Un ítem puente (Supply) no usa el inventario de la casa: manda su oferta.
  const puente = { ...base, source: 'SUPPLY' as const, supplyOffer: { slug: 'o', status: 'ACTIVE' } }
  assert.equal(aDetallePublico(puente)?.variants[0].available, true)
})

test('lo que sale al público NO incluye cantidades ni niveles de inventario', () => {
  const base = { ...fila([conInventario([nivel(7, 2)])]), type: 'PHYSICAL_PRODUCT' as const, capabilities: { trackInventory: true } }
  const json = JSON.stringify(aDetallePublico(base))
  assert.doesNotMatch(json, /onHand|reserved|inventoryLevels|trackInventory/)
})

test('la ruta de las ofertas de Membego que repite el catálogo es la de Supply (el catálogo no importa de Supply)', () => {
  assert.equal(RUTA_OFERTAS_MEMBEGO, RUTA_OFERTAS_PUBLICAS)
  for (const f of ['src/components/catalogo/TarjetaCatalogoPublica.tsx', 'src/app/(public)/empresas/[companySlug]/catalogo/[itemSlug]/page.tsx']) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), /modules\/supply-v2/, `${f} no importa de Supply`)
  }
})

test('la ficha pública de un ítem se lee por el caché con el tag del marketplace (si no, el panel no la invalida)', () => {
  const cached = readFileSync('src/modules/marketplace/cached.ts', 'utf8')
  const i = cached.indexOf('export async function getItemCatalogoPublico')
  assert.ok(i > 0)
  assert.match(cached.slice(i, i + 400), /tags: \[MARKETPLACE_TAG\]/)
  const pagina = readFileSync('src/app/(public)/empresas/[companySlug]/catalogo/[itemSlug]/page.tsx', 'utf8')
  assert.match(pagina, /getItemCatalogoPublico\(/)
  assert.doesNotMatch(pagina, /[^t]itemCatalogoPublico\(/, 'la página no llama a la lectura directa')
})
