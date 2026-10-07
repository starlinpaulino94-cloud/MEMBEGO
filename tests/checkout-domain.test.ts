import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CANALES_DE_CHECKOUT,
  CARRITO_VACIO,
  MAX_CANTIDAD_POR_LINEA,
  MAX_LINEAS_CARRITO,
  MAX_NEGOCIOS_EN_CARRITO,
  NOTAS_MAXIMAS,
  agregar,
  esMetodoCheckout,
  fijarCantidad,
  leerCarrito,
  metodoDePedidoDelCheckout,
  notaDelPedido,
  quitar,
  totalDeUnidades,
  vaciarNegocio,
  type Carrito,
} from '../src/modules/checkout/domain'

/** CHECKOUT · el carrito y la forma de pago son puros (Fase 8). El pedido contra la base está en `tests/postgres/checkout.db.test.ts`. */

const conLineas = (): Carrito => {
  let c: Carrito = CARRITO_VACIO
  for (const [slug, v, n] of [['taller', 'v1', 2], ['taller', 'v2', 1], ['tienda', 'v9', 3]] as const) {
    const r = agregar(c, slug, v, n)
    assert.ok(r.ok)
    c = r.carrito
  }
  return c
}

test('agregar suma si el renglón ya estaba y NO modifica el carrito original', () => {
  const c = conLineas()
  const r = agregar(c, 'taller', 'v1', 3)
  assert.ok(r.ok)
  assert.equal(r.carrito.negocios.taller.find((l) => l.varianteId === 'v1')?.cantidad, 5)
  assert.equal(c.negocios.taller.find((l) => l.varianteId === 'v1')?.cantidad, 2)
  assert.equal(totalDeUnidades(r.carrito), 5 + 1 + 3)
})

test('agregar nunca pasa del máximo por renglón y rechaza cantidades que no son enteros de 1 a 99', () => {
  const r = agregar(CARRITO_VACIO, 'taller', 'v1', MAX_CANTIDAD_POR_LINEA)
  assert.ok(r.ok)
  const mas = agregar(r.carrito, 'taller', 'v1', 5)
  assert.ok(mas.ok)
  assert.equal(mas.carrito.negocios.taller[0].cantidad, MAX_CANTIDAD_POR_LINEA)
  for (const mala of [0, -1, 1.5, 100, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(agregar(CARRITO_VACIO, 'taller', 'v1', mala).ok, false, String(mala))
})

test('agregar rechaza negocios o variantes con forma inválida', () => {
  assert.equal(agregar(CARRITO_VACIO, '../etc', 'v1', 1).ok, false)
  assert.equal(agregar(CARRITO_VACIO, 'Taller Mayúsculas', 'v1', 1).ok, false)
  assert.equal(agregar(CARRITO_VACIO, 'taller', '', 1).ok, false)
  assert.equal(agregar(CARRITO_VACIO, 'taller', 'a b', 1).ok, false)
})

test('hay un tope de productos por negocio y de negocios por carrito', () => {
  let c: Carrito = CARRITO_VACIO
  for (let i = 0; i < MAX_LINEAS_CARRITO; i++) {
    const r = agregar(c, 'taller', `v${i}`, 1)
    assert.ok(r.ok)
    c = r.carrito
  }
  assert.equal(agregar(c, 'taller', 'otra', 1).ok, false)
  // Pero sumar a uno que ya está sí se puede.
  assert.ok(agregar(c, 'taller', 'v0', 1).ok)

  let d: Carrito = CARRITO_VACIO
  for (let i = 0; i < MAX_NEGOCIOS_EN_CARRITO; i++) {
    const r = agregar(d, `negocio-${i}`, 'v', 1)
    assert.ok(r.ok)
    d = r.carrito
  }
  assert.equal(agregar(d, 'otro-negocio', 'v', 1).ok, false)
  assert.ok(agregar(d, 'negocio-0', 'v2', 1).ok)
})

test('fijarCantidad cambia solo ese renglón, ignora cantidades inválidas y renglones que no existen', () => {
  const c = conLineas()
  const r = fijarCantidad(c, 'taller', 'v2', 7)
  assert.equal(r.negocios.taller.find((l) => l.varianteId === 'v2')?.cantidad, 7)
  assert.equal(r.negocios.taller.find((l) => l.varianteId === 'v1')?.cantidad, 2)
  assert.equal(fijarCantidad(c, 'taller', 'v2', 0), c)
  assert.equal(fijarCantidad(c, 'taller', 'v2', 1000), c)
  assert.equal(fijarCantidad(c, 'nadie', 'v2', 3), c)
  assert.deepEqual(fijarCantidad(c, 'taller', 'no-esta', 3), c)
})

test('quitar saca el renglón y, si era el último, también el negocio; vaciarNegocio no toca a los demás', () => {
  const c = conLineas()
  const sinUno = quitar(c, 'taller', 'v1')
  assert.deepEqual(sinUno.negocios.taller.map((l) => l.varianteId), ['v2'])
  const sinTaller = quitar(sinUno, 'taller', 'v2')
  assert.deepEqual(Object.keys(sinTaller.negocios), ['tienda'])
  assert.equal(quitar(c, 'nadie', 'v1'), c)
  assert.deepEqual(Object.keys(vaciarNegocio(c, 'taller').negocios), ['tienda'])
  assert.equal(totalDeUnidades(vaciarNegocio(c, 'taller')), 3)
})

test('leerCarrito acepta lo que guardó este código (como texto o como objeto)', () => {
  const c = conLineas()
  assert.deepEqual(leerCarrito(JSON.stringify(c)), c)
  assert.deepEqual(leerCarrito(c), c)
})

test('leerCarrito NO confía en lo guardado: basura, versión distinta o forma rara dan un carrito vacío', () => {
  for (const crudo of [null, undefined, '', 'no es json', '[]', '123', '{"v":2,"negocios":{}}', '{"negocios":{}}', '{"v":1,"negocios":[]}', '{"v":1,"negocios":"x"}', 42, true]) {
    assert.deepEqual(leerCarrito(crudo), CARRITO_VACIO, String(crudo))
  }
})

test('leerCarrito descarta renglón por renglón lo inválido y conserva lo bueno', () => {
  const c = leerCarrito({
    v: 1,
    negocios: {
      taller: [
        { varianteId: 'ok', cantidad: 2 },
        { varianteId: 'ok', cantidad: 3 }, // repetido: se suma
        { varianteId: 'cero', cantidad: 0 },
        { varianteId: 'neg', cantidad: -4 },
        { varianteId: 'dec', cantidad: 1.5 },
        { varianteId: 'enorme', cantidad: 5000 },
        { varianteId: '<script>', cantidad: 1 },
        { varianteId: 7, cantidad: 1 },
        null,
        'texto',
        { varianteId: 'texto-num', cantidad: '4' },
      ],
      '../malo': [{ varianteId: 'x', cantidad: 1 }],
      vacio: [],
      noLista: { varianteId: 'x', cantidad: 1 },
    },
  })
  assert.deepEqual(Object.keys(c.negocios), ['taller'])
  assert.deepEqual(c.negocios.taller, [
    { varianteId: 'ok', cantidad: 5 },
    { varianteId: 'texto-num', cantidad: 4 },
  ])
})

test('leerCarrito recorta lo desmedido: negocios, renglones y la suma de repetidos', () => {
  const negocios: Record<string, unknown[]> = {}
  for (let i = 0; i < MAX_NEGOCIOS_EN_CARRITO + 5; i++) negocios[`n${i}`] = [{ varianteId: 'v', cantidad: 1 }]
  assert.equal(Object.keys(leerCarrito({ v: 1, negocios }).negocios).length, MAX_NEGOCIOS_EN_CARRITO)

  const muchos = Array.from({ length: MAX_LINEAS_CARRITO + 20 }, (_, i) => ({ varianteId: `v${i}`, cantidad: 1 }))
  assert.equal(leerCarrito({ v: 1, negocios: { t: muchos } }).negocios.t.length, MAX_LINEAS_CARRITO)

  const repetidos = Array.from({ length: 10 }, () => ({ varianteId: 'v', cantidad: 50 }))
  assert.equal(leerCarrito({ v: 1, negocios: { t: repetidos } }).negocios.t[0].cantidad, MAX_CANTIDAD_POR_LINEA)
})

test('leerCarrito no se deja envenenar por claves peligrosas del JSON', () => {
  const c = leerCarrito('{"v":1,"negocios":{"__proto__":[{"varianteId":"x","cantidad":1}],"constructor":[{"varianteId":"x","cantidad":1}],"taller":[{"varianteId":"a","cantidad":1}]}}')
  assert.equal(({} as Record<string, unknown>).varianteId, undefined)
  assert.deepEqual(Object.keys(c.negocios).filter((k) => k === 'taller'), ['taller'])
})

test('solo hay dos formas de pagar y cualquier otra cosa se rechaza', () => {
  assert.equal(esMetodoCheckout('AL_RECOGER'), true)
  assert.equal(esMetodoCheckout('TRANSFERENCIA'), true)
  for (const m of ['CARD', 'CASH', 'TRANSFER', 'checkout', '', null, undefined, 3, {}]) assert.equal(esMetodoCheckout(m), false, String(m))
})

test('la transferencia queda como INTENCIÓN (TRANSFER); pagar al recoger no fija método — y ninguna verifica por sí sola', () => {
  assert.equal(metodoDePedidoDelCheckout('TRANSFERENCIA'), 'TRANSFER')
  assert.equal(metodoDePedidoDelCheckout('AL_RECOGER'), null)
})

test('la nota para el negocio dice cómo piensa pagar y conserva el recado, limpio y acotado', () => {
  assert.equal(notaDelPedido('AL_RECOGER', undefined), 'Pagará al recoger')
  assert.equal(notaDelPedido('TRANSFERENCIA', '  paso   a las\n5  '), 'Pagará por transferencia. paso a las 5')
  assert.equal(notaDelPedido('AL_RECOGER', 42), 'Pagará al recoger')
  assert.equal(notaDelPedido('AL_RECOGER', 'x'.repeat(2000))?.length, NOTAS_MAXIMAS)
})

test('el navegador solo puede declarar tres canales de origen, ninguno que exija verificar algo', () => {
  assert.deepEqual(Object.values(CANALES_DE_CHECKOUT).sort(), ['DIRECT', 'MARKETPLACE_BROWSE', 'MARKETPLACE_SEARCH'])
  for (const peligroso of ['QR', 'PROMOTION_CLAIM', 'POS', 'ADMIN']) assert.ok(!(peligroso in CANALES_DE_CHECKOUT) && !Object.values(CANALES_DE_CHECKOUT).includes(peligroso as never))
})
