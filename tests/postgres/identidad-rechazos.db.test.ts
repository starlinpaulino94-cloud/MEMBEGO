/**
 * VERIFICACIÓN DE IDENTIDAD · Fase 6 · CADA FORMA DE FALLAR, de punta a punta (Didit falso → aviso firmado → base → lo que ve la persona).
 *
 * Una tabla de escenarios sintéticos que recorre lo que la revisión pidió: documento válido, documento inválido (vencido, ilegible,
 * no soportado, alterado), selfie que no coincide, prueba de vida fallida (y ataque), menor de edad, datos que no coinciden, sesión
 * vencida o abandonada, flujo interrumpido y a medias. Para cada uno se comprueba lo mismo:
 *
 *   · el estado del intento y si se puede reintentar;
 *   · lo que la persona lee (en español, sin la advertencia del proveedor, y sin explicar una señal de fraude);
 *   · que nadie queda verificado por un rechazo;
 *   · que la sesión del proveedor (con sus documentos) se borra al concluir;
 *   · que el aviso a la persona no lleva el código ni el motivo de un rechazo por fraude.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { prisma } from '../../src/lib/prisma'
import { cambiarInterruptorDeIdentidad, estadoDeIdentidadDe, type ActorDeIdentidad } from '../../src/modules/identidad/identidad'
import { CODIGOS_RAZON, type CodigoRazon } from '../../src/modules/identidad/identidadCore'
import { TEXTO_VERSION_BIOMETRIA, TEXTO_VERSION_TRANSFERENCIA } from '../../src/modules/identidad/identidadConsentimientosCore'
import { iniciarVerificacionDePersona, type QuienEs } from '../../src/modules/identidad/identidadPuerta'
import { recibirAvisoDeProveedor } from '../../src/modules/identidad/eventos'
import { DiditFalso, crearAvisoFirmado } from './_helpers/didit-falso'

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const API_KEY = `clave-didit-sintetica-${sufijo}`
const SECRETO = `secreto-webhook-sintetico-${sufijo}`.padEnd(32, 'x')
const PEPPER = `pepper-de-prueba-${sufijo}-`.padEnd(40, 'x')
const avisoFirmado = crearAvisoFirmado(SECRETO)
const WEB = { canal: 'web' as const, ip: '190.80.12.5', userAgent: 'prueba-rechazos' }
const TODOS = { IDENTIDAD_BIOMETRIA: TEXTO_VERSION_BIOMETRIA, IDENTIDAD_TRANSFERENCIA_INTERNACIONAL: TEXTO_VERSION_TRANSFERENCIA }

const VARIABLES = ['IDENTIDAD_CLAVES_MAESTRAS', 'IDENTIDAD_PEPPER_DEDUPE', 'DIDIT_API_KEY', 'DIDIT_WORKFLOW_ID', 'DIDIT_WEBHOOK_SECRET', 'RESEND_API_KEY'] as const
const anterior: Record<string, string | undefined> = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
const fetchOriginal = globalThis.fetch
let dd: DiditFalso
let staff: ActorDeIdentidad

before(async () => {
  process.env.IDENTIDAD_CLAVES_MAESTRAS = `1:${randomBytes(32).toString('base64')}`
  process.env.IDENTIDAD_PEPPER_DEDUPE = PEPPER
  process.env.DIDIT_API_KEY = API_KEY
  process.env.DIDIT_WORKFLOW_ID = '11111111-0000-0000-0000-000000000001'
  process.env.DIDIT_WEBHOOK_SECRET = SECRETO
  process.env.RESEND_API_KEY = 're_prueba_sintetica'
  dd = new DiditFalso(sufijo)
  globalThis.fetch = dd.manejar as typeof fetch
  const u = await prisma.user.create({ data: { supabaseId: `sb-rech-staff-${sufijo}`, email: `staff-rech-${sufijo}@prueba.test`, name: `Equipo ${sufijo}`, role: 'SUPERADMIN' }, select: { id: true } })
  staff = { userId: u.id, rol: 'SUPERADMIN' }
  await cambiarInterruptorDeIdentidad(staff, { encendido: true, motivo: 'Pruebas automáticas de los rechazos con datos sintéticos.' })
})
after(async () => {
  globalThis.fetch = fetchOriginal
  await prisma.identidadInterruptor.updateMany({ where: { clave: 'VERIFICACION_IDENTIDAD' }, data: { enabled: false } })
  for (const v of VARIABLES) {
    if (anterior[v] === undefined) delete process.env[v]
    else process.env[v] = anterior[v]
  }
})

let n = 0
async function empezada(etiqueta: string) {
  const k = n++
  const u = await prisma.user.create({ data: { supabaseId: `sb-rech-${etiqueta}-${sufijo}-${k}`, email: `rech-${etiqueta}-${sufijo}-${k}@prueba.test`, name: `Persona ${etiqueta} ${k}`, role: 'CLIENTE' }, select: { id: true, supabaseId: true } })
  const q: QuienEs = { userId: u.id, supabaseId: u.supabaseId }
  const r = await iniciarVerificacionDePersona(q, { aceptados: TODOS }, WEB)
  assert.equal(r.ok, true, JSON.stringify(r))
  if (!r.ok) throw new Error('no inició')
  return { q, intentoId: r.intentoId }
}
const recibir = async (a: ReturnType<typeof avisoFirmado>) => {
  const r = await recibirAvisoDeProveedor({ proveedor: 'didit', cuerpoCrudo: a.cuerpoCrudo, cabeceras: a.cabeceras })
  if (r.despues) await r.despues()
}
const intentoDe = (id: string) => prisma.identidadIntento.findUniqueOrThrow({ where: { id } })
const avisosDe = (userId: string) => prisma.notificacion.findMany({ where: { userId } })
const verificacionDe = (userId: string) => prisma.identidadVerificacion.findUnique({ where: { userId } })

// ── 1 · El documento válido (el contraste) ──────────────────────────────────

test('1 · DOCUMENTO VÁLIDO: aprobada, verificada con documento, sesión borrada y un solo aviso de éxito sin datos', async () => {
  const e = await empezada('valido')
  await recibir(avisoFirmado(dd.aprobar(e.intentoId, { cedula: `006-${sufijo}-valido` })))
  assert.equal((await intentoDe(e.intentoId)).estado, 'aprobada')
  const estado = await estadoDeIdentidadDe(e.q.userId)
  assert.deepEqual([estado.estado, estado.nivel, estado.ultimoRechazo], ['verificada', 'documento_selfie', null])
  assert.equal(dd.sesionDe(e.intentoId).borrada, true, 'el proveedor borró la sesión (documentos y selfie)')
  const avisos = await avisosDe(e.q.userId)
  assert.equal(avisos.length, 1)
  assert.doesNotMatch(JSON.stringify(avisos), /006-|c[eé]dula|selfie/i)
})

// ── 2 · Cada forma de rechazo ───────────────────────────────────────────────

interface Escenario {
  nombre: string
  riesgos: string[]
  codigo: CodigoRazon
}
const ESCENARIOS: Escenario[] = [
  { nombre: 'documento vencido', riesgos: ['DOCUMENT_EXPIRED'], codigo: 'DOCUMENTO_VENCIDO' },
  { nombre: 'documento borroso (ilegible)', riesgos: ['IMAGE_TOO_BLURRY'], codigo: 'DOCUMENTO_ILEGIBLE' },
  { nombre: 'documento con reflejos y tapado', riesgos: ['DOCUMENT_OCCLUSION_DETECTED', 'IMAGE_TOO_BRIGHT'], codigo: 'DOCUMENTO_ILEGIBLE' },
  { nombre: 'documento de otro tipo (no soportado)', riesgos: ['DOCUMENT_NOT_SUPPORTED_FOR_APPLICATION'], codigo: 'DOCUMENTO_NO_SOPORTADO' },
  { nombre: 'la selfie no coincide con el documento', riesgos: ['LOW_FACE_MATCH_SIMILARITY'], codigo: 'ROSTRO_NO_COINCIDE' },
  { nombre: 'prueba de vida fallida (poca luz)', riesgos: ['LOW_LIVENESS_SCORE', 'LOW_FACE_LUMINANCE'], codigo: 'PRUEBA_DE_VIDA_FALLIDA' },
  { nombre: 'dos rostros en la selfie', riesgos: ['MULTIPLE_FACES_DETECTED'], codigo: 'PRUEBA_DE_VIDA_FALLIDA' },
  { nombre: 'datos que no coinciden', riesgos: ['FULL_NAME_MISMATCH_WITH_PROVIDED'], codigo: 'DATOS_NO_COINCIDEN' },
  { nombre: 'menor de edad', riesgos: ['MINIMUM_AGE_NOT_MET'], codigo: 'MENOR_DE_EDAD' },
  { nombre: 'ataque a la prueba de vida (máscara o vídeo)', riesgos: ['LIVENESS_FACE_ATTACK'], codigo: 'SOSPECHA_DE_FRAUDE' },
  { nombre: 'cámara virtual', riesgos: ['VIRTUAL_CAMERA_DETECTED'], codigo: 'SOSPECHA_DE_FRAUDE' },
  { nombre: 'documento copiado de una pantalla', riesgos: ['SCREEN_CAPTURE_DETECTED'], codigo: 'SOSPECHA_DE_DOCUMENTO_ALTERADO' },
  { nombre: 'documento impreso', riesgos: ['PRINTED_COPY_DETECTED'], codigo: 'SOSPECHA_DE_DOCUMENTO_ALTERADO' },
  { nombre: 'foto del retrato manipulada', riesgos: ['PORTRAIT_MANIPULATION_DETECTED'], codigo: 'SOSPECHA_DE_DOCUMENTO_ALTERADO' },
  { nombre: 'varias señales a la vez: manda la más grave (fraude sobre borroso)', riesgos: ['IMAGE_TOO_BLURRY', 'LOW_LIVENESS_SCORE', 'LIVENESS_FACE_ATTACK'], codigo: 'SOSPECHA_DE_FRAUDE' },
  { nombre: 'rechazo sin ninguna advertencia reconocida (lo genérico, reintentable)', riesgos: ['ALGO_NUEVO_QUE_DIDIT_AGREGO'], codigo: 'RECHAZO_GENERICO' },
]

for (const esc of ESCENARIOS) {
  test(`2 · ${esc.nombre.toUpperCase()}: ${esc.codigo}, sin acreditar, sesión borrada y lo que lee la persona es nuestro texto`, async () => {
    const c = CODIGOS_RAZON[esc.codigo]
    const e = await empezada('rechazo')
    await recibir(avisoFirmado(dd.poner(e.intentoId, 'Declined', esc.riesgos), { estado: 'Declined' }))

    const intento = await intentoDe(e.intentoId)
    assert.equal(intento.estado, c.reintentable ? 'rechazada_reintentable' : 'rechazada_definitiva')
    assert.equal(intento.codigoRazon, esc.codigo)
    assert.equal(intento.tipoRechazo, c.reintentable ? 'reintentable' : 'definitivo')
    assert.equal((await verificacionDe(e.q.userId))?.estado === 'verificada', false, 'un rechazo no verifica a nadie')
    assert.equal(dd.sesionDe(e.intentoId).borrada, true, 'la sesión con los documentos se borra también al rechazar')

    // Lo que lee la persona.
    const estado = await estadoDeIdentidadDe(e.q.userId)
    assert.notEqual(estado.estado, 'verificada')
    assert.equal(estado.ultimoRechazo?.reintentable, c.reintentable)
    assert.equal(estado.ultimoRechazo?.mensaje, c.mensaje, 'el mensaje es el del catálogo propio')
    assert.equal(estado.ultimoRechazo?.codigo ?? null, c.visible ? esc.codigo : null, c.visible ? 'se le dice el motivo' : 'un motivo de fraude no se enseña')
    for (const r of esc.riesgos) assert.ok(!JSON.stringify(estado).toLowerCase().includes(r.toLowerCase()), `el estado no contiene la advertencia ${r}`)
    // Reintentar: espera obligatoria si se puede; definitivo, bloqueado hasta que el equipo lo reabra.
    assert.equal(estado.puedeIniciar, false)
    assert.equal(estado.motivoNoPuedeIniciar, c.reintentable ? 'espera' : 'bloqueada_por_rechazo_definitivo')

    // El aviso: sin el código ni la advertencia; y el de fraude no explica nada.
    const avisos = await avisosDe(e.q.userId)
    assert.equal(avisos.length, 1)
    const texto = JSON.stringify(avisos)
    for (const prohibido of [esc.codigo, ...esc.riesgos]) assert.ok(!texto.includes(prohibido), `el aviso no contiene ${prohibido}`)
    if (!c.visible) assert.doesNotMatch(texto, /fraude|alter|ataque|c[aá]mara virtual|impres|pantalla|manipul/i, 'el aviso de un rechazo por fraude no dice por qué')
    assert.doesNotMatch(texto, /006-|selfie\b.*\bguardad/i)
  })
}

// ── 3 · Sesión vencida, abandonada, interrumpida ────────────────────────────

test('3 · SESIÓN VENCIDA O ABANDONADA EN EL PROVEEDOR: el intento se cierra, la persona puede empezar de nuevo AL INSTANTE (no es un rechazo) y no queda verificada', async () => {
  for (const [estadoProveedor, estadoIntento] of [['Expired', 'expirada'], ['Kyc Expired', 'expirada'], ['Abandoned', 'abandonada']] as const) {
    const e = await empezada('vencida')
    await recibir(avisoFirmado(dd.poner(e.intentoId, estadoProveedor), { estado: estadoProveedor }))
    assert.equal((await intentoDe(e.intentoId)).estado, estadoIntento, estadoProveedor)
    const estado = await estadoDeIdentidadDe(e.q.userId)
    assert.equal(estado.estado === 'verificada', false)
    assert.equal(estado.intentoAbierto, null, 'el candado se liberó')
    assert.equal(estado.puedeIniciar, true, `${estadoProveedor}: se puede volver a empezar sin esperar`)
    // Y vuelve a empezar de verdad: otro intento, otra sesión.
    const otra = await iniciarVerificacionDePersona(e.q, {}, WEB)
    assert.equal(otra.ok, true, JSON.stringify(otra))
    if (otra.ok) assert.notEqual(otra.intentoId, e.intentoId)
  }
})

test('3b · FLUJO INTERRUMPIDO: «en progreso» sin terminar no acredita ni rechaza; la persona retoma el MISMO intento y no se abren dos', async () => {
  const e = await empezada('interrumpida')
  await recibir(avisoFirmado(dd.poner(e.intentoId, 'In Progress'), { estado: 'In Progress' }))
  const estado = await estadoDeIdentidadDe(e.q.userId)
  assert.deepEqual([estado.estado === 'verificada', estado.intentoAbierto?.id], [false, e.intentoId])
  const retoma = await iniciarVerificacionDePersona(e.q, {}, WEB)
  assert.equal(retoma.ok && retoma.intentoId, e.intentoId)
  assert.equal(await prisma.identidadIntento.count({ where: { userId: e.q.userId } }), 1)
  assert.equal(dd.sesionDe(e.intentoId).borrada, false, 'una sesión que sigue abierta no se borra')
})

test('3c · «REENVÍO REQUERIDO»: el intento sigue abierto para que la persona vuelva a enviar, sin rechazo ni espera, y la sesión se conserva', async () => {
  const e = await empezada('reenvio')
  await recibir(avisoFirmado(dd.poner(e.intentoId, 'Awaiting User'), { estado: 'Awaiting User' }))
  const intento = await intentoDe(e.intentoId)
  assert.equal(intento.estado, 'reenvio_requerido')
  assert.equal((await estadoDeIdentidadDe(e.q.userId)).intentoAbierto?.id, e.intentoId)
  assert.equal(dd.sesionDe(e.intentoId).borrada, false)
  assert.equal(await prisma.identidadIntento.count({ where: { userId: e.q.userId, estado: { in: ['rechazada_reintentable', 'rechazada_definitiva'] } } }), 0, 'no cuenta como rechazo')
})

// ── 4 · Un rechazo no se «lava» con un aviso posterior ──────────────────────

test('4 · UN RECHAZO POR FRAUDE NO SE DESHACE: un «Approved» que llega después de un «Declined» definitivo no acredita (lo ve una persona del equipo)', async () => {
  const e = await empezada('lavado')
  await recibir(avisoFirmado(dd.poner(e.intentoId, 'Declined', ['LIVENESS_FACE_ATTACK']), { estado: 'Declined' }))
  assert.equal((await intentoDe(e.intentoId)).estado, 'rechazada_definitiva')
  await recibir(avisoFirmado(dd.aprobar(e.intentoId, { cedula: `006-${sufijo}-lavado` }), { estado: 'Approved' }))
  assert.equal((await intentoDe(e.intentoId)).estado, 'rechazada_definitiva', 'sigue rechazada')
  assert.equal((await verificacionDe(e.q.userId))?.estado === 'verificada', false)
})
