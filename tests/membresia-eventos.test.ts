/**
 * LA HISTORIA DE UNA MEMBRESÍA · Fase 1.
 *
 * Dos clases de prueba, y la segunda es la que de verdad protege:
 *
 *  1. `clasificarCambioPlan` — función pura, se prueba con valores.
 *  2. Guardias de fuente: que CADA punto que cambia una membresía emita su
 *     evento. Los módulos de servidor no se pueden importar aquí
 *     (`server-only`), así que se lee el ARCHIVO con los comentarios quitados
 *     — si no, una prueba se daría por satisfecha leyendo la explicación de lo
 *     que vigila.
 *
 * Por qué la segunda importa más: un evento que se deja de emitir no rompe
 * nada. La venta sigue, el cliente no se entera, y el reporte simplemente
 * cuenta de menos. Es el fallo más caro de todos — el que nadie ve.
 *
 * Ejecutar: npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { clasificarCambioPlan } from '../src/modules/membresia/eventosNucleo'

function fuente(...ruta: string[]): string {
  return readFileSync(join(__dirname, '..', ...ruta), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// ── Subida, bajada o lateral ─────────────────────────────────────────────────

test('el cambio de plan se clasifica por los precios guardados', () => {
  assert.equal(clasificarCambioPlan(1800, 3000), 'SUBIDA')
  assert.equal(clasificarCambioPlan(3000, 1800), 'BAJADA')
  assert.equal(clasificarCambioPlan(1800, 1800), 'LATERAL')
})

test('sin precios es DESCONOCIDO, que no es lo mismo que LATERAL', () => {
  // «Lateral» afirma que pagó lo mismo. Decir eso sin tener los dos importes
  // sería inventarse el hecho, y el reporte lo enseña en su propia fila.
  assert.equal(clasificarCambioPlan(null, 1800), 'DESCONOCIDO')
  assert.equal(clasificarCambioPlan(1800, null), 'DESCONOCIDO')
  assert.equal(clasificarCambioPlan(undefined, undefined), 'DESCONOCIDO')
  assert.equal(clasificarCambioPlan(NaN, 1800), 'DESCONOCIDO')
})

test('un plan gratis no confunde: 0 es un precio, no una ausencia', () => {
  assert.equal(clasificarCambioPlan(0, 1800), 'SUBIDA')
  assert.equal(clasificarCambioPlan(1800, 0), 'BAJADA')
  assert.equal(clasificarCambioPlan(0, 0), 'LATERAL')
})

// ── Que el evento se escriba donde la membresía cambia ───────────────────────

test('cada punto que muta una membresía emite su evento', () => {
  const puntos: { archivo: string[]; tipo: string; que: string }[] = [
    { archivo: ['src', 'modules', 'admin', 'actions.ts'], tipo: "'CANCELADA'", que: 'el admin cancela' },
    { archivo: ['src', 'modules', 'admin', 'actions.ts'], tipo: "'RENOVADA'", que: 'el admin renueva' },
    { archivo: ['src', 'modules', 'admin', 'actions.ts'], tipo: "'CAMBIO_PLAN'", que: 'el admin cambia el plan' },
    { archivo: ['src', 'modules', 'admin', 'planActions.ts'], tipo: "'CANCELADA'", que: 'cancelar desde planes' },
    { archivo: ['src', 'modules', 'admin', 'planActions.ts'], tipo: "'VENCIDA'", que: 'desactivar a mano' },
    { archivo: ['src', 'modules', 'membresia', 'actions.ts'], tipo: "'CANCELADA'", que: 'el cliente cancela' },
    { archivo: ['src', 'modules', 'membresia', 'vencimiento.ts'], tipo: "'VENCIDA'", que: 'el job de vencimiento' },
    { archivo: ['src', 'modules', 'pagos', 'cardnetTokenGuardado.ts'], tipo: "'RENOVADA'", que: 'la renovación con tarjeta' },
  ]

  for (const p of puntos) {
    const src = fuente(...p.archivo)
    assert.match(src, /registrarEventoMembresia\(/, `${p.que}: no llama al emisor`)
    assert.ok(src.includes(`tipo: ${p.tipo}`), `${p.que}: no emite ${p.tipo}`)
  }
})

test('la activación distingue una venta nueva de una vuelta', () => {
  // La misma función activa una membresía nueva y reactiva una vencida. Para
  // el negocio no es lo mismo, y `fechaInicio == null` es lo que las separa.
  const src = fuente('src', 'modules', 'pagos', 'activacion.ts')
  assert.match(src, /registrarEventoMembresia\(/)
  assert.match(src, /fechaInicio == null \? 'ACTIVADA' : 'RENOVADA'/)
})

test('la renovación con tarjeta se marca como automática', () => {
  // Sin `origen: CRON` no se puede separar del mostrador, y son dos hechos que
  // el negocio lee muy distinto.
  const src = fuente('src', 'modules', 'pagos', 'cardnetTokenGuardado.ts')
  assert.match(src, /origen: 'CRON'/)
})

test('el emisor no puede tumbar la operación que lo produjo', () => {
  // Cancelar una membresía no puede fallar porque una tabla de reportes no
  // exista todavía. Misma decisión que `auditarPlan`, y por el mismo motivo.
  const src = fuente('src', 'modules', 'membresia', 'eventos.ts')
  assert.match(src, /\.catch\(anotarFallo\(/)
})

test('la cancelación del admin guarda el motivo', () => {
  const src = fuente('src', 'modules', 'admin', 'actions.ts')
  assert.match(src, /motivoCancelacion: motivo \|\| null/)
})

// ── El backfill: qué recupera y qué se niega a recuperar ─────────────────────

test('el backfill descarta las tandas de vencimiento automático', () => {
  // El job escribe UNA entrada por empresa con los ids dentro del payload y
  // truncados a 200. Sacar membresías de ahí daría un recuento que parece
  // completo y no lo es.
  const sql = readFileSync(
    join(__dirname, '..', 'prisma', 'migrations', '20260918_membresia_eventos_backfill', 'migration.sql'),
    'utf8'
  )
  assert.match(sql, /<> 'VENCIMIENTO_AUTOMATICO'/)
})

test('todo lo reconstruido queda marcado como tal', () => {
  const sql = readFileSync(
    join(__dirname, '..', 'prisma', 'migrations', '20260918_membresia_eventos_backfill', 'migration.sql'),
    'utf8'
  )
  // Tres inserciones, las tres con su marca: sin esto, el reporte no puede
  // decir hasta dónde llega el dato de primera mano.
  const inserciones = (sql.match(/INSERT INTO "membresia_eventos"/g) ?? []).length
  const marcas = (sql.match(/'RECONSTRUIDO'::"MembresiaEventoOrigen"/g) ?? []).length
  assert.equal(inserciones, 3)
  assert.equal(marcas, 3)
  assert.equal((sql.match(/NOT EXISTS/g) ?? []).length, 3, 'las tres deben ser idempotentes')
})

test('el backfill no inventa activaciones ni cambios de plan', () => {
  // Los dos se auditan como PAGO_APROBADO, mezclados con cobros que no son
  // ninguna de las dos cosas. Adivinarlos por la forma del payload sería
  // exactamente lo que el runbook prohíbe.
  const sql = readFileSync(
    join(__dirname, '..', 'prisma', 'migrations', '20260918_membresia_eventos_backfill', 'migration.sql'),
    'utf8'
  )
  assert.doesNotMatch(sql, /'ACTIVADA'::"MembresiaEventoTipo"/)
  assert.doesNotMatch(sql, /'CAMBIO_PLAN'::"MembresiaEventoTipo"/)
})
