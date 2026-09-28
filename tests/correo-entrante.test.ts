import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'

import {
  crearDireccionRespuesta,
  resolverTicketDeDireccion,
  resolverTicketDeDestinatarios,
} from '../src/lib/email/respuestas'
import { verificarFirmaSvix, TOLERANCIA_SEGUNDOS } from '../src/lib/webhooks/svix'
import { htmlATexto, quitarCita } from '../src/modules/soporte/entrante'

/**
 * CORREO ENTRANTE.
 *
 * Lo que se prueba aquí NO es que la función feliz funcione —eso lo ve
 * cualquiera al primer correo—, sino que las dos puertas cierren: la firma del
 * webhook y la firma de la dirección. Si una de las dos se abre, un desconocido
 * escribe en los tickets de cualquier empresa.
 */

const DOM = 'respuestas.membego.com'
const SEC = 'secreto-de-prueba'

// ── Direcciones de respuesta firmadas ────────────────────────────────────────

test('ida y vuelta: la dirección generada se resuelve al mismo ticket', () => {
  const dir = crearDireccionRespuesta('ckabc123', DOM, SEC)
  assert.ok(dir)
  assert.match(dir, /^t-ckabc123-[0-9a-f]{20}@respuestas\.membego\.com$/)
  assert.equal(resolverTicketDeDireccion(dir, DOM, SEC), 'ckabc123')
})

test('sin dominio o sin secreto no se genera dirección (se envía sin Reply-To)', () => {
  // `undefined` como argumento activa el default param (process.env), que en
  // test puede estar definido: la dirección SÍ se genera. Sin dominio vacío sí
  // devuelve null porque `!""` es truthy.
  assert.equal(crearDireccionRespuesta('ckabc123', '', SEC), null)
  assert.equal(crearDireccionRespuesta('ckabc123', DOM, ''), null)
  assert.equal(crearDireccionRespuesta('', DOM, SEC), null)
})

test('SEGURIDAD · una firma manipulada NO resuelve', () => {
  const dir = crearDireccionRespuesta('ckabc123', DOM, SEC)!
  const rota = dir.replace(/-([0-9a-f]{20})@/, (_m, f: string) => {
    const primera = f[0] === '0' ? '1' : '0'
    return `-${primera}${f.slice(1)}@`
  })
  assert.notEqual(rota, dir)
  assert.equal(resolverTicketDeDireccion(rota, DOM, SEC), null)
})

test('SEGURIDAD · cambiar el ticket invalida la firma (no se salta a otro ticket)', () => {
  const dir = crearDireccionRespuesta('ckabc123', DOM, SEC)!
  const firma = dir.split('-').pop()!.split('@')[0]
  const suplantada = `t-ckvictima9-${firma}@${DOM}`
  assert.equal(resolverTicketDeDireccion(suplantada, DOM, SEC), null)
})

test('SEGURIDAD · con otro secreto no valida (rotar el secreto corta las viejas)', () => {
  const dir = crearDireccionRespuesta('ckabc123', DOM, SEC)!
  assert.equal(resolverTicketDeDireccion(dir, DOM, 'otro-secreto'), null)
})

test('SEGURIDAD · una dirección de otro dominio se descarta', () => {
  const dir = crearDireccionRespuesta('ckabc123', DOM, SEC)!
  const ajena = dir.replace(DOM, 'atacante.com')
  assert.equal(resolverTicketDeDireccion(ajena, DOM, SEC), null)
})

test('la dirección se reconoce dentro de «Nombre <buzón>» y con mayúsculas', () => {
  const dir = crearDireccionRespuesta('ckabc123', DOM, SEC)!
  assert.equal(resolverTicketDeDireccion(`Soporte MembeGo <${dir}>`, DOM, SEC), 'ckabc123')
  assert.equal(resolverTicketDeDireccion(dir.toUpperCase(), DOM, SEC), 'ckabc123')
})

test('basura y formas raras devuelven null en vez de reventar', () => {
  for (const mala of ['', 'hola', '@', 't-@' + DOM, `t-sinfirma@${DOM}`, `otro-x@${DOM}`]) {
    assert.equal(resolverTicketDeDireccion(mala, DOM, SEC), null, mala)
  }
})

test('entre varios destinatarios encuentra el nuestro y descarta el resto', () => {
  const dir = crearDireccionRespuesta('ckabc123', DOM, SEC)!
  const lista = ['otro@gmail.com', 'copia@empresa.com', dir]
  assert.equal(resolverTicketDeDestinatarios(lista, DOM, SEC), 'ckabc123')
  assert.equal(resolverTicketDeDestinatarios(['a@b.com'], DOM, SEC), null)
})

// ── Firma del webhook ────────────────────────────────────────────────────────

const SECRETO_WH = 'whsec_' + Buffer.from('clave-de-prueba-para-el-hmac').toString('base64')

function firmar(cuerpo: string, id: string, ts: number, secreto = SECRETO_WH): string {
  const clave = Buffer.from(secreto.replace(/^whsec_/, ''), 'base64')
  return 'v1,' + createHmac('sha256', clave).update(`${id}.${ts}.${cuerpo}`).digest('base64')
}

const CUERPO = JSON.stringify({ type: 'email.received', data: { email_id: 'e1' } })
const AHORA = 1_760_000_000

test('una firma correcta pasa', () => {
  const r = verificarFirmaSvix(
    CUERPO,
    { id: 'msg_1', timestamp: String(AHORA), signature: firmar(CUERPO, 'msg_1', AHORA) },
    SECRETO_WH,
    AHORA
  )
  assert.deepEqual(r, { valida: true })
})

test('SEGURIDAD · sin secreto configurado NO pasa nada (fail-closed)', () => {
  const r = verificarFirmaSvix(
    CUERPO,
    { id: 'msg_1', timestamp: String(AHORA), signature: firmar(CUERPO, 'msg_1', AHORA) },
    undefined,
    AHORA
  )
  assert.equal(r.valida, false)
})

test('SEGURIDAD · si el cuerpo cambia un byte, la firma deja de valer', () => {
  const firma = firmar(CUERPO, 'msg_1', AHORA)
  const alterado = CUERPO.replace('"e1"', '"e2"')
  const r = verificarFirmaSvix(
    alterado,
    { id: 'msg_1', timestamp: String(AHORA), signature: firma },
    SECRETO_WH,
    AHORA
  )
  assert.equal(r.valida, false)
})

test('SEGURIDAD · firmado con otro secreto no pasa', () => {
  const otro = 'whsec_' + Buffer.from('otra-clave-distinta').toString('base64')
  const r = verificarFirmaSvix(
    CUERPO,
    { id: 'msg_1', timestamp: String(AHORA), signature: firmar(CUERPO, 'msg_1', AHORA, otro) },
    SECRETO_WH,
    AHORA
  )
  assert.equal(r.valida, false)
})

test('SEGURIDAD · reenvío viejo rechazado, y del futuro también', () => {
  const firma = firmar(CUERPO, 'msg_1', AHORA)
  const cab = { id: 'msg_1', timestamp: String(AHORA), signature: firma }
  assert.equal(verificarFirmaSvix(CUERPO, cab, SECRETO_WH, AHORA + TOLERANCIA_SEGUNDOS + 1).valida, false)
  assert.equal(verificarFirmaSvix(CUERPO, cab, SECRETO_WH, AHORA - TOLERANCIA_SEGUNDOS - 1).valida, false)
  assert.equal(verificarFirmaSvix(CUERPO, cab, SECRETO_WH, AHORA + TOLERANCIA_SEGUNDOS - 1).valida, true)
})

test('faltando cualquier cabecera, no pasa', () => {
  const firma = firmar(CUERPO, 'msg_1', AHORA)
  const casos = [
    { id: null, timestamp: String(AHORA), signature: firma },
    { id: 'msg_1', timestamp: null, signature: firma },
    { id: 'msg_1', timestamp: String(AHORA), signature: null },
    { id: 'msg_1', timestamp: 'no-es-numero', signature: firma },
  ]
  for (const cab of casos) {
    assert.equal(verificarFirmaSvix(CUERPO, cab, SECRETO_WH, AHORA).valida, false)
  }
})

test('con el secreto rotado, vale la firma nueva aunque venga junto a la vieja', () => {
  const vieja = firmar(CUERPO, 'msg_1', AHORA, 'whsec_' + Buffer.from('vieja').toString('base64'))
  const nueva = firmar(CUERPO, 'msg_1', AHORA)
  const r = verificarFirmaSvix(
    CUERPO,
    { id: 'msg_1', timestamp: String(AHORA), signature: `${vieja} ${nueva}` },
    SECRETO_WH,
    AHORA
  )
  assert.equal(r.valida, true)
})

// ── Limpieza del cuerpo ──────────────────────────────────────────────────────

test('htmlATexto deja texto legible y tira estilos y scripts', () => {
  const html = `<style>p{color:red}</style><p>Hola,</p><p>&iquest;siguen&nbsp;abiertos?</p>
                <script>alert(1)</script><div>Gracias &amp; saludos</div>`
  const t = htmlATexto(html)
  assert.ok(!t.includes('color:red'))
  assert.ok(!t.includes('alert'))
  assert.ok(t.includes('Hola,'))
  assert.ok(t.includes('Gracias & saludos'))
})

test('quitarCita corta el hilo citado de Gmail y las líneas con >', () => {
  const cuerpo = `Ya lo resolví, gracias.

On Mon, 17 Aug 2026 at 10:00, Soporte <a@b.com> wrote:
> ¿Pudiste entrar?
> Avísanos.`
  assert.equal(quitarCita(cuerpo), 'Ya lo resolví, gracias.')
})

test('quitarCita corta el formato de Outlook y el español', () => {
  assert.equal(quitarCita('Perfecto.\n\n-----Mensaje original-----\nDe: x'), 'Perfecto.')
  assert.equal(quitarCita('Listo.\n\nEl 17 ago 2026, Soporte escribió:\n> hola'), 'Listo.')
})

test('quitarCita NUNCA devuelve vacío: ante la duda conserva el texto', () => {
  // Un correo que es SOLO cita: se prefiere guardar de más a perder el mensaje.
  const soloCita = '> únicamente texto citado'
  assert.equal(quitarCita(soloCita), soloCita)
  const soloSeparador = 'On Mon, 17 Aug 2026 at 10:00, X <a@b.com> wrote:'
  assert.equal(quitarCita(soloSeparador), soloSeparador)
})

test('un cuerpo normal sin cita se queda intacto', () => {
  const t = 'Hola, tengo un problema con mi membresía.\n\nGracias.'
  assert.equal(quitarCita(t), t)
})

// ── Quién escribió: el cliente o el negocio ─────────────────────────────────
//
// Desde el 25-09-2026 las DOS partes reciben la misma dirección de respuesta
// firmada: el negocio en el correo de «ticket nuevo» y el cliente en el de «te
// respondieron». Las dos respuestas entran por el mismo webhook.
//
// Antes solo escribía el negocio y todo se archivaba como CLIENTE. Ahora eso
// haría que la respuesta del negocio apareciera en el hilo como si la hubiera
// escrito el cliente — un hilo de soporte con los papeles cambiados, que es
// peor que uno incompleto.
//
// Se prueba la parte PURA de esa decisión: extraer el buzón de un `From`. La
// comparación con el correo de soporte necesita base y la vigila la prueba de
// arquitectura de abajo.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ENTRANTE = readFileSync(join(__dirname, '..', 'src', 'modules', 'soporte', 'entrante.ts'), 'utf8')

test('el autor se DECIDE, ya no se da por hecho', () => {
  // La línea que estaba antes: `autorTipo: 'CLIENTE'` fijo.
  assert.ok(
    !/autorTipo:\s*'CLIENTE'/.test(ENTRANTE),
    'entrante.ts vuelve a archivar todo como CLIENTE sin mirar quién escribió'
  )
  assert.match(ENTRANTE, /autorTipo,/)
  assert.match(ENTRANTE, /function quienEscribe\(/)
})

test('SEGURIDAD · solo se marca ADMIN al coincidir con el correo de soporte', () => {
  const i = ENTRANTE.indexOf('function quienEscribe(')
  const cuerpo = ENTRANTE.slice(i, ENTRANTE.indexOf('\n}', i))
  // Un solo camino hacia ADMIN, y pasa por comparar con `correoSoporte`.
  assert.equal((cuerpo.match(/return 'ADMIN'/g) ?? []).length, 1)
  assert.match(cuerpo, /correoSoporte/)
  // Y ante cualquier duda, CLIENTE: es lo que ya hacía, así que el cambio no
  // puede empeorar ningún caso que hoy funcione.
  assert.match(cuerpo, /return 'CLIENTE'\s*$/m)
})

test('el buzón se extrae de «Nombre <buzon>» y se compara sin mayúsculas', () => {
  const i = ENTRANTE.indexOf('function soloBuzon(')
  const cuerpo = ENTRANTE.slice(i, ENTRANTE.indexOf('\n}', i))
  assert.match(cuerpo, /<\(\[\^>\]\+\)>|<\(\[\^>\]\+\)>/)
  assert.match(cuerpo, /toLowerCase\(\)/)
})

// ── El correo al cliente cuando le responden ────────────────────────────────

const ACTIONS = readFileSync(join(__dirname, '..', 'src', 'modules', 'soporte', 'actions.ts'), 'utf8')

test('responder un ticket AVISA al cliente por correo, no solo en la app', () => {
  const i = ACTIONS.indexOf('export async function responderTicket(')
  const cuerpo = ACTIONS.slice(i, ACTIONS.indexOf('export async function responderTicketCliente', i))
  assert.match(cuerpo, /avisarAlClientePorCorreo\(/, 'el cliente solo se entera si entra a la app')
  assert.match(cuerpo, /crearNotificacion\(/, 'la notificación en la app sigue haciendo falta')
})

test('SEGURIDAD · el cuerpo va escapado y el asunto no', () => {
  const i = ACTIONS.indexOf('async function avisarAlClientePorCorreo(')
  const fn = ACTIONS.slice(i, ACTIONS.indexOf('\n}', ACTIONS.indexOf('encolarEmail', i)))
  assert.match(fn, /escaparHtml\(cuerpo\)/, 'un < en la respuesta rompería el HTML del correo')
  assert.match(fn, /escaparHtml\(ticket\.asunto\)/)
  // `subject` es texto plano: escaparlo se leería como `&lt;` en la bandeja.
  assert.ok(!/subject:.*escaparHtml/.test(fn), 'el asunto no debe escaparse')
})

test('a las empresas de demostración NO se les manda correo', () => {
  const i = ACTIONS.indexOf('async function avisarAlClientePorCorreo(')
  const fn = ACTIONS.slice(i, i + 2500)
  // Se exige la SALIDA TEMPRANA, no que se mencione `esEmpresaDemo`. La
  // primera versión de esta prueba comprobaba lo segundo y no servía: al quitar
  // el `if`, el `import` seguía ahí y la prueba pasaba tan contenta.
  assert.match(
    fn,
    /if \(await esEmpresaDemo\([^)]*\)\) return/,
    'sus clientes son inventados: los rebotes ensucian la reputación del dominio'
  )
  const guarda = fn.search(/if \(await esEmpresaDemo/)
  assert.ok(guarda !== -1 && guarda < fn.indexOf('encolarEmail'), 'la guarda va ANTES del envío')
})

test('el aviso NO puede tumbar la respuesta del administrador', () => {
  const i = ACTIONS.indexOf('async function avisarAlClientePorCorreo(')
  const fn = ACTIONS.slice(i, ACTIONS.indexOf('export async function responderTicket(', i))
  assert.match(fn, /try \{/)
  assert.match(fn, /catch/)
})

test('el cliente puede contestar por correo: lleva Reply-To firmado', () => {
  const i = ACTIONS.indexOf('async function avisarAlClientePorCorreo(')
  const fn = ACTIONS.slice(i, ACTIONS.indexOf('export async function responderTicket(', i))
  assert.match(fn, /crearDireccionRespuesta\(ticket\.id\)/)
  assert.match(fn, /replyTo,/)
  // Y si no hay dominio configurado, se avisa igual y se le dice que entre.
  assert.match(fn, /Entra a tu cuenta/)
})
