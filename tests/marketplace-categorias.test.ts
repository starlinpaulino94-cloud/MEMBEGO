import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { categoriasVisibles } from '../src/modules/marketplace/types'

/**
 * CATÁLOGO PÚBLICO DE CATEGORÍAS — el marketplace no enseña puertas cerradas.
 *
 * DECISIÓN DE PRODUCTO QUE SE PROTEGE: al abrir el marketplace, el cliente
 * solo debe ver categorías que tengan empresas. Una categoría vacía no da
 * error —da una lista en blanco—, y por eso puede volver a colarse sin que
 * nadie lo note. Es justo lo que había pasado: `/cliente/inicio` filtraba y
 * `/cliente/explorar` y `/empresas` no.
 */

const cat = (slug: string, companyCount: number) => ({
  id: slug,
  name: slug,
  slug,
  icon: null,
  description: null,
  order: 0,
  companyCount,
})

test('las categorías sin empresas no llegan al cliente', () => {
  const visibles = categoriasVisibles([
    cat('lavados', 3),
    cat('restaurantes', 0),
    cat('gimnasios', 1),
  ])
  assert.deepEqual(
    visibles.map((c) => c.slug),
    ['lavados', 'gimnasios']
  )
})

test('sin ninguna empresa publicada el catálogo viaja vacío, no a medias', () => {
  // Importa porque las pantallas hacen `categorias.length > 0 &&` para decidir
  // si dibujan la fila de chips: media lista sería una fila de callejones.
  assert.deepEqual(categoriasVisibles([cat('a', 0), cat('b', 0)]), [])
})

test('conserva el orden que trae la consulta', () => {
  // El `order` de la tabla es curaduría del negocio: qué se enseña primero.
  // Filtrar no puede reordenar.
  const visibles = categoriasVisibles([cat('a', 1), cat('b', 0), cat('c', 2), cat('d', 5)])
  assert.deepEqual(
    visibles.map((c) => c.slug),
    ['a', 'c', 'd']
  )
})

test('el panel sigue viendo el catálogo completo', () => {
  // `getActiveCategories` (modules/empresas) puebla el selector con el que un
  // administrador le asigna categorías a su empresa. Si alguna vez filtrara
  // por empresas, una categoría vacía no podría dejar de estarlo nunca: nadie
  // podría ser la primera empresa en ella. Es el punto muerto que esta prueba
  // vigila.
  const src = readFileSync('src/modules/empresas/queries.ts', 'utf8')
  const cuerpo = src.slice(src.indexOf('export async function getActiveCategories'))
  assert.ok(
    !cuerpo.slice(0, cuerpo.indexOf('\n}')).includes('companyCount'),
    'getActiveCategories no debe filtrar por número de empresas: es el selector del panel'
  )
})
