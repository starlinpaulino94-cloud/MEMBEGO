import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fichasDeFiltro,
  hayFiltro,
  hrefPagina,
  leerFiltroEmpresas,
} from '../src/modules/empresas/filtros'

test('sin parámetros: empresas reales, todas, por nombre, página 1', () => {
  const f = leerFiltroEmpresas({})
  assert.equal(f.ambito, 'reales')
  assert.equal(f.estado, 'todas')
  assert.equal(f.orden, 'nombre')
  assert.equal(f.pagina, 1)
  assert.equal(hayFiltro(f), false)
})

/**
 * LO QUE LLEGA POR LA URL NO ES DE FIAR.
 *
 * Un valor inventado no puede colarse hasta el `orderBy` de Prisma ni dejar la
 * pantalla en un estado que no existe: cae al valor por defecto y ya está.
 */
test('un valor que no está en la lista cae al de por defecto', () => {
  const f = leerFiltroEmpresas({ estado: 'inventado', orden: 'DROP TABLE', ambito: 'x' })
  assert.equal(f.estado, 'todas')
  assert.equal(f.orden, 'nombre')
  assert.equal(f.ambito, 'reales')
})

test('página: solo enteros positivos', () => {
  assert.equal(leerFiltroEmpresas({ pagina: '0' }).pagina, 1)
  assert.equal(leerFiltroEmpresas({ pagina: '-3' }).pagina, 1)
  assert.equal(leerFiltroEmpresas({ pagina: 'abc' }).pagina, 1)
  assert.equal(leerFiltroEmpresas({ pagina: '2.7' }).pagina, 2)
})

test('la búsqueda se recorta: ni espacios sueltos ni textos infinitos', () => {
  assert.equal(leerFiltroEmpresas({ q: '  cartown  ' }).q, 'cartown')
  assert.equal(leerFiltroEmpresas({ q: 'x'.repeat(500) }).q.length, 80)
})

test('«todas» en categoría o ciudad significa sin filtro', () => {
  const f = leerFiltroEmpresas({ categoria: 'todas', ciudad: '' })
  assert.equal(f.categoria, null)
  assert.equal(f.ciudad, null)
})

/**
 * QUITAR UN FILTRO NO PUEDE LLEVARSE LOS DEMÁS.
 *
 * Es el defecto clásico de construir estos enlaces a mano en el JSX: se escribe
 * `?ciudad=` y de paso se pierden el estado y la búsqueda. Aquí cada ficha lleva
 * la URL con TODO lo demás intacto.
 */
test('cada ficha quita lo suyo y conserva el resto', () => {
  const f = leerFiltroEmpresas({ q: 'car', estado: 'activas', ciudad: 'Santiago' })
  const fichas = fichasDeFiltro(f, '/superadmin/empresas')
  assert.equal(fichas.length, 3)

  const quitarCiudad = fichas.find((x) => x.clave === 'ciudad')!.quitarHref
  assert.ok(quitarCiudad.includes('q=car'), 'la búsqueda sobrevive')
  assert.ok(quitarCiudad.includes('estado=activas'), 'el estado sobrevive')
  assert.ok(!quitarCiudad.includes('ciudad='), 'la ciudad se va')
})

test('quitar el último filtro deja la URL limpia', () => {
  const f = leerFiltroEmpresas({ estado: 'activas' })
  const [ficha] = fichasDeFiltro(f, '/superadmin/empresas')
  assert.equal(ficha.quitarHref, '/superadmin/empresas')
})

test('cambiar de filtro vuelve a la página 1', () => {
  // Estar en la página 5 y filtrar dejaba una lista vacía sin explicar por qué.
  const f = leerFiltroEmpresas({ estado: 'activas', pagina: '5' })
  const [ficha] = fichasDeFiltro(f, '/superadmin/empresas')
  assert.ok(!ficha.quitarHref.includes('pagina='))
})

test('paginar conserva los filtros', () => {
  const f = leerFiltroEmpresas({ q: 'car', ambito: 'todas' })
  const href = hrefPagina(f, '/superadmin/empresas', 3)
  assert.ok(href.includes('q=car'))
  assert.ok(href.includes('ambito=todas'))
  assert.ok(href.includes('pagina=3'))
  // Y la página 1 no ensucia la URL.
  assert.ok(!hrefPagina(f, '/superadmin/empresas', 1).includes('pagina='))
})
