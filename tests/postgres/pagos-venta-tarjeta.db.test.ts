/**
 * PAGO CON TARJETA → COMPROBANTE · fase 2: la venta del cobro, con los servicios de verdad.
 *
 * `asegurarVentaDelIntento` (pagos/venta-tarjeta.ts) escribe en el libro, tras cada cumplimiento, la venta del
 * cobro aprobado:
 *   1 · una venta por cobro, aunque la confirmación llegue repetida o a la vez (webhook + retorno del navegador);
 *   2 · también para una compra de promoción, con su etiqueta;
 *   3 · un cobro rechazado no deja venta;
 *   4 · una entrega que falló no deja venta hasta que el reintento la completa (y entonces deja UNA);
 *   5 · AUTORREPARACIÓN: si la venta faltó, una repetición del cobro ya entregado la escribe;
 *   6 · el comprobante nunca lleva datos de tarjeta aunque la respuesta cruda de la pasarela los trajera;
 *   7 · un intento anterior a la columna `canal` produce un comprobante honesto («Tarjeta»);
 *   8 · el monto de la venta es el que COBRÓ la pasarela (el del intento), no uno recalculado.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { confirmarIntento, crearIntento, reintentarEntrega } from '../../src/modules/pagos/intentos'
import { asegurarVentaDelIntento } from '../../src/modules/pagos/venta-tarjeta'

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const PRECIO = 500

interface Empresa {
  companyId: string
  clienteId: string
  planId: string
}

async function crearEmpresa(etiqueta: string): Promise<Empresa> {
  const c = await prisma.company.create({ data: { name: `VentaTarjeta ${etiqueta} ${sufijo}`, slug: `vtarjeta-${etiqueta}-${sufijo}`, type: 'carwash', ciudad: 'Santo Domingo' }, select: { id: true } })
  const cliente = await prisma.cliente.create({ data: { companyId: c.id, supabaseId: `sb-vt-${etiqueta}-${sufijo}`, nombre: `Cliente ${etiqueta}`, email: `vt-${etiqueta}-${sufijo}@prueba.test` }, select: { id: true } })
  const plan = await prisma.plan.create({ data: { companyId: c.id, nombre: `Plan ${etiqueta}`, precio: PRECIO, vigenciaDias: 30, lavadosIncluidos: 4 }, select: { id: true } })
  return { companyId: c.id, clienteId: cliente.id, planId: plan.id }
}

const membresia = (e: Empresa, extra: Record<string, unknown> = {}) =>
  prisma.membership.create({ data: { companyId: e.companyId, clienteId: e.clienteId, planId: e.planId, ...extra }, select: { id: true } })

const aprobar = (intentoId: string, extra: Record<string, unknown> = {}) =>
  confirmarIntento(intentoId, { aprobada: true, autorizacion: 'AUTH-V', motivo: null, crudo: { flujo: 'prueba' }, montoCobrado: PRECIO, ...extra })

const ventasDe = (intentoId: string) => prisma.transaction.findMany({ where: { pagoIntentoId: intentoId } })

test('1 · una venta por cobro: la confirmación repetida y la simultánea (webhook + retorno del navegador) no duplican el ticket', async () => {
  const e = await crearEmpresa('uno')
  const m = await membresia(e)
  const i = await crearIntento({ companyId: e.companyId, clienteId: e.clienteId, proveedor: 'CARDNET', membershipId: m.id, monto: PRECIO, canal: 'APP' })

  const resultados = await Promise.all([aprobar(i.id), aprobar(i.id), aprobar(i.id), aprobar(i.id), aprobar(i.id)])
  assert.ok(resultados.every((r) => r.ok), 'todas responden bien (una activa, las demás son repeticiones)')
  assert.equal((await ventasDe(i.id)).length, 1, 'UNA venta')
  assert.equal(await prisma.transaction.count({ where: { companyId: e.companyId } }), 1, 'y ninguna otra en la empresa')

  await aprobar(i.id) // y una más, ya a destiempo
  assert.equal((await ventasDe(i.id)).length, 1)
  const ticket = (await ventasDe(i.id))[0]!.ticketNumero
  const ids = await Promise.all([asegurarVentaDelIntento(i.id), asegurarVentaDelIntento(i.id)])
  assert.ok(ids.every((x) => x && !x.nueva && x.ticketNumero === ticket), 'pedir la venta otra vez devuelve la misma, no crea otra')
})

test('2 · una compra de promoción pagada con tarjeta en la web deja su venta con su etiqueta', async () => {
  const e = await crearEmpresa('promo')
  const promo = await prisma.promocion.create({ data: { companyId: e.companyId, titulo: 'Lavado Premium', descripcion: 'Prueba', precio: 300 }, select: { id: true } })
  const compra = await prisma.productoCompra.create({ data: { companyId: e.companyId, clienteId: e.clienteId, promocionId: promo.id, estado: 'PENDIENTE_PAGO', precioCongelado: 300 }, select: { id: true } })
  const i = await crearIntento({ companyId: e.companyId, clienteId: e.clienteId, proveedor: 'CARDNET', compraId: compra.id, monto: 300, canal: 'WEB' })
  const r = await aprobar(i.id, { montoCobrado: 300 })
  assert.equal(r.ok && r.entrega, 'COMPLETADA')
  const v = await ventasDe(i.id)
  assert.equal(v.length, 1)
  const snap = v[0]!.snapshot as Record<string, unknown>
  assert.equal(snap.detalle, 'Promoción Lavado Premium')
  assert.equal(snap.metodoCobroLabel, 'Tarjeta (en la web)')
  assert.equal(Number(v[0]!.monto), 300)
  assert.equal(v[0]!.membershipId, null)
  const log = await prisma.auditLog.findFirstOrThrow({ where: { companyId: e.companyId, accion: 'PAGO_APROBADO', entidadId: compra.id } })
  assert.equal((log.payload as Record<string, unknown>).metodo, 'TARJETA')
})

test('3 · un cobro rechazado no deja venta', async () => {
  const e = await crearEmpresa('rechazo')
  const m = await membresia(e)
  const i = await crearIntento({ companyId: e.companyId, clienteId: e.clienteId, proveedor: 'CARDNET', membershipId: m.id, monto: PRECIO, canal: 'APP' })
  const r = await confirmarIntento(i.id, { aprobada: false, autorizacion: null, motivo: 'Fondos insuficientes', crudo: null })
  assert.equal(r.ok, false)
  assert.equal((await ventasDe(i.id)).length, 0)
  assert.equal(await prisma.transaction.count({ where: { companyId: e.companyId } }), 0)
  assert.equal(await asegurarVentaDelIntento(i.id), null, 'ni pidiéndola a mano: un cobro rechazado no se factura')
})

test('4 · una entrega que falló no deja venta; el reintento que la completa deja UNA', async () => {
  const e = await crearEmpresa('falla')
  const m = await membresia(e, { estado: 'CANCELADA' }) // una membresía cancelada no se puede activar: la entrega falla
  const i = await crearIntento({ companyId: e.companyId, clienteId: e.clienteId, proveedor: 'CARDNET', membershipId: m.id, monto: PRECIO, canal: 'APP' })
  const r = await aprobar(i.id)
  assert.equal(r.ok && r.entrega, 'FALLIDA')
  assert.equal((await prisma.pagoIntento.findUniqueOrThrow({ where: { id: i.id } })).fulfillmentEstado, 'FALLIDA')
  assert.equal((await ventasDe(i.id)).length, 0, 'cobrado pero NO entregado: todavía no hay venta')
  assert.equal(await asegurarVentaDelIntento(i.id), null)

  // Se corrige la causa (la membresía vuelve a poder activarse) y se reintenta la entrega.
  await prisma.membership.update({ where: { id: m.id }, data: { estado: 'PENDIENTE' } })
  const retry = await reintentarEntrega(i.id)
  assert.equal(retry.entrega, 'COMPLETADA')
  assert.equal((await ventasDe(i.id)).length, 1, 'entregado: ahora sí, UNA venta')
  assert.equal((await reintentarEntrega(i.id)).entrega, 'COMPLETADA')
  assert.equal((await ventasDe(i.id)).length, 1, 'reintentar otra vez no duplica')
})

test('5 · autorreparación: si la venta faltó, una repetición del cobro ya entregado la escribe', async () => {
  const e = await crearEmpresa('repara')
  const m = await membresia(e)
  const i = await crearIntento({ companyId: e.companyId, clienteId: e.clienteId, proveedor: 'CARDNET', membershipId: m.id, monto: PRECIO, canal: 'APP' })
  await aprobar(i.id)
  const original = (await ventasDe(i.id))[0]!
  // Se simula el fallo: el cobro quedó entregado pero la venta no se escribió.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    await tx.$executeRawUnsafe(`DELETE FROM "transaction_transitions" WHERE "transactionId" = '${original.id}'`)
    await tx.$executeRawUnsafe(`DELETE FROM "transactions" WHERE "id" = '${original.id}'`)
  })
  assert.equal((await ventasDe(i.id)).length, 0)
  assert.equal((await prisma.pagoIntento.findUniqueOrThrow({ where: { id: i.id } })).fulfillmentEstado, 'COMPLETADA')

  const repetido = await aprobar(i.id) // el webhook llega otra vez
  assert.equal(repetido.ok && repetido.yaEstaba, true)
  const reparada = await ventasDe(i.id)
  assert.equal(reparada.length, 1, 'la venta que faltó se escribió')
  assert.equal(Number(reparada[0]!.monto), PRECIO)
})

test('6 · el comprobante nunca lleva datos de tarjeta, aunque la respuesta cruda de la pasarela los trajera', async () => {
  const e = await crearEmpresa('pan')
  const m = await membresia(e)
  const i = await crearIntento({ companyId: e.companyId, clienteId: e.clienteId, proveedor: 'CARDNET', membershipId: m.id, monto: PRECIO, canal: 'APP' })
  await aprobar(i.id, { crudo: { Transaction: { CardNumber: '4111111111111111', Cvv: '123', Holder: 'ANA PEREZ' } } })
  const v = (await ventasDe(i.id))[0]!
  const texto = JSON.stringify({ snapshot: v.snapshot, auditoria: v.auditoria, resultado: v.resultado })
  for (const prohibido of ['4111', 'Cvv', 'CardNumber', 'ANA PEREZ']) assert.equal(texto.includes(prohibido), false, `se coló: ${prohibido}`)
})

test('7 · un intento anterior a la columna `canal` produce un comprobante honesto: solo «Tarjeta»', async () => {
  const e = await crearEmpresa('legado')
  const m = await membresia(e)
  const i = await crearIntento({ companyId: e.companyId, clienteId: e.clienteId, proveedor: 'CARDNET', membershipId: m.id, monto: PRECIO })
  assert.equal((await prisma.pagoIntento.findUniqueOrThrow({ where: { id: i.id } })).canal, null)
  await aprobar(i.id)
  const snap = (await ventasDe(i.id))[0]!.snapshot as Record<string, unknown>
  assert.equal(snap.metodoCobroLabel, 'Tarjeta')
  assert.equal(snap.canalDeCobro, undefined)
})

test('8 · el monto de la venta es el que cobró la pasarela (el del intento), no uno recalculado', async () => {
  const e = await crearEmpresa('monto')
  const m = await membresia(e, { descuentoBienvenida: 100 })
  const i = await crearIntento({ companyId: e.companyId, clienteId: e.clienteId, proveedor: 'CARDNET', membershipId: m.id, monto: 400, canal: 'WEB' })
  const r = await aprobar(i.id, { montoCobrado: 400 })
  assert.equal(r.ok && r.entrega, 'COMPLETADA')
  const v = (await ventasDe(i.id))[0]!
  assert.equal(Number(v.monto), 400)
  assert.equal((v.snapshot as Record<string, unknown>).total, '400.00')
})
