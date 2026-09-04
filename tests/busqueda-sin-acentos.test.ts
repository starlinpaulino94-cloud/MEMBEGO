import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizarBusqueda, filtroNombre } from '../src/modules/busqueda/normalizar'

/**
 * El riesgo de esta función no es que se rompa: es que DISCREPE de lo que hace
 * `unaccent` en PostgreSQL. Si los dos lados normalizan distinto, la búsqueda
 * deja de encontrar y no hay ningún error que lo delate.
 *
 * La tabla de abajo es la del diccionario `unaccent` para español. Si algún
 * día se cambia el lado de la base, esta prueba es la que avisa.
 */

test('quita los acentos igual que unaccent de PostgreSQL', () => {
  const equivalencias: [string, string][] = [
    ['á', 'a'], ['é', 'e'], ['í', 'i'], ['ó', 'o'], ['ú', 'u'],
    ['Á', 'a'], ['É', 'e'], ['Í', 'i'], ['Ó', 'o'], ['Ú', 'u'],
    ['ü', 'u'], ['Ü', 'u'],
    ['ñ', 'n'], ['Ñ', 'n'],
    ['ç', 'c'], ['Ç', 'c'],
  ]
  for (const [entra, sale] of equivalencias) {
    assert.equal(normalizarBusqueda(entra), sale, `${entra} debería normalizar a ${sale}`)
  }
})

test('el caso que lo motivó: buscar «jose» encuentra a José', () => {
  assert.equal(normalizarBusqueda('José Manuel López'), 'jose manuel lopez')
  assert.equal(normalizarBusqueda('jose'), 'jose')
  // Y al revés: quien escribe con tilde encuentra al que está sin ella.
  assert.equal(normalizarBusqueda('Jose Manuel Lopez'), normalizarBusqueda('José Manuel López'))
})

test('la eñe se trata como n en los DOS sentidos', () => {
  // Buscar «nino» encuentra «Niño», y buscar «Niño» encuentra «Nino».
  assert.equal(normalizarBusqueda('Niño'), normalizarBusqueda('Nino'))
})

test('pasa a minúsculas y recorta los espacios de los bordes', () => {
  assert.equal(normalizarBusqueda('  MARÍA  '), 'maria')
})

test('los espacios de en medio se conservan', () => {
  // Si se colapsaran, «ana maria» dejaría de casar con lo guardado.
  assert.equal(normalizarBusqueda('Ana María'), 'ana maria')
})

test('filtroNombre devuelve null cuando no hay nada que buscar', () => {
  // Filtrar por la cadena vacía casaría con TODO y parecería que el filtro
  // está roto. Mejor no poner la condición.
  for (const vacio of ['', '   ', null, undefined]) {
    assert.equal(filtroNombre(vacio), null, `"${vacio}" no debería producir filtro`)
  }
})

test('filtroNombre normaliza lo que el usuario escribió', () => {
  assert.deepEqual(filtroNombre('  JOSÉ '), { contains: 'jose' })
})

test('no lleva mode insensitive: la columna ya está en minúsculas', () => {
  // Pedirlo desaprovecharía el índice de trigramas.
  const f = filtroNombre('ana') as Record<string, unknown>
  assert.equal(f.mode, undefined)
})
