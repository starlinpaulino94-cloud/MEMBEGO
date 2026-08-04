/**
 * Visitas · esquema Zod — validación del formulario de `confirmarVisita`
 * (`src/modules/visitas/schema.ts`).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { confirmarVisitaSchema } from '../src/modules/visitas/schema'

test('confirmarVisita válido: opcionales vacíos a null', () => {
  const r = confirmarVisitaSchema.safeParse({
    membershipId: 'mem-1',
    servicio: 'Lavado',
    vehiculoId: '',
    notas: '  ',
    sucursalId: 'suc-1',
    qrTokenId: '',
  })
  assert.equal(r.success, true)
  if (!r.success) return
  assert.equal(r.data.membershipId, 'mem-1')
  assert.equal(r.data.servicio, 'Lavado')
  assert.equal(r.data.vehiculoId, null)
  assert.equal(r.data.notas, null)
  assert.equal(r.data.sucursalId, 'suc-1')
  assert.equal(r.data.qrTokenId, null)
})

test('confirmarVisita: membresía obligatoria', () => {
  const r = confirmarVisitaSchema.safeParse({
    membershipId: '',
    servicio: 'Lavado',
    vehiculoId: '',
    notas: '',
    sucursalId: '',
    qrTokenId: '',
  })
  assert.equal(r.success, false)
  if (r.success) return
  assert.equal(
    r.error.issues[0].message,
    'No se encontró la membresía. Escanea el QR de nuevo.'
  )
})

test('confirmarVisita: servicio obligatorio', () => {
  const r = confirmarVisitaSchema.safeParse({
    membershipId: 'mem-1',
    servicio: '  ',
    vehiculoId: '',
    notas: '',
    sucursalId: '',
    qrTokenId: '',
  })
  assert.equal(r.success, false)
  if (r.success) return
  assert.equal(r.error.issues[0].message, 'Selecciona un servicio antes de confirmar.')
})
