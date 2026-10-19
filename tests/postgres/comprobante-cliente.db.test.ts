import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { prisma } from '../../src/lib/prisma'
import { asegurarVentaDelIntento } from '../../src/modules/pagos/venta-tarjeta'
import { getClientePagos } from '../../src/modules/cliente/queries'
import { ticketParaCliente } from '../../src/modules/transacciones/comprobanteCliente'

/**
 * EL COMPROBANTE DEL CLIENTE SOBRE EL LIBRO DE TARJETA, CONTRA POSTGRESQL (fusión con `main`, 19-10-2026).
 *
 * `main` trajo su propio camino para dejar el recibo de un pago con tarjeta (`reciboPasarela`, venta `OTRO` con el intento en el
 * snapshot) y la pantalla del cliente para imprimirlo. Esta rama ya escribía la venta del cobro por `asegurarVentaDelIntento`
 * (método TARJETA, único por `pagoIntentoId`). Dos caminos para el mismo cobro serían dos ventas del mismo dinero. Se conservó UNO,
 * el de esta rama, y la pantalla del cliente de `main` se apoya en él. Esto fija, con la base real:
 *
 *   1  un cobro aprobado y entregado deja UNA venta, y repetir no escribe otra;
 *   2  un recibo escrito por el camino retirado se ADOPTA (enlace al cobro, método TARJETA), no se duplica;
 *   3  «Mis pagos» lista el comprobante y enlaza cada pago aprobado con SU venta por el cobro, no por cercanía de fecha;
 *   4  el comprobante es del dueño: otra persona no lo obtiene.
 *
 * `npm run test:db`.
 */

const sufijo = randomUUID().slice(0, 8)
const supabaseId = `db-comprobante-${sufijo}`
let companyId = ''
let clienteId = ''
let membershipId = ''
let planId = ''

async function intentoAprobado(extra: Record<string, unknown> = {}) {
  return prisma.pagoIntento.create({
    data: {
      companyId,
      clienteId,
      proveedor: 'CARDNET',
      membershipId,
      monto: 1500,
      moneda: 'DOP',
      estado: 'APROBADO',
      autorizacion: '123456',
      canal: 'APP',
      activadoAt: new Date(),
      fulfillmentEstado: 'COMPLETADA',
      fulfillmentAt: new Date(),
      ...extra,
    },
    select: { id: true, activadoAt: true },
  })
}

before(async () => {
  const company = await prisma.company.create({ data: { name: `Comprobantes ${sufijo}`, slug: `comprobantes-${sufijo}`, type: 'carwash' }, select: { id: true } })
  companyId = company.id
  const cliente = await prisma.cliente.create({
    data: { companyId, supabaseId, nombre: 'Juana Recibo', email: `juana.${sufijo}@membego.test` },
    select: { id: true },
  })
  clienteId = cliente.id
  const plan = await prisma.plan.create({ data: { companyId, nombre: 'Plan Oro', precio: 1500 }, select: { id: true } })
  planId = plan.id
  const membership = await prisma.membership.create({
    data: { companyId, clienteId, planId, estado: 'ACTIVA', pagoConfirmado: true, montoPagado: 1500, fechaPago: new Date() },
    select: { id: true },
  })
  membershipId = membership.id
})

after(async () => {
  await prisma.$disconnect()
})

test('1 · un cobro entregado deja UNA venta de tarjeta, y repetir no escribe otra', async () => {
  const i = await intentoAprobado()
  const primera = await asegurarVentaDelIntento(i.id)
  assert.ok(primera?.nueva, 'la primera vez crea la venta')
  assert.match(primera.codigo, /^TX-\d{8}-\d{6}$/)
  const segunda = await asegurarVentaDelIntento(i.id)
  assert.deepEqual([segunda?.id, segunda?.nueva], [primera.id, false], 'la segunda devuelve la misma')

  const v = await prisma.transaction.findUniqueOrThrow({ where: { pagoIntentoId: i.id } })
  const s = v.snapshot as Record<string, unknown>
  assert.deepEqual([v.tipo, v.estado, v.metodoCobro, Number(v.monto), v.membershipId], ['SALE', 'APPLIED', 'TARJETA', 1500, membershipId])
  assert.equal(s.referenciaPago, 'Aut. 123456')
  assert.equal(s.canalDeCobro, 'APP')
  assert.equal(await prisma.transaction.count({ where: { pagoIntentoId: i.id } }), 1)
})

test('2 · un recibo escrito por el camino retirado se ADOPTA: el cobro queda con una sola venta, ahora de tarjeta y enlazada', async () => {
  const i = await intentoAprobado({ autorizacion: '654321' })
  // Tal como la dejaba `reciboPasarela`: método OTRO, sin `pagoIntentoId`, el intento en el snapshot.
  const legada = await prisma.transaction.create({
    data: {
      codigo: `TX-LEGADA-${sufijo}`,
      ticketNumero: `TCK-LEG-${sufijo}`,
      tipo: 'SALE',
      estado: 'APPLIED',
      companyId,
      clienteId,
      membershipId,
      monto: 1500,
      metodoCobro: 'OTRO',
      appliedAt: new Date(),
      snapshot: {
        detalle: 'Plan Oro',
        cliente: 'Juana Recibo',
        total: '1500.00',
        metodoCobroLabel: 'Tarjeta (CardNET)',
        referenciaPago: 'Aut. 654321',
        intentoId: i.id,
      },
    },
    select: { id: true },
  })

  const venta = await asegurarVentaDelIntento(i.id)
  assert.deepEqual([venta?.id, venta?.nueva], [legada.id, false], 'devuelve la venta que ya existía, no escribe otra')
  assert.equal(await prisma.transaction.count({ where: { OR: [{ pagoIntentoId: i.id }, { snapshot: { path: ['intentoId'], equals: i.id } }] } }), 1)

  const v = await prisma.transaction.findUniqueOrThrow({ where: { id: legada.id } })
  const s = v.snapshot as Record<string, unknown>
  assert.deepEqual([v.pagoIntentoId, v.metodoCobro, Number(v.monto), v.ticketNumero], [i.id, 'TARJETA', 1500, `TCK-LEG-${sufijo}`], 'mismo ticket e importe; ahora enlazada y de tarjeta')
  assert.equal(s.canalDeCobro, 'APP')
  assert.equal(s.autorizacion, '654321')
  assert.equal(s.adoptadaDe, 'reciboPasarela')
  assert.equal(s.detalle, 'Plan Oro', 'conserva lo que ya decía')

  assert.equal((await asegurarVentaDelIntento(i.id))?.nueva, false, 'y repetir sigue sin duplicar')
})

test('3 · «Mis pagos» lista el comprobante y enlaza cada pago aprobado con SU venta, por el cobro y no por la fecha', async () => {
  const antes = new Date(Date.now() - 3_600_000)
  const i = await intentoAprobado({ autorizacion: '777888', activadoAt: antes })
  // El pago aprobado del historial: lo que escribe la activación.
  const log = await prisma.auditLog.create({
    data: {
      companyId, userId: null, accion: 'PAGO_APROBADO', entidadTipo: 'Membership', entidadId: membershipId,
      payload: { planId, clienteId, monto: 1500, metodo: 'TARJETA', canal: 'APP', intentoId: i.id },
    },
  })
  const venta = await asegurarVentaDelIntento(i.id)
  assert.ok(venta)
  // Otra venta de la MISMA membresía, más cercana en el tiempo al pago del historial: por fecha ganaría ella.
  await prisma.transaction.create({
    data: {
      codigo: `TX-CERCA-${sufijo}`, ticketNumero: `TCK-CER-${sufijo}`, tipo: 'SALE', estado: 'APPLIED', companyId, clienteId, membershipId,
      monto: 300, metodoCobro: 'EFECTIVO', appliedAt: log.createdAt, createdAt: log.createdAt, snapshot: { detalle: 'Otra venta' },
    },
  })

  const pagos = await getClientePagos(supabaseId)
  assert.ok(pagos.comprobantes.some((c) => c.id === venta.id && c.metodoPago?.startsWith('Tarjeta')), 'el comprobante de la tarjeta está listado')
  const item = pagos.historial.find((h) => h.id === log.id)
  assert.ok(item, 'el PAGO_APROBADO está en el historial')
  assert.equal(item.transaccionId, venta.id, 'apunta a la venta de ESE cobro, no a la más cercana en fecha')
  assert.equal(item.recibo?.ticketNumero, venta.ticketNumero)
  assert.match(item.formaDePago ?? '', /^Tarjeta/)
})

test('4 · el comprobante es del dueño: la dueña lo obtiene, otra persona no', async () => {
  const venta = await prisma.transaction.findFirstOrThrow({ where: { companyId, clienteId, tipo: 'SALE', metodoCobro: 'TARJETA' }, select: { id: true } })
  const mio = await ticketParaCliente(venta.id, supabaseId)
  assert.ok(mio)
  assert.equal(mio.transaccion.cliente, 'Juana Recibo')
  assert.match(mio.transaccion.referenciaPago ?? '', /^Aut\. /)
  assert.equal(mio.lineas.length, 1)

  assert.equal(await ticketParaCliente(venta.id, `otra-persona-${sufijo}`), null)
  assert.equal(await ticketParaCliente('no-existe', supabaseId), null)
})
