/**
 * PAGO CON TARJETA → RECIBO DEL CLIENTE: "Mis pagos" cuenta lo mismo que el ticket del negocio.
 *
 *   1 · tras un pago real con tarjeta en la app, el historial del cliente trae el recibo (mismo número de ticket,
 *       autorización, negocio) y la forma de pago «Tarjeta (en la app)»;
 *   2 · un recibo ajeno no se filtra: un registro que apunte al cobro de OTRA persona no devuelve su recibo;
 *   3 · un pago anterior (sin cobro de pasarela) sigue viéndose como siempre, sin recibo inventado;
 *   4 · el recibo nunca trae un número de tarjeta.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { confirmarIntento, crearIntento } from '../../src/modules/pagos/intentos'
import { getClientePagos } from '../../src/modules/cliente/queries'

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

async function persona(etiqueta: string) {
  const c = await prisma.company.create({ data: { name: `Negocio ${etiqueta} ${sufijo}`, slug: `rcli-${etiqueta}-${sufijo}`, type: 'carwash', ciudad: 'Santo Domingo' }, select: { id: true } })
  const supabaseId = `sb-rc-${etiqueta}-${sufijo}`
  const cliente = await prisma.cliente.create({ data: { companyId: c.id, supabaseId, nombre: `Persona ${etiqueta}`, email: `rc-${etiqueta}-${sufijo}@prueba.test` }, select: { id: true } })
  const plan = await prisma.plan.create({ data: { companyId: c.id, nombre: `Plan ${etiqueta}`, precio: 500, vigenciaDias: 30, lavadosIncluidos: 4 }, select: { id: true } })
  const m = await prisma.membership.create({ data: { companyId: c.id, clienteId: cliente.id, planId: plan.id }, select: { id: true } })
  return { companyId: c.id, supabaseId, clienteId: cliente.id, planId: plan.id, membershipId: m.id }
}

async function pagarConTarjeta(p: Awaited<ReturnType<typeof persona>>) {
  const i = await crearIntento({ companyId: p.companyId, clienteId: p.clienteId, proveedor: 'CARDNET', membershipId: p.membershipId, monto: 500, canal: 'APP' })
  const r = await confirmarIntento(i.id, { aprobada: true, autorizacion: 'AUTH-C1', motivo: null, crudo: { flujo: 'prueba' }, montoCobrado: 500 })
  assert.ok(r.ok && r.entrega === 'COMPLETADA')
  return i.id
}

test('1 · el cliente ve su recibo: mismo ticket que el negocio, autorización y forma de pago', async () => {
  const p = await persona('uno')
  const intentoId = await pagarConTarjeta(p)
  const venta = await prisma.transaction.findUniqueOrThrow({ where: { pagoIntentoId: intentoId } })

  const { historial } = await getClientePagos(p.supabaseId)
  const pago = historial.find((h) => h.tipo === 'APROBADO')
  assert.ok(pago, 'el pago aparece en su historial')
  assert.equal(pago.formaDePago, 'Tarjeta (en la app)')
  assert.ok(pago.recibo, 'y trae su recibo')
  assert.equal(pago.recibo.ticketNumero, venta.ticketNumero, 'el MISMO ticket que tiene el negocio')
  assert.equal(pago.recibo.codigo, venta.codigo)
  assert.equal(pago.recibo.autorizacion, 'AUTH-C1')
  assert.equal(pago.recibo.canal, 'APP')
  assert.equal(pago.recibo.empresaNombre, `Negocio uno ${sufijo}`)
  assert.equal(pago.recibo.monto, 500)
  assert.match(pago.recibo.texto, new RegExp(`Nº ${venta.ticketNumero}`))
  assert.match(pago.recibo.texto, /Pagado con: Tarjeta \(en la app\)/)
  assert.match(pago.recibo.texto, /Autorización: AUTH-C1/)
  assert.match(pago.recibo.texto, /Concepto: Membresía Plan uno/)
})

test('2 · un recibo ajeno no se filtra: un registro que apunta al cobro de otra persona no lo devuelve', async () => {
  const dueno = await persona('dueno')
  const intentoDeOtro = await pagarConTarjeta(dueno)
  const intruso = await persona('intruso')
  await prisma.auditLog.create({
    data: {
      companyId: intruso.companyId,
      accion: 'PAGO_APROBADO',
      entidadTipo: 'Membership',
      entidadId: intruso.membershipId,
      payload: { planId: intruso.planId, clienteId: intruso.clienteId, monto: 500, metodo: 'TARJETA', canal: 'APP', intentoId: intentoDeOtro },
    },
  })
  const { historial } = await getClientePagos(intruso.supabaseId)
  const pago = historial.find((h) => h.tipo === 'APROBADO')
  assert.ok(pago)
  assert.equal(pago.recibo, null, 'el ticket del cobro de otra persona no se le entrega')
  assert.doesNotMatch(JSON.stringify(historial), new RegExp(dueno.companyId))
  assert.doesNotMatch(JSON.stringify(historial), /AUTH-C1/)
})

test('3 · un pago anterior (sin cobro de pasarela) se ve como siempre, sin recibo inventado', async () => {
  const p = await persona('antiguo')
  await prisma.auditLog.create({
    data: {
      companyId: p.companyId,
      accion: 'PAGO_APROBADO',
      entidadTipo: 'Membership',
      entidadId: p.membershipId,
      payload: { planId: p.planId, clienteId: p.clienteId, monto: 500 },
    },
  })
  const { historial } = await getClientePagos(p.supabaseId)
  const pago = historial.find((h) => h.tipo === 'APROBADO')
  assert.ok(pago)
  assert.equal(pago.recibo, null)
  assert.equal(pago.formaDePago, null)
  assert.equal(pago.monto, 500)
})

test('4 · el recibo nunca trae un número de tarjeta', async () => {
  const p = await persona('seguro')
  const intentoId = await pagarConTarjeta(p)
  // Aunque algo escribiera un número completo en la etiqueta de la venta, no llega al cliente.
  const venta = await prisma.transaction.findUniqueOrThrow({ where: { pagoIntentoId: intentoId } })
  await prisma.$executeRawUnsafe(
    `UPDATE "transactions" SET "snapshot" = jsonb_set("snapshot", '{metodoCobroLabel}', '"Tarjeta 4111111111111111 (en la app)"') WHERE "id" = $1`,
    venta.id
  )
  const { historial } = await getClientePagos(p.supabaseId)
  const pago = historial.find((h) => h.tipo === 'APROBADO')!
  assert.doesNotMatch(JSON.stringify(pago), /\d{13,}/, 'ninguna cadena de 13 o más dígitos')
  assert.ok(pago.recibo)
})
