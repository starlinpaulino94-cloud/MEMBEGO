/**
 * Registro · esquemas Zod — pruebas de la validación de formulario de
 * `src/modules/registro/schema.ts`, la MISMA que usan `registrarCliente` y
 * `registrarCuentaGeneral` en producción.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registroSchema } from '../src/modules/registro/schema'

const base = {
  companySlug: 'lavadero-prueba',
  nombre: '  Ana Pérez ',
  email: '  ANA@ejemplo.com ',
  password: 'secreto123',
  telefono: '8295551234',
  terminos: 'on',
  refCode: '',
  campanaId: '',
  glCode: '',
  canalDeclarado: '',
  marca: '',
  modelo: '',
  anioRaw: '',
  color: '',
  placa: '',
}

test('registro válido: normaliza y pasa', () => {
  const r = registroSchema.safeParse(base)
  assert.equal(r.success, true)
  if (!r.success) return
  assert.equal(r.data.nombre, 'Ana Pérez')
  assert.equal(r.data.email, 'ana@ejemplo.com')
  assert.equal(r.data.campanaId, undefined)
  assert.equal(r.data.canalDeclarado, null)
})

test('registro válido: mantiene refCode, glCode y placa', () => {
  const r = registroSchema.safeParse({
    ...base,
    refCode: 'ABC123',
    glCode: 'GL-9',
    placa: 'A123456',
  })
  assert.equal(r.success, true)
  if (!r.success) return
  assert.equal(r.data.refCode, 'ABC123')
  assert.equal(r.data.glCode, 'GL-9')
  assert.equal(r.data.placa, 'A123456')
})

test('campos obligatorios vacíos', () => {
  const r = registroSchema.safeParse({ ...base, nombre: '', email: '', password: '' })
  assert.equal(r.success, false)
  if (r.success) return
  assert.equal(r.error.issues[0].message, 'Completa todos los campos obligatorios.')
})

test('solo password vacío también pide completar campos', () => {
  const r = registroSchema.safeParse({ ...base, password: '' })
  assert.equal(r.success, false)
  if (r.success) return
  assert.equal(r.error.issues[0].message, 'Completa todos los campos obligatorios.')
})

test('contraseña corta', () => {
  const r = registroSchema.safeParse({ ...base, password: '12345' })
  assert.equal(r.success, false)
  if (r.success) return
  assert.equal(r.error.issues[0].message, 'La contraseña debe tener al menos 6 caracteres.')
})

test('contraseña corta tiene precedencia sobre teléfono inválido', () => {
  const r = registroSchema.safeParse({ ...base, password: '12345', telefono: '12' })
  assert.equal(r.success, false)
  if (r.success) return
  assert.equal(r.error.issues[0].message, 'La contraseña debe tener al menos 6 caracteres.')
})

test('teléfono con menos de 7 dígitos', () => {
  const r = registroSchema.safeParse({ ...base, telefono: '12' })
  assert.equal(r.success, false)
  if (r.success) return
  assert.equal(r.error.issues[0].message, 'Ingresa un número de teléfono válido.')
})

test('teléfono con 7 dígitos pasa', () => {
  const r = registroSchema.safeParse({ ...base, telefono: '+1 809 123 456' })
  assert.equal(r.success, true)
})

test('términos sin marcar', () => {
  const r = registroSchema.safeParse({ ...base, terminos: 'off' })
  assert.equal(r.success, false)
  if (r.success) return
  assert.equal(
    r.error.issues[0].message,
    'Debes aceptar los términos y la política de privacidad.'
  )
})
