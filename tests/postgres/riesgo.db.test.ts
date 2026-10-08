import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa, sinEmpresa } from '../../src/lib/tenant'
import { cambiarEstadoItemEnTx, crearItemEnTx } from '../../src/modules/catalog/service'
import { aceptarPedidoEnTx, ajustarMontoEnTx, cancelarPedidoEnTx, completarPorQrEnTx, crearPedidoEnTx, marcarListoEnTx, reembolsarPedidoEnTx, type ContextoPedido } from '../../src/modules/orders/service'
import { MOTIVO_SIN_RESPUESTA } from '../../src/modules/orders/motivos'
import { barridoDeOfertas } from '../../src/modules/deals/barrido'
import { crearOfertaEnTx, publicarOfertaEnTx, reclamarOfertaEnTx } from '../../src/modules/deals/service'
import { riesgoDeLaPlataformaEnTx } from '../../src/modules/riesgo-comercio/queries'
import type { Senal } from '../../src/modules/riesgo-comercio/domain'

/**
 * SEÑALES DE RIESGO contra PostgreSQL de verdad (Fase 9).
 *
 * Cada empresa y cada cliente de la prueba tiene UNA conducta, y se comprueba que dan exactamente las señales que
 * les tocan (ni una más): muchas cancelaciones, pocas muestras que NO dan señal, reembolsos, pedidos sin atender,
 * ajustes de monto, crédito al límite, cuenta restringida, cliente que cancela, que deja vencer cupones y que pide
 * en ráfaga. Las empresas de práctica no cuentan. Los números de la base compartida son de otras pruebas: aquí se
 * mira solo lo de los sujetos creados por esta.
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const empresa: ContextoPedido = { actor: 'EMPRESA', actorId: null }
const clienteCtx: ContextoPedido = { actor: 'CLIENTE', actorId: null }

interface E {
  id: string
  suc: string
  variante: string
  clientes: string[]
}
const empresas: Record<string, E> = {}
let usuario = ''
const clientesPorEmpresa: Record<string, Record<string, string>> = {}

const aud = () => ({ actorId: usuario, ipAddress: '127.0.0.1', userAgent: 'test' })

before(async () => {
  usuario = (await prisma.user.create({ data: { supabaseId: `sb-rsk-${sufijo}`, email: `rsk-${sufijo}@prueba.test`, name: 'Riesgo', role: 'SUPERADMIN' }, select: { id: true } })).id
  const nueva = async (k: string, esDemo = false): Promise<E> => {
    const id = (await prisma.company.create({ data: { name: `RSK ${k} ${sufijo}`, slug: `rsk-${k}-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo', esDemo }, select: { id: true } })).id
    const suc = (await prisma.sucursal.create({ data: { companyId: id, nombre: 'Principal' }, select: { id: true } })).id
    const r = await conEmpresa(id, (tx) => crearItemEnTx(tx, id, { name: `Servicio ${k} ${sufijo}`, type: 'SERVICE', price: 250, sku: `RSK-${k}-${sufijo}` }, aud()))
    await conEmpresa(id, (tx) => cambiarEstadoItemEnTx(tx, id, r.id, 'ACTIVE', aud()))
    const variante = (await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })).id
    const e: E = { id, suc, variante, clientes: [] }
    empresas[k] = e
    clientesPorEmpresa[k] = {}
    return e
  }
  for (const k of ['cancela', 'poco', 'reembolsa', 'sinatender', 'ajusta', 'sana']) await nueva(k)
  await nueva('demo', true)
})

after(async () => {
  const ids = Object.values(empresas).map((e) => e.id)
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    for (const tabla of ['deal_claims', 'deals', 'merchant_statements', 'merchant_commissions', 'merchant_ledger_entries', 'merchant_billing_configs', 'payment_evidences', 'customer_confirmations', 'order_attributions', 'membego_order_lines', 'membego_orders', 'inventory_movements', 'inventory_reservations', 'inventory_levels']) {
      await tx.$executeRawUnsafe(`DELETE FROM "${tabla}" WHERE "companyId" IN (${ids.map((i) => `'${i}'`).join(',')})`)
    }
  })
  await prisma.catalogItem.deleteMany({ where: { companyId: { in: ids } } })
  for (const t of tocadas) {
    const [tabla, nombre] = t.split('|')
    await prisma.$executeRawUnsafe(`ALTER TABLE "${tabla}" VALIDATE CONSTRAINT "${nombre}"`)
  }
})

// ── Ayudas ───────────────────────────────────────────────────────────────────

/** Escritura «a mano» (sin disparadores ni CHECK de esa tabla; las CHECK vuelven validadas al final). */
const tocadas = new Set<string>()
const rompe = (tabla: string, sql: Prisma.Sql) =>
  prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    const cs = await tx.$queryRawUnsafe<{ conname: string; def: string }[]>(`SELECT c.conname, pg_get_constraintdef(c.oid) AS def FROM pg_constraint c WHERE c.conrelid = '"${tabla}"'::regclass AND c.contype = 'c'`)
    for (const c of cs) await tx.$executeRawUnsafe(`ALTER TABLE "${tabla}" DROP CONSTRAINT "${c.conname}"`)
    await tx.$executeRaw(sql)
    for (const c of cs) {
      await tx.$executeRawUnsafe(`ALTER TABLE "${tabla}" ADD CONSTRAINT "${c.conname}" ${c.def} NOT VALID`)
      tocadas.add(`${tabla}|${c.conname}`)
    }
  })

/** Un cliente con una ficha en la empresa (la misma persona = el mismo `supabaseId` en todas). */
async function cliente(k: string, persona: string): Promise<string> {
  const previo = clientesPorEmpresa[k][persona]
  if (previo) return previo
  const id = (await prisma.cliente.create({ data: { companyId: empresas[k].id, supabaseId: `sb-rsk-${persona}-${sufijo}`, nombre: `Persona ${persona}`, email: `${persona}-${sufijo}@prueba.test` }, select: { id: true } })).id
  clientesPorEmpresa[k][persona] = id
  return id
}

const pedido = async (k: string, persona = 'p0') => {
  const e = empresas[k]
  return conEmpresa(e.id, async (tx) =>
    crearPedidoEnTx(tx, e.id, { customerId: await cliente(k, persona), locationId: e.suc, origin: 'MARKETPLACE', lineas: [{ varianteId: e.variante, cantidad: 1 }], atribucion: { channel: 'MARKETPLACE_BROWSE' } }, clienteCtx)
  )
}
const en = <T>(k: string, fn: Parameters<typeof conEmpresa<T>>[1]) => conEmpresa(empresas[k].id, fn)
const cancelar = (k: string, id: string, persona = 'p0') => en(k, async (tx) => cancelarPedidoEnTx(tx, empresas[k].id, id, { motivo: 'Prueba', customerId: await cliente(k, persona) }, clienteCtx))
const cerrar = async (k: string, id: string) => {
  const listo = await en(k, (tx) => marcarListoEnTx(tx, empresas[k].id, id, empresa))
  await en(k, (tx) => completarPorQrEnTx(tx, empresas[k].id, listo.qrToken as string, empresa))
}
const antiguedad = (id: string, horas: number) => rompe('membego_orders', Prisma.sql`UPDATE "membego_orders" SET "createdAt" = now() - (${horas} || ' hours')::interval WHERE "id" = ${id}`)

async function senales(): Promise<Senal[]> {
  const r = await sinEmpresa('señales de riesgo de prueba', (tx) => riesgoDeLaPlataformaEnTx(tx))
  const suyas = new Set(Object.values(empresas).map((e) => e.id))
  return r.senales.filter((s) => (s.sujeto.tipo === 'EMPRESA' ? suyas.has(s.sujeto.id) : s.sujeto.id.endsWith(`-${sufijo}`)))
}
const de = (todas: Senal[], k: string) => todas.filter((s) => s.sujeto.id === empresas[k].id).map((s) => `${s.tipo}:${s.severidad}`).sort()
const dePersona = (todas: Senal[], p: string) => todas.filter((s) => s.sujeto.id === `sb-rsk-${p}-${sufijo}`).map((s) => `${s.tipo}:${s.severidad}`).sort()

// ── Empresas ─────────────────────────────────────────────────────────────────

test('1 · una empresa que cancela 4 de 10 pedidos da la señal de cancelaciones (media); a 5 de 10 sería alta', async () => {
  const ids: string[] = []
  for (let i = 0; i < 10; i++) ids.push((await pedido('cancela', `c${i}`)).pedidoId)
  for (const [i, id] of ids.slice(0, 4).entries()) await cancelar('cancela', id, `c${i}`)
  assert.deepEqual(de(await senales(), 'cancela'), ['EMPRESA_CANCELA_MUCHO:MEDIA'])
  await cancelar('cancela', ids[4], 'c4')
  assert.deepEqual(de(await senales(), 'cancela'), ['EMPRESA_CANCELA_MUCHO:ALTA'])
})

test('2 · con pocos pedidos no hay tasa: 3 cancelados de 3 NO da señal', async () => {
  const ids = [await pedido('poco', 'a'), await pedido('poco', 'b'), await pedido('poco', 'c')]
  for (const [i, r] of ids.entries()) await cancelar('poco', r.pedidoId, ['a', 'b', 'c'][i])
  assert.deepEqual(de(await senales(), 'poco'), [])
})

test('3 · una empresa que reembolsa 2 de 10 pedidos cerrados da la señal de reembolsos (alta)', async () => {
  const ids: string[] = []
  for (let i = 0; i < 10; i++) {
    const r = await pedido('reembolsa', `r${i}`)
    await cerrar('reembolsa', r.pedidoId)
    ids.push(r.pedidoId)
  }
  assert.deepEqual(de(await senales(), 'reembolsa'), [])
  await en('reembolsa', (tx) => reembolsarPedidoEnTx(tx, empresas.reembolsa.id, ids[0], { motivo: 'Devolución' }, empresa))
  assert.deepEqual(de(await senales(), 'reembolsa'), ['EMPRESA_REEMBOLSA_MUCHO:MEDIA'], '1 de 10 = 10 %')
  await en('reembolsa', (tx) => reembolsarPedidoEnTx(tx, empresas.reembolsa.id, ids[1], { motivo: 'Devolución' }, empresa))
  assert.deepEqual(de(await senales(), 'reembolsa'), ['EMPRESA_REEMBOLSA_MUCHO:ALTA'], '2 de 10 = 20 %')
})

test('4 · pedidos que llevan más de 24 horas esperando a la empresa dan la señal de «sin atender»; los recientes no', async () => {
  const ids: string[] = []
  for (let i = 0; i < 3; i++) ids.push((await pedido('sinatender', `s${i}`)).pedidoId)
  assert.deepEqual(de(await senales(), 'sinatender'), [], 'recién creados')
  for (const id of ids.slice(0, 2)) await antiguedad(id, 30)
  assert.deepEqual(de(await senales(), 'sinatender'), [], '2 viejos no llegan al mínimo (3)')
  await antiguedad(ids[2], 30)
  assert.deepEqual(de(await senales(), 'sinatender'), ['EMPRESA_NO_RESPONDE:MEDIA'])
})

test('5 · una empresa que cambia mucho el monto de sus pedidos (más del 25 % del subtotal) da la señal de ajustes', async () => {
  for (let i = 0; i < 5; i++) {
    const r = await pedido('ajusta', `j${i}`)
    await en('ajusta', (tx) => aceptarPedidoEnTx(tx, empresas.ajusta.id, r.pedidoId, empresa))
    await en('ajusta', (tx) => ajustarMontoEnTx(tx, empresas.ajusta.id, r.pedidoId, { ajuste: -100, motivo: 'Precio distinto' }, empresa))
  }
  assert.deepEqual(de(await senales(), 'ajusta'), ['EMPRESA_AJUSTA_MUCHO:ALTA'])
})

test('6 · el crédito: 91 % del límite da señal media, 100 % alta; en gracia o suspendida, alta; una cuenta sana no da nada', async () => {
  // «reembolsa»: 10 comisiones CPA de 100 y 2 reversos de 100 → debe 800.
  const saldo = (await prisma.merchantLedgerEntry.findFirstOrThrow({ where: { companyId: empresas.reembolsa.id }, orderBy: { seq: 'desc' } })).balance.toNumber()
  assert.equal(saldo, 800, 'el libro: 10 cobros de 100 menos 2 reversos')
  const conLimite = async (limite: number, estado: 'ACTIVE' | 'GRACE_PERIOD' | 'SUSPENDED' = 'ACTIVE') => {
    await rompe('merchant_billing_configs', Prisma.sql`UPDATE "merchant_billing_configs" SET "creditLimit" = ${limite}, "status" = ${estado}::"MerchantBillingStatus" WHERE "companyId" = ${empresas.reembolsa.id}`)
    return de(await senales(), 'reembolsa').filter((x) => x.startsWith('EMPRESA_CREDITO') || x.startsWith('EMPRESA_CUENTA'))
  }
  assert.deepEqual(await conLimite(5000), [])
  assert.deepEqual(await conLimite(Math.floor(saldo / 0.91)), ['EMPRESA_CREDITO_AL_LIMITE:MEDIA'])
  assert.deepEqual(await conLimite(saldo), ['EMPRESA_CREDITO_AL_LIMITE:ALTA'])
  assert.deepEqual(await conLimite(5000, 'GRACE_PERIOD'), ['EMPRESA_CUENTA_RESTRINGIDA:ALTA'])
  assert.deepEqual(await conLimite(5000, 'SUSPENDED'), ['EMPRESA_CUENTA_RESTRINGIDA:ALTA'])
  await conLimite(5000)
})

test('7 · una empresa sana (pedidos cerrados, nada raro) no da ninguna señal', async () => {
  for (let i = 0; i < 6; i++) await cerrar('sana', (await pedido('sana', `h${i}`)).pedidoId)
  assert.deepEqual(de(await senales(), 'sana'), [])
})

// ── Clientes ─────────────────────────────────────────────────────────────────

test('8 · un cliente que cancela 5 pedidos en 30 días da la señal de cancelaciones (media), sumando todas las empresas', async () => {
  // 3 en una empresa y 2 en otra: es la misma persona (mismo supabaseId).
  for (let i = 0; i < 3; i++) await cancelar('sana', (await pedido('sana', 'cancelador')).pedidoId, 'cancelador')
  assert.deepEqual(dePersona(await senales(), 'cancelador'), [])
  for (let i = 0; i < 2; i++) await cancelar('poco', (await pedido('poco', 'cancelador')).pedidoId, 'cancelador')
  assert.deepEqual(dePersona(await senales(), 'cancelador'), ['CLIENTE_CANCELA_MUCHO:MEDIA'])
})

test('9 · un cliente que pide 10 veces en un día da la señal de ráfaga', async () => {
  for (let i = 0; i < 9; i++) await pedido('sana', 'rafaga')
  assert.deepEqual(dePersona(await senales(), 'rafaga'), [])
  await pedido('sana', 'rafaga')
  assert.deepEqual(dePersona(await senales(), 'rafaga'), ['CLIENTE_RAFAGA:MEDIA'])
})

test('10 · un cliente que deja vencer 3 cupones de ofertas da la señal de cupones vencidos', async () => {
  const persona = 'cuponero'
  const cid = await cliente('sana', persona)
  for (let i = 0; i < 3; i++) {
    const oferta = await en('sana', (tx) => crearOfertaEnTx(tx, empresas.sana.id, { title: `Oferta riesgo ${sufijo}-${i}`, catalogVariantId: empresas.sana.variante, discountType: 'PERCENT', discountValue: 20, startsAt: new Date(Date.now() - 3_600_000), endsAt: null, maxClaims: 5, budgetTotal: 1000 }, aud()))
    await en('sana', (tx) => publicarOfertaEnTx(tx, empresas.sana.id, oferta.id, aud()))
    const reclamo = await en('sana', (tx) => reclamarOfertaEnTx(tx, empresas.sana.id, { dealId: oferta.id, customerId: cid, locationId: empresas.sana.suc }))
    if (i < 2) assert.deepEqual(dePersona(await senales(), persona), [], 'con menos de 3 no hay señal')
    await rompe('deal_claims', Prisma.sql`UPDATE "deal_claims" SET "status" = 'EXPIRED', "closedAt" = now() WHERE "orderId" = ${reclamo.orderId}`)
  }
  assert.deepEqual(dePersona(await senales(), persona), ['CLIENTE_CUPONES_VENCIDOS:MEDIA'])
})

// ── Alcance ──────────────────────────────────────────────────────────────────

test('11 · las empresas de práctica no cuentan, aunque hagan todo mal', async () => {
  for (let i = 0; i < 6; i++) {
    const r = await pedido('demo', `d${i}`)
    await cancelar('demo', r.pedidoId, `d${i}`)
  }
  const todas = await sinEmpresa('señales de riesgo de prueba', (tx) => riesgoDeLaPlataformaEnTx(tx))
  assert.ok(!todas.senales.some((s) => s.sujeto.id === empresas.demo.id))
  assert.ok(!todas.senales.some((s) => s.sujeto.tipo === 'CLIENTE' && s.sujeto.id.startsWith('sb-rsk-d')), 'ni sus clientes')
})

test('12 · las señales salen ordenadas: primero las altas', async () => {
  const todas = (await senales()).map((s) => s.severidad)
  const primeraMedia = todas.indexOf('MEDIA')
  assert.ok(primeraMedia === -1 || !todas.slice(primeraMedia).includes('ALTA'))
})


// ── Lote de la auditoría F5–F9 ───────────────────────────────────────────────

test('13 · lo que el SISTEMA cancela porque la empresa no respondió cuenta contra la EMPRESA, no contra quien pidió (M13)', async () => {
  const persona = 'olvidadizo'
  for (let i = 0; i < 5; i++) {
    const p = await pedido('poco', persona)
    await en('poco', (tx) => cancelarPedidoEnTx(tx, empresas.poco.id, p.pedidoId, { motivo: MOTIVO_SIN_RESPUESTA }, { actor: 'SISTEMA', actorId: null }))
  }
  const todas = await senales()
  assert.deepEqual(dePersona(todas, persona), [], '5 cancelaciones automáticas por falta de respuesta no son del cliente')
  assert.ok(de(todas, 'poco').includes('EMPRESA_CANCELA_MUCHO:ALTA') || de(todas, 'poco').includes('EMPRESA_CANCELA_MUCHO:MEDIA'), 'y sí son un descuido de la empresa')
})

test('14 · un cupón que se deja vencer es UNA señal (cupones vencidos), no además «cancela muchos»; y tampoco cuenta como cancelación de la empresa (M13)', async () => {
  const persona = 'cuponero2'
  const cid = await cliente('sana', persona)
  for (let i = 0; i < 5; i++) {
    const oferta = await en('sana', (tx) => crearOfertaEnTx(tx, empresas.sana.id, { title: `Oferta vence ${sufijo}-${i}`, catalogVariantId: empresas.sana.variante, discountType: 'PERCENT', discountValue: 20, startsAt: new Date(Date.now() - 3_600_000), endsAt: null, maxClaims: 5, budgetTotal: 1000, voucherDays: 1 }, aud()))
    await en('sana', (tx) => publicarOfertaEnTx(tx, empresas.sana.id, oferta.id, aud()))
    await en('sana', (tx) => reclamarOfertaEnTx(tx, empresas.sana.id, { dealId: oferta.id, customerId: cid, locationId: empresas.sana.suc }))
  }
  const b = await barridoDeOfertas(new Date(Date.now() + 3 * 86_400_000))
  assert.ok(b.reclamosVencidos >= 5)
  const todas = await senales()
  assert.deepEqual(dePersona(todas, persona), ['CLIENTE_CUPONES_VENCIDOS:MEDIA'], '5 cupones vencidos = una sola señal, la suya')
  assert.ok(!de(todas, 'sana').some((x) => x.startsWith('EMPRESA_CANCELA_MUCHO')), 'la empresa no “cancela” porque se le vencieron cupones')
})
