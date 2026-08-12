import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validarDimensionesPromo, PROMO_IMG } from '../src/modules/promociones/formato-imagen'

/**
 * EL FORMATO DE LA IMAGEN DE PROMOCIÓN (decisión de producto, 12-08-2026).
 *
 * La regla: cuadrada (formato Instagram), mínimo 1080 px por lado. La subida
 * la EXIGE; el detalle del cliente dibuja su caja con esa proporción. Estas
 * pruebas protegen las dos mitades de la regla y, sobre todo, los mensajes:
 * el error debe decir qué se necesita y qué midió el archivo.
 */

test('el formato canónico pasa', () => {
  assert.equal(validarDimensionesPromo(PROMO_IMG.width, PROMO_IMG.height), null)
})

test('una exportación a 2x (mismo formato, más resolución) pasa', () => {
  assert.equal(validarDimensionesPromo(2160, 2160), null)
})

test('un recorte casi cuadrado dentro de la tolerancia pasa', () => {
  assert.equal(validarDimensionesPromo(1080, 1100), null)
})

test('el banner apaisado de las tarjetas OG (1728×910) se rechaza con medidas', () => {
  const error = validarDimensionesPromo(1728, 910)
  assert.ok(error, 'debe rechazarse')
  assert.match(error!, /Instagram/i)
  assert.match(error!, /1728×910/, 'el mensaje debe decir qué midió el archivo')
})

test('el vertical 4:5 de Instagram pasa: el formato es un rango, no solo el cuadrado', () => {
  assert.equal(validarDimensionesPromo(1080, 1350), null)
})

test('el arte real que destapó el rango (1122×1402, 4:5) pasa', () => {
  assert.equal(validarDimensionesPromo(1122, 1402), null)
})

test('el vertical extremo de historia (9:16) se rechaza', () => {
  assert.ok(validarDimensionesPromo(1080, 1920))
})

test('un cuadrado pequeño se rechaza por nitidez, no por proporción', () => {
  const error = validarDimensionesPromo(640, 640)
  assert.ok(error, 'debe rechazarse')
  assert.match(error!, /pequeña/i)
  assert.match(error!, /1080/)
})

test('dimensiones ilegibles (0 o NaN) dan un error accionable, no una división rara', () => {
  assert.ok(validarDimensionesPromo(0, 0))
  assert.ok(validarDimensionesPromo(Number.NaN, 1080))
})
