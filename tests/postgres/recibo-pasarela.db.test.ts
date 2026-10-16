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
