import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { prisma } from '../../src/lib/prisma'
import { registrarReciboDePasarela } from '../../src/modules/pagos/reciboPasarela'
import { getClientePagos } from '../../src/modules/cliente/queries'
import { ticketParaCliente } from '../../src/modules/transacciones/comprobanteCliente'

/**
 * EL RECIBO DEL PAGO CON TARJETA, CONTRA POSTGRESQL (16-10-2026).
 *
 *   1  Un intento de CardNET aprobado deja UNA venta oficial (TX-…, ticket,
 *      «Tarjeta (CardNET)», «Aut. 123456») aunque la pasarela avise dos veces
 *      (webhook + retorno del navegador): el filtro JSON por `intentoId` es
 *      lo que lo garantiza, y solo se prueba de verdad contra la base.
 *   2  «Mis pagos» del cliente lista ese comprobante y enlaza el pago aprobado
 *      del historial con su venta.
 *   3  El comprobante es del dueño: otra persona no lo obtiene.
 *
 * `npm run test:db`.
 */

const sufijo = randomUUID().slice(0, 8)
let companyId = ''
let clienteId = ''
let membershipId = ''
let intentoId = ''
const supabaseId = `db-recibo-${sufijo}`

before(async () => {
  const company = await prisma.company.create({
    data: { name: `Recibos ${sufijo}`, slug: `recibos-${sufijo}`, type: 'carwash' },
    select: { id: true },
  })
  companyId = company.id
  const cliente = await prisma.cliente.create({
    data: { companyId, supabaseId, nombre: 'Juana Recibo', email: `juana.${sufijo}@membego.test` },
    select: { id: true },
  })
  clienteId = cliente.id
  const plan = await prisma.plan.create({ data: { companyId, nombre: 'Plan Oro', precio: 1500 }, select: { id: true } })
  const membership = await prisma.membership.create({
    data: { companyId, clienteId, planId: plan.id, estado: 'ACTIVA', pagoConfirmado: true, montoPagado: 1500, fechaPago: new Date() },
    select: { id: true },
  })
  membershipId = membership.id
  const intento = await prisma.pagoIntento.create({
    data: {
      companyId, clienteId, proveedor: 'CARDNET', membershipId, monto: 1500, moneda: 'DOP',
      estado: 'APROBADO', autorizacion: '123456', activadoAt: new Date(), fulfillmentEstado: 'COMPLETADA',
    },
    select: { id: true },
  })
  intentoId = intento.id
  // Lo que escribe `activarMembresia` al activar: el pago aprobado del historial.
  await prisma.auditLog.create({
    data: {
      companyId, userId: null, accion: 'PAGO_APROBADO', entidadTipo: 'Membership', entidadId: membershipId,
      payload: { planId: plan.id, clienteId, monto: 1500 },
    },
  })
})

after(async () => {
  await prisma.$disconnect()
})

test('1 · un intento aprobado deja UNA venta, aunque la pasarela avise dos veces', async () => {
  const entrada = {
    companyId, intentoId, clienteId, membershipId, compraId: null,
    monto: 1500, autorizacion: '123456', proveedor: 'CARDNET', detalle: 'Plan Oro',
  }
  const primera = await registrarReciboDePasarela(entrada)
  assert.ok(primera, 'la primera vez crea la venta')
  assert.match(primera.codigo, /^TX-\d{8}-\d{6}$/)
  const segunda = await registrarReciboDePasarela(entrada)
  assert.equal(segunda, null, 'la segunda no crea otra')

  const ventas = await prisma.transaction.findMany({ where: { companyId, clienteId, tipo: 'SALE' } })
  assert.equal(ventas.length, 1)
  const v = ventas[0]
  const s = v.snapshot as Record<string, unknown>
  assert.equal(v.estado, 'APPLIED')
  assert.equal(v.membershipId, membershipId)
  assert.equal(Number(v.monto), 1500)
  assert.equal(v.metodoCobro, 'OTRO')
  assert.equal(s.intentoId, intentoId)
  assert.equal(s.metodoCobroLabel, 'Tarjeta (CardNET)')
  assert.equal(s.referenciaPago, 'Aut. 123456')
  assert.equal(s.cliente, 'Juana Recibo')
  assert.equal(s.detalle, 'Plan Oro')
  assert.equal(s.total, '1500.00')
})

test('2 · «Mis pagos» lista el comprobante y enlaza el pago aprobado con su venta', async () => {
  const pagos = await getClientePagos(supabaseId)
  assert.equal(pagos.comprobantes.length, 1)
  const c = pagos.comprobantes[0]
  assert.match(c.codigo, /^TX-/)
  assert.equal(c.detalle, 'Plan Oro')
  assert.equal(c.total, '1500.00')
  assert.equal(c.metodoPago, 'Tarjeta (CardNET)')
  assert.equal(c.empresa, `Recibos ${sufijo}`)

  const aprobado = pagos.historial.find((h) => h.tipo === 'APROBADO')
  assert.ok(aprobado, 'el PAGO_APROBADO está en el historial')
  assert.equal(aprobado.transaccionId, c.id, 'y apunta a la venta de ESA membresía')
})

test('3 · el comprobante es del dueño: la dueña lo obtiene, otra persona no', async () => {
  const venta = await prisma.transaction.findFirstOrThrow({ where: { companyId, clienteId, tipo: 'SALE' }, select: { id: true } })
  const mio = await ticketParaCliente(venta.id, supabaseId)
  assert.ok(mio)
  assert.equal(mio.transaccion.cliente, 'Juana Recibo')
  assert.equal(mio.transaccion.referenciaPago, 'Aut. 123456')
  assert.equal(mio.metodoPago, 'Tarjeta (CardNET)')
  assert.equal(mio.lineas.length, 1)
  assert.equal(mio.lineas[0].total, 1500)

  assert.equal(await ticketParaCliente(venta.id, `otra-persona-${sufijo}`), null)
  assert.equal(await ticketParaCliente('no-existe', supabaseId), null)
})

// ── Recibos de los pagos anteriores (backfill) ───────────────────────────────

test('4 · los pagos anteriores: se emite lo entregado, con la fecha del cobro; lo no entregado se lista; repetir no duplica', async () => {
  const { planificarRecibosAnteriores, emitirRecibosAnteriores } = await import('../../src/modules/pagos/recibosAnteriores')
  const plan = await prisma.plan.create({ data: { companyId, nombre: 'Oro', precio: 1500 }, select: { id: true } })
  // Una persona solo tiene una membresía por empresa: cada escenario, su cliente.
  let n = 0
  const clientes = new Map<string, { id: string; supabaseId: string }>()
  const crearMembresia = async (pagoConfirmado: boolean) => {
    n += 1
    const sid = `${supabaseId}-esc${n}`
    const cl = await prisma.cliente.create({ data: { companyId, supabaseId: sid, nombre: `Cliente ${n}`, email: `esc${n}.${sufijo}@membego.test` }, select: { id: true } })
    const m = await prisma.membership.create({ data: { companyId, clienteId: cl.id, planId: plan.id, estado: pagoConfirmado ? 'ACTIVA' : 'PENDIENTE', pagoConfirmado }, select: { id: true } })
    clientes.set(m.id, { id: cl.id, supabaseId: sid })
    return m
  }
  const intento = (membershipId: string, cobrado: string, fulfillmentEstado: string, autorizacion: string) =>
    prisma.pagoIntento.create({
      data: { companyId, clienteId: clientes.get(membershipId)!.id, proveedor: 'CARDNET', membershipId, monto: 1500, moneda: 'DOP', estado: 'APROBADO', autorizacion, activadoAt: new Date(cobrado), fulfillmentEstado },
      select: { id: true },
    })

  // a) cobro entregado después del cumplimiento separado (agosto no: octubre).
  const mA = await crearMembresia(true)
  const a = await intento(mA.id, '2026-10-14T15:00:00Z', 'COMPLETADA', 'AUT-A')
  // b) cobro de antes de que existiera el estado de entrega: 'PENDIENTE' por defecto, pero el producto quedó pagado.
  const mB = await crearMembresia(true)
  const b = await intento(mB.id, '2026-08-05T15:00:00Z', 'PENDIENTE', 'AUT-B')
  // c) renovación automática: su bitácora lleva el intento.
  const mC = await crearMembresia(true)
  const c = await intento(mC.id, '2026-10-13T15:00:00Z', 'COMPLETADA', 'AUT-C')
  await prisma.auditLog.create({
    data: { companyId, userId: null, accion: 'PAGO_APROBADO', entidadTipo: 'Membership', entidadId: mC.id, payload: { motivo: 'renovacion_automatica_tarjeta', intentoId: c.id } },
  })
  // d) cobrado y la entrega falló: NO es un recibo, es conciliación.
  const mD = await crearMembresia(true)
  const d = await intento(mD.id, '2026-10-12T15:00:00Z', 'FALLIDA', 'AUT-D')
  // e) cobrado reciente y sin entregar todavía (PENDIENTE después del cumplimiento separado): tampoco.
  const mE = await crearMembresia(false)
  const e = await intento(mE.id, '2026-10-15T15:00:00Z', 'PENDIENTE', 'AUT-E')

  const antes = await planificarRecibosAnteriores({ companyId })
  const ids = (xs: { intentoId: string }[]) => xs.map((x) => x.intentoId).sort()
  assert.deepEqual(ids(antes.porEmitir), [a.id, b.id, c.id].sort(), 'se emite lo cobrado y entregado')
  assert.equal(antes.yaTenian, 1, 'el intento del test 1 ya tenía su recibo')
  assert.deepEqual(ids(antes.omitidos), [d.id, e.id].sort(), 'lo cobrado sin entregar se lista aparte')
  assert.equal(antes.omitidos.find((o) => o.intentoId === d.id)?.motivo, 'ENTREGA_FALLIDA')
  assert.equal(antes.omitidos.find((o) => o.intentoId === e.id)?.motivo, 'COBRADO_SIN_ENTREGAR')
  assert.deepEqual(antes.porEmitir.map((r) => [r.autorizacion, r.detalle]).sort(), [
    ['AUT-A', 'Plan Oro'],
    ['AUT-B', 'Plan Oro'],
    ['AUT-C', 'Renovación · Oro'],
  ])

  const ventasAntes = await prisma.transaction.count({ where: { companyId, tipo: 'SALE' } })
  const res = await emitirRecibosAnteriores(antes)
  assert.equal(res.creados.length, 3)
  assert.equal(res.fallidos.length, 0)

  // Cada recibo lleva la FECHA DEL COBRO: en su código TX-AAAAMMDD, su fecha y su appliedAt.
  const vb = await prisma.transaction.findFirstOrThrow({ where: { companyId, snapshot: { path: ['intentoId'], equals: b.id } } })
  assert.match(vb.codigo, /^TX-20260805-\d{6}$/, 'el código es del día del cobro, no de hoy')
  assert.equal(vb.createdAt.toISOString(), '2026-08-05T15:00:00.000Z')
  assert.equal(vb.appliedAt?.toISOString(), '2026-08-05T15:00:00.000Z')
  assert.equal(vb.estado, 'APPLIED')
  assert.equal((vb.snapshot as Record<string, unknown>).referenciaPago, 'Aut. AUT-B')
  const va = await prisma.transaction.findFirstOrThrow({ where: { companyId, snapshot: { path: ['intentoId'], equals: a.id } } })
  assert.match(va.codigo, /^TX-20261014-\d{6}$/)
  assert.equal(Number(va.monto), 1500)

  // Repetir no duplica; lo omitido sigue omitido.
  const otra = await planificarRecibosAnteriores({ companyId })
  assert.equal(otra.porEmitir.length, 0)
  assert.equal(otra.yaTenian, 4)
  assert.equal(otra.omitidos.length, 2)
  assert.equal((await emitirRecibosAnteriores(otra)).creados.length, 0)
  assert.equal(await prisma.transaction.count({ where: { companyId, tipo: 'SALE' } }), ventasAntes + 3)

  // La clienta del pago de agosto lo ve en «Mis pagos», con la fecha del cobro.
  const pagos = await getClientePagos(clientes.get(mB.id)!.supabaseId)
  assert.equal(pagos.comprobantes.length, 1)
  assert.equal(pagos.comprobantes[0].fecha.toISOString(), '2026-08-05T15:00:00.000Z')
  assert.equal(pagos.comprobantes[0].detalle, 'Plan Oro')
})
