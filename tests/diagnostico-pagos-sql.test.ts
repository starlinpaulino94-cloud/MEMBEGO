/**
 * El SQL de diagnóstico de pagos con tarjeta se pega en producción: tiene que ser SOLO LECTURA, hoy y después de cualquier edición.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SQL = readFileSync('scripts/diagnostico-pagos-con-tarjeta.sql', 'utf8')
// Sin comentarios: lo que cuenta es lo que se ejecuta.
const EJECUTABLE = SQL.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

test('solo tiene SELECT: ninguna instrucción que escriba, borre o cambie el esquema', () => {
  assert.doesNotMatch(EJECUTABLE, /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|vacuum)\b/i)
  assert.match(EJECUTABLE, /\bselect\b/i)
})

test('usa la misma clasificación de la pantalla: producto activo a partir del cobro, y 2 minutos de entrega en curso', () => {
  assert.match(EJECUTABLE, /p\."updatedAt" > now\(\) - interval '2 minutes'/)
  assert.match(EJECUTABLE, /m\."fechaPago" >= p\."activadoAt" - interval '1 minute'/)
  assert.match(EJECUTABLE, /k\."fechaActivacion" >= p\."activadoAt" - interval '1 minute'/)
})

test('no toca ni selecciona datos de tarjeta ni personales', () => {
  assert.doesNotMatch(EJECUTABLE, /token|ultimos4|tarjetas_tokenizadas|email|telefono|nombre/i)
})
