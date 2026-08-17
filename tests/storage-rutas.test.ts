import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  rutaPromocion,
  rutaCampana,
  rutaEvidencia,
  tienePrefijoDeEmpresa,
  CARPETA_SIN_GUARDAR,
  CARPETA_SUELTAS,
} from '../src/lib/storage-rutas'

/**
 * Lo que se prueba aquí no es «la función concatena cadenas» —eso se ve
 * leyéndola— sino la invariante de la que depende la política de RLS: la
 * empresa SIEMPRE va en el primer segmento. Si eso deja de cumplirse, la
 * política deja de proteger y nadie se entera, porque las subidas siguen
 * funcionando.
 */

const EMPRESA = 'cmp_abc123'

test('la empresa va siempre primero, en los tres tipos', () => {
  const rutas = [
    rutaPromocion(EMPRESA, 'promo_1', 'x.jpg'),
    rutaCampana(EMPRESA, 'camp_1', 'x.jpg'),
    rutaEvidencia(EMPRESA, 'cola_1', 'x.jpg'),
  ]
  for (const r of rutas) {
    assert.equal(r.split('/')[0], EMPRESA, `${r} no empieza por la empresa`)
  }
})

test('sin entidad guardada, la carpeta compartida cuelga de la empresa', () => {
  // Éste es el caso que abría el agujero: antes daba 'nueva/x.jpg', una
  // carpeta que compartían TODAS las empresas.
  assert.equal(rutaPromocion(EMPRESA, null, 'x.jpg'), `${EMPRESA}/${CARPETA_SIN_GUARDAR}/x.jpg`)
  assert.equal(rutaCampana(EMPRESA, undefined, 'x.jpg'), `${EMPRESA}/invitaciones/${CARPETA_SIN_GUARDAR}/x.jpg`)
  assert.equal(rutaEvidencia(EMPRESA, null, 'x.jpg'), `${EMPRESA}/${CARPETA_SUELTAS}/x.jpg`)
})

test('formas completas', () => {
  assert.equal(rutaPromocion(EMPRESA, 'promo_1', 'a.webp'), 'cmp_abc123/promo_1/a.webp')
  assert.equal(rutaCampana(EMPRESA, 'camp_1', 'a.webp'), 'cmp_abc123/invitaciones/camp_1/a.webp')
  assert.equal(rutaEvidencia(EMPRESA, 'cola_1', 'a.webp'), 'cmp_abc123/cola_1/a.webp')
})

test('una empresa vacía es un error, no una ruta sin prefijo', () => {
  // Sin esto, un companyId vacío daría '/nueva/x.jpg': el archivo caería
  // fuera del alcance de la política y la subida parecería correcta.
  assert.throws(() => rutaPromocion('', 'p', 'x.jpg'), /companyId vacío/)
  assert.throws(() => rutaPromocion('   ', 'p', 'x.jpg'), /companyId vacío/)
  assert.throws(() => rutaEvidencia('', null, 'x.jpg'), /companyId vacío/)
})

test('no se puede salir de la carpeta con .. ni con barras', () => {
  assert.throws(() => rutaPromocion('../otra', 'p', 'x.jpg'), /no permitidos/)
  assert.throws(() => rutaPromocion(EMPRESA, 'a/b', 'x.jpg'), /no permitidos/)
  assert.throws(() => rutaEvidencia(EMPRESA, '..', 'x.jpg'), /no permitidos/)
})

test('el archivo también se valida', () => {
  assert.throws(() => rutaPromocion(EMPRESA, 'p', ''), /archivo vacío/)
  assert.throws(() => rutaPromocion(EMPRESA, 'p', 'sub/x.jpg'), /no permitidos/)
})

test('tienePrefijoDeEmpresa distingue el formato nuevo del heredado', () => {
  assert.equal(tienePrefijoDeEmpresa('cmp_abc123/promo_1/x.jpg', EMPRESA), true)
  assert.equal(tienePrefijoDeEmpresa('promo_1/x.jpg', EMPRESA), false)
  assert.equal(tienePrefijoDeEmpresa('nueva/x.jpg', EMPRESA), false)
  // No debe confundirse con otra empresa cuyo id empiece igual.
  assert.equal(tienePrefijoDeEmpresa('cmp_abc1234/promo_1/x.jpg', EMPRESA), false)
})
