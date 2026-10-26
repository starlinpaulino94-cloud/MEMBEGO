/**
 * VERIFICACIÓN DE IDENTIDAD · Fase 6 · la API de la app, probada por la RUTA (con sesión «real» de Supabase simulada) y el Didit falso.
 *
 * Las pruebas de la puerta ejercen el dominio; estas entran por donde entra una persona o un atacante: el manejador HTTP, con su
 * cabecera `Authorization`. Supabase se simula contestando a `/auth/v1/user` por token (así corre el mismo `getApiClientUser` de
 * producción) y el proveedor, con el Didit falso. Todo con datos sintéticos: ni un documento real.
 *
 * Cada prueba falla si vuelve el defecto que cierra:
 *   1 · una ruta atiende a quien no es un cliente con sesión válida (sin cabecera, token malo, administrador, superadmin);
 *   2 · una persona actúa sobre otra mandando su id (en el cuerpo, la ruta o un intento ajeno);
 *   3 · una respuesta saca la referencia del proveedor, el hash, el número de documento, o se guarda en caché;
 *   4 · una entrada mal formada rompe la ruta (500) o escribe algo;
 *   5 · el proveedor caído se convierte en un error opaco, o filtra su cuerpo, su dirección o la clave;
 *   6 · una ráfaga no se frena;
 *   7 · el aviso del proveedor se acepta sin firma, con otro método o sin tamaño razonable.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { prisma } from '../../src/lib/prisma'
import { cambiarInterruptorDeIdentidad, type ActorDeIdentidad } from '../../src/modules/identidad/identidad'
import { TEXTO_VERSION_BIOMETRIA, TEXTO_VERSION_TRANSFERENCIA } from '../../src/modules/identidad/identidadConsentimientosCore'
import { recibirAvisoDeProveedor } from '../../src/modules/identidad/eventos'
import { GET as estadoGET } from '../../src/app/api/v1/cliente/identidad/estado/route'
import { POST as sesionPOST } from '../../src/app/api/v1/cliente/identidad/sesion/route'
import { POST as consentimientosPOST } from '../../src/app/api/v1/cliente/identidad/consentimientos/route'
import { POST as incidenciasPOST } from '../../src/app/api/v1/cliente/identidad/incidencias/route'
import { POST as borradoPOST } from '../../src/app/api/v1/cliente/identidad/borrado/route'
import * as rutaWebhook from '../../src/app/api/webhooks/identidad/[proveedor]/route'
import { DiditFalso, crearAvisoFirmado } from './_helpers/didit-falso'

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const API_KEY = `clave-didit-sintetica-${sufijo}`
const SECRETO = `secreto-webhook-sintetico-${sufijo}`.padEnd(32, 'x')
const PEPPER = `pepper-de-prueba-${sufijo}-`.padEnd(40, 'x')
const avisoFirmado = crearAvisoFirmado(SECRETO)
const TODOS = { IDENTIDAD_BIOMETRIA: TEXTO_VERSION_BIOMETRIA, IDENTIDAD_TRANSFERENCIA_INTERNACIONAL: TEXTO_VERSION_TRANSFERENCIA }
const BASE = 'http://localhost/api/v1/cliente/identidad'

const VARIABLES = ['IDENTIDAD_CLAVES_MAESTRAS', 'IDENTIDAD_PEPPER_DEDUPE', 'DIDIT_API_KEY', 'DIDIT_WORKFLOW_ID', 'DIDIT_WEBHOOK_SECRET', 'RESEND_API_KEY'] as const
const anterior: Record<string, string | undefined> = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
const fetchOriginal = globalThis.fetch
let dd: DiditFalso
let staff: ActorDeIdentidad

interface Sesion {
  token: string
  supabaseId: string
  dbUserId: string
}
const tokens = new Map<string, { id: string; email: string; app_metadata: Record<string, unknown> }>()
let supabaseLlamadas = 0

/** Supabase simulado: contesta a `GET /auth/v1/user` según el token; todo lo demás va al Didit falso. */
const fetchFalso = (async (entrada: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = new URL(typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url)
  if (url.hostname === 'ci.supabase.co') {
    supabaseLlamadas++
    const cab = new Headers(init?.headers as HeadersInit | undefined)
    const token = (cab.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    const u = tokens.get(token)
    // La reparación de metadatos del contexto del cliente escribe en Supabase: se acepta sin más.
    if (url.pathname.startsWith('/auth/v1/admin/users/')) return new Response(JSON.stringify({ id: url.pathname.split('/').pop(), aud: 'authenticated' }), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url.pathname === '/auth/v1/user' && u) {
      return new Response(JSON.stringify({ ...u, aud: 'authenticated', role: 'authenticated', user_metadata: {}, created_at: new Date().toISOString() }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ msg: 'invalid JWT', code: 401 }), { status: 401, headers: { 'content-type': 'application/json' } })
  }
  return dd.manejar(entrada, init)
}) as typeof fetch

let n = 0
async function sesionDe(rol: 'CLIENTE' | 'ADMINISTRADOR' | 'SUPERADMIN', etiqueta = 'p'): Promise<Sesion> {
  const k = n++
  const empresa = rol === 'ADMINISTRADOR' ? (await prisma.company.create({ data: { name: `Ruta ${sufijo} ${k}`, slug: `ruta-${sufijo}-${k}`, type: 'carwash' }, select: { id: true } })).id : null
  const u = await prisma.user.create({
    data: { supabaseId: randomUUID(), email: `rut-${etiqueta}-${sufijo}-${k}@prueba.test`, name: `Persona ${etiqueta} ${k}`, role: rol, ...(empresa ? { companyId: empresa } : {}) },
    select: { id: true, supabaseId: true, email: true },
  })
  const token = `tok-${etiqueta}-${sufijo}-${k}`
  tokens.set(token, { id: u.supabaseId, email: u.email, app_metadata: { role: rol, dbUserId: u.id, clienteId: null, companyId: empresa } })
  return { token, supabaseId: u.supabaseId, dbUserId: u.id }
}
const pedir = (ruta: string, opciones: { token?: string | null; metodo?: string; cuerpo?: unknown; crudo?: string; cabeceras?: Record<string, string> } = {}) => {
  const cabeceras: Record<string, string> = { ...(opciones.cabeceras ?? {}) }
  if (opciones.token) cabeceras.authorization = `Bearer ${opciones.token}`
  if (opciones.cuerpo !== undefined || opciones.crudo !== undefined) cabeceras['content-type'] = 'application/json'
  return new Request(`${BASE}/${ruta}`, {
    method: opciones.metodo ?? 'POST',
    headers: cabeceras,
    body: opciones.crudo ?? (opciones.cuerpo !== undefined ? JSON.stringify(opciones.cuerpo) : undefined),
  })
}
const json = async (r: Response) => (await r.json()) as Record<string, unknown>
const recibir = async (a: ReturnType<typeof avisoFirmado>) => {
  const r = await recibirAvisoDeProveedor({ proveedor: 'didit', cuerpoCrudo: a.cuerpoCrudo, cabeceras: a.cabeceras })
  if (r.despues) await r.despues()
}

before(async () => {
  process.env.IDENTIDAD_CLAVES_MAESTRAS = `1:${randomBytes(32).toString('base64')}`
  process.env.IDENTIDAD_PEPPER_DEDUPE = PEPPER
  process.env.DIDIT_API_KEY = API_KEY
  process.env.DIDIT_WORKFLOW_ID = '11111111-0000-0000-0000-000000000001'
  process.env.DIDIT_WEBHOOK_SECRET = SECRETO
  process.env.RESEND_API_KEY = 're_prueba_sintetica'
  dd = new DiditFalso(sufijo)
  globalThis.fetch = fetchFalso
  const s = await sesionDe('SUPERADMIN', 'staff')
  staff = { userId: s.dbUserId, rol: 'SUPERADMIN' }
  await cambiarInterruptorDeIdentidad(staff, { encendido: true, motivo: 'Pruebas automáticas de las rutas con datos sintéticos.' })
})
after(async () => {
  globalThis.fetch = fetchOriginal
  await prisma.identidadInterruptor.updateMany({ where: { clave: 'VERIFICACION_IDENTIDAD' }, data: { enabled: false } })
  for (const v of VARIABLES) {
    if (anterior[v] === undefined) delete process.env[v]
    else process.env[v] = anterior[v]
  }
})

// ── 1 · Quién entra ─────────────────────────────────────────────────────────

test('1 · LAS CINCO RUTAS SOLO ATIENDEN A UN CLIENTE CON SESIÓN VÁLIDA: sin cabecera, token vacío, token falso, administrador o superadmin → 401, y no se toca nada', async () => {
  const admin = await sesionDe('ADMINISTRADOR', 'admin')
  const superadmin = await sesionDe('SUPERADMIN', 'super')
  const antes = { intentos: await prisma.identidadIntento.count(), consent: await prisma.identidadConsentimiento.count(), incid: await prisma.identidadIncidencia.count() }
  dd.reiniciarLlamadas()
  const rutas: [string, (r: Request) => Promise<Response>, string, unknown][] = [
    ['estado', estadoGET, 'GET', undefined],
    ['sesion', sesionPOST, 'POST', { consentimientos: TODOS }],
    ['consentimientos', consentimientosPOST, 'POST', { tipo: 'IDENTIDAD_BIOMETRIA', accion: 'aceptar', version: TEXTO_VERSION_BIOMETRIA }],
    ['incidencias', incidenciasPOST, 'POST', { tipo: 'otro', mensaje: 'hola' }],
    ['borrado', borradoPOST, 'POST', {}],
  ]
  const credenciales: (string | null)[] = [null, '', 'token-inventado', admin.token, superadmin.token]
  for (const [ruta, manejador, metodo, cuerpo] of rutas) {
    for (const token of credenciales) {
      const cabeceras: Record<string, string> = token === '' ? { authorization: 'Bearer ' } : {}
      const r = await manejador(pedir(ruta, { token: token || null, metodo, cuerpo, cabeceras }))
      assert.equal(r.status, 401, `${ruta} con ${token === null ? 'sin cabecera' : token === '' ? 'token vacío' : token.slice(0, 10)}`)
      assert.equal((await json(r)).ok, false)
    }
  }
  assert.deepEqual({ intentos: await prisma.identidadIntento.count(), consent: await prisma.identidadConsentimiento.count(), incid: await prisma.identidadIncidencia.count() }, antes, 'no se escribió nada')
  assert.equal(dd.llamadas.length, 0, 'no se le habló al proveedor')
})

// ── 2 · Una persona no actúa sobre otra ─────────────────────────────────────

test('2 · EL ID DE OTRA PERSONA NO SIRVE: en el cuerpo, en un campo inventado o como intento ajeno; la persona sale SIEMPRE de la sesión', async () => {
  const a = await sesionDe('CLIENTE', 'idor-a')
  const b = await sesionDe('CLIENTE', 'idor-b')
  // B empieza una verificación (para tener un intento ajeno que A intente tocar).
  const rb = await sesionPOST(pedir('sesion', { token: b.token, cuerpo: { consentimientos: TODOS } }))
  assert.equal(rb.status, 200, JSON.stringify(await json(rb.clone())))
  const intentoDeB = String((await json(rb)).intentoId)

  // A manda el id de B por todos los medios: la sesión se abre para A, nunca para B.
  const ra = await sesionPOST(pedir('sesion', { token: a.token, cuerpo: { consentimientos: TODOS, userId: b.dbUserId, supabaseId: b.supabaseId, usuario: b.dbUserId, persona: b.dbUserId } }))
  assert.equal(ra.status, 200)
  const intentoDeA = String((await json(ra)).intentoId)
  assert.notEqual(intentoDeA, intentoDeB)
  assert.equal((await prisma.identidadIntento.findUniqueOrThrow({ where: { id: intentoDeA } })).userId, a.dbUserId)
  assert.equal(await prisma.identidadIntento.count({ where: { userId: b.dbUserId } }), 1, 'B sigue con su único intento')

  // Un permiso con el id de otra persona: se registra para quien manda la sesión.
  await consentimientosPOST(pedir('consentimientos', { token: a.token, cuerpo: { tipo: 'IDENTIDAD_DIVULGACION_EMPRESAS', accion: 'aceptar', version: (await import('../../src/modules/identidad/identidadConsentimientosCore')).VERSION_VIGENTE.IDENTIDAD_DIVULGACION_EMPRESAS, userId: b.dbUserId } }))
  assert.equal(await prisma.identidadConsentimiento.count({ where: { userId: b.dbUserId, tipo: 'IDENTIDAD_DIVULGACION_EMPRESAS' } }), 0, 'B no recibió un permiso que dio A')

  // Reportar un problema apuntando al intento de B: se rechaza y no se crea nada.
  const antes = await prisma.identidadIncidencia.count()
  const ri = await incidenciasPOST(pedir('incidencias', { token: a.token, cuerpo: { tipo: 'otro', mensaje: 'es de otra persona', intentoId: intentoDeB } }))
  assert.ok(ri.status >= 400 && ri.status < 500, `status ${ri.status}`)
  assert.equal(await prisma.identidadIncidencia.count(), antes)

  // El estado de A es el de A: nunca el intento ni los datos de B.
  const re = await json(await estadoGET(pedir('estado', { token: a.token, metodo: 'GET' })))
  assert.doesNotMatch(JSON.stringify(re), new RegExp(intentoDeB))

  // Borrar mis datos borra los míos: lo de B queda.
  await borradoPOST(pedir('borrado', { token: a.token, cuerpo: {} }))
  assert.equal(await prisma.identidadIntento.count({ where: { userId: b.dbUserId } }), 1)
})

// ── 3 · Lo que sale ─────────────────────────────────────────────────────────

test('3 · LO QUE LA API DEVUELVE nunca trae la referencia del proveedor, el hash ni el documento, y nada de la verificación se guarda en caché', async () => {
  const p = await sesionDe('CLIENTE', 'sale')
  const cedula = `006-${sufijo}-salida`
  const rs = await sesionPOST(pedir('sesion', { token: p.token, cuerpo: { consentimientos: TODOS } }))
  assert.equal(rs.status, 200)
  assert.match(rs.headers.get('cache-control') ?? '', /no-store/)
  const cuerpo = await json(rs)
  assert.deepEqual(Object.keys(cuerpo).sort(), ['intentoId', 'nonce', 'ok', 'url'], 'solo lo imprescindible para volver al proveedor')
  const intentoId = String(cuerpo.intentoId)
  const sesionProv = dd.sesionDe(intentoId)
  assert.match(String(cuerpo.url), /^https:\/\/verification\.didit\.me\//, 'la dirección es la del proveedor')

  // Aprobada: el estado dice «verificada» y nada interno.
  await recibir(avisoFirmado(dd.aprobar(intentoId, { cedula })))
  const re = await estadoGET(pedir('estado', { token: p.token, metodo: 'GET' }))
  assert.equal(re.status, 200)
  assert.match(re.headers.get('cache-control') ?? '', /no-store/)
  const texto = JSON.stringify(await json(re))
  assert.match(texto, /verificada/)
  for (const prohibido of [sesionProv.id, sesionProv.token, cedula, cedula.replace(/-/g, ''), 'hashDedupe', 'referenciaProveedor', 'referencia_proveedor', 'vendor_data', 'session_id', API_KEY, SECRETO, PEPPER]) {
    assert.ok(!texto.includes(prohibido), `la respuesta de estado no debe contener «${prohibido.slice(0, 20)}»`)
  }
  // Y la dirección con el token de la sesión no aparece en el estado: solo la devuelve «sesion».
  assert.ok(!texto.includes('verification.didit.me'))
})

// ── 4 · Entradas mal formadas ───────────────────────────────────────────────

test('4 · ENTRADAS MAL FORMADAS: nunca un 500 ni una escritura; los errores son 4xx con mensaje en español', async () => {
  const p = await sesionDe('CLIENTE', 'basura')
  const antes = { intentos: await prisma.identidadIntento.count({ where: { userId: p.dbUserId } }), consent: await prisma.identidadConsentimiento.count({ where: { userId: p.dbUserId } }), incid: await prisma.identidadIncidencia.count({ where: { userId: p.dbUserId } }) }
  const malos: [string, (r: Request) => Promise<Response>, Parameters<typeof pedir>[1]][] = [
    ['consentimientos', consentimientosPOST, { crudo: 'no es json' }],
    ['consentimientos', consentimientosPOST, { cuerpo: [] }],
    ['consentimientos', consentimientosPOST, { cuerpo: null }],
    ['consentimientos', consentimientosPOST, { cuerpo: { tipo: 42, accion: 'aceptar' } }],
    ['consentimientos', consentimientosPOST, { cuerpo: { tipo: 'IDENTIDAD_BIOMETRIA', accion: 'borrarlo todo' } }],
    ['consentimientos', consentimientosPOST, { cuerpo: { tipo: '__proto__', accion: 'aceptar', version: 'x' } }],
    ['consentimientos', consentimientosPOST, { cuerpo: { tipo: 'IDENTIDAD_INVENTADO', accion: 'aceptar', version: 'x' } }],
    ['consentimientos', consentimientosPOST, { cuerpo: { tipo: 'IDENTIDAD_BIOMETRIA', accion: 'aceptar', version: 'texto-viejo-v0' } }],
    ['incidencias', incidenciasPOST, { crudo: '{"tipo":' }],
    ['incidencias', incidenciasPOST, { cuerpo: { tipo: 'otro' } }],
    ['incidencias', incidenciasPOST, { cuerpo: { tipo: ['otro'], mensaje: 'x' } }],
    ['incidencias', incidenciasPOST, { cuerpo: { tipo: 'tipo-inventado', mensaje: 'hola' } }],
    ['incidencias', incidenciasPOST, { cuerpo: { tipo: 'otro', mensaje: '' } }],
    ['incidencias', incidenciasPOST, { cuerpo: { tipo: 'otro', mensaje: 'x'.repeat(100_000) } }],
  ]
  for (const [ruta, manejador, entrada] of malos) {
    const r = await manejador(pedir(ruta, { token: p.token, ...entrada }))
    assert.ok(r.status >= 400 && r.status < 500, `${ruta} ${JSON.stringify(entrada).slice(0, 60)} → ${r.status}`)
    const c = await json(r)
    assert.equal(c.ok, false)
    assert.match(String(c.error), /[a-záéíóúñ]/i, 'el mensaje está en español')
    assert.doesNotMatch(JSON.stringify(c), /prisma|stack|at \w+ \(|node_modules|SELECT|postgres/i, 'sin rastro técnico')
  }
  // La sesión con un cuerpo que no es JSON o con canales/consentimientos raros no revienta: se trata como «sin permisos».
  for (const entrada of [{ crudo: 'basura' }, { cuerpo: [] }, { cuerpo: { canal: 'telepatia', consentimientos: 'sí' } }, { cuerpo: { consentimientos: { IDENTIDAD_BIOMETRIA: 42, otro: null } } }] as Parameters<typeof pedir>[1][]) {
    const r = await sesionPOST(pedir('sesion', { token: p.token, ...entrada }))
    assert.ok(r.status >= 400 && r.status < 500, `sesion ${JSON.stringify(entrada).slice(0, 50)} → ${r.status}`)
  }
  assert.deepEqual(
    { intentos: await prisma.identidadIntento.count({ where: { userId: p.dbUserId } }), consent: await prisma.identidadConsentimiento.count({ where: { userId: p.dbUserId } }), incid: await prisma.identidadIncidencia.count({ where: { userId: p.dbUserId } }) },
    antes,
    'lo mal formado no escribe nada'
  )
  // Un `intentoId` que no es texto (un objeto de consulta, por ejemplo) no es una inyección ni se usa: se ignora y la incidencia queda sin intento.
  const r = await incidenciasPOST(pedir('incidencias', { token: p.token, cuerpo: { tipo: 'otro', mensaje: 'con un intento raro', intentoId: { $ne: null } } }))
  assert.equal(r.status, 201)
  const creada = await prisma.identidadIncidencia.findFirstOrThrow({ where: { userId: p.dbUserId } })
  assert.equal(creada.intentoId, null)
})

// ── 5 · El proveedor caído ──────────────────────────────────────────────────

test('5 · PROVEEDOR CAÍDO: la ruta responde 503 con «inténtalo en un momento» y cuándo; sin cuerpo del proveedor, sin dirección ni clave', async () => {
  const p = await sesionDe('CLIENTE', 'caido')
  dd.caidas = 20
  const r = await sesionPOST(pedir('sesion', { token: p.token, cuerpo: { consentimientos: TODOS } }))
  dd.caidas = 0
  assert.equal(r.status, 503)
  assert.ok(Number(r.headers.get('retry-after')) > 0, 'dice cuándo reintentar')
  const c = await json(r)
  assert.equal(c.ok, false)
  assert.equal(c.motivo, 'proveedor_no_disponible')
  const texto = JSON.stringify(c)
  for (const prohibido of ['caido', 'didit', API_KEY, 'x-api-key', 'v3/session', 'stack']) assert.ok(!texto.toLowerCase().includes(prohibido.toLowerCase()), `la respuesta no debe contener «${prohibido}»`)
  // La persona puede retomar: el intento quedó para reintentar y, con el proveedor de vuelta, la misma petición funciona.
  const otra = await sesionPOST(pedir('sesion', { token: p.token, cuerpo: { consentimientos: TODOS } }))
  assert.equal(otra.status, 200)
  assert.equal(await prisma.identidadIntento.count({ where: { userId: p.dbUserId } }), 1, 'un solo intento')
})

// ── 6 · Ráfagas ─────────────────────────────────────────────────────────────

test('6 · UNA RÁFAGA SE FRENA: la consulta de estado (30 por minuto) y la apertura de sesiones (6 cada 5 minutos) responden 429', async () => {
  const p = await sesionDe('CLIENTE', 'rafaga')
  let ultimo = 0
  for (let i = 0; i < 35; i++) ultimo = (await estadoGET(pedir('estado', { token: p.token, metodo: 'GET' }))).status
  assert.equal(ultimo, 429, 'la consulta 35 ya se frenó')

  const q = await sesionDe('CLIENTE', 'rafaga2')
  const estados: number[] = []
  for (let i = 0; i < 9; i++) estados.push((await sesionPOST(pedir('sesion', { token: q.token, cuerpo: { consentimientos: TODOS } }))).status)
  assert.ok(estados.includes(429), `alguna petición se frena: ${estados.join(',')}`)
  assert.equal(estados.indexOf(429) >= 6, true, 'el límite deja los primeros seis')
})

// ── 7 · El aviso del proveedor ──────────────────────────────────────────────

test('7 · EL AVISO DEL PROVEEDOR: sin firma → 401, método equivocado → no se atiende, otro proveedor → 404, tamaño absurdo → 413; y no se escribe nada', async () => {
  const filas = await prisma.identidadEventoExterno.count()
  const mandar = (proveedor: string, cuerpo: string, cabeceras: Record<string, string> = {}) =>
    rutaWebhook.POST(new Request(`http://localhost/api/webhooks/identidad/${proveedor}`, { method: 'POST', body: cuerpo, headers: cabeceras }), { params: Promise.resolve({ proveedor }) })

  const sinFirma = await mandar('didit', JSON.stringify({ event_id: 'x', webhook_type: 'status.updated', status: 'Approved', vendor_data: 'cualquiera' }))
  assert.equal(sinFirma.status, 401)
  const firmaMala = await mandar('didit', '{"a":1}', { 'x-signature-v2': 'f'.repeat(64), 'x-timestamp': String(Math.floor(Date.now() / 1000)) })
  assert.equal(firmaMala.status, 401)
  assert.equal((await mandar('otro-proveedor', '{}')).status, 404)
  assert.equal((await mandar('didit', 'x'.repeat(2_000_000))).status, 413)
  // Un GET no tiene manejador: la ruta no atiende nada por ahí.
  assert.equal((rutaWebhook as Record<string, unknown>).GET, undefined, 'la ruta no exporta GET')
  assert.equal(await prisma.identidadEventoExterno.count(), filas, 'no se registró ningún aviso')
  assert.ok(supabaseLlamadas > 0, 'la autenticación pasó por el Supabase simulado')
})
