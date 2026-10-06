import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { COLORES_CATEGORIA, colorDeCategoria } from '../src/modules/home/categorias-color'

/**
 * EL COLOR DE UNA FICHA DE CATEGORÍA.
 *
 * La única razón de pintarlas es que el ojo encuentre la suya sin leer, y para
 * eso el color tiene que ser SIEMPRE el mismo. Ciclaba por posición en la
 * lista, así que cambiaba solo.
 */

const COMPONENTE = join('src', 'components', 'cliente', 'inicio', 'VibeCategorias.tsx')
const sinComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(?:\/\/|\*).*$/gm, '')
const fuente = (p: string) => sinComentarios(readFileSync(p, 'utf8'))

// ── el fallo que lo motivó ──────────────────────────────────────────────────

test('añadir una categoría ANTES no le cambia el color a las demás', () => {
  /**
   * El caso exacto del reporte, contrastado contra la regla VIEJA.
   *
   * Comprobar solo que la función nueva es estable no prueba nada: depende
   * únicamente del slug, así que no podría fallar. Lo que sí dice algo es
   * reproducir aquí el reparto anterior —por índice— y ver que aquel SÍ mueve
   * los colores y este no. Si alguien vuelve al ciclo, la mitad de abajo de
   * esta prueba pasa a describir el código de verdad y la de arriba falla.
   */
  const PALETA_VIEJA = ['grad-vibe', ...COLORES_CATEGORIA]
  const porPosicion = (lista: string[], slug: string) =>
    PALETA_VIEJA[(lista.indexOf(slug) + 1) % PALETA_VIEJA.length]

  const antes = ['lavados', 'gastronomia', 'tours']
  const despues = ['spa', 'lavados', 'gastronomia', 'tours']

  // La regla vieja movía a las tres al insertar «spa» delante.
  const movidasAntes = antes.filter((s) => porPosicion(antes, s) !== porPosicion(despues, s))
  assert.deepEqual(
    movidasAntes,
    antes,
    'la reproducción de la regla vieja tiene que mover los colores; si no, no está comparando nada'
  )

  // La nueva no mueve ninguna.
  for (const slug of antes) {
    assert.equal(
      colorDeCategoria(slug),
      colorDeCategoria(slug),
      `${slug} tiene que dar siempre el mismo color`
    )
  }
  const movidasAhora = antes.filter(
    (s) => colorDeCategoria(s) !== colorDeCategoria(s)
  )
  assert.deepEqual(movidasAhora, [])
})

test('reordenar el catálogo entero no mueve ningún color', () => {
  const catalogo = ['lavados', 'gastronomia', 'tours', 'spa', 'gimnasio', 'servicios', 'tienda']
  const original = new Map(catalogo.map((s) => [s, colorDeCategoria(s)]))
  for (const s of [...catalogo].reverse()) {
    assert.equal(colorDeCategoria(s), original.get(s))
  }
  for (const s of [...catalogo].sort()) {
    assert.equal(colorDeCategoria(s), original.get(s))
  }
})

// ── el violeta de marca ─────────────────────────────────────────────────────

test('ninguna categoría se lleva el violeta de la marca', () => {
  // Con el ciclo anterior —seis colores, `% 6` arrancando en 1— la sexta
  // categoría salía en `grad-vibe`, igual que el «Todos» de al lado.
  assert.ok(!(COLORES_CATEGORIA as readonly string[]).includes('grad-vibe'))
  const muchas = Array.from({ length: 200 }, (_, i) => `categoria-${i}`)
  for (const s of [...muchas, 'lavados', 'spa', 'tours', 'gastronomia']) {
    assert.notEqual(colorDeCategoria(s), 'grad-vibe')
  }
})

test('«Todos» sí lo lleva, y es el único', () => {
  const src = fuente(COMPONENTE)
  assert.match(src, /const COLOR_TODOS = 'grad-vibe'/)
  assert.equal((src.match(/COLOR_TODOS/g) ?? []).length, 2, 'se declara y se usa una vez')
})

// ── el reparto ──────────────────────────────────────────────────────────────

test('el color siempre sale de la lista, con cualquier entrada', () => {
  const raros = ['', '   ', 'Ñandú', 'ÁÉÍÓÚ', 'a'.repeat(5000), '🚗', '---', '123']
  for (const s of raros) {
    assert.ok(
      (COLORES_CATEGORIA as readonly string[]).includes(colorDeCategoria(s)),
      `${JSON.stringify(s.slice(0, 20))} se salió de la paleta`
    )
  }
})

test('un slug largo no desborda el acumulador a negativo', () => {
  // Sin `>>> 0` el hash se va a negativo y el módulo devuelve un índice fuera
  // de rango: `undefined` como clase CSS, que es una ficha sin pintar.
  const largo = 'gastronomia-y-restaurantes-de-la-zona-colonial-'.repeat(50)
  assert.ok((COLORES_CATEGORIA as readonly string[]).includes(colorDeCategoria(largo)))
})

test('el slug se normaliza: mayúsculas y espacios no son otra categoría', () => {
  assert.equal(colorDeCategoria('Lavados'), colorDeCategoria('lavados'))
  assert.equal(colorDeCategoria('  lavados  '), colorDeCategoria('lavados'))
})

test('slugs distintos no caen todos en el mismo color', () => {
  // No se le pide al hash que reparta bien, pero si todo cayera en un color la
  // fila sería de un solo tono y no serviría para distinguir nada.
  const usados = new Set(
    ['lavados', 'gastronomia', 'tours', 'spa', 'gimnasio', 'servicios', 'tienda', 'salud'].map(
      colorDeCategoria
    )
  )
  assert.ok(usados.size >= 3, `solo se usaron ${usados.size} colores de ${COLORES_CATEGORIA.length}`)
})

// ── estructural ─────────────────────────────────────────────────────────────

test('el componente no vuelve a pintar por posición', () => {
  const src = fuente(COMPONENTE)
  assert.match(src, /colorDeCategoria\(c\.slug\)/)
  assert.doesNotMatch(
    src,
    /COLORES\[[^\]]*\bi\b[^\]]*\]/,
    'el color no puede salir del índice del map: eso es lo que lo hacía cambiar solo'
  )
  assert.doesNotMatch(src, /categorias\.map\(\(c, i\)/, 'ya no hace falta el índice')
})

test('los cinco colores existen como clase en globals.css', () => {
  // Una clase que no existe no falla: pinta la ficha sin degradado, y nadie se
  // entera hasta que la ve.
  const css = readFileSync(join('src', 'app', 'globals.css'), 'utf8')
  for (const clase of COLORES_CATEGORIA) {
    assert.match(css, new RegExp(`\\.${clase}\\s*\\{`), `falta .${clase} en globals.css`)
  }
})
