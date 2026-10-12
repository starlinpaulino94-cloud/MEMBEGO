import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FORMATO_CATALOGO,
  ASPECTO_COMPARTIR,
  ZOOM_MAXIMO,
  centroDe,
  estiloDeVista,
  evaluarResolucion,
  recorteDesde,
  validarRecorte,
  zonaVisibleApaisada,
  zoomDe,
} from '../src/lib/imagen/formatos'

const cerca = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`)

test('recorteDesde: a zoom 1 el encuadre cuadrado es el lado menor, centrado', () => {
  const r = recorteDesde(2000, 1000, 1)
  assert.deepEqual(r, { x: 500, y: 0, w: 1000, h: 1000 })
  const v = recorteDesde(1000, 2000, 1)
  assert.deepEqual(v, { x: 0, y: 500, w: 1000, h: 1000 })
})

test('recorteDesde: el zoom achica el encuadre y nunca se sale de la imagen', () => {
  const r = recorteDesde(2000, 1000, 1, 2, 0, 0)
  assert.deepEqual(r, { x: 0, y: 0, w: 500, h: 500 })
  const extremo = recorteDesde(2000, 1000, 1, 2, 5, -3)
  assert.equal(extremo.x + extremo.w, 2000)
  assert.equal(extremo.y, 0)
  // Zoom fuera de rango se limita.
  assert.equal(recorteDesde(1000, 1000, 1, 99).w, 1000 / ZOOM_MAXIMO)
  assert.equal(recorteDesde(1000, 1000, 1, 0.1).w, 1000)
})

test('recorteDesde respeta cualquier proporción (16:9) y siempre la conserva', () => {
  for (const [a, b] of [[1600, 900], [900, 1600], [3000, 3000], [4000, 1000]]) {
    const r = recorteDesde(a, b, 16 / 9, 1.7, 0.3, 0.8)
    cerca(r.w / r.h, 16 / 9)
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= a + 1e-9 && r.y + r.h <= b + 1e-9)
  }
})

test('centroDe y zoomDe son los inversos de recorteDesde', () => {
  const r = recorteDesde(3000, 2000, 1, 2.5, 0.4, 0.6)
  const { cx, cy } = centroDe(r, 3000, 2000)
  cerca(cx, 0.4)
  cerca(cy, 0.6)
  cerca(zoomDe(r, 3000, 2000, 1), 2.5)
})

test('zonaVisibleApaisada: de un cuadrado a 1,91:1 se pierde arriba y abajo, centrado', () => {
  const z = zonaVisibleApaisada(1, ASPECTO_COMPARTIR)
  assert.equal(z.x, 0)
  assert.equal(z.w, 1)
  cerca(z.h, 1 / ASPECTO_COMPARTIR)
  cerca(z.y, (1 - z.h) / 2)
  // Una zona más alta que el encuadre pierde los lados.
  const alta = zonaVisibleApaisada(2, 1)
  assert.equal(alta.y, 0)
  assert.equal(alta.h, 1)
  cerca(alta.w, 0.5)
})

test('estiloDeVista: la imagen completa se coloca para que solo asome el recorte', () => {
  const s = estiloDeVista({ x: 500, y: 0, w: 1000, h: 1000 }, 2000, 1000)
  assert.equal(s.width, '200%')
  assert.equal(s.height, '100%')
  assert.equal(s.left, '-50%')
  assert.equal(s.top, '0%')
})

test('evaluarResolucion: avisa según los píxeles REALES del recorte', () => {
  assert.equal(evaluarResolucion({ x: 0, y: 0, w: 1500, h: 1500 }, FORMATO_CATALOGO).nivel, 'ok')
  assert.equal(evaluarResolucion({ x: 0, y: 0, w: 1500, h: 1500 }, FORMATO_CATALOGO).mensaje, null)
  const justa = evaluarResolucion({ x: 0, y: 0, w: 900, h: 900 }, FORMATO_CATALOGO)
  assert.equal(justa.nivel, 'justa')
  assert.match(justa.mensaje!, /900×900/)
  const baja = evaluarResolucion({ x: 0, y: 0, w: 300, h: 300 }, FORMATO_CATALOGO)
  assert.equal(baja.nivel, 'baja')
  assert.match(baja.mensaje!, /borrosa/)
})

test('validarRecorte acepta un recorte bueno y lo deja en enteros dentro de la imagen', () => {
  const v = validarRecorte({ x: 100.4, y: 0, w: 800.2, h: 800.2 }, 1000, 1000, 1)
  assert.ok(v.ok)
  if (v.ok) assert.deepEqual(v.recorte, { x: 100, y: 0, w: 800, h: 800 })
})

test('validarRecorte rechaza lo que no es de fiar', () => {
  const malos: unknown[] = [
    null,
    undefined,
    'x',
    {},
    { x: 0, y: 0, w: 'a', h: 10 },
    { x: NaN, y: 0, w: 500, h: 500 },
    { x: 0, y: 0, w: Infinity, h: 500 },
    { x: 0, y: 0, w: 10, h: 10 }, // diminuto
    { x: 0, y: 0, w: 1200, h: 1200 }, // se sale
    { x: 900, y: 0, w: 500, h: 500 }, // se sale a la derecha
    { x: -50, y: 0, w: 500, h: 500 }, // negativo
    { x: 0, y: 0, w: 800, h: 400 }, // proporción 2:1 en un formato cuadrado
  ]
  for (const m of malos) {
    const v = validarRecorte(m, 1000, 1000, 1)
    assert.equal(v.ok, false, JSON.stringify(m))
  }
})

test('las rutas de las versiones salen de la ruta del original y un token', async () => {
  const { baseDeVariantes, rutaDeVariante, rutasDeVariantes } = await import('../src/lib/imagen/formatos')
  const base = baseDeVariantes('emp1/catalogo/item1/abc.jpg', 'k9')
  assert.equal(base, 'emp1/catalogo/item1/abc-k9')
  assert.equal(rutaDeVariante(base, 'tarjeta'), 'emp1/catalogo/item1/abc-k9_tarjeta.webp')
  assert.deepEqual(rutasDeVariantes(base), [
    'emp1/catalogo/item1/abc-k9_tarjeta.webp',
    'emp1/catalogo/item1/abc-k9_ficha.webp',
    'emp1/catalogo/item1/abc-k9_compartir.webp',
  ])
  // Un punto en una carpeta no se confunde con la extensión.
  assert.equal(baseDeVariantes('a.b/c/foto', 'z'), 'a.b/c/foto-z')
})

test('franjaCompartir: franja centrada, en enteros, con la proporción de compartir', async () => {
  const { franjaCompartir } = await import('../src/lib/imagen/formatos')
  const f = franjaCompartir({ x: 100, y: 50, w: 1200, h: 1200 })
  assert.deepEqual(f, { x: 100, y: 50 + Math.round((1200 - 630) / 2), w: 1200, h: 630 })
  // Un encuadre ya apaisado no se corta más de lo que mide.
  const baja = franjaCompartir({ x: 0, y: 0, w: 1000, h: 300 })
  assert.equal(baja.h, 300)
  assert.equal(baja.y, 0)
})
