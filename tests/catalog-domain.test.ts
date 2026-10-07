import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CAPACIDADES_POR_TIPO,
  TIPOS_ITEM,
  TRANSICIONES_ITEM,
  elegirSlugLibre,
  motivoParaNoPublicar,
  normalizarAtributos,
  normalizarCapacidades,
  normalizarMonto,
  puedeCambiarEstadoItem,
  slugDeNombre,
  validarItem,
  validarVariante,
} from '../src/modules/catalog/domain'

/**
 * COMMERCE CORE · catálogo — reglas puras. Sin base de datos: lo que aquí se
 * rompe es la regla; lo que respalda la base está en
 * `tests/postgres/catalog.db.test.ts`.
 */

// ── Ítem simple vs ítem con variantes ────────────────────────────────────────

test('un ítem sin variantes es SIMPLE: una sola variante «Default» con el precio del ítem', () => {
  const r = validarItem({ name: 'Lavado básico', type: 'SERVICE', price: 500 })
  assert.ok(r.ok)
  assert.equal(r.datos.simple, true)
  assert.equal(r.datos.variantes.length, 1)
  assert.equal(r.datos.variantes[0].name, 'Default')
  assert.equal(r.datos.variantes[0].price, '500.00')
  assert.equal(r.datos.variantes[0].sku, null, 'null = que el servicio genere el SKU')
})

test('un ítem simple SIN precio no se acepta: la variante automática no puede nacer sin precio', () => {
  const r = validarItem({ name: 'Lavado', type: 'SERVICE' })
  assert.ok(!r.ok)
  assert.match(r.error, /precio/i)
})

test('con variantes explícitas ya no es simple y cada una necesita nombre', () => {
  const r = validarItem({
    name: 'Camiseta',
    type: 'PHYSICAL_PRODUCT',
    variants: [
      { name: 'M', price: 800 },
      { name: 'L', price: 850, attributes: { talla: 'L' } },
    ],
  })
  assert.ok(r.ok)
  assert.equal(r.datos.simple, false)
  assert.equal(r.datos.variantes.length, 2)

  const sinNombre = validarItem({ name: 'Camiseta', type: 'PHYSICAL_PRODUCT', variants: [{ price: 800 }] })
  assert.ok(!sinNombre.ok)
  assert.match(sinNombre.error, /Variante 1/)
})

test('una sola variante explícita tampoco es «default»: la eligió la persona', () => {
  const r = validarItem({ name: 'Camiseta', type: 'PHYSICAL_PRODUCT', variants: [{ name: 'Única', price: 800 }] })
  assert.ok(r.ok)
  assert.equal(r.datos.simple, false)
})

test('SKUs, códigos de barras y nombres repetidos dentro del mismo envío se rechazan con un mensaje que lo dice', () => {
  const sku = validarItem({
    name: 'C', type: 'PHYSICAL_PRODUCT',
    variants: [{ name: 'M', price: 1, sku: 'ab-1' }, { name: 'L', price: 1, sku: 'AB-1' }],
  })
  assert.ok(!sku.ok)
  assert.match(sku.error, /SKU/)
  const barras = validarItem({
    name: 'C', type: 'PHYSICAL_PRODUCT',
    variants: [{ name: 'M', price: 1, barcode: '123' }, { name: 'L', price: 1, barcode: '123' }],
  })
  assert.ok(!barras.ok)
  const nombre = validarItem({
    name: 'C', type: 'PHYSICAL_PRODUCT',
    variants: [{ name: 'M', price: 1 }, { name: 'm', price: 2 }],
  })
  assert.ok(!nombre.ok)
})

test('validaciones del ítem: nombre, tipo, moneda, descripción', () => {
  assert.ok(!validarItem({ name: '   ', type: 'SERVICE', price: 1 }).ok)
  assert.ok(!validarItem({ name: 'x'.repeat(161), type: 'SERVICE', price: 1 }).ok)
  assert.ok(!validarItem({ name: 'x', type: 'COSA' as never, price: 1 }).ok)
  assert.ok(!validarItem({ name: 'x', type: 'SERVICE', price: 1, currency: 'PESO' }).ok)
  assert.ok(!validarItem({ name: 'x', type: 'SERVICE', price: 1, description: 'a'.repeat(4001) }).ok)
  const moneda = validarItem({ name: 'x', type: 'SERVICE', price: 1, currency: 'usd' })
  assert.ok(moneda.ok)
  assert.equal(moneda.datos.currency, 'USD')
  const defecto = validarItem({ name: 'x', type: 'SERVICE', price: 1 })
  assert.ok(defecto.ok)
  assert.equal(defecto.datos.currency, 'DOP')
})

test('la entrada viene del navegador: un campo que no es texto no lanza, se rechaza', () => {
  assert.doesNotThrow(() => validarItem({ name: 42 as never, type: 'SERVICE', price: 1 }))
  assert.ok(!validarItem({ name: 42 as never, type: 'SERVICE', price: 1 }).ok)
  assert.ok(!validarItem({ name: 'x', type: 'SERVICE', price: 1, variants: 'no' as never }).ok)
  assert.ok(!validarItem({ name: 'x', type: 'SERVICE', variants: [{ name: {} as never, price: 1 }] }).ok)
})

test('hay un tope de variantes por ítem', () => {
  const muchas = Array.from({ length: 101 }, (_, i) => ({ name: `V${i}`, price: 1 }))
  assert.ok(!validarItem({ name: 'x', type: 'PHYSICAL_PRODUCT', variants: muchas }).ok)
})

// ── Dinero ───────────────────────────────────────────────────────────────────

test('montos: a dos decimales, sin negativos, sin basura, con tope', () => {
  assert.equal(normalizarMonto(10), '10.00')
  assert.equal(normalizarMonto('10.5'), '10.50')
  assert.equal(normalizarMonto('10,5'), '10.50', 'coma decimal, como se escribe en español')
  assert.equal(normalizarMonto(0), '0.00', 'gratis es un precio válido')
  assert.equal(normalizarMonto(1.005), '1.01')
  assert.equal(normalizarMonto(-1), null)
  assert.equal(normalizarMonto('abc'), null)
  assert.equal(normalizarMonto(NaN), null)
  assert.equal(normalizarMonto(Infinity), null)
  assert.equal(normalizarMonto(1e12), null, 'no cabe en Decimal(12,2)')
  assert.equal(normalizarMonto(null), null)
  assert.equal(normalizarMonto(''), null)
  assert.equal(normalizarMonto({} as never), null)
})

test('el precio anterior no puede ser menor que el precio, y el costo no puede ser negativo', () => {
  assert.ok(!validarVariante({ price: 100, compareAtPrice: 90 }).ok)
  assert.ok(validarVariante({ price: 100, compareAtPrice: 100 }).ok)
  assert.ok(validarVariante({ price: 100, compareAtPrice: 150 }).ok)
  assert.ok(!validarVariante({ price: 100, cost: -1 }).ok)
  assert.ok(!validarVariante({ price: 'cien' }).ok)
  const sinCosto = validarVariante({ price: 100, cost: '' })
  assert.ok(sinCosto.ok)
  assert.equal(sinCosto.datos.cost, null)
})

test('SKU: mayúsculas, solo caracteres de caja, hasta 40; código de barras alfanumérico', () => {
  const ok = validarVariante({ price: 1, sku: ' lav-001 ' })
  assert.ok(ok.ok)
  assert.equal(ok.datos.sku, 'LAV-001')
  assert.ok(!validarVariante({ price: 1, sku: 'con espacio' }).ok)
  assert.ok(!validarVariante({ price: 1, sku: '-empieza-con-guion' }).ok)
  assert.ok(!validarVariante({ price: 1, sku: 'A'.repeat(41) }).ok)
  assert.ok(!validarVariante({ price: 1, barcode: 'x y' }).ok)
  assert.ok(validarVariante({ price: 1, barcode: '7501031311309' }).ok)
})

test('atributos: texto plano, sin vacíos, con topes', () => {
  const r = normalizarAtributos({ talla: ' M ', color: 'Rojo', vacio: '', numero: 3, objeto: { a: 1 } })
  assert.ok(r.ok)
  assert.deepEqual(r.atributos, { talla: 'M', color: 'Rojo', numero: '3' })
  assert.ok(!normalizarAtributos({ k: 'x'.repeat(81) }).ok)
  assert.ok(!normalizarAtributos(Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, 'v']))).ok)
  assert.ok(!normalizarAtributos(['a'] as never).ok)
  const vacio = normalizarAtributos(null)
  assert.ok(vacio.ok)
  assert.deepEqual(vacio.atributos, {})
})

// ── Capacidades del ítem ─────────────────────────────────────────────────────

test('cada tipo tiene sus capacidades de partida, y un producto físico lleva inventario', () => {
  for (const tipo of TIPOS_ITEM) assert.ok(CAPACIDADES_POR_TIPO[tipo], `falta ${tipo}`)
  assert.equal(CAPACIDADES_POR_TIPO.PHYSICAL_PRODUCT.trackInventory, true)
  assert.equal(CAPACIDADES_POR_TIPO.SERVICE.trackInventory, false)
  assert.equal(CAPACIDADES_POR_TIPO.VOUCHER.requiresRedemption, true)
  assert.equal(CAPACIDADES_POR_TIPO.VOUCHER.availablePOS, false)
})

test('las capacidades pedidas se aplican encima del tipo; lo desconocido o mal tipado se descarta', () => {
  const c = normalizarCapacidades('SERVICE', { requiresBooking: true, trackInventory: 'sí', hack: true, availablePOS: false })
  assert.equal(c.requiresBooking, true)
  assert.equal(c.trackInventory, false, 'un no-booleano no cuenta')
  assert.equal(c.availablePOS, false)
  assert.ok(!('hack' in c), 'no se cuelan claves')
  assert.deepEqual(Object.keys(c).sort(), Object.keys(CAPACIDADES_POR_TIPO.SERVICE).sort())
  assert.deepEqual(normalizarCapacidades('SERVICE', ['x']), CAPACIDADES_POR_TIPO.SERVICE)
  assert.deepEqual(normalizarCapacidades('SERVICE', null), CAPACIDADES_POR_TIPO.SERVICE)
})

test('las capacidades de un tipo no se comparten por referencia entre ítems', () => {
  const a = normalizarCapacidades('SERVICE')
  a.trackInventory = true
  assert.equal(CAPACIDADES_POR_TIPO.SERVICE.trackInventory, false)
})

// ── Slug ─────────────────────────────────────────────────────────────────────

test('slug: sin acentos ni símbolos, con tope y nunca vacío', () => {
  assert.equal(slugDeNombre('Lavado Básico — Premium!'), 'lavado-basico-premium')
  assert.equal(slugDeNombre('Piña Colada'), 'pina-colada')
  assert.equal(slugDeNombre('   '), 'item')
  assert.equal(slugDeNombre('???'), 'item')
  assert.ok(slugDeNombre('a'.repeat(200)).length <= 60)
  assert.ok(!slugDeNombre('palabra '.repeat(30)).endsWith('-'))
})

test('slug libre: empieza en -2 y salta los ocupados', () => {
  assert.equal(elegirSlugLibre('lavado', new Set()), 'lavado')
  assert.equal(elegirSlugLibre('lavado', new Set(['lavado'])), 'lavado-2')
  assert.equal(elegirSlugLibre('lavado', new Set(['lavado', 'lavado-2', 'lavado-3'])), 'lavado-4')
  assert.equal(elegirSlugLibre('lavado', new Set(['lavado-2'])), 'lavado', 'un hueco anterior no se rellena si la base está libre')
})

// ── Estados ──────────────────────────────────────────────────────────────────

test('tabla de transiciones: lo no declarado no ocurre', () => {
  assert.ok(puedeCambiarEstadoItem('DRAFT', 'ACTIVE'))
  assert.ok(puedeCambiarEstadoItem('ACTIVE', 'PAUSED'))
  assert.ok(puedeCambiarEstadoItem('PAUSED', 'ACTIVE'))
  assert.ok(puedeCambiarEstadoItem('ARCHIVED', 'DRAFT'), 'restaurar vuelve a borrador')
  assert.ok(!puedeCambiarEstadoItem('ARCHIVED', 'ACTIVE'), 'no se publica directo desde archivado: se revisa primero')
  assert.ok(!puedeCambiarEstadoItem('DRAFT', 'PAUSED'))
  assert.ok(!puedeCambiarEstadoItem('ACTIVE', 'DRAFT'))
  assert.ok(!puedeCambiarEstadoItem('ACTIVE', 'ACTIVE'))
  for (const desde of Object.keys(TRANSICIONES_ITEM) as (keyof typeof TRANSICIONES_ITEM)[]) {
    if (desde !== 'ARCHIVED') assert.ok(TRANSICIONES_ITEM[desde].includes('ARCHIVED'), `${desde} debe poder archivarse`)
  }
})

test('publicar exige una variante ACTIVA; agotada o descontinuada no se puede vender', () => {
  assert.equal(motivoParaNoPublicar([{ status: 'ACTIVE' }]), null)
  assert.equal(motivoParaNoPublicar([{ status: 'OUT_OF_STOCK' }, { status: 'ACTIVE' }]), null)
  assert.match(motivoParaNoPublicar([{ status: 'OUT_OF_STOCK' }, { status: 'DISCONTINUED' }]) ?? '', /variante activa/)
  assert.match(motivoParaNoPublicar([]) ?? '', /variante activa/)
})
