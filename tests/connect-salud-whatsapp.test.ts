import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pideReautorizar, type InspeccionToken } from '../src/modules/connect/meta/tokensNucleo'

/**
 * INSPECCIÓN ACTIVA DE WHATSAPP con `debug_token` · B-3 (la pieza que faltaba).
 *
 * El chequeo local no puede juzgar el token de sistema de WhatsApp porque se
 * guarda sin `expiresAt`. Esto lo inspecciona en vivo contra Meta. Lo puro —la
 * decisión de si hay que reautorizar— se prueba de verdad; que sea externo,
 * acotado y que NUNCA decida sin respuesta de Meta es una guardia estructural.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const codigo = (r: string) =>
  leer(r)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const AHORA = new Date('2026-09-18T12:00:00.000Z').getTime()
const enDias = (d: number) => new Date(AHORA + d * 86_400_000)
const base: InspeccionToken = {
  valido: true,
  appId: '123',
  caducaAt: null,
  accesoDatosCaducaAt: null,
  permisos: [],
  concesiones: [],
}

// ─── La decisión sobre un token de sistema ───────────────────────────────────

test('un token de sistema INVÁLIDo pide reautorizar (aunque no tenga fecha)', () => {
  // Es el caso que solo `debug_token` ve: el token no venció por fecha —no la
  // tiene—, pero Meta lo invalidó al perder el acceso quien lo emitió.
  assert.equal(pideReautorizar({ ...base, valido: false }, AHORA), true)
})

test('un token de sistema válido y sin caducidad NO pide reautorizar', () => {
  assert.equal(pideReautorizar({ ...base, valido: true }, AHORA), false)
})

test('si el acceso a datos caduca dentro del margen, pide reautorizar', () => {
  assert.equal(pideReautorizar({ ...base, accesoDatosCaducaAt: enDias(3) }, AHORA), true)
  assert.equal(pideReautorizar({ ...base, accesoDatosCaducaAt: enDias(30) }, AHORA), false)
})

// ─── Guardias estructurales de la inspección activa ──────────────────────────

test('NUNCA decide sin respuesta de Meta: un fallo de la llamada no marca nada', () => {
  // La propiedad de correctitud más importante: un apagón de Meta no puede
  // traducirse en «reconéctate» para todas las empresas. Solo con `r.ok` se
  // decide; si no, se cuenta como sinRespuesta y se deja para mañana.
  const src = codigo('src/modules/connect/salud-whatsapp.ts')
  assert.match(src, /if \(!r\.ok\)/, 'no comprueba el éxito de la llamada a Meta')
  const idxFallo = src.indexOf('if (!r.ok)')
  const idxMarcar = src.indexOf('transicionSalud(')
  assert.ok(idxFallo !== -1 && idxMarcar !== -1)
  assert.ok(idxFallo < idxMarcar, 'decide la transición antes de comprobar que Meta respondió')
})

test('solo mira conexiones de WhatsApp conectadas, y decide con la máquina común', () => {
  const src = codigo('src/modules/connect/salud-whatsapp.ts')
  assert.match(src, /estado: 'CONNECTED', conector: \{ slug: 'whatsapp' \}/)
  assert.match(src, /pideReautorizar\(/, 'no usa la decisión pura común')
  assert.match(src, /transicionSalud\(/, 'no usa la transición idempotente común')
  assert.match(src, /reautorizarAt/, 'no marca el aviso persistente')
})

test('está acotada por concurrencia Y por tiempo, como los barridos', () => {
  const src = codigo('src/modules/connect/salud-whatsapp.ts')
  assert.match(src, /enParalelo\(/, 'no acota la concurrencia de las llamadas a Meta')
  assert.match(src, /continuar: antesDe\(/, 'no se corta por tiempo para no comerse el cron')
  assert.match(src, /sinTiempo:/, 'no reporta lo que dejó sin inspeccionar')
})

test('ningún secreto entra en la bitácora (ni el token ni su valor)', () => {
  const src = codigo('src/modules/connect/salud-whatsapp.ts')
  // El detalle del apunte lleva metadatos (proveedor, motivo, fecha), nunca el
  // token abierto.
  const detalles = [...src.matchAll(/detalle:\s*\{[\s\S]*?\}/g)].map((m) => m[0])
  assert.ok(detalles.length > 0, 'no se encontró ningún detalle de bitácora')
  for (const d of detalles) {
    // El VALOR del token (`cred.token`), no la palabra: `motivo: 'token_invalido'`
    // es un estado, no un secreto.
    assert.ok(
      !/cred\.token|\.token\b|token:|secreto|sellado/i.test(d),
      `un detalle de bitácora expone el token: ${d}`
    )
  }
})

// ─── El cron la llama, y la última ───────────────────────────────────────────

test('el cron llama a la inspección activa de WhatsApp, y va la ÚLTIMA', () => {
  const src = codigo('src/app/api/cron/integraciones/route.ts')
  assert.match(src, /inspeccionarSaludWhatsapp\(/, 'el cron no la llama')
  // Después del chequeo local barato: si la función se corta por tiempo, lo que
  // se pierde es lo externo y frágil, no lo local.
  const idxLocal = src.indexOf('comprobarSaludConexiones(')
  const idxWa = src.indexOf('inspeccionarSaludWhatsapp(')
  assert.ok(idxLocal !== -1 && idxWa !== -1)
  assert.ok(idxLocal < idxWa, 'la inspección externa debería ir después de la local')
})
