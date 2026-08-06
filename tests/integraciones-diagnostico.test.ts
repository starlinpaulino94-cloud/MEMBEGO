import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diagnosticarSonda, type RespuestaSonda } from '../src/modules/integraciones/diagnostico'

/**
 * El valor de este módulo no es técnico: es que una persona sin terminal sepa
 * A QUIÉN le toca arreglar el fallo. Un diagnóstico que confunda «el dominio
 * no existe» con «falta la ruta» manda al equipo equivocado a buscar durante
 * días — que es exactamente lo que pasó antes de escribirlo.
 */

const R = (status: number, cuerpo = '', error?: string): RespuestaSonda => ({ status, cuerpo, error })

test('sin respuesta señala la red, no el código del satélite', () => {
  const d = diagnosticarSonda(R(0, '', 'fetch failed'), R(0, '', 'fetch failed'))
  assert.equal(d.gravedad, 'falla')
  assert.match(d.titulo, /conectar/i)
  assert.match(d.siguiente, /DNS|proveedor/i)
})

test('un 2xx es entrega: no hay nada que arreglar', () => {
  const d = diagnosticarSonda(R(405), R(200, '{"ok":true}'))
  assert.equal(d.gravedad, 'ok')
  assert.match(d.siguiente, /reenv/i)
})

test('404 con cuerpo de la plataforma culpa al dominio, no a la ruta', () => {
  // Este es el caso que más tiempo cuesta: el equipo del satélite jura que la
  // ruta existe, y tienen razón — lo que falta es el dominio en el proyecto.
  const cuerpo = '{"error":{"code":"DEPLOYMENT_NOT_FOUND"}}'
  const d = diagnosticarSonda(R(404, cuerpo), R(404, cuerpo))
  assert.match(d.titulo, /dominio/i)
  assert.match(d.siguiente, /dominio/i)
  assert.doesNotMatch(d.siguiente, /route\.ts/)
})

test('404 en GET y POST, sin marca de plataforma, es la ruta que falta', () => {
  const d = diagnosticarSonda(R(404, '<html>404</html>'), R(404, '<html>404</html>'))
  assert.match(d.titulo, /ruta.*no existe/i)
  assert.match(d.siguiente, /route\.ts/)
  assert.match(d.siguiente, /POST/)
})

test('405 en GET con 404 en POST NO es la ruta que falta', () => {
  // Distinción fina y crítica: 405 al GET demuestra que el enrutador conoce la
  // ruta. Si aun así el POST da 404, el 404 sale de DENTRO del handler.
  const d = diagnosticarSonda(R(405), R(404, '{"error":"empresa no vinculada"}'))
  assert.match(d.titulo, /handler/i)
  assert.doesNotMatch(d.titulo, /no existe/i)
  assert.match(d.siguiente, /dentro del handler/i)
})

test('401 y 403 apuntan al secreto compartido, no a la ruta', () => {
  for (const status of [401, 403]) {
    const d = diagnosticarSonda(R(405), R(status, 'firma inválida'))
    assert.match(d.titulo, /firma/i, `status ${status}`)
    assert.match(d.siguiente, /md5|secreto/i, `status ${status}`)
    assert.match(d.siguiente, /cuerpo crudo/i, `status ${status}`)
  }
})

test('405 al POST señala el handler que no se exportó', () => {
  const d = diagnosticarSonda(R(200), R(405))
  assert.match(d.titulo, /no acepta POST/i)
  assert.match(d.siguiente, /exportar/i)
})

test('un 5xx es progreso: la conexión ya funciona', () => {
  const d = diagnosticarSonda(R(405), R(500, 'Internal Server Error'))
  assert.match(d.detalle, /llegó al código/i)
  assert.match(d.siguiente, /logs/i)
})

test('un código inesperado no se traga el cuerpo: lo enseña', () => {
  const d = diagnosticarSonda(R(200), R(429, 'demasiadas peticiones'))
  assert.match(d.detalle, /demasiadas peticiones/)
  assert.equal(d.gravedad, 'falla')
})

test('ningún diagnóstico sale vacío ni sin próximo paso', () => {
  // Una pantalla que dice «error» y no dice qué hacer es peor que no tenerla.
  const casos: Array<[RespuestaSonda, RespuestaSonda]> = [
    [R(0, '', 'timeout'), R(0, '', 'timeout')],
    [R(405), R(200)],
    [R(404), R(404)],
    [R(405), R(404)],
    [R(405), R(401)],
    [R(200), R(405)],
    [R(405), R(503)],
    [R(301), R(302, 'redirigido')],
  ]
  for (const [get, post] of casos) {
    const d = diagnosticarSonda(get, post)
    assert.ok(d.titulo.length > 10, `título pobre para ${get.status}/${post.status}`)
    assert.ok(d.detalle.length > 10, `detalle pobre para ${get.status}/${post.status}`)
    assert.ok(d.siguiente.length > 10, `sin próximo paso para ${get.status}/${post.status}`)
  }
})
