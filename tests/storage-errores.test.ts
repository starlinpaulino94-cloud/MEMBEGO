import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mensajeDeStorage } from '../src/lib/storage-errores'

const o = { maxMb: 5 }

test('cada causa conocida de Storage recibe un mensaje que la nombra', () => {
  assert.match(mensajeDeStorage({ message: 'Bucket not found' }, o), /bucket «promociones»/)
  assert.match(mensajeDeStorage({ message: 'mime type image/gif is not supported' }, o), /formato/i)
  assert.match(mensajeDeStorage({ message: 'The object exceeded the maximum allowed size' }, o), /5 MB/)
  assert.match(mensajeDeStorage({ message: 'invalid JWT: signature is invalid' }, o), /clave de servicio/)
  assert.match(mensajeDeStorage(new Error('fetch failed'), o), /conexión/)
  assert.match(mensajeDeStorage({ message: 'The resource already exists' }, o), /Ya existe/)
})

test('lo desconocido conserva el mensaje genérico y nunca revienta', () => {
  const generico = 'No se pudo subir la imagen. Intenta de nuevo.'
  assert.equal(mensajeDeStorage({ message: 'algo raro' }, o), generico)
  assert.equal(mensajeDeStorage(null, o), generico)
  assert.equal(mensajeDeStorage(undefined, o), generico)
  assert.equal(mensajeDeStorage(42, o), generico)
})
