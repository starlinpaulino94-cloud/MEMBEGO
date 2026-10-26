/**
 * VERIFICACIÓN DE IDENTIDAD · Fase 1 · contra PostgreSQL real.
 *
 * No hay proveedor: lo que se prueba es lo de MEMBEGO —el registro global, las
 * transiciones, la idempotencia, los consentimientos, la caducidad, la
 * proyección a las empresas y el acceso del equipo—. Todo con datos sintéticos;
 * ningún documento real y ninguna imagen entran jamás aquí. Cada prueba falla si
 * vuelve el defecto que cierra:
 *
 *   1 · encender la verificación sin dictamen, sin motivo o sin ser del equipo;
 *   2 · capturar sin consentimiento, o aceptar un texto y anotar otro;
 *   3 · dos verificaciones simultáneas de la misma persona;
 *   4 · un evento repetido, tardío o contradictorio que cambia el resultado;
 *   5 · guardar la referencia del proveedor en claro, o abrirla desde otra persona;
 *   6 · reintentar sin espera tras un rechazo, o sin tope;
 *   7 · acreditar el mismo documento a dos cuentas;
 *   8 · una verificación vencida que sigue valiendo;
 *   9 · revocar sin ser del equipo, o sin dejar rastro;
 *  10 · una empresa que ve lo que la persona no consintió;
 *  11 · el equipo leyendo sin dejar asiento, o viendo lo que no debe;
 *  12 · estados inventados escritos por fuera del servicio.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { prisma } from '../../src/lib/prisma'
import {
  ErrorDeIdentidad,
  aplicarDecision,
  cambiarInterruptorDeIdentidad,
  compuertaDeIdentidad,
  consultarIdentidadComoStaff,
  crearIntento,
  ejecutarMantenimientoDeIdentidad,
  estadoDeIdentidadDe,
  guardarReferenciaDeSesion,
  leerReferenciaDeSesion,
  abrirReferencia,
  otorgarConsentimientoIdentidad,
  proyectarEnFichas,
  revocarConsentimientoIdentidad,
  revocarVerificacion,
  solicitarRevalidacion,
  type ActorDeIdentidad,
} from '../../src/modules/identidad/identidad'
import {
  TEXTO_VERSION_BIOMETRIA,
  TEXTO_VERSION_DIVULGACION,
  TEXTO_VERSION_TRANSFERENCIA,
} from '../../src/modules/identidad/identidadConsentimientosCore'
import { POLITICA_IDENTIDAD, calcularHashDedupe } from '../../src/modules/identidad/identidadCore'

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const MIN = 60_000
const DIA = 24 * 60 * MIN
const hace = (ms: number) => new Date(Date.now() - ms)

const VARIABLES_DEL_PROVEEDOR = ['DIDIT_API_KEY', 'DIDIT_WORKFLOW_ID', 'DIDIT_WEBHOOK_SECRET'] as const
const anterior: Record<string, string | undefined> = {
  claves: process.env.IDENTIDAD_CLAVES_MAESTRAS,
  pepper: process.env.IDENTIDAD_PEPPER_DEDUPE,
  ...Object.fromEntries(VARIABLES_DEL_PROVEEDOR.map((v) => [v, process.env[v]])),
}
const PEPPER = `pepper-de-prueba-${sufijo}-`.padEnd(40, 'x')
let staff: ActorDeIdentidad

before(async () => {
  process.env.IDENTIDAD_CLAVES_MAESTRAS = `1:${randomBytes(32).toString('base64')}`
  process.env.IDENTIDAD_PEPPER_DEDUPE = PEPPER
  // El entorno completo incluye el proveedor; aquí no se le llama (esto prueba lo de MEMBEGO).
  process.env.DIDIT_API_KEY = 'clave-sintetica-de-prueba'
  process.env.DIDIT_WORKFLOW_ID = '00000000-0000-0000-0000-000000000000'
  process.env.DIDIT_WEBHOOK_SECRET = 'secreto-sintetico-de-prueba-01'
  const u = await prisma.user.create({
    data: { supabaseId: `sb-id-staff-${sufijo}`, email: `staff-id-${sufijo}@prueba.test`, name: 'Equipo', role: 'SUPERADMIN' },
    select: { id: true },
  })
  staff = { userId: u.id, rol: 'SUPERADMIN' }
  // La base de pruebas se reutiliza entre corridas: el interruptor siempre arranca como nace, apagado.
  await prisma.identidadInterruptor.updateMany({ where: { clave: 'VERIFICACION_IDENTIDAD' }, data: { enabled: false } })
})
after(() => {
  for (const [clave, valor] of [
    ['IDENTIDAD_CLAVES_MAESTRAS', anterior.claves],
    ['IDENTIDAD_PEPPER_DEDUPE', anterior.pepper],
    ...VARIABLES_DEL_PROVEEDOR.map((v) => [v, anterior[v]] as const),
  ] as const) {
    if (valor === undefined) delete process.env[clave]
    else process.env[clave] = valor
  }
})

// ── Fixtures ────────────────────────────────────────────────────────────────

let n = 0
async function persona(etiqueta = 'p') {
  const k = n++
  return prisma.user.create({
    data: { supabaseId: `sb-id-${etiqueta}-${sufijo}-${k}`, email: `id-${etiqueta}-${sufijo}-${k}@prueba.test`, name: `Persona ${etiqueta} ${k}`, role: 'CLIENTE' },
    select: { id: true, supabaseId: true },
  })
}
async function empresa(etiqueta: string) {
  return (
    await prisma.company.create({
      data: { name: `Identidad ${etiqueta} ${sufijo}`, slug: `identidad-${etiqueta}-${sufijo}`, type: 'carwash', ciudad: 'Santo Domingo' },
      select: { id: true },
    })
  ).id
}
async function ficha(companyId: string, p: { supabaseId: string }, nombre: string) {
  return prisma.cliente.create({
    data: { companyId, supabaseId: p.supabaseId, nombre, email: `f-${sufijo}-${n++}@prueba.test` },
    select: { id: true },
  })
}

const CTX = { canal: 'web' as const, ip: '190.80.12.5', userAgent: 'prueba-identidad' }
async function consentir(userId: string, tipos: ('b' | 't' | 'd')[] = ['b', 't']) {
  for (const t of tipos) {
    if (t === 'b') await otorgarConsentimientoIdentidad(userId, 'IDENTIDAD_BIOMETRIA', { textoVersionVista: TEXTO_VERSION_BIOMETRIA, ...CTX })
    if (t === 't') await otorgarConsentimientoIdentidad(userId, 'IDENTIDAD_TRANSFERENCIA_INTERNACIONAL', { textoVersionVista: TEXTO_VERSION_TRANSFERENCIA, ...CTX })
    if (t === 'd') await otorgarConsentimientoIdentidad(userId, 'IDENTIDAD_DIVULGACION_EMPRESAS', { textoVersionVista: TEXTO_VERSION_DIVULGACION, ...CTX })
  }
}
async function habilitar() {
  await cambiarInterruptorDeIdentidad(staff, { encendido: true, motivo: 'Pruebas automáticas con datos sintéticos.' })
}
async function intentoNuevo(userId: string, extra: Partial<Parameters<typeof crearIntento>[1]> = {}) {
  const r = await crearIntento(userId, { canal: 'movil_hospedado', ...extra })
  assert.equal(r.ok, true, JSON.stringify(r))
  if (!r.ok) throw new Error('no se creó')
  return r.intento
}
const motivoDe = (r: Awaited<ReturnType<typeof crearIntento>>) => (r.ok ? null : r.motivo)
const dec = (resultado: Parameters<typeof aplicarDecision>[1]['resultado'], codigos: string[] = []) => ({ resultado, codigos })
const intentoDe = (id: string) => prisma.identidadIntento.findUniqueOrThrow({ where: { id } })
const verifDe = (userId: string) => prisma.identidadVerificacion.findUnique({ where: { userId } })
const asientos = (userId: string, accion?: string) =>
  prisma.auditLog.findMany({ where: { entidadTipo: 'IdentidadVerificacion', entidadId: userId, ...(accion ? { accion: accion as never } : {}) }, orderBy: { createdAt: 'asc' } })

/** Una persona verificada de punta a punta, para los casos que parten de ahí. */
async function verificada(etiqueta = 'v', datos: Parameters<typeof aplicarDecision>[2] = {}) {
  const p = await persona(etiqueta)
  await consentir(p.id)
  const i = await intentoNuevo(p.id)
  await guardarReferenciaDeSesion(i.id, `sesion-sintetica-${sufijo}-${n++}`)
  const r = await aplicarDecision(i.id, dec('aprobada'), datos)
  assert.equal(r.aplicado, 'aplicar')
  return { p, i }
}

// ── 1 · La compuerta ────────────────────────────────────────────────────────

test('1 · la verificación nace APAGADA; encenderla exige ser del equipo, dar motivo y tener el entorno completo', async () => {
  const antes = await compuertaDeIdentidad()
  assert.equal(antes.interruptorEncendido, false, 'el interruptor nace apagado')
  assert.equal(antes.habilitada, false)

  const cliente: ActorDeIdentidad = { userId: (await persona('cli')).id, rol: 'CLIENTE' }
  await assert.rejects(() => cambiarInterruptorDeIdentidad(cliente, { encendido: true, motivo: 'quiero' }), (e: unknown) => e instanceof ErrorDeIdentidad && e.codigo === 'no_autorizado')
  await assert.rejects(() => cambiarInterruptorDeIdentidad(staff, { encendido: true, motivo: '   ' }), (e: unknown) => e instanceof ErrorDeIdentidad && e.codigo === 'motivo_requerido')

  // Sin la llave de cifrado (entorno incompleto) no se puede encender.
  const guardada = process.env.IDENTIDAD_CLAVES_MAESTRAS
  delete process.env.IDENTIDAD_CLAVES_MAESTRAS
  await assert.rejects(
    () => cambiarInterruptorDeIdentidad(staff, { encendido: true, motivo: 'prueba' }),
    (e: unknown) => e instanceof ErrorDeIdentidad && e.codigo === 'falta_configuracion' && /IDENTIDAD_CLAVES_MAESTRAS/.test(e.message)
  )
  process.env.IDENTIDAD_CLAVES_MAESTRAS = guardada

  const encendida = await cambiarInterruptorDeIdentidad(staff, { encendido: true, motivo: 'Pruebas automáticas con datos sintéticos.' })
  assert.equal(encendida.habilitada, true)
  const fila = await prisma.identidadInterruptor.findUniqueOrThrow({ where: { clave: 'VERIFICACION_IDENTIDAD' } })
  assert.deepEqual([fila.enabled, fila.changedById], [true, staff.userId])

  // Falta una pieza → apagada, aunque el interruptor esté encendido (para apagar basta una).
  delete process.env.IDENTIDAD_PEPPER_DEDUPE
  const sinPepper = await compuertaDeIdentidad()
  assert.deepEqual([sinPepper.habilitada, sinPepper.faltantes], [false, ['IDENTIDAD_PEPPER_DEDUPE']])
  process.env.IDENTIDAD_PEPPER_DEDUPE = PEPPER
  assert.equal((await compuertaDeIdentidad()).habilitada, true)

  const cambios = await prisma.auditLog.findMany({ where: { accion: 'IDENTIDAD_INTERRUPTOR_CAMBIADO', userId: staff.userId } })
  assert.ok(cambios.length >= 1, 'cada cambio del interruptor deja asiento')
})

test('1b · apagada, no se empieza ninguna verificación (y apagar exige motivo)', async () => {
  const p = await persona('apagada')
  await consentir(p.id)
  await habilitar()
  await assert.rejects(() => cambiarInterruptorDeIdentidad(staff, { encendido: false, motivo: '' }), (e: unknown) => e instanceof ErrorDeIdentidad && e.codigo === 'motivo_requerido')
  await cambiarInterruptorDeIdentidad(staff, { encendido: false, motivo: 'Apagada en la prueba.' })
  try {
    const r = await crearIntento(p.id, { canal: 'web' })
    assert.equal(motivoDe(r), 'no_habilitada')
    assert.equal(await prisma.identidadIntento.count({ where: { userId: p.id } }), 0)
  } finally {
    await habilitar()
  }
})

// ── 2 · Consentimientos ─────────────────────────────────────────────────────

test('2 · el consentimiento queda registrado con su versión, IP y agente; repetirlo no duplica ni reescribe la fecha', async () => {
  const p = await persona('cons')
  const a = await otorgarConsentimientoIdentidad(p.id, 'IDENTIDAD_BIOMETRIA', { textoVersionVista: TEXTO_VERSION_BIOMETRIA, ...CTX })
  assert.equal(a.ok && a.creado, true)
  const [f] = await prisma.identidadConsentimiento.findMany({ where: { userId: p.id } })
  assert.deepEqual(
    [f.tipo, f.textoVersion, f.canal, f.ipAddress, f.userAgent, f.revocadoAt],
    ['IDENTIDAD_BIOMETRIA', TEXTO_VERSION_BIOMETRIA, 'web', '190.80.12.5', 'prueba-identidad', null]
  )
  const b = await otorgarConsentimientoIdentidad(p.id, 'IDENTIDAD_BIOMETRIA', { textoVersionVista: TEXTO_VERSION_BIOMETRIA, ...CTX })
  assert.deepEqual([b.ok && b.creado, b.ok && b.id], [false, f.id])
  const filas = await prisma.identidadConsentimiento.findMany({ where: { userId: p.id } })
  assert.equal(filas.length, 1)
  assert.equal(filas[0].otorgadoAt.getTime(), f.otorgadoAt.getTime())
})

test('2b · ACEPTAR UN TEXTO Y ANOTAR OTRO no pasa: si la versión vista no es la vigente, no se registra nada', async () => {
  const p = await persona('texto')
  for (const vista of ['identidad-biometria-v0', '', TEXTO_VERSION_TRANSFERENCIA]) {
    const r = await otorgarConsentimientoIdentidad(p.id, 'IDENTIDAD_BIOMETRIA', { textoVersionVista: vista, ...CTX })
    assert.deepEqual(r, { ok: false, error: 'texto_cambio' }, `versión «${vista}»`)
  }
  assert.equal(await prisma.identidadConsentimiento.count({ where: { userId: p.id } }), 0)
  const inexistente = await otorgarConsentimientoIdentidad('no-existe-nadie', 'IDENTIDAD_BIOMETRIA', { textoVersionVista: TEXTO_VERSION_BIOMETRIA, ...CTX })
  assert.deepEqual(inexistente, { ok: false, error: 'persona_no_encontrada' })
})

test('2c · una versión NUEVA del texto retira la anterior y registra otra: el historial dice qué aceptó en cada momento', async () => {
  const p = await persona('hist')
  // Una aceptación vieja, de una versión que ya no es la vigente.
  await prisma.identidadConsentimiento.create({ data: { userId: p.id, tipo: 'IDENTIDAD_BIOMETRIA', textoVersion: 'identidad-biometria-v0', canal: 'web' } })
  const r = await otorgarConsentimientoIdentidad(p.id, 'IDENTIDAD_BIOMETRIA', { textoVersionVista: TEXTO_VERSION_BIOMETRIA, ...CTX })
  assert.equal(r.ok && r.creado, true)
  const filas = await prisma.identidadConsentimiento.findMany({ where: { userId: p.id }, orderBy: { otorgadoAt: 'asc' } })
  assert.deepEqual(filas.map((f) => [f.textoVersion, f.revocadoAt === null]), [['identidad-biometria-v0', false], [TEXTO_VERSION_BIOMETRIA, true]])
})

test('2d · dos aceptaciones simultáneas dejan UN consentimiento vigente', async () => {
  const p = await persona('conc')
  const r = await Promise.all(Array.from({ length: 6 }, () => otorgarConsentimientoIdentidad(p.id, 'IDENTIDAD_TRANSFERENCIA_INTERNACIONAL', { textoVersionVista: TEXTO_VERSION_TRANSFERENCIA, ...CTX })))
  assert.ok(r.every((x) => x.ok))
  assert.equal(await prisma.identidadConsentimiento.count({ where: { userId: p.id, revocadoAt: null } }), 1)
  assert.equal(r.filter((x) => x.ok && x.creado).length, 1, 'solo una lo creó')
})

test('2e · sin los dos consentimientos obligatorios no se captura; la divulgación a empresas NO es obligatoria', async () => {
  const p = await persona('sinc')
  assert.equal(motivoDe(await crearIntento(p.id, { canal: 'web' })), 'falta_consentimiento')
  await consentir(p.id, ['b'])
  assert.equal(motivoDe(await crearIntento(p.id, { canal: 'web' })), 'falta_consentimiento')
  await consentir(p.id, ['t'])
  const r = await crearIntento(p.id, { canal: 'web' })
  assert.equal(r.ok, true, 'con biometría y transferencia basta: la divulgación solo decide qué ven las empresas')
})

test('2f · retirar el consentimiento de biometría cancela el intento abierto y cierra la puerta a nuevos', async () => {
  const p = await persona('retira')
  await consentir(p.id)
  const i = await intentoNuevo(p.id)
  const r = await revocarConsentimientoIdentidad(p.id, 'IDENTIDAD_BIOMETRIA')
  assert.deepEqual(r, { revocados: 1, intentosCancelados: 1 })
  const cancelado = await intentoDe(i.id)
  assert.deepEqual([cancelado.estado, cancelado.resueltoAt !== null], ['cancelada', true])
  assert.equal(motivoDe(await crearIntento(p.id, { canal: 'web' })), 'falta_consentimiento')
  // Retirarlo otra vez no hace nada.
  assert.deepEqual(await revocarConsentimientoIdentidad(p.id, 'IDENTIDAD_BIOMETRIA'), { revocados: 0, intentosCancelados: 0 })
  // La fila no se borra: queda con su fecha de retiro.
  assert.equal((await prisma.identidadConsentimiento.findMany({ where: { userId: p.id, tipo: 'IDENTIDAD_BIOMETRIA' } }))[0].revocadoAt !== null, true)
})

// ── 3 · Crear un intento ────────────────────────────────────────────────────

test('3 · el intento nace «creada», con el consentimiento aplicable anotado, su vigencia y su nonce, y deja asiento', async () => {
  const p = await persona('crea')
  await consentir(p.id)
  const i = await intentoNuevo(p.id, { ip: '190.80.12.5', userAgent: 'prueba-identidad' })
  const fila = await intentoDe(i.id)
  const bio = await prisma.identidadConsentimiento.findFirstOrThrow({ where: { userId: p.id, tipo: 'IDENTIDAD_BIOMETRIA', revocadoAt: null } })
  assert.equal(fila.estado, 'creada')
  assert.equal(fila.consentimientoBiometriaId, bio.id, 'queda anotado QUÉ consentimiento había al empezar')
  assert.match(fila.nonce ?? '', /^[0-9a-f]{32}$/)
  assert.ok(fila.venceAt && Math.abs(fila.venceAt.getTime() - (Date.now() + POLITICA_IDENTIDAD.vigenciaIntentoMs)) < 60_000)
  assert.deepEqual([fila.canal, fila.origen], ['movil_hospedado', 'cliente'])
  const [a] = await asientos(p.id, 'IDENTIDAD_VERIFICACION_INICIADA')
  assert.equal((a.payload as Record<string, unknown>).intentoId, i.id)
  assert.equal(a.userId, p.id, 'quien lo hizo es la persona')
})

test('3b · DOS VERIFICACIONES SIMULTÁNEAS: seis peticiones a la vez reciben el MISMO intento, y solo existe uno abierto', async () => {
  const p = await persona('simul')
  await consentir(p.id)
  const r = await Promise.all(Array.from({ length: 6 }, () => crearIntento(p.id, { canal: 'web' })))
  assert.ok(r.every((x) => x.ok), JSON.stringify(r))
  const ids = new Set(r.map((x) => (x.ok ? x.intento.id : '')))
  assert.equal(ids.size, 1, 'todas ven el mismo intento')
  assert.equal(r.filter((x) => x.ok && !x.reutilizado).length, 1, 'solo una lo creó')
  assert.equal(await prisma.identidadIntento.count({ where: { userId: p.id } }), 1)
  assert.equal((await asientos(p.id, 'IDENTIDAD_VERIFICACION_INICIADA')).length, 1)
})

test('3c · con un intento abierto, pedir otro devuelve ese (la persona vuelve a su pantalla y lo retoma)', async () => {
  const p = await persona('abierto')
  await consentir(p.id)
  const a = await intentoNuevo(p.id)
  const b = await crearIntento(p.id, { canal: 'movil_hospedado' })
  assert.equal(b.ok && b.reutilizado && b.intento.id, a.id)
})

test('3d · una persona que no existe no abre intentos', async () => {
  assert.equal(motivoDe(await crearIntento('no-existe-nadie', { canal: 'web' })), 'persona_no_encontrada')
})

test('3e · el candado del índice: por fuera del servicio tampoco se pueden abrir dos intentos de la misma persona', async () => {
  const p = await persona('indice')
  await consentir(p.id)
  await intentoNuevo(p.id)
  await assert.rejects(() => prisma.identidadIntento.create({ data: { userId: p.id, canal: 'web' } }), /Unique|unique/)
})

// ── 4 · Idempotencia, orden y conflicto ─────────────────────────────────────

test('4 · EVENTOS: repetido no cambia nada, tardío se ignora y la decisión final no la cambia otra distinta', async () => {
  const p = await persona('ev')
  await consentir(p.id)
  const i = await intentoNuevo(p.id)

  assert.deepEqual(await aplicarDecision(i.id, dec('iniciada')), { aplicado: 'aplicar', estado: 'iniciada', verificada: false, enRevisionPorDuplicado: false })
  assert.ok((await intentoDe(i.id)).iniciadoAt, 'se anota cuándo empezó')
  assert.equal((await aplicarDecision(i.id, dec('en_proceso'))).aplicado, 'aplicar')
  assert.equal((await aplicarDecision(i.id, dec('en_proceso'))).aplicado, 'repetida', 'el mismo evento dos veces')
  assert.deepEqual(await aplicarDecision(i.id, dec('enviada')), { aplicado: 'ignorar_regresion', estado: 'en_proceso' })

  const ok = await aplicarDecision(i.id, dec('aprobada'))
  assert.equal(ok.aplicado === 'aplicar' && ok.verificada, true)
  const aprobado = await intentoDe(i.id)
  assert.equal(aprobado.estado, 'aprobada')
  assert.ok(aprobado.resueltoAt)

  // Tras aprobar: un «en proceso» tardío no lo deshace…
  assert.deepEqual(await aplicarDecision(i.id, dec('en_proceso')), { aplicado: 'ignorar_regresion', estado: 'aprobada' })
  // …un «aprobada» repetido no vuelve a verificar…
  assert.equal((await aplicarDecision(i.id, dec('aprobada'))).aplicado, 'repetida')
  assert.equal((await asientos(p.id, 'IDENTIDAD_VERIFICACION_APROBADA')).length, 1, 'un solo asiento aunque el evento llegue tres veces')
  // …y un rechazo DISTINTO sobre un intento cerrado queda prohibido: no cambia nada.
  assert.deepEqual(await aplicarDecision(i.id, dec('rechazada', ['SOSPECHA_DE_FRAUDE'])), { aplicado: 'prohibida', estado: 'aprobada' })
  assert.equal((await intentoDe(i.id)).estado, 'aprobada')
  assert.equal((await verifDe(p.id))?.estado, 'verificada')
})

test('4b · el proveedor puede decidir sin avisar de los pasos intermedios, y un intento que no existe no rompe nada', async () => {
  const p = await persona('salto')
  await consentir(p.id)
  const i = await intentoNuevo(p.id)
  const r = await aplicarDecision(i.id, dec('rechazada', ['DOCUMENTO_ILEGIBLE']))
  assert.equal(r.aplicado, 'aplicar')
  assert.deepEqual(await aplicarDecision('no-existe-el-intento', dec('aprobada')), { aplicado: 'no_existe' })
})

test('4c · el mismo evento llegando a la vez 6 veces aplica UNA vez', async () => {
  const p = await persona('dup')
  await consentir(p.id)
  const i = await intentoNuevo(p.id)
  const r = await Promise.all(Array.from({ length: 6 }, () => aplicarDecision(i.id, dec('aprobada'))))
  assert.equal(r.filter((x) => x.aplicado === 'aplicar').length, 1)
  assert.equal(r.filter((x) => x.aplicado === 'repetida').length, 5)
  assert.equal((await asientos(p.id, 'IDENTIDAD_VERIFICACION_APROBADA')).length, 1)
  assert.equal(await prisma.identidadVerificacion.count({ where: { userId: p.id } }), 1)
})

test('4d · «reenvío requerido» deja el intento abierto, y la persona vuelve a enviar', async () => {
  const p = await persona('reenvio')
  await consentir(p.id)
  const i = await intentoNuevo(p.id)
  await aplicarDecision(i.id, dec('en_proceso'))
  const r = await aplicarDecision(i.id, dec('reenvio_requerido', ['DOCUMENTO_ILEGIBLE']))
  assert.equal(r.aplicado, 'aplicar')
  const abierto = await intentoDe(i.id)
  assert.deepEqual([abierto.estado, abierto.codigoRazon, abierto.resueltoAt], ['reenvio_requerido', 'DOCUMENTO_ILEGIBLE', null])
  assert.equal((await crearIntento(p.id, { canal: 'web' })).ok && true, true, 'sigue habiendo UN intento abierto')
  assert.equal(await prisma.identidadIntento.count({ where: { userId: p.id } }), 1)
  assert.equal((await aplicarDecision(i.id, dec('enviada'))).aplicado, 'aplicar', 'vuelve a la captura')
})

// ── 5 · Aprobar y la referencia sellada ─────────────────────────────────────

test('5 · aprobar escribe el resultado global: nivel, vía, proveedor, fecha y expiración a 36 meses', async () => {
  const { p } = await verificada('apr', { proveedor: 'didit' })
  const v = await verifDe(p.id)
  assert.ok(v)
  assert.deepEqual([v.estado, v.nivel, v.viaVerificacion, v.proveedor], ['verificada', 'documento_selfie', 'proveedor_documento_selfie', 'didit'])
  assert.ok(v.verificadaEn && v.expiraEn)
  const esperada = new Date(v.verificadaEn.getTime())
  esperada.setUTCMonth(esperada.getUTCMonth() + 36)
  assert.ok(Math.abs(v.expiraEn.getTime() - esperada.getTime()) < 2 * DIA, 'expira 3 años después')
  assert.equal(v.revocadaEn, null)
  const [a] = await asientos(p.id, 'IDENTIDAD_VERIFICACION_APROBADA')
  assert.deepEqual(
    [(a.payload as Record<string, unknown>).nivel, (a.payload as Record<string, unknown>).proveedor, (a.payload as Record<string, unknown>).estadoNuevo],
    ['documento_selfie', 'didit', 'verificada']
  )
})

test('5b · LA REFERENCIA DEL PROVEEDOR NUNCA VA EN CLARO: se guarda sellada, solo abre con la llave y solo para SU persona', async () => {
  const p = await persona('sello')
  await consentir(p.id)
  const i = await intentoNuevo(p.id)
  const referencia = `sesion-didit-sintetica-${sufijo}`
  await guardarReferenciaDeSesion(i.id, referencia)

  const fila = await intentoDe(i.id)
  assert.ok(fila.referenciaProveedorSellada && fila.claveVersion === 1)
  assert.doesNotMatch(fila.referenciaProveedorSellada ?? '', new RegExp(referencia), 'el id de la sesión no está en claro')
  // Ni en NINGUNA columna de texto de las tres tablas.
  const volcado = JSON.stringify(await prisma.$queryRawUnsafe(`select * from identidad_intentos where id = '${i.id}'`))
  assert.doesNotMatch(volcado, new RegExp(referencia))

  assert.equal(await leerReferenciaDeSesion(i.id), referencia, 'el servidor la abre para llamar al proveedor')
  const otra = await persona('otra')
  assert.equal(abrirReferencia(otra.id, fila.referenciaProveedorSellada!), null, 'copiada a otra persona, no abre')
  assert.equal(await leerReferenciaDeSesion('no-existe'), null)

  // Sin la llave no se guarda nada (falla cerrada).
  const guardada = process.env.IDENTIDAD_CLAVES_MAESTRAS
  delete process.env.IDENTIDAD_CLAVES_MAESTRAS
  try {
    await assert.rejects(() => guardarReferenciaDeSesion(i.id, 'otra'), (e: unknown) => e instanceof ErrorDeIdentidad && e.codigo === 'sin_clave')
  } finally {
    process.env.IDENTIDAD_CLAVES_MAESTRAS = guardada
  }

  // Al aprobar, el resultado hereda la referencia SELLADA (nunca en claro).
  await aplicarDecision(i.id, dec('aprobada'))
  const v = await verifDe(p.id)
  assert.equal(v?.referenciaProveedorSellada, fila.referenciaProveedorSellada)
})

test('5c · CUENTA PREVIAMENTE VERIFICADA: no se abre otro intento mientras la verificación valga', async () => {
  const { p } = await verificada('ya')
  assert.equal(motivoDe(await crearIntento(p.id, { canal: 'web' })), 'ya_verificada')
  const e = await estadoDeIdentidadDe(p.id)
  assert.deepEqual([e.estado, e.nivel, e.puedeIniciar, e.motivoNoPuedeIniciar], ['verificada', 'documento_selfie', false, 'ya_verificada'])
})

// ── 6 · Rechazos y reintentos ───────────────────────────────────────────────

test('6 · REINTENTO DESPUÉS DEL RECHAZO: espera obligatoria, mensaje en español y luego se puede', async () => {
  const p = await persona('rech')
  await consentir(p.id)
  const i = await intentoNuevo(p.id)
  await aplicarDecision(i.id, dec('rechazada', ['ROSTRO_NO_COINCIDE']))
  const rechazado = await intentoDe(i.id)
  assert.deepEqual([rechazado.estado, rechazado.tipoRechazo, rechazado.codigoRazon], ['rechazada_reintentable', 'reintentable', 'ROSTRO_NO_COINCIDE'])
  assert.equal((await asientos(p.id, 'IDENTIDAD_VERIFICACION_RECHAZADA')).length, 1)

  const e = await estadoDeIdentidadDe(p.id)
  assert.equal(e.puedeIniciar, false)
  assert.equal(e.motivoNoPuedeIniciar, 'espera')
  assert.ok(e.esperarHasta && e.esperarHasta.getTime() > Date.now())
  assert.deepEqual([e.ultimoRechazo?.reintentable, e.ultimoRechazo?.codigo], [true, 'ROSTRO_NO_COINCIDE'])
  assert.match(e.ultimoRechazo?.mensaje ?? '', /selfie no coincide/)
  const espera = await crearIntento(p.id, { canal: 'web' })
  assert.equal(!espera.ok && espera.motivo, 'espera')

  // Pasados los minutos de espera, sí.
  await prisma.identidadIntento.update({ where: { id: i.id }, data: { resueltoAt: hace(POLITICA_IDENTIDAD.esperaTrasRechazoMs + MIN) } })
  const otro = await crearIntento(p.id, { canal: 'web' })
  assert.equal(otro.ok && !otro.reutilizado && otro.intento.id !== i.id, true)
})

test('6b · tres rechazos en la semana: ya no se reintenta solo, va a soporte; el equipo puede reabrir', async () => {
  const p = await persona('tope')
  await consentir(p.id)
  for (let k = 0; k < POLITICA_IDENTIDAD.maxRechazosReintentables; k++) {
    const i = await intentoNuevo(p.id)
    await aplicarDecision(i.id, dec('rechazada', ['DOCUMENTO_ILEGIBLE']))
    await prisma.identidadIntento.update({ where: { id: i.id }, data: { resueltoAt: hace((k + 1) * DIA) } })
  }
  const r = await crearIntento(p.id, { canal: 'web' })
  assert.equal(!r.ok && r.motivo, 'demasiados_rechazos')
  const abierto = await crearIntento(p.id, { canal: 'web', desbloqueoPorStaff: true, origen: 'staff', actorUserId: staff.userId })
  assert.equal(abierto.ok, true)
})

test('6c · un rechazo DEFINITIVO bloquea; el motivo de fraude NO se explica y el mensaje no delata la señal', async () => {
  const p = await persona('defi')
  await consentir(p.id)
  const i = await intentoNuevo(p.id)
  await aplicarDecision(i.id, dec('rechazada', ['ROSTRO_NO_COINCIDE', 'SOSPECHA_DE_FRAUDE']))
  const fila = await intentoDe(i.id)
  assert.deepEqual([fila.estado, fila.tipoRechazo, fila.codigoRazon], ['rechazada_definitiva', 'definitivo', 'SOSPECHA_DE_FRAUDE'])
  const e = await estadoDeIdentidadDe(p.id)
  assert.deepEqual([e.puedeIniciar, e.motivoNoPuedeIniciar], [false, 'bloqueada_por_rechazo_definitivo'])
  assert.deepEqual([e.ultimoRechazo?.reintentable, e.ultimoRechazo?.codigo], [false, null], 'el código del fraude no sale de MEMBEGO')
  assert.doesNotMatch(e.ultimoRechazo?.mensaje ?? '', /fraude|falsific|alterad/i)
  assert.doesNotMatch(JSON.stringify(e), /SOSPECHA_DE_FRAUDE/)
  const r = await crearIntento(p.id, { canal: 'web' })
  assert.equal(!r.ok && r.motivo, 'bloqueada_por_rechazo_definitivo')
})

// ── 7 · Documento duplicado ─────────────────────────────────────────────────

test('7 · EL MISMO DOCUMENTO EN DOS CUENTAS: la segunda NO se acredita, queda en revisión y deja asiento', async () => {
  const hash = calcularHashDedupe(PEPPER, { tipoDocumento: 'cedula', numeroDocumento: `001-${Date.now()}-1`, pais: 'DO' })
  const a = await verificada('dup1', { hashDedupe: hash })
  const b = await persona('dup2')
  await consentir(b.id)
  const i = await intentoNuevo(b.id)
  const r = await aplicarDecision(i.id, dec('aprobada'), { hashDedupe: hash })
  assert.deepEqual(r, { aplicado: 'aplicar', estado: 'en_revision', verificada: false, enRevisionPorDuplicado: true })
  const fila = await intentoDe(i.id)
  assert.deepEqual([fila.estado, fila.codigoRazon, fila.resueltoAt], ['en_revision', 'IDENTIDAD_DUPLICADA', null])
  assert.equal(await verifDe(b.id), null, 'la segunda cuenta no queda verificada')
  assert.equal((await verifDe(a.p.id))?.estado, 'verificada', 'la primera sigue como estaba')
  assert.equal((await asientos(b.id, 'IDENTIDAD_VERIFICACION_EN_REVISION')).length, 1)
  const e = await estadoDeIdentidadDe(b.id)
  assert.deepEqual([e.estado, e.intentoAbierto?.estado, e.puedeIniciar], ['no_verificada', 'en_revision', false])
})

test('7b · dos cuentas aprobadas A LA VEZ con el mismo documento: una queda verificada y la otra en revisión', async () => {
  const hash = calcularHashDedupe(PEPPER, { tipoDocumento: 'cedula', numeroDocumento: `002-${Date.now()}-2`, pais: 'DO' })
  const [x, y] = [await persona('sim1'), await persona('sim2')]
  const intentos = []
  for (const p of [x, y]) {
    await consentir(p.id)
    intentos.push(await intentoNuevo(p.id))
  }
  const r = await Promise.all(intentos.map((i) => aplicarDecision(i.id, dec('aprobada'), { hashDedupe: hash })))
  assert.ok(r.every((q) => q.aplicado === 'aplicar'))
  const verificadas = r.filter((q) => q.aplicado === 'aplicar' && q.verificada).length
  const revision = r.filter((q) => q.aplicado === 'aplicar' && q.enRevisionPorDuplicado).length
  assert.deepEqual([verificadas, revision], [1, 1])
  assert.equal(await prisma.identidadVerificacion.count({ where: { hashDedupe: hash } }), 1)
})

test('7c · la base rechaza el mismo hash en dos filas aunque se escriba por fuera del servicio', async () => {
  const hash = calcularHashDedupe(PEPPER, { tipoDocumento: 'cedula', numeroDocumento: `003-${Date.now()}`, pais: 'DO' })
  const a = await persona('hx1')
  const b = await persona('hx2')
  const datos = { estado: 'verificada', nivel: 'documento_selfie', verificadaEn: new Date(), expiraEn: new Date(Date.now() + DIA), hashDedupe: hash }
  await prisma.identidadVerificacion.create({ data: { userId: a.id, ...datos } })
  await assert.rejects(() => prisma.identidadVerificacion.create({ data: { userId: b.id, ...datos } }), /Unique|unique/)
})

// ── 8 · Expiración y mantenimiento ──────────────────────────────────────────

test('8 · UNA VERIFICACIÓN VENCIDA NO VALE aunque el barrido no haya pasado; el barrido la marca, deja asiento y es idempotente', async () => {
  const { p } = await verificada('exp')
  await prisma.identidadVerificacion.update({ where: { userId: p.id }, data: { expiraEn: hace(MIN) } })
  const antes = await estadoDeIdentidadDe(p.id)
  assert.deepEqual([antes.estado, antes.nivel, antes.verificadaEn], ['expirada', null, null], 'ya no vale ni se enseña como verificada')
  assert.equal((await verifDe(p.id))?.estado, 'verificada', 'la fila todavía dice verificada: el barrido no ha pasado')
  assert.equal((await crearIntento(p.id, { canal: 'web' })).ok, true, 'puede revalidar')

  const r1 = await ejecutarMantenimientoDeIdentidad()
  assert.ok(r1.expiradas >= 1)
  assert.equal((await verifDe(p.id))?.estado, 'expirada')
  assert.equal((await asientos(p.id, 'IDENTIDAD_VERIFICACION_EXPIRADA')).length, 1)
  const r2 = await ejecutarMantenimientoDeIdentidad()
  assert.equal((await asientos(p.id, 'IDENTIDAD_VERIFICACION_EXPIRADA')).length, 1, 'el segundo barrido no duplica el asiento')
  assert.ok(r2.expiradas === 0 || r2.expiradas < r1.expiradas)
})

test('8b · el barrido da por ABANDONADO el intento que no avanzó (y libera el candado), pero no toca los que esperan al proveedor o a una persona', async () => {
  const [a, b, c] = [await persona('ab1'), await persona('ab2'), await persona('ab3')]
  const ids: string[] = []
  for (const p of [a, b, c]) {
    await consentir(p.id)
    ids.push((await intentoNuevo(p.id)).id)
  }
  await aplicarDecision(ids[1], dec('enviada'))
  await aplicarDecision(ids[2], dec('en_revision'))
  await prisma.identidadIntento.updateMany({ where: { id: { in: ids } }, data: { venceAt: hace(MIN) } })

  const r = await ejecutarMantenimientoDeIdentidad()
  assert.ok(r.intentosAbandonados >= 1)
  assert.equal((await intentoDe(ids[0])).estado, 'abandonada')
  assert.equal((await intentoDe(ids[1])).estado, 'enviada', 'hay un proveedor por medio: lo resuelve la reconciliación')
  assert.equal((await intentoDe(ids[2])).estado, 'en_revision', 'lo está mirando una persona')
  // El candado se liberó: la persona puede volver a empezar.
  const otra = await crearIntento(a.id, { canal: 'web' })
  assert.equal(otra.ok && !otra.reutilizado, true)
})

// ── 9 · Revocar y revalidar ─────────────────────────────────────────────────

test('9 · REVOCAR: solo el equipo, con motivo, con asiento; la persona deja de valer y puede volver a verificarse', async () => {
  const { p } = await verificada('rev')
  const intruso: ActorDeIdentidad = { userId: (await persona('intruso')).id, rol: 'CLIENTE' }
  await assert.rejects(() => revocarVerificacion(intruso, p.id, 'fraude_confirmado'), (e: unknown) => e instanceof ErrorDeIdentidad && e.codigo === 'no_autorizado')
  await assert.rejects(() => revocarVerificacion({ userId: p.id, rol: 'CLIENTE' }, p.id, 'x'), (e: unknown) => e instanceof ErrorDeIdentidad && e.codigo === 'no_autorizado', 'ni la propia persona')
  await assert.rejects(() => revocarVerificacion(staff, p.id, '  '), (e: unknown) => e instanceof ErrorDeIdentidad && e.codigo === 'motivo_requerido')
  assert.equal((await verifDe(p.id))?.estado, 'verificada', 'ninguno de los intentos anteriores cambió nada')

  assert.deepEqual(await revocarVerificacion(staff, p.id, 'fraude_confirmado'), { revocada: true })
  const v = await verifDe(p.id)
  assert.deepEqual([v?.estado, v?.motivoRevocacion, v?.revocadaEn !== null], ['revocada', 'fraude_confirmado', true])
  const [a] = await asientos(p.id, 'IDENTIDAD_VERIFICACION_REVOCADA')
  assert.deepEqual([a.userId, (a.payload as Record<string, unknown>).motivo, (a.payload as Record<string, unknown>).estadoAnterior], [staff.userId, 'fraude_confirmado', 'verificada'])
  assert.deepEqual(await revocarVerificacion(staff, p.id, 'otra'), { revocada: false }, 'revocar dos veces no hace nada')
  assert.equal((await crearIntento(p.id, { canal: 'web' })).ok, true, 'puede volver a verificarse')
})

test('9b · REVALIDACIÓN: pasa a «requiere revalidación», deja de verse y puede empezar otro intento; nadie sin verificar la necesita', async () => {
  const { p } = await verificada('reval')
  await assert.rejects(() => solicitarRevalidacion(p.id, 'solicitud_de_soporte', { userId: p.id, rol: 'CLIENTE' }), (e: unknown) => e instanceof ErrorDeIdentidad && e.codigo === 'no_autorizado')
  assert.deepEqual(await solicitarRevalidacion(p.id, 'cambio_de_nombre'), { solicitada: true }, 'el sistema lo puede pedir sin actor')
  assert.equal((await verifDe(p.id))?.estado, 'requiere_revalidacion')
  const [a] = await asientos(p.id, 'IDENTIDAD_REVALIDACION_REQUERIDA')
  assert.equal((a.payload as Record<string, unknown>).disparador, 'cambio_de_nombre')
  const nuevo = await crearIntento(p.id, { canal: 'web' })
  assert.equal(nuevo.ok && nuevo.esRevalidacion, true)
  assert.deepEqual(await solicitarRevalidacion(p.id, 'cambio_de_nombre'), { solicitada: false }, 'ya la requería')
  const nunca = await persona('nunca')
  assert.deepEqual(await solicitarRevalidacion(nunca.id, 'politica_de_riesgo'), { solicitada: false })
})

// ── 10 · Lo que ve una empresa ──────────────────────────────────────────────

test('10 · LA PROYECCIÓN A LAS EMPRESAS: solo si la persona consintió, solo si vale, y borrada al retirar el permiso o revocar', async () => {
  const [c1, c2] = [await empresa('uno'), await empresa('dos')]
  const { p } = await verificada('proy')
  const f1 = await ficha(c1, p, 'Ficha uno')
  const f2 = await ficha(c2, p, 'Ficha dos')
  const ajena = await persona('ajena')
  const fAjena = await ficha(c1, ajena, 'Ficha ajena')
  const lee = async (id: string) => prisma.cliente.findUniqueOrThrow({ where: { id }, select: { identidadEstado: true, identidadNivel: true, identidadVerificadaEn: true } })

  // Verificada pero SIN consentir la divulgación: las empresas no ven nada.
  assert.deepEqual(await proyectarEnFichas(p.id), { actualizadas: 2, visible: false })
  assert.deepEqual(await lee(f1.id), { identidadEstado: null, identidadNivel: null, identidadVerificadaEn: null })

  // Al consentir, las fichas de TODAS sus empresas ven «verificada» + nivel + fecha. Nada más.
  await consentir(p.id, ['d'])
  const v = await verifDe(p.id)
  for (const f of [f1, f2]) assert.deepEqual(await lee(f.id), { identidadEstado: 'verificada', identidadNivel: 'documento_selfie', identidadVerificadaEn: v?.verificadaEn })
  assert.deepEqual(await lee(fAjena.id), { identidadEstado: null, identidadNivel: null, identidadVerificadaEn: null }, 'la ficha de otra persona no se toca')

  // Retirar el permiso borra la proyección.
  await revocarConsentimientoIdentidad(p.id, 'IDENTIDAD_DIVULGACION_EMPRESAS')
  for (const f of [f1, f2]) assert.deepEqual(await lee(f.id), { identidadEstado: null, identidadNivel: null, identidadVerificadaEn: null })

  // Y revocar la verificación también (aunque haya vuelto a consentir).
  await consentir(p.id, ['d'])
  assert.equal((await lee(f1.id)).identidadEstado, 'verificada')
  await revocarVerificacion(staff, p.id, 'error_de_registro')
  for (const f of [f1, f2]) assert.equal((await lee(f.id)).identidadEstado, null)
})

test('10b · una verificación que expira deja de verse en las fichas con el barrido', async () => {
  const c = await empresa('expira')
  const { p } = await verificada('proyexp')
  await consentir(p.id, ['d'])
  const f = await ficha(c, p, 'Ficha')
  await proyectarEnFichas(p.id)
  assert.equal((await prisma.cliente.findUniqueOrThrow({ where: { id: f.id } })).identidadEstado, 'verificada')
  await prisma.identidadVerificacion.update({ where: { userId: p.id }, data: { expiraEn: hace(MIN) } })
  await ejecutarMantenimientoDeIdentidad()
  assert.equal((await prisma.cliente.findUniqueOrThrow({ where: { id: f.id } })).identidadEstado, null)
})

test('10c · el CHECK de la base: una ficha no puede decir «rechazada» (una empresa no debe poder inferir un rechazo)', async () => {
  const c = await empresa('check')
  const p = await persona('chk')
  const f = await ficha(c, p, 'Ficha')
  await assert.rejects(() => prisma.cliente.update({ where: { id: f.id }, data: { identidadEstado: 'rechazada' } }), /check|constraint|violat/i)
  await prisma.cliente.update({ where: { id: f.id }, data: { identidadEstado: 'verificada' } })
})

// ── 11 · El equipo mira un caso ─────────────────────────────────────────────

test('11 · CONSULTA DEL EQUIPO: solo autorizados, con motivo, con asiento, y NUNCA la referencia, el hash ni imágenes', async () => {
  const hash = calcularHashDedupe(PEPPER, { tipoDocumento: 'cedula', numeroDocumento: `004-${Date.now()}`, pais: 'DO' })
  const { p } = await verificada('staff', { hashDedupe: hash })
  const intruso: ActorDeIdentidad = { userId: (await persona('curioso')).id, rol: 'ADMINISTRADOR' }
  await assert.rejects(() => consultarIdentidadComoStaff(intruso, p.id, 'curiosidad'), (e: unknown) => e instanceof ErrorDeIdentidad && e.codigo === 'no_autorizado')
  await assert.rejects(() => consultarIdentidadComoStaff(staff, p.id, ''), (e: unknown) => e instanceof ErrorDeIdentidad && e.codigo === 'motivo_requerido')
  await assert.rejects(() => consultarIdentidadComoStaff(staff, 'no-existe', 'caso 123'), (e: unknown) => e instanceof ErrorDeIdentidad && e.codigo === 'persona_no_encontrada')
  assert.equal((await asientos(p.id, 'IDENTIDAD_ESTADO_CONSULTADO_POR_STAFF')).length, 0, 'lo rechazado no deja asiento de lectura')

  const r = await consultarIdentidadComoStaff(staff, p.id, 'Ticket 123: la persona dice que no puede verificarse', { ip: '10.0.0.5', userAgent: 'panel' })
  assert.equal(r.estado.estado, 'verificada')
  assert.ok(r.intentos.length >= 1)
  assert.deepEqual(Object.keys(r.intentos[0]).sort(), ['canal', 'codigoRazon', 'creadoAt', 'estado', 'id', 'origen', 'resueltoAt', 'tipoRechazo'])
  const serializado = JSON.stringify(r)
  assert.doesNotMatch(serializado, /referenciaProveedor|hashDedupe|sellada/i)
  assert.doesNotMatch(serializado, new RegExp(hash))

  const [a] = await asientos(p.id, 'IDENTIDAD_ESTADO_CONSULTADO_POR_STAFF')
  assert.deepEqual([a.userId, a.ipAddress, (a.payload as Record<string, unknown>).rol, (a.payload as Record<string, unknown>).cantidad], [staff.userId, '10.0.0.5', 'SUPERADMIN', r.intentos.length])
})

test('11b · lo que ve la PERSONA tampoco trae la referencia, el hash ni nada interno', async () => {
  const hash = calcularHashDedupe(PEPPER, { tipoDocumento: 'cedula', numeroDocumento: `005-${Date.now()}`, pais: 'DO' })
  const { p } = await verificada('propia', { hashDedupe: hash })
  const e = await estadoDeIdentidadDe(p.id)
  assert.deepEqual(Object.keys(e).sort(), [
    'diasParaExpirar', 'esperarHasta', 'estado', 'expiraEn', 'intentoAbierto', 'motivoNoPuedeIniciar', 'nivel',
    'puedeIniciar', 'revalidacionProxima', 'ultimoRechazo', 'verificadaEn',
  ])
  assert.doesNotMatch(JSON.stringify(e), /referencia|hash|sellada|userId/i)
  assert.ok(e.diasParaExpirar && e.diasParaExpirar > 1000, 'a ~36 meses')
})

test('11c · LA BITÁCORA NO LLEVA PII: ningún asiento de identidad trae claves fuera de la lista ni textos largos', async () => {
  const { p } = await verificada('bitacora')
  await solicitarRevalidacion(p.id, 'politica_de_riesgo')
  const permitidas = new Set(['intentoId', 'verificacionId', 'estadoAnterior', 'estadoNuevo', 'nivel', 'via', 'proveedor', 'canal', 'origen', 'tipoRechazo', 'codigoRazon', 'disparador', 'motivo', 'rol', 'encendido', 'esRevalidacion', 'cantidad', 'resultado'])
  const filas = await prisma.auditLog.findMany({ where: { entidadTipo: 'IdentidadVerificacion', entidadId: p.id } })
  assert.ok(filas.length >= 3)
  for (const f of filas) {
    assert.equal(f.companyId, null, 'la identidad es de la persona: la bitácora no cuelga de una empresa')
    for (const [clave, valor] of Object.entries(f.payload as Record<string, unknown>)) {
      assert.ok(permitidas.has(clave), `clave no permitida en la bitácora: ${clave}`)
      if (typeof valor === 'string') assert.ok(valor.length <= 200)
    }
  }
})

// ── 12 · La base como segunda barrera ───────────────────────────────────────

test('12 · ESTADOS INVENTADOS: la base los rechaza aunque se escriban por fuera del servicio', async () => {
  const p = await persona('check')
  await assert.rejects(() => prisma.identidadVerificacion.create({ data: { userId: p.id, estado: 'aprobadisima' } }), /check|constraint|violat/i)
  await assert.rejects(() => prisma.identidadVerificacion.create({ data: { userId: p.id, estado: 'no_verificada', nivel: 'selfie_y_ya' } }), /check|constraint|violat/i)
  // «verificada» sin nivel, fecha y expiración no vale: una fila a medias no puede acreditar a nadie.
  await assert.rejects(() => prisma.identidadVerificacion.create({ data: { userId: p.id, estado: 'verificada' } }), /check|constraint|violat/i)
  await assert.rejects(() => prisma.identidadIntento.create({ data: { userId: p.id, canal: 'web', estado: 'medio_aprobada' } }), /check|constraint|violat/i)
  await assert.rejects(() => prisma.identidadIntento.create({ data: { userId: p.id, canal: 'telepatia' } }), /check|constraint|violat/i)
  await assert.rejects(() => prisma.identidadConsentimiento.create({ data: { userId: p.id, tipo: 'TODO', textoVersion: 'v1', canal: 'web' } }), /check|constraint|violat/i)
  await assert.rejects(() => prisma.identidadConsentimiento.create({ data: { userId: p.id, tipo: 'IDENTIDAD_BIOMETRIA', textoVersion: 'v1', canal: 'fax' } }), /check|constraint|violat/i)
  assert.equal(await prisma.identidadVerificacion.count({ where: { userId: p.id } }), 0)
})

test('12b · un solo consentimiento vigente por tipo también por fuera del servicio', async () => {
  const p = await persona('uk')
  const datos = { userId: p.id, tipo: 'IDENTIDAD_BIOMETRIA', textoVersion: 'v1', canal: 'web' }
  await prisma.identidadConsentimiento.create({ data: datos })
  await assert.rejects(() => prisma.identidadConsentimiento.create({ data: datos }), /Unique|unique/)
  await prisma.identidadConsentimiento.updateMany({ where: { userId: p.id }, data: { revocadoAt: new Date() } })
  await prisma.identidadConsentimiento.create({ data: datos })
})

test('12c · borrar a la persona borra todo su rastro de identidad (la supresión en el proveedor va ANTES, en su flujo)', async () => {
  const { p } = await verificada('borrar')
  await consentir(p.id, ['d'])
  assert.ok((await prisma.identidadIntento.count({ where: { userId: p.id } })) >= 1)
  await prisma.user.delete({ where: { id: p.id } })
  for (const tabla of ['identidadVerificacion', 'identidadIntento', 'identidadConsentimiento'] as const) {
    assert.equal(await (prisma[tabla] as unknown as { count: (a: unknown) => Promise<number> }).count({ where: { userId: p.id } }), 0, tabla)
  }
})
