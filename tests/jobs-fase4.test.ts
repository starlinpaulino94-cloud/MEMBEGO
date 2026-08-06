/**
 * Fase 4 · Componente 5 — sinks QStash (email, evento-estrategia,
 * recompensas-referido). Ejecutar: npm test
 *
 * Se prueban las piezas PUAS y deterministas: la clave de deduplicación y la
 * ejecución del trabajo de correo sin proveedor. El resto (flip del evento,
 * recompensas, entrega real) toca base de datos y se verifica en smoke manual
 * según docs/COLAS.md.
 */

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { claveDedup } from '../src/modules/jobs/cola'
import { ejecutarTrabajo } from '../src/modules/jobs/ejecutor'

beforeEach(() => {
  delete process.env.QSTASH_TOKEN
})

// ── Clave de deduplicación ───────────────────────────────────────────────────

test('claveDedup email: estable por contenido', () => {
  const a = claveDedup({ tipo: 'email', to: 'a@b.c', subject: 'Recibo', html: '<p>x</p>' })
  const b = claveDedup({ tipo: 'email', to: 'a@b.c', subject: 'Recibo', html: '<p>x</p>' })
  assert.equal(a, b)
  assert.ok(a.startsWith('email:'))
})

test('claveDedup email: cambia si cambia el destinatario o el contenido', () => {
  const base = { tipo: 'email' as const, subject: 'Recibo', html: '<p>x</p>' }
  const paraOtro = claveDedup({ ...base, to: 'otro@b.c' })
  const otroContenido = claveDedup({ ...base, to: 'a@b.c', html: '<p>y</p>' })
  const original = claveDedup({ ...base, to: 'a@b.c' })
  assert.notEqual(paraOtro, original)
  assert.notEqual(otroContenido, original)
})

test('claveDedup evento-estrategia: por eventoId', () => {
  const a = claveDedup({ tipo: 'evento-estrategia', eventoId: 'evt-1', companyId: 'c1' })
  assert.equal(a, 'evt:evt-1')
  assert.notEqual(
    a,
    claveDedup({ tipo: 'evento-estrategia', eventoId: 'evt-2', companyId: 'c1' })
  )
})

test('claveDedup recompensas: por conversión, no por referente', () => {
  // Dos conversiones del MISMO referente deben producir dos trabajos distintos.
  const primera = claveDedup({
    tipo: 'recompensas-referido',
    companyId: 'c1',
    referenteClienteId: 'r1',
    referidoId: 'conv-1',
  })
  const segunda = claveDedup({
    tipo: 'recompensas-referido',
    companyId: 'c1',
    referenteClienteId: 'r1',
    referidoId: 'conv-2',
  })
  assert.equal(primera, 'recomp:c1:conv-1')
  assert.notEqual(primera, segunda)
})

// ── Ejecución del trabajo de correo ──────────────────────────────────────────

test('ejecutarTrabajo email sin RESEND_API_KEY → no enviado, sin lanzar', async () => {
  const prev = process.env.RESEND_API_KEY
  delete process.env.RESEND_API_KEY
  try {
    const r = await ejecutarTrabajo({ tipo: 'email', to: 'a@b.c', subject: 'Recibo' })
    assert.equal(r.procesados, 0)
    assert.equal(r.detalle, 'RESEND_API_KEY no configurada')
  } finally {
    if (prev === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = prev
  }
})

test('ejecutarTrabajo email con destinatario inválido → no enviado', async () => {
  const prev = process.env.RESEND_API_KEY
  delete process.env.RESEND_API_KEY
  try {
    const r = await ejecutarTrabajo({ tipo: 'email', to: 'no-correo', subject: 'x' })
    assert.equal(r.procesados, 0)
    assert.equal(r.detalle, 'destinatario inválido')
  } finally {
    if (prev === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = prev
  }
})
