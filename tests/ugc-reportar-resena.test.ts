import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'

// Esquema Zod de reporte de reseñas UGC
export const reportarResenaSchema = z.object({
  resenaId: z.string().min(1, 'El ID de la reseña es obligatorio.'),
  companySlug: z.string().min(1, 'El comercio es obligatorio.'),
  motivo: z.enum(['OFENSIVO', 'SPAM', 'ENGANOSO', 'ACOSO', 'OTRO']),
  detalle: z.string().max(500).optional().default(''),
})

test('reportarResenaSchema: datos válidos pasan la validación', () => {
  const result = reportarResenaSchema.safeParse({
    resenaId: 'resena-123',
    companySlug: 'car-wash-elite',
    motivo: 'OFENSIVO',
    detalle: 'Contiene lenguaje inapropiado.',
  })
  assert.equal(result.success, true)
  if (!result.success) return
  assert.equal(result.data.resenaId, 'resena-123')
  assert.equal(result.data.motivo, 'OFENSIVO')
})

test('reportarResenaSchema: motivo no válido es rechazado', () => {
  const result = reportarResenaSchema.safeParse({
    resenaId: 'resena-123',
    companySlug: 'car-wash-elite',
    motivo: 'INVALIDO',
  })
  assert.equal(result.success, false)
})

test('reportarResenaSchema: resenaId vacío es rechazado', () => {
  const result = reportarResenaSchema.safeParse({
    resenaId: '',
    companySlug: 'car-wash-elite',
    motivo: 'SPAM',
  })
  assert.equal(result.success, false)
})

test('reportarResenaSchema: detalle largo (>500 caracteres) es rechazado', () => {
  const result = reportarResenaSchema.safeParse({
    resenaId: 'resena-123',
    companySlug: 'car-wash-elite',
    motivo: 'SPAM',
    detalle: 'a'.repeat(501),
  })
  assert.equal(result.success, false)
})

test('reportarResenaSchema: detalle es opcional y adopta string vacío por defecto', () => {
  const result = reportarResenaSchema.safeParse({
    resenaId: 'resena-123',
    companySlug: 'car-wash-elite',
    motivo: 'OTRO',
  })
  assert.equal(result.success, true)
  if (!result.success) return
  assert.equal(result.data.detalle, '')
})
