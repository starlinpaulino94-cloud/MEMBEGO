/**
 * PAGO CON TARJETA → EL CRON DE ENTREGAS (fase 5), contra PostgreSQL con los servicios de verdad.
 *
 *   1 · reintenta al cliente que esperaba y le da su producto, con su comprobante y su asiento en la bitácora;
 *   2 · un reintento que vuelve a fallar no entrega, avisa a los administradores UNA vez al día y respeta el espaciado;
 *   3 · rendirse: sin reintentos que gastar o con el cobro demasiado viejo no se insiste, pero SÍ se avisa;
 *   4 · lo que no es un cliente esperando (producto ya activo, entrega en vuelo) no se toca ni se avisa;
 *   5 · repara los comprobantes que faltan de cobros recientes ya entregados, con la fecha del cobro, y nada retroactivo;
 *   6 · no cruza de empresa: avisos y reintentos son de la empresa barrida;
 *   7 · respeta el presupuesto de tiempo y el tope por pasada;
 *   8 · el endpoint exige el secreto del cron.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { prisma } from '../../src/lib/prisma'
import { barridoEntregasDePago } from '../../src/modules/pagos/barrido-entregas'
import { GET as cron } from '../../src/app/api/cron/entregas-pago/route'

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const PRECIO = 500
const H = 3_600_000
const DIA = 24 * H
const hace = (ms: number) => new Date(Date.now() - ms)

interface Empresa { companyId: string; planId: string; admins: string[] }

async function crearEmpresa(etiqueta: string): Promise<Empresa> {
  const c = await prisma.company.create({ data: { name: `Barrido ${etiqueta} ${sufijo}`, slug: `barrido-${etiqueta}-${sufijo}`, type: 'carwash', ciudad: 'Santo Domingo' }, select: { id: true } })
  const plan = await prisma.plan.create({ data: { companyId: c.id, nombre: `Plan ${etiqueta}`, precio: PRECIO, vigenciaDias: 30, lavadosIncluidos: 4 }, select: { id: true } })
  const admins: string[] = []
  for (const n of ['a', 'b']) {
    admins.push((await prisma.user.create({ data: { supabaseId: `sb-bar-${etiqueta}-${n}-${sufijo}`, email: `bar-${etiqueta}-${n}-${sufijo}@prueba.test`, name: `Admin ${n} ${etiqueta}`, role: 'ADMINISTRADOR', companyId: c.id }, select: { id: true } })).id)
  }
  return { companyId: c.id, planId: plan.id, admins }
}

let n = 0
/** Un cliente con su membresía (índice único por cliente y empresa: cada caso trae el suyo). */
async function conMembresia(e: Empresa, membresia: Record<string, unknown> = {}) {
  const cliente = await prisma.cliente.create({ data: { companyId: e.companyId, supabaseId: `sb-bc-${sufijo}-${n++}`, nombre: `Cliente ${n}`, email: `bc-${sufijo}-${n}@prueba.test` }, select: { id: true } })
  const m = await prisma.membership.create({ data: { companyId: e.companyId, clienteId: cliente.id, planId: e.planId, ...membresia }, select: { id: true } })
  return { clienteId: cliente.id, membershipId: m.id }
}

async function cobro(e: Empresa, c: { clienteId: string; membershipId: string }, extra: Record<string, unknown> = {}) {
  return prisma.pagoIntento.create({
    data: { companyId: e.companyId, clienteId: c.clienteId, proveedor: 'CARDNET', membershipId: c.membershipId, monto: PRECIO, estado: 'APROBADO', activadoAt: hace(2 * H), createdAt: hace(2 * H), updatedAt: hace(2 * H), autorizacion: 'AUTH-BAR', canal: 'APP', ...extra },
    select: { id: true },
  })
}

const falla = { fulfillmentEstado: 'FALLIDA' as const, fulfillmentError: 'La activación falló.', fulfillmentIntentos: 1 }
const barrer = (e: Empresa, extra: Parameters<typeof barridoEntregasDePago>[0] = {}) => barridoEntregasDePago({ companyId: e.companyId, ...extra })
const avisos = (e: Empresa) => prisma.notificacion.findMany({ where: { userId: { in: e.admins } }, orderBy: { createdAt: 'asc' } })
const bitacora = (e: Empresa, accion: string) => prisma.auditLog.findMany({ where: { companyId: e.companyId, accion: accion as never } })

const VALOR = 'prueba-prueba-prueba'
const secretoAnterior = process.env.CRON_SECRET
before(() => { process.env.CRON_SECRET = VALOR })
after(() => {
  if (secretoAnterior === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = secretoAnterior
})

test('1 · reintenta al cliente que esperaba: recibe su producto, su comprobante y queda en la bitácora como automático', async () => {
  const e = await crearEmpresa('uno')
  const c = await conMembresia(e) // PENDIENTE: se puede activar
  const i = await cobro(e, c, falla)

  const r = await barrer(e)
  assert.deepEqual([r.revisados, r.reintentadas, r.entregadas, r.siguenEsperando, r.avisos, r.errores, r.incompleto], [1, 1, 1, 0, 0, 0, false])
  const db = await prisma.pagoIntento.findUniqueOrThrow({ where: { id: i.id } })
  assert.deepEqual([db.fulfillmentEstado, db.fulfillmentError], ['COMPLETADA', null])
  assert.equal((await prisma.membership.findUniqueOrThrow({ where: { id: c.membershipId } })).estado, 'ACTIVA')
  assert.equal(await prisma.transaction.count({ where: { pagoIntentoId: i.id } }), 1, 'y su comprobante')
  const log = await bitacora(e, 'CONCILIACION_ENTREGA_REINTENTADA')
  assert.equal(log.length, 1)
  assert.deepEqual([log[0]!.userId, (log[0]!.payload as Record<string, unknown>).origen, (log[0]!.payload as Record<string, unknown>).resultado], [null, 'AUTOMATICO', 'COMPLETADA'])
  assert.equal((await avisos(e)).length, 0, 'resuelto: no hay nada que avisar')

  // Repetir la pasada no hace nada más.
  const otra = await barrer(e)
  assert.deepEqual([otra.revisados, otra.reintentadas, otra.avisos], [0, 0, 0])
})

test('2 · un reintento que vuelve a fallar avisa a los administradores UNA vez al día y respeta el espaciado', async () => {
  const e = await crearEmpresa('dos')
  const c = await conMembresia(e, { estado: 'CANCELADA' }) // no se puede activar: el reintento falla
  const i = await cobro(e, c, falla)

  const r1 = await barrer(e)
  assert.deepEqual([r1.reintentadas, r1.entregadas, r1.siguenEsperando, r1.avisos], [1, 0, 1, 2], 'se reintentó, sigue esperando y se avisó a los 2 administradores')
  const db1 = await prisma.pagoIntento.findUniqueOrThrow({ where: { id: i.id } })
  assert.deepEqual([db1.fulfillmentEstado, db1.fulfillmentIntentos], ['FALLIDA', 2])
  assert.equal((await bitacora(e, 'CONCILIACION_ENTREGA_REINTENTADA')).length, 0, 'un fallo no se asienta como entrega')
  const a1 = await avisos(e)
  assert.equal(a1.length, 2)
  assert.equal(a1[0]!.titulo, 'Un pago con tarjeta sin entregar')
  assert.match(a1[0]!.mensaje, /^Un cliente pagó con tarjeta y todavía no tiene su producto \(RD\$500\.00\)\. El sistema sigue reintentando la entrega\. Revísalo en Conciliación\.$/)
  assert.equal(a1[0]!.href, '/admin/conciliacion')

  // Otra pasada seguida: el cobro acaba de reintentarse y toca esperar; el aviso del día ya existe.
  const r2 = await barrer(e)
  assert.deepEqual([r2.reintentadas, r2.omitidos.esperar, r2.avisos], [0, 1, 0])
  assert.equal((await avisos(e)).length, 2, 'sin avisos repetidos el mismo día')
  assert.equal((await prisma.pagoIntento.findUniqueOrThrow({ where: { id: i.id } })).fulfillmentIntentos, 2, 'y sin otro reintento')

  // Al día siguiente: pasó la espera, se reintenta de nuevo y el recordatorio del nuevo día sí sale.
  const manana = new Date(Date.now() + DIA)
  const r3 = await barrer(e, { ahora: manana })
  assert.deepEqual([r3.reintentadas, r3.avisos], [1, 2])
  assert.equal((await avisos(e)).length, 4)
})

test('3 · rendirse: con los reintentos agotados o el cobro demasiado viejo no se insiste, pero se avisa que hace falta una persona', async () => {
  const e = await crearEmpresa('tres')
  const agotado = await cobro(e, await conMembresia(e, { estado: 'CANCELADA' }), { ...falla, fulfillmentIntentos: 5, updatedAt: hace(3 * DIA), activadoAt: hace(3 * DIA) })
  const viejo = await cobro(e, await conMembresia(e, { estado: 'CANCELADA' }), { ...falla, fulfillmentIntentos: 0, updatedAt: hace(10 * DIA), activadoAt: hace(10 * DIA) })

  const r = await barrer(e)
  assert.deepEqual([r.revisados, r.reintentadas, r.omitidos.agotados, r.omitidos.fueraDeVentana, r.siguenEsperando], [2, 0, 1, 1, 2])
  assert.equal((await prisma.pagoIntento.findUniqueOrThrow({ where: { id: agotado.id } })).fulfillmentIntentos, 5, 'no se tocó')
  assert.equal((await prisma.pagoIntento.findUniqueOrThrow({ where: { id: viejo.id } })).fulfillmentIntentos, 0, 'no se tocó')
  const a = await avisos(e)
  assert.equal(a.length, 2)
  assert.equal(a[0]!.titulo, 'Pagos con tarjeta sin entregar')
  assert.match(a[0]!.mensaje, /^2 clientes pagaron con tarjeta y todavía no tienen su producto \(RD\$1,000\.00\)\. El sistema ya no puede resolverlo solo: hace falta una persona\./)
})

test('4 · lo que no es un cliente esperando no se toca ni se avisa: producto ya activo, entrega en vuelo, rechazado', async () => {
  const e = await crearEmpresa('cuatro')
  const vieja = hace(20 * DIA)
  // Producto ya activo desde el cobro: solo falta cerrar el registro (lo resuelve una persona con una nota).
  const activo = await conMembresia(e, { estado: 'ACTIVA', pagoConfirmado: true, montoPagado: PRECIO, fechaPago: vieja, fechaInicio: vieja })
  const sinCerrar = await cobro(e, activo, { activadoAt: vieja, createdAt: vieja, updatedAt: vieja })
  // Entrega recién empezada.
  const enVuelo = await cobro(e, await conMembresia(e), { fulfillmentEstado: 'PROCESANDO', updatedAt: new Date(), activadoAt: new Date() })
  // Cobro rechazado.
  const rechazado = await cobro(e, await conMembresia(e), { estado: 'RECHAZADO', activadoAt: null })

  const r = await barrer(e)
  assert.deepEqual([r.revisados, r.reintentadas, r.siguenEsperando, r.avisos], [0, 0, 0, 0])
  for (const [i, estado] of [[sinCerrar, 'PENDIENTE'], [enVuelo, 'PROCESANDO'], [rechazado, 'PENDIENTE']] as const) {
    assert.equal((await prisma.pagoIntento.findUniqueOrThrow({ where: { id: i.id } })).fulfillmentEstado, estado)
  }
  assert.equal((await avisos(e)).length, 0)
})

test('5 · repara los comprobantes que faltan de cobros recientes ya entregados, con la fecha del cobro, y nada retroactivo', async () => {
  const e = await crearEmpresa('cinco')
  const entregado = { fulfillmentEstado: 'COMPLETADA' as const, fulfillmentAt: new Date() }
  const act = { estado: 'ACTIVA' as const, pagoConfirmado: true, montoPagado: PRECIO, fechaInicio: new Date() }
  const hace2d = hace(2 * DIA)
  const reciente = await cobro(e, await conMembresia(e, { ...act, fechaPago: hace2d }), { ...entregado, activadoAt: hace2d, createdAt: hace2d, updatedAt: hace2d })
  const anterior = await cobro(e, await conMembresia(e, { ...act, fechaPago: hace(40 * DIA) }), { ...entregado, canal: null, activadoAt: hace(40 * DIA) }) // de antes del canal y fuera de ventana
  const sinCanal = await cobro(e, await conMembresia(e, { ...act, fechaPago: hace2d }), { ...entregado, canal: null, activadoAt: hace2d }) // reciente pero anterior a la columna
  const fuera = await cobro(e, await conMembresia(e, { ...act, fechaPago: hace(30 * DIA) }), { ...entregado, activadoAt: hace(30 * DIA) }) // con canal pero fuera de los 14 días

  const r = await barrer(e)
  assert.equal(r.comprobantes, 1)
  const venta = await prisma.transaction.findUniqueOrThrow({ where: { pagoIntentoId: reciente.id } })
  assert.equal(venta.createdAt.getTime(), hace2d.getTime(), 'la venta lleva la fecha del cobro')
  for (const i of [anterior, sinCanal, fuera]) assert.equal(await prisma.transaction.count({ where: { pagoIntentoId: i.id } }), 0, 'no se factura hacia atrás')
  const log = await bitacora(e, 'CONCILIACION_COMPROBANTE_GENERADO')
  assert.equal(log.length, 1)
  assert.deepEqual([log[0]!.userId, (log[0]!.payload as Record<string, unknown>).origen, log[0]!.entidadId], [null, 'AUTOMATICO', reciente.id])

  const otra = await barrer(e)
  assert.equal(otra.comprobantes, 0, 'idempotente')
  assert.equal((await bitacora(e, 'CONCILIACION_COMPROBANTE_GENERADO')).length, 1)
})

test('6 · no cruza de empresa: reintentos y avisos son de la empresa barrida', async () => {
  const a = await crearEmpresa('seis-a')
  const b = await crearEmpresa('seis-b')
  const ia = await cobro(a, await conMembresia(a, { estado: 'CANCELADA' }), falla)
  const ib = await cobro(b, await conMembresia(b, { estado: 'CANCELADA' }), falla)

  const r = await barrer(a)
  assert.deepEqual([r.revisados, r.reintentadas, r.avisos], [1, 1, 2])
  assert.equal((await prisma.pagoIntento.findUniqueOrThrow({ where: { id: ia.id } })).fulfillmentIntentos, 2)
  assert.equal((await prisma.pagoIntento.findUniqueOrThrow({ where: { id: ib.id } })).fulfillmentIntentos, 1, 'la otra empresa no se tocó')
  assert.equal((await avisos(a)).length, 2)
  assert.equal((await avisos(b)).length, 0, 'ni se le avisó')
})

test('7 · respeta el presupuesto de tiempo y el tope por pasada, y lo dice', async () => {
  const e = await crearEmpresa('siete')
  const i1 = await cobro(e, await conMembresia(e), { ...falla, activadoAt: hace(3 * H), updatedAt: hace(3 * H) })
  const i2 = await cobro(e, await conMembresia(e), { ...falla, activadoAt: hace(2 * H), updatedAt: hace(2 * H) })

  const sinTiempo = await barrer(e, { presupuestoMs: 0 })
  assert.deepEqual([sinTiempo.reintentadas, sinTiempo.incompleto], [0, true], 'sin tiempo no empieza trabajo nuevo')
  for (const i of [i1, i2]) assert.equal((await prisma.pagoIntento.findUniqueOrThrow({ where: { id: i.id } })).fulfillmentEstado, 'FALLIDA')

  const tope = await barrer(e, { maxReintentos: 1 })
  assert.deepEqual([tope.reintentadas, tope.entregadas, tope.incompleto], [1, 1, true], 'el tope deja trabajo para la siguiente pasada')
  assert.equal((await prisma.pagoIntento.findUniqueOrThrow({ where: { id: i1.id } })).fulfillmentEstado, 'COMPLETADA', 'el más viejo primero')

  const resto = await barrer(e)
  assert.deepEqual([resto.reintentadas, resto.entregadas, resto.incompleto], [1, 1, false])
})

test('8 · el endpoint exige el secreto del cron antes de barrer', async () => {
  const sin = await cron(new NextRequest('http://localhost/api/cron/entregas-pago'))
  assert.equal(sin.status, 401)
  const mal = await cron(new NextRequest('http://localhost/api/cron/entregas-pago', { headers: { authorization: 'Bearer otro-secreto' } }))
  assert.equal(mal.status, 401)

  delete process.env.CRON_SECRET
  assert.equal((await cron(new NextRequest('http://localhost/api/cron/entregas-pago', { headers: { authorization: 'Bearer x' } }))).status, 503, 'sin secreto configurado el servidor está roto, no «no autorizado»')
  process.env.CRON_SECRET = VALOR

  const ok = await cron(new NextRequest('http://localhost/api/cron/entregas-pago', { headers: { authorization: `Bearer ${VALOR}` } }))
  assert.equal(ok.status, 200)
  const cuerpo = (await ok.json()) as Record<string, unknown>
  assert.equal(cuerpo.ok, true)
  for (const clave of ['revisados', 'reintentadas', 'entregadas', 'omitidos', 'comprobantes', 'siguenEsperando', 'avisos', 'errores', 'incompleto']) assert.ok(clave in cuerpo, clave)
})
