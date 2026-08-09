import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { puntoDeEmpresa } from '../src/modules/empresas/sucursalPrincipal'

/**
 * COORDENADAS DE LA SUCURSAL PRINCIPAL — lo que hace visible a una empresa.
 *
 * EL DEFECTO QUE SE ARREGLÓ: `Company.latitud/longitud` y
 * `Sucursal.latitud/longitud` son campos distintos. El dueño colocaba el pin en
 * `/admin/perfil`, se guardaba en la EMPRESA, y la sucursal principal se
 * quedaba en null. "Cerca de mí" consulta SUCURSALES y exige coordenadas, así
 * que el negocio no aparecía nunca — sin error y sin nada que el admin pudiera
 * hacer desde esa pantalla.
 *
 * No es un fallo que dé la cara: el mapa dice "0 negocios", que es exactamente
 * lo que diría si de verdad no hubiera ninguno cerca.
 */

test('un punto completo se copia', () => {
  assert.deepEqual(puntoDeEmpresa(18.6351616, -68.3966464), {
    latitud: 18.6351616,
    longitud: -68.3966464,
  })
})

test('media coordenada no es un punto', () => {
  // Copiar solo la latitud dejaría a la sucursal igual de invisible, pero con
  // un dato a medias en la base que cuesta más diagnosticar.
  assert.equal(puntoDeEmpresa(18.63, null), null)
  assert.equal(puntoDeEmpresa(null, -68.39), null)
  assert.equal(puntoDeEmpresa(null, null), null)
  assert.equal(puntoDeEmpresa(undefined, undefined), null)
})

test('el cero es una coordenada válida, no un vacío', () => {
  // Golfo de Guinea. Improbable, pero `if (!lat)` lo habría descartado y ese es
  // justo el error clásico al copiar coordenadas.
  assert.deepEqual(puntoDeEmpresa(0, 0), { latitud: 0, longitud: 0 })
})

test('una coordenada fuera de rango no se propaga', () => {
  assert.equal(puntoDeEmpresa(91, 0), null)
  assert.equal(puntoDeEmpresa(0, 181), null)
  assert.equal(puntoDeEmpresa(Number.NaN, 0), null)
  assert.equal(puntoDeEmpresa(Number.POSITIVE_INFINITY, 0), null)
})

test('la sucursal principal recibe las coordenadas de la empresa', () => {
  // Guardia de regresión sobre el flujo, no sobre la función: es fácil añadir
  // un campo nuevo al perfil y volver a olvidarse de propagarlo, que es
  // exactamente lo que pasó con el punto del mapa.
  const src = readFileSync('src/modules/empresas/sucursalPrincipal.ts', 'utf8')
  assert.match(
    src,
    // `[^}]*` ya cruza saltos de línea: no hace falta la bandera `s`, que
    // además no está disponible con el target de este tsconfig.
    /select:\s*\{[^}]*latitud:\s*true[^}]*longitud:\s*true/,
    'ensureSucursalPrincipal debe leer las coordenadas de la empresa'
  )
  assert.match(
    src,
    /OR:\s*\[\{\s*latitud:\s*null\s*\},\s*\{\s*longitud:\s*null\s*\}\]/,
    'debe completar la sucursal cuando le falte cualquiera de las dos coordenadas'
  )
})

test('el perfil de empresa sigue llamando a ensureSucursalPrincipal', () => {
  // Sin esta llamada, colocar el pin no llega nunca a la sucursal y el negocio
  // vuelve a ser invisible en el mapa.
  const src = readFileSync('src/modules/empresas/perfilActions.ts', 'utf8')
  assert.ok(
    src.includes('ensureSucursalPrincipal('),
    'guardar el perfil debe propagar los datos a la sucursal principal'
  )
})
