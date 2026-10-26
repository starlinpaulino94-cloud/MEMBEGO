/**
 * VERIFICACIÓN DE IDENTIDAD · Fase 4 · lo que ve y hace el EQUIPO de Membego, contra PostgreSQL real y el Didit falso.
 *
 * Cada prueba falla si vuelve el defecto que cierra:
 *
 *   1 · alguien que no es del equipo (un administrador de empresa, un cliente) lee o toca un caso;
 *   2 · abrir un caso sin dejar asiento, o con un motivo inventado, o sacar la referencia o el hash del proveedor;
 *   3 · resolver un caso dejando a la persona sin saberlo, o diciéndole que su documento está en otra cuenta;
 *   4 · un «pedir que repita» que cuenta como rechazo (espera, tope semanal);
 *   5 · una incidencia «resuelta» sin respuesta, o con el texto de la persona o la respuesta en la bitácora;
 *   6 · una cola inflada o un resumen que inventa ceros;
 *   7 · una supresión pedida y olvidada sin que nadie lo vea.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { prisma } from '../../src/lib/prisma'
import {
  ErrorDeIdentidad,
  cambiarInterruptorDeIdentidad,
  crearIntento,
  registrarSolicitudDeSupresion,
  type ActorDeIdentidad,
} from '../../src/modules/identidad/identidad'
import { TEXTO_VERSION_BIOMETRIA, TEXTO_VERSION_TRANSFERENCIA } from '../../src/modules/identidad/identidadConsentimientosCore'
import { iniciarVerificacionDePersona, leerPanelDeIdentidad, reportarProblemaDePersona, type QuienEs } from '../../src/modules/identidad/identidadPuerta'
import { recibirAvisoDeProveedor } from '../../src/modules/identidad/eventos'
import {
  DIAS_DE_ALERTA_DE_SUPRESION,
  LIMITE_DE_COLA,
  MOTIVOS_DE_CONSULTA,
  atenderIncidenciaComoStaff,
  buscarPersonas,
  colaDeIncidencias,
  colaDeRevision,
  resolverRevisionComoStaff,
  resumenDeLaPlataforma,
  verCasoDeIdentidad,
} from '../../src/modules/identidad/staff'
import { DiditFalso, crearAvisoFirmado } from './_helpers/didit-falso'

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const API_KEY = `clave-didit-sintetica-${sufijo}`
const SECRETO = `secreto-webhook-sintetico-${sufijo}`.padEnd(32, 'x')
const PEPPER = `pepper-de-prueba-${sufijo}-`.padEnd(40, 'x')
const avisoFirmado = crearAvisoFirmado(SECRETO)
const WEB = { canal: 'web' as const, ip: '190.80.12.5', userAgent: 'prueba-equipo' }
const TODOS = { IDENTIDAD_BIOMETRIA: TEXTO_VERSION_BIOMETRIA, IDENTIDAD_TRANSFERENCIA_INTERNACIONAL: TEXTO_VERSION_TRANSFERENCIA }
const DIA = 24 * 60 * 60 * 1000

const VARIABLES = ['IDENTIDAD_CLAVES_MAESTRAS', 'IDENTIDAD_PEPPER_DEDUPE', 'DIDIT_API_KEY', 'DIDIT_WORKFLOW_ID', 'DIDIT_WEBHOOK_SECRET', 'RESEND_API_KEY'] as const
const anterior: Record<string, string | undefined> = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
const fetchOriginal = globalThis.fetch
let staff: ActorDeIdentidad
let dd: DiditFalso
let empresaId: string

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
    data: { supabaseId: `sb-ide-staff-${sufijo}`, email: `staff-ide-${sufijo}@prueba.test`, name: `Equipo ${sufijo}`, role: 'SUPERADMIN' },
    select: { id: true },
  })
  staff = { userId: u.id, rol: 'SUPERADMIN' }
  await cambiarInterruptorDeIdentidad(staff, { encendido: true, motivo: 'Pruebas automáticas del equipo con datos sintéticos.' })
  empresaId = (await prisma.company.create({ data: { name: `Equipo ${sufijo}`, slug: `equipo-${sufijo}`, type: 'carwash', ciudad: 'Santo Domingo' }, select: { id: true } })).id
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
async function persona(etiqueta = 'p', rol: 'CLIENTE' | 'ADMINISTRADOR' = 'CLIENTE'): Promise<QuienEs & { email: string; nombre: string }> {
  const k = n++
  const u = await prisma.user.create({
    data: {
      supabaseId: `sb-ide-${etiqueta}-${sufijo}-${k}`,
      email: `ide-${etiqueta}-${sufijo}-${k}@prueba.test`,
      name: `Persona ${etiqueta} ${sufijo} ${k}`,
      role: rol,
      ...(rol === 'ADMINISTRADOR' ? { companyId: empresaId } : {}),
    },
    select: { id: true, supabaseId: true, email: true, name: true },
  })
  return { userId: u.id, supabaseId: u.supabaseId, email: u.email, nombre: u.name }
}
async function empezada(etiqueta = 'e') {
  const q = await persona(etiqueta)
  const r = await iniciarVerificacionDePersona(q, { aceptados: TODOS }, WEB)
  assert.equal(r.ok, true, JSON.stringify(r))
  if (!r.ok) throw new Error('no inició')
  return { q, intentoId: r.intentoId }
}
const recibir = async (a: ReturnType<typeof avisoFirmado>) => {
  const r = await recibirAvisoDeProveedor({ proveedor: 'didit', cuerpoCrudo: a.cuerpoCrudo, cabeceras: a.cabeceras })
  if (r.despues) await r.despues()
}
/** Un caso EN REVISIÓN por un documento repetido: la segunda cuenta aprobada con la misma cédula de otra. */
async function casoDuplicado(etiqueta = 'dup') {
  const cedula = `006-${sufijo}-${n}-${etiqueta}`
  const a = await empezada(`${etiqueta}1`)
  await recibir(avisoFirmado(dd.aprobar(a.intentoId, { cedula })))
  const b = await empezada(`${etiqueta}2`)
  await recibir(avisoFirmado(dd.aprobar(b.intentoId, { cedula })))
  assert.equal((await prisma.identidadIntento.findUniqueOrThrow({ where: { id: b.intentoId } })).estado, 'en_revision')
  return { primera: a, segunda: b }
}
/** Un caso en revisión puesto por el proveedor («In Review»). */
async function casoDelProveedor(etiqueta = 'prov') {
  const e = await empezada(etiqueta)
  await recibir(avisoFirmado(dd.poner(e.intentoId, 'In Review', ['LOW_FACE_MATCH_SIMILARITY']), { estado: 'In Review' }))
  assert.equal((await prisma.identidadIntento.findUniqueOrThrow({ where: { id: e.intentoId } })).estado, 'en_revision')
  return e
}
const intentoDe = (id: string) => prisma.identidadIntento.findUniqueOrThrow({ where: { id } })
const asientos = (userId: string, accion: string) => prisma.auditLog.findMany({ where: { entidadTipo: 'IdentidadVerificacion', entidadId: userId, accion: accion as never }, orderBy: { createdAt: 'asc' } })
const notifs = (userId: string) => prisma.notificacion.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } })
const noAutorizado = (e: unknown) => e instanceof ErrorDeIdentidad && e.codigo === 'no_autorizado'

// ── 1 · Solo el equipo ──────────────────────────────────────────────────────

test('1 · SOLO EL EQUIPO: un administrador de empresa, un cliente, nadie o un rol inventado no leen ni tocan nada', async () => {
  const admin = await persona('admin', 'ADMINISTRADOR')
  const cliente = await persona('cliente')
  const { q, intentoId } = await empezada('acceso')
  const intrusos: ActorDeIdentidad[] = [
    { userId: admin.userId, rol: 'ADMINISTRADOR' },
    { userId: cliente.userId, rol: 'CLIENTE' },
    { userId: cliente.userId, rol: 'superadmin' }, // el rol distingue mayúsculas
    { userId: '', rol: 'SUPERADMIN' },
    undefined as unknown as ActorDeIdentidad,
  ]
  for (const actor of intrusos) {
    const etiqueta = JSON.stringify(actor ?? null)
    await assert.rejects(() => resumenDeLaPlataforma(actor), noAutorizado, `resumen ${etiqueta}`)
    await assert.rejects(() => colaDeRevision(actor), noAutorizado, `revisión ${etiqueta}`)
    await assert.rejects(() => colaDeIncidencias(actor, 'abiertas'), noAutorizado, `incidencias ${etiqueta}`)
    await assert.rejects(() => buscarPersonas(actor, 'persona'), noAutorizado, `buscar ${etiqueta}`)
    await assert.rejects(() => verCasoDeIdentidad(actor, q.userId, 'soporte'), noAutorizado, `caso ${etiqueta}`)
    await assert.rejects(() => resolverRevisionComoStaff(actor, intentoId, 'rechazar', 'x'), noAutorizado, `resolver ${etiqueta}`)
    await assert.rejects(() => atenderIncidenciaComoStaff(actor, 'cualquiera', 'tomar'), noAutorizado, `incidencia ${etiqueta}`)
  }
  assert.equal((await asientos(q.userId, 'IDENTIDAD_ESTADO_CONSULTADO_POR_STAFF')).length, 0, 'ninguna de esas lecturas dejó asiento: ninguna ocurrió')
  assert.equal((await intentoDe(intentoId)).estado, 'iniciada')
})

// ── 2 · Abrir un caso ───────────────────────────────────────────────────────

test('2 · ABRIR UN CASO deja asiento con el motivo (lista cerrada) y la IP, y NUNCA devuelve la referencia ni el hash', async () => {
  const { q, intentoId } = await empezada('caso')
  await recibir(avisoFirmado(dd.aprobar(intentoId, { cedula: `007-${sufijo}-CASO` })))
  await reportarProblemaDePersona(q, { tipo: 'otro', mensaje: `Una duda mía ${sufijo}` })

  for (const malo of ['', 'curiosidad', 'REVISION_DE_CASO', 'revision_de_caso ']) {
    await assert.rejects(() => verCasoDeIdentidad(staff, q.userId, malo), (e: unknown) => e instanceof ErrorDeIdentidad && e.codigo === 'motivo_requerido', `«${malo}»`)
  }
  assert.equal((await asientos(q.userId, 'IDENTIDAD_ESTADO_CONSULTADO_POR_STAFF')).length, 0, 'un motivo inventado no abre nada ni deja asiento')
  await assert.rejects(() => verCasoDeIdentidad(staff, 'no-existe', 'soporte'), (e: unknown) => e instanceof ErrorDeIdentidad && e.codigo === 'persona_no_encontrada')

  const caso = await verCasoDeIdentidad(staff, q.userId, 'revision_de_caso', { ip: '10.0.0.7', userAgent: 'panel' })
  assert.deepEqual(caso.persona, { userId: q.userId, nombre: q.nombre, email: q.email })
  assert.deepEqual([caso.estado.estado, caso.verificacion?.estado, caso.verificacion?.nivel, caso.verificacion?.proveedor], ['verificada', 'verificada', 'documento_selfie', 'didit'])
  assert.equal(caso.intentos.length, 1)
  assert.ok(caso.consentimientos.length >= 2 && caso.consentimientos.every((c) => c.canal === 'web' && c.version.length > 0), 'la prueba de los consentimientos: qué texto y cuándo')
  assert.equal(caso.incidencias.length, 1)
  assert.equal(caso.incidencias[0].mensaje, `Una duda mía ${sufijo}`, 'el equipo sí lee lo que escribió la persona')

  const volcado = JSON.stringify(caso)
  for (const prohibido of ['hashDedupe', 'referenciaProveedor', 'sellada', '007-', API_KEY, dd.sesionDe(intentoId).id]) assert.ok(!volcado.includes(prohibido), `el caso lleva «${prohibido}»`)

  const [a] = await asientos(q.userId, 'IDENTIDAD_ESTADO_CONSULTADO_POR_STAFF')
  assert.deepEqual([a.userId, a.ipAddress, (a.payload as Record<string, unknown>).motivo], [staff.userId, '10.0.0.7', 'revision_de_caso'])
  assert.ok(!JSON.stringify(a).includes(sufijo), 'ni el nombre ni el texto de la persona van al asiento')
  assert.deepEqual(MOTIVOS_DE_CONSULTA.map((m) => m.valor), ['revision_de_caso', 'incidencia', 'soporte', 'auditoria'])
})

// ── 3 · Resolver un caso en revisión ────────────────────────────────────────

test('3 · RECHAZAR un documento repetido: el intento queda definitivo con código NEUTRO, se borra la sesión, la persona recibe el aviso SIN el motivo real y el equipo deja asiento', async () => {
  const { segunda } = await casoDuplicado('rechaza')
  dd.reiniciarLlamadas()
  const r = await resolverRevisionComoStaff(staff, segunda.intentoId, 'rechazar', 'Documento de otra cuenta sin explicación')
  assert.deepEqual(r, { ok: true, userId: segunda.q.userId, resultado: 'rechazada' })

  const fila = await intentoDe(segunda.intentoId)
  assert.deepEqual([fila.estado, fila.tipoRechazo, fila.codigoRazon], ['rechazada_definitiva', 'definitivo', 'REVISION_NEGADA'])
  assert.ok(fila.resueltoAt && fila.purgadoAt, 'queda resuelto y la sesión borrada en el proveedor')
  assert.ok(dd.sesionDe(segunda.intentoId).borrada)
  assert.equal(await prisma.identidadVerificacion.count({ where: { userId: segunda.q.userId } }), 0, 'no se acreditó a nadie')

  // La persona: neutro, sin reintento, sin decir por qué.
  const panel = await leerPanelDeIdentidad(segunda.q.userId)
  assert.deepEqual([panel.vista.accion, panel.vista.etiqueta], ['contactar', 'No verificada'])
  assert.doesNotMatch(JSON.stringify(panel.vista), /otra cuenta|duplic|asociado|ya existe/i)
  const [aviso] = (await notifs(segunda.q.userId)).filter((x) => x.tipo === 'IDENTIDAD_RECHAZADA')
  assert.ok(aviso)
  assert.doesNotMatch(JSON.stringify([aviso.titulo, aviso.mensaje]), /otra cuenta|duplic|asociado/i)
  assert.match(aviso.mensaje, /soporte/)

  const [a] = await asientos(segunda.q.userId, 'IDENTIDAD_REVISION_RESUELTA')
  assert.deepEqual(a.payload, { intentoId: segunda.intentoId, estadoAnterior: 'en_revision', resultado: 'rechazada', codigoRazon: 'REVISION_NEGADA', canal: 'web', motivo: 'Documento de otra cuenta sin explicación', rol: 'SUPERADMIN' })
  assert.equal(a.userId, staff.userId, 'quién lo resolvió')

  assert.deepEqual(await resolverRevisionComoStaff(staff, segunda.intentoId, 'rechazar', 'otra vez'), { ok: false, error: 'no_esta_en_revision' }, 'ya no está en revisión')
})

test('3b · PEDIR QUE REPITA: la persona puede empezar AL INSTANTE (no cuenta como rechazo), recibe su aviso y la sesión se borra', async () => {
  const e = await casoDelProveedor('repite')
  const r = await resolverRevisionComoStaff(staff, e.intentoId, 'pedir_repeticion', 'El proveedor no resolvió; que repita')
  assert.deepEqual(r, { ok: true, userId: e.q.userId, resultado: 'repeticion' })
  const fila = await intentoDe(e.intentoId)
  assert.deepEqual([fila.estado, fila.tipoRechazo, fila.codigoRazon], ['cancelada', null, null])
  assert.ok(fila.purgadoAt)

  const panel = await leerPanelDeIdentidad(e.q.userId)
  assert.equal(panel.vista.accion, 'verificar', 'sin espera ni tope')
  const nuevo = await crearIntento(e.q.userId, { canal: 'web' })
  assert.equal(nuevo.ok, true, 'puede empezar de inmediato')
  const [aviso] = (await notifs(e.q.userId)).filter((x) => x.tipo === 'IDENTIDAD_REPETIR')
  assert.ok(aviso)
  assert.deepEqual([aviso.titulo, aviso.href], ['Necesitamos que repitas tu verificación', '/cliente/identidad'])
  assert.match(aviso.mensaje, /No cuenta como un intento fallido/)
  assert.equal((await asientos(e.q.userId, 'IDENTIDAD_REVISION_RESUELTA')).length, 1)
})

test('3c · EL EQUIPO NO PUEDE ACREDITAR: no hay camino a «verificada» desde aquí, y solo se resuelve lo que está en revisión', async () => {
  const { q, intentoId } = await empezada('no-revision')
  // Un intento que no está en revisión no se toca.
  assert.deepEqual(await resolverRevisionComoStaff(staff, intentoId, 'rechazar', 'x'), { ok: false, error: 'no_esta_en_revision' })
  assert.equal((await intentoDe(intentoId)).estado, 'iniciada')
  assert.deepEqual(await resolverRevisionComoStaff(staff, 'no-existe', 'rechazar', 'x'), { ok: false, error: 'no_existe' })
  // Sin motivo no se resuelve.
  const e = await casoDelProveedor('sin-motivo')
  for (const sinMotivo of ['', '   ', '\u0000\u0007']) {
    await assert.rejects(() => resolverRevisionComoStaff(staff, e.intentoId, 'rechazar', sinMotivo), (x: unknown) => x instanceof ErrorDeIdentidad && x.codigo === 'motivo_requerido')
  }
  assert.equal((await intentoDe(e.intentoId)).estado, 'en_revision')
  assert.equal(await prisma.identidadVerificacion.count({ where: { userId: q.userId } }), 0)
  // La decisión de una persona del equipo no puede ser «aprobar»: el tipo lo prohíbe y la ejecución también.
  assert.deepEqual(await resolverRevisionComoStaff(staff, e.intentoId, 'aprobar' as never, 'quiero aprobarlo'), { ok: false, error: 'decision_invalida' })
  assert.equal((await intentoDe(e.intentoId)).estado, 'en_revision', 'una decisión inventada no se interpreta como otra: no cambia nada')
  assert.equal(await prisma.identidadVerificacion.count({ where: { userId: e.q.userId } }), 0)
})

test('3d · DOS PERSONAS DEL EQUIPO resolviendo a la vez el mismo caso: una lo resuelve, la otra se entera de que ya no está', async () => {
  const e = await casoDelProveedor('carrera')
  const r = await Promise.all([resolverRevisionComoStaff(staff, e.intentoId, 'rechazar', 'a'), resolverRevisionComoStaff(staff, e.intentoId, 'pedir_repeticion', 'b')])
  assert.equal(r.filter((x) => x.ok).length, 1)
  assert.equal(r.filter((x) => !x.ok && x.error === 'no_esta_en_revision').length, 1)
  assert.equal((await asientos(e.q.userId, 'IDENTIDAD_REVISION_RESUELTA')).length, 1)
})

// ── 4 · Incidencias ─────────────────────────────────────────────────────────

test('4 · TOMAR una incidencia: pasa a «en proceso», queda quién, repetirlo no cambia nada, y el asiento no lleva el texto de la persona', async () => {
  const q = await persona('inc1')
  const rep = await reportarProblemaDePersona(q, { tipo: 'rechazo_incorrecto', mensaje: `Creo que fue un error ${sufijo}` })
  assert.equal(rep.ok, true)
  if (!rep.ok) return
  const t1 = await atenderIncidenciaComoStaff(staff, rep.incidenciaId, 'tomar')
  assert.deepEqual(t1, { ok: true, userId: q.userId, estado: 'en_proceso', cambio: true, respuesta: null })
  const fila = await prisma.identidadIncidencia.findUniqueOrThrow({ where: { id: rep.incidenciaId } })
  assert.deepEqual([fila.estado, fila.atendidaPorId, fila.resueltaAt], ['en_proceso', staff.userId, null])
  assert.deepEqual(await atenderIncidenciaComoStaff(staff, rep.incidenciaId, 'tomar'), { ok: true, userId: q.userId, estado: 'en_proceso', cambio: false, respuesta: null })
  const asientosTomar = await asientos(q.userId, 'IDENTIDAD_INCIDENCIA_ATENDIDA')
  assert.equal(asientosTomar.length, 1, 'repetir no duplica el asiento')
  assert.deepEqual(asientosTomar[0].payload, { incidenciaId: rep.incidenciaId, intentoId: null, resultado: 'tomada', rol: 'SUPERADMIN' })
  assert.ok(!JSON.stringify(asientosTomar).includes(sufijo))
  // La persona sigue viéndola como abierta mientras se atiende.
  assert.equal((await leerPanelDeIdentidad(q.userId)).incidenciasAbiertas.length, 1)
})

test('4b · RESOLVER: exige respuesta, la guarda, se la deja a la persona en su campana (una sola vez) y deja de contarle como abierta', async () => {
  const q = await persona('inc2')
  const rep = await reportarProblemaDePersona(q, { tipo: 'no_puedo_completar', mensaje: `No me deja ${sufijo}` })
  if (!rep.ok) throw new Error('no se reportó')
  for (const mala of [undefined, '', '   ', '\u0000']) assert.deepEqual(await atenderIncidenciaComoStaff(staff, rep.incidenciaId, 'resolver', mala), { ok: false, error: 'respuesta_invalida' })
  assert.deepEqual(await atenderIncidenciaComoStaff(staff, 'no-existe', 'tomar'), { ok: false, error: 'no_existe' })

  const respuesta = 'Revisamos tu caso: ya puedes volver a intentarlo desde tu perfil.'
  const r = await atenderIncidenciaComoStaff(staff, rep.incidenciaId, 'resolver', respuesta)
  assert.deepEqual(r, { ok: true, userId: q.userId, estado: 'resuelta', cambio: true, respuesta })
  const fila = await prisma.identidadIncidencia.findUniqueOrThrow({ where: { id: rep.incidenciaId } })
  assert.deepEqual([fila.estado, fila.respuesta, fila.resueltaPorId, fila.atendidaPorId], ['resuelta', respuesta, staff.userId, staff.userId])
  assert.ok(fila.resueltaAt)

  const avisos = (await notifs(q.userId)).filter((x) => x.dedupeKey === `identidad-incidencia:${rep.incidenciaId}`)
  assert.equal(avisos.length, 1)
  assert.deepEqual([avisos[0].tipo, avisos[0].titulo, avisos[0].mensaje, avisos[0].href], ['SISTEMA', 'Respondimos tu reporte de verificación', respuesta, '/cliente/identidad'])
  assert.deepEqual(await atenderIncidenciaComoStaff(staff, rep.incidenciaId, 'resolver', 'otra respuesta'), { ok: true, userId: q.userId, estado: 'resuelta', cambio: false, respuesta: null }, 'repetir no cambia nada')
  assert.equal((await notifs(q.userId)).filter((x) => x.dedupeKey === `identidad-incidencia:${rep.incidenciaId}`).length, 1, 'ni repite el aviso')
  assert.equal((await prisma.identidadIncidencia.findUniqueOrThrow({ where: { id: rep.incidenciaId } })).respuesta, respuesta, 'la respuesta no se pisa')
  assert.deepEqual(await atenderIncidenciaComoStaff(staff, rep.incidenciaId, 'tomar'), { ok: false, error: 'ya_resuelta' })

  const bitacora = JSON.stringify(await prisma.auditLog.findMany({ where: { entidadId: q.userId } }))
  assert.ok(!bitacora.includes(respuesta) && !bitacora.includes(sufijo), 'ni la respuesta ni el texto de la persona están en la bitácora')
  assert.equal((await leerPanelDeIdentidad(q.userId)).incidenciasAbiertas.length, 0)
})

test('4c · LA BASE EXIGE LO MISMO: una incidencia «resuelta» sin respuesta o sin fecha no entra, ni por fuera del servicio', async () => {
  const q = await persona('inc3')
  const base = { userId: q.userId, tipo: 'otro', mensaje: 'hola', estado: 'resuelta' }
  await assert.rejects(() => prisma.identidadIncidencia.create({ data: { ...base, resueltaAt: new Date() } }), /check|constraint|violat/i, 'sin respuesta')
  await assert.rejects(() => prisma.identidadIncidencia.create({ data: { ...base, respuesta: 'listo' } }), /check|constraint|violat/i, 'sin fecha')
  await assert.rejects(() => prisma.identidadIncidencia.create({ data: { ...base, respuesta: 'x'.repeat(501), resueltaAt: new Date() } }), /check|constraint|violat/i, 'respuesta enorme')
  await prisma.identidadIncidencia.create({ data: { ...base, respuesta: 'listo', resueltaAt: new Date() } })
})

// ── 5 · Colas y búsqueda ────────────────────────────────────────────────────

test('5 · LA COLA DE REVISIÓN trae a quien espera, con el código crudo (el equipo sí lo ve), lo más viejo primero, y se vacía al resolver', async () => {
  const { segunda } = await casoDuplicado('cola')
  const prov = await casoDelProveedor('cola-prov')
  const antes = await colaDeRevision(staff)
  const a = antes.casos.find((c) => c.intentoId === segunda.intentoId)
  const b = antes.casos.find((c) => c.intentoId === prov.intentoId)
  assert.ok(a && b)
  assert.deepEqual([a.codigoRazon, a.userId, a.nombre, a.email], ['IDENTIDAD_DUPLICADA', segunda.q.userId, segunda.q.nombre, segunda.q.email])
  assert.equal(b.codigoRazon, 'ROSTRO_NO_COINCIDE')
  assert.ok(antes.total >= 2 && antes.casos.length <= LIMITE_DE_COLA)
  for (let i = 1; i < antes.casos.length; i++) assert.ok(antes.casos[i - 1].creadoAt <= antes.casos[i].creadoAt, 'las más antiguas primero')
  assert.ok(!JSON.stringify(antes).includes('hashDedupe'))
  await resolverRevisionComoStaff(staff, prov.intentoId, 'pedir_repeticion', 'cola')
  const despues = await colaDeRevision(staff)
  assert.ok(!despues.casos.some((c) => c.intentoId === prov.intentoId))
  assert.equal(despues.total, antes.total - 1)
})

test('5b · LA COLA DE INCIDENCIAS separa lo abierto de lo resuelto, con quién la atendió', async () => {
  // La cola se acota (lo más antiguo primero): en una base de pruebas reutilizada, las incidencias abiertas de corridas anteriores la llenarían.
  await prisma.identidadIncidencia.deleteMany({ where: { estado: { in: ['abierta', 'en_proceso'] } } })
  const q = await persona('cola-inc')
  const rep = await reportarProblemaDePersona(q, { tipo: 'datos_incorrectos', mensaje: `Mi nombre sale mal ${sufijo}` })
  if (!rep.ok) throw new Error('x')
  const abiertas = await colaDeIncidencias(staff, 'abiertas')
  const fila = abiertas.incidencias.find((i) => i.id === rep.incidenciaId)
  assert.ok(fila)
  assert.deepEqual([fila.tipo, fila.estado, fila.userId, fila.nombre, fila.mensaje, fila.atendidaPor], ['datos_incorrectos', 'abierta', q.userId, q.nombre, `Mi nombre sale mal ${sufijo}`, null])
  await atenderIncidenciaComoStaff(staff, rep.incidenciaId, 'resolver', 'Corregido.')
  assert.ok(!(await colaDeIncidencias(staff, 'abiertas')).incidencias.some((i) => i.id === rep.incidenciaId))
  const resueltas = (await colaDeIncidencias(staff, 'resueltas')).incidencias.find((i) => i.id === rep.incidenciaId)
  assert.deepEqual([resueltas?.estado, resueltas?.respuesta, resueltas?.atendidaPor], ['resuelta', 'Corregido.', staff.userId ? `Equipo ${sufijo}` : null])
})

test('5c · BUSCAR PERSONAS: mínimo tres caracteres, por correo, nombre o id exacto, con su estado; nunca un volcado', async () => {
  const q = await persona('buscame')
  assert.deepEqual(await buscarPersonas(staff, ''), [])
  assert.deepEqual(await buscarPersonas(staff, 'ab'), [])
  assert.deepEqual(await buscarPersonas(staff, '  x '), [])
  for (const texto of [q.email, q.email.toUpperCase(), `buscame ${sufijo}`, q.userId]) {
    const r = await buscarPersonas(staff, texto)
    assert.ok(r.some((p) => p.userId === q.userId), texto)
  }
  const encontrada = (await buscarPersonas(staff, q.userId))[0]
  assert.deepEqual([encontrada.estado, encontrada.ultimoIntento], [null, null])
  const e = await empezada('buscada')
  const p = (await buscarPersonas(staff, e.q.email))[0]
  assert.deepEqual([p.userId, p.ultimoIntento?.estado], [e.q.userId, 'iniciada'])
  assert.ok((await buscarPersonas(staff, 'persona')).length <= 20)
})

// ── 6 · Resumen de la plataforma ────────────────────────────────────────────

test('6 · EL RESUMEN cuenta lo que hay (compuerta, interruptor con su motivo, intentos del día, revisión, incidencias) y no inventa ceros', async () => {
  const antes = await resumenDeLaPlataforma(staff)
  assert.deepEqual([antes.compuerta.habilitada, antes.compuerta.faltantes, antes.interruptor.encendido], [true, [], true])
  assert.match(antes.interruptor.motivo ?? '', /Pruebas automáticas del equipo/)
  assert.equal(antes.interruptor.cambiadoPor, `Equipo ${sufijo}`)
  for (const campo of ['intentos24h', 'verificadasVigentes', 'vencenEn30Dias', 'enRevision', 'incidenciasAbiertas', 'purgasPendientes', 'avisosFallidos', 'supresionesSinCompletar'] as const) {
    assert.notEqual(antes[campo], null, `${campo} no debería ser «sin dato»`)
  }

  await casoDuplicado('resumen')
  const q = await persona('resumen-inc')
  await reportarProblemaDePersona(q, { tipo: 'otro', mensaje: 'x' })
  const despues = await resumenDeLaPlataforma(staff)
  assert.equal(despues.enRevision!.total, antes.enRevision!.total + 1)
  assert.equal(despues.enRevision!.porDocumentoRepetido, antes.enRevision!.porDocumentoRepetido + 1)
  assert.ok(despues.enRevision!.masAntiguoAt)
  assert.equal(despues.incidenciasAbiertas!.total, antes.incidenciasAbiertas!.total + 1)
  assert.equal(despues.verificadasVigentes, antes.verificadasVigentes! + 1, 'la primera cuenta del par quedó verificada')
  assert.ok(despues.intentos24h!.total >= antes.intentos24h!.total + 2)
  assert.ok((despues.intentos24h!.porEstado.en_revision ?? 0) >= 1)
})

test('6b · UN BORRADO SIN COMPLETAR se ve, y a los 7 días se marca vencido; al completarse deja de contar', async () => {
  const antes = await resumenDeLaPlataforma(staff)
  const q = await persona('arco')
  await registrarSolicitudDeSupresion(q.userId, null, 'solicitud_de_la_persona')
  const reciente = await resumenDeLaPlataforma(staff)
  assert.equal(reciente.supresionesSinCompletar!.total, antes.supresionesSinCompletar!.total + 1)
  assert.equal(reciente.supresionesSinCompletar!.vencidas, antes.supresionesSinCompletar!.vencidas, 'recién pedida no está vencida')

  // La misma solicitud, vista 8 días después: ya está en riesgo.
  const tarde = await resumenDeLaPlataforma(staff, new Date(Date.now() + (DIAS_DE_ALERTA_DE_SUPRESION + 1) * DIA))
  assert.ok(tarde.supresionesSinCompletar!.vencidas >= antes.supresionesSinCompletar!.vencidas + 1)

  // Al completarse, deja de contar.
  await prisma.auditLog.create({ data: { companyId: null, userId: null, accion: 'IDENTIDAD_SUPRESION_COMPLETADA', entidadTipo: 'IdentidadVerificacion', entidadId: q.userId, payload: {} } })
  const hecho = await resumenDeLaPlataforma(staff)
  assert.equal(hecho.supresionesSinCompletar!.total, antes.supresionesSinCompletar!.total)
})

test('6c · LAS PURGAS PENDIENTES y los avisos fallidos del proveedor se cuentan: son lo que el equipo debe mirar', async () => {
  const antes = await resumenDeLaPlataforma(staff)
  const e = await empezada('purga-pend')
  await recibir(avisoFirmado(dd.poner(e.intentoId, 'Declined', ['IMAGE_TOO_BLURRY']), { estado: 'Declined' }))
  // Se simula que el borrado en el proveedor no se pudo hacer.
  await prisma.identidadIntento.update({ where: { id: e.intentoId }, data: { purgadoAt: null } })
  const medio = await resumenDeLaPlataforma(staff)
  assert.equal(medio.purgasPendientes, antes.purgasPendientes! + 1)
  await prisma.identidadIntento.update({ where: { id: e.intentoId }, data: { purgadoAt: new Date() } })
  assert.equal((await resumenDeLaPlataforma(staff)).purgasPendientes, antes.purgasPendientes)

  await prisma.identidadEventoExterno.create({ data: { proveedor: 'didit', eventoExternoId: `fallido-${sufijo}`, tipo: 'status.updated', payloadHash: 'h'.repeat(64), estado: 'fallido', detalle: 'proveedor_no_disponible' } })
  assert.equal((await resumenDeLaPlataforma(staff)).avisosFallidos, antes.avisosFallidos! + 1)
})
