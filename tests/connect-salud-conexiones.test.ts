import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MARGEN_REAUTORIZAR_MS,
  conexionNecesitaReautorizar,
  credencialVencePronto,
  esTerminal,
  transicionSalud,
  type CredencialSalud,
} from '../src/modules/connect/salud-conexiones-nucleo'

/**
 * SALUD ACTIVA DE LAS CONEXIONES · hallazgo B-3 de la auditoría.
 *
 * Lo que decide si una conexión hay que reautorizarla antes de que un envío
 * falle es puro y se prueba aquí. Que el cron la llame y no abra sellos es una
 * guardia estructural.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')

const AHORA = new Date('2026-09-17T12:00:00.000Z').getTime()
const enDias = (d: number) => new Date(AHORA + d * 86_400_000)

// ─── Terminal vs refrescable ─────────────────────────────────────────────────

test('una credencial con refresco NO es terminal, por muy cerca que caduque', () => {
  // Es la trampa que evita la falsa alarma diaria: el access token de Google
  // caduca cada hora y se renueva solo. Avisar de eso sería ruido constante.
  const google: CredencialSalud = { expiresAt: enDias(0.01), tieneRefresh: true }
  assert.equal(esTerminal(google), false)
  assert.equal(credencialVencePronto(google, AHORA), false)
})

test('una credencial sin refresco y con fecha SÍ es terminal', () => {
  const meta: CredencialSalud = { expiresAt: enDias(3), tieneRefresh: false }
  assert.equal(esTerminal(meta), true)
})

test('una credencial sin fecha no dispara nada (no se sabe cuándo cae)', () => {
  // El token de sistema de WhatsApp se guarda sin `expiresAt`: no hay señal, así
  // que no se inventa una.
  const sinFecha: CredencialSalud = { expiresAt: null, tieneRefresh: false }
  assert.equal(esTerminal(sinFecha), false)
  assert.equal(credencialVencePronto(sinFecha, AHORA), false)
})

// ─── El margen ───────────────────────────────────────────────────────────────

test('avisa dentro del margen (una semana), no antes', () => {
  const margenDias = MARGEN_REAUTORIZAR_MS / 86_400_000
  assert.ok(margenDias >= 6 && margenDias <= 8, 'el margen debería rondar la semana')
  // Justo dentro y justo fuera del margen.
  assert.equal(credencialVencePronto({ expiresAt: enDias(3), tieneRefresh: false }, AHORA), true)
  assert.equal(credencialVencePronto({ expiresAt: enDias(30), tieneRefresh: false }, AHORA), false)
})

test('una credencial YA caducada también avisa (aún no se cerró la conexión)', () => {
  assert.equal(credencialVencePronto({ expiresAt: enDias(-1), tieneRefresh: false }, AHORA), true)
})

// ─── A nivel de conexión ─────────────────────────────────────────────────────

test('basta UNA credencial terminal a punto de caer para avisar de la conexión', () => {
  const creds: CredencialSalud[] = [
    { expiresAt: enDias(60), tieneRefresh: false }, // lejos
    { expiresAt: enDias(2), tieneRefresh: false }, // cerca → dispara
  ]
  assert.equal(conexionNecesitaReautorizar(creds, AHORA), true)
})

test('una conexión solo con credenciales refrescables o lejanas no avisa', () => {
  const creds: CredencialSalud[] = [
    { expiresAt: enDias(0.01), tieneRefresh: true }, // refrescable
    { expiresAt: enDias(90), tieneRefresh: false }, // lejos
  ]
  assert.equal(conexionNecesitaReautorizar(creds, AHORA), false)
})

test('una conexión sin credenciales no avisa', () => {
  assert.equal(conexionNecesitaReautorizar([], AHORA), false)
})

// ─── La transición (idempotencia del cron) ───────────────────────────────────

test('la transición solo actúa cuando cambia el estado', () => {
  assert.equal(transicionSalud(true, false), 'marcar') // necesita y no estaba
  assert.equal(transicionSalud(false, true), 'limpiar') // ya no necesita, estaba
  assert.equal(transicionSalud(true, true), 'nada') // ya marcada
  assert.equal(transicionSalud(false, false), 'nada') // sana y sin marca
})

// ─── Guardias estructurales ──────────────────────────────────────────────────

test('el cron de integraciones llama a la salud activa (B-3)', () => {
  // El hallazgo era literal: `salud.ts` existía y ningún cron lo llamaba. Esta
  // guardia impide que se vuelva a quedar sin cron.
  const src = leer('src/app/api/cron/integraciones/route.ts')
  assert.match(src, /comprobarSaludConexiones\(/)
})

test('la salud activa NO abre sellos ni llama a proveedores', () => {
  // Todo su valor es ser local y barata: si algún día alguien mete aquí un
  // `abrirCredencial` o un `fetch`, deja de poder correr a diario sobre todas las
  // conexiones sin coste. Se lee `expiresAt` y `metadata`, que son columnas no
  // secretas.
  const src = leer('src/modules/connect/salud-conexiones.ts')
  assert.ok(!/abrirCredencial|descifrar|llamarGraph|fetch\(/.test(src), 'la salud activa abre algo que no debería')
  assert.match(src, /estado: 'CONNECTED'/)
  assert.match(src, /expiresAt: true/)
})

test('el aviso es persistente, no se apoya en la ventana transitoria de `degradada`', () => {
  // Una caducidad no se cura sola en 24 h; el aviso vive en su propia columna y
  // solo lo quita el cron cuando la conexión vuelve a estar sana.
  const src = leer('src/modules/connect/salud-conexiones.ts')
  assert.match(src, /reautorizarAt/)
  const sql = leer('prisma/migrations/20260924_salud_activa_conexiones/migration.sql')
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "reautorizarAt"/)
})
