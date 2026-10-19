/**
 * El cron de entregas de pago: existe, está programado a diario y exige el secreto antes de barrer.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const leer = (f: string) => readFileSync(f, 'utf8')
const RUTA = leer('src/app/api/cron/entregas-pago/route.ts')
const MODULO = leer('src/modules/pagos/barrido-entregas.ts')

test('la ruta exige el secreto del cron ANTES de barrer', () => {
  assert.ok(RUTA.indexOf('autorizarCron(req)') >= 0)
  assert.ok(RUTA.indexOf('autorizarCron(req)') < RUTA.indexOf('barridoEntregasDePago()'))
})

test('está en vercel.json con una programación DIARIA (el plan solo admite crons diarios: otra haría fallar el despliegue)', () => {
  const vercel = JSON.parse(leer('vercel.json')) as { crons: { path: string; schedule: string }[] }
  const c = vercel.crons.find((x) => x.path === '/api/cron/entregas-pago')
  assert.ok(c, 'falta en vercel.json')
  assert.match(c.schedule, /^\d{1,2} \d{1,2} \* \* \*$/, 'una vez al día: minuto y hora fijos, sin pasos')
})

test('el barrido nunca toca la pasarela: reintenta la entrega, no recobra', () => {
  assert.doesNotMatch(MODULO, /cardnet|purchase|cobrar\(|autorizar/i)
  assert.match(MODULO, /reintentarEntrega\(/)
})

test('el aviso lleva clave estable (uno por empresa y día) y todo lo que escribe entra por su empresa', () => {
  assert.match(MODULO, /dedupeKey: claveDeAvisoDelDia\(companyId, ahora\)/)
  assert.match(MODULO, /notificarAdmins\(companyId,/)
})
