import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ACTION_TYPES } from '../src/lib/rule-engine'

/**
 * MEMBEGO CONNECT · Fase 7 — cimientos de automatizaciones.
 *
 * Dos cosas que vigilar: que la acción de webhook entregue por el camino con
 * protecciones (y no por uno nuevo sin ellas), y que la degradación silenciosa
 * de los canales deje de ser invisible.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const SINK = leer('src/modules/estrategias/actionSink.ts')

test('webhook: la acción entrega por las SUSCRIPCIONES, no por una URL propia', () => {
  // Si una regla pudiera escribir su propia URL, se abriría un segundo camino
  // sin validación contra SSRF, sin firma, sin reintentos y sin dead letter.
  assert.match(SINK, /repartirEventoAWebhooks\(\{/)
  const bloque = SINK.slice(SINK.indexOf('private async invocarWebhook'))
  const cuerpo = bloque.slice(0, bloque.indexOf('\n  }'))
  assert.ok(!/fetch\(/.test(cuerpo), 'la acción no puede hacer su propia petición')
  assert.ok(!/params\.url/.test(cuerpo), 'la acción no puede aceptar una URL de la regla')
})

test('webhook: el evento va con prefijo para distinguir su origen', () => {
  assert.match(SINK, /`automation\.\$\{nombre\}`/)
})

test('webhook: sin destinos, degrada con motivo en vez de crear entregas vacías', () => {
  assert.match(SINK, /simulated: true, reason: 'sin webhooks suscritos'/)
  // Y se pregunta ANTES de fabricar el sobre.
  const i = SINK.indexOf('haySuscripcionesActivas')
  const j = SINK.indexOf('repartirEventoAWebhooks({')
  assert.ok(i > -1 && j > i)
})

test('canales: la pantalla pregunta lo MISMO que el motor', () => {
  // Si la pantalla tuviera su propia lógica, un día diría «funcionando»
  // mientras el motor degrada. Comparten función, no lógica copiada.
  const canales = leer('src/modules/connect/canales.ts')
  assert.match(canales, /whatsappDisponible\(companyId\)/)
  assert.match(canales, /haySuscripcionesActivas\(companyId\)/)
  assert.match(SINK, /whatsappDisponible\(input\.companyId\)/)
  assert.match(SINK, /haySuscripcionesActivas\(input\.companyId\)/)
})

test('canales: un canal apagado siempre dice cómo encenderse', () => {
  const canales = leer('src/modules/connect/canales.ts')
  // Un estado sin salida es una queja, no información.
  const bloques = canales.match(/estado: [^\n]*'no_configurado'/g) ?? []
  assert.ok(bloques.length >= 1)
  assert.match(canales, /comoEncenderlo/)
  const panel = leer('src/components/connect/CanalesPanel.tsx')
  assert.match(panel, /comoEncenderlo && \(/)
  // Y no se pinta como error: un canal apagado no es una avería.
  assert.ok(!/text-destructive/.test(panel))
})

test('canales: Google Calendar no se presenta como canal de automatización', () => {
  // Mezclarlo haría creer que una regla puede escribir en la agenda, y no puede.
  const canales = leer('src/modules/connect/canales.ts')
  const lista = canales.slice(canales.indexOf('export async function canalesDeEmpresa'))
  assert.ok(!/calendarioDisponible/.test(lista.slice(0, lista.indexOf('export async function calendarioDeEmpresa'))))
  assert.match(canales, /export async function calendarioDeEmpresa/)
})

test('catálogo de acciones: webhook y whatsapp describen lo que de verdad hacen', () => {
  const src = leer('src/lib/rule-engine/domain/action-catalog.ts')
  assert.match(src, /SEND_WEBHOOK[^\n]*Avisar a tus webhooks suscritos/)
  assert.ok(!/SEND_WEBHOOK[^\n]*Invocar webhook\./.test(src))
  // El tipo sigue siendo el mismo: las reglas ya publicadas no se rompen.
  assert.equal(ACTION_TYPES.SEND_WEBHOOK, 'send_webhook')
})
