import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MAX_TEXTO_WHATSAPP,
  cuerpoMensajeTexto,
  esCredencialWhatsapp,
  normalizarTelefonoWhatsapp,
  recortarTexto,
} from '../src/modules/connect/whatsappNucleo'
import { FUNCIONES_POR_SECCION } from '../src/lib/auth/funciones'

/**
 * MEMBEGO CONNECT · Fase 6 — los dos primeros conectores nativos.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')

// ─── Teléfonos dominicanos ───────────────────────────────────────────────────

test('whatsapp: los números dominicanos de 10 dígitos ganan su código de país', () => {
  // Es como los escribe la gente aquí, y como están guardados en la base.
  assert.equal(normalizarTelefonoWhatsapp('809-555-1234'), '18095551234')
  assert.equal(normalizarTelefonoWhatsapp('(829) 555 1234'), '18295551234')
  assert.equal(normalizarTelefonoWhatsapp('849 555 1234'), '18495551234')
})

test('whatsapp: un número que YA trae código de país no se toca', () => {
  // Adivinar dos veces produciría `11809…`, que no es de nadie.
  assert.equal(normalizarTelefonoWhatsapp('+1 809 555 1234'), '18095551234')
  assert.equal(normalizarTelefonoWhatsapp('18095551234'), '18095551234')
})

test('whatsapp: un extranjero no se rechaza por no ser dominicano', () => {
  assert.equal(normalizarTelefonoWhatsapp('+34 600 123 456'), '34600123456')
  assert.equal(normalizarTelefonoWhatsapp('+52 55 1234 5678'), '525512345678')
})

test('whatsapp: lo que no puede ser un teléfono se rechaza', () => {
  assert.equal(normalizarTelefonoWhatsapp(''), null)
  assert.equal(normalizarTelefonoWhatsapp('123'), null)
  assert.equal(normalizarTelefonoWhatsapp('no-es-un-numero'), null)
  assert.equal(normalizarTelefonoWhatsapp('1'.repeat(16)), null)
})

// ─── Mensaje ─────────────────────────────────────────────────────────────────

test('whatsapp: el cuerpo del mensaje no genera vista previa de enlaces', () => {
  const c = cuerpoMensajeTexto('18095551234', 'Hola https://membego.com') as {
    text: { preview_url: boolean; body: string }
    messaging_product: string
  }
  // Una tarjeta de vista previa dispara peticiones desde el teléfono del
  // cliente hacia el enlace; no la queremos.
  assert.equal(c.text.preview_url, false)
  assert.equal(c.messaging_product, 'whatsapp')
})

test('whatsapp: un texto larguísimo se recorta en vez de que Meta lo rechace', () => {
  const largo = 'a'.repeat(MAX_TEXTO_WHATSAPP + 500)
  const r = recortarTexto(largo)
  assert.equal(r.length, MAX_TEXTO_WHATSAPP)
  assert.ok(r.endsWith('…'))
  assert.equal(recortarTexto('  corto  '), 'corto')
})

test('whatsapp: una credencial a medias no pasa por buena', () => {
  assert.equal(esCredencialWhatsapp({ token: 't', phoneNumberId: '1' }), true)
  assert.equal(esCredencialWhatsapp({ token: 't' }), false)
  assert.equal(esCredencialWhatsapp({ token: '', phoneNumberId: '1' }), false)
  assert.equal(esCredencialWhatsapp(null), false)
})

// ─── Honestidad del catálogo ─────────────────────────────────────────────────

test('conectores: lo que no está configurado no se ofrece', () => {
  // El registro se partió en la Fase 10: un archivo por proveedor.
  const src = leer('src/modules/connect/proveedores/googleCalendar.ts')
  // Google depende de la app de MembeGo: sin sus variables, fuera del catálogo.
  assert.match(src, /GOOGLE_OAUTH_CLIENT_ID && process\.env\.GOOGLE_OAUTH_CLIENT_SECRET/)
  // Y el registro filtra la lectura por eso, no solo por el estado en la base.
  const reg = leer('src/modules/connect/registro.ts')
  assert.match(reg, /const disponibles = slugsDisponibles\(\)/)
  assert.match(reg, /slug: \{ in: disponibles \}/)
})

test('conectores: Google pide refresh token de forma explícita', () => {
  const src = leer('src/modules/connect/proveedores/googleCalendar.ts')
  // Sin `access_type=offline` Google no manda refresh token y la conexión
  // moriría en una hora; sin `prompt=consent`, una reconexión se quedaría sin él.
  assert.match(src, /access_type: 'offline'/)
  assert.match(src, /prompt: 'consent'/)
})

// ─── La acción deja de ser simulada, pero degrada ────────────────────────────

test('automatizaciones: send_whatsapp envía de verdad y degrada si no hay conexión', () => {
  const src = leer('src/modules/estrategias/actionSink.ts')
  assert.match(src, /case ACTION_TYPES\.SEND_WHATSAPP:/)
  // Sin conector conectado se sigue registrando la intención: una
  // automatización publicada hace meses no puede empezar a fallar porque
  // hayamos añadido un canal.
  assert.match(src, /simulated: true, reason: 'WhatsApp no conectado'/)
  assert.match(src, /simulated: true, reason: 'cliente sin teléfono'/)
})

test('catálogo de acciones: WhatsApp ya no dice «arquitectura futura»', () => {
  const src = leer('src/lib/rule-engine/domain/action-catalog.ts')
  assert.ok(!/SEND_WHATSAPP[^\n]*arquitectura futura/.test(src))
  assert.match(src, /SEND_WHATSAPP[^\n]*requiere el conector conectado/)
})

// ─── Secretos ────────────────────────────────────────────────────────────────

test('conectores: ningún secreto de proveedor vive en el código', () => {
  const src = leer('src/modules/connect/proveedores/googleCalendar.ts')
  // Solo el NOMBRE de la variable de entorno, nunca un valor.
  assert.match(src, /clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET'/)
  assert.ok(!/clientSecret:\s*'[^']+'/.test(src))
})

test('whatsapp: el cuerpo de error de Meta no se registra nunca', () => {
  const src = leer('src/modules/connect/whatsapp.ts')
  // En las respuestas de error de Meta viaja el destinatario, y en el eco de
  // una autorización fallida puede viajar el propio token.
  assert.ok(!/await resp\.text\(\)/.test(src))
  assert.match(src, /Meta respondió \$\{resp\.status\}/)
})

// ─── Permisos ────────────────────────────────────────────────────────────────

test('permisos: conectar y desconectar tienen su guardia cableada', () => {
  const acciones = leer('src/modules/connect/adminActions.ts')
  const funciones = FUNCIONES_POR_SECCION.integraciones ?? []
  assert.equal(funciones.length, 6)
  for (const f of funciones) {
    assert.ok(
      acciones.includes(`requireSection('integraciones', '${f.codigo}')`),
      `la función «${f.label}» no tiene guardia cableada`
    )
  }
})

// ─── Citas → Calendario ──────────────────────────────────────────────────────

test('citas: confirmar no puede romperse porque Google esté caído', () => {
  const src = leer('src/modules/citas/actions.ts')
  assert.match(src, /crearEventoCalendario\(/)
  // El fallo se traga a propósito: la cita YA está confirmada y guardada.
  assert.match(src, /no se pudo crear el evento en Google/)
  // Y el evento va con zona horaria: sin ella, una cita de las 9:00 en Santo
  // Domingo aparecería a otra hora en un calendario configurado en otro país.
  assert.match(src, /zonaHoraria: tz/)
})

test('migración: los conectores se siembran sin pisar lo existente', () => {
  const m = leer('prisma/migrations/20260901_connect_conectores/migration.sql')
  assert.match(m, /ON CONFLICT \("slug"\) DO NOTHING/)
  assert.match(m, /'whatsapp'/)
  assert.match(m, /'google-calendar'/)
})
