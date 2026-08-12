import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  coordenadasDeEnlaceGoogleMaps,
  esEnlaceCortoGoogleMaps,
} from '../src/modules/geo/enlace-google-maps'

/**
 * COORDENADAS DESDE EL ENLACE DE GOOGLE MAPS.
 *
 * El dueño pega el enlace de su negocio y el pin se marca solo. Estas pruebas
 * fijan los formatos reales de Google y la prioridad entre ellos: el pin del
 * lugar (!3d!4d) manda sobre el centro del visor (@), porque el visor es donde
 * estaba la cámara, no donde está el negocio.
 */

test('el pin del lugar (!3d!4d) se extrae y manda sobre el visor', () => {
  const url =
    'https://www.google.com/maps/place/Restaurante/@18.5000,-69.9500,15z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d18.4795!4d-69.8920!16s'
  assert.deepEqual(coordenadasDeEnlaceGoogleMaps(url), { lat: 18.4795, lng: -69.892 })
})

test('los enlaces de búsqueda (?q= / ?ll= / ?query=) se extraen, aun URL-encodeados', () => {
  assert.deepEqual(coordenadasDeEnlaceGoogleMaps('https://maps.google.com/?q=18.4861,-69.9312'), {
    lat: 18.4861,
    lng: -69.9312,
  })
  assert.deepEqual(
    coordenadasDeEnlaceGoogleMaps('https://www.google.com/maps?ll=18.4861%2C-69.9312&z=15'),
    { lat: 18.4861, lng: -69.9312 }
  )
  assert.deepEqual(
    coordenadasDeEnlaceGoogleMaps(
      'https://www.google.com/maps/search/?api=1&query=18.4861,-69.9312'
    ),
    { lat: 18.4861, lng: -69.9312 }
  )
})

test('el centro del visor (@lat,lng) sirve como último recurso', () => {
  assert.deepEqual(
    coordenadasDeEnlaceGoogleMaps('https://www.google.com/maps/@18.4861,-69.9312,14z'),
    { lat: 18.4861, lng: -69.9312 }
  )
})

test('lo que no trae coordenadas devuelve null, no basura', () => {
  assert.equal(coordenadasDeEnlaceGoogleMaps(''), null)
  assert.equal(coordenadasDeEnlaceGoogleMaps('https://www.google.com/maps?sca_esv=abc&sxsrf=xyz'), null)
  assert.equal(coordenadasDeEnlaceGoogleMaps('no es un enlace'), null)
})

test('coordenadas imposibles y el 0,0 (null island) se rechazan', () => {
  assert.equal(coordenadasDeEnlaceGoogleMaps('https://maps.google.com/?q=95.0,-69.9'), null)
  assert.equal(coordenadasDeEnlaceGoogleMaps('https://maps.google.com/?q=18.4,-190.0'), null)
  assert.equal(coordenadasDeEnlaceGoogleMaps('https://maps.google.com/?q=0,0'), null)
})

test('los enlaces cortos se detectan (los expande el servidor, no el navegador)', () => {
  assert.equal(esEnlaceCortoGoogleMaps('https://maps.app.goo.gl/AbCdEf123'), true)
  assert.equal(esEnlaceCortoGoogleMaps('https://goo.gl/maps/AbCdEf123'), true)
  assert.equal(esEnlaceCortoGoogleMaps('https://www.google.com/maps/@18.4,-69.9,14z'), false)
})
