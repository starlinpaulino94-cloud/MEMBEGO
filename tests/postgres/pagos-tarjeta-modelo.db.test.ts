/**
 * PAGO CON TARJETA → COMPROBANTE · fase 1: lo que la BASE hace cumplir.
 *
 * Migraciones 20261053/20261054:
 *   · `MetodoCobroTipo.TARJETA` existe.
 *   · `transactions.pagoIntentoId` es ÚNICO: un cobro aprobado deja UNA venta.
 *   · Solo una venta `SALE` con método TARJETA lleva intento (CHECK `transactions_pago_intento_coherente`).
 *   · El intento es de la MISMA empresa y está APROBADO (disparador `transactions_pago_intento_empresa`).
 *   · El backfill del cumplimiento marca COMPLETADA solo lo demostrable, no toca el resto y es idempotente.
 *     Se ejecuta el MISMO bloque de la migración (entre `-- BACKFILL:INICIO` y `-- BACKFILL:FIN`).
 */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MetodoCobroTipo } from '@prisma/client'
import { prisma } from '../../src/lib/prisma'
import { crearTransaccionAplicada } from '../../src/lib/transactions/application/transaction-service'
import { snapshotDeCobroConTarjeta } from '../../src/modules/pagos/comprobante-tarjeta'

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

interface Empresa {
  companyId: string
  clienteId: string
  planId: string
}

async function crearEmpresa(etiqueta: string): Promise<Empresa> {
  const c = await prisma.company.create({ data: { name: `TarjetaModelo ${etiqueta} ${sufijo}`, slug: `tmodelo-${etiqueta}-${sufijo}`, type: 'carwash', ciudad: 'Santo Domingo' }, select: { id: true } })
  const cliente = await prisma.cliente.create({ data: { companyId: c.id, supabaseId: `sb-tm-${etiqueta}-${sufijo}`, nombre: `Cliente ${etiqueta}`, email: `tm-${etiqueta}-${sufijo}@prueba.test` }, select: { id: true } })
  const plan = await prisma.plan.create({ data: { companyId: c.id, nombre: `Plan ${etiqueta}`, precio: 500 }, select: { id: true } })
  return { companyId: c.id, clienteId: cliente.id, planId: plan.id }
}

/** Un cobro de pasarela siempre apunta a UN objetivo (membresía XOR compra): aquí, una compra de promoción. */
const intento = async (e: Empresa, extra: Record<string, unknown> = {}) => {
  const compra = await prisma.productoCompra.create({ data: { companyId: e.companyId, clienteId: e.clienteId, estado: 'PENDIENTE_PAGO' }, select: { id: true } })
  return prisma.pagoIntento.create({ data: { companyId: e.companyId, clienteId: e.clienteId, proveedor: 'CARDNET', monto: 500, estado: 'APROBADO', activadoAt: new Date(), autorizacion: 'AUTH-M', compraId: compra.id, ...extra }, select: { id: true } })
}

const venta = (e: Empresa, pagoIntentoId: string | null, extra: Record<string, unknown> = {}) =>
  crearTransaccionAplicada(prisma, {
    tipo: 'SALE',
    companyId: e.companyId,
    clienteId: e.clienteId,
    monto: 500,
    metodoCobro: 'TARJETA',
    pagoIntentoId,
    snapshot: snapshotDeCobroConTarjeta({ detalle: 'Membresía', clienteNombre: 'Cliente', monto: 500, canal: 'APP', pagoIntentoId: pagoIntentoId ?? 'x', autorizacion: 'AUTH-M' }),
    timeZone: 'America/Santo_Domingo',
    ...(extra as object),
  })

/** El mensaje completo del rechazo (Prisma + PostgreSQL). */
async function rechazo(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
  return ''
}

let bloqueBackfill = ''
before(() => {
  const sql = readFileSync('prisma/migrations/20261054_tarjeta_en_el_libro/migration.sql', 'utf8')
  const i = sql.indexOf('-- BACKFILL:INICIO')
  const f = sql.indexOf('-- BACKFILL:FIN')
  assert.ok(i > 0 && f > i, 'la migración trae su bloque de backfill delimitado')
  bloqueBackfill = sql.slice(i, f)
})

test('1 · el libro conoce el método TARJETA', () => {
  assert.deepEqual(Object.values(MetodoCobroTipo).sort(), ['EFECTIVO', 'OTRO', 'TARJETA', 'TRANSFERENCIA'])
})

test('2 · un cobro aprobado deja UNA venta: el mismo intento no admite otra (índice único)', async () => {
  const e = await crearEmpresa('unica')
  const i = await intento(e)
  const t = await venta(e, i.id)
  assert.match(t.ticketNumero, /^TCK-\d+$/)
  const db = await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } })
  assert.deepEqual([db.tipo, db.estado, db.metodoCobro, db.pagoIntentoId], ['SALE', 'APPLIED', 'TARJETA', i.id])
  assert.match(await rechazo(venta(e, i.id)), /pagoIntentoId|Unique constraint/i, 'la segunda venta del mismo cobro se rechaza')
  assert.equal(await prisma.transaction.count({ where: { pagoIntentoId: i.id } }), 1)
  // Una venta sin intento (caja, panel) no se ve afectada: pueden existir todas las que se quiera.
  await venta(e, null, { metodoCobro: 'EFECTIVO' })
  await venta(e, null, { metodoCobro: 'EFECTIVO' })
})

test('3 · solo una venta SALE con método TARJETA puede llevar intento de pago (CHECK)', async () => {
  const e = await crearEmpresa('coherente')
  const i1 = await intento(e)
  const i2 = await intento(e)
  assert.match(await rechazo(venta(e, i1.id, { metodoCobro: 'EFECTIVO' })), /transactions_pago_intento_coherente/)
  assert.match(await rechazo(venta(e, i2.id, { tipo: 'OTHER' })), /transactions_pago_intento_coherente/)
  assert.equal(await prisma.transaction.count({ where: { pagoIntentoId: { in: [i1.id, i2.id] } } }), 0)
})

test('4 · el intento tiene que ser de la MISMA empresa y estar APROBADO (disparador)', async () => {
  const a = await crearEmpresa('empA')
  const b = await crearEmpresa('empB')
  const deB = await intento(b)
  assert.match(await rechazo(venta(a, deB.id)), /transactions_pago_intento_empresa[\s\S]*otra empresa/, 'el cobro de otra empresa no respalda mi venta')

  for (const estado of ['CREADO', 'REDIRIGIDO', 'RECHAZADO', 'EXPIRADO', 'ERROR']) {
    const i = await intento(a, { estado, activadoAt: null })
    assert.match(await rechazo(venta(a, i.id)), /transactions_pago_intento_empresa[\s\S]*no APROBADO/, estado)
  }
  assert.match(await rechazo(venta(a, 'no-existe-este-id')), /foreign key|transactions_pago_intento_empresa/i)
})

test('5 · borrar el intento no borra la venta: queda con pagoIntentoId nulo (SET NULL)', async () => {
  const e = await crearEmpresa('setnull')
  const i = await intento(e)
  const t = await venta(e, i.id)
  await prisma.pagoIntento.delete({ where: { id: i.id } })
  const db = await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } })
  assert.equal(db.pagoIntentoId, null)
  assert.equal(db.metodoCobro, 'TARJETA', 'la venta sigue ahí')
})

test('6 · el backfill marca COMPLETADA solo lo demostrable, no toca el resto y es idempotente', async () => {
  const e = await crearEmpresa('backfill')
  const cobro = new Date(Date.now() - 25 * 86_400_000)
  const mas = (ms: number) => new Date(cobro.getTime() + ms)
  let n = 0
  // Una membresía por cliente y empresa (índice único): cada caso trae su propio cliente.
  const membresia = async (extra: Record<string, unknown>) => {
    const cliente = await prisma.cliente.create({ data: { companyId: e.companyId, supabaseId: `sb-tm-bf-${sufijo}-${n++}`, nombre: `Cliente bf ${n}`, email: `tm-bf-${sufijo}-${n}@prueba.test` }, select: { id: true } })
    return prisma.membership.create({ data: { companyId: e.companyId, clienteId: cliente.id, planId: e.planId, ...extra }, select: { id: true } })
  }
  const activa = (fechaPago: Date) => ({ estado: 'ACTIVA' as const, pagoConfirmado: true, montoPagado: 500, fechaPago, fechaInicio: fechaPago })
  const porDefecto = (membershipId: string | null, extra: Record<string, unknown> = {}) =>
    prisma.pagoIntento.create({ data: { companyId: e.companyId, clienteId: e.clienteId, proveedor: 'CARDNET', monto: 500, estado: 'APROBADO', activadoAt: cobro, membershipId, ...extra }, select: { id: true } })

  // a · demostrable: la membresía se pagó y activó 10 s después del cobro.
  const ma = await membresia(activa(mas(10_000)))
  const a = await porDefecto(ma.id)
  // b · se activó TRES HORAS después (otra vía): no prueba que ESTE cobro se entregó.
  const mb = await membresia(activa(mas(3 * 3_600_000)))
  const b = await porDefecto(mb.id)
  // c · la membresía sigue sin activar: el cliente pagó y no recibió.
  const mc = await membresia({})
  const c = await porDefecto(mc.id)
  // d · ya lo tocó el código de cumplimiento (intentos > 0): no se toca.
  const md = await membresia(activa(mas(10_000)))
  const d = await porDefecto(md.id, { fulfillmentIntentos: 1 })
  // e · entrega fallida: nunca se marca nada.
  const me = await membresia(activa(mas(10_000)))
  const f = await porDefecto(me.id, { fulfillmentEstado: 'FALLIDA', fulfillmentError: 'x' })
  // g · compra de promoción activada a los 20 s del cobro.
  const compra = await prisma.productoCompra.create({ data: { companyId: e.companyId, clienteId: e.clienteId, estado: 'ACTIVA', pagoConfirmado: true, montoPagado: 500, fechaActivacion: mas(20_000) }, select: { id: true } })
  const g = await prisma.pagoIntento.create({ data: { companyId: e.companyId, clienteId: e.clienteId, proveedor: 'CARDNET', monto: 500, estado: 'APROBADO', activadoAt: cobro, compraId: compra.id }, select: { id: true } })
  // h · compra sin activar.
  const compraH = await prisma.productoCompra.create({ data: { companyId: e.companyId, clienteId: e.clienteId, estado: 'PENDIENTE_PAGO' }, select: { id: true } })
  const h = await prisma.pagoIntento.create({ data: { companyId: e.companyId, clienteId: e.clienteId, proveedor: 'CARDNET', monto: 500, estado: 'APROBADO', activadoAt: cobro, compraId: compraH.id }, select: { id: true } })

  const estados = async () =>
    Object.fromEntries(
      (await prisma.pagoIntento.findMany({ where: { id: { in: [a.id, b.id, c.id, d.id, f.id, g.id, h.id] } }, select: { id: true, fulfillmentEstado: true, fulfillmentAt: true } })).map((x) => [x.id, x])
    )
  const antes = await estados()
  assert.ok([a, b, c, d, g, h].every((x) => antes[x.id]!.fulfillmentEstado === 'PENDIENTE'))

  await prisma.$executeRawUnsafe(bloqueBackfill)
  const despues = await estados()
  assert.equal(despues[a.id]!.fulfillmentEstado, 'COMPLETADA', 'a · membresía activada a los 10 s')
  assert.equal(despues[a.id]!.fulfillmentAt?.getTime(), mas(10_000).getTime(), 'con la fecha REAL de la activación')
  assert.equal(despues[b.id]!.fulfillmentEstado, 'PENDIENTE', 'b · activada 3 h después: queda a la vista')
  assert.equal(despues[c.id]!.fulfillmentEstado, 'PENDIENTE', 'c · sin activar: es un cliente esperando de verdad')
  assert.equal(despues[d.id]!.fulfillmentEstado, 'PENDIENTE', 'd · ya tocado por el código de cumplimiento')
  assert.equal(despues[f.id]!.fulfillmentEstado, 'FALLIDA', 'e · nunca se maquilla una entrega fallida')
  assert.equal(despues[g.id]!.fulfillmentEstado, 'COMPLETADA', 'g · compra activada a los 20 s')
  assert.equal(despues[g.id]!.fulfillmentAt?.getTime(), mas(20_000).getTime())
  assert.equal(despues[h.id]!.fulfillmentEstado, 'PENDIENTE', 'h · compra sin activar')

  // Idempotente: una segunda pasada no cambia nada.
  await prisma.$executeRawUnsafe(bloqueBackfill)
  assert.deepEqual(await estados(), despues)
})
