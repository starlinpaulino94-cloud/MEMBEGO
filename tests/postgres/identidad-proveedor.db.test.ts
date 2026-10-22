/**
 * VERIFICACIÓN DE IDENTIDAD · Fase 2 · el proveedor, contra PostgreSQL real y un
 * Didit FALSO que vive en esta prueba (se instala en `globalThis.fetch`). Así se
 * ejercita TODO el camino —aviso firmado → bandeja → consulta → decisión → borrado—
 * sin red y sin documentos reales: los datos son sintéticos.
 *
 * Cada prueba falla si vuelve el defecto que cierra:
 *
 *   1 · crear sesión sin consentimiento, sin configurar o con el proveedor caído;
 *   2 · el token de la sesión, la clave o el número de documento en un log o en la base;
 *   3 · un aviso sin firma, viejo o alterado que mueve un intento;
 *   4 · fiarse de lo que DICE el aviso en vez de lo que dice el proveedor;
 *   5 · un aviso repetido, simultáneo o llegado antes de tiempo que duplica o se pierde;
 *   6 · borrar la sesión del proveedor antes de guardar el resultado, o no borrarla nunca;
 *   7 · una aprobación sin prueba de vida o comparación facial;
 *   8 · el mismo documento en dos cuentas por la vía del proveedor;
 *   9 · un aviso perdido que deja a la persona esperando para siempre;
 *  10 · eliminar una cuenta dejando datos biométricos en el proveedor.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { prisma } from '../../src/lib/prisma'
import {
  ErrorDeIdentidad,
  cambiarInterruptorDeIdentidad,
  compuertaDeIdentidad,
  crearIntento,
  estadoDeIdentidadDe,
  guardarReferenciaDeSesion,
  otorgarConsentimientoIdentidad,
  proyectarEnFichas,
  type ActorDeIdentidad,
} from '../../src/modules/identidad/identidad'
import {
  TEXTO_VERSION_BIOMETRIA,
  TEXTO_VERSION_DIVULGACION,
  TEXTO_VERSION_TRANSFERENCIA,
} from '../../src/modules/identidad/identidadConsentimientosCore'
import { recibirAvisoDeProveedor, procesarEvento, reintentarEventosPendientes } from '../../src/modules/identidad/eventos'
import {
  consultarEstadoConReconciliacion,
  iniciarSesionDeVerificacion,
  purgarSesionDeIntento,
  reconciliarConElProveedor,
  sincronizarIntento,
  urlDeRetornoDeIdentidad,
} from '../../src/modules/identidad/sincronizacion'
import {
  bloqueoPorIdentidadPendiente,
  borrarEnElProveedorLoDeLaPersona,
  suprimirIdentidadDePersona,
} from '../../src/modules/identidad/supresion'
import { Circuito } from '../../src/modules/identidad/proveedor/circuito'
import { ErrorDeProveedor } from '../../src/modules/identidad/proveedor/contrato'
import { crearProveedorDidit } from '../../src/modules/identidad/proveedor/didit'
import { DiditFalso, crearAvisoFirmado } from './_helpers/didit-falso'

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const MIN = 60_000
const API_KEY = `clave-didit-sintetica-${sufijo}`
const SECRETO = `secreto-webhook-sintetico-${sufijo}`.padEnd(32, 'x')
const PEPPER = `pepper-de-prueba-${sufijo}-`.padEnd(40, 'x')
const CTX = { canal: 'web' as const, ip: '190.80.12.5', userAgent: 'prueba-identidad' }
const avisoFirmado = crearAvisoFirmado(SECRETO)

// ── Entorno y fixtures ──────────────────────────────────────────────────────

const VARIABLES = ['IDENTIDAD_CLAVES_MAESTRAS', 'IDENTIDAD_PEPPER_DEDUPE', 'DIDIT_API_KEY', 'DIDIT_WORKFLOW_ID', 'DIDIT_WEBHOOK_SECRET', 'DIDIT_WEBHOOK_SECRET_ANTERIOR', 'DIDIT_API_BASE'] as const
const anterior: Record<string, string | undefined> = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
const fetchOriginal = globalThis.fetch
let staff: ActorDeIdentidad
let dd: DiditFalso
const CLAVES = `1:${randomBytes(32).toString('base64')}`

function entornoCompleto() {
  process.env.IDENTIDAD_CLAVES_MAESTRAS = CLAVES
  process.env.IDENTIDAD_PEPPER_DEDUPE = PEPPER
  process.env.DIDIT_API_KEY = API_KEY
  process.env.DIDIT_WORKFLOW_ID = '11111111-0000-0000-0000-000000000001'
  process.env.DIDIT_WEBHOOK_SECRET = SECRETO
  delete process.env.DIDIT_WEBHOOK_SECRET_ANTERIOR
  delete process.env.DIDIT_API_BASE
}

before(async () => {
  entornoCompleto()
  dd = new DiditFalso(sufijo)
  globalThis.fetch = dd.manejar as typeof fetch
  const u = await prisma.user.create({
    data: { supabaseId: `sb-idp-staff-${sufijo}`, email: `staff-idp-${sufijo}@prueba.test`, name: 'Equipo', role: 'SUPERADMIN' },
    select: { id: true },
  })
  staff = { userId: u.id, rol: 'SUPERADMIN' }
  await cambiarInterruptorDeIdentidad(staff, { encendido: true, motivo: 'Pruebas automáticas del proveedor con datos sintéticos.' })
  // La base de pruebas se reutiliza entre corridas: lo que dejaron otras pruebas no debe mezclarse con esto.
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

let n = 0
async function persona(etiqueta = 'p') {
  const k = n++
  return prisma.user.create({
    data: { supabaseId: `sb-idp-${etiqueta}-${sufijo}-${k}`, email: `idp-${etiqueta}-${sufijo}-${k}@prueba.test`, name: `Persona ${etiqueta} ${k}`, role: 'CLIENTE' },
    select: { id: true, supabaseId: true },
  })
}
async function consentir(userId: string, divulgacion = false) {
  await otorgarConsentimientoIdentidad(userId, 'IDENTIDAD_BIOMETRIA', { textoVersionVista: TEXTO_VERSION_BIOMETRIA, ...CTX })
  await otorgarConsentimientoIdentidad(userId, 'IDENTIDAD_TRANSFERENCIA_INTERNACIONAL', { textoVersionVista: TEXTO_VERSION_TRANSFERENCIA, ...CTX })
  if (divulgacion) await otorgarConsentimientoIdentidad(userId, 'IDENTIDAD_DIVULGACION_EMPRESAS', { textoVersionVista: TEXTO_VERSION_DIVULGACION, ...CTX })
}
/** Una persona con consentimientos que ya empezó: intento con sesión en el proveedor. */
async function conSesion(etiqueta = 's', opciones: { divulgacion?: boolean; canal?: 'web' | 'movil_hospedado' } = {}) {
  const p = await persona(etiqueta)
  await consentir(p.id, opciones.divulgacion)
  const r = await iniciarSesionDeVerificacion(p.id, { canal: opciones.canal ?? 'movil_hospedado' })
  assert.equal(r.ok, true, JSON.stringify(r))
  if (!r.ok) throw new Error('no inició')
  return { p, intentoId: r.intentoId, url: r.url, nonce: r.nonce }
}
const intentoDe = (id: string) => prisma.identidadIntento.findUniqueOrThrow({ where: { id } })
const verifDe = (userId: string) => prisma.identidadVerificacion.findUnique({ where: { userId } })
const evento = (eventoExternoId: string) => prisma.identidadEventoExterno.findFirst({ where: { eventoExternoId } })
const asientos = (userId: string, accion: string) =>
  prisma.auditLog.findMany({ where: { entidadTipo: 'IdentidadVerificacion', entidadId: userId, accion: accion as never } })
async function recibir(a: ReturnType<typeof avisoFirmado>, proveedor = 'didit') {
  const r = await recibirAvisoDeProveedor({ proveedor, cuerpoCrudo: a.cuerpoCrudo, cabeceras: a.cabeceras })
  if (r.despues) await r.despues()
  return r
}

// ── 1 · Empezar ─────────────────────────────────────────────────────────────

test('1 · EMPEZAR: crea el intento y la sesión con lo que debe, guarda la referencia SELLADA y no deja rastro de la dirección', async () => {
  dd.reiniciarLlamadas()
  const { p, intentoId, url, nonce } = await conSesion('inicio')

  assert.match(url, /^https:\/\/verification\.didit\.me\/session\/[0-9a-f]+$/)
  const creacion = dd.llamadas.filter((l) => l.metodo === 'POST' && l.ruta === '/v3/session/')
  assert.equal(creacion.length, 1)
  assert.equal(creacion[0].apiKey, API_KEY, 'la clave va en x-api-key')
  assert.equal(creacion[0].redirect, 'manual', 'sin seguir redirecciones')
  assert.equal(creacion[0].cuerpo?.workflow_id, '11111111-0000-0000-0000-000000000001')
  assert.equal(creacion[0].cuerpo?.vendor_data, intentoId, 'la referencia es el id del intento, no la persona')
  assert.equal(creacion[0].cuerpo?.language, 'es')
  assert.equal(creacion[0].cuerpo?.callback, `membego://identidad/retorno?intento=${intentoId}&nonce=${nonce}`)
  assert.doesNotMatch(JSON.stringify(creacion[0].cuerpo), new RegExp(p.id), 'nada de la persona viaja al proveedor')
  assert.doesNotMatch(JSON.stringify(creacion[0].cuerpo), /@prueba\.test|Persona/, 'ni su correo ni su nombre')

  const fila = await intentoDe(intentoId)
  assert.equal(fila.estado, 'iniciada')
  assert.ok(fila.iniciadoAt)
  assert.ok(fila.referenciaProveedorSellada && fila.claveVersion === 1)
  const sesion = dd.sesionDe(intentoId)
  // Ni la sesión ni el token de la dirección están en ninguna fila de las tablas de identidad.
  for (const tabla of ['identidad_intentos', 'identidad_verificaciones', 'identidad_eventos_externos', 'identidad_consentimientos']) {
    const volcado = JSON.stringify(await prisma.$queryRawUnsafe(`select * from ${tabla}`))
    assert.ok(!volcado.includes(sesion.id), `${tabla}: el id de la sesión no está en claro`)
    assert.ok(!volcado.includes(sesion.token), `${tabla}: el token de la dirección no está en ninguna parte`)
  }
  assert.equal((await asientos(p.id, 'IDENTIDAD_VERIFICACION_INICIADA')).length, 1)
})

test('1b · el retorno por web es una dirección https de la app; el de la app móvil, el esquema membego://', () => {
  const web = urlDeRetornoDeIdentidad('web', 'int1', 'nonce1', 'https://app.membego.test/cliente/ajustes')
  assert.equal(web, 'https://app.membego.test/cliente/ajustes?intento=int1&nonce=nonce1&identidad=retorno')
  assert.equal(urlDeRetornoDeIdentidad('movil_nativo', 'int1', null), 'membego://identidad/retorno?intento=int1')
})

test('1c · pedirla otra vez devuelve LA MISMA sesión (idempotente) y un solo intento', async () => {
  const { p, intentoId, url } = await conSesion('idem')
  const otra = await iniciarSesionDeVerificacion(p.id, { canal: 'movil_hospedado' })
  assert.deepEqual([otra.ok, otra.ok && otra.intentoId, otra.ok && otra.url], [true, intentoId, url])
  assert.equal(await prisma.identidadIntento.count({ where: { userId: p.id } }), 1)
  assert.equal([...dd.sesiones.values()].filter((s) => s.vendorData === intentoId).length, 1, 'el proveedor tampoco abrió dos')
})

test('1d · SIN consentimiento no se llama al proveedor, y con la verificación apagada o sin configurar tampoco', async () => {
  const p = await persona('sinc')
  dd.reiniciarLlamadas()
  const r = await iniciarSesionDeVerificacion(p.id, { canal: 'web' })
  assert.deepEqual([r.ok, !r.ok && r.motivo], [false, 'falta_consentimiento'])
  await consentir(p.id)

  delete process.env.DIDIT_API_KEY
  try {
    const sin = await iniciarSesionDeVerificacion(p.id, { canal: 'web' })
    assert.deepEqual([sin.ok, !sin.ok && sin.motivo], [false, 'no_habilitada'], 'sin el proveedor configurado la compuerta está cerrada')
    assert.deepEqual((await compuertaDeIdentidad()).faltantes, ['DIDIT_API_KEY'])
    await assert.rejects(
      () => cambiarInterruptorDeIdentidad(staff, { encendido: true, motivo: 'prueba' }),
      (e: unknown) => e instanceof ErrorDeIdentidad && e.codigo === 'falta_configuracion' && /DIDIT_API_KEY/.test(e.message)
    )
  } finally {
    process.env.DIDIT_API_KEY = API_KEY
  }
  delete process.env.DIDIT_WEBHOOK_SECRET
  try {
    assert.ok((await compuertaDeIdentidad()).faltantes.includes('DIDIT_WEBHOOK_SECRET'))
  } finally {
    process.env.DIDIT_WEBHOOK_SECRET = SECRETO
  }
  assert.equal(dd.llamadas.length, 0, 'ninguna de estas peticiones llegó al proveedor')
  assert.equal(await prisma.identidadIntento.count({ where: { userId: p.id } }), 0)
})

test('1e · PROVEEDOR CAÍDO: la persona recibe «inténtalo en un momento», el intento queda para reintentar y al volver se completa', async () => {
  const p = await persona('caido')
  await consentir(p.id)
  dd.caidas = 1
  const r = await iniciarSesionDeVerificacion(p.id, { canal: 'movil_hospedado' })
  assert.deepEqual([r.ok, !r.ok && r.motivo, !r.ok && r.reintentarEnSegundos], [false, 'proveedor_no_disponible', 30])
  const intento = await prisma.identidadIntento.findFirstOrThrow({ where: { userId: p.id } })
  assert.deepEqual([intento.estado, intento.referenciaProveedorSellada], ['creada', null], 'sin sesión, nada sellado')

  const ok = await iniciarSesionDeVerificacion(p.id, { canal: 'movil_hospedado' })
  assert.deepEqual([ok.ok, ok.ok && ok.intentoId], [true, intento.id], 'el mismo intento, ahora con sesión')
  assert.equal((await intentoDe(intento.id)).estado, 'iniciada')
})

test('1f · si el proveedor RECHAZA la petición (clave inválida) no se reintenta y no se inventa una sesión', async () => {
  const p = await persona('rech401')
  await consentir(p.id)
  dd.siempre = 401
  try {
    const r = await iniciarSesionDeVerificacion(p.id, { canal: 'web' })
    assert.deepEqual([r.ok, !r.ok && r.motivo], [false, 'proveedor_rechazo'])
  } finally {
    dd.siempre = null
  }
  assert.equal((await prisma.identidadIntento.findFirstOrThrow({ where: { userId: p.id } })).referenciaProveedorSellada, null)
})

// ── 2 · El aviso: autenticidad ──────────────────────────────────────────────

test('2 · UN AVISO SIN FIRMA, CON FIRMA MALA O VIEJO no mueve nada: 401 y cero escrituras ni llamadas al proveedor', async () => {
  const { p, intentoId } = await conSesion('auten')
  const s = dd.aprobar(intentoId)
  const antes = await prisma.identidadEventoExterno.count()
  dd.reiniciarLlamadas()

  const bueno = avisoFirmado(s)
  const sinFirma = { ...bueno, cabeceras: {} as Record<string, string | null> }
  const otraFirma = avisoFirmado(s, { secreto: 'otro-secreto-completamente-distinto-1' })
  const viejo = avisoFirmado(s, { instante: new Date(Date.now() - 10 * MIN) })
  const alterado = { ...bueno, cuerpoCrudo: bueno.cuerpoCrudo.replace('Approved', 'Declined') }
  for (const [nombre, a] of Object.entries({ sinFirma, otraFirma, viejo, alterado })) {
    const r = await recibirAvisoDeProveedor({ proveedor: 'didit', cuerpoCrudo: a.cuerpoCrudo, cabeceras: a.cabeceras })
    assert.equal(r.status, 401, nombre)
    assert.equal(r.despues, undefined, nombre)
    assert.deepEqual(r.body, { error: 'No autorizado.' }, 'el cuerpo no explica por qué')
  }
  assert.equal(await prisma.identidadEventoExterno.count(), antes, 'nada entró a la bandeja')
  assert.equal(dd.llamadas.length, 0, 'ni se le preguntó nada al proveedor')
  assert.equal((await intentoDe(intentoId)).estado, 'iniciada')
  assert.equal(await verifDe(p.id), null)
})

test('2b · la ruta es de Didit y exige secreto configurado: otro proveedor o sin secreto, 404; cuerpo gigante, 413', async () => {
  const { intentoId } = await conSesion('ruta')
  const a = avisoFirmado(dd.sesionDe(intentoId))
  assert.equal((await recibirAvisoDeProveedor({ proveedor: 'otro', cuerpoCrudo: a.cuerpoCrudo, cabeceras: a.cabeceras })).status, 404)
  delete process.env.DIDIT_WEBHOOK_SECRET
  try {
    assert.equal((await recibirAvisoDeProveedor({ proveedor: 'didit', cuerpoCrudo: a.cuerpoCrudo, cabeceras: a.cabeceras })).status, 404)
  } finally {
    process.env.DIDIT_WEBHOOK_SECRET = SECRETO
  }
  const enorme = JSON.stringify({ relleno: 'x'.repeat(600 * 1024) })
  assert.equal((await recibirAvisoDeProveedor({ proveedor: 'didit', cuerpoCrudo: enorme, cabeceras: a.cabeceras })).status, 413)
  const sinForma = avisoFirmado(dd.sesionDe(intentoId), { eventoId: ' ' })
  assert.equal((await recibirAvisoDeProveedor({ proveedor: 'didit', cuerpoCrudo: sinForma.cuerpoCrudo, cabeceras: sinForma.cabeceras })).status, 400)
})

test('2c · la ROTACIÓN del secreto: un aviso firmado con el anterior sigue valiendo mientras convivan', async () => {
  const { intentoId } = await conSesion('rota')
  const s = dd.poner(intentoId, 'In Progress')
  const anteriorSecreto = `secreto-anterior-sintetico-${sufijo}`.padEnd(32, 'y')
  const a = avisoFirmado(s, { estado: 'In Progress', secreto: anteriorSecreto })
  assert.equal((await recibirAvisoDeProveedor({ proveedor: 'didit', cuerpoCrudo: a.cuerpoCrudo, cabeceras: a.cabeceras })).status, 401)
  process.env.DIDIT_WEBHOOK_SECRET_ANTERIOR = anteriorSecreto
  try {
    assert.equal((await recibirAvisoDeProveedor({ proveedor: 'didit', cuerpoCrudo: a.cuerpoCrudo, cabeceras: a.cabeceras })).status, 200)
  } finally {
    delete process.env.DIDIT_WEBHOOK_SECRET_ANTERIOR
  }
})

// ── 3 · Aprobar: procesar y purgar ──────────────────────────────────────────

test('3 · APROBADO: el resultado se guarda y SOLO DESPUÉS se borra la sesión del proveedor; el aviso queda procesado y sin datos', async () => {
  const { p, intentoId } = await conSesion('apr')
  const cedula = `001-${sufijo}-APR`
  const s = dd.aprobar(intentoId, { cedula })
  const a = avisoFirmado(s)
  dd.reiniciarLlamadas()

  const respuesta = await recibirAvisoDeProveedor({ proveedor: 'didit', cuerpoCrudo: a.cuerpoCrudo, cabeceras: a.cabeceras })
  assert.equal(respuesta.status, 200)
  assert.ok(respuesta.despues, 'el procesamiento va DESPUÉS de responder')
  assert.equal(dd.llamadas.length, 0, 'al responder todavía no se ha llamado al proveedor')
  assert.equal((await evento(a.cuerpo.event_id))?.estado, 'recibido', 'el aviso ya está guardado')
  await respuesta.despues!()

  const fila = await intentoDe(intentoId)
  const v = await verifDe(p.id)
  assert.deepEqual([fila.estado, v?.estado, v?.nivel, v?.proveedor], ['aprobada', 'verificada', 'documento_selfie', 'didit'])
  assert.ok(v?.hashDedupe && v.hashDedupe.length === 64, 'quedó el hash del documento')
  assert.ok(v?.expiraEn)
  // Orden de las llamadas: primero se pregunta la verdad, luego se borra.
  assert.deepEqual(dd.llamadas.map((l) => `${l.metodo} ${l.ruta.replace(s.id, '{id}')}`), ['GET /v3/session/{id}/decision/', 'DELETE /v3/session/{id}/delete/'])
  const borrado = dd.llamadas[1].cuerpo
  assert.deepEqual([borrado?.deletion_instruction, borrado?.retain_face_embeddings, borrado?.instruction_id], ['operational_session_delete', false, intentoId])
  assert.ok(dd.sesiones.get(s.id)?.borrada)
  assert.ok(fila.purgadoAt, 'queda dicho cuándo se borró')
  assert.equal((await asientos(p.id, 'IDENTIDAD_SESION_PURGADA')).length, 1)
  assert.equal((await asientos(p.id, 'IDENTIDAD_VERIFICACION_APROBADA')).length, 1)

  const e = await evento(a.cuerpo.event_id)
  assert.deepEqual([e?.estado, e?.tipo, e?.estadoExterno, e?.intentoId, e?.intentosDeProceso], ['procesado', 'status.updated', 'Approved', intentoId, 1])
  assert.match(e?.payloadHash ?? '', /^[0-9a-f]{64}$/)

  // NADA del documento ni de la sesión en ninguna tabla de identidad ni en la bitácora.
  const todo = JSON.stringify([
    await prisma.$queryRawUnsafe('select * from identidad_intentos'),
    await prisma.$queryRawUnsafe('select * from identidad_verificaciones'),
    await prisma.$queryRawUnsafe('select * from identidad_eventos_externos'),
    await prisma.$queryRawUnsafe(`select * from audit_logs where "entidadTipo" = 'IdentidadVerificacion'`),
  ])
  assert.ok(!todo.includes(cedula), 'el número de la cédula no está en ninguna parte')
  assert.ok(!todo.includes('NO-DEBE-GUARDARSE'), 'el cuerpo del aviso tampoco')
  assert.ok(!todo.includes(s.id), 'ni el id de la sesión en claro')
})

test('3b · UN FLUJO SIN PRUEBA DE VIDA NO ACREDITA: va a revisión y la sesión NO se borra (la mira una persona)', async () => {
  const { p, intentoId } = await conSesion('incompleto')
  const s = dd.aprobar(intentoId, { completa: false })
  await recibir(avisoFirmado(s))
  const fila = await intentoDe(intentoId)
  assert.deepEqual([fila.estado, fila.codigoRazon, fila.purgadoAt], ['en_revision', 'FLUJO_INCOMPLETO', null])
  assert.equal(await verifDe(p.id), null)
  assert.ok(!dd.sesiones.get(s.id)?.borrada, 'la evidencia sigue donde la persona de revisión pueda verla')
})

test('3c · RECHAZADO: reintentable con el motivo en español, y la sesión se borra también', async () => {
  const { p, intentoId } = await conSesion('rechazo')
  const s = dd.poner(intentoId, 'Declined', ['LOW_FACE_MATCH_SIMILARITY'])
  await recibir(avisoFirmado(s, { estado: 'Declined' }))
  const fila = await intentoDe(intentoId)
  assert.deepEqual([fila.estado, fila.tipoRechazo, fila.codigoRazon], ['rechazada_reintentable', 'reintentable', 'ROSTRO_NO_COINCIDE'])
  assert.ok(fila.purgadoAt && dd.sesiones.get(s.id)?.borrada)
  assert.equal(await verifDe(p.id), null)
  assert.match((await estadoDeIdentidadDe(p.id)).ultimoRechazo?.mensaje ?? '', /selfie no coincide/)
})

test('3d · RECHAZO POR ATAQUE: definitivo, el motivo no sale de MEMBEGO y tampoco se queda la sesión', async () => {
  const { p, intentoId } = await conSesion('ataque')
  const s = dd.poner(intentoId, 'Declined', ['LIVENESS_FACE_ATTACK', 'LOW_LIVENESS_SCORE'])
  await recibir(avisoFirmado(s, { estado: 'Declined' }))
  const fila = await intentoDe(intentoId)
  assert.deepEqual([fila.estado, fila.codigoRazon], ['rechazada_definitiva', 'SOSPECHA_DE_FRAUDE'])
  const e = await estadoDeIdentidadDe(p.id)
  assert.deepEqual([e.ultimoRechazo?.reintentable, e.ultimoRechazo?.codigo, e.puedeIniciar], [false, null, false])
  assert.doesNotMatch(JSON.stringify(e), /LIVENESS|FRAUDE|ATTACK/i)
  assert.ok(fila.purgadoAt)
})

// ── 4 · «Fetch the truth» ───────────────────────────────────────────────────

test('4 · LO QUE DICE EL AVISO NO MANDA: un aviso «Approved» con el proveedor diciendo «Declined» NO acredita a nadie', async () => {
  const { p, intentoId } = await conSesion('mentira')
  const s = dd.poner(intentoId, 'Declined', ['DOCUMENT_EXPIRED'])
  await recibir(avisoFirmado(s, { estado: 'Approved' }))
  const fila = await intentoDe(intentoId)
  assert.deepEqual([fila.estado, fila.codigoRazon], ['rechazada_reintentable', 'DOCUMENTO_VENCIDO'])
  assert.equal(await verifDe(p.id), null)
})

test('4b · y al revés: un aviso «Declined» con el proveedor diciendo «Approved» resuelve como lo dice el proveedor', async () => {
  const { p, intentoId } = await conSesion('verdad')
  const s = dd.aprobar(intentoId)
  await recibir(avisoFirmado(s, { estado: 'Declined' }))
  assert.equal((await verifDe(p.id))?.estado, 'verificada')
})

test('4c · SI LA RESPUESTA NO LLEVA NUESTRA REFERENCIA, se descarta con asiento y no se aplica nada', async () => {
  const { p, intentoId } = await conSesion('ajena')
  const s = dd.aprobar(intentoId)
  s.vendorData = 'otro-intento-que-no-es-este' // el proveedor devuelve la decisión de otra cosa
  const a = avisoFirmado({ id: s.id, vendorData: intentoId })
  const r = await recibir(a)
  assert.equal(r.status, 200)
  assert.deepEqual([(await intentoDe(intentoId)).estado, await verifDe(p.id)], ['iniciada', null])
  assert.deepEqual([(await evento(a.cuerpo.event_id))?.estado, (await evento(a.cuerpo.event_id))?.detalle], ['ignorado', 'referencia_no_coincide'])
  assert.equal((await asientos(p.id, 'IDENTIDAD_EVENTO_DESCARTADO')).length, 1)
  assert.ok(!s.borrada, 'no se borró nada')
})

test('4d · un aviso que NOMBRA OTRA SESIÓN que la guardada no se procesa (ni siquiera se le pregunta al proveedor)', async () => {
  const { p, intentoId } = await conSesion('sesion-ajena')
  const s = dd.aprobar(intentoId)
  dd.reiniciarLlamadas()
  const a = avisoFirmado(s, { sesionId: randomUUID() })
  const r = await recibirAvisoDeProveedor({ proveedor: 'didit', cuerpoCrudo: a.cuerpoCrudo, cabeceras: a.cabeceras })
  assert.deepEqual([r.status, r.despues, r.body.descartado], [200, undefined, true])
  assert.equal(dd.llamadas.length, 0)
  assert.deepEqual([(await evento(a.cuerpo.event_id))?.estado, (await evento(a.cuerpo.event_id))?.detalle], ['ignorado', 'sesion_no_coincide'])
  assert.equal((await asientos(p.id, 'IDENTIDAD_EVENTO_DESCARTADO')).length, 1)
  assert.equal((await intentoDe(intentoId)).estado, 'iniciada')
})

// ── 5 · Idempotencia, simultaneidad, orden ──────────────────────────────────

test('5 · EL MISMO AVISO DOS VECES: la segunda es un duplicado y no vuelve a procesarse', async () => {
  const { p, intentoId } = await conSesion('dup')
  const s = dd.aprobar(intentoId)
  const a = avisoFirmado(s)
  await recibir(a)
  dd.reiniciarLlamadas()
  const segunda = await recibirAvisoDeProveedor({ proveedor: 'didit', cuerpoCrudo: a.cuerpoCrudo, cabeceras: a.cabeceras })
  assert.deepEqual([segunda.status, segunda.body.duplicado, segunda.despues], [200, true, undefined])
  assert.equal(dd.llamadas.length, 0)
  assert.equal(await prisma.identidadEventoExterno.count({ where: { eventoExternoId: a.cuerpo.event_id } }), 1)
  assert.equal((await asientos(p.id, 'IDENTIDAD_VERIFICACION_APROBADA')).length, 1)
})

test('5b · SEIS ENTREGAS SIMULTÁNEAS del mismo aviso: una fila, una verificación, un asiento, y la sesión borrada', async () => {
  const { p, intentoId } = await conSesion('simul')
  const s = dd.aprobar(intentoId)
  const a = avisoFirmado(s)
  const respuestas = await Promise.all(
    Array.from({ length: 6 }, async () => {
      const r = await recibirAvisoDeProveedor({ proveedor: 'didit', cuerpoCrudo: a.cuerpoCrudo, cabeceras: a.cabeceras })
      if (r.despues) await r.despues()
      return r.status
    })
  )
  assert.deepEqual(respuestas, [200, 200, 200, 200, 200, 200])
  assert.equal(await prisma.identidadEventoExterno.count({ where: { eventoExternoId: a.cuerpo.event_id } }), 1)
  assert.equal(await prisma.identidadVerificacion.count({ where: { userId: p.id } }), 1)
  assert.equal((await asientos(p.id, 'IDENTIDAD_VERIFICACION_APROBADA')).length, 1)
  assert.equal((await asientos(p.id, 'IDENTIDAD_SESION_PURGADA')).length, 1, 'se anota una sola vez aunque el proveedor reciba más de un borrado')
  assert.ok(dd.sesiones.get(s.id)?.borrada)
})

test('5c · un aviso PENDIENTE que el proveedor reenvía se reprocesa (si el primero se perdió a medio camino)', async () => {
  const { p, intentoId } = await conSesion('reenvia')
  const s = dd.aprobar(intentoId)
  const a = avisoFirmado(s)
  const primera = await recibirAvisoDeProveedor({ proveedor: 'didit', cuerpoCrudo: a.cuerpoCrudo, cabeceras: a.cabeceras })
  assert.ok(primera.despues) // …pero el proceso murió antes de ejecutarlo
  assert.equal((await evento(a.cuerpo.event_id))?.estado, 'recibido')
  const segunda = await recibirAvisoDeProveedor({ proveedor: 'didit', cuerpoCrudo: a.cuerpoCrudo, cabeceras: a.cabeceras })
  assert.equal(segunda.body.duplicado, undefined, 'no es un duplicado ya resuelto')
  assert.ok(segunda.despues, 'se vuelve a programar el procesamiento')
  await segunda.despues!()
  assert.equal((await verifDe(p.id))?.estado, 'verificada')
})

test('5d · UN AVISO TARDÍO no deshace una aprobación (un «En progreso» viejo llega después del «Approved»)', async () => {
  const { p, intentoId } = await conSesion('tarde')
  const s = dd.aprobar(intentoId)
  await recibir(avisoFirmado(s))
  assert.equal((await verifDe(p.id))?.estado, 'verificada')
  // El proveedor ya borró la sesión, así que un aviso rezagado no encuentra nada que consultar: no cambia nada.
  await recibir(avisoFirmado(s, { estado: 'In Progress' }))
  assert.equal((await intentoDe(intentoId)).estado, 'aprobada')
  assert.equal((await verifDe(p.id))?.estado, 'verificada')
})

test('5e · otros tipos de aviso y avisos de un intento desconocido se registran y se ignoran, sin romper nada', async () => {
  const { intentoId } = await conSesion('otros')
  const s = dd.sesionDe(intentoId)
  const datos = avisoFirmado(s, { tipo: 'data.updated' })
  assert.equal((await recibir(datos)).status, 200)
  assert.deepEqual([(await evento(datos.cuerpo.event_id))?.estado, (await evento(datos.cuerpo.event_id))?.detalle], ['ignorado', 'tipo_no_relevante'])

  const desconocido = avisoFirmado({ id: randomUUID(), vendorData: 'intento-que-no-existe-xyz' })
  assert.equal((await recibir(desconocido)).status, 200)
  assert.deepEqual([(await evento(desconocido.cuerpo.event_id))?.estado, (await evento(desconocido.cuerpo.event_id))?.detalle], ['ignorado', 'intento_desconocido'])
})

test('5f · EL AVISO SE ADELANTA al guardado de la sesión: queda pendiente y el barrido lo resuelve cuando ya está', async () => {
  const p = await persona('adelanto')
  await consentir(p.id)
  const creado = await crearIntento(p.id, { canal: 'movil_hospedado' })
  assert.equal(creado.ok, true)
  if (!creado.ok) return
  const intentoId = creado.intento.id
  // El proveedor ya tiene la sesión (el aviso llega pronto), pero MEMBEGO todavía no la guardó.
  const respuesta = await dd.manejar('https://verification.didit.me/v3/session/', { method: 'POST', body: JSON.stringify({ vendor_data: intentoId, callback: 'x' }), headers: {} })
  const sesion = (await respuesta.json()) as { session_id: string }
  const s = dd.aprobar(intentoId)
  const a = avisoFirmado(s)
  await recibir(a)
  assert.deepEqual([(await evento(a.cuerpo.event_id))?.estado, (await evento(a.cuerpo.event_id))?.detalle], ['fallido', 'sin_sesion_aun'])
  assert.equal(await verifDe(p.id), null)

  await guardarReferenciaDeSesion(intentoId, sesion.session_id)
  const r = await reintentarEventosPendientes({ ahora: new Date(Date.now() + 2 * MIN) })
  assert.ok(r.procesados >= 1)
  assert.equal((await evento(a.cuerpo.event_id))?.estado, 'procesado')
  assert.equal((await verifDe(p.id))?.estado, 'verificada')
})

test('5g · SI EL PROVEEDOR FALLA al procesar, el aviso queda «fallido» (con causa) y el reintento lo termina; un aviso que no se puede procesar nunca se reintenta sin fin', async () => {
  const { p, intentoId } = await conSesion('falla')
  const s = dd.aprobar(intentoId)
  const a = avisoFirmado(s)
  dd.caidas = 1
  await recibir(a)
  let e = await evento(a.cuerpo.event_id)
  assert.deepEqual([e?.estado, e?.detalle, e?.intentosDeProceso], ['fallido', 'proveedor_no_disponible', 1])
  assert.equal(await verifDe(p.id), null)

  const r = await reintentarEventosPendientes({ ahora: new Date(Date.now() + 2 * MIN) })
  assert.ok(r.procesados >= 1)
  e = await evento(a.cuerpo.event_id)
  assert.deepEqual([e?.estado, e?.intentosDeProceso], ['procesado', 2])
  assert.equal((await verifDe(p.id))?.estado, 'verificada')

  // Tope de reintentos: pasado el máximo queda fallido para que lo mire una persona.
  const otro = await conSesion('agotado')
  const s2 = dd.aprobar(otro.intentoId)
  const b = avisoFirmado(s2)
  await recibir(b)
  await prisma.identidadEventoExterno.updateMany({ where: { eventoExternoId: b.cuerpo.event_id }, data: { estado: 'fallido', intentosDeProceso: 50 } })
  const fila = await evento(b.cuerpo.event_id)
  assert.equal(await procesarEvento(fila!.id), 'agotado')
  assert.equal((await evento(b.cuerpo.event_id))?.detalle, 'reintentos_agotados')
})

// ── 6 · Revisión y duplicados por la vía del proveedor ──────────────────────

test('6 · EN REVISIÓN: el proveedor la deja en manos de una persona, la sesión se conserva y, si luego la aprueba, se acredita y se borra', async () => {
  const { p, intentoId } = await conSesion('revision')
  const s = dd.poner(intentoId, 'In Review', ['LOW_FACE_MATCH_SIMILARITY'])
  await recibir(avisoFirmado(s, { estado: 'In Review' }))
  const fila = await intentoDe(intentoId)
  assert.deepEqual([fila.estado, fila.codigoRazon, fila.purgadoAt], ['en_revision', 'ROSTRO_NO_COINCIDE', null])
  assert.ok(!s.borrada, 'la evidencia se queda hasta que se decida')
  assert.equal(await verifDe(p.id), null)

  dd.aprobar(intentoId)
  await recibir(avisoFirmado(s))
  assert.equal((await intentoDe(intentoId)).estado, 'aprobada')
  assert.equal((await verifDe(p.id))?.estado, 'verificada')
  assert.ok(s.borrada)
})

test('6b · EL MISMO DOCUMENTO EN DOS CUENTAS por la vía del proveedor: la segunda va a revisión, conserva su sesión y la reconciliación no insiste', async () => {
  const cedula = `002-${sufijo}-DUP`
  const a = await conSesion('doc1')
  await recibir(avisoFirmado(dd.aprobar(a.intentoId, { cedula })))
  assert.equal((await verifDe(a.p.id))?.estado, 'verificada')

  const b = await conSesion('doc2')
  const sb = dd.aprobar(b.intentoId, { cedula })
  await recibir(avisoFirmado(sb))
  const fila = await intentoDe(b.intentoId)
  assert.deepEqual([fila.estado, fila.codigoRazon, fila.purgadoAt], ['en_revision', 'IDENTIDAD_DUPLICADA', null])
  assert.equal(await verifDe(b.p.id), null, 'la segunda cuenta NO queda verificada')
  assert.ok(!sb.borrada)

  dd.reiniciarLlamadas()
  await reconciliarConElProveedor({ ahora: new Date(Date.now() + 30 * MIN) })
  assert.equal(dd.llamadas.filter((l) => l.ruta.includes(sb.id)).length, 0, 'un duplicado espera a una persona: no se le pregunta al proveedor')
})

// ── 7 · Reconciliación ──────────────────────────────────────────────────────

test('7 · AVISO PERDIDO: la persona que sondea su estado lo resuelve sin esperar al barrido, y no se le pregunta al proveedor más de una vez cada 15 s', async () => {
  const { p, intentoId } = await conSesion('perdido')
  const s = dd.aprobar(intentoId) // el proveedor aprobó, pero el aviso nunca llegó
  assert.equal((await verifDe(p.id)), null)
  dd.reiniciarLlamadas()

  const e1 = await consultarEstadoConReconciliacion(p.id)
  assert.deepEqual([e1.estado, e1.nivel], ['verificada', 'documento_selfie'])
  assert.equal(dd.cuantas('GET', '/decision/'), 1)
  assert.ok(s.borrada, 'también se purgó')
  assert.ok((await intentoDe(intentoId)).ultimaConsultaAt)
})

test('7b · el enfriamiento: con un intento abierto consultado hace pocos segundos NO se vuelve a llamar al proveedor', async () => {
  const { p, intentoId } = await conSesion('enfria')
  dd.poner(intentoId, 'In Progress')
  dd.reiniciarLlamadas()
  const ahora = new Date()
  await consultarEstadoConReconciliacion(p.id, ahora)
  await consultarEstadoConReconciliacion(p.id, new Date(ahora.getTime() + 5_000))
  assert.equal(dd.cuantas('GET', '/decision/'), 1)
  await consultarEstadoConReconciliacion(p.id, new Date(ahora.getTime() + 20_000))
  assert.equal(dd.cuantas('GET', '/decision/'), 2)
  assert.equal((await intentoDe(intentoId)).estado, 'en_proceso')
})

test('7c · si el proveedor falla al consultar el estado, la persona igual ve su estado (la lectura nunca se rompe)', async () => {
  const { p, intentoId } = await conSesion('lee')
  dd.poner(intentoId, 'In Progress')
  dd.caidas = 1
  const e = await consultarEstadoConReconciliacion(p.id, new Date(Date.now() + MIN))
  assert.equal(e.estado, 'no_verificada')
  assert.deepEqual(e.intentoAbierto && [e.intentoAbierto.id, e.intentoAbierto.estado], [intentoId, 'iniciada'])
})

test('7d · EL BARRIDO: resuelve los intentos con rato sin novedad, no toca los recientes y reintenta los borrados pendientes', async () => {
  const viejo = await conSesion('barrido-viejo')
  const reciente = await conSesion('barrido-reciente')
  const sinBorrar = await conSesion('barrido-purga')
  dd.aprobar(viejo.intentoId)
  dd.aprobar(reciente.intentoId)
  const sesionSinBorrar = dd.aprobar(sinBorrar.intentoId)
  await prisma.identidadIntento.update({ where: { id: viejo.intentoId }, data: { creadoAt: new Date(Date.now() - 30 * MIN) } })

  // Un intento que se aprobó en MEMBEGO pero cuyo borrado cayó (el proveedor se cayó justo ahí).
  const original = dd.manejar
  let llamada = 0
  globalThis.fetch = (async (e: string | URL | Request, i?: RequestInit) => {
    llamada++
    return llamada === 2 ? new Response('caido', { status: 503 }) : original(e, i)
  }) as typeof fetch
  try {
    assert.deepEqual(await sincronizarIntento(sinBorrar.intentoId), { resultado: 'sincronizado', estado: 'aprobada', purga: 'pendiente' })
  } finally {
    globalThis.fetch = dd.manejar as typeof fetch
  }
  assert.deepEqual([(await intentoDe(sinBorrar.intentoId)).purgadoAt, sesionSinBorrar.borrada], [null, false])

  dd.reiniciarLlamadas()
  const resumen = await reconciliarConElProveedor({ ahora: new Date() })
  assert.equal((await intentoDe(viejo.intentoId)).estado, 'aprobada', 'el viejo se resolvió')
  assert.equal((await verifDe(viejo.p.id))?.estado, 'verificada')
  assert.equal((await intentoDe(reciente.intentoId)).estado, 'iniciada', 'el reciente (menos de 5 min) no se tocó')
  assert.equal(dd.llamadas.filter((l) => l.ruta.includes(dd.sesionDe(reciente.intentoId).id)).length, 0, 'ni se le preguntó al proveedor por él')
  assert.ok((await intentoDe(sinBorrar.intentoId)).purgadoAt, 'el borrado pendiente se reintentó')
  assert.ok(sesionSinBorrar.borrada)
  assert.ok(resumen.consultados >= 1 && resumen.purgasReintentadas >= 1)
})

test('7e · el barrido no lanza si el proveedor se cae: cuenta el fallo y sigue', async () => {
  const x = await conSesion('barrido-caido')
  dd.poner(x.intentoId, 'In Progress')
  await prisma.identidadIntento.update({ where: { id: x.intentoId }, data: { creadoAt: new Date(Date.now() - 30 * MIN) } })
  dd.caidas = 1
  const resumen = await reconciliarConElProveedor({ ahora: new Date() })
  assert.ok(resumen.fallosDelProveedor >= 1)
  assert.equal((await intentoDe(x.intentoId)).estado, 'iniciada')
  // Y sin proveedor configurado no hace nada y no lanza.
  delete process.env.DIDIT_API_KEY
  try {
    assert.deepEqual(await reconciliarConElProveedor({ ahora: new Date() }), { consultados: 0, cerrados: 0, purgasReintentadas: 0, purgasPendientes: 0, fallosDelProveedor: 0 })
  } finally {
    process.env.DIDIT_API_KEY = API_KEY
  }
})

test('7f · UN BORRADO FALLIDO no tumba la aprobación: el resultado queda guardado y la purga queda pendiente', async () => {
  const { p, intentoId } = await conSesion('purga-falla')
  const s = dd.aprobar(intentoId)
  const antes = dd.llamadas.length
  // Se cae justo el borrado: la 1.ª llamada (decisión) funciona, la 2.ª (borrado) cae.
  const original = dd.manejar
  let llamada = 0
  globalThis.fetch = (async (e: string | URL | Request, i?: RequestInit) => {
    llamada++
    return llamada === 2 ? new Response('caido', { status: 503 }) : original(e, i)
  }) as typeof fetch
  try {
    await recibir(avisoFirmado(s))
  } finally {
    globalThis.fetch = dd.manejar as typeof fetch
  }
  assert.ok(dd.llamadas.length > antes)
  const fila = await intentoDe(intentoId)
  assert.deepEqual([fila.estado, fila.purgadoAt, fila.purgaIntentos], ['aprobada', null, 1])
  assert.equal((await verifDe(p.id))?.estado, 'verificada', 'la persona ya está verificada')
  assert.ok(!s.borrada)
  assert.equal(await purgarSesionDeIntento(intentoId), 'purgada', 'el reintento lo termina')
  assert.equal(await purgarSesionDeIntento(intentoId), 'ya_purgada')
})

// ── 8 · Supresión y eliminación de cuenta ───────────────────────────────────

test('8 · SUPRESIÓN: solo el equipo y con motivo; borra TODAS las sesiones en el proveedor (con privacy_erasure) y solo entonces lo local, dejando el rastro', async () => {
  const { p, intentoId } = await conSesion('supr', { divulgacion: true })
  const s = dd.aprobar(intentoId)
  await recibir(avisoFirmado(s))
  assert.equal((await verifDe(p.id))?.estado, 'verificada')
  const otro: ActorDeIdentidad = { userId: (await persona('cli')).id, rol: 'CLIENTE' }
  await assert.rejects(() => suprimirIdentidadDePersona(otro, p.id, 'quiero'), (e: unknown) => e instanceof ErrorDeIdentidad && e.codigo === 'no_autorizado')
  await assert.rejects(() => suprimirIdentidadDePersona(staff, p.id, '  '), (e: unknown) => e instanceof ErrorDeIdentidad && e.codigo === 'motivo_requerido')
  await assert.rejects(() => suprimirIdentidadDePersona(staff, 'no-existe', 'caso'), (e: unknown) => e instanceof ErrorDeIdentidad && e.codigo === 'persona_no_encontrada')
  assert.equal((await verifDe(p.id))?.estado, 'verificada', 'nada de lo anterior borró algo')

  dd.reiniciarLlamadas()
  s.borrada = false // para que el borrado de supresión se vea (la purga operativa ya lo había borrado)
  const r = await suprimirIdentidadDePersona(staff, p.id, 'Solicitud de la persona, ticket 77')
  assert.deepEqual(r, { sesionesBorradas: 1, intentosAnonimizados: 1 })
  const del = dd.llamadas.find((l) => l.metodo === 'DELETE')
  assert.equal(del?.cuerpo?.deletion_instruction, 'privacy_erasure', 'purga además las plantillas biométricas')
  const usuarios = dd.llamadas.find((l) => l.ruta === '/v3/users/delete/')
  assert.deepEqual(usuarios?.cuerpo, { vendor_data_list: [intentoId] })

  assert.equal(await verifDe(p.id), null, 'el resultado global se borró')
  const fila = await intentoDe(intentoId)
  assert.deepEqual([fila.referenciaProveedorSellada, fila.claveVersion, fila.codigoRazon, fila.verificacionId], [null, null, null, null])
  assert.ok(fila.estado, 'el intento queda (sin datos): estado y fechas')
  assert.ok((await prisma.identidadConsentimiento.count({ where: { userId: p.id } })) >= 3, 'el registro de consentimientos se conserva: es la prueba de lo aceptado')
  assert.equal((await asientos(p.id, 'IDENTIDAD_SUPRESION_SOLICITADA')).length, 1)
  assert.equal((await asientos(p.id, 'IDENTIDAD_SUPRESION_COMPLETADA')).length, 1)
  assert.equal((await estadoDeIdentidadDe(p.id)).estado, 'no_verificada')
  // Y las empresas dejan de ver la insignia.
  assert.deepEqual(await proyectarEnFichas(p.id), { actualizadas: 0, visible: false })
})

test('8b · SI EL PROVEEDOR NO CONFIRMA el borrado, NO se borra nada local: la solicitud queda abierta y se repite sin problema', async () => {
  const { p, intentoId } = await conSesion('supr-falla')
  await recibir(avisoFirmado(dd.aprobar(intentoId)))
  dd.caidas = 1
  await assert.rejects(
    () => suprimirIdentidadDePersona(staff, p.id, 'ticket 78'),
    (e: unknown) => e instanceof ErrorDeIdentidad && e.codigo === 'proveedor_no_disponible'
  )
  assert.equal((await verifDe(p.id))?.estado, 'verificada', 'el resultado local sigue ahí: sin confirmación del proveedor no se pierde cómo encontrar sus datos')
  assert.notEqual((await intentoDe(intentoId)).referenciaProveedorSellada, null)
  assert.equal((await asientos(p.id, 'IDENTIDAD_SUPRESION_SOLICITADA')).length, 1)
  assert.equal((await asientos(p.id, 'IDENTIDAD_SUPRESION_COMPLETADA')).length, 0)

  const r = await suprimirIdentidadDePersona(staff, p.id, 'ticket 78 (reintento)')
  assert.equal(r.intentosAnonimizados, 1)
  assert.equal(await verifDe(p.id), null)
  assert.equal((await asientos(p.id, 'IDENTIDAD_SUPRESION_COMPLETADA')).length, 1)
  // Repetirla cuando ya no queda nada no rompe.
  assert.deepEqual(await suprimirIdentidadDePersona(staff, p.id, 'otra vez'), { sesionesBorradas: 0, intentosAnonimizados: 1 })
})

test('8c · ELIMINAR UNA CUENTA: antes de borrar nada se borran sus datos en el proveedor; si el proveedor falla, se BLOQUEA con un mensaje claro', async () => {
  const { p, intentoId } = await conSesion('elimina')
  const s = dd.poner(intentoId, 'In Progress') // sesión viva en el proveedor (la persona dejó la verificación a medias)
  dd.caidas = 1
  const bloqueo = await bloqueoPorIdentidadPendiente(p.id)
  assert.match(bloqueo ?? '', /No se eliminó nada/)
  assert.ok(!s.borrada)
  assert.ok(await prisma.user.findUnique({ where: { id: p.id } }), 'la persona sigue existiendo')

  assert.equal(await bloqueoPorIdentidadPendiente(p.id), null, 'con el proveedor de vuelta se puede seguir')
  assert.ok(s.borrada)
  // El borrado de la cuenta se lleva en cascada el rastro de identidad.
  await prisma.user.delete({ where: { id: p.id } })
  assert.equal(await prisma.identidadIntento.count({ where: { userId: p.id } }), 0)
})

test('8d · quien nunca verificó se elimina sin tocar al proveedor, aunque no esté configurado', async () => {
  const p = await persona('sin-nada')
  dd.reiniciarLlamadas()
  delete process.env.DIDIT_API_KEY
  delete process.env.DIDIT_WORKFLOW_ID
  try {
    assert.equal(await bloqueoPorIdentidadPendiente(p.id), null)
    assert.deepEqual(await borrarEnElProveedorLoDeLaPersona(p.id), { sesionesBorradas: 0 })
  } finally {
    process.env.DIDIT_API_KEY = API_KEY
    process.env.DIDIT_WORKFLOW_ID = '11111111-0000-0000-0000-000000000001'
  }
  assert.equal(dd.llamadas.length, 0)
})

test('8e · con datos en el proveedor y el proveedor SIN configurar, se bloquea (no se borra «a medias»); y una referencia que no abre falla cerrada', async () => {
  const { p, intentoId } = await conSesion('sin-config')
  dd.poner(intentoId, 'In Progress')
  delete process.env.DIDIT_API_KEY
  try {
    assert.match((await bloqueoPorIdentidadPendiente(p.id)) ?? '', /No se eliminó nada/)
  } finally {
    process.env.DIDIT_API_KEY = API_KEY
  }
  // Una referencia sellada con otra llave no se puede abrir: no se salta en silencio.
  const clavesBuenas = process.env.IDENTIDAD_CLAVES_MAESTRAS
  process.env.IDENTIDAD_CLAVES_MAESTRAS = `1:${randomBytes(32).toString('base64')}`
  try {
    await assert.rejects(() => bloqueoPorIdentidadPendiente(p.id), (e: unknown) => e instanceof ErrorDeIdentidad && e.codigo === 'sin_clave')
  } finally {
    process.env.IDENTIDAD_CLAVES_MAESTRAS = clavesBuenas
  }
})

// ── 9 · El cliente HTTP, aislado ────────────────────────────────────────────

const CONFIG = { apiKey: API_KEY, workflowId: 'wf-1', apiBase: 'https://verification.didit.me' }
const SESION_OK = '22222222-3333-4444-5555-666666666666'
const respuestaJson = (status: number, o: unknown) => new Response(JSON.stringify(o), { status })

test('9 · el cliente no sigue redirecciones, valida el id y el destino, y sus errores no llevan ni cuerpo ni dirección ni clave', async () => {
  const llamadas: { url: string; init?: RequestInit }[] = []
  let siguiente: () => Response = () => respuestaJson(201, { session_id: SESION_OK, url: 'https://verification.didit.me/session/TOKENSECRETO' })
  const cliente = crearProveedorDidit(CONFIG, {
    fetchFn: (async (u: string, init?: RequestInit) => {
      llamadas.push({ url: String(u), init })
      return siguiente()
    }) as typeof fetch,
    circuito: new Circuito({ umbralDeFallos: 100, enfriamientoMs: 1 }),
  })
  const ok = await cliente.crearSesion({ intentoId: 'i1', callbackUrl: 'membego://x', idioma: 'es' })
  assert.deepEqual(ok, { sesionId: SESION_OK, url: 'https://verification.didit.me/session/TOKENSECRETO' })
  assert.equal(llamadas[0].init?.redirect, 'manual')
  assert.equal((llamadas[0].init?.headers as Record<string, string>)['x-api-key'], API_KEY)
  assert.ok(llamadas[0].init?.signal, 'con tiempo máximo')

  // Una dirección que no es del proveedor, o que no es https, no se entrega a nadie.
  for (const url of ['https://evil.example.com/s/1', 'http://verification.didit.me/s/1', 'https://didit.me.evil.com/s', 'no-es-url']) {
    siguiente = () => respuestaJson(201, { session_id: SESION_OK, url })
    await assert.rejects(() => cliente.crearSesion({ intentoId: 'i1', callbackUrl: 'x', idioma: 'es' }), (e: unknown) => e instanceof ErrorDeProveedor && e.codigo === 'respuesta_invalida', url)
  }
  // Un id con forma de ruta no se interpola en la dirección.
  const n0 = llamadas.length
  await assert.rejects(() => cliente.consultarDecision('../../v3/users/delete'), (e: unknown) => e instanceof ErrorDeProveedor && e.codigo === 'respuesta_invalida')
  await assert.rejects(() => cliente.borrarSesion('a/b', { motivo: 'operacional', instruccionId: 'x' }), (e: unknown) => e instanceof ErrorDeProveedor)
  assert.equal(llamadas.length, n0, 'ni siquiera se hizo la llamada')

  // 3xx, 4xx y 5xx.
  siguiente = () => new Response('', { status: 302, headers: { location: 'http://169.254.169.254/' } })
  await assert.rejects(() => cliente.consultarDecision(SESION_OK), (e: unknown) => e instanceof ErrorDeProveedor && e.codigo === 'rechazado')
  siguiente = () => respuestaJson(403, { detail: 'TOKENSECRETO ' + API_KEY })
  const rechazo = await cliente.consultarDecision(SESION_OK).catch((e: unknown) => e)
  assert.ok(rechazo instanceof ErrorDeProveedor && rechazo.codigo === 'rechazado' && !rechazo.reintentable)
  siguiente = () => respuestaJson(500, { detail: 'TOKENSECRETO ' + API_KEY })
  const caida = await cliente.consultarDecision(SESION_OK).catch((e: unknown) => e)
  assert.ok(caida instanceof ErrorDeProveedor && caida.codigo === 'no_disponible' && caida.reintentable)
  for (const e of [rechazo, caida]) {
    assert.doesNotMatch((e as Error).message, /TOKENSECRETO|didit\.me|clave-didit/i, 'el mensaje no lleva cuerpo, dirección ni clave')
  }
  // Una caída de red (o un tiempo agotado) también es «no disponible».
  const sinRed = crearProveedorDidit(CONFIG, { fetchFn: (async () => { throw new Error('socket hang up ' + API_KEY) }) as typeof fetch, circuito: new Circuito() })
  const e = await sinRed.consultarDecision(SESION_OK).catch((x: unknown) => x)
  assert.ok(e instanceof ErrorDeProveedor && e.codigo === 'no_disponible')
  assert.doesNotMatch((e as Error).message, /clave-didit|socket/)
})

test('9b · borrar: 404 cuenta como «ya borrada»; las personas del proveedor se borran por la lista de referencias, y una lista vacía no llama', async () => {
  const llamadas: { url: string; init?: RequestInit }[] = []
  let estado = 200
  const cliente = crearProveedorDidit(CONFIG, {
    fetchFn: (async (u: string, init?: RequestInit) => {
      llamadas.push({ url: String(u), init })
      return respuestaJson(estado, { ok: true })
    }) as typeof fetch,
    circuito: new Circuito(),
  })
  assert.equal(await cliente.borrarSesion(SESION_OK, { motivo: 'supresion', instruccionId: 'tk-1' }), 'borrada')
  assert.equal(JSON.parse(String(llamadas[0].init?.body)).deletion_instruction, 'privacy_erasure')
  estado = 404
  assert.equal(await cliente.borrarSesion(SESION_OK, { motivo: 'operacional', instruccionId: 'tk-1' }), 'ya_borrada')
  await cliente.borrarUsuarios([])
  assert.equal(llamadas.length, 2)
  await cliente.borrarUsuarios(['a', 'b'])
  assert.deepEqual(JSON.parse(String(llamadas[2].init?.body)), { vendor_data_list: ['a', 'b'] })
  estado = 400
  await assert.rejects(() => cliente.borrarUsuarios(['a']), (e: unknown) => e instanceof ErrorDeProveedor && e.codigo === 'rechazado')
})

test('9c · EL INTERRUPTOR AUTOMÁTICO: tras cinco caídas seguidas las llamadas fallan AL INSTANTE sin tocar el proveedor, y se recupera', async () => {
  let t = 0
  let llamadas = 0
  let cae = true
  const circuito = new Circuito({ umbralDeFallos: 5, enfriamientoMs: 30_000 }, () => t)
  const cliente = crearProveedorDidit(CONFIG, {
    fetchFn: (async () => {
      llamadas++
      return cae ? new Response('x', { status: 503 }) : respuestaJson(200, { status: 'In Progress', vendor_data: 'i1' })
    }) as typeof fetch,
    circuito,
  })
  for (let i = 0; i < 5; i++) await cliente.consultarDecision(SESION_OK).catch(() => null)
  assert.equal(llamadas, 5)
  const rapido = await cliente.consultarDecision(SESION_OK).catch((e: unknown) => e)
  assert.ok(rapido instanceof ErrorDeProveedor && rapido.codigo === 'circuito_abierto' && rapido.reintentable)
  assert.equal(llamadas, 5, 'no se llamó al proveedor')

  t += 31_000
  cae = false
  const r = await cliente.consultarDecision(SESION_OK)
  assert.equal(r.decision.resultado, 'en_proceso')
  assert.equal(circuito.estado(), 'cerrado')
})

test('9d · NINGÚN LOG lleva la clave, la dirección con token ni el número del documento durante todo el camino (éxito y fallos)', async () => {
  const capturado: string[] = []
  const originales = { warn: console.warn, error: console.error }
  const capturar = (...a: unknown[]) => void capturado.push(a.map((x) => (x instanceof Error ? `${x.message}\n${x.stack}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' '))
  console.warn = capturar
  console.error = capturar
  const cedula = `003-${sufijo}-LOG`
  let tokenVisto = ''
  try {
    const { intentoId, url } = await conSesion('logs')
    tokenVisto = url.split('/').pop()!
    const s = dd.aprobar(intentoId, { cedula })
    dd.caidas = 1
    await recibir(avisoFirmado(s)) // falla una vez (503) y deja trazas
    await reintentarEventosPendientes({ ahora: new Date(Date.now() + 2 * MIN) })
    const mala = avisoFirmado(s, { secreto: 'otro-secreto-completamente-distinto-1' })
    await recibirAvisoDeProveedor({ proveedor: 'didit', cuerpoCrudo: mala.cuerpoCrudo, cabeceras: mala.cabeceras })
  } finally {
    console.warn = originales.warn
    console.error = originales.error
  }
  const todo = capturado.join('\n')
  assert.ok(todo.length > 0, 'hubo trazas que revisar')
  for (const secreto of [API_KEY, SECRETO, cedula, tokenVisto, CLAVES.split(':')[1], PEPPER]) {
    assert.ok(!todo.includes(secreto), `un log lleva «${secreto.slice(0, 12)}…»`)
  }
})
