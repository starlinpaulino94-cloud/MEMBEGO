import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sucursalVisibleEnMapa } from '../src/modules/geo/cercanos/tipos'

/**
 * VISIBILIDAD DE UNA SUCURSAL EN EL MAPA (DS 2.0 · Fase 14).
 *
 * `/admin/sucursales` promete "para que aparezcan en el mapa de tus clientes"
 * y ahora dice cuáles lo hacen. Ese cartel es un ESPEJO en TypeScript del
 * filtro SQL de `condicionesFiltros`, y dos copias de la misma regla se
 * separan solas: el día que el SQL añada una condición, el panel seguiría
 * diciendo "visible" de una sucursal que ya no sale.
 *
 * Mentir en ese cartel es peor que no ponerlo: quien lo lea dejará de buscar
 * el problema donde está.
 */

const base = { activa: true, mostrarEnMapa: true, latitud: 18.63, longitud: -68.39 }

test('con todo en orden, la sucursal es visible', () => {
  assert.equal(sucursalVisibleEnMapa(base), true)
})

test('sin coordenadas no sale, aunque esté activa y visible', () => {
  // El caso real que costó una ronda de depuración entera: la sucursal se veía
  // perfecta en el panel y el mapa decía "0 negocios".
  assert.equal(sucursalVisibleEnMapa({ ...base, latitud: null }), false)
  assert.equal(sucursalVisibleEnMapa({ ...base, longitud: null }), false)
  assert.equal(sucursalVisibleEnMapa({ ...base, latitud: null, longitud: null }), false)
})

test('inactiva u oculta no sale', () => {
  assert.equal(sucursalVisibleEnMapa({ ...base, activa: false }), false)
  assert.equal(sucursalVisibleEnMapa({ ...base, mostrarEnMapa: false }), false)
})

test('el 0 es una coordenada, no un vacío', () => {
  assert.equal(sucursalVisibleEnMapa({ ...base, latitud: 0, longitud: 0 }), true)
})

test('el espejo no se ha separado del filtro SQL', () => {
  // Las tres condiciones de sucursal que impone `condicionesFiltros`. Si
  // alguien añade una cuarta al SQL, esta prueba no la detecta sola —por eso
  // se comprueba también que no hayan aparecido condiciones nuevas sobre `s.`.
  const sql = readFileSync('src/modules/geo/cercanos/queries.ts', 'utf8')
  const bloque = sql.slice(
    sql.indexOf('function condicionesFiltros'),
    sql.indexOf('/** Expresión SQL de la distancia')
  )

  for (const cond of [
    's.activa = true',
    's."mostrarEnMapa" = true',
    's.latitud IS NOT NULL AND s.longitud IS NOT NULL',
  ]) {
    assert.ok(bloque.includes(cond), `el SQL del mapa ya no filtra por \`${cond}\``)
  }

  // Condiciones base sobre la sucursal declaradas en el array inicial. Tres
  // hoy; una cuarta significa que `sucursalVisibleEnMapa` se quedó corta.
  // El cierre es `\n  ]` y no el primer `]`: ese pertenece a la anotación de
  // tipo `Prisma.Sql[]` y dejaría el recorte vacío.
  const inicio = bloque.indexOf('const conds')
  const arrayBase = bloque.slice(inicio, bloque.indexOf('\n  ]', inicio))
  const sobreSucursal = [...arrayBase.matchAll(/Prisma\.sql`(s[.\s"])/g)].length
  assert.equal(
    sobreSucursal,
    3,
    'el filtro base del mapa cambió de condiciones sobre la sucursal: ' +
      'actualiza `sucursalVisibleEnMapa` (y el cartel de /admin/sucursales) para que coincida'
  )
})
