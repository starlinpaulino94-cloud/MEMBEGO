import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  VENTANA_SERVICIO_MS,
  avanzaEstado,
  candidatosTelefono,
  cuerpoMarcarLeido,
  cuerpoMensajePlantilla,
  estadoDesdeMeta,
  leerEntranteWhatsapp,
  leerEstadoWhatsapp,
  leerPlantillasDeMeta,
  variablesDelCuerpo,
  ventanaAbierta,
  vistaPrevia,
} from '../src/modules/mensajeria/nucleo'
import { EVENTOS_CONECTOR, textoTecnico } from '../src/modules/connect/bitacoraNucleo'

/**
 * MENSAJERÍA · Meta · Fase 2.
 *
 * Lo que entra y sale por WhatsApp se convierte en conversaciones y mensajes
 * de UNA empresa. Estas pruebas vigilan la lectura de lo que Meta manda, la
 * ventana de 24 h, el avance de estados, el enlace con clientes, las
 * plantillas, y que todo envío quede en su conversación.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const codigo = (r: string) =>
  leer(r).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

// ─── Ventana de servicio ─────────────────────────────────────────────────────

test('ventana: 24 h desde el último mensaje del cliente; sin cliente, cerrada', () => {
  const ahora = Date.UTC(2026, 8, 4, 12)
  assert.equal(ventanaAbierta(null, ahora), false)
  assert.equal(ventanaAbierta(new Date(ahora - 23 * 3600_000), ahora), true)
  assert.equal(ventanaAbierta(new Date(ahora - 25 * 3600_000), ahora), false)
  assert.equal(VENTANA_SERVICIO_MS, 24 * 3600_000)
})

// ─── Lectura de entrantes ────────────────────────────────────────────────────

const META = { display_phone_number: '15550783881', phone_number_id: '106540352242922' }
const CONTACTS = [{ profile: { name: 'Ana' }, wa_id: '18095551234' }]

test('entrante: un texto se lee con remitente, nombre, cuerpo y fecha', () => {
  const m = leerEntranteWhatsapp({
    metadata: META,
    contacts: CONTACTS,
    message: { from: '18095551234', id: 'wamid.1', timestamp: '1725400000', type: 'text', text: { body: '¿Hay turno hoy?' } },
  })
  assert.ok(m)
  assert.equal(m.idExterno, 'wamid.1')
  assert.equal(m.de, '18095551234')
  assert.equal(m.nombre, 'Ana')
  assert.equal(m.tipo, 'text')
  assert.equal(m.texto, '¿Hay turno hoy?')
  assert.equal(m.adjuntos, null)
  assert.equal(m.timestamp.getTime(), 1725400000 * 1000)
})

test('entrante: de un medio se guardan solo identificadores, y el pie de foto como texto', () => {
  const m = leerEntranteWhatsapp({
    metadata: META,
    contacts: CONTACTS,
    message: {
      from: '18095551234',
      id: 'wamid.2',
      timestamp: '1725400001',
      type: 'image',
      image: { id: 'MEDIA1', mime_type: 'image/jpeg', sha256: 'abc', caption: 'mi carro' },
    },
  })
  assert.ok(m)
  assert.equal(m.tipo, 'image')
  assert.equal(m.texto, 'mi carro')
  assert.deepEqual(m.adjuntos, { medio: { tipo: 'image', id: 'MEDIA1', mime_type: 'image/jpeg', filename: null, sha256: 'abc' } })
})

test('entrante: botones y respuestas interactivas dan su título como texto', () => {
  const b = leerEntranteWhatsapp({
    metadata: META,
    contacts: CONTACTS,
    message: { from: '18095551234', id: 'wamid.3', timestamp: '1725400002', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'SI', title: 'Sí, confirmo' } } },
  })
  assert.equal(b?.texto, 'Sí, confirmo')
  assert.deepEqual(b?.adjuntos, { interactive: 'button_reply', id: 'SI' })
  const r = leerEntranteWhatsapp({
    metadata: META,
    contacts: CONTACTS,
    message: { from: '18095551234', id: 'wamid.4', timestamp: '1725400003', type: 'reaction', reaction: { message_id: 'wamid.OUT', emoji: '👍' }, context: { from: '15550783881', id: 'wamid.OUT' } },
  })
  assert.equal(r?.texto, '👍')
  assert.equal(r?.contextoIdExterno, 'wamid.OUT')
})

test('entrante: lo que no se entiende se guarda con su tipo; lo que no tiene id o remitente, no', () => {
  const u = leerEntranteWhatsapp({ metadata: META, contacts: [], message: { from: '1', id: 'wamid.5', timestamp: '1', type: 'order' } })
  assert.equal(u?.tipo, 'order')
  assert.equal(u?.texto, null)
  assert.equal(leerEntranteWhatsapp({ message: { from: '1', type: 'text', text: { body: 'x' } } }), null)
  assert.equal(leerEntranteWhatsapp({ message: { id: 'wamid.6', type: 'text' } }), null)
  assert.equal(leerEntranteWhatsapp(null), null)
})

test('vista previa: el texto recortado, o el tipo entre corchetes', () => {
  assert.equal(vistaPrevia('text', 'hola'), 'hola')
  assert.equal(vistaPrevia('image', null), '[Imagen]')
  assert.equal(vistaPrevia('template', ''), '[Plantilla]')
  assert.equal(vistaPrevia('text', 'a'.repeat(200)).length, 120)
})

// ─── Estados de salientes ────────────────────────────────────────────────────

test('estados: se leen con su fecha y su primer error; solo avanzan', () => {
  const e = leerEstadoWhatsapp({
    metadata: META,
    status: { id: 'wamid.OUT', status: 'failed', timestamp: '1725400010', recipient_id: '18095551234', errors: [{ code: 131047, title: 'Re-engagement message' }] },
  })
  assert.ok(e)
  assert.equal(e.estadoMeta, 'failed')
  assert.equal(e.errorCodigo, 131047)
  assert.equal(e.errorDetalle, 'Re-engagement message')
  assert.equal(estadoDesdeMeta('failed'), 'FALLIDO')
  assert.equal(estadoDesdeMeta('read'), 'LEIDO')
  assert.equal(estadoDesdeMeta('rarísimo'), null)

  // Un `delivered` que llega después de un `read` no retrocede.
  assert.equal(avanzaEstado('ENVIANDO', 'ENVIADO'), true)
  assert.equal(avanzaEstado('LEIDO', 'ENTREGADO'), false)
  assert.equal(avanzaEstado('ENTREGADO', 'LEIDO'), true)
  assert.equal(avanzaEstado('ENVIADO', 'FALLIDO'), true)
  assert.equal(avanzaEstado('FALLIDO', 'LEIDO'), false, 'FALLIDO es terminal')
})

// ─── Enlace con clientes ─────────────────────────────────────────────────────

test('contactos: un wa_id dominicano se busca en las formas habituales de escribir el teléfono', () => {
  const c = candidatosTelefono('18095551234')
  for (const forma of ['18095551234', '+18095551234', '8095551234', '809-555-1234', '(809) 555-1234', '809 555 1234']) {
    assert.ok(c.includes(forma), `falta ${forma}`)
  }
  // Un extranjero no se dominicaniza.
  const es = candidatosTelefono('34600111222')
  assert.ok(es.includes('+34600111222'))
  assert.ok(!es.includes('600111222'))
  assert.deepEqual(candidatosTelefono(''), [])
})

// ─── Plantillas ──────────────────────────────────────────────────────────────

test('plantillas: se leen las de Meta con sus variables posicionales y la página siguiente', () => {
  const r = leerPlantillasDeMeta({
    data: [
      { id: '1', name: 'recordatorio_cita', language: 'es', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'Hola {{1}}, tu cita es el {{2}} a las {{3}}.' }, { type: 'FOOTER', text: 'Membego' }] },
      { id: '2', name: 'sin_idioma', status: 'APPROVED', category: 'UTILITY', components: [] },
      { id: '3', name: 'promo', language: 'es', status: 'REJECTED', category: 'MARKETING', components: [{ type: 'BODY', text: 'Hoy 2x1' }] },
    ],
    paging: { cursors: { before: 'a', after: 'b' }, next: 'https://graph.facebook.com/…' },
  })
  assert.equal(r.plantillas.length, 2, 'una plantilla sin idioma no se puede enviar')
  assert.equal(r.plantillas[0].variables, 3)
  assert.equal(r.plantillas[1].variables, 0)
  assert.equal(r.siguiente, 'b')
  assert.equal(leerPlantillasDeMeta({ data: [] }).siguiente, null)
  assert.equal(variablesDelCuerpo([{ type: 'BODY', text: '{{1}} y {{1}} otra vez, {{2}}' }]), 2)
})

test('cuerpos: marcar como leído es exactamente lo documentado', () => {
  assert.deepEqual(cuerpoMarcarLeido('wamid.X'), { messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.X' })
})

test('cuerpos: el de plantilla queda fijado, y marcado como pendiente de verificar', () => {
  // ⚠ La página oficial de «Send message templates» no se pudo abrir en la
  // auditoría; esta prueba fija lo que se manda para que, al confirmarlo con
  // la colección de Postman, cualquier diferencia salte aquí.
  assert.deepEqual(cuerpoMensajePlantilla('18095551234', 'recordatorio_cita', 'es', ['Ana', 'lunes', '9:00']), {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: '18095551234',
    type: 'template',
    template: {
      name: 'recordatorio_cita',
      language: { code: 'es' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }, { type: 'text', text: 'lunes' }, { type: 'text', text: '9:00' }] }],
    },
  })
  assert.deepEqual(cuerpoMensajePlantilla('1', 'x', 'es', []).template, { name: 'x', language: { code: 'es' }, components: [] })
  assert.match(leer('src/modules/mensajeria/nucleo.ts'), /VERIFICAR CONTRA LA COLECCIÓN DE POSTMAN/)
})

// ─── El esquema ──────────────────────────────────────────────────────────────

test('esquema: contactos, conversaciones y mensajes son de UNA empresa y no se duplican', () => {
  const s = leer('prisma/schema/mensajeria.prisma')
  assert.match(s, /model ContactoMensajeria[\s\S]*@@unique\(\[companyId, canal, idExterno\]\)/)
  assert.match(s, /model Conversacion[\s\S]*@@unique\(\[companyId, activoId, contactoId\]\)/)
  assert.match(s, /model Mensaje[\s\S]*@@unique\(\[canal, idExterno\]\)/)
  assert.match(s, /model PlantillaWhatsapp[\s\S]*@@unique\(\[activoId, idExterno\]\)/)
  const m = leer('prisma/migrations/20260910_mensajeria_meta/migration.sql')
  for (const t of ['contactos_mensajeria', 'conversaciones', 'mensajes', 'plantillas_whatsapp']) {
    assert.match(m, new RegExp(`CREATE TABLE IF NOT EXISTS "${t}"`))
    assert.match(m, new RegExp(`ALTER TABLE "${t}"\\s+ENABLE ROW LEVEL SECURITY`))
  }
  assert.ok(!/^\s*(DROP|DELETE|UPDATE|TRUNCATE)\b/im.test(m), 'la migración tiene que ser aditiva')
})

// ─── Cableado ────────────────────────────────────────────────────────────────

test('despacho: mensajes, estados y plantillas de WhatsApp tienen manejador', () => {
  const d = codigo('src/modules/connect/meta/webhookDispatcher.ts')
  assert.match(d, /campo === 'messages'/)
  assert.match(d, /campo === 'statuses'/)
  assert.match(d, /message_template_status_update/)
  // Carga perezosa: connect no importa mensajería de forma estática.
  assert.ok(!/^import .*mensajeria/m.test(d), 'connect importa mensajería estáticamente (ciclo)')
})

test('entrantes: el mensaje es único por wamid y un duplicado deshace el no leído', () => {
  const src = codigo('src/modules/mensajeria/entrantes.ts')
  assert.match(src, /e\.code === 'P2002'/)
  assert.match(src, /noLeidos: \{ decrement: 1 \}/)
  assert.match(src, /avanzaEstado\(mensaje\.estado, nuevo\)/)
})

test('salientes: todo envío queda en su conversación, y la bandeja respeta la ventana', () => {
  const w = codigo('src/modules/connect/whatsapp.ts')
  assert.match(w, /registrarSalienteWhatsapp\(/)
  assert.match(w, /estado: 'FALLIDO'/, 'un envío fallido también se registra')
  assert.match(w, /Meta respondió \$\{resp\.status\}/)
  const s = codigo('src/modules/mensajeria/salientes.ts')
  const texto = s.slice(s.indexOf('export async function enviarTextoEnConversacion'))
  assert.ok(texto.indexOf('ventanaAbierta(') < texto.indexOf('enviarWhatsapp('), 'la ventana se comprueba ANTES de llamar a Meta')
  assert.match(texto, /motivo: 'ventana_cerrada'/)
  // Una plantilla solo se envía si está APROBADA y con sus parámetros justos.
  const plantilla = s.slice(s.indexOf('export async function enviarPlantillaEnConversacion'))
  assert.match(plantilla, /estado: 'APPROVED'/)
  assert.match(plantilla, /plantilla\.variables !== input\.parametros\.length/)
})

test('plantillas: se piden con los campos documentados y una conexión manual lo dice', () => {
  const p = codigo('src/modules/mensajeria/plantillas.ts')
  assert.match(p, /message_templates/)
  assert.match(p, /'id,name,language,status,category,components'/)
  assert.match(p, /motivo: 'sin_waba'/)
  assert.ok((EVENTOS_CONECTOR as readonly string[]).includes('whatsapp.plantillas_sincronizadas'))
  assert.notEqual(textoTecnico('whatsapp.plantillas_sincronizadas'), 'whatsapp.plantillas_sincronizadas')
})
