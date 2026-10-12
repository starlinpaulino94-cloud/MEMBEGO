import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FORMATOS,
  FORMATO_CATALOGO,
  FONDOS,
  VARIANTES_CATALOGO,
  ZOOM_MAXIMO,
  baseDeVariantes,
  centroDe,
  dimensionesGiradas,
  encuadreGuardado,
  estiloDeImagenGirada,
  estiloDeVista,
  evaluarResolucion,
  recorteDesde,
  rutaDeVariante,
  rutasDeVariantes,
  siguienteGiro,
  validarEncuadre,
  zonaVisible,
  zoomDe,
  zoomMinimo,
} from '../src/lib/imagen/formatos'

const cerca = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`)

// ── Un formato por sección ───────────────────────────────────────────────────

test('cada sección tiene UN formato coherente: proporción = ancho/alto de la salida, y umbrales con sentido', () => {
  const ids = Object.keys(FORMATOS)
  assert.deepEqual(ids.sort(), ['avatar', 'banner', 'catalogo', 'compartir', 'excursion', 'fondo', 'galeria', 'logo', 'plan', 'promocion'])
  for (const f of Object.values(FORMATOS)) {
    cerca(f.aspecto, f.salida.ancho / f.salida.alto)
    assert.ok(f.minimoPx > 0 && f.minimoPx < f.recomendadoPx, f.id)
    assert.equal(f.recomendadoPx, f.salida.ancho, `${f.id}: lo recomendado es el ancho de salida`)
    assert.match(f.descripcion, new RegExp(`${f.salida.ancho}×${f.salida.alto} px`), f.id)
  }
})

test('los formatos que ya existían conservan su proporción (nada cambia de forma sin querer)', () => {
  assert.equal(FORMATOS.catalogo.aspecto, 1)
  assert.equal(FORMATOS.promocion.aspecto, 1)
  cerca(FORMATOS.plan.aspecto, 16 / 9)
  cerca(FORMATOS.excursion.aspecto, 16 / 9)
  cerca(FORMATOS.compartir.aspecto, 1200 / 630)
  assert.equal(FORMATOS.avatar.forma, 'circulo')
  assert.equal(FORMATO_CATALOGO, FORMATOS.catalogo)
})

test('el banner declara las dos pantallas que lo recortan, y el catálogo ninguna', () => {
  assert.equal(FORMATOS.banner.zonas?.length, 2)
  assert.ok(FORMATOS.banner.zonas!.some((z) => /móvil/i.test(z.etiqueta)))
  assert.ok(FORMATOS.banner.zonas!.some((z) => /escritorio/i.test(z.etiqueta)))
  assert.equal(FORMATOS.catalogo.zonas, undefined)
})

test('las versiones del catálogo son cuadradas salvo la de compartir', () => {
  assert.deepEqual(VARIANTES_CATALOGO.tarjeta, { ancho: 600, alto: 600 })
  assert.deepEqual(VARIANTES_CATALOGO.ficha, { ancho: 1200, alto: 1200 })
  assert.deepEqual(VARIANTES_CATALOGO.compartir, { ancho: 1200, alto: 630 })
})

// ── Geometría ────────────────────────────────────────────────────────────────

test('recorteDesde: a zoom 1 el encuadre es el más grande que cabe DENTRO de la foto, centrado', () => {
  assert.deepEqual(recorteDesde(2000, 1000, 1), { x: 500, y: 0, w: 1000, h: 1000 })
  assert.deepEqual(recorteDesde(1000, 2000, 1), { x: 0, y: 500, w: 1000, h: 1000 })
})

test('recorteDesde: acercar achica el encuadre y nunca deja una esquina vacía', () => {
  assert.deepEqual(recorteDesde(2000, 1000, 1, 2, 0, 0), { x: 0, y: 0, w: 500, h: 500 })
  const extremo = recorteDesde(2000, 1000, 1, 2, 5, -3)
  assert.equal(extremo.x + extremo.w, 2000)
  assert.equal(extremo.y, 0)
  assert.equal(recorteDesde(1000, 1000, 1, 99).w, 1000 / ZOOM_MAXIMO)
})

test('zoomMinimo: alejar deja ver la foto ENTERA; en una foto de la proporción del marco no hay nada que alejar', () => {
  cerca(zoomMinimo(3000, 2000, 1), 2000 / 3000)
  assert.equal(zoomMinimo(1000, 1000, 1), 1)
  cerca(zoomMinimo(4000, 1000, 1), 0.25)
  cerca(zoomMinimo(1000, 4000, 1), 0.25)
  // En 16:9: una foto 16:9 es 1; una cuadrada de 1000 cabe con zoom 9/16.
  cerca(zoomMinimo(1600, 900, 16 / 9), 1)
  cerca(zoomMinimo(1000, 1000, 16 / 9), 1000 / (1000 * (16 / 9)))
})

test('al alejar, el marco contiene la foto entera y la foto se mueve LIBREMENTE dentro del marco', () => {
  // Foto 3000×2000 en marco cuadrado, alejada al máximo: marco de 3000×3000.
  const z = zoomMinimo(3000, 2000, 1)
  const centrado = recorteDesde(3000, 2000, 1, z, 0.5, 0.5)
  cerca(centrado.w, 3000)
  cerca(centrado.h, 3000)
  cerca(centrado.x, 0)
  cerca(centrado.y, -500)
  // Eje corto: la foto (2000) cabe en el marco (3000) y se desliza sin salirse. Marco al tope de arriba: la foto queda pegada ABAJO del marco.
  const marcoArriba = recorteDesde(3000, 2000, 1, z, 0.5, -10)
  const marcoAbajo = recorteDesde(3000, 2000, 1, z, 0.5, 10)
  cerca(marcoArriba.y, 2000 - 3000)
  cerca(marcoAbajo.y, 0) // foto pegada ARRIBA del marco
  // Y nunca se aleja más que eso.
  assert.equal(recorteDesde(3000, 2000, 1, 0.01).w, 3000)
})

test('recorteDesde respeta cualquier proporción (16:9) y siempre la conserva', () => {
  for (const [a, b] of [[1600, 900], [900, 1600], [3000, 3000], [4000, 1000]]) {
    const r = recorteDesde(a, b, 16 / 9, 1.7, 0.3, 0.8)
    cerca(r.w / r.h, 16 / 9)
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= a + 1e-9 && r.y + r.h <= b + 1e-9)
  }
})

test('centroDe y zoomDe son los inversos de recorteDesde (también alejado)', () => {
  const r = recorteDesde(3000, 2000, 1, 2.5, 0.4, 0.6)
  const { cx, cy } = centroDe(r, 3000, 2000)
  cerca(cx, 0.4)
  cerca(cy, 0.6)
  cerca(zoomDe(r, 3000, 2000, 1), 2.5)
  const alejado = recorteDesde(3000, 2000, 1, 0.8, 0.5, 0.5)
  cerca(zoomDe(alejado, 3000, 2000, 1), 0.8)
})

test('el giro intercambia alto y ancho a 90° y 270°, y da la vuelta completa', () => {
  assert.deepEqual(dimensionesGiradas(300, 100, 0), { ancho: 300, alto: 100 })
  assert.deepEqual(dimensionesGiradas(300, 100, 90), { ancho: 100, alto: 300 })
  assert.deepEqual(dimensionesGiradas(300, 100, 180), { ancho: 300, alto: 100 })
  assert.deepEqual(dimensionesGiradas(300, 100, 270), { ancho: 100, alto: 300 })
  assert.equal(siguienteGiro(0, 1), 90)
  assert.equal(siguienteGiro(270, 1), 0)
  assert.equal(siguienteGiro(0, -1), 270)
  assert.equal(siguienteGiro(90, -1), 0)
})

test('zonaVisible: de un cuadrado a una pantalla más apaisada se pierde arriba y abajo; a una más alta, los lados', () => {
  const z = zonaVisible(1, 2)
  assert.equal(z.x, 0)
  assert.equal(z.w, 1)
  cerca(z.h, 0.5)
  cerca(z.y, 0.25)
  const alta = zonaVisible(2, 1)
  assert.equal(alta.y, 0)
  assert.equal(alta.h, 1)
  cerca(alta.w, 0.5)
  // Banner 3:1 en móvil (≈1,74:1) pierde los lados; en escritorio (≈4,44:1) pierde arriba y abajo.
  const [movil, escritorio] = FORMATOS.banner.zonas!
  assert.ok(zonaVisible(FORMATOS.banner.aspecto, movil.aspecto).w < 1)
  assert.ok(zonaVisible(FORMATOS.banner.aspecto, escritorio.aspecto).h < 1)
})

test('estiloDeVista: la foto completa se coloca para que solo asome el recorte (también alejado)', () => {
  const s = estiloDeVista({ x: 500, y: 0, w: 1000, h: 1000 }, 2000, 1000)
  assert.deepEqual(s, { width: '200%', height: '100%', left: '-50%', top: '0%' })
  // Alejado: el marco es más grande que la foto, que queda con márgenes (left/top positivos).
  const a = estiloDeVista({ x: 0, y: -500, w: 3000, h: 3000 }, 3000, 2000)
  assert.equal(a.width, '100%')
  cerca(parseFloat(a.height), (2000 / 3000) * 100)
  cerca(parseFloat(a.top), (500 / 3000) * 100)
})

test('estiloDeImagenGirada: a 0° y 180° ocupa la caja; a 90° y 270° se dimensiona al revés y se gira desde el centro', () => {
  const g0 = estiloDeImagenGirada(0, 300, 100)
  assert.deepEqual([g0.width, g0.height, g0.transform], ['100%', '100%', 'rotate(0deg)'])
  assert.equal(estiloDeImagenGirada(180, 300, 100).transform, 'rotate(180deg)')
  const g90 = estiloDeImagenGirada(90, 300, 100)
  // La caja es 100×300 (girada); la foto sin girar mide 300×100: ancho 300% y alto 33,3% de la caja.
  cerca(parseFloat(g90.width), 300)
  cerca(parseFloat(g90.height), 100 / 3, 1e-6)
  assert.match(g90.transform, /translate\(-50%, -50%\) rotate\(90deg\)/)
  assert.equal(estiloDeImagenGirada(270, 300, 100).left, '50%')
})

test('encuadreGuardado: lee un JSON de la base, completa lo que falta y descarta lo roto', () => {
  assert.deepEqual(encuadreGuardado({ x: 1, y: 2, w: 300, h: 300 }), { x: 1, y: 2, w: 300, h: 300, giro: 0, fondo: '#ffffff' })
  assert.deepEqual(encuadreGuardado({ x: 0, y: 0, w: 10, h: 10, giro: 90, fondo: '#0F172A' }), { x: 0, y: 0, w: 10, h: 10, giro: 90, fondo: '#0F172A' })
  assert.equal(encuadreGuardado({ x: 0, y: 0, w: 10, h: 10, giro: 45, fondo: 'rojo' })?.giro, 0)
  assert.equal(encuadreGuardado({ x: 0, y: 0, w: 10, h: 10, giro: 45, fondo: 'rojo' })?.fondo, '#ffffff')
  for (const malo of [null, undefined, 'x', 3, {}, { x: 0, y: 0, w: 0, h: 10 }, { x: 'a', y: 0, w: 1, h: 1 }, { x: NaN, y: 0, w: 1, h: 1 }]) {
    assert.equal(encuadreGuardado(malo), null)
  }
})

test('los fondos que ofrece el editor son colores hexadecimales válidos', () => {
  for (const f of FONDOS) assert.match(f.valor, /^#[0-9a-f]{6}$/i)
})

// ── Avisos de resolución ─────────────────────────────────────────────────────

test('evaluarResolucion: avisa según los píxeles REALES del recorte y el formato de la sección', () => {
  assert.equal(evaluarResolucion({ x: 0, y: 0, w: 1500, h: 1500 }, FORMATOS.catalogo).nivel, 'ok')
  assert.equal(evaluarResolucion({ x: 0, y: 0, w: 1500, h: 1500 }, FORMATOS.catalogo).mensaje, null)
  const justa = evaluarResolucion({ x: 0, y: 0, w: 900, h: 900 }, FORMATOS.catalogo)
  assert.equal(justa.nivel, 'justa')
  assert.match(justa.mensaje!, /900×900/)
  assert.match(justa.mensaje!, /1200×1200 px/)
  const baja = evaluarResolucion({ x: 0, y: 0, w: 300, h: 300 }, FORMATOS.catalogo)
  assert.equal(baja.nivel, 'baja')
  assert.match(baja.mensaje!, /borrosa/)
  // El mismo ancho es suficiente para un avatar (400 px) y no para el catálogo.
  assert.equal(evaluarResolucion({ x: 0, y: 0, w: 400, h: 400 }, FORMATOS.avatar).nivel, 'ok')
  assert.equal(evaluarResolucion({ x: 0, y: 0, w: 400, h: 400 }, FORMATOS.catalogo).nivel, 'baja')
  // Y la recomendación se dice en la proporción de ESA sección.
  assert.match(evaluarResolucion({ x: 0, y: 0, w: 900, h: 506 }, FORMATOS.plan).mensaje!, /1600×900 px/)
})

// ── Validación ───────────────────────────────────────────────────────────────

test('validarEncuadre acepta un encuadre bueno y lo deja en enteros, con giro y fondo por defecto', () => {
  const v = validarEncuadre({ x: 100.4, y: 0, w: 800.2, h: 800.2 }, 1000, 1000, 1)
  assert.ok(v.ok)
  if (v.ok) assert.deepEqual(v.encuadre, { x: 100, y: 0, w: 800, h: 800, giro: 0, fondo: '#ffffff' })
})

test('validarEncuadre acepta la foto alejada (el marco se sale de ella) y rechaza alejar de más', () => {
  // 3000×2000, marco cuadrado alejado al máximo = 3000×3000 empezando en y=-500.
  const bueno = validarEncuadre({ x: 0, y: -500, w: 3000, h: 3000, fondo: '#0F172A' }, 3000, 2000, 1)
  assert.ok(bueno.ok)
  if (bueno.ok) assert.equal(bueno.encuadre.fondo, '#0f172a')
  // Más alejado que "foto entera": no.
  assert.equal(validarEncuadre({ x: -500, y: -1000, w: 4000, h: 4000 }, 3000, 2000, 1).ok, false)
  // Alejado pero dejando la foto fuera del marco (la foto no estaría entera): no.
  assert.equal(validarEncuadre({ x: 600, y: -500, w: 3000, h: 3000 }, 3000, 2000, 1).ok, false)
})

test('validarEncuadre mide el encuadre contra la foto GIRADA', () => {
  // 2000×1000 girada 90° es 1000×2000: un cuadrado de 1000 abajo (y=1000) solo cabe girado.
  const girado = validarEncuadre({ x: 0, y: 1000, w: 1000, h: 1000, giro: 90 }, 2000, 1000, 1)
  assert.ok(girado.ok)
  assert.equal(validarEncuadre({ x: 0, y: 1000, w: 1000, h: 1000 }, 2000, 1000, 1).ok, false, 'sin girar se saldría')
  assert.equal(validarEncuadre({ x: 0, y: 0, w: 500, h: 500, giro: 45 }, 1000, 1000, 1).ok, false, 'solo giros de 90°')
})

test('validarEncuadre rechaza lo que no es de fiar', () => {
  const malos: unknown[] = [
    null,
    undefined,
    'x',
    {},
    { x: 0, y: 0, w: 'a', h: 10 },
    { x: NaN, y: 0, w: 500, h: 500 },
    { x: 0, y: 0, w: Infinity, h: 500 },
    { x: 0, y: 0, w: 10, h: 10 }, // diminuto
    { x: 900, y: 0, w: 500, h: 500 }, // se sale a la derecha
    { x: -50, y: 0, w: 500, h: 500 }, // se sale por la izquierda con la foto más grande que el marco
    { x: 0, y: 0, w: 800, h: 400 }, // proporción 2:1 en un formato cuadrado
    { x: 0, y: 0, w: 500, h: 500, fondo: 'url(javascript:alert(1))' },
    { x: 0, y: 0, w: 500, h: 500, fondo: '#fff' },
    { x: 0, y: 0, w: 500, h: 500, giro: '90' },
  ]
  for (const m of malos) {
    const v = validarEncuadre(m, 1000, 1000, 1)
    assert.equal(v.ok, false, JSON.stringify(m))
  }
})

// ── Rutas de las versiones ───────────────────────────────────────────────────

test('las rutas de las versiones salen de la ruta del original y un token', () => {
  const base = baseDeVariantes('emp1/catalogo/item1/abc.jpg', 'k9')
  assert.equal(base, 'emp1/catalogo/item1/abc-k9')
  assert.equal(rutaDeVariante(base, 'tarjeta'), 'emp1/catalogo/item1/abc-k9_tarjeta.webp')
  assert.deepEqual(rutasDeVariantes(base), [
    'emp1/catalogo/item1/abc-k9_tarjeta.webp',
    'emp1/catalogo/item1/abc-k9_ficha.webp',
    'emp1/catalogo/item1/abc-k9_compartir.webp',
  ])
  assert.equal(baseDeVariantes('a.b/c/foto', 'z'), 'a.b/c/foto-z')
})
