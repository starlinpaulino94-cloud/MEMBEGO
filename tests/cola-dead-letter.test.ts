import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * MEMBEGO CONNECT · Fase 2 — dead letter y salud de la cola.
 *
 * Nada de esto se puede ejecutar sin QStash y sin base, así que se vigila la
 * ESTRUCTURA leyendo el fuente — el mismo estilo que el resto de la suite:
 * cada prueba protege una decisión que costó tomar, para que un refactor
 * distraído no la deshaga en silencio.
 */

const raiz = join(__dirname, '..')
const leer = (ruta: string) => readFileSync(join(raiz, ruta), 'utf8')

// ─── Migración ───────────────────────────────────────────────────────────────

const MIGRACION = leer('prisma/migrations/20260831_cola_dead_letter/migration.sql')

test('cola/migración: trabajos_muertos con estados válidos e idempotente', () => {
  assert.match(MIGRACION, /CREATE TABLE IF NOT EXISTS "trabajos_muertos"/)
  assert.match(MIGRACION, /"trabajos_muertos_estado_valido"[\s\S]*?'PENDIENTE','REENCOLADO','DESCARTADO'/)
  // El unique sobre mensajeId ES la idempotencia del callback: sin él, cada
  // reintento del callback duplicaría el difunto.
  assert.match(MIGRACION, /CREATE UNIQUE INDEX IF NOT EXISTS "trabajos_muertos_mensajeId_key"/)
  assert.equal(/CREATE TABLE (?!IF NOT EXISTS)/.test(MIGRACION), false)
})

test('cola/migración: las decisiones del superadmin entran al enum de auditoría', () => {
  assert.match(MIGRACION, /ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'COLA_REENCOLADA'/)
  assert.match(MIGRACION, /ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'COLA_DESCARTADA'/)
})

// ─── El callback de fallo está cableado de punta a punta ─────────────────────

test('cola/encolar: publica con el failure callback puesto', () => {
  const cola = leer('src/modules/jobs/cola.ts')
  assert.match(cola, /rutaFallo: RUTA_TRABAJOS_MUERTOS/)
  const qstash = leer('src/lib/jobs/qstash.ts')
  assert.match(qstash, /Upstash-Failure-Callback/)
})

test('cola/callback: verifica la firma sobre el cuerpo CRUDO antes de tocar nada', () => {
  const ruta = leer('src/app/api/jobs/muerto/route.ts')
  // El orden es la garantía: primero el texto crudo, después verificar, y solo
  // entonces JSON.parse. Parsear antes de verificar rompería la verificación
  // de mensajes legítimos y abriría la de los ilegítimos.
  const iTexto = ruta.indexOf('await request.text()')
  const iVerifica = ruta.indexOf('verificarFirma(')
  const iParse = ruta.indexOf('JSON.parse(cuerpoCrudo)')
  assert.ok(iTexto > -1 && iVerifica > iTexto && iParse > iVerifica)
  // Sin clave de firma: 503 y nada se ejecuta — igual que /api/jobs.
  assert.match(ruta, /QSTASH_CURRENT_SIGNING_KEY/)
})

test('cola/callback: un trabajo muerto cuenta como fallo en el SLO', () => {
  const ruta = leer('src/app/api/jobs/muerto/route.ts')
  // El registro sale bien, pero el EVENTO es una mala noticia: en la llamada a
  // registrarEvento, `ok: false` acompaña al motivo. (La respuesta HTTP sí es
  // 200 con ok:true — eso es para QStash, no para el SLO.)
  assert.match(ruta, /ok: false,\s*\n?\s*motivo: 'trabajo_muerto'/)
})

// ─── Módulo de difuntos ──────────────────────────────────────────────────────

test('cola/muertos: el reencolado usa flip atómico (dos clics, un solo trabajo)', () => {
  const src = leer('src/modules/jobs/muertos.ts')
  assert.match(src, /updateMany\(\{\s*\n?\s*where: \{ id, estado: 'PENDIENTE' \}/)
  assert.match(src, /if \(flip\.count === 0\) return \{ ok: false, motivo: 'ya_resuelto' \}/)
})

test('cola/muertos: el duplicado del callback se acepta sin duplicar (P2002)', () => {
  const src = leer('src/modules/jobs/muertos.ts')
  assert.match(src, /P2002/)
  assert.match(src, /duplicado: true/)
})

test('cola/muertos: solo cargas del catálogo real entran al dead letter', () => {
  const src = leer('src/modules/jobs/muertos.ts')
  assert.match(src, /TIPOS_TRABAJO\.includes\(carga\.tipo\)/)
})

// ─── Degradación observable ──────────────────────────────────────────────────

test('cola/degradación: correr en línea emite evento estructurado, no solo consola', () => {
  const cola = leer('src/modules/jobs/cola.ts')
  assert.match(cola, /accion: 'degradacion'/)
  // Los dos caminos de degradación anotan: sin configurar y publicación rechazada.
  assert.match(cola, /anotarDegradacion\(carga, 'sin_configurar'\)/)
  assert.match(cola, /anotarDegradacion\(carga, 'publicacion_rechazada'\)/)
})

// ─── Acciones del panel ──────────────────────────────────────────────────────

test('cola/acciones: guard de superadmin DENTRO de cada acción y auditoría', () => {
  const src = leer('src/modules/jobs/panelActions.ts')
  // Una server action se despacha por su id desde cualquier path: el guard
  // tiene que vivir dentro, no en el middleware.
  const acciones = src.split('export async function').slice(1)
  assert.equal(acciones.length, 2)
  for (const accion of acciones) {
    assert.match(accion, /await superadmin\(\)/)
    assert.match(accion, /auditarCola\('COLA_/)
  }
})
