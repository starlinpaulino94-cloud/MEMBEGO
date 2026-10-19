/**
 * PAGO CON TARJETA → REPORTES: el dinero de un pago con tarjeta se cuenta UNA vez.
 *
 * El reporte de finanzas suma dos flujos: la caja (`transactions`, estado cobrado) y los cobros de membresía
 * (`memberships.montoPagado`). Desde la fase 2 un pago con tarjeta de una membresía deja las dos cosas; si los dos
 * flujos lo contaran, "Total cobrado" mostraría el doble. Este archivo vigila esa regla con la base real.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { crearTransaccionAplicada } from '../../src/lib/transactions/application/transaction-service'
import { snapshotDeCobroConTarjeta } from '../../src/modules/pagos/comprobante-tarjeta'
import { getReporteFinanzas } from '../../src/modules/reportes/finanzas'
import { getReporte } from '../../src/modules/reportes/queries'
import { diaLocal, leerRango } from '../../src/modules/reportes/rango'

const TZ = 'America/Santo_Domingo'
const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const hoy = () => diaLocal(new Date(), TZ)
const rango = () => leerRango({ desde: hoy(), hasta: hoy() }, TZ)

async function empresa(etiqueta: string) {
  const c = await prisma.company.create({ data: { name: `RepTarjeta ${etiqueta} ${sufijo}`, slug: `reptar-${etiqueta}-${sufijo}`, type: 'carwash', ciudad: 'Santo Domingo' }, select: { id: true } })
  const cliente = await prisma.cliente.create({ data: { companyId: c.id, supabaseId: `sb-rt-${etiqueta}-${sufijo}`, nombre: `Cliente ${etiqueta}`, email: `rt-${etiqueta}-${sufijo}@prueba.test` }, select: { id: true } })
  const plan = await prisma.plan.create({ data: { companyId: c.id, nombre: `Plan ${etiqueta}`, precio: 500 }, select: { id: true } })
  return { companyId: c.id, clienteId: cliente.id, planId: plan.id }
}
type Empresa = Awaited<ReturnType<typeof empresa>>

/** Una membresía cobrada hoy: lo que deja `activarMembresia`. */
const membresiaCobrada = (e: Empresa) =>
  prisma.membership.create({
    data: { companyId: e.companyId, clienteId: e.clienteId, planId: e.planId, estado: 'ACTIVA', pagoConfirmado: true, montoPagado: 500, fechaPago: new Date(), fechaInicio: new Date() },
    select: { id: true },
  })

async function ventaTarjeta(e: Empresa, objetivo: { membershipId: string } | { compraId: string }) {
  const intento = await prisma.pagoIntento.create({
    data: { companyId: e.companyId, clienteId: e.clienteId, proveedor: 'CARDNET', monto: 500, estado: 'APROBADO', activadoAt: new Date(), autorizacion: 'AUTH-R', canal: 'APP', fulfillmentEstado: 'COMPLETADA', fulfillmentAt: new Date(), ...objetivo },
    select: { id: true },
  })
  await crearTransaccionAplicada(prisma, {
    tipo: 'SALE',
    companyId: e.companyId,
    clienteId: e.clienteId,
    monto: 500,
    metodoCobro: 'TARJETA',
    pagoIntentoId: intento.id,
    membershipId: 'membershipId' in objetivo ? objetivo.membershipId : null,
    snapshot: snapshotDeCobroConTarjeta({ detalle: 'Membresía', clienteNombre: 'Cliente', monto: 500, canal: 'APP', pagoIntentoId: intento.id, autorizacion: 'AUTH-R' }),
    timeZone: TZ,
  })
}

const finanzas = (e: Empresa) => getReporteFinanzas(e.companyId, rango(), TZ)

test('1 · una membresía pagada con tarjeta suma RD$500 en "Total cobrado", no RD$1,000', async () => {
  const e = await empresa('membresia')
  const m = await membresiaCobrada(e)
  await ventaTarjeta(e, { membershipId: m.id })
  const r = await finanzas(e)
  assert.equal(r.ingresoTotal.valor, 500, 'el mismo dinero no se cuenta en la caja y en las membresías')
  assert.equal(r.ingresosCaja.valor + r.cobrosMembresias.valor, 500, 'los dos sumandos que se enseñan también suman 500')
  const tarjeta = r.porMetodo.find((x) => x.metodo === 'TARJETA')
  assert.deepEqual([tarjeta?.operaciones, tarjeta?.monto], [1, 500], 'en el desglose por método, Tarjeta sí aparece')
})

test('2 · una promoción pagada con tarjeta (sin membresía) suma una vez, en la caja', async () => {
  const e = await empresa('promo')
  const compra = await prisma.productoCompra.create({ data: { companyId: e.companyId, clienteId: e.clienteId, estado: 'ACTIVA', pagoConfirmado: true, montoPagado: 500 }, select: { id: true } })
  await ventaTarjeta(e, { compraId: compra.id })
  const r = await finanzas(e)
  assert.equal(r.ingresoTotal.valor, 500)
  assert.equal(r.ingresosCaja.valor, 500)
  assert.equal(r.cobrosMembresias.valor, 0)
})

test('3 · una membresía cobrada en el mostrador (venta sin pasarela) sigue contándose como antes', async () => {
  const e = await empresa('mostrador')
  const m = await membresiaCobrada(e)
  await crearTransaccionAplicada(prisma, {
    tipo: 'SALE', companyId: e.companyId, clienteId: e.clienteId, monto: 500, metodoCobro: 'EFECTIVO', membershipId: m.id,
    snapshot: { detalle: 'Membresía', total: '500.00', metodoCobroLabel: 'Efectivo' }, timeZone: TZ,
  })
  const r = await finanzas(e)
  // Hallazgo previo a este trabajo (se documenta, no se cambia aquí): una venta de mostrador que activa una membresía
  // deja caja + membresía. Se fija el número para que cualquier cambio sea deliberado.
  assert.equal(r.ingresoTotal.valor, 1000, 'comportamiento anterior intacto: decisión pendiente del usuario')
})

test('4 · el Reporte de la empresa tampoco cuenta dos veces la membresía pagada con tarjeta', async () => {
  const e = await empresa('reporte')
  const m = await membresiaCobrada(e)
  await ventaTarjeta(e, { membershipId: m.id })
  const r = await getReporte(e.companyId, rango(), TZ)
  assert.equal((r.ingresosCaja?.valor ?? 0) + (r.ingresosMembresias?.valor ?? 0), 500)
  assert.equal(r.ingresosCaja?.valor, 500, 'la venta con tarjeta está en la caja')
  assert.equal(r.ingresosMembresias?.valor, 0, 'y no otra vez como cobro de membresía')
})

test('5 · un cobro con tarjeta anterior al comprobante (sin venta) sigue contándose por su membresía', async () => {
  const e = await empresa('historico')
  await membresiaCobrada(e)
  const r = await finanzas(e)
  assert.equal(r.ingresoTotal.valor, 500)
  assert.equal(r.cobrosMembresias.valor, 500)
  assert.equal(r.ingresosCaja.valor, 0)
})
