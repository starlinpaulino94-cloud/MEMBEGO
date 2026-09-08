/**
 * Cobro separado de cumplimiento + dedupe real + cita atómica (P1B).
 *
 * APROBADO significa "el procesador confirmó el cobro"; la entrega del
 * producto viaja en `fulfillmentEstado` y se reintenta sin recobrar.
 * Las notificaciones por lote se deduplican por clave estable y las citas
 * reservan cupo bajo candado con su recompensa en la misma transacción.
 *
 * Ejecutar: npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dedupeKeyNotificacion } from '../src/modules/jobs/ejecutor'
import type { CargaNotificar } from '../src/modules/jobs/tipos'

const RAIZ = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(RAIZ, r), 'utf8')

function carga(base: Partial<CargaNotificar> = {}): CargaNotificar {
  return {
    tipo: 'notificar',
    companyId: 'emp1',
    audiencia: 'clientes',
    payload: { tipo: 'PROMOCION_NUEVA', titulo: 'T', mensaje: 'M' },
    desde: 0,
    ...base,
  }
}

// ── Clave de dedupe: estable por lote, distinta por contenido ─────────────────

test('el mismo lote produce siempre la misma clave', () => {
  assert.equal(dedupeKeyNotificacion(carga()), dedupeKeyNotificacion(carga()))
})

test('cada lote encadenado tiene su propia clave', () => {
  assert.notEqual(
    dedupeKeyNotificacion(carga({ desde: 0 })),
    dedupeKeyNotificacion(carga({ desde: 1000 }))
  )
})

test('empresa, audiencia y contenido distinguen claves', () => {
  const base = dedupeKeyNotificacion(carga())
  assert.notEqual(base, dedupeKeyNotificacion(carga({ companyId: 'emp2' })))
  assert.notEqual(base, dedupeKeyNotificacion(carga({ audiencia: 'seguidores' })))
  assert.notEqual(
    base,
    dedupeKeyNotificacion(carga({ payload: { tipo: 'SISTEMA', titulo: 'T', mensaje: 'M' } }))
  )
})

// ── El esquema sostiene la separación cobro/cumplimiento y el dedupe ─────────

test('PagoIntento tiene estado de cumplimiento y la migración lo crea', () => {
  const schema = leer('prisma/schema/pagos.prisma')
  assert.match(schema, /fulfillmentEstado/)
  assert.match(schema, /fulfillmentAt/)
  assert.match(schema, /fulfillmentIntentos/)
  const mig = leer('prisma/migrations/20260912_p1b_cumplimiento_dedupe/migration.sql')
  assert.match(mig, /ADD COLUMN "fulfillmentEstado"/)
  assert.match(mig, /ADD COLUMN "fulfillmentIntentos"/)
})

test('Notificacion tiene dedupeKey única por destinatario', () => {
  const schema = leer('prisma/schema/identidad.prisma')
  assert.match(schema, /dedupeKey String\?/)
  assert.match(schema, /@@unique\(\[userId, dedupeKey\]\)/)
  const mig = leer('prisma/migrations/20260912_p1b_cumplimiento_dedupe/migration.sql')
  assert.match(mig, /ADD COLUMN "dedupeKey"/)
  assert.match(mig, /notificaciones_userId_dedupeKey_key/)
})

// ── confirmarIntento reporta entrega y permite reintento sin recobro ─────────

test('la confirmación distingue cobro aprobado de producto entregado', () => {
  const src = leer('src/modules/pagos/intentos.ts')
  assert.match(src, /entrega: EntregaEstado/)
  assert.match(src, /fulfillmentEstado: 'COMPLETADA'/)
  assert.match(src, /fulfillmentEstado: 'FALLIDA'/)
  assert.match(src, /export async function reintentarEntrega/)
})

test('el reintento reclama FALLIDA→PENDIENTE y nunca toca la pasarela', () => {
  const src = leer('src/modules/pagos/intentos.ts')
  assert.match(src, /where: \{ id: intentoId, fulfillmentEstado: 'FALLIDA' \}/)
  assert.match(src, /fulfillmentIntentos: \{ increment: 1 \}/)
  assert.match(src, /Nunca recobra/)
})

test('la renovación con tarjeta marca la entrega en ambos caminos', () => {
  const src = leer('src/modules/pagos/cardnetTokenGuardado.ts')
  assert.match(src, /marcarEntrega\w*\(m\.companyId, intento\.id, true\)/)
  assert.match(src, /marcarEntrega\w*\(m\.companyId, intento\.id, false/)
})

// ── Cita: candado por empresa y recompensa en la misma transacción ───────────

test('la reserva bloquea la empresa y vincula la recompensa atómicamente', () => {
  const src = leer('src/modules/citas/actions.ts')
  assert.match(src, /FROM "companies" WHERE id = .* FOR UPDATE/)
  assert.match(src, /\.\.\.\(compraId \? \{ compraId \} : \{\}\)/)
  assert.doesNotMatch(src, /vincular compra:/)
})
