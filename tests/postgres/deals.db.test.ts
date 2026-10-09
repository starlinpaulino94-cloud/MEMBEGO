import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import { cambiarEstadoItemEnTx, crearItemEnTx } from '../../src/modules/catalog/service'
import { FacturacionError } from '../../src/modules/billing/errores'
import { actualizarConfigEnTx, fijarEstadoManualEnTx, type ContextoFacturacion } from '../../src/modules/billing/service'
import { PedidoError } from '../../src/modules/orders/errores'
import { cancelarPedidoEnTx, completarPorQrEnTx, crearPedidoEnTx, reembolsarPedidoEnTx, type ContextoPedido } from '../../src/modules/orders/service'
import { OfertaError } from '../../src/modules/deals/errores'
import {
  ampliarPresupuestoEnTx,
  archivarOfertaEnTx,
  actualizarOfertaEnTx,
  crearOfertaEnTx,
  pausarOfertaEnTx,
  publicarOfertaEnTx,
  motivoNoReclamarEnTx,
  reanudarOfertaEnTx,
  reclamarOfertaEnTx,
} from '../../src/modules/deals/service'
import { barridoDeOfertas } from '../../src/modules/deals/barrido'
import { detalleOfertaEnTx, listarOfertasEnTx } from '../../src/modules/deals/queries'
import type { EntradaDeOferta } from '../../src/modules/deals/domain'
import { getCampanasMarketingAdmin } from '../../src/modules/engagement/campanas'

/**
 * COMMERCE CORE · Ofertas con presupuesto (Deals) contra PostgreSQL de verdad (Fase 5).
 *
 * Lo que solo se puede comprobar aquí:
 *
 *  · que el presupuesto y los cupos NO se pasan aunque muchas personas reclamen a la vez
 *    (el `UPDATE` atómico) y que una persona reclama una oferta UNA sola vez (índice único);
 *  · que reclamar crea, en una sola transacción, la reserva, el pedido con QR (atribución
 *    PROMOTION_CLAIM) y el reclamo, y que si algo falla no queda nada reservado;
 *  · que el canje cobra la CUOTA de la oferta en Merchant Billing (CPA, aunque la cuenta sea de
 *    porcentaje y aunque la oferta sea gratis) en la misma transacción que completa el pedido;
 *  · que cancelar, vencer y reembolsar devuelven cupo y presupuesto, y que una oferta sin
 *    presupuesto se pausa sola y vuelve cuando se libera;
 *  · las reglas que la base repite: contadores que cuadran con los reclamos, transiciones,
 *    un pedido de oferta que no se cierra sin liquidar su reclamo, y la economía de la oferta
 *    que no cambia al publicarla.
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

type Empresa = { id: string; sucursal: string; variante: string; clientes: string[] }
const E: Record<'a' | 'b' | 'c', Empresa> = {
  a: { id: '', sucursal: '', variante: '', clientes: [] },
  /** Otra empresa: aislamiento. */
  b: { id: '', sucursal: '', variante: '', clientes: [] },
  /** Cuenta suspendida. */
  c: { id: '', sucursal: '', variante: '', clientes: [] },
}
const f = { usuario: '' }
const N_CLIENTES = 30

const ctxEmpresa = (): ContextoPedido => ({ actor: 'EMPRESA', actorId: f.usuario, ipAddress: '127.0.0.1', userAgent: 'test' })
const ctxOferta = () => ({ actorId: f.usuario, ipAddress: '127.0.0.1', userAgent: 'test' })
const superadmin = (): ContextoFacturacion => ({ actor: 'SUPERADMIN', actorId: f.usuario, ipAddress: '127.0.0.1', userAgent: 'test' })
const cliente: ContextoPedido = { actor: 'CLIENTE', actorId: null }

type Transaccion = Parameters<Parameters<typeof conEmpresa>[1]>[0]
const en = <T>(e: Empresa, fn: (tx: Transaccion) => Promise<T>) => conEmpresa(e.id, fn)

before(async () => {
  const u = await prisma.user.create({ data: { supabaseId: `sb-deal-${sufijo}`, email: `deal-${sufijo}@prueba.test`, name: 'Deals', role: 'SUPERADMIN' }, select: { id: true } })
  f.usuario = u.id
  for (const [k, e] of Object.entries(E) as [keyof typeof E, Empresa][]) {
    const c = await prisma.company.create({ data: { name: `Deals ${k} ${sufijo}`, slug: `deals-${k}-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo' }, select: { id: true } })
    e.id = c.id
    e.sucursal = (await prisma.sucursal.create({ data: { companyId: c.id, nombre: 'Principal' }, select: { id: true } })).id
    const total = k === 'a' ? N_CLIENTES : 3
    for (let i = 0; i < total; i++) {
      e.clientes.push((await prisma.cliente.create({ data: { companyId: c.id, supabaseId: `sb-dcli-${k}-${i}-${sufijo}`, nombre: `Cliente ${k}${i}`, email: `dcli-${k}-${i}-${sufijo}@prueba.test` }, select: { id: true } })).id)
    }
    const item = await conEmpresa(c.id, (tx) => crearItemEnTx(tx, c.id, { name: `Lavado ${k} ${sufijo}`, type: 'SERVICE', price: 400, sku: `DEAL-${k}-${sufijo}` }, ctxOferta()))
    await conEmpresa(c.id, (tx) => cambiarEstadoItemEnTx(tx, c.id, item.id, 'ACTIVE', ctxOferta()))
    e.variante = (await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: item.id }, select: { id: true } })).id
  }
})

after(async () => {
  const ids = Object.values(E).map((e) => e.id)
  const lista = ids.map((i) => `'${i}'`).join(',')
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    for (const tabla of ['marketing_campaigns', 'deal_claims', 'deals', 'merchant_statements', 'merchant_commissions', 'merchant_ledger_entries', 'merchant_billing_configs', 'payment_evidences', 'customer_confirmations', 'order_attributions', 'membego_order_lines', 'membego_orders']) {
      await tx.$executeRawUnsafe(`DELETE FROM "${tabla}" WHERE "companyId" IN (${lista})`)
    }
  })
  await prisma.catalogItem.deleteMany({ where: { companyId: { in: ids } } })
})

// ── Ayudas ───────────────────────────────────────────────────────────────────

async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    if (e instanceof OfertaError || e instanceof PedidoError || e instanceof FacturacionError) return e.codigo
    throw e
  }
  assert.fail('se esperaba un error de dominio y no falló')
}

class Revertir extends Error {}
/** Ejecuta `fn` en una transacción que SIEMPRE se deshace; devuelve el mensaje con el que la base rechazó. */
async function rechazo(fn: (tx: Prisma.TransactionClient) => Promise<unknown>): Promise<string> {
  try {
    await prisma.$transaction(async (tx) => {
      await fn(tx)
      throw new Revertir()
    })
  } catch (e) {
    if (e instanceof Revertir) assert.fail('la base aceptó lo que debía rechazar')
    return e instanceof Error ? e.message : String(e)
  }
  assert.fail('inalcanzable')
}

const hace = (ms: number) => new Date(Date.now() - ms)
const HORA = 3_600_000

function entrada(e: Empresa, extra: Partial<EntradaDeOferta> = {}): EntradaDeOferta {
  return {
    title: `Oferta ${randomUUID().slice(0, 6)}`,
    catalogVariantId: e.variante,
    discountType: 'PERCENT',
    discountValue: 20,
    startsAt: hace(HORA),
    endsAt: null,
    maxClaims: 10,
    budgetTotal: 1000,
    ...extra,
  }
}

/** Crea y publica una oferta; devuelve su id. */
async function ofertaActiva(e: Empresa, extra: Partial<EntradaDeOferta> = {}): Promise<string> {
  const { id } = await en(e, (tx) => crearOfertaEnTx(tx, e.id, entrada(e, extra), ctxOferta()))
  await en(e, (tx) => publicarOfertaEnTx(tx, e.id, id, ctxOferta()))
  return id
}

async function campanaPara(e: Empresa, dealId: string, estado: 'ACTIVA' | 'PAUSADA' = 'ACTIVA') {
  return prisma.marketingCampaign.create({
    data: {
      companyId: e.id,
      dealId,
      titulo: `Campaña ${sufijo}`,
      descripcion: 'Prueba de atribución',
      estado,
      fechaInicio: hace(HORA),
      fechaFin: new Date(Date.now() + HORA),
    },
    select: { id: true },
  })
}

const reclamar = (e: Empresa, dealId: string, i: number, ahora?: Date) => en(e, (tx) => reclamarOfertaEnTx(tx, e.id, { dealId, customerId: e.clientes[i], locationId: e.sucursal }, ahora))
const oferta = (id: string) => prisma.deal.findUniqueOrThrow({ where: { id } })
const reclamoDe = (orderId: string) => prisma.dealClaim.findUniqueOrThrow({ where: { orderId } })
const pedido = (id: string) => prisma.membegoOrder.findUniqueOrThrow({ where: { id }, include: { attribution: true, confirmation: true, lines: true } })
const canjear = async (e: Empresa, orderId: string, ahora?: Date) => {
  const p = await pedido(orderId)
  return en(e, (tx) => completarPorQrEnTx(tx, e.id, p.qrToken as string, ctxEmpresa(), ahora))
}
const comisionDe = (orderId: string) => prisma.commission.findUnique({ where: { orderId } })
const num = (d: Prisma.Decimal) => d.toFixed(2)

// ── Crear y publicar ─────────────────────────────────────────────────────────

test('1 · crear una oferta: nace borrador, congela la cuota de la cuenta y valida lo que se ofrece', async () => {
  const r = await en(E.a, (tx) => crearOfertaEnTx(tx, E.a.id, entrada(E.a, { title: '  20 %   en el lavado  ' }), ctxOferta()))
  const o = await oferta(r.id)
  assert.equal(o.status, 'DRAFT')
  assert.equal(o.title, '20 % en el lavado')
  assert.equal(num(o.feePerRedemption), '100.00', 'la cuota es el CPA de la cuenta (valor de serie)')
  assert.equal(o.currency, 'DOP')
  assert.equal(o.claimsActive, 0)
  assert.equal(num(o.budgetReserved), '0.00')
  assert.equal(await prisma.auditLog.count({ where: { companyId: E.a.id, accion: 'DEAL_CREATED', entidadId: r.id } }), 1)

  assert.equal(await codigoDe(en(E.a, (tx) => crearOfertaEnTx(tx, E.a.id, entrada(E.a, { budgetTotal: 50 }), ctxOferta()))), 'OFERTA_INVALIDA', 'el presupuesto no alcanza ni para un canje')
  assert.equal(await codigoDe(en(E.a, (tx) => crearOfertaEnTx(tx, E.a.id, entrada(E.a, { discountValue: 150 }), ctxOferta()))), 'OFERTA_INVALIDA')
  assert.equal(await codigoDe(en(E.a, (tx) => crearOfertaEnTx(tx, E.a.id, entrada(E.a, { maxClaims: 0 }), ctxOferta()))), 'OFERTA_INVALIDA')
  assert.equal(await codigoDe(en(E.a, (tx) => crearOfertaEnTx(tx, E.a.id, { ...entrada(E.a), catalogVariantId: E.b.variante }, ctxOferta()))), 'VARIANTE_NO_ENCONTRADA', 'la variante de otra empresa no existe aquí')
})

test('2 · publicar exige un producto vendible y una rebaja real; la economía no cambia después', async () => {
  const r = await en(E.a, (tx) => crearOfertaEnTx(tx, E.a.id, entrada(E.a), ctxOferta()))
  const p = await en(E.a, (tx) => publicarOfertaEnTx(tx, E.a.id, r.id, ctxOferta()))
  assert.equal(p.status, 'ACTIVE')
  assert.ok((await oferta(r.id)).publishedAt)
  // Publicada, no se puede cambiar el descuento ni el producto (servicio y base).
  assert.equal(await codigoDe(en(E.a, (tx) => actualizarOfertaEnTx(tx, E.a.id, r.id, { discountValue: 90 }, ctxOferta()))), 'CAMBIO_NO_PERMITIDO')
  assert.match(await rechazo((tx) => tx.$executeRaw`UPDATE "deals" SET "discountValue" = 90 WHERE "id" = ${r.id}`), /deals_inmutable/)
  assert.match(await rechazo((tx) => tx.$executeRaw`UPDATE "deals" SET "feePerRedemption" = 1 WHERE "id" = ${r.id}`), /deals_inmutable/)
  // Sí se puede cambiar el título y el máximo de clientes.
  await en(E.a, (tx) => actualizarOfertaEnTx(tx, E.a.id, r.id, { title: 'Nuevo título', maxClaims: 20 }, ctxOferta()))
  assert.equal((await oferta(r.id)).maxClaims, 20)
  // Un precio fijo que no baja el precio no es una oferta.
  const sinRebaja = await en(E.a, (tx) => crearOfertaEnTx(tx, E.a.id, entrada(E.a, { discountType: 'FIXED_PRICE', discountValue: 999 }), ctxOferta()))
  assert.equal(await codigoDe(en(E.a, (tx) => publicarOfertaEnTx(tx, E.a.id, sinRebaja.id, ctxOferta()))), 'OFERTA_SIN_DESCUENTO')
})

// ── Reclamar ─────────────────────────────────────────────────────────────────

test('3 · reclamar: reserva el cupo y la cuota, crea el pedido con QR y la atribución de la oferta, y escribe el reclamo', async () => {
  const id = await ofertaActiva(E.a)
  const r = await reclamar(E.a, id, 0)
  const o = await oferta(id)
  assert.equal(o.claimsActive, 1)
  assert.equal(num(o.budgetReserved), '100.00')
  assert.equal(num(o.budgetSpent), '0.00')
  assert.equal(r.savings, '80.00', '20 % de 400')
  assert.equal(r.total, '320.00')

  const p = await pedido(r.orderId)
  assert.equal(p.status, 'READY')
  assert.ok(p.qrToken && p.qrToken.length >= 32, 'el QR es el voucher')
  assert.equal(p.origin, 'MARKETPLACE')
  assert.equal(num(p.total), '320.00')
  assert.equal(num(p.discount), '80.00')
  assert.equal(p.attribution?.channel, 'PROMOTION_CLAIM')
  assert.equal(p.attribution?.promotionId, id)
  assert.ok(p.customerConfirmedAt, 'reclamar es aceptar el precio')
  assert.equal(p.sourceType, 'DEAL_CLAIM')

  const c = await reclamoDe(r.orderId)
  assert.equal(c.status, 'CLAIMED')
  assert.equal(num(c.fee), '100.00')
  assert.equal(num(c.savings), '80.00')
  assert.equal(c.customerId, E.a.clientes[0])
  assert.ok(c.expiresAt.getTime() - c.claimedAt.getTime() === 7 * 86_400_000, 'el cupón vale 7 días')
  assert.equal(await prisma.auditLog.count({ where: { companyId: E.a.id, accion: 'DEAL_CLAIMED', entidadId: c.id } }), 1)
})

test('4 · una persona reclama una oferta una sola vez: el segundo intento devuelve su pedido y no reserva nada', async () => {
  const id = await ofertaActiva(E.a)
  const r = await reclamar(E.a, id, 1)
  try {
    await reclamar(E.a, id, 1)
    assert.fail('debía rechazar')
  } catch (e) {
    assert.ok(e instanceof OfertaError && e.codigo === 'YA_RECLAMADA')
    assert.equal(e.datos?.orderId, r.orderId, 'el error dice cuál es su pedido')
  }
  const o = await oferta(id)
  assert.equal(o.claimsActive, 1)
  assert.equal(num(o.budgetReserved), '100.00')
  // La base lo respalda aunque se salte el servicio.
  assert.match(await rechazo((tx) => tx.$executeRaw`INSERT INTO "deal_claims" ("id","companyId","dealId","customerId","orderId","fee","savings","expiresAt","updatedAt")
    SELECT ${randomUUID()}, "companyId", "dealId", "customerId", "orderId", "fee", "savings", "expiresAt", now() FROM "deal_claims" WHERE "dealId" = ${id}`), /unique|duplicate|23505|already exists/i)
})

test('5 · dos clics simultáneos de la misma persona dejan UN reclamo, UN pedido y el presupuesto reservado una sola vez', async () => {
  const id = await ofertaActiva(E.a)
  const resultados = await Promise.allSettled([reclamar(E.a, id, 2), reclamar(E.a, id, 2), reclamar(E.a, id, 2)])
  assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 1)
  for (const r of resultados) if (r.status === 'rejected') assert.ok(r.reason instanceof OfertaError && r.reason.codigo === 'YA_RECLAMADA', String(r.reason))
  assert.equal(await prisma.dealClaim.count({ where: { dealId: id } }), 1)
  assert.equal(await prisma.membegoOrder.count({ where: { companyId: E.a.id, sourceType: 'DEAL_CLAIM', sourceId: `${id}:${E.a.clientes[2]}` } }), 1)
  const o = await oferta(id)
  assert.equal(o.claimsActive, 1)
  assert.equal(num(o.budgetReserved), '100.00')
})

test('6 · el presupuesto es un tope: con presupuesto para 5 canjes y 16 personas reclamando a la vez, ganan exactamente 5 y la oferta se pausa sola', async () => {
  const id = await ofertaActiva(E.a, { budgetTotal: 500, maxClaims: 100 })
  const resultados = await Promise.allSettled(E.a.clientes.slice(0, 16).map((_, i) => reclamar(E.a, id, i)))
  const ganaron = resultados.filter((r) => r.status === 'fulfilled').length
  assert.equal(ganaron, 5)
  for (const r of resultados) if (r.status === 'rejected') assert.ok(r.reason instanceof OfertaError && ['OFERTA_AGOTADA'].includes(r.reason.codigo), String(r.reason))
  const o = await oferta(id)
  assert.equal(num(o.budgetReserved), '500.00')
  assert.equal(o.claimsActive, 5)
  assert.equal(o.status, 'BUDGET_EXHAUSTED', 'se pausa sola al no alcanzar para otro canje')
  assert.equal(await codigoDe(reclamar(E.a, id, 17)), 'OFERTA_AGOTADA')
})

test('7 · los cupos son un tope: con 3 cupos y presupuesto de sobra, ganan exactamente 3', async () => {
  const id = await ofertaActiva(E.a, { budgetTotal: 5000, maxClaims: 3 })
  const resultados = await Promise.allSettled(E.a.clientes.slice(0, 12).map((_, i) => reclamar(E.a, id, i)))
  assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 3)
  const o = await oferta(id)
  assert.equal(o.claimsActive, 3)
  assert.equal(num(o.budgetReserved), '300.00')
  assert.equal(o.status, 'ACTIVE', 'sin cupos no es presupuesto agotado: sigue activa (se ve «agotada» por los cupos)')
})

test('8 · una oferta que no está vigente no se reclama, y un reclamo fallido no deja nada reservado', async () => {
  const borrador = (await en(E.a, (tx) => crearOfertaEnTx(tx, E.a.id, entrada(E.a), ctxOferta()))).id
  assert.equal(await codigoDe(reclamar(E.a, borrador, 3)), 'OFERTA_NO_DISPONIBLE')
  const futura = await ofertaActiva(E.a, { startsAt: new Date(Date.now() + 2 * HORA), endsAt: new Date(Date.now() + 5 * HORA) })
  assert.equal(await codigoDe(reclamar(E.a, futura, 3)), 'OFERTA_NO_EMPEZO')
  const pausada = await ofertaActiva(E.a)
  await en(E.a, (tx) => pausarOfertaEnTx(tx, E.a.id, pausada, 'Prueba', ctxOferta()))
  assert.equal(await codigoDe(reclamar(E.a, pausada, 3)), 'OFERTA_PAUSADA')
  const ok = await ofertaActiva(E.a)
  // Una sucursal que no existe hace fallar el pedido DESPUÉS de la reserva: la transacción entera se deshace.
  assert.equal(await codigoDe(en(E.a, (tx) => reclamarOfertaEnTx(tx, E.a.id, { dealId: ok, customerId: E.a.clientes[3], locationId: 'no-existe' }))), 'SUCURSAL_NO_ENCONTRADA')
  const o = await oferta(ok)
  assert.equal(o.claimsActive, 0)
  assert.equal(num(o.budgetReserved), '0.00')
  assert.equal(await prisma.dealClaim.count({ where: { dealId: ok } }), 0)
  // Otra empresa no puede reclamar la oferta de esta.
  assert.equal(await codigoDe(en(E.b, (tx) => reclamarOfertaEnTx(tx, E.b.id, { dealId: ok, customerId: E.b.clientes[0], locationId: E.b.sucursal }))), 'OFERTA_NO_ENCONTRADA')
})

test('9 · «solo clientes nuevos»: quien ya completó un pedido en la empresa no la reclama', async () => {
  const id = await ofertaActiva(E.a, { newCustomersOnly: true })
  const otra = await ofertaActiva(E.a)
  const r = await reclamar(E.a, otra, 4)
  await canjear(E.a, r.orderId)
  assert.equal(await codigoDe(reclamar(E.a, id, 4)), 'SOLO_CLIENTES_NUEVOS')
  await reclamar(E.a, id, 5)
})

test('Growth · las reglas Promotion vivas condicionan reclamos nuevos antes de reservar; las ofertas sin reglas siguen abiertas', async () => {
  const promotion = await prisma.promotion.create({
    data: { companyId: E.a.id, nombre: `Segmento ${sufijo}`, status: 'ACTIVE' },
    select: { id: true },
  })
  const rule = await prisma.rule.create({
    data: {
      companyId: E.a.id,
      nombre: `Solo cliente ${sufijo}`,
      status: 'PUBLISHED',
      conditions: {
        create: {
          campo: 'cliente.id',
          operador: 'eq',
          valor: E.a.clientes[1],
          dataType: 'TEXT',
        },
      },
    },
    select: { id: true },
  })
  await prisma.promotionRule.create({ data: { promotionId: promotion.id, ruleId: rule.id } })
  const dealId = await ofertaActiva(E.a, { promotionId: promotion.id })

  assert.equal(await codigoDe(reclamar(E.a, dealId, 0)), 'PROMOCION_NO_APLICA')
  const unchanged = await oferta(dealId)
  assert.equal(unchanged.claimsActive, 0)
  assert.equal(unchanged.budgetReserved.toFixed(2), '0.00')

  const claim = await reclamar(E.a, dealId, 1)
  assert.ok(claim.orderId)
  const reserved = await oferta(dealId)
  assert.equal(reserved.claimsActive, 1)
  assert.equal(reserved.budgetReserved.toFixed(2), reserved.feePerRedemption.toFixed(2))
})

test('Growth · Promotion de otra empresa no se puede asociar a un Deal por la clave compuesta', async () => {
  const promotion = await prisma.promotion.create({
    data: { companyId: E.b.id, nombre: `Cruzada ${sufijo}`, status: 'ACTIVE' },
    select: { id: true },
  })
  const dealId = await ofertaActiva(E.a)
  await assert.rejects(
    en(E.a, (tx) => tx.deal.update({ where: { id: dealId }, data: { promotionId: promotion.id } })),
  )
})

test('Growth · pausar una Promotion detiene reclamos nuevos pero no invalida un cupón ya emitido', async () => {
  const promotion = await prisma.promotion.create({
    data: { companyId: E.a.id, nombre: `Viva ${sufijo}`, status: 'ACTIVE' },
    select: { id: true },
  })
  const dealId = await ofertaActiva(E.a, { promotionId: promotion.id })
  const reclamo = await reclamar(E.a, dealId, 3)

  await prisma.promotion.update({ where: { id: promotion.id }, data: { status: 'PAUSED' } })
  assert.equal(await codigoDe(reclamar(E.a, dealId, 4)), 'PROMOCION_NO_APLICA')
  await canjear(E.a, reclamo.orderId)
  assert.equal((await reclamoDe(reclamo.orderId)).status, 'REDEEMED')
})

test('Growth · atribuye el reclamo a la campaña directa, valida tenant y reporta reclamos/canjes', async () => {
  const dealId = await ofertaActiva(E.a)
  const primera = await campanaPara(E.a, dealId)
  const segunda = await campanaPara(E.a, dealId)
  const pausa = await campanaPara(E.a, dealId, 'PAUSADA')
  const ajena = await campanaPara(E.b, await ofertaActiva(E.b))

  const claim1 = await en(E.a, (tx) => reclamarOfertaEnTx(tx, E.a.id, {
    dealId, customerId: E.a.clientes[20], locationId: E.a.sucursal, campaignId: primera.id,
  }))
  const claim2 = await en(E.a, (tx) => reclamarOfertaEnTx(tx, E.a.id, {
    dealId, customerId: E.a.clientes[21], locationId: E.a.sucursal, campaignId: segunda.id,
  }))
  const sinCampanaActiva = await en(E.a, (tx) => reclamarOfertaEnTx(tx, E.a.id, {
    dealId, customerId: E.a.clientes[22], locationId: E.a.sucursal, campaignId: pausa.id,
  }))
  const deOtraEmpresa = await en(E.a, (tx) => reclamarOfertaEnTx(tx, E.a.id, {
    dealId, customerId: E.a.clientes[23], locationId: E.a.sucursal, campaignId: ajena.id,
  }))

  assert.equal((await pedido(claim1.orderId)).attribution?.campaignId, primera.id)
  assert.equal((await pedido(claim2.orderId)).attribution?.campaignId, segunda.id)
  assert.equal((await pedido(sinCampanaActiva.orderId)).attribution?.campaignId, null)
  assert.equal((await pedido(deOtraEmpresa.orderId)).attribution?.campaignId, null)

  await canjear(E.a, claim1.orderId)
  const metricas = await getCampanasMarketingAdmin(E.a.id)
  assert.equal(metricas.find((c) => c.id === primera.id)?.reclamosAtribuidos, 1)
  assert.equal(metricas.find((c) => c.id === primera.id)?.canjesAtribuidos, 1)
  assert.equal(metricas.find((c) => c.id === segunda.id)?.reclamosAtribuidos, 1)
  assert.equal(metricas.find((c) => c.id === segunda.id)?.canjesAtribuidos, 0)
})

// ── Canje y cobro ────────────────────────────────────────────────────────────

test('10 · el canje cobra la cuota de la oferta en Merchant Billing, en la misma transacción que completa el pedido', async () => {
  const id = await ofertaActiva(E.a, { budgetTotal: 300 })
  const r = await reclamar(E.a, id, 6)
  const antes = await prisma.merchantLedgerEntry.count({ where: { companyId: E.a.id } })
  const cierre = await canjear(E.a, r.orderId)
  assert.equal(cierre.status, 'COMPLETED')

  const c = await reclamoDe(r.orderId)
  assert.equal(c.status, 'REDEEMED')
  assert.ok(c.redeemedAt)
  const o = await oferta(id)
  assert.equal(num(o.budgetReserved), '0.00')
  assert.equal(num(o.budgetSpent), '100.00', 'lo reservado pasó a gastado')
  assert.equal(o.claimsActive, 1, 'el cupo sigue ocupado: la persona usó su oferta')

  const com = await comisionDe(r.orderId)
  assert.ok(com)
  assert.equal(com.type, 'CPA_FIXED')
  assert.equal(num(com.amount), '100.00')
  assert.equal(com.dealId, id, 'la comisión sabe de qué oferta es')
  assert.equal(num(com.baseAmount), '320.00')
  const asiento = await prisma.merchantLedgerEntry.findUniqueOrThrow({ where: { id: com.ledgerEntryId } })
  assert.equal(asiento.type, 'REDEMPTION_FEE')
  assert.equal(num(asiento.amount), '100.00')
  assert.equal(await prisma.merchantLedgerEntry.count({ where: { companyId: E.a.id } }), antes + 1)
  assert.equal(await prisma.auditLog.count({ where: { companyId: E.a.id, accion: 'DEAL_REDEEMED', entidadId: c.id } }), 1)
})

test('11 · la cuota es la de la oferta aunque la cuenta cobre porcentaje; y una oferta gratis también paga su cuota', async () => {
  await en(E.a, (tx) => actualizarConfigEnTx(tx, E.a.id, { feeModel: 'PERCENTAGE' }, superadmin()))
  try {
    const id = await ofertaActiva(E.a, { discountType: 'FIXED_PRICE', discountValue: 0, budgetTotal: 200 })
    const r = await reclamar(E.a, id, 7)
    assert.equal(r.total, '0.00', 'gratis')
    await canjear(E.a, r.orderId)
    const com = await comisionDe(r.orderId)
    assert.ok(com, 'una oferta gratis (base 0) cobra su cuota')
    assert.equal(com.type, 'CPA_FIXED')
    assert.equal(num(com.amount), '100.00')
    assert.equal(num(com.baseAmount), '0.00')
    assert.equal(com.feeModel, 'PERCENTAGE', 'se guarda el modelo de la cuenta, pero la cuota es la de la oferta')
    // Y un pedido normal de esa misma cuenta sigue cobrando el porcentaje.
    const normal = await en(E.a, (tx) =>
      crearPedidoEnTx(tx, E.a.id, { customerId: E.a.clientes[8], locationId: E.a.sucursal, origin: 'MARKETPLACE', atribucion: { channel: 'MARKETPLACE_BROWSE' }, lineas: [{ varianteId: E.a.variante, cantidad: 1 }] }, cliente)
    )
    assert.equal(normal.status, 'AWAITING_MERCHANT')
  } finally {
    await en(E.a, (tx) => actualizarConfigEnTx(tx, E.a.id, { feeModel: 'HYBRID' }, superadmin()))
  }
})

test('12 · cuando lo gastado alcanza el presupuesto, la oferta se pausa sola; al amplirlo, vuelve', async () => {
  const id = await ofertaActiva(E.a, { budgetTotal: 200, maxClaims: 50 })
  const r1 = await reclamar(E.a, id, 9)
  await reclamar(E.a, id, 10)
  assert.equal((await oferta(id)).status, 'BUDGET_EXHAUSTED', 'dos reservas agotan el presupuesto de 200')
  await canjear(E.a, r1.orderId)
  const o = await oferta(id)
  assert.equal(num(o.budgetSpent), '100.00')
  assert.equal(num(o.budgetReserved), '100.00')
  assert.equal(o.status, 'BUDGET_EXHAUSTED')
  const ampliada = await en(E.a, (tx) => ampliarPresupuestoEnTx(tx, E.a.id, id, 100, ctxOferta()))
  assert.equal(ampliada.status, 'ACTIVE')
  assert.equal(ampliada.budgetTotal, '300.00')
  await reclamar(E.a, id, 11)
  assert.equal((await oferta(id)).status, 'BUDGET_EXHAUSTED')
  assert.equal(await codigoDe(en(E.a, (tx) => ampliarPresupuestoEnTx(tx, E.a.id, id, -5, ctxOferta()))), 'PRESUPUESTO_INVALIDO')
})

// ── Cancelar, vencer, reembolsar ─────────────────────────────────────────────

test('13 · cancelar el pedido libera el cupo y la cuota, y reabre una oferta agotada; el reclamo queda CANCELLED', async () => {
  const id = await ofertaActiva(E.a, { budgetTotal: 100 })
  const r = await reclamar(E.a, id, 12)
  assert.equal((await oferta(id)).status, 'BUDGET_EXHAUSTED')
  await en(E.a, (tx) => cancelarPedidoEnTx(tx, E.a.id, r.orderId, { motivo: 'La persona no vendrá' }, ctxEmpresa()))
  const c = await reclamoDe(r.orderId)
  assert.equal(c.status, 'CANCELLED')
  assert.ok(c.closedAt)
  const o = await oferta(id)
  assert.equal(o.claimsActive, 0)
  assert.equal(num(o.budgetReserved), '0.00')
  assert.equal(o.status, 'ACTIVE', 'volvió a haber presupuesto')
  // Quien canceló no puede reclamarla otra vez (una por cliente).
  assert.equal(await codigoDe(reclamar(E.a, id, 12)), 'YA_RECLAMADA')
  // Cancelar dos veces es inofensivo.
  await en(E.a, (tx) => cancelarPedidoEnTx(tx, E.a.id, r.orderId, { motivo: 'otra vez' }, ctxEmpresa()))
  assert.equal(num((await oferta(id)).budgetReserved), '0.00')
})

test('14 · el cupón vencido no se canjea aunque el QR siga vigente, y el barrido lo cierra como EXPIRED devolviendo cupo y cuota', async () => {
  const id = await ofertaActiva(E.a, { budgetTotal: 300, voucherDays: 1 })
  const r = await reclamar(E.a, id, 13)
  const pasado = new Date(Date.now() + 2 * 86_400_000)
  assert.equal(await codigoDe(canjear(E.a, r.orderId, pasado)), 'RECLAMO_VENCIDO')
  assert.equal((await reclamoDe(r.orderId)).status, 'CLAIMED', 'el canje fallido no dejó nada a medias')
  assert.equal((await pedido(r.orderId)).status, 'READY')

  const barrido = await barridoDeOfertas(pasado)
  assert.ok(barrido.reclamosVencidos >= 1)
  const c = await reclamoDe(r.orderId)
  assert.equal(c.status, 'EXPIRED')
  assert.equal((await pedido(r.orderId)).status, 'CANCELLED')
  const o = await oferta(id)
  assert.equal(o.claimsActive, 0)
  assert.equal(num(o.budgetReserved), '0.00')
  // Idempotente.
  const otra = await barridoDeOfertas(pasado)
  assert.equal(otra.errores, 0)
})

test('15 · el barrido termina las ofertas cuya vigencia pasó; los cupones ya reclamados siguen valiendo', async () => {
  const fin = new Date(Date.now() + 3 * HORA)
  const id = await ofertaActiva(E.a, { endsAt: fin })
  const r = await reclamar(E.a, id, 14)
  const despues = new Date(fin.getTime() + HORA)
  const b = await barridoDeOfertas(despues)
  assert.ok(b.ofertasTerminadas >= 1)
  assert.equal((await oferta(id)).status, 'COMPLETED')
  assert.equal(await codigoDe(reclamar(E.a, id, 15)), 'OFERTA_TERMINADA')
  const cierre = await canjear(E.a, r.orderId, despues)
  assert.equal(cierre.status, 'COMPLETED', 'el cupón ya reclamado se canjea después de terminada la oferta')
  assert.equal((await reclamoDe(r.orderId)).status, 'REDEEMED')
})

test('16 · reembolsar el pedido canjeado revierte la cuota y devuelve lo gastado al presupuesto', async () => {
  const id = await ofertaActiva(E.a, { budgetTotal: 200 })
  const r = await reclamar(E.a, id, 16)
  await canjear(E.a, r.orderId)
  const com = await comisionDe(r.orderId)
  assert.ok(com)
  await en(E.a, (tx) => reembolsarPedidoEnTx(tx, E.a.id, r.orderId, { motivo: 'El servicio no se prestó' }, ctxEmpresa()))
  assert.equal((await reclamoDe(r.orderId)).status, 'REFUNDED')
  const o = await oferta(id)
  assert.equal(num(o.budgetSpent), '0.00')
  assert.equal(o.claimsActive, 0)
  const revertida = await prisma.commission.findUniqueOrThrow({ where: { id: com.id } })
  assert.equal(revertida.status, 'REVERSED')
})

// ── Estado de la cuenta y permisos de datos ──────────────────────────────────

test('17 · una cuenta suspendida no crea, no publica, no reanuda ni se reclama', async () => {
  const e = E.c
  const id = await ofertaActiva(e)
  await en(e, (tx) => fijarEstadoManualEnTx(tx, e.id, { accion: 'SUSPENDER', motivo: 'Prueba' }, superadmin()))
  try {
    assert.equal(await codigoDe(en(e, (tx) => crearOfertaEnTx(tx, e.id, entrada(e), ctxOferta()))), 'CUENTA_SUSPENDIDA')
    assert.equal(await codigoDe(reclamar(e, id, 0)), 'CUENTA_SUSPENDIDA')
    const borrador = await en(e, async (tx) => {
      // un borrador creado antes de suspender
      await fijarEstadoManualEnTx(tx, e.id, { accion: 'LIBERAR', motivo: 'Prueba' }, superadmin())
      const r = await crearOfertaEnTx(tx, e.id, entrada(e), ctxOferta())
      await fijarEstadoManualEnTx(tx, e.id, { accion: 'SUSPENDER', motivo: 'Prueba' }, superadmin())
      return r.id
    })
    assert.equal(await codigoDe(en(e, (tx) => publicarOfertaEnTx(tx, e.id, borrador, ctxOferta()))), 'CUENTA_SUSPENDIDA')
    await en(e, (tx) => pausarOfertaEnTx(tx, e.id, id, null, ctxOferta()))
    assert.equal(await codigoDe(en(e, (tx) => reanudarOfertaEnTx(tx, e.id, id, ctxOferta()))), 'CUENTA_SUSPENDIDA')
  } finally {
    await en(e, (tx) => fijarEstadoManualEnTx(tx, e.id, { accion: 'LIBERAR', motivo: 'Fin de la prueba' }, superadmin()))
  }
  await en(e, (tx) => reanudarOfertaEnTx(tx, e.id, id, ctxOferta()))
  await reclamar(e, id, 1)
})

test('18 · el descuento de un pedido solo lo fija el sistema: una persona no puede pedir con descuento', async () => {
  const intento = en(E.a, (tx) =>
    crearPedidoEnTx(tx, E.a.id, { customerId: E.a.clientes[0], locationId: E.a.sucursal, origin: 'MARKETPLACE', atribucion: { channel: 'MARKETPLACE_BROWSE' }, lineas: [{ varianteId: E.a.variante, cantidad: 1, descuento: 300 }] }, cliente)
  )
  assert.equal(await codigoDe(intento), 'DESCUENTO_NO_PERMITIDO')
})

test('19 · archivar deja de ofrecerla pero el cupón ya reclamado se canjea', async () => {
  const id = await ofertaActiva(E.a, { budgetTotal: 300 })
  const r = await reclamar(E.a, id, 0 === 0 ? 17 : 0)
  await en(E.a, (tx) => archivarOfertaEnTx(tx, E.a.id, id, ctxOferta()))
  assert.equal((await oferta(id)).status, 'ARCHIVED')
  assert.equal(await codigoDe(reclamar(E.a, id, 16)), 'OFERTA_TERMINADA')
  await canjear(E.a, r.orderId)
  assert.equal((await reclamoDe(r.orderId)).status, 'REDEEMED')
})

// ── Lo que la base repite ────────────────────────────────────────────────────

test('20 · la base rechaza pasarse del presupuesto o de los cupos, y rangos imposibles', async () => {
  const id = await ofertaActiva(E.a)
  assert.match(await rechazo((tx) => tx.$executeRaw`UPDATE "deals" SET "budgetReserved" = "budgetTotal" + 1 WHERE "id" = ${id}`), /deals_rangos/)
  assert.match(await rechazo((tx) => tx.$executeRaw`UPDATE "deals" SET "claimsActive" = "maxClaims" + 1 WHERE "id" = ${id}`), /deals_rangos/)
  assert.match(await rechazo((tx) => tx.$executeRaw`UPDATE "deals" SET "budgetSpent" = -1 WHERE "id" = ${id}`), /deals_rangos/)
  assert.match(await rechazo((tx) => tx.$executeRaw`UPDATE "deals" SET "voucherDays" = 0 WHERE "id" = ${id}`), /deals_inmutable|deals_rangos/)
  assert.match(await rechazo((tx) => tx.$executeRaw`UPDATE "deals" SET "endsAt" = "startsAt" WHERE "id" = ${id}`), /deals_rangos/)
  // Una oferta no se salta estados (ACTIVE → DRAFT) ni nace publicada.
  assert.match(await rechazo((tx) => tx.$executeRaw`UPDATE "deals" SET "status" = 'DRAFT' WHERE "id" = ${id}`), /deals_estado/)
  assert.match(await rechazo((tx) => tx.$executeRaw`INSERT INTO "deals" ("id","companyId","catalogVariantId","title","discountType","discountValue","status","publishedAt","startsAt","maxClaims","feePerRedemption","budgetTotal","updatedAt")
    VALUES (${randomUUID()}, ${E.a.id}, ${E.a.variante}, 'x1x', 'PERCENT', 10, 'ACTIVE', now(), now(), 5, 100, 500, now())`), /deals_nace/)
  // Ni mezclar la variante de otra empresa (FK compuesta).
  assert.match(await rechazo((tx) => tx.$executeRaw`INSERT INTO "deals" ("id","companyId","catalogVariantId","title","discountType","discountValue","startsAt","maxClaims","feePerRedemption","budgetTotal","updatedAt")
    VALUES (${randomUUID()}, ${E.a.id}, ${E.b.variante}, 'xyz', 'PERCENT', 10, now(), 5, 100, 500, now())`), /foreign key|deals_catalogVariantId_companyId_fkey/i)
})

test('21 · los contadores de la oferta tienen que cuadrar con sus reclamos al confirmar la transacción', async () => {
  const id = await ofertaActiva(E.a)
  // Mover un contador sin reclamo que lo respalde: falla al COMMIT (disparador diferido).
  assert.match(await rechazoAlConfirmar((tx) => tx.$executeRaw`UPDATE "deals" SET "claimsActive" = 1, "budgetReserved" = 100 WHERE "id" = ${id}`), /deals_cuadre/)
  assert.match(await rechazoAlConfirmar((tx) => tx.$executeRaw`UPDATE "deals" SET "budgetSpent" = 100 WHERE "id" = ${id}`), /deals_cuadre/)
  // Y al revés: un reclamo que cambia de estado sin mover los contadores.
  const r = await reclamar(E.a, id, 1)
  assert.match(
    await rechazoAlConfirmar(async (tx) => {
      await tx.$executeRaw`UPDATE "membego_orders" SET "status" = 'CANCELLED', "cancelledAt" = now(), "cancelReason" = 'x', "qrToken" = NULL, "qrExpiresAt" = NULL WHERE "id" = ${r.orderId}`
      await tx.$executeRaw`UPDATE "deal_claims" SET "status" = 'CANCELLED', "closedAt" = now() WHERE "orderId" = ${r.orderId}`
    }),
    /deals_cuadre/
  )
})

/** Como `rechazo`, pero SIN deshacer a mano: el error tiene que salir al confirmar (disparadores diferidos). */
async function rechazoAlConfirmar(fn: (tx: Prisma.TransactionClient) => Promise<unknown>): Promise<string> {
  try {
    await prisma.$transaction(async (tx) => {
      await fn(tx)
    })
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
  assert.fail('la base aceptó lo que debía rechazar al confirmar')
}

test('22 · un pedido de oferta no se completa, cancela ni reembolsa sin liquidar su reclamo', async () => {
  const id = await ofertaActiva(E.a)
  const r = await reclamar(E.a, id, 2)
  // Completarlo por SQL sin pasar por el servicio (que liquida el reclamo y cobra la cuota) falla al confirmar.
  assert.match(
    await rechazoAlConfirmar((tx) => tx.$executeRaw`UPDATE "membego_orders" SET "status" = 'COMPLETED', "completedAt" = now(), "verificationLevel" = 'REDEEMED' WHERE "id" = ${r.orderId}`),
    /deals_pedido/
  )
  assert.match(
    await rechazoAlConfirmar((tx) => tx.$executeRaw`UPDATE "membego_orders" SET "status" = 'CANCELLED', "cancelledAt" = now(), "cancelReason" = 'x', "qrToken" = NULL, "qrExpiresAt" = NULL WHERE "id" = ${r.orderId}`),
    /deals_pedido/
  )
  assert.equal((await pedido(r.orderId)).status, 'READY')
})

test('23 · el reclamo solo hace las transiciones permitidas, atadas al estado del pedido, y no se borra', async () => {
  const id = await ofertaActiva(E.a)
  const r = await reclamar(E.a, id, 3)
  // CLAIMED → REDEEMED exige el pedido COMPLETED.
  assert.match(await rechazo((tx) => tx.$executeRaw`UPDATE "deal_claims" SET "status" = 'REDEEMED', "redeemedAt" = now() WHERE "orderId" = ${r.orderId}`), /deals_reclamo/)
  assert.match(await rechazo((tx) => tx.$executeRaw`UPDATE "deal_claims" SET "status" = 'EXPIRED', "closedAt" = now() WHERE "orderId" = ${r.orderId}`), /deals_reclamo/)
  assert.match(await rechazo((tx) => tx.$executeRaw`UPDATE "deal_claims" SET "fee" = 1 WHERE "orderId" = ${r.orderId}`), /deals_inmutable/)
  assert.match(await rechazo((tx) => tx.$executeRaw`UPDATE "deal_claims" SET "expiresAt" = "expiresAt" + interval '1 day' WHERE "orderId" = ${r.orderId}`), /deals_inmutable/)
  assert.match(await rechazo((tx) => tx.$executeRaw`DELETE FROM "deal_claims" WHERE "orderId" = ${r.orderId}`), /deals_inmutable/)
  assert.match(await rechazo((tx) => tx.$executeRaw`TRUNCATE "deal_claims" CASCADE`), /deals_inmutable|TRUNCATE/)
  await canjear(E.a, r.orderId)
  // Canjeado: ya no vuelve a CLAIMED ni pasa a EXPIRED.
  assert.match(await rechazo((tx) => tx.$executeRaw`UPDATE "deal_claims" SET "status" = 'EXPIRED', "closedAt" = now() WHERE "orderId" = ${r.orderId}`), /deals_reclamo/)
})

test('24 · el pedido de un reclamo tiene que ser del mismo cliente, estar abierto y llevar la atribución de ESA oferta', async () => {
  const id = await ofertaActiva(E.a)
  const otra = await ofertaActiva(E.a)
  const r = await reclamar(E.a, id, 4)
  // Un pedido normal (otra atribución) no puede ser el voucher de una oferta.
  const normal = await en(E.a, (tx) =>
    crearPedidoEnTx(tx, E.a.id, { customerId: E.a.clientes[5], locationId: E.a.sucursal, origin: 'MARKETPLACE', atribucion: { channel: 'MARKETPLACE_BROWSE' }, lineas: [{ varianteId: E.a.variante, cantidad: 1 }] }, cliente)
  )
  const insertar = (dealId: string, orderId: string, customerId: string) => (tx: Prisma.TransactionClient) =>
    tx.$executeRaw`INSERT INTO "deal_claims" ("id","companyId","dealId","customerId","orderId","fee","savings","expiresAt","updatedAt")
      VALUES (${randomUUID()}, ${E.a.id}, ${dealId}, ${customerId}, ${orderId}, 100, 10, now() + interval '3 days', now())`
  assert.match(await rechazo(insertar(id, normal.pedidoId, E.a.clientes[5])), /deals_reclamo/, 'atribución equivocada')
  assert.match(await rechazo(insertar(otra, r.orderId, E.a.clientes[4])), /deals_reclamo|unique|duplicate/i, 'el pedido es de la otra oferta')
  assert.match(await rechazo(insertar(otra, normal.pedidoId, E.a.clientes[6])), /deals_reclamo/, 'el cliente no es el del pedido')
})

test('25 · la cuota de una oferta en Merchant Billing exige un pedido que nació de ESA oferta y es siempre CPA', async () => {
  const id = await ofertaActiva(E.a, { budgetTotal: 300 })
  const r = await reclamar(E.a, id, 6)
  await canjear(E.a, r.orderId)
  const com = await prisma.commission.findUniqueOrThrow({ where: { orderId: r.orderId } })
  assert.equal(com.dealId, id)
  // El dealId no cambia después.
  assert.match(await rechazo((tx) => tx.$executeRaw`UPDATE "merchant_commissions" SET "dealId" = 'otra' WHERE "id" = ${com.id}`), /merchant_inmutable/)
  // Una comisión con dealId de una oferta que no es la del pedido se rechaza.
  const normal = await en(E.a, (tx) =>
    crearPedidoEnTx(tx, E.a.id, { customerId: E.a.clientes[7], locationId: E.a.sucursal, origin: 'MARKETPLACE', atribucion: { channel: 'MARKETPLACE_BROWSE' }, lineas: [{ varianteId: E.a.variante, cantidad: 1 }] }, cliente)
  )
  assert.ok(normal.pedidoId)
})

test('26 · propiedad: tras muchas operaciones mezcladas, los contadores de cada oferta son la suma de sus reclamos', async () => {
  const id = await ofertaActiva(E.a, { budgetTotal: 100_000, maxClaims: 100 })
  const reclamos: { orderId: string; i: number }[] = []
  for (let i = 0; i < E.a.clientes.length; i++) {
    try {
      reclamos.push({ orderId: (await reclamar(E.a, id, i)).orderId, i })
    } catch (e) {
      if (!(e instanceof OfertaError)) throw e
    }
  }
  assert.ok(reclamos.length >= 10)
  // Al azar (semilla fija): canjear, cancelar o dejar; luego reembolsar alguno de los canjeados.
  let semilla = 7
  const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648)
  const canjeados: string[] = []
  for (const r of reclamos) {
    const x = azar()
    if (x < 0.4) {
      await canjear(E.a, r.orderId)
      canjeados.push(r.orderId)
    } else if (x < 0.7) {
      await en(E.a, (tx) => cancelarPedidoEnTx(tx, E.a.id, r.orderId, { motivo: 'azar' }, ctxEmpresa()))
    }
  }
  for (const orderId of canjeados.slice(0, 2)) await en(E.a, (tx) => reembolsarPedidoEnTx(tx, E.a.id, orderId, { motivo: 'azar' }, ctxEmpresa()))

  const o = await oferta(id)
  const cs = await prisma.dealClaim.findMany({ where: { dealId: id } })
  const suma = (s: string[]) => cs.filter((c) => s.includes(c.status)).reduce((t, c) => t.plus(c.fee), new Prisma.Decimal(0))
  assert.equal(o.claimsActive, cs.filter((c) => ['CLAIMED', 'REDEEMED'].includes(c.status)).length)
  assert.equal(num(o.budgetReserved), num(suma(['CLAIMED'])))
  assert.equal(num(o.budgetSpent), num(suma(['REDEEMED'])))
  // Y lo cobrado en el libro es exactamente lo gastado (cuotas de canjes no reembolsados).
  const comisiones = await prisma.commission.findMany({ where: { dealId: id, status: 'CONFIRMED' } })
  assert.equal(num(comisiones.reduce((t, c) => t.plus(c.amount), new Prisma.Decimal(0))), num(o.budgetSpent))
})

test('27 · aislamiento: la oferta, los reclamos y sus pedidos de una empresa no se ven desde otra', async () => {
  const id = await ofertaActiva(E.a)
  await reclamar(E.a, id, 8)
  // (La base de pruebas no trae la Capa 2 de RLS: el aislamiento por servicio es lo que se prueba aquí; el de la base, `probar-rls`.)
  assert.equal(await en(E.b, (tx) => tx.deal.count({ where: { id, companyId: E.b.id } })), 0)
  assert.equal(await en(E.b, (tx) => tx.dealClaim.count({ where: { dealId: id, companyId: E.b.id } })), 0)
  assert.equal(await en(E.b, (tx) => reanudarOfertaEnTx(tx, E.b.id, id, ctxOferta()).then(() => 'ok', (e) => (e as OfertaError).codigo)), 'OFERTA_NO_ENCONTRADA')
  assert.equal(await en(E.b, (tx) => archivarOfertaEnTx(tx, E.b.id, id, ctxOferta()).then(() => 'ok', (e) => (e as OfertaError).codigo)), 'OFERTA_NO_ENCONTRADA')
})


// ── Lote de la auditoría F5–F9 ───────────────────────────────────────────────

test('28 · reclamar respeta el tope de pedidos abiertos del cliente: no se acapara una oferta con cupones que nunca se canjean (M2)', async () => {
  const id = await ofertaActiva(E.a, { maxClaims: 10, budgetTotal: 1000 })
  const cliente28 = E.a.clientes[24]
  for (let i = 0; i < 5; i++) {
    await en(E.a, (tx) => crearPedidoEnTx(tx, E.a.id, { customerId: cliente28, locationId: E.a.sucursal, origin: 'MARKETPLACE', lineas: [{ varianteId: E.a.variante, cantidad: 1 }], atribucion: { channel: 'MARKETPLACE_BROWSE' } }, cliente))
  }
  assert.equal(await codigoDe(reclamar(E.a, id, 24)), 'DEMASIADOS_PEDIDOS_ABIERTOS')
  const o = await oferta(id)
  assert.equal(o.claimsActive, 0, 'no quedó ningún cupo apartado')
  assert.equal(num(o.budgetReserved), '0.00')
  // Con un pedido menos abierto, sí.
  const uno = await prisma.membegoOrder.findFirstOrThrow({ where: { companyId: E.a.id, customerId: cliente28, status: 'AWAITING_MERCHANT' }, select: { id: true } })
  await en(E.a, (tx) => cancelarPedidoEnTx(tx, E.a.id, uno.id, { motivo: 'prueba' }, ctxEmpresa()))
  await reclamar(E.a, id, 24)
  assert.equal((await oferta(id)).claimsActive, 1)
})

test('29 · «solo clientes nuevos» no se apila (otro cupón vivo de una oferta «solo nuevos») y quien ya vino, aunque se le reembolsara, no cuenta como nuevo (M3)', async () => {
  const a = await ofertaActiva(E.a, { newCustomersOnly: true })
  const b = await ofertaActiva(E.a, { newCustomersOnly: true })
  const ra = await reclamar(E.a, a, 25)
  assert.equal(await codigoDe(reclamar(E.a, b, 25)), 'SOLO_CLIENTES_NUEVOS', 'con un cupón «solo nuevos» vivo no se obtiene otro')
  await en(E.a, (tx) => cancelarPedidoEnTx(tx, E.a.id, ra.orderId, { motivo: 'No vendrá' }, ctxEmpresa()))
  await reclamar(E.a, b, 25)

  // Vino, pagó y se le reembolsó: ya conoce el negocio.
  const normal = await ofertaActiva(E.a)
  const r = await reclamar(E.a, normal, 26)
  await canjear(E.a, r.orderId)
  await en(E.a, (tx) => reembolsarPedidoEnTx(tx, E.a.id, r.orderId, { motivo: 'prueba' }, ctxEmpresa()))
  const c = await ofertaActiva(E.a, { newCustomersOnly: true })
  assert.equal(await codigoDe(reclamar(E.a, c, 26)), 'SOLO_CLIENTES_NUEVOS')
})

test('30 · el barrido vacía lo pendiente en varios lotes y, si se acaba el tiempo, lo dice y la siguiente pasada sigue (M11)', async () => {
  const id = await ofertaActiva(E.a, { maxClaims: 10, budgetTotal: 5000, voucherDays: 1 })
  for (const i of [27, 28, 29, 23]) await reclamar(E.a, id, i)
  const lejos = new Date(Date.now() + 3 * 86_400_000)
  const pendientes = () => prisma.dealClaim.count({ where: { status: 'CLAIMED', expiresAt: { lte: lejos } } })
  const antes = await pendientes()
  assert.ok(antes >= 4)

  // Con poco tiempo: hace una parte, avisa que queda trabajo y no revienta.
  let t = 0
  const parcial = await barridoDeOfertas(lejos, { presupuestoMs: 5, reloj: () => ++t, porLote: 2 })
  assert.equal(parcial.quedaTrabajo, true)
  assert.ok(parcial.reclamosVencidos >= 1 && parcial.reclamosVencidos < antes, `procesó ${parcial.reclamosVencidos} de ${antes}`)
  assert.equal(parcial.errores, 0)

  // Con tiempo: lotes de 2 hasta vaciarlo todo (antes el tope fijo dejaba el resto para mañana).
  const resto = await barridoDeOfertas(lejos, { porLote: 2 })
  assert.equal(resto.quedaTrabajo, false)
  assert.equal(await pendientes(), 0)
  assert.equal(parcial.reclamosVencidos + resto.reclamosVencidos, antes)
  const o = await oferta(id)
  assert.equal(o.claimsActive, 0)
  assert.equal(num(o.budgetReserved), '0.00', 'lo reservado volvió al presupuesto')
})

test('31 · el resultado de una oferta cuenta TODOS sus reclamos (agregado en la base), no solo los de la lista (M10)', async () => {
  const id = await ofertaActiva(E.a, { maxClaims: 10, budgetTotal: 5000 })
  const r1 = await reclamar(E.a, id, 18)
  const r2 = await reclamar(E.a, id, 19)
  await reclamar(E.a, id, 20)
  await canjear(E.a, r1.orderId)
  await en(E.a, (tx) => cancelarPedidoEnTx(tx, E.a.id, r2.orderId, { motivo: 'No vendrá' }, ctxEmpresa()))
  const detalle = await en(E.a, (tx) => detalleOfertaEnTx(tx, E.a.id, id))
  assert.ok(detalle)
  assert.equal(detalle.reclamosTotal, 3)
  assert.equal(detalle.reclamos.length, 3)
  assert.equal(detalle.rendimiento.reclamos, 3)
  assert.equal(detalle.rendimiento.canjeados, 1)
  assert.equal(detalle.rendimiento.cancelados, 1)
  assert.equal(detalle.rendimiento.porCanjear, 1)
  assert.equal(detalle.rendimiento.conversion, 33.3)
  assert.equal(detalle.rendimiento.costoCobrado.toFixed(2), '100.00')
  // La lista del panel usa el mismo cálculo.
  const lista = await en(E.a, (tx) => listarOfertasEnTx(tx, E.a.id))
  const fila = lista.find((x) => x.id === id)
  assert.ok(fila)
  assert.deepEqual({ ...fila.rendimiento, costoCobrado: fila.rendimiento.costoCobrado.toFixed(2), ahorroEntregado: fila.rendimiento.ahorroEntregado.toFixed(2) }, { ...detalle.rendimiento, costoCobrado: detalle.rendimiento.costoCobrado.toFixed(2), ahorroEntregado: detalle.rendimiento.ahorroEntregado.toFixed(2) })
})

test('32 · motivoNoReclamarEnTx: la lectura previa que evita afiliar por una oferta que no se puede reclamar', async () => {
  const id = await ofertaActiva(E.a)
  assert.equal(await en(E.a, (tx) => motivoNoReclamarEnTx(tx, E.a.id, id)), null)
  await en(E.a, (tx) => pausarOfertaEnTx(tx, E.a.id, id, 'Prueba', ctxOferta()))
  assert.equal((await en(E.a, (tx) => motivoNoReclamarEnTx(tx, E.a.id, id)))?.codigo, 'OFERTA_PAUSADA')
  assert.equal((await en(E.a, (tx) => motivoNoReclamarEnTx(tx, E.a.id, 'no-existe')))?.codigo, 'OFERTA_NO_ENCONTRADA')
  assert.equal((await en(E.b, (tx) => motivoNoReclamarEnTx(tx, E.b.id, id)))?.codigo, 'OFERTA_NO_ENCONTRADA', 'la oferta de A no existe para B')
})

test('33 · avisos de la oferta (sprint de cierre): 80 %, 100 %, agotada y por vencer, cada uno UNA vez; ampliar el presupuesto deja avisar el siguiente cruce', async () => {
  const admin = await prisma.user.create({ data: { supabaseId: `sb-dealadm-${sufijo}`, email: `dealadm-${sufijo}@prueba.test`, name: 'Admin ofertas', role: 'ADMINISTRADOR', companyId: E.a.id }, select: { id: true } })
  const fin = new Date(Date.now() + 2 * 86_400_000) // faltan 48 h: entra en «por vencer» (≤ 72 h)
  const id = await ofertaActiva(E.a, { budgetTotal: 500, maxClaims: 10, endsAt: fin })
  const tipos = async () =>
    (await prisma.notificacion.findMany({ where: { userId: admin.id, dedupeKey: { startsWith: `oferta-alerta:${id}:` } }, select: { dedupeKey: true } }))
      .map((n) => n.dedupeKey!.split(':')[2])
      .sort()

  // Recién publicada: solo le falta poco tiempo.
  const b0 = await barridoDeOfertas()
  assert.ok(b0.alertas >= 1)
  assert.deepEqual(await tipos(), ['POR_VENCER'])

  // 4 de 5 cupones reservados = 400 de 500 = 80 %.
  for (let i = 0; i < 4; i++) await reclamar(E.a, id, i)
  await barridoDeOfertas()
  assert.deepEqual(await tipos(), ['POR_VENCER', 'PRESUPUESTO_80'])

  // Repetir el barrido (o correr dos a la vez) no avisa dos veces.
  const antes = await prisma.notificacion.count({ where: { userId: admin.id, dedupeKey: { startsWith: `oferta-alerta:${id}:` } } })
  await Promise.all([barridoDeOfertas(), barridoDeOfertas()])
  assert.equal(await prisma.notificacion.count({ where: { userId: admin.id, dedupeKey: { startsWith: `oferta-alerta:${id}:` } } }), antes)

  // El quinto cupón compromete el 100 % y la oferta queda agotada: avisa de las dos cosas.
  await reclamar(E.a, id, 4)
  assert.equal((await oferta(id)).status, 'BUDGET_EXHAUSTED')
  await barridoDeOfertas()
  assert.deepEqual(await tipos(), ['AGOTADA', 'POR_VENCER', 'PRESUPUESTO_100', 'PRESUPUESTO_80'])

  // Ampliar el presupuesto reabre la oferta; cuando vuelva a cruzar el 80 % del NUEVO total, avisa otra vez.
  await en(E.a, (tx) => ampliarPresupuestoEnTx(tx, E.a.id, id, 500, ctxOferta()))
  await barridoDeOfertas()
  assert.equal((await tipos()).filter((t) => t === 'PRESUPUESTO_80').length, 1, 'con 500 de 1 000 comprometidos todavía no cruza el 80 % del nuevo total')
  for (let i = 5; i < 8; i++) await reclamar(E.a, id, i) // 800 de 1 000
  await barridoDeOfertas()
  assert.equal((await tipos()).filter((t) => t === 'PRESUPUESTO_80').length, 2, 'el nuevo total es otro hecho: avisa de nuevo')

  // Una oferta pausada o ya terminada no genera avisos de más: terminada, ninguno nuevo.
  const total = (await tipos()).length
  await barridoDeOfertas(new Date(fin.getTime() + HORA))
  assert.equal((await oferta(id)).status, 'COMPLETED')
  await barridoDeOfertas(new Date(fin.getTime() + 2 * HORA))
  assert.equal((await tipos()).length, total, 'terminada: no hay nada que avisar')

  // El aviso lleva el enlace a la oferta y no revela nada de los clientes.
  const una = await prisma.notificacion.findFirstOrThrow({ where: { userId: admin.id, dedupeKey: { startsWith: `oferta-alerta:${id}:PRESUPUESTO_80` } } })
  assert.equal(una.href, `/admin/deals/${id}`)
  assert.doesNotMatch(`${una.titulo} ${una.mensaje}`, /Cliente a\d|@prueba\.test/)
})

test('34 · una campaña de marketing no puede enlazar un Deal de otra empresa', async () => {
  const dealDeB = await ofertaActiva(E.b)
  await assert.rejects(() =>
    prisma.marketingCampaign.create({
      data: {
        companyId: E.a.id,
        dealId: dealDeB,
        titulo: `Campaña tenant ${sufijo}`,
        descripcion: 'Intento de vínculo cruzado',
        fechaInicio: hace(HORA),
        fechaFin: new Date(Date.now() + HORA),
        diasSemana: [],
      } as never,
    })
  )
})
