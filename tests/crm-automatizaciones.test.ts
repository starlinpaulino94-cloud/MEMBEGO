import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ETAPAS,
  ETAPAS_ABIERTAS,
  ETIQUETA_ETAPA,
  esEtapa,
  esTipoSeguimiento,
  minutosMedianosDeRespuesta,
  naceProspecto,
  paresDeRespuesta,
  tasaDeConversion,
} from '../src/modules/crm/nucleo'
import { AUTOMATION_EVENTS, AUTOMATION_EVENT_CATALOG } from '../src/lib/automation/domain/events'
import { ACTION_CATALOG, ACTION_TYPES } from '../src/lib/rule-engine/domain/action-catalog'

/**
 * META · FASES 6 y 7 — CRM real y automatizaciones sobre la mensajería.
 * Lo que se vigila: que un prospecto nazca solo de quien no es cliente, que
 * todo cruce `companyId`, que las pantallas del CRM no lleven nada simulado,
 * que el disparador «mensaje recibido» y las acciones de los tres canales
 * existan de verdad, y que fuera de la ventana solo salga una plantilla.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const codigo = (r: string) =>
  leer(r).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

test('embudo: seis etapas fijas con etiqueta; cuatro en juego', () => {
  assert.deepEqual([...ETAPAS], ['nuevo', 'contactado', 'cotizacion', 'negociacion', 'cerrado', 'perdido'])
  assert.deepEqual([...ETAPAS_ABIERTAS], ['nuevo', 'contactado', 'cotizacion', 'negociacion'])
  for (const e of ETAPAS) assert.ok(ETIQUETA_ETAPA[e].length > 3)
  assert.equal(esEtapa('cotizacion'), true)
  assert.equal(esEtapa('ganado'), false)
  assert.equal(esTipoSeguimiento('Reunión'), true)
  assert.equal(esTipoSeguimiento('SMS'), false)
})

test('un prospecto nace solo de quien todavía no es cliente', () => {
  assert.equal(naceProspecto({ clienteId: null }), true)
  assert.equal(naceProspecto({ clienteId: 'cli_1' }), false)
  const src = codigo('src/modules/crm/prospectos.ts')
  assert.match(src, /if \(!naceProspecto\(input\.contacto\)\) return null/)
  // Toda consulta cruza la empresa.
  // El filtro anidado del contador de seguimientos pendientes vive DENTRO de
  // una consulta ya acotada por empresa; el resto son filtros de consulta.
  const wheres = (src.match(/where: {[^}]*}/g) ?? []).filter((w) => w !== 'where: { hechoAt: null }')
  assert.ok(wheres.length >= 6)
  for (const w of wheres) assert.match(w, /companyId/, `where sin companyId: ${w}`)
  // Convertir usa el alta de siempre y enlaza el contacto a la ficha.
  assert.match(src, /altaCliente\(companyId, datos, `crm:\$\{p\.canal\.toLowerCase\(\)\}`\)/)
  assert.match(src, /enlazarContactoConCliente\(\{ companyId, contactoId: p\.contactoId, clienteId: alta\.cliente\.id \}\)/)
})

test('métricas puras: mediana de respuesta y conversión', () => {
  const t = (min: number) => new Date(1_700_000_000_000 + min * 60_000)
  const pares = paresDeRespuesta([
    { conversacionId: 'a', direccion: 'ENTRANTE', timestamp: t(0) },
    { conversacionId: 'a', direccion: 'SALIENTE', timestamp: t(10) },
    { conversacionId: 'a', direccion: 'SALIENTE', timestamp: t(50) },
    { conversacionId: 'b', direccion: 'SALIENTE', timestamp: t(0) }, // saliente antes del entrante: no cuenta
    { conversacionId: 'b', direccion: 'ENTRANTE', timestamp: t(5) },
    { conversacionId: 'b', direccion: 'SALIENTE', timestamp: t(35) },
    { conversacionId: 'c', direccion: 'ENTRANTE', timestamp: t(0) }, // sin respuesta
  ])
  assert.equal(pares.length, 3)
  assert.equal(minutosMedianosDeRespuesta(pares), 20)
  assert.equal(minutosMedianosDeRespuesta([]), null)
  assert.equal(tasaDeConversion(3, 12), 25)
  assert.equal(tasaDeConversion(0, 0), null)
})

test('esquema y migración: un prospecto por contacto, aditivo, con RLS', () => {
  const schema = leer('prisma/schema/crm.prisma')
  assert.match(schema, /contactoId String\s+@unique/)
  assert.match(schema, /onDelete: Restrict/)
  assert.match(leer('prisma/schema/mensajeria.prisma'), /prospecto\s+Prospecto\?/)
  const sql = leer('prisma/migrations/20260911_crm_prospectos/migration.sql')
  assert.ok(!/^\s*(DROP|DELETE|UPDATE|TRUNCATE)\b/im.test(sql), 'la migración no es aditiva')
  assert.match(sql, /"prospectos_contactoId_key" ON "prospectos"\("contactoId"\)/)
  assert.match(sql, /ALTER TABLE "prospectos"\s+ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /ALTER TABLE "seguimientos_prospecto" ENABLE ROW LEVEL SECURITY/)
})

test('tras cada entrante: prospecto y evento, después de guardar y sin poder romper el webhook', () => {
  for (const f of ['src/modules/mensajeria/entrantes.ts', 'src/modules/mensajeria/messenger.ts']) {
    const src = codigo(f)
    assert.ok(src.indexOf("hecho.r.startsWith('entrante')") > src.indexOf('tx.mensaje.create('), `${f}: se avisa antes de guardar`)
    assert.match(src, /await trasEntrante\(\{/)
  }
  const tras = codigo('src/modules/mensajeria/trasEntrante.ts')
  assert.match(tras, /try \{[\s\S]*registrarProspectoDesdeEntrante[\s\S]*emitirMensajeRecibido[\s\S]*\} catch \(e\) \{/)
  assert.match(tras, /if \(prospecto\?\.creado\)/)
  assert.match(tras, /primero: input\.contacto\.nuevo/)
})

test('disparadores y acciones nuevos existen en los catálogos', () => {
  assert.equal(AUTOMATION_EVENTS.MESSAGE_RECEIVED, 'mensaje.recibido')
  assert.equal(AUTOMATION_EVENTS.PROSPECT_CREATED, 'prospecto.creado')
  for (const id of ['mensaje.recibido', 'prospecto.creado']) {
    const def = AUTOMATION_EVENT_CATALOG.find((e) => e.id === id)
    assert.ok(def, `${id} sin entrada en el catálogo`)
    assert.match(def.description, /contacto\.nombre/)
  }
  assert.equal(ACTION_TYPES.SEND_MESSENGER, 'send_messenger')
  assert.equal(ACTION_TYPES.SEND_INSTAGRAM, 'send_instagram')
  for (const id of ['send_messenger', 'send_instagram']) {
    const def = ACTION_CATALOG.find((a) => a.id === id)
    assert.equal(def?.category, 'NOTIFICACIONES')
    assert.match(def!.description, /24 h/)
  }
  const sink = codigo('src/modules/estrategias/actionSink.ts')
  assert.match(sink, /case ACTION_TYPES\.SEND_MESSENGER:\s*return await this\.enviarPorMensajeria\('MESSENGER', input\)/)
  assert.match(sink, /case ACTION_TYPES\.SEND_INSTAGRAM:\s*return await this\.enviarPorMensajeria\('INSTAGRAM', input\)/)
  assert.match(sink, /case ACTION_TYPES\.SEND_WHATSAPP:\s*return await this\.enviarPorMensajeria\('WHATSAPP', input\)/)
  // WhatsApp no conectado sigue siendo intención simulada, como antes.
  assert.match(sink, /reason: 'WhatsApp no conectado'/)
})

test('envío automatizado: plantilla aprobada por nombre; sin conversación no se inicia Messenger ni Instagram', () => {
  const src = codigo('src/modules/mensajeria/automatizaciones.ts')
  assert.match(src, /estado: 'APPROVED'/)
  assert.match(src, /plantilla\.variables !== e\.parametros\.length/)
  assert.match(src, /if \(e\.plantilla && e\.canal !== 'WHATSAPP'\) return \{ ok: false/)
  assert.match(src, /reason: 'sin conversación abierta por este canal'/)
  assert.match(src, /origen: 'automatizacion'/)
  // El id de conversación que llega de una regla se valida por forma.
  assert.match(src, /ID_VALIDO\.test\(params\.conversacionId\)/)
  // Los envíos desde la bandeja siguen firmados por quien los manda; los de
  // automatización, sin persona y con su origen.
  const sal = codigo('src/modules/mensajeria/salientes.ts')
  assert.match(sal, /origen: input\.origen \?\? 'bandeja'/)
})

test('las pantallas del CRM leen datos reales y guardan con la empresa de la sesión', () => {
  const CRM = 'src/app/(admin)/admin/crm'
  assert.match(leer(`${CRM}/page.tsx`), /listarProspectos\(companyId/)
  assert.match(leer(`${CRM}/seguimientos/page.tsx`), /listarSeguimientos\(companyId, 'pendientes'\)/)
  assert.match(leer(`${CRM}/metricas/page.tsx`), /metricasCrm\(user\.metadata\.companyId\)/)
  assert.match(leer(`${CRM}/prospectos/[id]/page.tsx`), /prospectoDe\(user\.metadata\.companyId, id\)/)
  const acciones = codigo('src/modules/crm/actions.ts')
  assert.match(acciones, /^'use server'/)
  assert.match(acciones, /requireAdminUser\(\)/)
  assert.ok(!/formData\.get\(['"]companyId['"]\)/.test(acciones))
  const exportadas = (acciones.match(/export async function (\w+)/g) ?? []).map((a) => a.replace('export async function ', ''))
  assert.deepEqual(exportadas, ['cambiarEtapaAction', 'guardarNotasAction', 'convertirEnClienteAction', 'crearSeguimientoAction', 'marcarSeguimientoHechoAction'])
  for (const a of exportadas) {
    const desde = acciones.indexOf(`export async function ${a}`)
    const hasta = acciones.indexOf('export async function', desde + 1)
    const cuerpo = acciones.slice(desde, hasta === -1 ? undefined : hasta)
    assert.match(cuerpo, /const yo = await quien\(\)/, `${a} no pasa por quien()`)
  }
})
