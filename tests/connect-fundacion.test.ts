import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import {
  abrir,
  parsearClavesMaestras,
  sellar,
  versionActual,
  versionDelSello,
} from '../src/modules/connect/cifrado'
import { puedeTransicionar, ESTADOS_CONEXION } from '../src/modules/connect/nucleo'

/**
 * MEMBEGO CONNECT · Fase 1 (Foundation).
 *
 * Tres frentes: el cifrado de credenciales (puro, se prueba de verdad), la
 * máquina de estados de las conexiones (pura), y guardias estructurales sobre
 * la migración y el bus — lo que no se puede ejecutar sin base de datos se
 * vigila leyendo el fuente, igual que en el resto de la suite.
 */

const clave = (b: Buffer) => `1:${b.toString('base64')}`
const CLAVE_A = randomBytes(32)
const CLAVE_B = randomBytes(32)

// ─── Cifrado ─────────────────────────────────────────────────────────────────

test('connect/cifrado: sella y abre (ida y vuelta) con AAD', () => {
  const claves = parsearClavesMaestras(clave(CLAVE_A))
  const sello = sellar(claves, '{"access":"tok"}', 'credencial:cx1:OAUTH_TOKENS')
  assert.match(sello, /^cn1\.1\./)
  const abierto = abrir(claves, sello, 'credencial:cx1:OAUTH_TOKENS')
  assert.deepEqual(abierto, { ok: true, datos: '{"access":"tok"}' })
})

test('connect/cifrado: el AAD ata el sello a su fila — copiado a otra, no abre', () => {
  const claves = parsearClavesMaestras(clave(CLAVE_A))
  const sello = sellar(claves, 'secreto', 'credencial:cx1:API_KEY')
  const abierto = abrir(claves, sello, 'credencial:cx2:API_KEY')
  assert.deepEqual(abierto, { ok: false, motivo: 'manipulado' })
})

test('connect/cifrado: un byte alterado del cifrado no abre', () => {
  const claves = parsearClavesMaestras(clave(CLAVE_A))
  const sello = sellar(claves, 'secreto', 'aad')
  const partes = sello.split('.')
  const ct = Buffer.from(partes[4], 'base64url')
  ct[0] ^= 0xff
  partes[4] = ct.toString('base64url')
  assert.deepEqual(abrir(claves, partes.join('.'), 'aad'), { ok: false, motivo: 'manipulado' })
})

test('connect/cifrado: formato desconocido y versión ausente se distinguen', () => {
  const claves = parsearClavesMaestras(clave(CLAVE_A))
  assert.deepEqual(abrir(claves, 'basura', 'aad'), { ok: false, motivo: 'formato' })
  const selloV9 = sellar(parsearClavesMaestras(`9:${CLAVE_B.toString('base64')}`), 'x', 'aad')
  assert.deepEqual(abrir(claves, selloV9, 'aad'), { ok: false, motivo: 'clave_desconocida' })
})

test('connect/cifrado: rotación — sella con la más alta, sigue abriendo la vieja', () => {
  const soloVieja = parsearClavesMaestras(clave(CLAVE_A))
  const selloViejo = sellar(soloVieja, 'histórico', 'aad')

  const ambas = parsearClavesMaestras(`1:${CLAVE_A.toString('base64')},2:${CLAVE_B.toString('base64')}`)
  assert.equal(versionActual(ambas), 2)
  const selloNuevo = sellar(ambas, 'reciente', 'aad')
  assert.equal(versionDelSello(selloNuevo), 2)
  assert.equal(versionDelSello(selloViejo), 1)

  // Con las dos claves en el entorno, TODO abre: esa es la ventana de rotación.
  assert.deepEqual(abrir(ambas, selloViejo, 'aad'), { ok: true, datos: 'histórico' })
  assert.deepEqual(abrir(ambas, selloNuevo, 'aad'), { ok: true, datos: 'reciente' })
})

test('connect/cifrado: claves malformadas gritan al parsear, no al usar', () => {
  assert.throws(() => parsearClavesMaestras('sin-dos-puntos'), /version:base64/)
  assert.throws(() => parsearClavesMaestras('0:' + CLAVE_A.toString('base64')), /inválida/)
  assert.throws(() => parsearClavesMaestras('1:' + randomBytes(16).toString('base64')), /32 bytes/)
  assert.throws(
    () => parsearClavesMaestras(`1:${CLAVE_A.toString('base64')},1:${CLAVE_B.toString('base64')}`),
    /repetida/
  )
})

// ─── Máquina de estados de conexiones ────────────────────────────────────────

test('connect/nucleo: transiciones legales e ilegales', () => {
  assert.ok(puedeTransicionar('PENDING', 'CONNECTED'))
  assert.ok(puedeTransicionar('CONNECTED', 'ERROR'))
  assert.ok(puedeTransicionar('ERROR', 'CONNECTED'))
  assert.ok(puedeTransicionar('DISCONNECTED', 'PENDING'))
  // Un éxito rezagado no resucita una conexión que la empresa apagó.
  assert.ok(!puedeTransicionar('DISCONNECTED', 'CONNECTED'))
  // Nada se queda donde está «transicionando» a sí mismo.
  for (const e of ESTADOS_CONEXION) assert.ok(!puedeTransicionar(e, e))
})

// ─── Migración: guardias estructurales ───────────────────────────────────────

const MIGRACION = readFileSync(
  join(__dirname, '../prisma/migrations/20260831_connect_fundacion/migration.sql'),
  'utf8'
)

test('connect/migración: crea las seis tablas y todas idempotentes', () => {
  for (const tabla of [
    'conectores',
    'conexiones_empresa',
    'credenciales_conexion',
    'claves_api_empresa',
    'entitlements_empresa',
    'registros_conector',
  ]) {
    assert.match(MIGRACION, new RegExp(`CREATE TABLE IF NOT EXISTS "${tabla}"`))
  }
  // Ningún CREATE TABLE sin IF NOT EXISTS: la migración debe poder correr dos veces.
  assert.equal(/CREATE TABLE (?!IF NOT EXISTS)/.test(MIGRACION), false)
})

test('connect/migración: estados con CHECK — el vocabulario vive también en la base', () => {
  assert.match(MIGRACION, /"conectores_estado_valido"[\s\S]*?'DRAFT','ACTIVE','SUSPENDED','RETIRED'/)
  assert.match(
    MIGRACION,
    /"conexiones_empresa_estado_valido"[\s\S]*?'PENDING','CONNECTED','ERROR','DISCONNECTED'/
  )
  assert.match(MIGRACION, /"claves_api_empresa_estado_valido"[\s\S]*?'ACTIVE','REVOKED'/)
  // Un sello o hash vacío no protege nada: bloqueado hasta por SQL a mano.
  assert.match(MIGRACION, /credenciales_conexion_sellado_no_vacio/)
  assert.match(MIGRACION, /claves_api_empresa_hash_no_vacio/)
})

test('connect/migración: borrar el catálogo NO arrastra conexiones (RESTRICT)', () => {
  assert.match(
    MIGRACION,
    /"conexiones_empresa_conectorId_fkey"[\s\S]*?ON DELETE RESTRICT/
  )
})

test('connect/migración: el bus gana traceId', () => {
  assert.match(MIGRACION, /ALTER TABLE "automation_events" ADD COLUMN IF NOT EXISTS "traceId" TEXT/)
})

// ─── El renombre a DomainEvent no puede tocar la tabla física ────────────────

test('connect/esquema: DomainEvent conserva @@map("automation_events")', () => {
  const motores = readFileSync(join(__dirname, '../prisma/schema/motores.prisma'), 'utf8')
  const desdeModelo = motores.slice(motores.indexOf('model DomainEvent'))
  // La llave de cierre del MODELO es la primera al inicio de línea — cortar en
  // la primera `}` a secas tropezaría antes con el `@default("{}")` de payload.
  const bloque = desdeModelo.slice(0, desdeModelo.search(/^\}/m))
  // Si alguien «completa» el renombre quitando el @@map, Prisma buscará una
  // tabla domain_events que no existe y TODO el bus muere en producción.
  assert.match(bloque, /@@map\("automation_events"\)/)
  assert.match(bloque, /traceId\s+String\?/)
})

test('connect/bus: nadie usa ya el nombre viejo del modelo', () => {
  for (const archivo of [
    '../src/modules/estrategias/eventos.ts',
    '../src/modules/estrategias/actionSink.ts',
    '../src/lib/automation/infrastructure/prisma-event-store.ts',
  ]) {
    const src = readFileSync(join(__dirname, archivo), 'utf8')
    assert.ok(!src.includes('.automationEvent.'), `${archivo} sigue usando .automationEvent.`)
  }
})

test('connect/bus: el traceId viaja del emisor al outbox de satélites', () => {
  const src = readFileSync(join(__dirname, '../src/modules/estrategias/eventos.ts'), 'utf8')
  // 1. El emisor lo persiste en el evento…
  assert.match(src, /traceId: evento\.traceId \?\? null/)
  // 2. …y el despacho se lo pasa al reenvío hacia satélites.
  const llamada = src.slice(src.indexOf('reenviarEventoASistemas({'))
  assert.match(llamada.slice(0, llamada.indexOf('})')), /traceId: evento\.traceId/)
})

// ─── Credenciales: reglas que no pueden aflojarse ────────────────────────────

test('connect/credenciales: falla cerrado sin clave maestra y nunca anota el secreto', () => {
  const src = readFileSync(join(__dirname, '../src/modules/connect/credenciales.ts'), 'utf8')
  // Sin clave maestra, guardar Y leer devuelven el motivo — no un default.
  assert.equal(src.split("motivo: 'sin_clave_maestra'").length - 1 >= 2, true)
  // La bitácora recibe metadatos, jamás el campo del secreto: en las llamadas
  // a anotarConector no puede aparecer ni `secreto` ni `sellado`.
  for (const bloque of src.split('anotarConector({').slice(1)) {
    const detalle = bloque.slice(0, bloque.indexOf('})'))
    assert.ok(!/secreto|sellado/.test(detalle), 'la bitácora estaría anotando material sensible')
  }
})

test('connect/entitlements: lo que cuesta dinero nace apagado', () => {
  // El vocabulario se movió a `nucleo.ts` en la Fase 9, para poder probarlo sin
  // base. La exigencia no cambia: lo que consume servicios de pago nace en cero
  // y se concede empresa a empresa.
  const src = readFileSync(join(__dirname, '../src/modules/connect/nucleo.ts'), 'utf8')
  assert.match(src, /'api_keys\.max': \{ default: 0 \}/)
  assert.match(src, /'webhooks\.max': \{ default: 0 \}/)
})

// ─── El cron de reintentos por fin está programado (CRÍTICO de la Fase 0) ────

test('connect/cron: /api/cron/integraciones aparece en vercel.json', () => {
  const vercel = JSON.parse(readFileSync(join(__dirname, '../vercel.json'), 'utf8')) as {
    crons?: { path: string }[]
  }
  assert.ok(vercel.crons?.some((c) => c.path === '/api/cron/integraciones'))
})
