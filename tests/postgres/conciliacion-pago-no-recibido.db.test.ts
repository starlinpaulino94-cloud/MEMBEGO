/**
 * CONCILIACIÓN · «ANULAR PAGO NO RECIBIDO» — contra PostgreSQL, con los dos casos reales de oct-2026.
 *
 * En CARTOWN quedaban dos membresías con el pago confirmado a mano y sin ninguna venta: una transferencia aprobada que
 * nunca llegó al banco y una renovación en el mostrador que nadie pagó. Las dos ya habían vencido. La conciliación solo
 * ofrecía «Abrir ficha», y la ficha no tiene cómo deshacer un pago: el aviso se quedaba y el importe seguía en los ingresos.
 *
 *   A · una membresía vencida con pago sin venta ofrece «Anular pago no recibido»; una ACTIVA solo la ficha;
 *   B · anular exige nota, quita el pago (deja de sumar en los ingresos), sale de la conciliación y deja su bitácora;
 *   C · el servidor rechaza una ACTIVA, una con venta, una de otra empresa; repetirlo no hace nada.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { conciliar } from '../../src/modules/observabilidad/conciliacion'
import { anularPagoNoRecibido, type ActorDeConciliacion } from '../../src/modules/observabilidad/conciliacion-servicio'

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const DIA = 86_400_000
const NOTA = 'La transferencia nunca llegó al banco.'

interface Empresa { companyId: string; planId: string; userId: string }

async function crearEmpresa(etiqueta: string): Promise<Empresa> {
  const c = await prisma.company.create({ data: { name: `Anular ${etiqueta} ${sufijo}`, slug: `anular-${etiqueta}-${sufijo}`, type: 'carwash', ciudad: 'Santo Domingo' }, select: { id: true } })
  const plan = await prisma.plan.create({ data: { companyId: c.id, nombre: `Plan ${etiqueta}`, precio: 2600, vigenciaDias: 30, lavadosIncluidos: 4 }, select: { id: true } })
  const u = await prisma.user.create({ data: { supabaseId: `sb-anu-${etiqueta}-${sufijo}`, email: `anu-${etiqueta}-${sufijo}@prueba.test`, name: `Gerente ${etiqueta}`, role: 'ADMINISTRADOR', companyId: c.id }, select: { id: true } })
  return { companyId: c.id, planId: plan.id, userId: u.id }
}

const actor = (e: Empresa): ActorDeConciliacion => ({ userId: e.userId, ipAddress: '10.0.0.7', userAgent: 'prueba' })

/** Una membresía pagada a mano (sin cobro de pasarela) de un cliente nuevo de la empresa. */
async function pagadaAMano(e: Empresa, n: string, extra: Record<string, unknown> = {}) {
  const cliente = await prisma.cliente.create({ data: { companyId: e.companyId, supabaseId: `sb-anc-${n}-${sufijo}`, nombre: `Cliente ${n}`, email: `anc-${n}-${sufijo}@prueba.test` }, select: { id: true } })
  const hace = new Date(Date.now() - 20 * DIA)
  return prisma.membership.create({
    data: { companyId: e.companyId, clienteId: cliente.id, planId: e.planId, estado: 'VENCIDA', pagoConfirmado: true, montoPagado: 2600, fechaPago: hace, fechaInicio: hace, ...extra },
    select: { id: true, clienteId: true },
  })
}

const casosSinVenta = async (e: Empresa) =>
  (await conciliar(e.companyId, 90)).hallazgos.find((h) => h.clave === 'cobro-sin-transaccion')?.casos.filter((c) => c.tipo === 'MEMBRESIA_SIN_TRANSACCION') ?? []

const ingresos = async (e: Empresa) =>
  Number((await prisma.membership.aggregate({ where: { companyId: e.companyId, pagoConfirmado: true }, _sum: { montoPagado: true } }))._sum.montoPagado ?? 0)

test('A · una membresía vencida con pago sin venta ofrece «Anular pago no recibido»; una activa, solo la ficha', async () => {
  const e = await crearEmpresa('a')
  const vencida = await pagadaAMano(e, 'a-vencida')
  const activa = await pagadaAMano(e, 'a-activa', { estado: 'ACTIVA' })
  const casos = await casosSinVenta(e)
  assert.deepEqual(casos.find((c) => c.id === vencida.id)?.acciones, ['ANULAR_PAGO_NO_RECIBIDO', 'ABRIR_FICHA'])
  assert.deepEqual(casos.find((c) => c.id === activa.id)?.acciones, ['ABRIR_FICHA'], 'activa: primero se cancela en la ficha')
})

test('B · anular exige nota, quita el pago de los ingresos, sale de la conciliación y deja la bitácora', async () => {
  const e = await crearEmpresa('b')
  const m = await pagadaAMano(e, 'b')
  assert.equal(await ingresos(e), 2600)

  const corta = await anularPagoNoRecibido(e.companyId, m.id, actor(e), 'no')
  assert.ok(!corta.ok && /nota/.test(corta.error))
  assert.equal(await ingresos(e), 2600, 'sin nota no se toca nada')

  const r = await anularPagoNoRecibido(e.companyId, m.id, actor(e), NOTA)
  assert.ok(r.ok, JSON.stringify(r))
  const despues = await prisma.membership.findUniqueOrThrow({ where: { id: m.id }, select: { estado: true, pagoConfirmado: true, montoPagado: true, fechaPago: true } })
  assert.deepEqual(despues, { estado: 'VENCIDA', pagoConfirmado: false, montoPagado: null, fechaPago: null }, 'solo cambia el pago')
  assert.equal(await ingresos(e), 0)
  assert.equal((await casosSinVenta(e)).length, 0, 'el caso sale de la conciliación')
  assert.equal(await prisma.transaction.count({ where: { companyId: e.companyId } }), 0, 'no se registra ninguna venta')

  const asientos = await prisma.auditLog.findMany({ where: { companyId: e.companyId, accion: 'CONCILIACION_PAGO_ANULADO' }, select: { userId: true, entidadTipo: true, entidadId: true, payload: true } })
  assert.equal(asientos.length, 1)
  assert.equal(asientos[0].userId, e.userId)
  assert.deepEqual([asientos[0].entidadTipo, asientos[0].entidadId], ['Membership', m.id])
  const p = asientos[0].payload as Record<string, unknown>
  assert.equal(p.nota, NOTA)
  assert.equal(p.montoAnulado, 2600)
  assert.ok(typeof p.fechaPagoAnterior === 'string', 'guarda la fecha que tenía')

  const otra = await anularPagoNoRecibido(e.companyId, m.id, actor(e), NOTA)
  assert.ok(otra.ok && /nada que anular/.test(otra.mensaje), 'repetir no hace nada')
  assert.equal(await prisma.auditLog.count({ where: { companyId: e.companyId, accion: 'CONCILIACION_PAGO_ANULADO' } }), 1, 'ni asienta dos veces')
})

test('C · el servidor rechaza una membresía activa, una con venta y una de otra empresa', async () => {
  const e = await crearEmpresa('c')
  const otraEmpresa = await crearEmpresa('c-otra')

  const activa = await pagadaAMano(e, 'c-activa', { estado: 'ACTIVA' })
  const r1 = await anularPagoNoRecibido(e.companyId, activa.id, actor(e), NOTA)
  assert.ok(!r1.ok && /activa/.test(r1.error))

  const conVenta = await pagadaAMano(e, 'c-venta')
  await prisma.transaction.create({
    data: { companyId: e.companyId, clienteId: conVenta.clienteId, membershipId: conVenta.id, tipo: 'SALE', estado: 'APPLIED', monto: 2600, codigo: `TX-AN-${sufijo}`, ticketNumero: `T-AN-${sufijo}` },
  })
  const r2 = await anularPagoNoRecibido(e.companyId, conVenta.id, actor(e), NOTA)
  assert.ok(r2.ok && /nada que anular/.test(r2.mensaje), 'un pago con venta no es este caso')

  const ajena = await pagadaAMano(e, 'c-ajena')
  const r3 = await anularPagoNoRecibido(otraEmpresa.companyId, ajena.id, actor(otraEmpresa), NOTA)
  assert.ok(!r3.ok && /no encontrada/i.test(r3.error), 'el id de otra empresa no encuentra nada')

  const intactas = await prisma.membership.findMany({ where: { id: { in: [activa.id, conVenta.id, ajena.id] } }, select: { pagoConfirmado: true } })
  assert.ok(intactas.every((m) => m.pagoConfirmado), 'ninguna perdió su pago')
  assert.equal(await prisma.auditLog.count({ where: { companyId: { in: [e.companyId, otraEmpresa.companyId] }, accion: 'CONCILIACION_PAGO_ANULADO' } }), 0)
})
