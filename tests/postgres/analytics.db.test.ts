import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa, sinEmpresa } from '../../src/lib/tenant'
import { cambiarEstadoItemEnTx, crearItemEnTx } from '../../src/modules/catalog/service'
import { cancelarPedidoEnTx, completarPorQrEnTx, crearPedidoEnTx, marcarListoEnTx, reembolsarPedidoEnTx, type ContextoPedido } from '../../src/modules/orders/service'
import { crearOfertaEnTx, publicarOfertaEnTx, reclamarOfertaEnTx } from '../../src/modules/deals/service'
import { leerRango } from '../../src/modules/reportes/rango'
import { panoramaDePlataformaEnTx, resultadosDeMembegoEnTx } from '../../src/modules/analytics/queries'

/**
 * ANALÍTICA DE MEMBEGO contra PostgreSQL de verdad (Fase 6).
 *
 * Se siembra por los servicios REALES (pedido → listo → QR → canje, oferta → reclamo → canje, cancelación y
 * reembolso) con relojes fijos en marzo de 2031 —una fecha sin otros datos en la base compartida— y se
 * comprueba, con números calculados a mano:
 *
 *  · los límites del periodo en HORA DE SANTO DOMINGO (un pedido de las 10 pm del 31 cuenta en marzo; uno
 *    de las 12:30 am del 1 de abril, no) y el corte por día de la serie;
 *  · GMV, pedidos, ticket, comisiones (solo las CONFIRMED; la del pedido reembolsado se revierte), retorno
 *    y costo por cliente nuevo; clientes nuevos vs. recurrentes;
 *  · la atribución por canal y el rendimiento de una oferta (obtenidas, canjeadas, ventas, cuota);
 *  · el embudo de pedidos creados; los reembolsos;
 *  · AISLAMIENTO: una empresa no ve lo de otra; la plataforma ve a todas MENOS las de práctica.
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const TZ = 'America/Santo_Domingo'

type Empresa = { id: string; sucursal: string; variante: string; clientes: string[] }
const E: Record<'a' | 'b' | 'demo', Empresa> = {
  a: { id: '', sucursal: '', variante: '', clientes: [] },
  b: { id: '', sucursal: '', variante: '', clientes: [] },
  demo: { id: '', sucursal: '', variante: '', clientes: [] },
}
const f = { usuario: '' }

const ctxAud = () => ({ actorId: f.usuario, ipAddress: '127.0.0.1', userAgent: 'test' })
const empresa = (): ContextoPedido => ({ actor: 'EMPRESA', actorId: f.usuario, ipAddress: '127.0.0.1', userAgent: 'test' })
const cliente: ContextoPedido = { actor: 'CLIENTE', actorId: null }
const en = <T>(e: Empresa, fn: Parameters<typeof conEmpresa<T>>[1]) => conEmpresa(e.id, fn)

const d = (iso: string) => new Date(iso)

before(async () => {
  const u = await prisma.user.create({ data: { supabaseId: `sb-ana-${sufijo}`, email: `ana-${sufijo}@prueba.test`, name: 'Analítica', role: 'SUPERADMIN' }, select: { id: true } })
  f.usuario = u.id
  for (const [k, e] of Object.entries(E) as [keyof typeof E, Empresa][]) {
    const c = await prisma.company.create({
      data: { name: `Analítica ${k} ${sufijo}`, slug: `ana-${k}-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo', esDemo: k === 'demo' },
      select: { id: true },
    })
    e.id = c.id
    e.sucursal = (await prisma.sucursal.create({ data: { companyId: c.id, nombre: 'Principal' }, select: { id: true } })).id
    const total = k === 'a' ? 10 : 2
    for (let i = 0; i < total; i++) {
      e.clientes.push((await prisma.cliente.create({ data: { companyId: c.id, supabaseId: `sb-acli-${k}-${i}-${sufijo}`, nombre: `Cliente ${k}${i}`, email: `acli-${k}-${i}-${sufijo}@prueba.test` }, select: { id: true } })).id)
    }
    const item = await conEmpresa(c.id, (tx) => crearItemEnTx(tx, c.id, { name: `Lavado ${k} ${sufijo}`, type: 'SERVICE', price: 400, sku: `ANA-${k}-${sufijo}` }, ctxAud()))
    await conEmpresa(c.id, (tx) => cambiarEstadoItemEnTx(tx, c.id, item.id, 'ACTIVE', ctxAud()))
    e.variante = (await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: item.id }, select: { id: true } })).id
  }
})

after(async () => {
  const ids = Object.values(E).map((e) => e.id)
  const lista = ids.map((i) => `'${i}'`).join(',')
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    for (const tabla of ['deal_claims', 'deals', 'merchant_statements', 'merchant_commissions', 'merchant_ledger_entries', 'merchant_billing_configs', 'payment_evidences', 'customer_confirmations', 'order_attributions', 'membego_order_lines', 'membego_orders']) {
      await tx.$executeRawUnsafe(`DELETE FROM "${tabla}" WHERE "companyId" IN (${lista})`)
    }
  })
  await prisma.catalogItem.deleteMany({ where: { companyId: { in: ids } } })
})

// ── Siembra ──────────────────────────────────────────────────────────────────

type Canal = 'MARKETPLACE_BROWSE' | 'MARKETPLACE_SEARCH'

/** Pedido de marketplace de la variante de la empresa. Si `completado`, lo lleva a COMPLETED en ese instante. */
async function pedido(e: Empresa, i: number, creado: string, o: { canal?: Canal; completado?: string } = {}) {
  const ahora = d(creado)
  const r = await en(e, (tx) =>
    crearPedidoEnTx(tx, e.id, { customerId: e.clientes[i], locationId: e.sucursal, origin: 'MARKETPLACE', lineas: [{ varianteId: e.variante, cantidad: 1 }], atribucion: { channel: o.canal ?? 'MARKETPLACE_BROWSE' }, ahora }, cliente)
  )
  await fecharCreacion(r.pedidoId, ahora)
  if (o.completado) {
    const cuando = d(o.completado)
    const listo = await en(e, (tx) => marcarListoEnTx(tx, e.id, r.pedidoId, empresa(), cuando))
    await en(e, (tx) => completarPorQrEnTx(tx, e.id, listo.qrToken as string, empresa(), cuando))
  }
  return r.pedidoId
}

const ids: Record<string, string> = {}

/** El servicio fecha el pedido con la hora real de la base: para probar periodos viejos se le pone la fecha de la siembra. */
async function fecharCreacion(pedidoId: string, cuando: Date) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    await tx.$executeRaw`UPDATE "membego_orders" SET "createdAt" = ${cuando} WHERE "id" = ${pedidoId}`
  })
}

test('0 · siembra: pedidos de A (dentro, en los bordes y fuera del periodo), una oferta canjeada, un cancelado, un abierto y un reembolso; pedidos de B y de la empresa de práctica', async () => {
  // Periodo anterior (29 ene – 28 feb 2031, hora local).
  ids.previoA2 = await pedido(E.a, 2, '2031-02-10T15:00:00Z', { completado: '2031-02-10T15:00:00Z' })
  ids.bordeAntes = await pedido(E.a, 7, '2031-03-01T03:00:00Z', { completado: '2031-03-01T03:00:00Z' }) // 28 feb 23:00 local → AÚN es febrero
  // Periodo (1–31 mar 2031, hora local).
  ids.o1 = await pedido(E.a, 0, '2031-03-10T15:00:00Z', { completado: '2031-03-10T15:00:00Z' })
  ids.o2 = await pedido(E.a, 1, '2031-03-12T01:30:00Z', { canal: 'MARKETPLACE_SEARCH', completado: '2031-03-12T01:30:00Z' }) // 11 mar 21:30 local
  ids.o3 = await pedido(E.a, 2, '2031-03-12T15:00:00Z', { completado: '2031-03-12T15:00:00Z' }) // a2 ya compró en febrero: recurrente
  ids.tarde = await pedido(E.a, 3, '2031-04-01T02:00:00Z', { completado: '2031-04-01T02:00:00Z' }) // 31 mar 22:00 local → SÍ es marzo
  ids.bordeDespues = await pedido(E.a, 6, '2031-04-01T05:00:00Z', { completado: '2031-04-01T05:00:00Z' }) // 1 abr 01:00 local → abril
  ids.reembolsado = await pedido(E.a, 5, '2031-03-20T15:00:00Z', { completado: '2031-03-20T15:00:00Z' })
  await en(E.a, (tx) => reembolsarPedidoEnTx(tx, E.a.id, ids.reembolsado, { motivo: 'prueba' }, empresa(), d('2031-03-22T15:00:00Z')))
  // a9 compró en febrero y se le reembolsó: haber comprado una vez lo hace recurrente aunque ese pedido ya no cuente como venta.
  ids.previoA9 = await pedido(E.a, 9, '2031-02-12T15:00:00Z', { completado: '2031-02-12T15:00:00Z' })
  await en(E.a, (tx) => reembolsarPedidoEnTx(tx, E.a.id, ids.previoA9, { motivo: 'prueba' }, empresa(), d('2031-02-13T15:00:00Z')))
  ids.o9 = await pedido(E.a, 9, '2031-03-25T15:00:00Z', { completado: '2031-03-25T15:00:00Z' })
  ids.cancelado = await pedido(E.a, 8, '2031-03-05T15:00:00Z')
  await en(E.a, (tx) => cancelarPedidoEnTx(tx, E.a.id, ids.cancelado, { motivo: 'prueba' }, empresa(), d('2031-03-05T16:00:00Z')))
  ids.abierto = await pedido(E.a, 8, '2031-03-06T15:00:00Z')

  // Una oferta con presupuesto: 20 % sobre RD$ 400 → RD$ 320, cuota RD$ 100. Obtenida y canjeada el 15 mar.
  const oferta = await en(E.a, (tx) => crearOfertaEnTx(tx, E.a.id, { title: `Oferta analítica ${sufijo}`, catalogVariantId: E.a.variante, discountType: 'PERCENT', discountValue: 20, startsAt: d('2031-01-01T00:00:00Z'), endsAt: null, maxClaims: 10, budgetTotal: 1000 }, ctxAud()))
  await en(E.a, (tx) => publicarOfertaEnTx(tx, E.a.id, oferta.id, ctxAud()))
  const ahora = d('2031-03-15T15:00:00Z')
  const r = await en(E.a, (tx) => reclamarOfertaEnTx(tx, E.a.id, { dealId: oferta.id, customerId: E.a.clientes[4], locationId: E.a.sucursal }, ahora))
  const p = await prisma.membegoOrder.findUniqueOrThrow({ where: { id: r.orderId }, select: { qrToken: true } })
  await en(E.a, (tx) => completarPorQrEnTx(tx, E.a.id, p.qrToken as string, empresa(), ahora))
  await fecharCreacion(r.orderId, ahora)
  ids.oferta = oferta.id
  ids.pedidoOferta = r.orderId

  // Otra empresa y la de práctica: un pedido completado en el periodo cada una.
  ids.b1 = await pedido(E.b, 0, '2031-03-09T15:00:00Z', { completado: '2031-03-09T15:00:00Z' })
  ids.demo1 = await pedido(E.demo, 0, '2031-03-09T15:00:00Z', { completado: '2031-03-09T15:00:00Z' })
})

const rango = () => leerRango({ desde: '2031-03-01', hasta: '2031-03-31' }, TZ)

// ── Empresa ──────────────────────────────────────────────────────────────────

test('1 · la empresa: pedidos, ventas, ticket y comisiones del periodo, contra el periodo anterior, con los bordes en hora local', async () => {
  const r = rango()
  assert.equal(r.dias, 31)
  const x = await en(E.a, (tx) => resultadosDeMembegoEnTx(tx, E.a.id, r, TZ))
  // Marzo: o1, o2 (21:30 del 11), o3, o9, la de las 22:00 del 31 y la oferta = 6 pedidos; el de 1:00 del 1 de abril NO.
  assert.equal(x.pedidos.valor, 6)
  assert.equal(x.ventas.valor, 5 * 400 + 320)
  assert.equal(x.ticket.valor, 386.67)
  assert.equal(x.comisiones.valor, 600, 'seis comisiones CPA de RD$ 100; las de los reembolsados se revirtieron y no cuentan')
  // Febrero: el pedido de febrero y el de las 23:00 del 28 (que en UTC ya es 1 de marzo).
  assert.equal(x.pedidos.anterior, 2)
  assert.equal(x.ventas.anterior, 800)
  assert.equal(x.comisiones.anterior, 200)
  assert.equal(x.pedidos.variacion, 200)
  assert.equal(x.ventas.variacion, 190)
  // Retorno: 2 320 vendidos por 600 pagados.
  assert.equal(x.retorno.valor, 3.9)
  assert.equal(x.retorno.anterior, 4)
})

test('2 · clientes nuevos vs. recurrentes: quien ya había completado un pedido con la empresa no es nuevo; el costo por cliente nuevo', async () => {
  const x = await en(E.a, (tx) => resultadosDeMembegoEnTx(tx, E.a.id, rango(), TZ))
  assert.equal(x.clientes.valor, 6, 'a0, a1, a2, a3, a9 y quien obtuvo la oferta')
  assert.equal(x.clientesNuevos.valor, 4, 'a2 compró en febrero y a9 también (aunque se le reembolsó): son recurrentes')
  assert.equal(x.clientes.anterior, 2)
  assert.equal(x.clientesNuevos.anterior, 2)
  assert.equal(x.costoPorClienteNuevo.valor, 150, '600 pagados ÷ 4 clientes nuevos')
})

test('3 · atribución por canal, reembolsos, embudo y serie por día local', async () => {
  const x = await en(E.a, (tx) => resultadosDeMembegoEnTx(tx, E.a.id, rango(), TZ))
  const canal = (c: string) => x.porCanal.find((f) => f.canal === c)
  assert.deepEqual({ pedidos: canal('MARKETPLACE_BROWSE')?.pedidos, ventas: canal('MARKETPLACE_BROWSE')?.ventas }, { pedidos: 4, ventas: 1600 })
  assert.deepEqual({ pedidos: canal('MARKETPLACE_SEARCH')?.pedidos, ventas: canal('MARKETPLACE_SEARCH')?.ventas }, { pedidos: 1, ventas: 400 })
  assert.deepEqual({ pedidos: canal('PROMOTION_CLAIM')?.pedidos, ventas: canal('PROMOTION_CLAIM')?.ventas }, { pedidos: 1, ventas: 320 })
  assert.equal(x.porCanal.reduce((t, c) => t + c.ventas, 0), x.ventas.valor, 'los canales suman las ventas')

  assert.deepEqual(x.reembolsos, { pedidos: 1, monto: 400 })

  // Creados en marzo: 6 completados + 1 reembolsado + 1 cancelado + 1 abierto.
  assert.deepEqual(x.embudo, { creados: 9, completados: 6, cancelados: 2, abiertos: 1, tasaDeCierre: 66.7 })

  assert.equal(x.serie.length, 31)
  const dia = (s: string) => x.serie.find((p) => p.dia === s)
  assert.deepEqual(dia('2031-03-11'), { dia: '2031-03-11', pedidos: 1, ventas: 400 }, 'a la 1:30 UTC del 12, el pedido es del 11 en Santo Domingo')
  assert.deepEqual(dia('2031-03-12'), { dia: '2031-03-12', pedidos: 1, ventas: 400 })
  assert.deepEqual(dia('2031-03-31'), { dia: '2031-03-31', pedidos: 1, ventas: 400 }, 'a las 2:00 UTC del 1 de abril, el pedido es del 31 de marzo')
  assert.equal(dia('2031-03-13')?.pedidos, 0, 'los días sin ventas salen en cero')
  assert.equal(x.serie.reduce((t, p) => t + p.ventas, 0), x.ventas.valor, 'la serie suma las ventas')
})

test('4 · la oferta: obtenidas, canjeadas, ventas, ahorro, cuota y retorno', async () => {
  const x = await en(E.a, (tx) => resultadosDeMembegoEnTx(tx, E.a.id, rango(), TZ))
  assert.equal(x.ofertas.length, 1)
  const o = x.ofertas[0]
  assert.equal(o.id, ids.oferta)
  assert.deepEqual(
    { obtenidas: o.obtenidas, canjeadas: o.canjeadas, conversion: o.conversion, ventas: o.ventas, ahorro: o.ahorro, cuota: o.cuota, retorno: o.retorno },
    { obtenidas: 1, canjeadas: 1, conversion: 100, ventas: 320, ahorro: 80, cuota: 100, retorno: 3.2 }
  )
  // Otro periodo: la oferta no se obtuvo, no sale.
  const antes = await en(E.a, (tx) => resultadosDeMembegoEnTx(tx, E.a.id, leerRango({ desde: '2031-02-01', hasta: '2031-02-28' }, TZ), TZ))
  assert.equal(antes.ofertas.length, 0)
})

test('5 · aislamiento: B solo ve lo suyo y un periodo sin pedidos da ceros, no errores ni NaN', async () => {
  const b = await en(E.b, (tx) => resultadosDeMembegoEnTx(tx, E.b.id, rango(), TZ))
  assert.equal(b.pedidos.valor, 1)
  assert.equal(b.ventas.valor, 400)
  assert.equal(b.ofertas.length, 0)
  const vacio = await en(E.b, (tx) => resultadosDeMembegoEnTx(tx, E.b.id, leerRango({ desde: '2032-01-01', hasta: '2032-01-31' }, TZ), TZ))
  assert.equal(vacio.pedidos.valor, 0)
  assert.equal(vacio.ticket.valor, 0)
  assert.equal(vacio.retorno.valor, null, 'sin comisión no hay retorno que calcular')
  assert.equal(vacio.costoPorClienteNuevo.valor, null)
  assert.equal(vacio.embudo.tasaDeCierre, null)
  assert.ok(Object.values(vacio.ventas).every((v) => v === null || Number.isFinite(v)))
})

// ── Plataforma ───────────────────────────────────────────────────────────────

test('6 · la plataforma suma a todas las empresas MENOS las de práctica; toma y empresas activas', async () => {
  const p = await sinEmpresa('prueba: panorama de plataforma', (tx) => panoramaDePlataformaEnTx(tx, rango(), TZ))
  // Otros archivos de prueba no tienen pedidos en 2031: A (6) + B (1). La empresa de práctica no cuenta.
  assert.equal(p.pedidos.valor, 7)
  assert.equal(p.gmv.valor, 2320 + 400)
  assert.equal(p.empresasActivas.valor, 2)
  assert.equal(p.comisiones.valor, 700)
  assert.equal(p.gmvComisionable.valor, 2720)
  assert.equal(p.toma.valor, 25.74)
  assert.equal(p.ticket.valor, 388.57)
  assert.deepEqual(p.porOrigen.map((o) => o.origen), ['MARKETPLACE'])
  const top = p.topEmpresas
  assert.deepEqual(top.map((t) => t.id), [E.a.id, E.b.id])
  assert.equal(top[0].toma, 25.86)
  assert.ok(!top.some((t) => t.id === E.demo.id), 'la de práctica no sale en el ranking')
})

test('7 · la plataforma: ofertas, embudo y reembolsos sin la empresa de práctica', async () => {
  const p = await sinEmpresa('prueba: panorama de plataforma', (tx) => panoramaDePlataformaEnTx(tx, rango(), TZ))
  assert.deepEqual({ obtenidas: p.ofertas.obtenidas, canjeadas: p.ofertas.canjeadas, ventas: p.ofertas.ventas, cuota: p.ofertas.cuota }, { obtenidas: 1, canjeadas: 1, ventas: 320, cuota: 100 })
  assert.equal(p.ofertas.top[0].empresa, `Analítica a ${sufijo}`)
  assert.deepEqual(p.embudo, { creados: 10, completados: 7, cancelados: 2, abiertos: 1, tasaDeCierre: 70 }, 'A: 9 creados; B: 1; la de práctica no cuenta')
  assert.deepEqual(p.reembolsos, { pedidos: 1, monto: 400 })
  assert.equal(p.serie.length, 31)
  assert.equal(p.serie.reduce((t, x) => t + x.ventas, 0), p.gmv.valor)
})

test('8 · la empresa de práctica sí ve lo suyo en su propio panel', async () => {
  const x = await en(E.demo, (tx) => resultadosDeMembegoEnTx(tx, E.demo.id, rango(), TZ))
  assert.equal(x.pedidos.valor, 1)
  assert.equal(x.ventas.valor, 400)
})
