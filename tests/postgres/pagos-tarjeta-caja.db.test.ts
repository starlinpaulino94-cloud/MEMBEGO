/**
 * PAGO CON TARJETA → CAJA Y CUADRE: el cobro en línea se ve y se imprime, pero NO es efectivo de la gaveta.
 *
 *   · `getCobrosEnLineaDelDia` lista las ventas con tarjeta de la pasarela del día (solo las suyas, solo las de la empresa).
 *   · El cuadre del día de un empleado las enseña aparte y no las suma a sus cobros.
 *   · El cierre de caja las enseña informativas y el arqueo de efectivo no cambia.
 *   · Registros tiene su subtotal «Tarjeta».
 */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { crearTransaccionAplicada } from '../../src/lib/transactions/application/transaction-service'
import { snapshotDeCobroConTarjeta } from '../../src/modules/pagos/comprobante-tarjeta'
import { getCobrosEnLineaDelDia } from '../../src/modules/pagos/cobros-en-linea'
import { getCierreReporte, getReporteEmpleadoDia, hoyLocal } from '../../src/modules/caja/queries'
import { getRegistros } from '../../src/modules/registros/queries'

const TZ = 'America/Santo_Domingo'
const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const hoy = () => hoyLocal(TZ)

interface Empresa { companyId: string; clienteId: string; empleadoId: string; sucursalId: string; cajaId: string }

async function empresa(etiqueta: string): Promise<Empresa> {
  const c = await prisma.company.create({ data: { name: `CajaTarjeta ${etiqueta} ${sufijo}`, slug: `ctar-${etiqueta}-${sufijo}`, type: 'carwash', ciudad: 'Santo Domingo' }, select: { id: true } })
  const cliente = await prisma.cliente.create({ data: { companyId: c.id, supabaseId: `sb-ct-${etiqueta}-${sufijo}`, nombre: `Cliente ${etiqueta}`, email: `ct-${etiqueta}-${sufijo}@prueba.test` }, select: { id: true } })
  const u = await prisma.user.create({ data: { supabaseId: `sb-ctu-${etiqueta}-${sufijo}`, email: `ctu-${etiqueta}-${sufijo}@prueba.test`, name: `Empleada ${etiqueta}`, role: 'SUPERADMIN' }, select: { id: true } })
  const s = await prisma.sucursal.create({ data: { companyId: c.id, nombre: 'Principal' }, select: { id: true } })
  const caja = await prisma.cajaSesion.create({ data: { companyId: c.id, sucursalId: s.id, abiertaPorId: u.id, estado: 'ABIERTA', balanceInicial: 1000 }, select: { id: true } })
  return { companyId: c.id, clienteId: cliente.id, empleadoId: u.id, sucursalId: s.id, cajaId: caja.id }
}

async function cobroEnLinea(e: Empresa, monto: number, canal: 'APP' | 'WEB' | 'RENOVACION_AUTOMATICA' = 'APP', sucursalId: string | null = null) {
  const compra = await prisma.productoCompra.create({ data: { companyId: e.companyId, clienteId: e.clienteId, estado: 'ACTIVA', pagoConfirmado: true, montoPagado: monto }, select: { id: true } })
  const intento = await prisma.pagoIntento.create({
    data: { companyId: e.companyId, clienteId: e.clienteId, proveedor: 'CARDNET', monto, estado: 'APROBADO', activadoAt: new Date(), autorizacion: `A${Math.round(monto)}`, canal, fulfillmentEstado: 'COMPLETADA', fulfillmentAt: new Date(), compraId: compra.id },
    select: { id: true },
  })
  return crearTransaccionAplicada(prisma, {
    tipo: 'SALE', companyId: e.companyId, clienteId: e.clienteId, sucursalId, monto, metodoCobro: 'TARJETA', pagoIntentoId: intento.id,
    snapshot: snapshotDeCobroConTarjeta({ detalle: 'Promoción', clienteNombre: `Cliente`, monto, canal, pagoIntentoId: intento.id, autorizacion: `A${Math.round(monto)}`, tarjeta: { marca: 'visa', ultimos4: '4242' } }),
    timeZone: TZ,
  })
}

const efectivoEnCaja = (e: Empresa, monto: number) =>
  crearTransaccionAplicada(prisma, {
    tipo: 'SALE', companyId: e.companyId, clienteId: e.clienteId, empleadoId: e.empleadoId, monto, metodoCobro: 'EFECTIVO',
    caja: e.cajaId, cajaSesionId: e.cajaId, snapshot: { detalle: 'Lavado', total: monto.toFixed(2), metodoCobroLabel: 'Efectivo' }, timeZone: TZ,
  })

before(() => { assert.match(hoy(), /^\d{4}-\d{2}-\d{2}$/) })

test('1 · el listado del día trae SOLO los cobros en línea de la empresa, con lo que se imprime', async () => {
  const a = await empresa('lista-a')
  const b = await empresa('lista-b')
  const t1 = await cobroEnLinea(a, 500, 'APP')
  await cobroEnLinea(a, 1200, 'WEB')
  await efectivoEnCaja(a, 300) // venta en gaveta: no es un cobro en línea
  await cobroEnLinea(b, 9999, 'APP') // otra empresa
  const r = await getCobrosEnLineaDelDia(a.companyId, hoy(), TZ)
  assert.equal(r.items.length, 2)
  assert.deepEqual(r.resumen.porCanal.map((c) => [c.canal, c.total]), [['WEB', 1200], ['APP', 500]])
  assert.equal(r.resumen.total, 1700)
  const fila = r.items.find((i) => i.id === t1.id)!
  assert.equal(fila.ticketNumero, t1.ticketNumero)
  assert.equal(fila.formaDePago, 'Tarjeta VISA ••••4242 (en la app)', 'el comprobante dice con qué y por dónde se pagó')
  assert.equal(fila.autorizacion, 'A500')
  assert.equal(fila.sucursal, 'En línea')
  assert.equal(fila.impresa, false)
  assert.doesNotMatch(JSON.stringify(r), /\b\d{13,19}\b/, 'ningún número de tarjeta completo en el resultado')
})

test('2 · un día sin cobros en línea devuelve cero, y otro día no ve los de hoy', async () => {
  const e = await empresa('vacio')
  await cobroEnLinea(e, 700)
  const ayer = await getCobrosEnLineaDelDia(e.companyId, '2020-01-02', TZ)
  assert.deepEqual([ayer.items.length, ayer.resumen.total], [0, 0])
  const hoyR = await getCobrosEnLineaDelDia(e.companyId, hoy(), TZ)
  assert.equal(hoyR.items.length, 1)
})

test('3 · el cuadre del día del empleado enseña los cobros en línea APARTE y no los suma a su total', async () => {
  const e = await empresa('cuadre')
  await efectivoEnCaja(e, 300)
  await cobroEnLinea(e, 500, 'APP')
  await cobroEnLinea(e, 800, 'RENOVACION_AUTOMATICA')
  const r = await getReporteEmpleadoDia(e.companyId, e.empleadoId, 'Empleada', hoy(), TZ)
  assert.equal(r.total, 300, 'el total del empleado es solo lo que cobró él')
  assert.equal(r.porMetodo.efectivo, 300)
  assert.equal(r.enLinea.cantidad, 2)
  assert.equal(r.enLinea.total, 1300)
  assert.deepEqual(r.enLinea.items.map((i) => i.monto).sort((x, y) => x - y), [500, 800])
})

test('4 · el cierre de caja informa los cobros en línea y el arqueo de efectivo NO cambia', async () => {
  const e = await empresa('cierre')
  await efectivoEnCaja(e, 300)
  const antes = await getCierreReporte(e.cajaId, e.companyId)
  await cobroEnLinea(e, 5000, 'WEB')
  const despues = await getCierreReporte(e.cajaId, e.companyId)
  assert.ok(antes && despues)
  assert.equal(antes.enLinea.cantidad, 0)
  assert.equal(despues.enLinea.cantidad, 1)
  assert.equal(despues.enLinea.total, 5000)
  assert.equal(despues.enLinea.porCanal[0]!.etiqueta, 'en la web')
  // La gaveta es la misma antes y después: el cobro en línea no entra a ningún total de la sesión.
  assert.deepEqual(
    [despues.cobros, despues.total, despues.porMetodo, despues.balanceInicial],
    [antes.cobros, antes.total, antes.porMetodo, antes.balanceInicial]
  )
  assert.equal(despues.porMetodo.efectivo, 300)
})

test('5 · Registros tiene su subtotal «Tarjeta» y el filtro por método lo encuentra', async () => {
  const e = await empresa('registros')
  await cobroEnLinea(e, 500)
  await efectivoEnCaja(e, 300)
  const todos = await getRegistros(e.companyId, {}, TZ)
  assert.equal(todos.resumen.porMetodo.tarjeta, 500)
  assert.equal(todos.resumen.porMetodo.efectivo, 300)
  assert.equal(todos.resumen.porMetodo.otro, 0)
  const soloTarjeta = await getRegistros(e.companyId, { metodo: 'TARJETA' }, TZ)
  assert.equal(soloTarjeta.items.length, 1)
  assert.equal(soloTarjeta.items[0]!.metodoCobro, 'TARJETA')
})
