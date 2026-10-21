/**
 * ACTIVAR Y DESACTIVAR LA RENOVACIÓN AUTOMÁTICA DESDE LA APP · contra PostgreSQL real.
 *
 * Encender la renovación autoriza cobros SIN el cliente: es un consentimiento y se registra como tal, en la misma
 * transacción que la enciende. Cada prueba falla si vuelve el defecto que cierra:
 *
 *   1 · encender sin dejar constancia de lo que se aceptó (o dejar la constancia sin encender);
 *   2 · encender en una membresía o con una tarjeta con la que el cobro después se negaría (y prometerle al cliente algo
 *       que no va a pasar): cancelada, con cambio de plan, plan gratis, tarjeta ajena/vencida/sin perfil;
 *   3 · cambiar de tarjeta sin que quede dicho cuál estuvo autorizada;
 *   4 · confirmar una renovación HEREDADA y que siga sin texto;
 *   5 · apagar sin retirar el consentimiento, o que un «activar» y un «desactivar» a la vez dejen la renovación
 *       encendida sin consentimiento;
 *   6 · decir «se renueva sola» cuando el cobro no la intentaría;
 *   7 · que lo que se enciende desde la pantalla NO llegue a cobrarse.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { renovarMembresiaPorTarjeta } from '../../src/modules/pagos/cardnetTokenGuardado'
import {
  activarRenovacion,
  desactivarRenovacion,
  estadoRenovacion,
  tarjetasParaRenovar,
} from '../../src/modules/pagos/renovacionCliente'
import { ejecutarAvisosDeRenovacion } from '../../src/modules/pagos/avisosRenovacion'
import { TEXTO_VERSION_RENOVACION } from '../../src/modules/pagos/consentimientosCore'

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const H = 3_600_000
const DIA = 24 * H
const hace = (ms: number) => new Date(Date.now() - ms)
const adelante = (ms: number) => new Date(Date.now() + ms)

let fetchOriginal: typeof fetch
let cobros = 0
const anterior = {
  pub: process.env.CARDNET_TOKENS_PUBLIC_KEY,
  priv: process.env.CARDNET_TOKENS_PRIVATE_KEY,
  base: process.env.CARDNET_TOKENS_API_BASE,
}
before(() => {
  fetchOriginal = globalThis.fetch
  process.env.CARDNET_TOKENS_PUBLIC_KEY = 'prueba-prueba-prueba'
  process.env.CARDNET_TOKENS_PRIVATE_KEY = 'prueba-prueba-prueba'
  process.env.CARDNET_TOKENS_API_BASE = 'https://cardnet.prueba.test/api'
  globalThis.fetch = (async () => {
    cobros++
    return new Response(
      JSON.stringify({
        Response: { Transaction: { TransactionStatusId: 1, ResponseCode: '00', AuthorizationCode: `AUTH-${cobros}` } },
        Errors: [],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }) as typeof fetch
})
after(() => {
  globalThis.fetch = fetchOriginal
  for (const [clave, valor] of [
    ['CARDNET_TOKENS_PUBLIC_KEY', anterior.pub],
    ['CARDNET_TOKENS_PRIVATE_KEY', anterior.priv],
    ['CARDNET_TOKENS_API_BASE', anterior.base],
  ] as const) {
    if (valor === undefined) delete process.env[clave]
    else process.env[clave] = valor
  }
})

async function empresa(etiqueta: string, precio = 500) {
  const c = await prisma.company.create({
    data: {
      name: `Activar ${etiqueta} ${sufijo}`,
      slug: `activar-${etiqueta}-${sufijo}`,
      type: 'carwash',
      ciudad: 'Santo Domingo',
      capacidades: { overrides: { PAGO_CARDNET: true } },
    },
    select: { id: true },
  })
  const plan = await prisma.plan.create({
    data: { companyId: c.id, nombre: `Plan ${etiqueta}`, precio, vigenciaDias: 30, lavadosIncluidos: 4 },
    select: { id: true },
  })
  return { companyId: c.id, planId: plan.id }
}
type Empresa = Awaited<ReturnType<typeof empresa>>

let n = 0
async function cliente(e: Empresa, conCuenta = true) {
  const k = n++
  const c = await prisma.cliente.create({
    data: { companyId: e.companyId, supabaseId: `sb-ac-${sufijo}-${k}`, nombre: `Cliente ${k}`, email: `ac-${sufijo}-${k}@prueba.test` },
    select: { id: true, supabaseId: true },
  })
  if (conCuenta) {
    await prisma.user.create({
      data: { supabaseId: c.supabaseId, email: `u-ac-${sufijo}-${k}@prueba.test`, name: `Cliente ${k}`, companyId: e.companyId },
    })
  }
  return c
}
async function tarjeta(e: Empresa, clienteId: string, extra: Record<string, unknown> = {}) {
  const k = n++
  return prisma.tarjetaTokenizada.create({
    data: {
      companyId: e.companyId,
      clienteId,
      customerId: `cust-ac-${sufijo}-${clienteId}`,
      paymentProfileId: `pp-ac-${sufijo}-${k}`,
      token: 'CT__sintetico',
      marca: 'VISA',
      ultimos4: '4242',
      activa: true,
      ...extra,
    } as never,
    select: { id: true },
  })
}
async function membresia(e: Empresa, clienteId: string, extra: Record<string, unknown> = {}) {
  return prisma.membership.create({
    data: {
      companyId: e.companyId,
      clienteId,
      planId: e.planId,
      estado: 'ACTIVA',
      pagoConfirmado: true,
      montoPagado: 500,
      fechaPago: hace(20 * DIA),
      fechaInicio: hace(20 * DIA),
      fechaVencimiento: adelante(10 * DIA),
      ...extra,
    } as never,
    select: { id: true },
  })
}
const contexto = { textoVersion: TEXTO_VERSION_RENOVACION, ip: '190.80.12.5', userAgent: 'prueba-activar' }
const activar = (e: Empresa, clienteId: string, membershipId: string, tarjetaId: string) =>
  activarRenovacion({ companyId: e.companyId, clienteId, membershipId, tarjetaId, contexto })
const filas = (membershipId: string) =>
  prisma.consentimientoPago.findMany({ where: { membershipId, tipo: 'RENOVACION_AUTOMATICA' }, orderBy: { otorgadoAt: 'asc' } })
const mem = (id: string) => prisma.membership.findUniqueOrThrow({ where: { id } })

test('1 · activar enciende la renovación Y deja SU constancia: tipo, texto, IP, agente, tarjeta y membresía', async () => {
  const e = await empresa('uno')
  const c = await cliente(e)
  const t = await tarjeta(e, c.id)
  const m = await membresia(e, c.id)
  assert.equal(await activar(e, c.id, m.id, t.id), 'ok')
  const mm = await mem(m.id)
  assert.deepEqual([mm.autoRenovar, mm.tarjetaTokenizadaId], [true, t.id])
  const [f, ...resto] = await filas(m.id)
  assert.equal(resto.length, 0)
  assert.deepEqual(
    [f?.origen, f?.textoVersion, f?.ipAddress, f?.userAgent, f?.tarjetaId, f?.revocadoAt],
    ['CLIENTE', TEXTO_VERSION_RENOVACION, '190.80.12.5', 'prueba-activar', t.id, null]
  )
  // Doble clic / reintento: no duplica ni reescribe la fecha.
  assert.equal(await activar(e, c.id, m.id, t.id), 'ok')
  const despues = await filas(m.id)
  assert.equal(despues.length, 1)
  assert.equal(despues[0]?.otorgadoAt.getTime(), f?.otorgadoAt.getTime())
})

test('2 · NO se enciende donde el cobro después se negaría: cada caso dice por qué y no deja nada a medias', async () => {
  const e = await empresa('dos')
  const gratis = await prisma.plan.create({
    data: { companyId: e.companyId, nombre: `Gratis ${sufijo}`, precio: 0, vigenciaDias: 30, lavadosIncluidos: 1 },
    select: { id: true },
  })
  // Un cliente puede tener UNA membresía por empresa: cada caso trae el suyo.
  const casos: {
    nombre: string
    esperado: string
    membresia?: Record<string, unknown>
    tarjeta?: Record<string, unknown>
    deOtro?: boolean
  }[] = [
    { nombre: 'cancelada', esperado: 'membresia_no_activa', membresia: { estado: 'CANCELADA' } },
    { nombre: 'vencida', esperado: 'membresia_no_activa', membresia: { estado: 'VENCIDA' } },
    { nombre: 'pendiente de pago', esperado: 'membresia_no_activa', membresia: { estado: 'PENDIENTE_PAGO' } },
    { nombre: 'cancelación programada', esperado: 'cancelacion_programada', membresia: { canceladaAlVencimiento: new Date() } },
    { nombre: 'cambio de plan por pagar', esperado: 'cambio_de_plan_pendiente', membresia: { planIdSolicitado: e.planId } },
    { nombre: 'plan gratis', esperado: 'plan_sin_precio', membresia: { planId: gratis.id } },
    { nombre: 'tarjeta de OTRO cliente', esperado: 'tarjeta_no_encontrada', deOtro: true },
    { nombre: 'tarjeta quitada', esperado: 'tarjeta_no_encontrada', tarjeta: { activa: false } },
    { nombre: 'tarjeta vencida', esperado: 'tarjeta_vencida', tarjeta: { vencMes: 1, vencAnio: 2020 } },
    {
      nombre: 'tarjeta sin perfil ni token',
      esperado: 'tarjeta_sin_perfil',
      tarjeta: { paymentProfileId: null, token: null, tokenCifrado: null },
    },
  ]
  for (const caso of casos) {
    const c = await cliente(e)
    const otro = await cliente(e)
    const tj = await tarjeta(e, caso.deOtro ? otro.id : c.id, caso.tarjeta)
    const m = await membresia(e, c.id, caso.membresia)
    assert.equal(await activar(e, c.id, m.id, tj.id), caso.esperado, caso.nombre)
    const mm = await mem(m.id)
    assert.equal(mm.autoRenovar, false, `${caso.nombre}: no se enciende`)
    assert.equal((await filas(m.id)).length, 0, `${caso.nombre}: no deja consentimiento`)
  }
  // La membresía de OTRA persona: no existe para este cliente.
  const c = await cliente(e)
  const otro = await cliente(e)
  const t = await tarjeta(e, c.id)
  const ajena = await membresia(e, otro.id)
  assert.equal(await activar(e, c.id, ajena.id, t.id), 'membresia_no_encontrada')
  assert.equal((await mem(ajena.id)).autoRenovar, false)
})

test('3 · cambiar de tarjeta retira el consentimiento de la anterior y registra uno nuevo: el historial dice cuál estuvo autorizada', async () => {
  const e = await empresa('tres')
  const c = await cliente(e)
  const t1 = await tarjeta(e, c.id)
  const t2 = await tarjeta(e, c.id)
  const m = await membresia(e, c.id)
  assert.equal(await activar(e, c.id, m.id, t1.id), 'ok')
  assert.equal(await activar(e, c.id, m.id, t2.id), 'ok')
  const f = await filas(m.id)
  assert.deepEqual(f.map((x) => [x.tarjetaId, x.revocadoAt === null]), [[t1.id, false], [t2.id, true]])
  assert.equal((await mem(m.id)).tarjetaTokenizadaId, t2.id)
})

test('4 · confirmar una renovación HEREDADA la sustituye por un consentimiento de cliente, con el texto que vio', async () => {
  const e = await empresa('cuatro')
  const c = await cliente(e)
  const t = await tarjeta(e, c.id)
  const m = await membresia(e, c.id, { autoRenovar: true, tarjetaTokenizadaId: t.id })
  await prisma.consentimientoPago.create({
    data: { companyId: e.companyId, clienteId: c.id, tipo: 'RENOVACION_AUTOMATICA', tarjetaId: t.id, membershipId: m.id, origen: 'HEREDADO', textoVersion: 'previo-a-registro' },
  })
  const antes = await estadoRenovacion(e.companyId, m.id)
  assert.deepEqual([antes.activa, antes.origen], [true, 'HEREDADO'])

  assert.equal(await activar(e, c.id, m.id, t.id), 'ok')
  const f = await filas(m.id)
  assert.deepEqual(
    f.map((x) => [x.origen, x.textoVersion, x.revocadoAt === null]),
    [['HEREDADO', 'previo-a-registro', false], ['CLIENTE', TEXTO_VERSION_RENOVACION, true]]
  )
  const despues = await estadoRenovacion(e.companyId, m.id)
  assert.deepEqual([despues.activa, despues.origen], [true, 'CLIENTE'])
})

test('5 · desactivar apaga, retira el consentimiento y CONSERVA la tarjeta; repetirlo no hace nada; la de otra persona no existe', async () => {
  const e = await empresa('cinco')
  const c = await cliente(e)
  const otro = await cliente(e)
  const t = await tarjeta(e, c.id)
  const m = await membresia(e, c.id)
  await activar(e, c.id, m.id, t.id)
  assert.equal(await desactivarRenovacion({ companyId: e.companyId, clienteId: otro.id, membershipId: m.id }), 'membresia_no_encontrada')
  assert.equal((await mem(m.id)).autoRenovar, true, 'otra persona no la apaga')

  for (let i = 0; i < 2; i++) {
    assert.equal(await desactivarRenovacion({ companyId: e.companyId, clienteId: c.id, membershipId: m.id }), 'ok')
  }
  const mm = await mem(m.id)
  assert.equal(mm.autoRenovar, false)
  assert.equal((await filas(m.id)).filter((f) => f.revocadoAt === null).length, 0)
  assert.equal((await prisma.tarjetaTokenizada.findUniqueOrThrow({ where: { id: t.id } })).activa, true, 'la tarjeta sigue guardada')
  assert.equal(mm.estado, 'ACTIVA', 'la membresía sigue vigente')
  assert.equal((await estadoRenovacion(e.companyId, m.id)).activa, false)
})

test('5b · «activar» y «desactivar» A LA VEZ nunca dejan la renovación encendida sin consentimiento ni al revés', async () => {
  const e = await empresa('cincob')
  for (let ronda = 0; ronda < 6; ronda++) {
    const c = await cliente(e)
    const t = await tarjeta(e, c.id)
    const m = await membresia(e, c.id)
    await Promise.all([
      activar(e, c.id, m.id, t.id),
      desactivarRenovacion({ companyId: e.companyId, clienteId: c.id, membershipId: m.id }),
      activar(e, c.id, m.id, t.id),
      desactivarRenovacion({ companyId: e.companyId, clienteId: c.id, membershipId: m.id }),
    ])
    const mm = await mem(m.id)
    const vigentes = (await filas(m.id)).filter((f) => f.revocadoAt === null).length
    assert.equal(vigentes, mm.autoRenovar ? 1 : 0, `ronda ${ronda}: autoRenovar=${mm.autoRenovar}, consentimientos vigentes=${vigentes}`)
  }
})

test('6 · «activa» exige LAS TRES cosas que el cobro exige: renovación encendida, tarjeta activa y consentimiento vigente', async () => {
  const e = await empresa('seis')
  const c = await cliente(e)
  const t = await tarjeta(e, c.id)
  const m = await membresia(e, c.id)
  assert.equal((await estadoRenovacion(e.companyId, m.id)).activa, false)
  // autoRenovar a secas (sin consentimiento): el cobro no la intentaría, la pantalla no lo promete.
  await prisma.membership.update({ where: { id: m.id }, data: { autoRenovar: true, tarjetaTokenizadaId: t.id } })
  assert.equal((await estadoRenovacion(e.companyId, m.id)).activa, false, 'sin consentimiento')
  await prisma.membership.update({ where: { id: m.id }, data: { autoRenovar: false } })
  await activar(e, c.id, m.id, t.id)
  assert.equal((await estadoRenovacion(e.companyId, m.id)).activa, true)
  await prisma.tarjetaTokenizada.update({ where: { id: t.id }, data: { activa: false } })
  assert.equal((await estadoRenovacion(e.companyId, m.id)).activa, false, 'tarjeta quitada')
})

test('6b · las tarjetas que se ofrecen: solo las del cliente, activas y con perfil; la predeterminada primero; la vencida va marcada', async () => {
  const e = await empresa('seisb')
  const c = await cliente(e)
  const otro = await cliente(e)
  const normal = await tarjeta(e, c.id, { createdAt: hace(3 * DIA) })
  const predeterminada = await tarjeta(e, c.id, { predeterminada: true, createdAt: hace(5 * DIA) })
  const vencida = await tarjeta(e, c.id, { vencMes: 1, vencAnio: 2020, createdAt: hace(1 * DIA) })
  await tarjeta(e, c.id, { activa: false })
  await tarjeta(e, c.id, { paymentProfileId: null, token: null, tokenCifrado: null })
  await tarjeta(e, otro.id)
  const r = await tarjetasParaRenovar(e.companyId, c.id)
  assert.deepEqual(r.map((x) => x.id), [predeterminada.id, vencida.id, normal.id])
  assert.deepEqual(r.map((x) => x.vencida), [false, true, false])
  assert.ok(r.every((x) => !('token' in x) && !('tokenCifrado' in x) && !('paymentProfileId' in x)), 'nunca expone con qué se cobra')
})

test('7 · lo que se enciende desde la pantalla SÍ se cobra: aviso previo y después el cobro, con el consentimiento de cliente', async () => {
  const e = await empresa('siete')
  const c = await cliente(e)
  const t = await tarjeta(e, c.id)
  // Vence en 2 días: ya dentro de la ventana de cobro (3 días) y del aviso previo (7).
  const m = await membresia(e, c.id, { fechaVencimiento: adelante(2 * DIA), fechaPago: hace(28 * DIA) })
  assert.equal(await activar(e, c.id, m.id, t.id), 'ok')

  // `renovacion-v1` promete aviso: sin el aviso del ciclo, NO se cobra.
  const sinAviso = await renovarMembresiaPorTarjeta(m.id, '127.0.0.1')
  assert.equal(sinAviso.estado, 'omitida')
  assert.equal('razon' in sinAviso ? sinAviso.razon : null, 'sin_aviso')
  assert.equal(cobros, 0)

  await ejecutarAvisosDeRenovacion(500, e.companyId)
  const r = await renovarMembresiaPorTarjeta(m.id, '127.0.0.1')
  assert.equal(r.estado, 'renovada')
  assert.equal(cobros, 1)
  const mm = await mem(m.id)
  assert.ok(mm.fechaVencimiento && mm.fechaVencimiento.getTime() > Date.now() + 25 * DIA, 'extendida un período')
  assert.equal(mm.autoRenovar, true)
})
