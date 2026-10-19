/**
 * PAGO CON TARJETA → COMPROBANTES RETROACTIVOS (fase 6), contra PostgreSQL.
 *
 * Ponerse al día con los pagos con tarjeta anteriores al comprobante es una ACCIÓN EXPLÍCITA, nunca una migración que corra sola:
 *   1 · la conciliación enseña cuántos son y cuánto suman ANTES de pulsar, y solo ofrece el lote cuando hay más de uno;
 *   2 · el lote escribe cada venta con la fecha de su cobro y el texto honesto «Tarjeta» (los cobros viejos no traen canal);
 *   3 · cada comprobante queda en la bitácora a nombre de quien pulsó, con `origen: 'LOTE'`, y repetir no duplica;
 *   4 · el tope por pulsación deja el resto para la siguiente; el periodo y la empresa se respetan;
 *   5 · el reporte del periodo ANTIGUO no cuenta el pago dos veces (la venta cae en el día del cobro) y el actual no cambia.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { conciliar } from '../../src/modules/observabilidad/conciliacion'
import { generarComprobantesPendientes, TOPE_DE_LOTE, type ActorDeConciliacion } from '../../src/modules/observabilidad/conciliacion-servicio'
import { getReporteFinanzas } from '../../src/modules/reportes/finanzas'
import { diaLocal, leerRango } from '../../src/modules/reportes/rango'

const TZ = 'America/Santo_Domingo'
const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const PRECIO = 500
const DIA = 86_400_000
const hace = (dias: number) => new Date(Date.now() - dias * DIA)

interface Empresa { companyId: string; planId: string; userId: string }

async function crearEmpresa(etiqueta: string): Promise<Empresa> {
  const c = await prisma.company.create({ data: { name: `Retro ${etiqueta} ${sufijo}`, slug: `retro-${etiqueta}-${sufijo}`, type: 'carwash', ciudad: 'Santo Domingo' }, select: { id: true } })
  const plan = await prisma.plan.create({ data: { companyId: c.id, nombre: `Plan ${etiqueta}`, precio: PRECIO, vigenciaDias: 30, lavadosIncluidos: 4 }, select: { id: true } })
  const u = await prisma.user.create({ data: { supabaseId: `sb-retro-${etiqueta}-${sufijo}`, email: `retro-${etiqueta}-${sufijo}@prueba.test`, name: `Gerente ${etiqueta}`, role: 'ADMINISTRADOR', companyId: c.id }, select: { id: true } })
  return { companyId: c.id, planId: plan.id, userId: u.id }
}
const actor = (e: Empresa): ActorDeConciliacion => ({ userId: e.userId, ipAddress: '10.0.0.9', userAgent: 'prueba' })

let n = 0
/** Un pago con tarjeta de hace `dias` días, entregado y SIN comprobante, de los de antes de que existiera el canal (`canal` nulo). */
async function pagoViejo(e: Empresa, dias: number, extra: Record<string, unknown> = {}) {
  const cuando = hace(dias)
  const cliente = await prisma.cliente.create({ data: { companyId: e.companyId, supabaseId: `sb-rv-${sufijo}-${n++}`, nombre: `Cliente ${n}`, email: `rv-${sufijo}-${n}@prueba.test` }, select: { id: true } })
  const m = await prisma.membership.create({ data: { companyId: e.companyId, clienteId: cliente.id, planId: e.planId, estado: 'ACTIVA', pagoConfirmado: true, montoPagado: PRECIO, fechaPago: cuando, fechaInicio: cuando }, select: { id: true } })
  return prisma.pagoIntento.create({
    data: { companyId: e.companyId, clienteId: cliente.id, proveedor: 'CARDNET', membershipId: m.id, monto: PRECIO, estado: 'APROBADO', activadoAt: cuando, createdAt: cuando, updatedAt: cuando, autorizacion: `AUTH-RV${n}`, canal: null, fulfillmentEstado: 'COMPLETADA', fulfillmentAt: cuando, ...extra },
    select: { id: true },
  })
}

const hallazgo = (r: Awaited<ReturnType<typeof conciliar>>) => r.hallazgos.find((h) => h.clave === 'cobro-sin-transaccion')

test('1 · la conciliación enseña cuántos son y cuánto suman ANTES de pulsar; el lote solo se ofrece cuando hay más de uno', async () => {
  const e = await crearEmpresa('uno')
  await pagoViejo(e, 20)
  assert.equal(hallazgo(await conciliar(e.companyId, 365))?.lote, undefined, 'con uno solo basta «Generar comprobante»')
  await pagoViejo(e, 40)
  await pagoViejo(e, 100)
  const h = hallazgo(await conciliar(e.companyId, 365))
  assert.ok(h)
  assert.deepEqual([h.cantidad, h.lote], [3, { cantidad: 3, monto: 3 * PRECIO }])
  // Con una ventana corta solo se ve (y se genera) lo que cabe en ella.
  assert.equal(hallazgo(await conciliar(e.companyId, 30))?.lote, undefined, 'dentro de 30 días solo está el de hace 20: uno solo')
})

test('2 · el lote escribe cada venta con la fecha de su cobro y el texto honesto «Tarjeta»; queda en la bitácora; repetir no duplica', async () => {
  const e = await crearEmpresa('dos')
  const ids = [await pagoViejo(e, 20), await pagoViejo(e, 40), await pagoViejo(e, 100)]

  const r = await generarComprobantesPendientes(e.companyId, 365, actor(e))
  assert.ok(r.ok)
  assert.deepEqual([r.generados, r.yaTenian, r.fallidos, r.pendientes], [3, 0, 0, 0])
  assert.equal(r.mensaje, '3 comprobantes generados.')

  for (const [i, dias] of [[ids[0]!, 20], [ids[1]!, 40], [ids[2]!, 100]] as const) {
    const v = await prisma.transaction.findUniqueOrThrow({ where: { pagoIntentoId: i.id } })
    const intento = await prisma.pagoIntento.findUniqueOrThrow({ where: { id: i.id } })
    assert.equal(v.createdAt.getTime(), intento.activadoAt!.getTime(), `la venta de hace ${dias} días lleva la fecha de su cobro`)
    assert.deepEqual([v.tipo, v.estado, v.metodoCobro, Number(v.monto)], ['SALE', 'APPLIED', 'TARJETA', PRECIO])
    assert.equal((v.snapshot as Record<string, unknown>).metodoCobroLabel, 'Tarjeta', 'sin canal guardado el comprobante no inventa «en la app»')
  }
  const log = await prisma.auditLog.findMany({ where: { companyId: e.companyId, accion: 'CONCILIACION_COMPROBANTE_GENERADO' } })
  assert.equal(log.length, 3)
  assert.ok(log.every((l) => l.userId === e.userId && (l.payload as Record<string, unknown>).origen === 'LOTE' && l.ipAddress === '10.0.0.9'))
  assert.equal(hallazgo(await conciliar(e.companyId, 365)), undefined, 'resuelto')

  const otra = await generarComprobantesPendientes(e.companyId, 365, actor(e))
  assert.ok(otra.ok && otra.generados === 0)
  assert.equal(await prisma.transaction.count({ where: { companyId: e.companyId } }), 3)
  assert.equal((await prisma.auditLog.count({ where: { companyId: e.companyId, accion: 'CONCILIACION_COMPROBANTE_GENERADO' } })), 3, 'y sin asientos repetidos')
})

test('3 · el tope por pulsación deja el resto para la siguiente, y la ventana y la empresa se respetan', async () => {
  const e = await crearEmpresa('tres')
  const otra = await crearEmpresa('tres-otra')
  for (const dias of [10, 11, 12]) await pagoViejo(e, dias)
  const ajeno = await pagoViejo(otra, 10)
  await pagoViejo(e, 200) // fuera de una ventana de 90 días

  const primero = await generarComprobantesPendientes(e.companyId, 90, actor(e), { tope: 2 })
  assert.ok(primero.ok)
  assert.deepEqual([primero.generados, primero.pendientes], [2, 1])
  assert.match(primero.mensaje, /quedan más: pulsa otra vez/)
  const segundo = await generarComprobantesPendientes(e.companyId, 90, actor(e), { tope: 2 })
  assert.ok(segundo.ok)
  assert.deepEqual([segundo.generados, segundo.pendientes], [1, 0])

  assert.equal(await prisma.transaction.count({ where: { companyId: e.companyId } }), 3, 'el de hace 200 días queda fuera de la ventana de 90')
  assert.equal(await prisma.transaction.count({ where: { pagoIntentoId: ajeno.id } }), 0, 'la otra empresa no se tocó')
  assert.ok(TOPE_DE_LOTE >= 100)

  for (const dias of [0, -5, 367, 1.5, Number.NaN]) {
    const r = await generarComprobantesPendientes(e.companyId, dias, actor(e))
    assert.ok(!r.ok, `periodo ${dias} no válido`)
  }
})

test('4 · el reporte del periodo ANTIGUO no cuenta el pago dos veces tras el lote, y el periodo actual no cambia', async () => {
  const e = await crearEmpresa('cuatro')
  await pagoViejo(e, 40)
  await pagoViejo(e, 41)
  const dia40 = diaLocal(hace(40), TZ)
  const antiguo = () => getReporteFinanzas(e.companyId, leerRango({ desde: dia40, hasta: dia40 }, TZ), TZ)
  const hoy = diaLocal(new Date(), TZ)
  const actual = () => getReporteFinanzas(e.companyId, leerRango({ desde: hoy, hasta: hoy }, TZ), TZ)

  const antes = await antiguo()
  assert.equal(antes.ingresoTotal.valor, PRECIO, 'antes: el pago entra una vez, por la membresía')
  assert.equal((await actual()).ingresoTotal.valor, 0)

  const r = await generarComprobantesPendientes(e.companyId, 365, actor(e))
  assert.ok(r.ok && r.generados === 2)

  const despues = await antiguo()
  assert.equal(despues.ingresoTotal.valor, PRECIO, 'después: SIGUE siendo una vez (la venta cae en su día y la membresía se descuenta)')
  assert.deepEqual([despues.ingresosCaja.valor, despues.cobrosMembresias.valor], [PRECIO, 0], 'ahora entra por la caja')
  const tarjeta = despues.porMetodo.find((m) => m.metodo === 'TARJETA')
  assert.deepEqual([tarjeta?.operaciones, tarjeta?.monto], [1, PRECIO], 'y el desglose por método ya dice Tarjeta')
  assert.equal((await actual()).ingresoTotal.valor, 0, 'el periodo actual no ganó dinero por escribir comprobantes viejos')
})
