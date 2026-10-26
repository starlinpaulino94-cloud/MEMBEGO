/**
 * CONSENTIMIENTOS SOBRE LA TARJETA GUARDADA · contra PostgreSQL real.
 *
 * GUARDAR la tarjeta y RENOVAR automáticamente son DOS consentimientos con DOS operaciones: el primero permite pagos que
 * el cliente inicia, el segundo cobros SIN él. La tabla `consentimientos_pago` es la evidencia de cuándo, con qué texto y
 * desde dónde aceptó cada uno, y de cuándo lo retiró. Cada prueba falla si vuelve el defecto que cierra:
 *
 *   1 · una tarjeta guardada sin constancia de que se aceptó (o la constancia sin la tarjeta);
 *   2 · dos peticiones a la vez que dejan DOS consentimientos vigentes;
 *   3 · cambiar la renovación a otra tarjeta sin que quede dicho qué tarjeta estuvo autorizada en cada momento;
 *   4 · quitar una tarjeta y dejar vigente lo que el cliente aceptó sobre ella;
 *   5 · una revocación sin alcance, que retiraría el consentimiento de todo el mundo;
 *   6 · una renovación que cobra sin un consentimiento vigente.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import { eliminarTarjeta, guardarTarjeta, renovarMembresiaPorTarjeta } from '../../src/modules/pagos/cardnetTokenGuardado'
import {
  consentimientoVigente,
  otorgarConsentimiento,
  revocarConsentimientos,
  tieneConsentimientoVigente,
} from '../../src/modules/pagos/consentimientos'
import { TEXTO_VERSION_GUARDAR_MOVIL, TEXTO_VERSION_GUARDAR_WEB } from '../../src/modules/pagos/consentimientosCore'

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const H = 3_600_000
const DIA = 24 * H
const hace = (ms: number) => new Date(Date.now() - ms)

let fetchOriginal: typeof fetch
const anterior = {
  pub: process.env.CARDNET_TOKENS_PUBLIC_KEY,
  priv: process.env.CARDNET_TOKENS_PRIVATE_KEY,
  vault: process.env.CARDNET_VAULT_KEY,
  base: process.env.CARDNET_TOKENS_API_BASE,
}
let llamadas = 0
before(() => {
  fetchOriginal = globalThis.fetch
  process.env.CARDNET_TOKENS_PUBLIC_KEY = 'prueba-prueba-prueba'
  process.env.CARDNET_TOKENS_PRIVATE_KEY = 'prueba-prueba-prueba'
  process.env.CARDNET_VAULT_KEY = Buffer.alloc(32, 3).toString('base64')
  process.env.CARDNET_TOKENS_API_BASE = 'https://cardnet.prueba.test/api'
  // El borrado del perfil en CardNET y, en la prueba 6, el cobro: ambos responden bien.
  globalThis.fetch = (async () => {
    llamadas++
    return new Response(
      JSON.stringify({ Response: { Transaction: { TransactionStatusId: 1, ResponseCode: '00', AuthorizationCode: 'AUTH-C' } }, Errors: [] }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }) as typeof fetch
})
after(() => {
  globalThis.fetch = fetchOriginal
  for (const [clave, valor] of [
    ['CARDNET_TOKENS_PUBLIC_KEY', anterior.pub],
    ['CARDNET_TOKENS_PRIVATE_KEY', anterior.priv],
    ['CARDNET_VAULT_KEY', anterior.vault],
    ['CARDNET_TOKENS_API_BASE', anterior.base],
  ] as const) {
    if (valor === undefined) delete process.env[clave]
    else process.env[clave] = valor
  }
})

async function empresa(etiqueta: string) {
  const c = await prisma.company.create({
    data: {
      name: `Consent ${etiqueta} ${sufijo}`,
      slug: `consent-${etiqueta}-${sufijo}`,
      type: 'carwash',
      ciudad: 'Santo Domingo',
      capacidades: { overrides: { PAGO_CARDNET: true } },
    },
    select: { id: true },
  })
  const plan = await prisma.plan.create({
    data: { companyId: c.id, nombre: `Plan ${etiqueta}`, precio: 500, vigenciaDias: 30, lavadosIncluidos: 4 },
    select: { id: true },
  })
  return { companyId: c.id, planId: plan.id }
}
type Empresa = Awaited<ReturnType<typeof empresa>>

let n = 0
async function cliente(e: Empresa) {
  const k = n++
  return (
    await prisma.cliente.create({
      data: { companyId: e.companyId, supabaseId: `sb-cs-${sufijo}-${k}`, nombre: `Cliente ${k}`, email: `cs-${sufijo}-${k}@prueba.test` },
      select: { id: true },
    })
  ).id
}

const contexto = { textoVersion: TEXTO_VERSION_GUARDAR_WEB, ip: '190.80.12.5', userAgent: 'prueba-consentimientos' }
let perfilN = 0
function guardar(e: Empresa, clienteId: string, perfil = `pp-cs-${sufijo}-${perfilN++}`, consentimiento = contexto) {
  return guardarTarjeta({
    companyId: e.companyId,
    clienteId,
    customerId: `cust-cs-${sufijo}-${clienteId}`,
    paymentProfileId: perfil,
    token: `CT__${perfil}`,
    marca: 'VISA',
    ultimos4: '4242',
    consentimiento,
  })
}
const filas = (where: Record<string, unknown>) => prisma.consentimientoPago.findMany({ where, orderBy: { otorgadoAt: 'asc' } })

test('1 · guardar una tarjeta deja SU constancia en la misma transacción: tipo, texto, IP y agente', async () => {
  const e = await empresa('uno')
  const c = await cliente(e)
  const t = await guardar(e, c)
  const [f] = await filas({ tarjetaId: t.id })
  assert.deepEqual(
    [f.tipo, f.membershipId, f.origen, f.textoVersion, f.ipAddress, f.userAgent, f.revocadoAt],
    ['GUARDAR_TARJETA', null, 'CLIENTE', TEXTO_VERSION_GUARDAR_WEB, '190.80.12.5', 'prueba-consentimientos', null]
  )
  // Guardar NO enciende la renovación ni su consentimiento: son cosas distintas.
  assert.equal(await prisma.consentimientoPago.count({ where: { clienteId: c, tipo: 'RENOVACION_AUTOMATICA' } }), 0)
})

test('1b · una IP que no es una IP («unknown») no se guarda como si lo fuera; la app móvil no inventa lo que no tiene', async () => {
  const e = await empresa('unob')
  const c = await cliente(e)
  const web = await guardar(e, c, undefined, { textoVersion: TEXTO_VERSION_GUARDAR_WEB, ip: 'unknown', userAgent: null as unknown as string })
  const [a] = await filas({ tarjetaId: web.id })
  assert.deepEqual([a.ipAddress, a.userAgent], [null, null])
  const movil = await guardar(e, c, undefined, { textoVersion: TEXTO_VERSION_GUARDAR_MOVIL, ip: null as unknown as string, userAgent: null as unknown as string })
  const [b] = await filas({ tarjetaId: movil.id })
  assert.deepEqual([b.textoVersion, b.ipAddress, b.userAgent], [TEXTO_VERSION_GUARDAR_MOVIL, null, null])
})

test('1c · guardar otra vez el MISMO perfil no duplica la tarjeta ni el consentimiento, ni reescribe su fecha', async () => {
  const e = await empresa('unoc')
  const c = await cliente(e)
  const primero = await guardar(e, c, 'pp-cs-mismo-' + sufijo)
  const [antes] = await filas({ tarjetaId: primero.id })
  const segundo = await guardar(e, c, 'pp-cs-mismo-' + sufijo)
  assert.equal(segundo.id, primero.id)
  const todas = await filas({ tarjetaId: primero.id })
  assert.equal(todas.length, 1)
  assert.equal(todas[0].otorgadoAt.getTime(), antes.otorgadoAt.getTime())
})

test('2 · peticiones a la vez del mismo cliente NO dejan dos consentimientos vigentes', async () => {
  const e = await empresa('dos')
  const c = await cliente(e)
  const t = await guardar(e, c)
  // El mismo consentimiento de renovar, pedido 10 veces a la vez, cada una en su transacción.
  const m = await prisma.membership.create({
    data: { companyId: e.companyId, clienteId: c, planId: e.planId, estado: 'ACTIVA', autoRenovar: true, tarjetaTokenizadaId: t.id },
    select: { id: true },
  })
  const resultados = await Promise.all(
    Array.from({ length: 10 }, () =>
      conEmpresa(e.companyId, (tx) =>
        otorgarConsentimiento(tx, { companyId: e.companyId, clienteId: c, tipo: 'RENOVACION_AUTOMATICA', tarjetaId: t.id, membershipId: m.id, contexto })
      )
    )
  )
  assert.equal(resultados.filter((r) => r.creado).length, 1, 'uno crea y los demás ven el suyo')
  assert.equal(new Set(resultados.map((r) => r.id)).size, 1)
  assert.equal(await prisma.consentimientoPago.count({ where: { membershipId: m.id, tipo: 'RENOVACION_AUTOMATICA', revocadoAt: null } }), 1)
})

test('2b · dos guardados SIMULTÁNEOS del mismo perfil dejan UNA tarjeta y UN consentimiento vigente', async () => {
  const e = await empresa('dosb')
  const c = await cliente(e)
  const perfil = `pp-cs-carrera-${sufijo}`
  // Antes algunas FALLABAN: la recuperación de la carrera consultaba dentro de la transacción que la violación única
  // acababa de abortar (25P02). Ahora se repite en una transacción nueva, y TODAS terminan bien con la misma tarjeta.
  const r = await Promise.allSettled(Array.from({ length: 6 }, () => guardar(e, c, perfil)))
  const tarjetas = await prisma.tarjetaTokenizada.findMany({ where: { clienteId: c, paymentProfileId: perfil, activa: true } })
  assert.equal(tarjetas.length, 1, 'una sola tarjeta activa para el perfil')
  assert.equal(await prisma.consentimientoPago.count({ where: { tarjetaId: tarjetas[0].id, tipo: 'GUARDAR_TARJETA', revocadoAt: null } }), 1)
  assert.deepEqual(
    r.map((x) => x.status),
    Array(6).fill('fulfilled'),
    `alguna petición falló: ${r.filter((x) => x.status === 'rejected').map((x) => String((x as PromiseRejectedResult).reason)).join(' | ')}`
  )
  assert.ok(r.every((x) => x.status === 'fulfilled' && x.value.id === tarjetas[0].id), 'todas devuelven la misma tarjeta')
})

test('3 · renovar con OTRA tarjeta retira el consentimiento de la anterior y deja uno nuevo: el historial dice qué tarjeta estuvo autorizada', async () => {
  const e = await empresa('tres')
  const c = await cliente(e)
  const t1 = await guardar(e, c)
  const t2 = await guardar(e, c)
  const m = await prisma.membership.create({
    data: { companyId: e.companyId, clienteId: c, planId: e.planId, estado: 'ACTIVA', autoRenovar: true, tarjetaTokenizadaId: t1.id },
    select: { id: true },
  })
  const otorgar = (tarjetaId: string) =>
    conEmpresa(e.companyId, (tx) =>
      otorgarConsentimiento(tx, { companyId: e.companyId, clienteId: c, tipo: 'RENOVACION_AUTOMATICA', tarjetaId, membershipId: m.id, contexto })
    )
  await otorgar(t1.id)
  await otorgar(t2.id)
  const historial = await filas({ membershipId: m.id, tipo: 'RENOVACION_AUTOMATICA' })
  assert.deepEqual(historial.map((f) => [f.tarjetaId === t1.id ? 't1' : 't2', f.revocadoAt !== null]), [['t1', true], ['t2', false]])
})

test('3b · una renovación sin membresía no es un consentimiento: no se puede registrar', async () => {
  const e = await empresa('tresb')
  const c = await cliente(e)
  const t = await guardar(e, c)
  await assert.rejects(
    conEmpresa(e.companyId, (tx) =>
      otorgarConsentimiento(tx, { companyId: e.companyId, clienteId: c, tipo: 'RENOVACION_AUTOMATICA', tarjetaId: t.id, contexto })
    ),
    /exige una membresía/
  )
})

test('4 · quitar una tarjeta retira lo que se aceptó sobre ella y apaga la renovación; las filas NO se borran', async () => {
  const e = await empresa('cuatro')
  const c = await cliente(e)
  const t = await guardar(e, c)
  const otra = await guardar(e, c)
  const m = await prisma.membership.create({
    data: { companyId: e.companyId, clienteId: c, planId: e.planId, estado: 'ACTIVA', autoRenovar: true, tarjetaTokenizadaId: t.id },
    select: { id: true },
  })
  await conEmpresa(e.companyId, (tx) =>
    otorgarConsentimiento(tx, { companyId: e.companyId, clienteId: c, tipo: 'RENOVACION_AUTOMATICA', tarjetaId: t.id, membershipId: m.id, contexto })
  )

  const r = await eliminarTarjeta(t.id, c, e.companyId)
  assert.ok(['eliminada', 'pendiente'].includes(r), r)
  assert.equal((await prisma.membership.findUniqueOrThrow({ where: { id: m.id } })).autoRenovar, false)
  const suyas = await filas({ tarjetaId: t.id })
  assert.equal(suyas.length, 2, 'el de guardar y el de renovar siguen ahí')
  assert.ok(suyas.every((f) => f.revocadoAt !== null), 'los dos retirados')
  // La otra tarjeta del cliente NO se toca.
  assert.equal(await prisma.consentimientoPago.count({ where: { tarjetaId: otra.id, revocadoAt: null } }), 1)
})

test('5 · revocar exige alcance: una revocación sin tarjeta ni membresía lanzaría el consentimiento de todo el mundo', async () => {
  const e = await empresa('cinco')
  const c = await cliente(e)
  const t = await guardar(e, c)
  await assert.rejects(conEmpresa(e.companyId, (tx) => revocarConsentimientos(tx, {})), /hace falta tarjetaId o membershipId/)
  assert.equal(await prisma.consentimientoPago.count({ where: { tarjetaId: t.id, revocadoAt: null } }), 1, 'no se tocó nada')
  // Con alcance, solo retira lo que dice.
  const n1 = await conEmpresa(e.companyId, (tx) => revocarConsentimientos(tx, { tarjetaId: t.id }))
  assert.equal(n1, 1)
  assert.equal(await conEmpresa(e.companyId, (tx) => revocarConsentimientos(tx, { tarjetaId: t.id })), 0, 'idempotente: ya estaba retirado')
})

test('6 · el cobro automático exige un consentimiento VIGENTE: sin él, o retirado, no cobra', async () => {
  const e = await empresa('seis')
  const c = await cliente(e)
  const t = await guardar(e, c)
  const m = await prisma.membership.create({
    data: {
      companyId: e.companyId, clienteId: c, planId: e.planId, estado: 'ACTIVA', pagoConfirmado: true, autoRenovar: true,
      tarjetaTokenizadaId: t.id, fechaPago: hace(29 * DIA), fechaInicio: hace(29 * DIA), fechaVencimiento: new Date(Date.now() + 10 * H),
    },
    select: { id: true },
  })
  const antes = llamadas
  const sin = await renovarMembresiaPorTarjeta(m.id, '127.0.0.1')
  assert.equal(sin.estado, 'omitida', 'autoRenovar por sí solo no basta')
  assert.match('motivo' in sin ? sin.motivo : '', /consentimiento/)
  assert.equal(llamadas, antes, 'no se llamó a la pasarela')

  await conEmpresa(e.companyId, (tx) =>
    otorgarConsentimiento(tx, { companyId: e.companyId, clienteId: c, tipo: 'RENOVACION_AUTOMATICA', tarjetaId: t.id, membershipId: m.id, contexto })
  )
  assert.equal(await conEmpresa(e.companyId, (tx) => tieneConsentimientoVigente(tx, { tipo: 'RENOVACION_AUTOMATICA', membershipId: m.id })), true)
  const v = await conEmpresa(e.companyId, (tx) => consentimientoVigente(tx, { tipo: 'RENOVACION_AUTOMATICA', membershipId: m.id }))
  assert.deepEqual([v?.textoVersion, v?.origen], [TEXTO_VERSION_GUARDAR_WEB, 'CLIENTE'])

  // Retirado: otra vez no cobra.
  await conEmpresa(e.companyId, (tx) => revocarConsentimientos(tx, { tipo: 'RENOVACION_AUTOMATICA', membershipId: m.id }))
  assert.equal(await conEmpresa(e.companyId, (tx) => consentimientoVigente(tx, { tipo: 'RENOVACION_AUTOMATICA', membershipId: m.id })), null)
  const retirado = await renovarMembresiaPorTarjeta(m.id, '127.0.0.1')
  assert.equal(retirado.estado, 'omitida')
  assert.equal(llamadas, antes)
})

test('7 · la base garantiza lo que el código promete: tipos y orígenes válidos, un solo consentimiento vigente', async () => {
  const e = await empresa('siete')
  const c = await cliente(e)
  const t = await guardar(e, c)
  const insertar = (datos: Record<string, unknown>) =>
    prisma.consentimientoPago.create({ data: { companyId: e.companyId, clienteId: c, textoVersion: 'x', ...datos } as never })
  await assert.rejects(insertar({ tipo: 'OTRA_COSA', tarjetaId: t.id }), /consentimientos_pago_tipo_chk|check/i)
  await assert.rejects(insertar({ tipo: 'GUARDAR_TARJETA', tarjetaId: t.id, origen: 'INVENTADO' }), /consentimientos_pago_origen_chk|check/i)
  // Ya hay uno vigente de guardar para esta tarjeta (lo dejó `guardar`): otro vigente choca con el índice parcial.
  await assert.rejects(insertar({ tipo: 'GUARDAR_TARJETA', tarjetaId: t.id }), /consentimientos_pago_vigente_tarjeta_uk|Unique/i)
})
