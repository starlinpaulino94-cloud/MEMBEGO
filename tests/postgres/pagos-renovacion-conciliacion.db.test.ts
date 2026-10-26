/**
 * CONCILIACIÓN AUTOMÁTICA DE LAS RENOVACIONES DUDOSAS · contra PostgreSQL real.
 *
 * Un cobro automático que se cae sin respuesta pudo haber salido, y por eso bloquea el ciclo. Antes lo resolvía siempre
 * una persona mirando el panel de CardNET; ahora el cron le pregunta primero a CardNET con la consulta de compras (la
 * misma que usa la app), buscando ESE cobro por su orden y su `UniqueID`. La pasarela se simula con `fetch`: el POST
 * es el cobro y el GET es la consulta. Cada prueba falla si vuelve el defecto que cierra:
 *
 *   1 · la renovación no mandaba `UniqueID`, así que un cobro perdido no se podía encontrar;
 *   2 · CardNET dice que SÍ cobró: se registra, se entrega SIN volver a cobrar, y nada lo repite;
 *   3 · CardNET dice que NO: es un rechazo como cualquier otro (cuenta, avisa) y el ciclo sigue;
 *   4 · un rechazo definitivo confirmado apaga la renovación y conserva la tarjeta;
 *   5 · si CardNET no da una respuesta inequívoca, NADA cambia: sigue bloqueado para una persona.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { referenciaCobro } from '../../src/lib/payments/cardnet-tokens-core'
import { renovarMembresiaPorTarjeta } from '../../src/modules/pagos/cardnetTokenGuardado'
import {
  conciliarRenovacionDudosa,
  conciliarRenovacionesDudosas,
  veredictoDeCompra,
} from '../../src/modules/pagos/conciliarRenovacion'

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const PRECIO = 500
const H = 3_600_000
const DIA = 24 * H
const hace = (ms: number) => new Date(Date.now() - ms)
const adelante = (ms: number) => new Date(Date.now() + ms)

// ── La pasarela simulada ────────────────────────────────────────────────────

type ModoCobro = 'aprobar' | 'rechazar' | 'sin-respuesta'
const pasarela = {
  cobro: 'aprobar' as ModoCobro,
  /** Lo que contesta la consulta de compras: filas tal cual, o un fallo HTTP. */
  consulta: { status: 200, filas: [] as unknown[] },
  cobros: [] as Record<string, unknown>[],
  consultas: [] as string[],
}
const reiniciar = () =>
  Object.assign(pasarela, { cobro: 'aprobar', consulta: { status: 200, filas: [] }, cobros: [], consultas: [] })

let fetchOriginal: typeof fetch
const anterior = {
  pub: process.env.CARDNET_TOKENS_PUBLIC_KEY,
  priv: process.env.CARDNET_TOKENS_PRIVATE_KEY,
  base: process.env.CARDNET_TOKENS_API_BASE,
}
before(() => {
  fetchOriginal = globalThis.fetch
  // Claves de PRUEBA (sintéticas). No salen a la red.
  process.env.CARDNET_TOKENS_PUBLIC_KEY = 'prueba-prueba-prueba'
  process.env.CARDNET_TOKENS_PRIVATE_KEY = 'prueba-prueba-prueba'
  process.env.CARDNET_TOKENS_API_BASE = 'https://cardnet.prueba.test/api'
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const json = (estado: number, cuerpo: unknown) =>
      new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json' } })
    if ((init?.method ?? 'GET') === 'GET') {
      pasarela.consultas.push(String(url))
      return json(pasarela.consulta.status, { Response: { Purchases: pasarela.consulta.filas }, Errors: [] })
    }
    pasarela.cobros.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
    if (pasarela.cobro === 'sin-respuesta') throw new TypeError('fetch failed')
    if (pasarela.cobro === 'rechazar') {
      return json(200, { Response: { Transaction: { ResponseCode: '51', ResponseMessage: 'DECLINED' } }, Errors: [] })
    }
    return json(200, {
      Response: { Transaction: { TransactionStatusId: 1, ResponseCode: '00', AuthorizationCode: `AUTH-${pasarela.cobros.length}` } },
      Errors: [],
    })
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

// ── Fixtures ────────────────────────────────────────────────────────────────

async function empresa(etiqueta: string) {
  const c = await prisma.company.create({
    data: {
      name: `Conciliar ${etiqueta} ${sufijo}`,
      slug: `conciliar-${etiqueta}-${sufijo}`,
      type: 'carwash',
      ciudad: 'Santo Domingo',
      capacidades: { overrides: { PAGO_CARDNET: true } },
    },
    select: { id: true },
  })
  const plan = await prisma.plan.create({
    data: { companyId: c.id, nombre: `Plan ${etiqueta}`, precio: PRECIO, vigenciaDias: 30, lavadosIncluidos: 4 },
    select: { id: true },
  })
  return { companyId: c.id, planId: plan.id }
}
type Empresa = Awaited<ReturnType<typeof empresa>>

let n = 0
async function renovable(e: Empresa, nombre: string, venceEnMs = 60 * H) {
  const k = n++
  const cliente = await prisma.cliente.create({
    data: { companyId: e.companyId, supabaseId: `sb-cr-${sufijo}-${k}`, nombre, email: `cr-${sufijo}-${k}@prueba.test` },
    select: { id: true, supabaseId: true },
  })
  await prisma.user.create({
    data: { supabaseId: cliente.supabaseId, email: `u-cr-${sufijo}-${k}@prueba.test`, name: nombre, companyId: e.companyId },
  })
  const customerId = `cust-cr-${sufijo}-${k}`
  const tarjeta = await prisma.tarjetaTokenizada.create({
    data: {
      companyId: e.companyId,
      clienteId: cliente.id,
      customerId,
      paymentProfileId: `pp-cr-${sufijo}-${k}`,
      token: 'CT__sintetico',
      marca: 'VISA',
      ultimos4: '4242',
      activa: true,
    },
    select: { id: true },
  })
  const vence = adelante(venceEnMs)
  const m = await prisma.membership.create({
    data: {
      companyId: e.companyId,
      clienteId: cliente.id,
      planId: e.planId,
      estado: 'ACTIVA',
      pagoConfirmado: true,
      montoPagado: PRECIO,
      fechaPago: hace(28 * DIA),
      fechaInicio: hace(28 * DIA),
      fechaVencimiento: vence,
      autoRenovar: true,
      tarjetaTokenizadaId: tarjeta.id,
    },
    select: { id: true },
  })
  await prisma.consentimientoPago.create({
    data: {
      companyId: e.companyId,
      clienteId: cliente.id,
      tipo: 'RENOVACION_AUTOMATICA',
      tarjetaId: tarjeta.id,
      membershipId: m.id,
      origen: 'HEREDADO',
      textoVersion: 'previo-a-registro',
    },
  })
  return { companyId: e.companyId, clienteId: cliente.id, supabaseId: cliente.supabaseId, membershipId: m.id, tarjetaId: tarjeta.id, customerId, vence }
}
type Renovable = Awaited<ReturnType<typeof renovable>>

const renovar = (c: Renovable) => renovarMembresiaPorTarjeta(c.membershipId, '127.0.0.1')
const intentosDe = (c: Renovable) =>
  prisma.pagoIntento.findMany({ where: { membershipId: c.membershipId }, orderBy: { createdAt: 'asc' } })
const membresiaDe = (c: Renovable) => prisma.membership.findUniqueOrThrow({ where: { id: c.membershipId } })
const resp = (i: { respuesta: unknown }) => (i.respuesta ?? {}) as Record<string, unknown>
async function avisosDe(c: Renovable) {
  const u = await prisma.user.findUniqueOrThrow({ where: { supabaseId: c.supabaseId } })
  return prisma.notificacion.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'asc' } })
}
/** Atrasa los intentos de la membresía: «ya pasó un día» para la separación entre intentos. */
async function envejecer(c: Renovable, horas: number) {
  for (const i of await intentosDe(c)) {
    await prisma.pagoIntento.update({ where: { id: i.id }, data: { createdAt: new Date(i.createdAt.getTime() - horas * H) } })
  }
}

/** Un cobro automático que se cayó sin respuesta: queda dudoso, con su UniqueID. */
async function cobroDudoso(c: Renovable) {
  pasarela.cobro = 'sin-respuesta'
  const r = await renovar(c)
  assert.equal(r.estado, 'error')
  pasarela.cobro = 'aprobar'
  const i = (await intentosDe(c)).at(-1)
  assert.ok(i)
  assert.equal(i.estado, 'ERROR')
  assert.equal(resp(i)._clasificacion, 'incierto')
  return i
}

/** La fila que la consulta de compras de CardNET devolvería para ese intento. */
function fila(
  i: { id: string; cardnetUniqueId: string | null; createdAt: Date },
  c: Renovable,
  transaccion: Record<string, unknown>,
  cambios: Record<string, unknown> = {}
) {
  return {
    Order: referenciaCobro(i.id),
    UniqueID: i.cardnetUniqueId,
    CustomerId: c.customerId,
    Created: new Date(i.createdAt.getTime() + 1000).toISOString(),
    Transaction: transaccion,
    ...cambios,
  }
}
const APROBADA = { TransactionStatusId: 1, ResponseCode: '00', AuthorizationCode: 'AUTH-CONCILIADA' }
const RECHAZADA = (codigo: string) => ({ TransactionStatusId: 4, ResponseCode: codigo, ResponseMessage: 'DECLINED' })

// ── 1 · El UniqueID ─────────────────────────────────────────────────────────

test('1 · cada cobro de renovación manda un UniqueID y lo guarda ANTES de cobrar: es con lo que se le encuentra después', async () => {
  reiniciar()
  const c = await renovable(await empresa('uno'), 'Ana')
  const i = await cobroDudoso(c)
  assert.match(i.cardnetUniqueId ?? '', /^\d{12}$/)
  assert.equal(pasarela.cobros.length, 1)
  assert.equal(pasarela.cobros[0]?.UniqueID, i.cardnetUniqueId, 'lo que se mandó es lo que se guardó')
  assert.equal(pasarela.cobros[0]?.Order, referenciaCobro(i.id))
})

// ── 2 · CardNET SÍ cobró ────────────────────────────────────────────────────

test('2 · CardNET confirma que SÍ cobró: se registra aprobado, la membresía se extiende SIN volver a cobrar, y nada lo repite', async () => {
  reiniciar()
  const c = await renovable(await empresa('dos'), 'Bruno')
  const i = await cobroDudoso(c)
  pasarela.consulta.filas = [fila(i, c, APROBADA)]

  const resumen = await conciliarRenovacionesDudosas(50, c.companyId)
  assert.deepEqual(resumen, { revisadas: 1, aprobadas: 1, rechazadas: 0, siguenDudosas: 0 })
  assert.equal(pasarela.cobros.length, 1, 'conciliar NO cobra')
  assert.equal(pasarela.consultas.length, 1)
  assert.match(pasarela.consultas[0] ?? '', new RegExp(`OrderNumber=${referenciaCobro(i.id)}`))

  const [conciliado] = await intentosDe(c)
  assert.equal(conciliado?.estado, 'APROBADO')
  assert.equal(conciliado?.autorizacion, 'AUTH-CONCILIADA')
  assert.equal(conciliado?.fulfillmentEstado, 'COMPLETADA', 'entregado por reintentarEntrega')
  assert.equal(conciliado?.motivoRechazo, null)
  assert.equal(resp(conciliado!)._conciliado, 'automatico')
  const m = await membresiaDe(c)
  assert.equal(m.estado, 'ACTIVA')
  assert.ok(m.fechaVencimiento && m.fechaVencimiento.getTime() >= c.vence.getTime() + 29 * DIA, 'extendida un período')

  // Ni el cron de mañana ni otra conciliación lo vuelven a cobrar.
  await envejecer(c, 24)
  const otra = await renovar(c)
  assert.equal(otra.estado, 'omitida')
  assert.equal(pasarela.cobros.length, 1)
  assert.deepEqual(await conciliarRenovacionesDudosas(50, c.companyId), { revisadas: 0, aprobadas: 0, rechazadas: 0, siguenDudosas: 0 })
})

// ── 3 · CardNET NO cobró ────────────────────────────────────────────────────

test('3 · CardNET confirma el rechazo: cuenta como intento, avisa al cliente y el siguiente cobro lo reintenta', async () => {
  reiniciar()
  const c = await renovable(await empresa('tres'), 'Carla')
  const i = await cobroDudoso(c)
  assert.equal((await avisosDe(c)).length, 0, 'el cobro dudoso no avisa')
  // Sin conciliar, el ciclo está bloqueado.
  await envejecer(c, 24)
  const bloqueada = await renovar(c)
  assert.equal(bloqueada.estado, 'omitida')
  assert.equal('razon' in bloqueada ? bloqueada.razon : null, 'incierta')

  pasarela.consulta.filas = [fila(i, c, RECHAZADA('51'))]
  assert.equal(await conciliarRenovacionDudosa(i.id), 'rechazada')
  const [rechazado] = await intentosDe(c)
  assert.equal(rechazado?.estado, 'RECHAZADO')
  assert.equal(resp(rechazado!)._clasificacion, 'rechazo')
  assert.equal(resp(rechazado!)._conciliado, 'automatico')
  const asientos = await prisma.auditLog.findMany({ where: { entidadId: c.membershipId, accion: 'PAGO_RECHAZADO' } })
  assert.equal(asientos.length, 1)
  assert.equal((asientos[0]?.payload as Record<string, unknown>).conciliado, 'automatico')
  assert.equal((asientos[0]?.payload as Record<string, unknown>).rechazo, 1)
  const avisos = await avisosDe(c)
  assert.equal(avisos.length, 1)
  assert.match(avisos[0]?.mensaje ?? '', /No se hizo ningún cargo/)

  // Desbloqueado: el siguiente cobro sale y renueva.
  const r = await renovar(c)
  assert.equal(r.estado, 'renovada')
  assert.equal(pasarela.cobros.length, 2)
  assert.equal((await membresiaDe(c)).autoRenovar, true)
})

test('4 · un rechazo DEFINITIVO confirmado (54) apaga la renovación, retira el consentimiento y conserva la tarjeta', async () => {
  reiniciar()
  const c = await renovable(await empresa('cuatro'), 'Diego')
  const i = await cobroDudoso(c)
  pasarela.consulta.filas = [fila(i, c, RECHAZADA('54'))]
  assert.equal(await conciliarRenovacionDudosa(i.id), 'rechazada')
  const m = await membresiaDe(c)
  assert.equal(m.autoRenovar, false)
  assert.equal(m.tarjetaTokenizadaId, c.tarjetaId)
  assert.equal((await prisma.tarjetaTokenizada.findUniqueOrThrow({ where: { id: c.tarjetaId } })).activa, true)
  assert.equal(
    await prisma.consentimientoPago.count({ where: { membershipId: c.membershipId, tipo: 'RENOVACION_AUTOMATICA', revocadoAt: null } }),
    0
  )
  const [intento] = await intentosDe(c)
  assert.equal(resp(intento!)._clasificacion, 'rechazo_definitivo')
})

test('4b · el rechazo confirmado CUENTA con los anteriores del ciclo: dos rechazos y un dudoso rechazado son tres, y se apaga', async () => {
  reiniciar()
  const c = await renovable(await empresa('cuatrob'), 'Dora', 30 * H)
  pasarela.cobro = 'rechazar'
  assert.equal((await renovar(c)).estado, 'rechazada')
  await envejecer(c, 22)
  assert.equal((await renovar(c)).estado, 'rechazada')
  await envejecer(c, 22)
  const i = await cobroDudoso(c)
  pasarela.consulta.filas = [fila(i, c, RECHAZADA('51'))]
  assert.equal(await conciliarRenovacionDudosa(i.id), 'rechazada')
  const asientos = await prisma.auditLog.findMany({
    where: { entidadId: c.membershipId, accion: 'PAGO_RECHAZADO' },
    orderBy: { createdAt: 'asc' },
  })
  assert.deepEqual(asientos.map((a) => (a.payload as Record<string, unknown>).rechazo), [1, 2, 3])
  assert.equal((asientos[2]?.payload as Record<string, unknown>).causa, 'agotado')
  assert.equal((await membresiaDe(c)).autoRenovar, false, 'tres rechazos en el ciclo: se apaga')
})

// ── 5 · Sin respuesta inequívoca, nada cambia ───────────────────────────────

test('5 · si CardNET no lo encuentra, lo encuentra dos veces, con otro UniqueID, pendiente o la consulta falla: SIGUE DUDOSO', async () => {
  reiniciar()
  const c = await renovable(await empresa('cinco'), 'Elena')
  const i = await cobroDudoso(c)
  const casos: { nombre: string; status?: number; filas: unknown[] }[] = [
    { nombre: 'no aparece', filas: [] },
    { nombre: 'aparece dos veces', filas: [fila(i, c, APROBADA), fila(i, c, APROBADA)] },
    { nombre: 'otro UniqueID', filas: [fila(i, c, APROBADA, { UniqueID: '000000000000' })] },
    { nombre: 'otro cliente', filas: [fila(i, c, APROBADA, { CustomerId: 'otro' })] },
    { nombre: 'fuera de fechas', filas: [fila(i, c, APROBADA, { Created: hace(30 * DIA).toISOString() })] },
    { nombre: 'pendiente', filas: [fila(i, c, { TransactionStatusId: 2 })] },
    { nombre: 'la consulta falla', status: 500, filas: [fila(i, c, APROBADA)] },
  ]
  for (const caso of casos) {
    pasarela.consulta = { status: caso.status ?? 200, filas: caso.filas }
    assert.equal(await conciliarRenovacionDudosa(i.id), 'sigue_dudosa', caso.nombre)
    const [igual] = await intentosDe(c)
    assert.equal(igual?.estado, 'ERROR', caso.nombre)
    assert.equal(resp(igual!)._clasificacion, 'incierto', caso.nombre)
  }
  assert.equal(pasarela.cobros.length, 1, 'nunca cobra')
  assert.equal((await avisosDe(c)).length, 0, 'nunca avisa')
  await envejecer(c, 24)
  const r = await renovar(c)
  assert.equal('razon' in r ? r.razon : null, 'incierta', 'sigue bloqueada para una persona')
})

test('6 · un intento SIN UniqueID (anterior a este cambio) no se consulta: no se puede identificar con certeza', async () => {
  reiniciar()
  const c = await renovable(await empresa('seis'), 'Fabio')
  const i = await cobroDudoso(c)
  await prisma.pagoIntento.update({ where: { id: i.id }, data: { cardnetUniqueId: null } })
  const resumen = await conciliarRenovacionesDudosas(50, c.companyId)
  assert.equal(resumen.revisadas, 0)
  assert.equal(pasarela.consultas.length, 0)
})

test('7 · un intento que quedó CREADO sin cerrar (el proceso murió a medias) también se concilia', async () => {
  reiniciar()
  const c = await renovable(await empresa('siete'), 'Gina')
  const i = await cobroDudoso(c)
  // El cobro se quedó a medias: CREADO hace una hora, sin clasificación.
  await prisma.pagoIntento.update({ where: { id: i.id }, data: { estado: 'CREADO', respuesta: null as never, createdAt: hace(H) } })
  const abierto = await prisma.pagoIntento.findUniqueOrThrow({ where: { id: i.id } })
  pasarela.consulta.filas = [fila(abierto, c, APROBADA)]
  const resumen = await conciliarRenovacionesDudosas(50, c.companyId)
  assert.equal(resumen.aprobadas, 1)
  assert.equal((await prisma.pagoIntento.findUniqueOrThrow({ where: { id: i.id } })).estado, 'APROBADO')
})

test('8 · dos conciliaciones a la vez del mismo cobro aprobado lo entregan UNA vez', async () => {
  reiniciar()
  const c = await renovable(await empresa('ocho'), 'Hugo')
  const i = await cobroDudoso(c)
  pasarela.consulta.filas = [fila(i, c, APROBADA)]
  const resultados = await Promise.all([conciliarRenovacionDudosa(i.id), conciliarRenovacionDudosa(i.id)])
  assert.deepEqual([...resultados].sort(), ['aprobada', 'sigue_dudosa'])
  const m = await membresiaDe(c)
  // Un período son 30 días redondeados al final del día; dos serían ~60.
  assert.ok(m.fechaVencimiento && m.fechaVencimiento.getTime() < c.vence.getTime() + 45 * DIA, 'extendida un solo período')
  const [unico] = await intentosDe(c)
  assert.equal(unico?.fulfillmentIntentos, 1, 'una sola entrega')
  assert.equal(await prisma.pagoIntento.count({ where: { membershipId: c.membershipId, estado: 'APROBADO' } }), 1)
})

// ── La regla pura ───────────────────────────────────────────────────────────

test('9 · veredictoDeCompra: solo una fila exacta da veredicto; sin lista, nada', () => {
  const esperado = { customerId: 'C', orderNumber: 'ORD', uniqueId: 'U', from: hace(DIA), to: adelante(DIA) }
  const base = { Order: 'ORD', UniqueID: 'U', CustomerId: 'C', Created: new Date().toISOString() }
  assert.deepEqual(veredictoDeCompra({}, esperado), { kind: 'unknown' })
  assert.deepEqual(veredictoDeCompra({ Response: { Purchases: [] } }, esperado), { kind: 'unknown' })
  assert.equal(veredictoDeCompra({ Response: [{ ...base, Transaction: APROBADA }] }, esperado).kind, 'approved')
  assert.equal(veredictoDeCompra({ Response: [{ ...base, Transaction: RECHAZADA('51') }] }, esperado).kind, 'declined')
  // Aprobada pero con errores del proveedor: no se cree.
  assert.equal(
    veredictoDeCompra({ Response: [{ ...base, Transaction: APROBADA, Errors: [{ ErrorCode: 'X', Message: 'm' }] }] }, esperado).kind,
    'unknown'
  )
})
