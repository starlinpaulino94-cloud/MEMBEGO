import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  leerPaginacion,
  resumirPaginas,
  urlDePagina,
  TAMANO_MAXIMO,
  TAMANO_POR_DEFECTO,
} from '../src/lib/paginacion'

/**
 * El núcleo de la paginación decide QUÉ filas pide la base y a dónde llevan los
 * enlaces. Un error aquí muestra datos equivocados o deja registros
 * inalcanzables — que era justo el problema que esto vino a resolver.
 */

test('leerPaginacion usa la primera página y el tamaño por defecto sin parámetros', () => {
  const p = leerPaginacion({})
  assert.equal(p.pagina, 1)
  assert.equal(p.tamano, TAMANO_POR_DEFECTO)
  assert.equal(p.saltar, 0)
  assert.equal(p.tomar, TAMANO_POR_DEFECTO)
})

test('leerPaginacion calcula el salto correcto', () => {
  const p = leerPaginacion({ page: '3', pageSize: '50' })
  assert.equal(p.pagina, 3)
  assert.equal(p.tamano, 50)
  assert.equal(p.saltar, 100) // (3-1) * 50
})

test('leerPaginacion acota una URL manipulada a mano', () => {
  // Página negativa o cero → primera página.
  assert.equal(leerPaginacion({ page: '-5' }).pagina, 1)
  assert.equal(leerPaginacion({ page: '0' }).pagina, 1)
  // Tamaño absurdo → tope duro (no se descarga la tabla completa).
  assert.equal(leerPaginacion({ pageSize: '999999' }).tamano, TAMANO_MAXIMO)
  // Basura no numérica → valores por defecto, sin romper.
  assert.equal(leerPaginacion({ page: 'abc', pageSize: 'xyz' }).pagina, 1)
  assert.equal(leerPaginacion({ page: 'abc', pageSize: 'xyz' }).tamano, TAMANO_POR_DEFECTO)
})

test('resumirPaginas informa el rango humano correcto', () => {
  const r = resumirPaginas({ pagina: 2, tamano: 25 }, 130)
  assert.equal(r.totalPaginas, 6) // ceil(130/25)
  assert.equal(r.desde, 26)
  assert.equal(r.hasta, 50)
  assert.equal(r.hayAnterior, true)
  assert.equal(r.haySiguiente, true)
})

test('resumirPaginas corrige una página fuera de rango (filtro que encoge)', () => {
  // El usuario estaba en la página 9 y el filtro dejó 30 resultados.
  const r = resumirPaginas({ pagina: 9, tamano: 25 }, 30)
  assert.equal(r.totalPaginas, 2)
  assert.equal(r.pagina, 2) // se muestra la última con datos, no una vacía
  assert.equal(r.hasta, 30)
  assert.equal(r.haySiguiente, false)
})

test('resumirPaginas con cero resultados no rompe', () => {
  const r = resumirPaginas({ pagina: 1, tamano: 25 }, 0)
  assert.equal(r.total, 0)
  assert.equal(r.totalPaginas, 1)
  assert.equal(r.desde, 0)
  assert.equal(r.hasta, 0)
  assert.equal(r.hayAnterior, false)
  assert.equal(r.haySiguiente, false)
})

test('urlDePagina CONSERVA los filtros activos al cambiar de página', () => {
  const url = urlDePagina(
    { q: 'juan', tipo: 'VENTA', desde: '2026-01-01', page: '1' },
    { page: 3 }
  )
  assert.ok(url.includes('q=juan'), 'la búsqueda debe sobrevivir')
  assert.ok(url.includes('tipo=VENTA'), 'el filtro de tipo debe sobrevivir')
  assert.ok(url.includes('desde=2026-01-01'), 'el rango debe sobrevivir')
  assert.ok(url.includes('page=3'))
})

test('urlDePagina deja limpia la primera página y el tamaño por defecto', () => {
  assert.equal(urlDePagina({}, { page: 1 }), '')
  assert.equal(urlDePagina({}, { page: 1, pageSize: TAMANO_POR_DEFECTO }), '')
  // Un tamaño distinto sí se refleja.
  assert.equal(urlDePagina({}, { page: 1, pageSize: 100 }), '?pageSize=100')
})

test('urlDePagina no arrastra la página vieja al cambiar de tamaño', () => {
  const url = urlDePagina({ page: '7', q: 'ana' }, { page: 1, pageSize: 50 })
  assert.ok(!url.includes('page=7'), 'no debe conservar la página anterior')
  assert.ok(url.includes('q=ana'))
  assert.ok(url.includes('pageSize=50'))
})
