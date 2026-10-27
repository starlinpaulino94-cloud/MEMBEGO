/**
 * VERIFICACIÓN DE IDENTIDAD · Fase 3 · la puerta de la persona, contra PostgreSQL real y el Didit falso.
 *
 * Lo que comparten la web y la app: qué ve la persona (`leerPanelDeIdentidad`), cómo empieza
 * (`iniciarVerificacionDePersona`), sus permisos, sus incidencias, el borrado de sus datos y los avisos de
 * resultado. Cada prueba falla si vuelve el defecto que cierra:
 *
 *   1 · enseñar una sección apagada, o dejar empezar con la verificación apagada;
 *   2 · capturar con un permiso dado sobre un texto que ya no es el vigente;
 *   3 · aceptar «una versión» del texto que la persona no vio;
 *   4 · una incidencia que se cuela en una bitácora o en un correo con el texto de la persona;
 *   5 · inundar la cola del equipo, o apuntar a un intento ajeno;
 *   6 · borrar lo local sin que el proveedor confirme, o dejar la sección «borrar» viva tras borrar;
 *   7 · un aviso repetido, o que revele el motivo de un rechazo por fraude o de un documento repetido.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { prisma } from '../../src/lib/prisma'
import {
  cambiarInterruptorDeIdentidad,
  crearIntento,
  otorgarConsentimientoIdentidad,
  type ActorDeIdentidad,
} from '../../src/modules/identidad/identidad'
import { TEXTO_VERSION_BIOMETRIA, TEXTO_VERSION_TRANSFERENCIA, TEXTO_VERSION_DIVULGACION } from '../../src/modules/identidad/identidadConsentimientosCore'
import {
  cambiarConsentimientoDePersona,
  iniciarVerificacionDePersona,
  leerPanelDeIdentidad,
  pedirBorradoDePersona,
  reportarProblemaDePersona,
  type ContextoDePeticion,
  type QuienEs,
} from '../../src/modules/identidad/identidadPuerta'
import { recibirAvisoDeProveedor } from '../../src/modules/identidad/eventos'
import { sincronizarIntento } from '../../src/modules/identidad/sincronizacion'
import { DiditFalso, crearAvisoFirmado } from './_helpers/didit-falso'

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const API_KEY = `clave-didit-sintetica-${sufijo}`
const SECRETO = `secreto-webhook-sintetico-${sufijo}`.padEnd(32, 'x')
const PEPPER = `pepper-de-prueba-${sufijo}-`.padEnd(40, 'x')
const avisoFirmado = crearAvisoFirmado(SECRETO)
const WEB: ContextoDePeticion = { canal: 'web', ip: '190.80.12.5', userAgent: 'prueba-puerta' }
const MOVIL: ContextoDePeticion = { canal: 'movil', ip: '190.80.12.6', userAgent: 'prueba-app' }

const VARIABLES = ['IDENTIDAD_CLAVES_MAESTRAS', 'IDENTIDAD_PEPPER_DEDUPE', 'DIDIT_API_KEY', 'DIDIT_WORKFLOW_ID', 'DIDIT_WEBHOOK_SECRET', 'RESEND_API_KEY'] as const
const anterior: Record<string, string | undefined> = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
const fetchOriginal = globalThis.fetch
let staff: ActorDeIdentidad
let dd: DiditFalso

before(async () => {
  process.env.IDENTIDAD_CLAVES_MAESTRAS = `1:${randomBytes(32).toString('base64')}`
  process.env.IDENTIDAD_PEPPER_DEDUPE = PEPPER
  process.env.DIDIT_API_KEY = API_KEY
  process.env.DIDIT_WORKFLOW_ID = '11111111-0000-0000-0000-000000000001'
  process.env.DIDIT_WEBHOOK_SECRET = SECRETO
  process.env.RESEND_API_KEY = 're_prueba_sintetica'
  dd = new DiditFalso(sufijo)
  globalThis.fetch = dd.manejar as typeof fetch
  const u = await prisma.user.create({
    data: { supabaseId: `sb-idq-staff-${sufijo}`, email: `staff-idq-${sufijo}@prueba.test`, name: 'Equipo', role: 'SUPERADMIN' },
    select: { id: true },
  })
  staff = { userId: u.id, rol: 'SUPERADMIN' }
  await encender()
  await prisma.identidadIntento.updateMany({
    where: { estado: { in: ['creada', 'iniciada', 'enviada', 'en_proceso', 'reenvio_requerido', 'en_revision'] } },
    data: { estado: 'cancelada', resueltoAt: new Date() },
  })
  await prisma.identidadIntento.updateMany({ where: { referenciaProveedorSellada: { not: null }, purgadoAt: null }, data: { purgadoAt: new Date() } })
})
after(async () => {
  globalThis.fetch = fetchOriginal
  await prisma.identidadInterruptor.updateMany({ where: { clave: 'VERIFICACION_IDENTIDAD' }, data: { enabled: false } })
  for (const v of VARIABLES) {
    if (anterior[v] === undefined) delete process.env[v]
    else process.env[v] = anterior[v]
  }
})

const encender = () => cambiarInterruptorDeIdentidad(staff, { encendido: true, motivo: 'Pruebas automáticas de la puerta con datos sintéticos.' })
const apagar = () => cambiarInterruptorDeIdentidad(staff, { encendido: false, motivo: 'Apagada en la prueba.' })

let n = 0
async function persona(etiqueta = 'p'): Promise<QuienEs & { email: string }> {
  const k = n++
  const u = await prisma.user.create({
    data: { supabaseId: `sb-idq-${etiqueta}-${sufijo}-${k}`, email: `idq-${etiqueta}-${sufijo}-${k}@prueba.test`, name: `Persona ${etiqueta} ${k}`, role: 'CLIENTE' },
    select: { id: true, supabaseId: true, email: true },
  })
  return { userId: u.id, supabaseId: u.supabaseId, email: u.email }
}
const TODOS = { IDENTIDAD_BIOMETRIA: TEXTO_VERSION_BIOMETRIA, IDENTIDAD_TRANSFERENCIA_INTERNACIONAL: TEXTO_VERSION_TRANSFERENCIA }
const asientos = (userId: string, accion: string) => prisma.auditLog.findMany({ where: { entidadTipo: 'IdentidadVerificacion', entidadId: userId, accion: accion as never } })
const notifs = (userId: string) => prisma.notificacion.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } })

/** Una persona que empezó con todos los permisos (por la puerta, como lo haría la pantalla). */
async function empezada(etiqueta = 'e', aceptados: Record<string, string> = TODOS) {
  const q = await persona(etiqueta)
  const r = await iniciarVerificacionDePersona(q, { aceptados }, WEB)
  assert.equal(r.ok, true, JSON.stringify(r))
  if (!r.ok) throw new Error('no inició')
  return { q, intentoId: r.intentoId, url: r.url }
}
const recibir = async (a: ReturnType<typeof avisoFirmado>) => {
  const r = await recibirAvisoDeProveedor({ proveedor: 'didit', cuerpoCrudo: a.cuerpoCrudo, cabeceras: a.cabeceras })
  if (r.despues) await r.despues()
}

// ── 1 · El panel ────────────────────────────────────────────────────────────

test('1 · EL PANEL de quien nunca empezó: sección visible, a verificar, con los tres permisos sin dar y nada interno', async () => {
  const q = await persona('panel')
  const p = await leerPanelDeIdentidad(q.userId)
  assert.equal(p.visible, true)
  assert.deepEqual([p.vista.accion, p.vista.etiqueta, p.vista.requiereConsentimientos, p.vista.puedeBorrar], ['verificar', 'Sin verificar', true, false])
  assert.deepEqual(p.consentimientos.map((c) => [c.obligatorio, c.vigente]), [[true, false], [true, false], [false, false]])
  assert.equal(p.proveedor, 'Didit')
  assert.equal(p.urlCondiciones, '/privacy#verificacion-identidad')
  assert.equal(p.intentoId, null)
  assert.equal(p.pasos.length, 3)
  assert.match(p.privacidad.join(' '), /durante 3 años/)
  assert.deepEqual(p.soporte, { email: 'contacto@membego.com', whatsapp: '+1 829 961 8220' })
  // Nada del proveedor ni de la persona viaja a la pantalla.
  const volcado = JSON.stringify(p)
  for (const prohibido of [q.userId, q.supabaseId, q.email, 'referencia', 'hash', 'sellada', API_KEY]) assert.ok(!volcado.includes(prohibido), `el panel lleva «${prohibido}»`)
})

test('1b · CON LA VERIFICACIÓN APAGADA: sin historial la sección no se anuncia; con historial se ve lo que hay pero no se ofrece empezar', async () => {
  const sinNada = await persona('apagada-nada')
  const conDatos = await empezada('apagada-datos')
  await recibir(avisoFirmado(dd.aprobar(conDatos.intentoId)))
  // Quien rechazó y quisiera reintentar (se prepara con la verificación encendida).
  const rechazada = await empezada('apagada-rechazo')
  await recibir(avisoFirmado(dd.poner(rechazada.intentoId, 'Declined', ['LOW_FACE_MATCH_SIMILARITY']), { estado: 'Declined' }))
  await apagar()
  try {
    assert.equal((await leerPanelDeIdentidad(sinNada.userId)).visible, false)
    const p = await leerPanelDeIdentidad(conDatos.q.userId)
    assert.deepEqual([p.visible, p.vista.estado, p.vista.accion, p.vista.puedeBorrar], [true, 'verificada', 'ninguna', true])
    // Y quien rechazó: se enseña el resultado, no el botón.
    const pr = await leerPanelDeIdentidad(rechazada.q.userId)
    assert.deepEqual([pr.vista.accion, pr.vista.textoAccion, pr.vista.requiereConsentimientos], ['ninguna', null, false])
    assert.match(pr.vista.aviso?.texto ?? '', /no está disponible por ahora/)
    // Con la verificación apagada tampoco se puede empezar nada por la puerta.
    const r = await iniciarVerificacionDePersona(sinNada, { aceptados: TODOS }, WEB)
    assert.deepEqual([r.ok, !r.ok && r.status, !r.ok && r.motivo], [false, 403, 'no_habilitada'])
  } finally {
    await encender()
  }
})

// ── 2 · Consentimientos: la versión del texto ───────────────────────────────

test('2 · UN PERMISO DADO SOBRE UN TEXTO ANTERIOR NO CUBRE EL NUEVO: no deja capturar y el panel lo vuelve a pedir', async () => {
  const q = await persona('version')
  // La biometría se aceptó cuando el texto era otro; la transferencia, con el vigente.
  await prisma.identidadConsentimiento.create({ data: { userId: q.userId, tipo: 'IDENTIDAD_BIOMETRIA', textoVersion: 'identidad-biometria-v0', canal: 'web' } })
  await otorgarConsentimientoIdentidad(q.userId, 'IDENTIDAD_TRANSFERENCIA_INTERNACIONAL', { textoVersionVista: TEXTO_VERSION_TRANSFERENCIA, canal: 'web' })

  const p = await leerPanelDeIdentidad(q.userId)
  assert.deepEqual(p.consentimientos.map((c) => c.vigente), [false, true, false])
  assert.equal(p.vista.requiereConsentimientos, true)
  const directo = await crearIntento(q.userId, { canal: 'web' })
  assert.deepEqual([directo.ok, !directo.ok && directo.motivo], [false, 'falta_consentimiento'], 'el servidor tampoco lo deja pasar')
  assert.equal(await prisma.identidadIntento.count({ where: { userId: q.userId } }), 0)

  // Al volver a aceptar el texto vigente, sí.
  const r = await iniciarVerificacionDePersona(q, { aceptados: { IDENTIDAD_BIOMETRIA: TEXTO_VERSION_BIOMETRIA } }, WEB)
  assert.equal(r.ok, true)
  const filas = await prisma.identidadConsentimiento.findMany({ where: { userId: q.userId, tipo: 'IDENTIDAD_BIOMETRIA' }, orderBy: { otorgadoAt: 'asc' } })
  assert.deepEqual(filas.map((f) => [f.textoVersion, f.revocadoAt !== null]), [['identidad-biometria-v0', true], [TEXTO_VERSION_BIOMETRIA, false]], 'queda el historial de qué aceptó y cuándo')
})

// ── 3 · Empezar ─────────────────────────────────────────────────────────────

test('3 · EMPEZAR por la puerta: registra los permisos con SU versión, canal e IP, crea la sesión y devuelve la dirección', async () => {
  dd.reiniciarLlamadas()
  const q = await persona('empieza')
  const r = await iniciarVerificacionDePersona(q, { aceptados: { ...TODOS, IDENTIDAD_DIVULGACION_EMPRESAS: TEXTO_VERSION_DIVULGACION } }, WEB)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.match(r.url, /^https:\/\/verification\.didit\.me\/session\//)
  const filas = await prisma.identidadConsentimiento.findMany({ where: { userId: q.userId }, orderBy: { tipo: 'asc' } })
  assert.deepEqual(filas.map((f) => [f.tipo, f.textoVersion, f.canal, f.ipAddress, f.revocadoAt]), [
    ['IDENTIDAD_BIOMETRIA', TEXTO_VERSION_BIOMETRIA, 'web', '190.80.12.5', null],
    ['IDENTIDAD_DIVULGACION_EMPRESAS', TEXTO_VERSION_DIVULGACION, 'web', '190.80.12.5', null],
    ['IDENTIDAD_TRANSFERENCIA_INTERNACIONAL', TEXTO_VERSION_TRANSFERENCIA, 'web', '190.80.12.5', null],
  ])
  const intento = await prisma.identidadIntento.findUniqueOrThrow({ where: { id: r.intentoId } })
  assert.equal(intento.canal, 'web')
  assert.match(String(dd.llamadas.find((l) => l.metodo === 'POST' && l.ruta === '/v3/session/')?.cuerpo?.callback), /^http.*\/cliente\/identidad\?intento=.+&nonce=.+&identidad=retorno$/)
  const p = await leerPanelDeIdentidad(q.userId)
  assert.deepEqual([p.vista.accion, p.vista.etiqueta, p.vista.requiereConsentimientos, p.intentoId], ['continuar', 'Pendiente', false, r.intentoId])
  assert.deepEqual(p.consentimientos.map((c) => c.vigente), [true, true, true])
})

test('3b · DESDE LA APP: el canal del consentimiento es «movil» y la sesión vuelve por el esquema membego://', async () => {
  dd.reiniciarLlamadas()
  const q = await persona('movil')
  const r = await iniciarVerificacionDePersona(q, { aceptados: TODOS }, MOVIL)
  assert.equal(r.ok, true)
  const canales = (await prisma.identidadConsentimiento.findMany({ where: { userId: q.userId } })).map((f) => f.canal)
  assert.deepEqual([...new Set(canales)], ['movil'])
  assert.match(String(dd.llamadas.find((l) => l.ruta === '/v3/session/')?.cuerpo?.callback), /^membego:\/\/identidad\/retorno\?intento=/)
})

test('3c · SIN PERMISOS, CON UNA VERSIÓN QUE NO SE VIO O CON UN TIPO INVENTADO: no se empieza, no se llama al proveedor y no se registra nada', async () => {
  dd.reiniciarLlamadas()
  const q = await persona('rechazos')
  const sin = await iniciarVerificacionDePersona(q, { aceptados: {} }, WEB)
  assert.deepEqual([sin.ok, !sin.ok && sin.status, !sin.ok && sin.motivo], [false, 409, 'falta_consentimiento'])
  assert.match(!sin.ok ? sin.error : '', /Para empezar necesitamos tu permiso/)
  const parcial = await iniciarVerificacionDePersona(q, { aceptados: { IDENTIDAD_BIOMETRIA: TEXTO_VERSION_BIOMETRIA } }, WEB)
  assert.deepEqual([parcial.ok, !parcial.ok && parcial.motivo], [false, 'falta_consentimiento'], 'falta la transferencia internacional')

  const otra = await persona('rechazos2')
  const vieja = await iniciarVerificacionDePersona(otra, { aceptados: { IDENTIDAD_BIOMETRIA: 'identidad-biometria-v0', IDENTIDAD_TRANSFERENCIA_INTERNACIONAL: TEXTO_VERSION_TRANSFERENCIA } }, WEB)
  assert.deepEqual([vieja.ok, !vieja.ok && vieja.status, !vieja.ok && vieja.motivo], [false, 409, 'texto_cambio'])
  assert.equal(await prisma.identidadConsentimiento.count({ where: { userId: otra.userId, tipo: 'IDENTIDAD_BIOMETRIA' } }), 0, 'no se anota una versión que la persona no vio')
  const inventado = await iniciarVerificacionDePersona(otra, { aceptados: { TODO: 'v1' } }, WEB)
  assert.deepEqual([inventado.ok, !inventado.ok && inventado.status], [false, 400])
  assert.equal(await prisma.identidadIntento.count({ where: { userId: { in: [q.userId, otra.userId] } } }), 0)
  assert.equal(dd.cuantas('POST', '/v3/session/'), 0, 'nada de esto llegó al proveedor')
})

test('3d · EL LÍMITE DE USO: seis intentos de abrir sesión cada cinco minutos y el séptimo se frena', async () => {
  const { q } = await empezada('limite')
  for (let i = 0; i < 5; i++) assert.equal((await iniciarVerificacionDePersona(q, {}, WEB)).ok, true, `intento ${i + 2}`)
  const frenado = await iniciarVerificacionDePersona(q, {}, WEB)
  assert.deepEqual([frenado.ok, !frenado.ok && frenado.status, !frenado.ok && frenado.motivo], [false, 429, 'demasiadas_solicitudes'])
  assert.match(!frenado.ok ? frenado.error : '', /Demasiados intentos/)
})

test('3e · EL ERROR DEL PROVEEDOR llega como un mensaje en español, con cuándo reintentar, y el intento sigue para retomarlo', async () => {
  const q = await persona('caido')
  dd.caidas = 1
  const r = await iniciarVerificacionDePersona(q, { aceptados: TODOS }, WEB)
  assert.deepEqual([r.ok, !r.ok && r.status, !r.ok && r.motivo, !r.ok && r.reintentarEnSegundos], [false, 503, 'proveedor_no_disponible', 30])
  assert.match(!r.ok ? r.error : '', /no responde en este momento/)
  const p = await leerPanelDeIdentidad(q.userId)
  assert.equal(p.vista.accion, 'continuar', 'el intento quedó para retomarlo')
  assert.equal((await iniciarVerificacionDePersona(q, {}, WEB)).ok, true)
})

// ── 4 · Permisos sueltos ────────────────────────────────────────────────────

test('4 · LA DIVULGACIÓN A NEGOCIOS: se da con la versión vigente, se rechaza una vista vieja y se retira; retirar la biometría cancela el intento abierto', async () => {
  const { q, intentoId } = await empezada('permisos')
  const dar = await cambiarConsentimientoDePersona(q, { tipo: 'IDENTIDAD_DIVULGACION_EMPRESAS', accion: 'aceptar', version: TEXTO_VERSION_DIVULGACION }, WEB)
  assert.equal(dar.ok, true)
  assert.equal((await leerPanelDeIdentidad(q.userId)).consentimientos.find((c) => c.tipo === 'IDENTIDAD_DIVULGACION_EMPRESAS')?.vigente, true)

  const vieja = await cambiarConsentimientoDePersona(q, { tipo: 'IDENTIDAD_DIVULGACION_EMPRESAS', accion: 'aceptar', version: 'identidad-divulgacion-v0' }, WEB)
  assert.deepEqual([vieja.ok, !vieja.ok && vieja.status, !vieja.ok && vieja.motivo], [false, 409, 'texto_cambio'])
  const inventado = await cambiarConsentimientoDePersona(q, { tipo: 'TODO', accion: 'retirar' }, WEB)
  assert.deepEqual([inventado.ok, !inventado.ok && inventado.status], [false, 400])

  assert.equal((await cambiarConsentimientoDePersona(q, { tipo: 'IDENTIDAD_DIVULGACION_EMPRESAS', accion: 'retirar' }, WEB)).ok, true)
  assert.equal((await leerPanelDeIdentidad(q.userId)).consentimientos.find((c) => c.tipo === 'IDENTIDAD_DIVULGACION_EMPRESAS')?.vigente, false)

  // Retirar el permiso de biometría cancela la verificación en curso y vuelve a pedirlo.
  await cambiarConsentimientoDePersona(q, { tipo: 'IDENTIDAD_BIOMETRIA', accion: 'retirar' }, WEB)
  assert.equal((await prisma.identidadIntento.findUniqueOrThrow({ where: { id: intentoId } })).estado, 'cancelada')
  const p = await leerPanelDeIdentidad(q.userId)
  assert.deepEqual([p.vista.accion, p.vista.requiereConsentimientos, p.intentoId], ['verificar', true, null])
})

// ── 5 · Incidencias ─────────────────────────────────────────────────────────

test('5 · UNA INCIDENCIA: queda en la cola con su tipo, el asiento y el correo a soporte llevan solo ids (NUNCA el texto de la persona)', async () => {
  const { q, intentoId } = await empezada('incidencia')
  dd.correos.length = 0
  const mensaje = `No me deja subir la foto ${sufijo} (mi cédula es 001-9999999-9)`
  const r = await reportarProblemaDePersona(q, { tipo: 'no_puedo_completar', mensaje, intentoId })
  assert.equal(r.ok, true)
  if (!r.ok) return
  const fila = await prisma.identidadIncidencia.findUniqueOrThrow({ where: { id: r.incidenciaId } })
  assert.deepEqual([fila.userId, fila.intentoId, fila.tipo, fila.estado, fila.mensaje, fila.resueltaAt], [q.userId, intentoId, 'no_puedo_completar', 'abierta', mensaje, null])

  const [a] = await asientos(q.userId, 'IDENTIDAD_INCIDENCIA_REPORTADA')
  assert.deepEqual([a.userId, a.payload], [q.userId, { intentoId, motivo: 'no_puedo_completar' }])
  assert.ok(!JSON.stringify(await prisma.auditLog.findMany({ where: { entidadId: q.userId } })).includes(sufijo), 'el texto de la persona no está en ninguna bitácora')

  const correo = dd.correos.find((c) => c.subject === 'Incidencia de verificación de identidad')
  assert.ok(correo, 'soporte recibió un aviso')
  assert.equal(correo.to, 'contacto@membego.com')
  const cuerpoDelCorreo = JSON.stringify(correo)
  assert.ok(cuerpoDelCorreo.includes(r.incidenciaId))
  for (const prohibido of [sufijo, '001-9999999-9', q.email, q.userId]) assert.ok(!cuerpoDelCorreo.includes(prohibido), `el correo a soporte lleva «${prohibido}»`)

  const p = await leerPanelDeIdentidad(q.userId)
  assert.deepEqual(p.incidenciasAbiertas.map((i) => i.etiqueta), ['No puedo completar la verificación'])
  assert.ok(!JSON.stringify(p).includes(sufijo), 'ni el panel devuelve el texto')
})

test('5b · LA COLA NO SE INUNDA, el tipo es cerrado, el mensaje tiene límites, no se apunta a intentos ajenos y los caracteres de control se quitan', async () => {
  const { q } = await empezada('cola')
  const ajeno = (await empezada('ajeno')).intentoId
  for (let i = 0; i < 3; i++) assert.equal((await reportarProblemaDePersona(q, { tipo: 'otro', mensaje: `problema ${i}` })).ok, true)
  const cuarta = await reportarProblemaDePersona(q, { tipo: 'otro', mensaje: 'otro más' })
  assert.deepEqual([cuarta.ok, !cuarta.ok && cuarta.status, !cuarta.ok && cuarta.motivo], [false, 429, 'demasiadas_abiertas'])
  assert.match(!cuarta.ok ? cuarta.error : '', /reportes abiertos/)
  assert.equal(await prisma.identidadIncidencia.count({ where: { userId: q.userId } }), 3)

  const p2 = await persona('cola2')
  const casos: [string, Parameters<typeof reportarProblemaDePersona>[1], string][] = [
    ['tipo inventado', { tipo: 'hackear', mensaje: 'hola' }, 'tipo_invalido'],
    ['mensaje vacío', { tipo: 'otro', mensaje: '   ' }, 'mensaje_invalido'],
    ['mensaje solo de control', { tipo: 'otro', mensaje: '\u0000\u0007' }, 'mensaje_invalido'],
    ['mensaje enorme', { tipo: 'otro', mensaje: 'x'.repeat(601) }, 'mensaje_invalido'],
    ['intento ajeno', { tipo: 'otro', mensaje: 'hola', intentoId: ajeno }, 'intento_ajeno'],
  ]
  for (const [nombre, entrada, motivo] of casos) {
    const r = await reportarProblemaDePersona(p2, entrada)
    assert.deepEqual([r.ok, !r.ok && r.status, !r.ok && r.motivo], [false, 400, motivo], nombre)
  }
  assert.equal(await prisma.identidadIncidencia.count({ where: { userId: p2.userId } }), 0)
  const limpio = await reportarProblemaDePersona(p2, { tipo: 'otro', mensaje: 'con\u0000 control\u0007 dentro' })
  assert.equal(limpio.ok, true)
  if (limpio.ok) assert.equal((await prisma.identidadIncidencia.findUniqueOrThrow({ where: { id: limpio.incidenciaId } })).mensaje, 'con control dentro')
  // Las incidencias son de la persona: al borrarla, se van con ella.
  await prisma.user.delete({ where: { id: p2.userId } })
  assert.equal(await prisma.identidadIncidencia.count({ where: { userId: p2.userId } }), 0)
})

test('5c · LA BASE como segunda barrera: tipo, estado y largo del mensaje se validan aunque se escriba por fuera del servicio', async () => {
  const q = await persona('check-inc')
  for (const datos of [{ tipo: 'x', mensaje: 'a' }, { tipo: 'otro', mensaje: '' }, { tipo: 'otro', mensaje: 'a'.repeat(601) }, { tipo: 'otro', mensaje: 'a', estado: 'inventado' }]) {
    await assert.rejects(() => prisma.identidadIncidencia.create({ data: { userId: q.userId, ...datos } }), /check|constraint|violat/i)
  }
})

// ── 6 · Borrar mis datos ────────────────────────────────────────────────────

test('6 · BORRAR MIS DATOS: el proveedor primero, lo local después; y la sección «borrar» desaparece cuando ya no queda nada', async () => {
  const { q, intentoId } = await empezada('borra')
  await recibir(avisoFirmado(dd.aprobar(intentoId)))
  assert.deepEqual([(await leerPanelDeIdentidad(q.userId)).vista.estado, (await leerPanelDeIdentidad(q.userId)).vista.puedeBorrar], ['verificada', true])

  dd.reiniciarLlamadas()
  dd.sesionDe(intentoId).borrada = false
  const r = await pedirBorradoDePersona(q)
  assert.deepEqual([r.ok, r.ok && r.intentosAnonimizados], [true, 1])
  assert.equal(dd.llamadas.find((l) => l.metodo === 'DELETE')?.cuerpo?.deletion_instruction, 'privacy_erasure')
  assert.equal(await prisma.identidadVerificacion.count({ where: { userId: q.userId } }), 0)

  const p = await leerPanelDeIdentidad(q.userId)
  assert.deepEqual([p.vista.estado, p.vista.accion, p.vista.puedeBorrar], ['no_verificada', 'verificar', false], 'no queda nada que borrar')
  const [solicitada] = await asientos(q.userId, 'IDENTIDAD_SUPRESION_SOLICITADA')
  assert.deepEqual([solicitada.userId, (solicitada.payload as Record<string, unknown>).motivo, (solicitada.payload as Record<string, unknown>).rol], [q.userId, 'solicitud_de_la_persona', 'persona'])
  assert.equal((await asientos(q.userId, 'IDENTIDAD_SUPRESION_COMPLETADA')).length, 1)
})

test('6b · SI EL PROVEEDOR NO RESPONDE al borrar: se dice con claridad, no se borra nada local y se puede repetir', async () => {
  const { q, intentoId } = await empezada('borra-falla')
  await recibir(avisoFirmado(dd.aprobar(intentoId)))
  dd.sesionDe(intentoId).borrada = false
  dd.caidas = 1
  const r = await pedirBorradoDePersona(q)
  assert.deepEqual([r.ok, !r.ok && r.status, !r.ok && r.motivo], [false, 503, 'proveedor_no_disponible'])
  assert.match(!r.ok ? r.error : '', /No se borró nada/)
  assert.equal((await prisma.identidadVerificacion.findUnique({ where: { userId: q.userId } }))?.estado, 'verificada')
  assert.equal((await pedirBorradoDePersona(q)).ok, true, 'al volver el proveedor se completa')
  assert.equal(await prisma.identidadVerificacion.count({ where: { userId: q.userId } }), 0)
})

// ── 7 · Avisos de resultado ─────────────────────────────────────────────────

test('7 · AL VERIFICARSE: un aviso en la campana y un correo, sin datos personales, y repetir el evento NO lo repite', async () => {
  const { q, intentoId } = await empezada('aviso')
  dd.correos.length = 0
  const cedula = `004-${sufijo}-AVISO`
  const s = dd.aprobar(intentoId, { cedula })
  await recibir(avisoFirmado(s))
  await recibir(avisoFirmado(s)) // otro evento (otro event_id) para el mismo resultado
  await sincronizarIntento(intentoId)

  const avisos = (await notifs(q.userId)).filter((x) => x.tipo === 'IDENTIDAD_VERIFICADA')
  assert.equal(avisos.length, 1, 'un solo aviso por intento y resultado')
  assert.deepEqual([avisos[0].titulo, avisos[0].href, avisos[0].dedupeKey, avisos[0].leida], ['Tu identidad está verificada', '/cliente/identidad', `identidad:${intentoId}:aprobada`, false])
  const correos = dd.correos.filter((c) => c.to === q.email)
  assert.equal(correos.length, 1)
  assert.equal(correos[0].subject, 'Tu identidad está verificada')
  const todo = JSON.stringify([avisos.map(({ titulo, mensaje, href }) => ({ titulo, mensaje, href })), correos])
  for (const prohibido of [cedula, q.userId, 'Persona aviso']) assert.ok(!todo.includes(prohibido), `el aviso lleva «${prohibido}»`)
})

test('7b · UN RECHAZO POR ATAQUE avisa sin decir por qué; uno reintentable dice el motivo; un documento repetido va a revisión SIN decirlo', async () => {
  const ataque = await empezada('aviso-ataque')
  await recibir(avisoFirmado(dd.poner(ataque.intentoId, 'Declined', ['LIVENESS_FACE_ATTACK']), { estado: 'Declined' }))
  const [a] = (await notifs(ataque.q.userId)).filter((x) => x.tipo === 'IDENTIDAD_RECHAZADA')
  assert.ok(a)
  assert.doesNotMatch(JSON.stringify(a), /fraude|ataque|attack|liveness|falsific/i)
  assert.match(a.mensaje, /soporte/)

  const blando = await empezada('aviso-blando')
  await recibir(avisoFirmado(dd.poner(blando.intentoId, 'Declined', ['DOCUMENT_EXPIRED']), { estado: 'Declined' }))
  const [b] = (await notifs(blando.q.userId)).filter((x) => x.tipo === 'IDENTIDAD_RECHAZADA')
  assert.match(b.mensaje, /vencido/)
  assert.match(b.mensaje, /intentarlo de nuevo/)

  const cedula = `005-${sufijo}-DUP`
  const primera = await empezada('aviso-dup1')
  await recibir(avisoFirmado(dd.aprobar(primera.intentoId, { cedula })))
  const segunda = await empezada('aviso-dup2')
  await recibir(avisoFirmado(dd.aprobar(segunda.intentoId, { cedula })))
  const [r] = (await notifs(segunda.q.userId)).filter((x) => x.tipo === 'IDENTIDAD_EN_REVISION')
  assert.ok(r, 'la segunda cuenta recibe el aviso de «en revisión»')
  assert.doesNotMatch(JSON.stringify(r), /otra cuenta|duplic|asociado|ya existe/i, 'no se revela que el documento está en otra cuenta')
  assert.equal((await notifs(segunda.q.userId)).filter((x) => x.tipo === 'IDENTIDAD_VERIFICADA').length, 0)
})

test('7c · LOS PASOS INTERMEDIOS NO AVISAN: iniciada, en proceso y reenvío no generan campana ni correo', async () => {
  const { q, intentoId } = await empezada('sin-aviso')
  dd.correos.length = 0
  await recibir(avisoFirmado(dd.poner(intentoId, 'In Progress'), { estado: 'In Progress' }))
  await recibir(avisoFirmado(dd.poner(intentoId, 'Awaiting User'), { estado: 'Awaiting User' }))
  assert.equal((await notifs(q.userId)).length, 0)
  assert.equal(dd.correos.filter((c) => c.to === q.email).length, 0)
})

test('7d · EL PANEL con «reconciliar» resuelve un aviso perdido y deja al día lo que ve la persona', async () => {
  const { q, intentoId } = await empezada('reconcilia')
  dd.aprobar(intentoId) // el proveedor aprobó; el aviso nunca llegó
  const p = await leerPanelDeIdentidad(q.userId, { reconciliar: true })
  assert.deepEqual([p.vista.estado, p.vista.accion, p.vista.mostrarDivulgacion], ['verificada', 'ninguna', true])
  assert.equal((await notifs(q.userId)).filter((x) => x.tipo === 'IDENTIDAD_VERIFICADA').length, 1)
})
