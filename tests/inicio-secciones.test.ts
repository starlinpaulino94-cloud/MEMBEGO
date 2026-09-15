/**
 * EL INICIO · las secciones que faltaban (2026-09-15).
 *
 * Tres cosas se añadieron sin rediseñar nada: novedades de la vitrina,
 * «Descubre más empresas» y la reactivación de «Empresas destacadas», que
 * llevaba apagada con un `return null` desde el rediseño de septiembre.
 *
 * Lo que se vigila:
 *
 *  1. Que DESTACADAS no vuelva a apagarse sin que nadie lo note. Fue un
 *     `return null` silencioso, y con él se apagó también la consulta.
 *  2. Que el orden por defecto sea el que pidió el negocio. Ese array ES la
 *     pantalla cuando nadie ha curado nada.
 *  3. Que el tope de bloques se lea de la lista: escribirlo a mano es cómo un
 *     bloque nuevo queda imposible de publicar.
 *  4. Que el color de una categoría NO dependa de su posición.
 *  5. Que las secciones nuevas usen las piezas que ya existen, no formas
 *     propias.
 *
 * Ejecutar: npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TIPOS_BLOQUE } from '../src/modules/home/esquema'
import { claveDeCategoria, CATEGORIA_NEUTRA } from '../src/modules/home/categorias-color'

function fuente(...ruta: string[]): string {
  return readFileSync(join(__dirname, '..', ...ruta), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const MAPA = ['src', 'components', 'cliente', 'inicio', 'InicioComercial.tsx']
const LECTURA = ['src', 'modules', 'home', 'lectura.ts']
const CHIPS = ['src', 'components', 'cliente', 'inicio', 'VibeCategorias.tsx']
const NOVEDADES = ['src', 'components', 'cliente', 'inicio', 'VibeNovedades.tsx']
const DESCUBRE = ['src', 'components', 'cliente', 'inicio', 'VibeDescubre.tsx']
const DESTACADAS = ['src', 'components', 'cliente', 'inicio', 'VibeDestacadas.tsx']

// ── El orden y el contrato ───────────────────────────────────────────────────

test('el orden por defecto es el que pidió el negocio', () => {
  // Este array no es un catálogo de tipos: es la pantalla que ve todo el mundo
  // cuando nadie ha publicado curación.
  assert.deepEqual([...TIPOS_BLOQUE], [
    'CABECERA',
    'CATEGORIAS',
    'HERO',
    'NOVEDADES',
    'DESCUBRE',
    'DESTACADAS',
    'MEMBRESIAS',
    'EXPERIENCIAS',
    'BANNER_QR',
  ])
})

test('el tope de bloques sale de la lista, no de un número escrito', () => {
  // Con el 7 escrito a mano, los dos bloques nuevos eran imposibles de publicar
  // y el formulario los rechazaba sin decir por qué.
  assert.match(fuente('src', 'modules', 'home', 'esquema.ts'), /\.max\(TIPOS_BLOQUE\.length\)/)
})

// ── Que ninguna sección vuelva a apagarse en silencio ────────────────────────

test('ningún bloque con pantalla propia devuelve null', () => {
  // DESTACADAS estuvo apagada así durante meses: el `case` existía, devolvía
  // `null`, y como la consulta solo se lanza si el bloque está activo, tampoco
  // se pedían los datos. No había error en ninguna parte.
  const src = fuente(...MAPA)
  for (const bloque of ['NOVEDADES', 'DESCUBRE', 'DESTACADAS', 'MEMBRESIAS', 'HERO', 'CATEGORIAS']) {
    const i = src.indexOf(`case '${bloque}':`)
    assert.ok(i > 0, `falta el case de ${bloque}`)
    const cuerpo = src.slice(i, src.indexOf('case ', i + 10))
    assert.doesNotMatch(cuerpo, /return null/, `${bloque} está apagado`)
  }
})

test('los dos bloques sin pantalla lo dicen, no se olvidan', () => {
  // CABECERA y BANNER_QR sí devuelven null a propósito. El `case` explícito es
  // lo que distingue una decisión de un olvido.
  const src = fuente(...MAPA)
  for (const bloque of ['CABECERA', 'BANNER_QR']) {
    assert.ok(src.includes(`case '${bloque}':`), `falta el case de ${bloque}`)
  }
})

test('cada bloque del contrato tiene su rama en el mapa', () => {
  // `assertNever` ya lo obliga en compilación; esto lo comprueba también en
  // ejecución, por si alguien lo sustituye por un `default` permisivo.
  const src = fuente(...MAPA)
  for (const tipo of TIPOS_BLOQUE) {
    assert.ok(src.includes(`case '${tipo}':`), `el mapa no cubre ${tipo}`)
  }
  assert.match(src, /assertNever\(tipo\)/)
})

// ── Los datos ────────────────────────────────────────────────────────────────

test('las novedades del Inicio NO se filtran por empresas seguidas', () => {
  // Es la diferencia con el feed de la campana, y es deliberada: en una portada,
  // atarlo a los seguidos la dejaría vacía para quien acaba de registrarse.
  const src = fuente(...LECTURA)
  assert.doesNotMatch(src, /companyFollow/)
  assert.match(src, /novedades/)
})

test('la sección de novedades no cuesta una consulta más', () => {
  // Sale de las promociones y los planes que ya se piden. Una portada que añade
  // una consulta por sección se vuelve lenta sin que nadie sepa cuál la frenó.
  const src = fuente(...LECTURA)
  const i = src.indexOf('const novedades')
  const bloque = src.slice(i, i + 1400)
  assert.doesNotMatch(bloque, /await /, 'las novedades no deben lanzar su propia consulta')
  assert.match(bloque, /vigentes\.map/)
  assert.match(bloque, /planes\.map/)
})

test('«Descubre» lee todas las publicadas y «Destacadas» solo las promocionadas', () => {
  // Si las dos leyeran `isFeatured`, la portada enseñaría la misma lista dos
  // veces y la segunda sobraría.
  const src = fuente(...LECTURA)
  assert.match(src, /tipos\.includes\('DESTACADAS'\) \? getFeaturedCompanies\(/)
  assert.match(src, /tipos\.includes\('DESCUBRE'\) \? getCompaniesPublic\(/)
})

test('las novedades solo incluyen promociones vigentes', () => {
  const src = fuente(...LECTURA)
  assert.match(src, /!p\.vigenciaHasta \|\| new Date\(p\.vigenciaHasta\) > ahora/)
})

// ── Los colores de las categorías ────────────────────────────────────────────

test('el color de una categoría no depende de su posición', () => {
  // Antes era `ACENTOS[i % 3]`: «Lavados» salía violeta o cian según dónde
  // cayera, y cambiaba al añadir una categoría antes.
  const src = fuente(...CHIPS)
  assert.doesNotMatch(src, /ACENTOS\[/)
  assert.match(src, /data-categoria=\{claveDeCategoria\(c\.slug\)\}/)
})

test('cada slug da siempre la misma clave, y distinta de las demás', () => {
  assert.equal(claveDeCategoria('restaurantes'), claveDeCategoria('restaurantes'))
  assert.notEqual(claveDeCategoria('restaurantes'), claveDeCategoria('lavados'))
})

test('los sinónimos caen en la misma clave', () => {
  // «carwash» y «lavados» son el mismo rubro: dos colores distintos para lo
  // mismo es peor que uno solo.
  assert.equal(claveDeCategoria('carwash'), 'lavados')
  assert.equal(claveDeCategoria('gastronomia'), 'restaurantes')
  assert.equal(claveDeCategoria('barberia'), 'belleza')
})

test('un slug desconocido cae en la clave neutra, no en un color inventado', () => {
  // Un color por hash o por posición sería volver al problema que esto arregla.
  assert.equal(claveDeCategoria('rubro-que-no-existe'), CATEGORIA_NEUTRA)
})

test('el slug se normaliza antes de buscar', () => {
  assert.equal(claveDeCategoria('  LAVADOS  '), 'lavados')
})

test('los colores viven en el tema, no en el componente', () => {
  // Un hex en un `.tsx` no cambia con el tema: en oscuro, la tesela de
  // «Lavados» sería una mancha azul clarita sobre pantalla negra. Lo detectó
  // el auditor de diseño antes que ninguna persona.
  assert.doesNotMatch(fuente('src', 'modules', 'home', 'categorias-color.ts'), /#[0-9a-f]{3,8}\b/i)
  assert.doesNotMatch(fuente(...CHIPS), /#[0-9a-f]{3,8}\b/i)
})

test('cada categoría con color tiene su regla en el tema, clara Y oscura', () => {
  const css = readFileSync(join(__dirname, '..', 'src', 'app', 'globals.css'), 'utf8')
  for (const slug of ['lavados', 'restaurantes', 'belleza', 'spa', 'otros']) {
    assert.ok(
      css.includes(`[data-categoria='${slug}']`) || slug === 'otros',
      `falta la regla clara de ${slug}`
    )
  }
  // Y su contraparte oscura: sin ella, la categoría hereda el claro y se
  // convierte en una mancha luminosa.
  for (const slug of ['lavados', 'restaurantes', 'belleza', 'spa']) {
    assert.ok(css.includes(`.dark [data-categoria='${slug}']`), `falta la regla oscura de ${slug}`)
  }
})

test('el violeta de la marca no es de ninguna categoría', () => {
  // `#7c3aed` es el héroe, los botones y los sellos. Si lo llevara también un
  // rubro, dejaría de señalar «esto es MembeGo».
  const css = readFileSync(join(__dirname, '..', 'src', 'app', 'globals.css'), 'utf8')
  const i = css.indexOf('COLOR POR CATEGORÍA DE NEGOCIO')
  assert.ok(i > 0, 'no se encontró el bloque de categorías')
  assert.doesNotMatch(css.slice(i), /#7c3aed/i)
})

// ── Que lo nuevo use las piezas que ya existen ───────────────────────────────

test('las secciones nuevas reusan la tarjeta del Inicio', () => {
  for (const ruta of [NOVEDADES, DESCUBRE, DESTACADAS]) {
    const src = fuente(...ruta)
    assert.match(src, /border-vibe-borde/, ruta.join('/'))
    assert.match(src, /elevation-1/, ruta.join('/'))
    assert.match(src, /bg-vibe-niebla/, ruta.join('/'))
  }
})

test('«Descubre» usa el panel lavanda de Ofertas Relámpago', () => {
  // Es el patrón que el Inicio ya tiene para agrupar. Inventar otro obligaría
  // al ojo a aprender una forma más.
  assert.match(fuente(...DESCUBRE), /rounded-2xl bg-vibe-lavanda/)
})

test('una sección sin contenido no se pinta vacía', () => {
  // En una portada, un título con un hueco debajo se lee como un fallo de carga.
  for (const ruta of [NOVEDADES, DESCUBRE, DESTACADAS]) {
    assert.match(fuente(...ruta), /length === 0\) return null/, ruta.join('/'))
  }
})

test('sin valoración no se pinta una estrella vacía ni un cero', () => {
  const src = fuente(...DESTACADAS)
  assert.match(src, /e\.valoracion != null && Number\.isFinite/)
  assert.match(src, /e\.resenas > 0 \?/)
})

test('los conteos usan plural()', () => {
  // Regla de la casa: nunca «1 membresías».
  for (const ruta of [DESCUBRE, DESTACADAS]) {
    assert.match(fuente(...ruta), /plural\(/, ruta.join('/'))
  }
})

test('el pie de «Descubre» solo sale si queda algo fuera', () => {
  // «Explorar las 3 empresas» debajo de una lista con esas mismas 3 es una
  // vuelta al mismo sitio, y enseña a ignorar los pies de sección.
  assert.match(fuente(...DESCUBRE), /const hayMas = total > empresas\.length/)
})
