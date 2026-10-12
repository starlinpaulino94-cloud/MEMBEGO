import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Prisma, type MembegoVerificationLevel, type MerchantFeeModel } from '@prisma/client'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa, sinEmpresa } from '../../src/lib/tenant'
import { cambiarEstadoItemEnTx, crearItemEnTx } from '../../src/modules/catalog/service'
import { FacturacionError } from '../../src/modules/billing/errores'
import { PedidoError } from '../../src/modules/orders/errores'
import {
  aceptarPedidoEnTx,
  ajustarMontoEnTx,
  cerrarPedidoExternoEnTx,
  completarPorQrEnTx,
  confirmarMontoEnTx,
  crearPedidoEnTx,
  marcarListoEnTx,
  reembolsarPedidoEnTx,
  registrarPagoEnTx,
  verificarPagoExternamenteEnTx,
  type ContextoPedido,
} from '../../src/modules/orders/service'
import {
  SISTEMA,
  actualizarConfigEnTx,
  ajustarComisionPorVerificacionEnTx,
  asentarManualEnTx,
  fijarEstadoManualEnTx,
  generarCorteEnTx,
  generarCortesPendientesEnTx,
  periodosPendientesEnTx,
  registrarComisionDePedidoEnTx,
  revertirComisionDePedidoEnTx,
  saldoEnTx,
  type ContextoFacturacion,
} from '../../src/modules/billing/service'
import { DIAS_DE_GRACIA, TIPOS_QUE_RESTAN, TIPOS_QUE_SUMAN, periodoDe, tipoDeComision } from '../../src/modules/billing/domain'
import { barridoFacturacion } from '../../src/modules/billing/barrido'
import { listarCuentasEnTx } from '../../src/modules/billing/queries'
import { ofertaSupplyDePrueba } from './oferta-supply'

/**
 * COMMERCE CORE · Merchant Billing contra PostgreSQL de verdad (Fase 4).
 *
 * Lo que solo se puede comprobar aquí:
 *
 *  · que el libro de la cuenta es APPEND-ONLY (ni UPDATE, ni DELETE, ni TRUNCATE) y
 *    que la base rechaza un saldo o una posición equivocados, un monto con el signo
 *    que no corresponde a su tipo y cualquier referencia que no sea de este dominio;
 *  · que la comisión coincide con su asiento y con el pedido, que nunca nace de un
 *    pedido de Supply y que solo se revierte con el pedido reembolsado;
 *  · que el dominio y la base dicen lo mismo sobre CPA vs porcentaje (3 modelos × 5
 *    niveles de verificación);
 *  · que el cierre del pedido cobra la comisión en la MISMA transacción, y que el
 *    reembolso la revierte con un asiento contrario;
 *  · que muchas escrituras simultáneas a una cuenta dejan posiciones 1…n sin huecos y
 *    el saldo exacto, y que un pedido tiene una sola comisión aunque lo cierren y lo
 *    barran a la vez;
 *  · el límite de crédito (gracia, suspensión, retención manual) y los cortes
 *    (idempotentes, sin huecos, con saldo arrastrado).
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const T0 = new Date('2030-01-01T10:00:00.000Z')
const dias = (n: number) => new Date(T0.getTime() + n * 86_400_000)

type Empresa = { id: string; sucursal: string; cliente: string; servicio: string }
const E: Record<'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i', Empresa> = {
  a: { id: '', sucursal: '', cliente: '', servicio: '' },
  b: { id: '', sucursal: '', cliente: '', servicio: '' },
  c: { id: '', sucursal: '', cliente: '', servicio: '' },
  d: { id: '', sucursal: '', cliente: '', servicio: '' },
  e: { id: '', sucursal: '', cliente: '', servicio: '' },
  /** Solo para pedidos huérfanos de las pruebas de reglas de la base: ningún saldo se comprueba aquí. */
  f: { id: '', sucursal: '', cliente: '', servicio: '' },
  /** Pruebas del endurecimiento (moneda, orden del tiempo, claves, cortes concurrentes). */
  g: { id: '', sucursal: '', cliente: '', servicio: '' },
  /** Antigüedad de la deuda neta de reversos. */
  h: { id: '', sucursal: '', cliente: '', servicio: '' },
  /** Sprint de cierre: ajuste por verificación y atribución (sin cortes, para asentar en T0). */
  i: { id: '', sucursal: '', cliente: '', servicio: '' },
}
const f = { usuario: '', supplyVariante: '', oferta: '' }

const empresa = (actorId: string | null): ContextoPedido => ({ actor: 'EMPRESA', actorId, ipAddress: '127.0.0.1', userAgent: 'test' })
const cliente: ContextoPedido = { actor: 'CLIENTE', actorId: null }
const sistemaPedido: ContextoPedido = { actor: 'SISTEMA', actorId: null }
const sistema: ContextoPedido = { actor: 'SISTEMA', actorId: null }
const superadmin = (): ContextoFacturacion => ({ actor: 'SUPERADMIN', actorId: f.usuario, ipAddress: '127.0.0.1', userAgent: 'test' })
const comoInventario = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })

type Transaccion = Parameters<Parameters<typeof conEmpresa>[1]>[0]
const en = <T>(e: Empresa, fn: (tx: Transaccion) => Promise<T>) => conEmpresa(e.id, fn)

before(async () => {
  const u = await prisma.user.create({
    data: { supabaseId: `sb-bill-${sufijo}`, email: `bill-${sufijo}@prueba.test`, name: 'Billing', role: 'SUPERADMIN' },
    select: { id: true },
  })
  f.usuario = u.id
  for (const [k, e] of Object.entries(E) as [keyof typeof E, Empresa][]) {
    const c = await prisma.company.create({ data: { name: `Billing ${k} ${sufijo}`, slug: `billing-${k}-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo' }, select: { id: true } })
    e.id = c.id
    e.sucursal = (await prisma.sucursal.create({ data: { companyId: c.id, nombre: 'Principal' }, select: { id: true } })).id
    e.cliente = (await prisma.cliente.create({ data: { companyId: c.id, supabaseId: `sb-bcli-${k}-${sufijo}`, nombre: `Cliente ${k}`, email: `bcli-${k}-${sufijo}@prueba.test` }, select: { id: true } })).id
    const r = await conEmpresa(c.id, (tx) => crearItemEnTx(tx, c.id, { name: `Lavado ${k} ${sufijo}`, type: 'SERVICE', price: 250, sku: `BILL-${k}-${sufijo}` }, comoInventario(f.usuario)))
    await conEmpresa(c.id, (tx) => cambiarEstadoItemEnTx(tx, c.id, r.id, 'ACTIVE', comoInventario(f.usuario)))
    e.servicio = (await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })).id
  }
  // Un ítem de Supply en A, para el pedido que envuelve una compra de Supply.
  const sup = await conEmpresa(E.a.id, (tx) => crearItemEnTx(tx, E.a.id, { name: `Oferta ${sufijo}`, type: 'SERVICE', price: 80, sku: `BILL-O-${sufijo}` }, comoInventario(f.usuario)))
  await conEmpresa(E.a.id, (tx) => cambiarEstadoItemEnTx(tx, E.a.id, sup.id, 'ACTIVE', comoInventario(f.usuario)))
  f.oferta = await ofertaSupplyDePrueba(f.usuario, sufijo)
  await prisma.catalogItem.update({ where: { id: sup.id }, data: { source: 'SUPPLY', supplyV2OfferId: f.oferta } })
  f.supplyVariante = (await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: sup.id }, select: { id: true } })).id
})

after(async () => {
  const ids = Object.values(E).map((e) => e.id)
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    for (const tabla of ['merchant_statements', 'merchant_commissions', 'merchant_ledger_entries', 'merchant_billing_configs', 'payment_evidences', 'customer_confirmations', 'order_attributions', 'membego_order_lines', 'membego_orders']) {
      await tx.$executeRawUnsafe(`DELETE FROM "${tabla}" WHERE "companyId" IN (${ids.map((i) => `'${i}'`).join(',')})`)
    }
  })
  await prisma.catalogItem.deleteMany({ where: { companyId: { in: ids } } })
})

// ── Ayudas ───────────────────────────────────────────────────────────────────

async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    if (e instanceof FacturacionError || e instanceof PedidoError) return e.codigo
    throw e
  }
  assert.fail('se esperaba un error de dominio y no falló')
}

class Revertir extends Error {}

/** Ejecuta `fn` en una transacción que SIEMPRE se deshace; devuelve el mensaje con el que la base rechazó, o falla si aceptó. */
async function rechazo(fn: (tx: Prisma.TransactionClient) => Promise<unknown>, { sinDisparadores = false } = {}): Promise<string> {
  try {
    await prisma.$transaction(async (tx) => {
      if (sinDisparadores) await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
      await fn(tx)
      throw new Revertir()
    })
  } catch (e) {
    if (e instanceof Revertir) assert.fail('la base aceptó lo que debía rechazar')
    return e instanceof Error ? e.message : String(e)
  }
  assert.fail('inalcanzable')
}

/** Lo contrario: lo que la base DEBE aceptar (se deshace igual). */
async function acepta(fn: (tx: Prisma.TransactionClient) => Promise<unknown>, opciones: { sinDisparadores?: boolean } = {}): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      if (opciones.sinDisparadores) await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
      await fn(tx)
      throw new Revertir()
    })
  } catch (e) {
    if (!(e instanceof Revertir)) throw e
  }
}

interface OpcionesPedido {
  empresa?: Empresa
  cantidad?: number
  /**
   * `EXTERNAL_PAYMENT_REPORTED`: el cliente confirma el monto y la EMPRESA registra un pago con referencia.
   * `PAYMENT_VERIFIED`: lo mismo, pero el pago lo verifica una fuente externa (la pasarela) antes de cerrar.
   */
  nivel?: 'REDEEMED' | 'EXTERNAL_PAYMENT_REPORTED' | 'PAYMENT_VERIFIED'
  ajuste?: number
  ahora?: Date
}

/** Crea un pedido de marketplace y lo lleva hasta COMPLETED por el QR. */
async function pedidoCompletado(o: OpcionesPedido = {}) {
  const e = o.empresa ?? E.a
  const ahora = o.ahora ?? T0
  const r = await en(e, (tx) =>
    crearPedidoEnTx(
      tx,
      e.id,
      { customerId: e.cliente, locationId: e.sucursal, origin: 'MARKETPLACE', atribucion: { channel: 'MARKETPLACE_BROWSE' }, lineas: [{ varianteId: e.servicio, cantidad: o.cantidad ?? 1 }], ahora },
      cliente
    )
  )
  await en(e, (tx) => aceptarPedidoEnTx(tx, e.id, r.pedidoId, empresa(f.usuario), ahora))
  let total = r.total
  if (o.ajuste !== undefined) {
    total = (await en(e, (tx) => ajustarMontoEnTx(tx, e.id, r.pedidoId, { ajuste: o.ajuste as number, motivo: 'Ajuste de prueba' }, empresa(f.usuario)))).total
  }
  if (o.nivel === 'PAYMENT_VERIFIED' || o.nivel === 'EXTERNAL_PAYMENT_REPORTED') {
    await en(e, (tx) => confirmarMontoEnTx(tx, e.id, r.pedidoId, { customerId: e.cliente, montoVisto: total }, cliente, ahora))
  }
  const listo = await en(e, (tx) => marcarListoEnTx(tx, e.id, r.pedidoId, empresa(f.usuario), ahora))
  if (o.nivel === 'EXTERNAL_PAYMENT_REPORTED') {
    await en(e, (tx) => registrarPagoEnTx(tx, e.id, r.pedidoId, { method: 'TRANSFER', amount: total, reference: `TRF-${randomUUID().slice(0, 8)}` }, empresa(f.usuario), ahora))
  }
  if (o.nivel === 'PAYMENT_VERIFIED') {
    await en(e, (tx) =>
      verificarPagoExternamenteEnTx(tx, e.id, r.pedidoId, { source: 'GATEWAY_VERIFIED', verificationRef: `gw-${randomUUID().slice(0, 8)}`, method: 'CARD', amount: total, reference: `AUTH-${randomUUID().slice(0, 6)}` }, sistemaPedido, ahora)
    )
  }
  const cierre = await en(e, (tx) => completarPorQrEnTx(tx, e.id, listo.qrToken as string, empresa(f.usuario), ahora))
  return { pedidoId: r.pedidoId, code: r.code, nivel: cierre.nivel, total }
}

const libro = (e: Empresa) => prisma.merchantLedgerEntry.findMany({ where: { companyId: e.id }, orderBy: { seq: 'asc' } })
const comisionDe = (pedidoId: string) => prisma.commission.findUnique({ where: { orderId: pedidoId } })
const cuenta = (e: Empresa) => prisma.merchantBillingConfig.findUniqueOrThrow({ where: { companyId: e.id } })
const saldo = async (e: Empresa) => (await en(e, (tx) => saldoEnTx(tx, e.id))).toFixed(2)
const manual = (e: Empresa, tipo: 'PAYMENT' | 'ADJUSTMENT' | 'CREDIT' | 'PROMOTIONAL_CREDIT', monto: number | string, extra: { motivo?: string; referencia?: string; clave?: string; ahora?: Date } = {}) =>
  en(e, (tx) =>
    asentarManualEnTx(
      tx,
      e.id,
      { tipo, monto, motivo: extra.motivo ?? (tipo === 'PAYMENT' ? null : 'Motivo de prueba'), referencia: extra.referencia ?? (tipo === 'PAYMENT' ? `DEP-${randomUUID().slice(0, 8)}` : null), idempotencyKey: extra.clave ?? randomUUID() },
      superadmin(),
      extra.ahora ?? T0
    )
  )

/**
 * Inserta un asiento crudo con los valores por defecto razonables (para probar las reglas de la base).
 * La fecha por defecto es la de ahora, o la del último asiento de la cuenta si es posterior (el tiempo
 * del libro no retrocede); la clave por defecto respeta la regla `commission:…` ⇔ referencia de comisión.
 */
async function insertarAsiento(
  tx: Prisma.TransactionClient,
  e: Empresa,
  o: { id?: string; seq: number; type: string; amount: string; balance: string; referenceType?: string; referenceId?: string; reason?: string | null; key?: string; moneda?: string; cuando?: Date }
): Promise<string> {
  const id = o.id ?? randomUUID()
  const tipoRef = o.referenceType ?? 'MANUAL'
  const clave = o.key ?? (tipoRef === 'COMMISSION' ? `commission:${randomUUID()}` : randomUUID())
  const cuando = o.cuando ?? null
  await tx.$executeRaw`INSERT INTO "merchant_ledger_entries" ("id", "companyId", "seq", "type", "amount", "balance", "currency", "referenceType", "referenceId", "reason", "idempotencyKey", "createdAt")
    VALUES (${id}, ${e.id}, ${o.seq}, ${o.type}::"MerchantLedgerEntryType", ${o.amount}::numeric, ${o.balance}::numeric, ${o.moneda ?? 'DOP'}, ${tipoRef}, ${o.referenceId ?? 'ref'}, ${o.reason ?? null}, ${clave},
            COALESCE(${cuando}::timestamp, GREATEST(now()::timestamp, COALESCE((SELECT max("createdAt") FROM "merchant_ledger_entries" WHERE "companyId" = ${e.id}), '-infinity'::timestamp))))`
  return id
}

// ── Cálculo y cobro ──────────────────────────────────────────────────────────

test('1 · el primer pedido cierra con CPA: crea la cuenta con los valores de la plataforma y el asiento REDEMPTION_FEE', async () => {
  assert.equal(await prisma.merchantBillingConfig.count({ where: { companyId: E.a.id } }), 0, 'sin pedidos no hay cuenta')
  const p = await pedidoCompletado({ cantidad: 2 }) // base 500.00, sin pago verificado
  assert.equal(p.nivel, 'REDEEMED')
  const cfg = await cuenta(E.a)
  assert.equal(cfg.feeModel, 'HYBRID')
  assert.equal(cfg.cpaAmount.toFixed(2), '100.00')
  assert.equal(cfg.percentageRate.toFixed(2), '8.00')
  assert.equal(cfg.creditLimit.toFixed(2), '5000.00')
  assert.equal(cfg.billingCycle, 'MONTHLY')
  assert.equal(cfg.status, 'ACTIVE')

  const c = await comisionDe(p.pedidoId)
  assert.ok(c)
  assert.equal(c.type, 'CPA_FIXED')
  assert.equal(c.status, 'CONFIRMED')
  assert.equal(c.feeModel, 'HYBRID')
  assert.equal(c.verificationLevel, 'REDEEMED')
  assert.equal(c.baseAmount.toFixed(2), '500.00')
  assert.equal(c.rate, null)
  assert.equal(c.amount.toFixed(2), '100.00')

  const asientos = await libro(E.a)
  assert.equal(asientos.length, 1)
  const [a] = asientos
  assert.equal(a.id, c.ledgerEntryId, '1:1 con la comisión')
  assert.equal(a.type, 'REDEMPTION_FEE')
  assert.equal(a.seq, 1)
  assert.equal(a.amount.toFixed(2), '100.00')
  assert.equal(a.balance.toFixed(2), '100.00')
  assert.equal(a.referenceType, 'COMMISSION')
  assert.equal(a.referenceId, c.id)
  assert.equal(a.idempotencyKey, `commission:${p.pedidoId}`)
  const audit = await prisma.auditLog.findFirstOrThrow({ where: { entidadTipo: 'MembegoOrder', entidadId: p.pedidoId, accion: 'ORDER_COMPLETED' } })
  assert.equal((audit.payload as { comision: string }).comision, '100.00')
})

test('2 · con el pago verificado cobra el porcentaje de la base (8 %), no el CPA', async () => {
  const p = await pedidoCompletado({ cantidad: 2, nivel: 'PAYMENT_VERIFIED' }) // base 500.00
  assert.equal(p.nivel, 'PAYMENT_VERIFIED')
  const c = await comisionDe(p.pedidoId)
  assert.ok(c)
  assert.equal(c.type, 'PERCENTAGE')
  assert.equal(c.rate?.toFixed(2), '8.00')
  assert.equal(c.baseAmount.toFixed(2), '500.00')
  assert.equal(c.amount.toFixed(2), '40.00')
  const asientos = await libro(E.a)
  assert.equal(asientos.length, 2)
  assert.equal(asientos[1].type, 'ORDER_FEE')
  assert.equal(asientos[1].amount.toFixed(2), '40.00')
  assert.equal(asientos[1].balance.toFixed(2), '140.00', 'saldo corrido: 100 + 40')
})

test('3 · el porcentaje redondea al centavo (ROUND_HALF_UP) sobre la base ya ajustada', async () => {
  const p = await pedidoCompletado({ nivel: 'PAYMENT_VERIFIED', ajuste: -0.01 }) // base 249.99 → 19.9992 → 20.00
  const c = await comisionDe(p.pedidoId)
  assert.equal(c?.baseAmount.toFixed(2), '249.99')
  assert.equal(c?.amount.toFixed(2), '20.00')
})

test('4 · el modelo de la empresa manda: PERCENTAGE cobra % aun sin pago; CPA_FIXED cobra CPA aun con pago verificado; HYBRID decide por la evidencia', async () => {
  const e = E.e
  await en(e, (tx) => actualizarConfigEnTx(tx, e.id, { feeModel: 'PERCENTAGE', percentageRate: '10' }, superadmin(), T0))
  const sinPago = await pedidoCompletado({ empresa: e }) // base 250 → 25.00
  assert.equal((await comisionDe(sinPago.pedidoId))?.type, 'PERCENTAGE')
  assert.equal((await comisionDe(sinPago.pedidoId))?.amount.toFixed(2), '25.00')

  await en(e, (tx) => actualizarConfigEnTx(tx, e.id, { feeModel: 'CPA_FIXED', cpaAmount: '30' }, superadmin(), T0))
  const conPago = await pedidoCompletado({ empresa: e, nivel: 'PAYMENT_VERIFIED' })
  const c = await comisionDe(conPago.pedidoId)
  assert.equal(c?.type, 'CPA_FIXED')
  assert.equal(c?.amount.toFixed(2), '30.00')
  assert.equal(c?.feeModel, 'CPA_FIXED')

  await en(e, (tx) => actualizarConfigEnTx(tx, e.id, { feeModel: 'HYBRID' }, superadmin(), T0))
  const h1 = await pedidoCompletado({ empresa: e })
  const h2 = await pedidoCompletado({ empresa: e, nivel: 'PAYMENT_VERIFIED' })
  assert.equal((await comisionDe(h1.pedidoId))?.type, 'CPA_FIXED')
  assert.equal((await comisionDe(h2.pedidoId))?.type, 'PERCENTAGE')
  // Lo ya cobrado no cambia con la tarifa nueva.
  assert.equal((await comisionDe(sinPago.pedidoId))?.amount.toFixed(2), '25.00')
  // CPA 30 + % (10 %) 25 + CPA 30 + % 25.
  assert.equal(await saldo(e), '110.00')
})

test('5 · registrar la comisión dos veces es inofensivo: un pedido tiene a lo sumo una', async () => {
  const p = await pedidoCompletado({ empresa: E.b })
  const antes = (await libro(E.b)).length
  const pedido = await prisma.membegoOrder.findUniqueOrThrow({ where: { id: p.pedidoId } })
  const r = await en(E.b, (tx) => registrarComisionDePedidoEnTx(tx, E.b.id, pedido, SISTEMA, T0))
  assert.equal(r.resultado, 'YA_EXISTE')
  assert.equal((await libro(E.b)).length, antes)
  assert.equal(await prisma.commission.count({ where: { orderId: p.pedidoId } }), 1)
})

test('6 · un pedido que envuelve una compra de Supply NO genera comisión de Merchant Billing', async () => {
  const r = await en(E.a, (tx) =>
    crearPedidoEnTx(
      tx,
      E.a.id,
      {
        customerId: E.a.cliente,
        locationId: E.a.sucursal,
        origin: 'SUPPLY',
        atribucion: { channel: 'SUPPLY_OFFER', supplyV2OfferId: f.oferta },
        lineas: [{ varianteId: f.supplyVariante, cantidad: 1 }],
        fuente: { tipo: 'SUPPLY_V2_CUSTOMER_ORDER', id: `sup-${sufijo}` },
        ahora: T0,
      },
      sistema
    )
  )
  const antes = (await libro(E.a)).length
  await en(E.a, (tx) => cerrarPedidoExternoEnTx(tx, E.a.id, r.pedidoId, { completedAt: T0, confirmadoPorCliente: true }, sistema))
  assert.equal(await comisionDe(r.pedidoId), null)
  assert.equal((await libro(E.a)).length, antes, 'el libro no se movió')

  // Aunque alguien intente cobrarla a mano, el servicio y la base la rechazan.
  const pedido = await prisma.membegoOrder.findUniqueOrThrow({ where: { id: r.pedidoId } })
  assert.equal((await en(E.a, (tx) => registrarComisionDePedidoEnTx(tx, E.a.id, pedido, SISTEMA, T0))).resultado, 'NO_APLICA')
  const msg = await rechazo(async (tx) => {
    const id = randomUUID()
    const ultimo = await tx.merchantLedgerEntry.findFirstOrThrow({ where: { companyId: E.a.id }, orderBy: { seq: 'desc' } })
    const entry = await insertarAsiento(tx, E.a, { seq: ultimo.seq + 1, type: 'ORDER_FEE', amount: '6.40', balance: ultimo.balance.plus('6.40').toFixed(2), referenceType: 'COMMISSION', referenceId: id })
    await tx.$executeRaw`INSERT INTO "merchant_commissions" ("id","companyId","orderId","type","status","feeModel","verificationLevel","baseAmount","rate","amount","ledgerEntryId","updatedAt")
      VALUES (${id}, ${E.a.id}, ${r.pedidoId}, 'PERCENTAGE', 'CONFIRMED', 'PERCENTAGE', ${pedido.verificationLevel}::"MembegoVerificationLevel", ${pedido.commissionableBase}::numeric, 8, 6.40, ${entry}, now())`
  })
  assert.match(msg, /Supply/)
})

test('7 · un pedido de otro origen (POS) tampoco comisiona todavía', async () => {
  const r = await en(E.a, (tx) =>
    crearPedidoEnTx(tx, E.a.id, { customerId: E.a.cliente, locationId: E.a.sucursal, origin: 'POS', atribucion: { channel: 'DIRECT' }, lineas: [{ varianteId: E.a.servicio, cantidad: 1 }], fuente: { tipo: 'POS_TICKET', id: `pos-${sufijo}` }, ahora: T0 }, sistema)
  )
  const antes = (await libro(E.a)).length
  await en(E.a, (tx) => cerrarPedidoExternoEnTx(tx, E.a.id, r.pedidoId, { completedAt: T0, confirmadoPorCliente: true }, sistema))
  assert.equal(await comisionDe(r.pedidoId), null)
  assert.equal((await libro(E.a)).length, antes)
})

test('8 · un pedido sin nada que cobrar (base en cero) no genera comisión ni asiento', async () => {
  const r = await en(E.b, (tx) =>
    crearPedidoEnTx(tx, E.b.id, { customerId: E.b.cliente, locationId: E.b.sucursal, origin: 'MARKETPLACE', atribucion: { channel: 'MARKETPLACE_BROWSE' }, lineas: [{ varianteId: E.b.servicio, cantidad: 1 }], ahora: T0 }, cliente)
  )
  await en(E.b, (tx) => aceptarPedidoEnTx(tx, E.b.id, r.pedidoId, empresa(f.usuario), T0))
  await en(E.b, (tx) => ajustarMontoEnTx(tx, E.b.id, r.pedidoId, { ajuste: -250, motivo: 'Cortesía total' }, empresa(f.usuario)))
  const listo = await en(E.b, (tx) => marcarListoEnTx(tx, E.b.id, r.pedidoId, empresa(f.usuario), T0))
  const antes = (await libro(E.b)).length
  await en(E.b, (tx) => completarPorQrEnTx(tx, E.b.id, listo.qrToken as string, empresa(f.usuario), T0))
  assert.equal(await comisionDe(r.pedidoId), null)
  assert.equal((await libro(E.b)).length, antes)
})

// ── Reembolso ────────────────────────────────────────────────────────────────

test('9 · reembolsar un pedido revierte su comisión con un asiento contrario y deja el saldo como estaba', async () => {
  const p = await pedidoCompletado({ empresa: E.d })
  const antes = await saldo(E.d)
  const c0 = await comisionDe(p.pedidoId)
  assert.equal(c0?.status, 'CONFIRMED')
  const r = await en(E.d, (tx) => reembolsarPedidoEnTx(tx, E.d.id, p.pedidoId, { motivo: 'El cliente devolvió el servicio' }, empresa(f.usuario), T0))
  assert.equal(r.repetido, false)
  const c = await comisionDe(p.pedidoId)
  assert.equal(c?.status, 'REVERSED')
  assert.ok(c?.reversalEntryId)
  assert.ok(c?.reversedAt)
  const asientos = await libro(E.d)
  const reverso = asientos.find((a) => a.id === c?.reversalEntryId)
  assert.equal(reverso?.type, 'REFUND')
  assert.equal(reverso?.amount.toFixed(2), '-100.00')
  assert.equal(reverso?.referenceId, c?.id)
  assert.equal(await saldo(E.d), new Prisma.Decimal(antes).minus(100).toFixed(2))

  // Reembolsar otra vez, o revertir otra vez, no hace nada.
  const otra = await en(E.d, (tx) => reembolsarPedidoEnTx(tx, E.d.id, p.pedidoId, { motivo: 'otra vez' }, empresa(f.usuario), T0))
  assert.equal(otra.repetido, true)
  assert.equal((await en(E.d, (tx) => revertirComisionDePedidoEnTx(tx, E.d.id, p.pedidoId, SISTEMA, T0))).resultado, 'YA_REVERTIDA')
  assert.equal((await libro(E.d)).length, asientos.length)
})

test('10 · reembolsar un pedido que no tenía comisión (Supply, POS) no escribe nada en el libro', async () => {
  const r = await en(E.a, (tx) =>
    crearPedidoEnTx(tx, E.a.id, { customerId: E.a.cliente, locationId: E.a.sucursal, origin: 'POS', atribucion: { channel: 'DIRECT' }, lineas: [{ varianteId: E.a.servicio, cantidad: 1 }], fuente: { tipo: 'POS_TICKET', id: `pos2-${sufijo}` }, ahora: T0 }, sistema)
  )
  await en(E.a, (tx) => cerrarPedidoExternoEnTx(tx, E.a.id, r.pedidoId, { completedAt: T0, confirmadoPorCliente: false }, sistema))
  const antes = (await libro(E.a)).length
  await en(E.a, (tx) => reembolsarPedidoEnTx(tx, E.a.id, r.pedidoId, { motivo: 'Devolución' }, empresa(f.usuario), T0))
  assert.equal((await libro(E.a)).length, antes)
})

// ── El libro es inmutable y la base vigila el saldo ──────────────────────────

test('11 · el libro y los cortes no admiten UPDATE, DELETE ni TRUNCATE; la comisión no se borra', async () => {
  const [a] = await libro(E.a)
  assert.match(await rechazo((tx) => tx.$executeRaw`UPDATE "merchant_ledger_entries" SET "reason" = 'x' WHERE "id" = ${a.id}`), /merchant_inmutable/)
  assert.match(await rechazo((tx) => tx.$executeRaw`UPDATE "merchant_ledger_entries" SET "amount" = 1 WHERE "id" = ${a.id}`), /merchant_inmutable/)
  assert.match(await rechazo((tx) => tx.$executeRaw`DELETE FROM "merchant_ledger_entries" WHERE "id" = ${a.id}`), /merchant_inmutable/)
  assert.match(await rechazo((tx) => tx.$executeRawUnsafe('TRUNCATE "merchant_ledger_entries" CASCADE')), /merchant_inmutable/)
  assert.match(await rechazo((tx) => tx.$executeRawUnsafe('TRUNCATE "merchant_statements"')), /merchant_inmutable/)
  assert.match(await rechazo((tx) => tx.$executeRawUnsafe('TRUNCATE "merchant_commissions" CASCADE')), /merchant_inmutable/)
  const c = await prisma.commission.findFirstOrThrow({ where: { companyId: E.a.id } })
  assert.match(await rechazo((tx) => tx.$executeRaw`DELETE FROM "merchant_commissions" WHERE "id" = ${c.id}`), /merchant_inmutable/)
  assert.match(await rechazo((tx) => tx.$executeRaw`UPDATE "merchant_commissions" SET "amount" = 1 WHERE "id" = ${c.id}`), /merchant_inmutable/)
})

test('12 · la base rechaza una posición con hueco o repetida, y un saldo que no es el anterior más el monto', async () => {
  const ultimo = await prisma.merchantLedgerEntry.findFirstOrThrow({ where: { companyId: E.a.id }, orderBy: { seq: 'desc' } })
  const sig = ultimo.seq + 1
  const ok = ultimo.balance.plus(5).toFixed(2)
  assert.match(await rechazo((tx) => insertarAsiento(tx, E.a, { seq: sig + 1, type: 'ADJUSTMENT', amount: '5', balance: ok, reason: 'x' })), /posición/)
  assert.match(await rechazo((tx) => insertarAsiento(tx, E.a, { seq: ultimo.seq, type: 'ADJUSTMENT', amount: '5', balance: ok, reason: 'x' })), /posición/)
  assert.match(await rechazo((tx) => insertarAsiento(tx, E.a, { seq: sig, type: 'ADJUSTMENT', amount: '5', balance: ultimo.balance.toFixed(2), reason: 'x' })), /saldo/)
  assert.match(await rechazo((tx) => insertarAsiento(tx, E.a, { seq: sig, type: 'ADJUSTMENT', amount: '5', balance: ultimo.balance.plus(6).toFixed(2), reason: 'x' })), /saldo/)
  await acepta((tx) => insertarAsiento(tx, E.a, { seq: sig, type: 'ADJUSTMENT', amount: '5', balance: ok, reason: 'x' }))
  // La primera posición de una cuenta vacía es 1 y su saldo es el monto.
  const vacia = E.c
  assert.equal(await prisma.merchantLedgerEntry.count({ where: { companyId: vacia.id } }), 0)
  assert.match(await rechazo((tx) => insertarAsiento(tx, vacia, { seq: 2, type: 'ADJUSTMENT', amount: '5', balance: '5', reason: 'x' })), /posición/)
  assert.match(await rechazo((tx) => insertarAsiento(tx, vacia, { seq: 1, type: 'ADJUSTMENT', amount: '5', balance: '9', reason: 'x' })), /saldo/)
  await acepta((tx) => insertarAsiento(tx, vacia, { seq: 1, type: 'ADJUSTMENT', amount: '5', balance: '5', reason: 'x' }))
})

test('13 · el signo del monto lo decide el tipo, un ajuste lleva motivo, un asiento en cero no existe y el libro no habla de Supply', async () => {
  const ultimo = await prisma.merchantLedgerEntry.findFirstOrThrow({ where: { companyId: E.a.id }, orderBy: { seq: 'desc' } })
  const base = { seq: ultimo.seq + 1 }
  const intento = (o: { type: string; amount: string; reason?: string | null; referenceType?: string; referenceId?: string }) =>
    rechazo((tx) => insertarAsiento(tx, E.a, { ...base, balance: ultimo.balance.plus(o.amount).toFixed(2), ...o }), { sinDisparadores: true })
  for (const t of TIPOS_QUE_SUMAN) assert.match(await intento({ type: t, amount: '-10', referenceType: 'COMMISSION' }), /merchant_ledger_entries_signo/)
  for (const t of TIPOS_QUE_RESTAN) {
    assert.match(await intento({ type: t, amount: '10', reason: 'x', referenceType: t === 'REFUND' ? 'COMMISSION' : t === 'PAYMENT' ? 'PAYMENT' : 'MANUAL' }), /merchant_ledger_entries_signo/)
  }
  assert.match(await intento({ type: 'ADJUSTMENT', amount: '0', reason: 'x' }), /merchant_ledger_entries_signo/)
  assert.match(await intento({ type: 'ADJUSTMENT', amount: '5', reason: null }), /merchant_ledger_entries_motivo/)
  assert.match(await intento({ type: 'ADJUSTMENT', amount: '5', reason: '   ' }), /merchant_ledger_entries_motivo/)
  assert.match(await intento({ type: 'CREDIT', amount: '-5', reason: null }), /merchant_ledger_entries_motivo/)
  // SEPARACIÓN de Supply Economics: cualquier referencia que no sea de este dominio se rechaza.
  for (const rt of ['SUPPLY_V2_SETTLEMENT', 'SupplyV2Settlement', 'SUPPLY', 'supply_v2_settlements', '']) {
    assert.match(await intento({ type: 'ADJUSTMENT', amount: '5', reason: 'x', referenceType: rt, referenceId: 'liq-1' }), /merchant_ledger_entries_referencia/, `referenceType ${JSON.stringify(rt)}`)
  }
  // Las comisiones, sus reversos y los pagos solo cuelgan de lo suyo.
  assert.match(await intento({ type: 'ORDER_FEE', amount: '5', referenceType: 'MANUAL' }), /merchant_ledger_entries_referencia/)
  assert.match(await intento({ type: 'PAYMENT', amount: '-5', referenceType: 'MANUAL' }), /merchant_ledger_entries_referencia/)
  for (const rt of ['COMMISSION', 'PAYMENT', 'MANUAL', 'STATEMENT']) {
    await acepta((tx) => insertarAsiento(tx, E.a, { ...base, type: 'ADJUSTMENT', amount: '5', balance: ultimo.balance.plus(5).toFixed(2), reason: 'x', referenceType: rt }))
  }
})

test('14 · la idempotencia del asiento es única por empresa', async () => {
  const ultimo = await prisma.merchantLedgerEntry.findFirstOrThrow({ where: { companyId: E.a.id }, orderBy: { seq: 'desc' } })
  const clave = `idem-${randomUUID()}`
  const msg = await rechazo(async (tx) => {
    await insertarAsiento(tx, E.a, { seq: ultimo.seq + 1, type: 'ADJUSTMENT', amount: '1', balance: ultimo.balance.plus(1).toFixed(2), reason: 'x', key: clave })
    await insertarAsiento(tx, E.a, { seq: ultimo.seq + 2, type: 'ADJUSTMENT', amount: '1', balance: ultimo.balance.plus(2).toFixed(2), reason: 'x', key: clave })
  })
  assert.match(msg, /already exists|23505|Unique constraint/i)
})

// ── La comisión coincide con su asiento y su pedido ──────────────────────────

/** Un pedido COMPLETED de la empresa D sin comisión (se simula saltándose los disparadores: así quedaba un pedido cerrado antes de la Fase 4). */
async function pedidoHuerfano(e: Empresa, nivel: MembegoVerificationLevel = 'REDEEMED') {
  const r = await en(e, (tx) =>
    crearPedidoEnTx(tx, e.id, { customerId: e.cliente, locationId: e.sucursal, origin: 'MARKETPLACE', atribucion: { channel: 'MARKETPLACE_BROWSE' }, lineas: [{ varianteId: e.servicio, cantidad: 2 }], ahora: T0 }, cliente)
  )
  await en(e, (tx) => aceptarPedidoEnTx(tx, e.id, r.pedidoId, empresa(f.usuario), T0))
  await en(e, (tx) => marcarListoEnTx(tx, e.id, r.pedidoId, empresa(f.usuario), T0))
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    await tx.$executeRaw`UPDATE "membego_orders" SET "status" = 'COMPLETED', "completedAt" = ${T0}, "verificationLevel" = ${nivel}::"MembegoVerificationLevel" WHERE "id" = ${r.pedidoId}`
  })
  return r.pedidoId
}

async function insertarComision(
  tx: Prisma.TransactionClient,
  e: Empresa,
  o: { pedidoId: string; entrada?: Partial<{ type: string; amount: string; referenceId: string; referenceType: string }>; type?: string; feeModel?: string; nivel?: string; base?: string; rate?: string | null; amount?: string; status?: string; id?: string; moneda?: string }
) {
  const id = o.id ?? randomUUID()
  const amount = o.amount ?? '100.00'
  const type = o.type ?? 'CPA_FIXED'
  const ultimo = await tx.merchantLedgerEntry.findFirst({ where: { companyId: e.id }, orderBy: { seq: 'desc' } })
  const entry = await insertarAsiento(tx, e, {
    seq: (ultimo?.seq ?? 0) + 1,
    type: o.entrada?.type ?? (type === 'CPA_FIXED' ? 'REDEMPTION_FEE' : 'ORDER_FEE'),
    amount: o.entrada?.amount ?? amount,
    balance: (ultimo?.balance ?? new Prisma.Decimal(0)).plus(o.entrada?.amount ?? amount).toFixed(2),
    referenceType: o.entrada?.referenceType ?? 'COMMISSION',
    referenceId: o.entrada?.referenceId ?? id,
  })
  await tx.$executeRaw`INSERT INTO "merchant_commissions" ("id","companyId","orderId","type","status","feeModel","verificationLevel","baseAmount","rate","amount","currency","ledgerEntryId","updatedAt")
    VALUES (${id}, ${e.id}, ${o.pedidoId}, ${type}::"MerchantCommissionType", ${o.status ?? 'CONFIRMED'}::"MerchantCommissionStatus", ${o.feeModel ?? 'HYBRID'}::"MerchantFeeModel",
            ${o.nivel ?? 'REDEEMED'}::"MembegoVerificationLevel", ${o.base ?? '500.00'}::numeric, ${o.rate === undefined ? null : o.rate}::numeric, ${amount}::numeric, ${o.moneda ?? 'DOP'}, ${entry}, now())`
  return { id, entry }
}

test('15 · la base valida la comisión contra el pedido: debe estar COMPLETED, con su base, su nivel y su moneda', async () => {
  const e = E.f
  const noCompletado = await en(e, (tx) =>
    crearPedidoEnTx(tx, e.id, { customerId: e.cliente, locationId: e.sucursal, origin: 'MARKETPLACE', atribucion: { channel: 'MARKETPLACE_BROWSE' }, lineas: [{ varianteId: e.servicio, cantidad: 2 }], ahora: T0 }, cliente)
  )
  assert.match(await rechazo((tx) => insertarComision(tx, e, { pedidoId: noCompletado.pedidoId })), /solo un pedido COMPLETED/)
  assert.match(await rechazo((tx) => insertarComision(tx, e, { pedidoId: randomUUID() })), /no existe en esta empresa/)

  const huerfano = await pedidoHuerfano(e)
  await acepta((tx) => insertarComision(tx, e, { pedidoId: huerfano }))
  assert.match(await rechazo((tx) => insertarComision(tx, e, { pedidoId: huerfano, base: '499.99' })), /base, el nivel/)
  assert.match(await rechazo((tx) => insertarComision(tx, e, { pedidoId: huerfano, nivel: 'CUSTOMER_VERIFIED' })), /base, el nivel/)
  assert.match(await rechazo((tx) => insertarComision(tx, e, { pedidoId: huerfano, moneda: 'USD' })), /base, el nivel/)
  assert.match(await rechazo((tx) => insertarComision(tx, e, { pedidoId: huerfano, status: 'REVERSED' }), { sinDisparadores: false }), /nace CONFIRMED|merchant_commissions_estado_reverso/)
  // Otra empresa no puede colgarse del pedido: la FK compuesta lo rechaza.
  assert.match(await rechazo((tx) => insertarComision(tx, E.b, { pedidoId: huerfano })), /no existe en esta empresa/)
})

test('16 · la base valida el asiento de la comisión: mismo tipo, mismo monto, misma referencia', async () => {
  const e = E.f
  const huerfano = await pedidoHuerfano(e)
  assert.match(await rechazo((tx) => insertarComision(tx, e, { pedidoId: huerfano, entrada: { amount: '99.00' } })), /asiento de la comisión/)
  assert.match(await rechazo((tx) => insertarComision(tx, e, { pedidoId: huerfano, entrada: { type: 'ORDER_FEE' } })), /asiento de la comisión/)
  assert.match(await rechazo((tx) => insertarComision(tx, e, { pedidoId: huerfano, entrada: { referenceId: randomUUID() } })), /asiento de la comisión/)
  // Dos comisiones para el mismo pedido: el segundo intento choca con la unicidad.
  const msg = await rechazo(async (tx) => {
    await insertarComision(tx, e, { pedidoId: huerfano })
    await insertarComision(tx, e, { pedidoId: huerfano })
  })
  assert.match(msg, /already exists|23505|Unique constraint/i)
})

test('17 · la base y el dominio dicen lo mismo sobre CPA vs porcentaje (3 modelos × 6 niveles)', async () => {
  const modelos: MerchantFeeModel[] = ['CPA_FIXED', 'PERCENTAGE', 'HYBRID']
  const niveles: MembegoVerificationLevel[] = ['ATTRIBUTED', 'REDEEMED', 'CUSTOMER_VERIFIED', 'EXTERNAL_PAYMENT_REPORTED', 'PAYMENT_VERIFIED', 'FISCALLY_RECONCILED']
  const tipos = ['CPA_FIXED', 'PERCENTAGE'] as const
  let combinaciones = 0
  for (const m of modelos) {
    for (const n of niveles) {
      for (const t of tipos) {
        const esperado = tipoDeComision(m, n) === t
        const fila = (tx: Prisma.TransactionClient) =>
          tx.$executeRaw`INSERT INTO "merchant_commissions" ("id","companyId","orderId","type","status","feeModel","verificationLevel","baseAmount","rate","amount","ledgerEntryId","updatedAt")
            VALUES (${randomUUID()}, ${E.a.id}, 'o', ${t}::"MerchantCommissionType", 'CONFIRMED', ${m}::"MerchantFeeModel", ${n}::"MembegoVerificationLevel", 500.00,
                    ${t === 'PERCENTAGE' ? 8 : null}::numeric, ${t === 'PERCENTAGE' ? 40 : 100}::numeric, 'e', now())`
        if (esperado) await acepta(fila, { sinDisparadores: true })
        else assert.match(await rechazo(fila, { sinDisparadores: true }), /merchant_commissions_modelo/, `${m} + ${n} + ${t}`)
        combinaciones++
      }
    }
  }
  assert.equal(combinaciones, 36)
})

test('18 · la base valida los montos de la comisión (porcentaje exacto, CPA sin tasa, positiva)', async () => {
  const fila = (o: { type: 'CPA_FIXED' | 'PERCENTAGE'; base: string; rate: string | null; amount: string }) => (tx: Prisma.TransactionClient) =>
    tx.$executeRaw`INSERT INTO "merchant_commissions" ("id","companyId","orderId","type","status","feeModel","verificationLevel","baseAmount","rate","amount","ledgerEntryId","updatedAt")
      VALUES (${randomUUID()}, ${E.a.id}, 'o', ${o.type}::"MerchantCommissionType", 'CONFIRMED', ${o.type === 'CPA_FIXED' ? 'CPA_FIXED' : 'PERCENTAGE'}::"MerchantFeeModel", 'REDEEMED', ${o.base}::numeric, ${o.rate}::numeric, ${o.amount}::numeric, 'e', now())`
  const sd = { sinDisparadores: true }
  await acepta(fila({ type: 'PERCENTAGE', base: '249.99', rate: '8', amount: '20.00' }), sd)
  await acepta(fila({ type: 'PERCENTAGE', base: '12.50', rate: '8', amount: '1.00' }), sd)
  await acepta(fila({ type: 'CPA_FIXED', base: '1', rate: null, amount: '1' }), sd)
  assert.match(await rechazo(fila({ type: 'PERCENTAGE', base: '249.99', rate: '8', amount: '19.99' }), sd), /merchant_commissions_montos/)
  assert.match(await rechazo(fila({ type: 'PERCENTAGE', base: '500', rate: null, amount: '40' }), sd), /merchant_commissions_montos/)
  assert.match(await rechazo(fila({ type: 'PERCENTAGE', base: '500', rate: '0', amount: '0' }), sd), /merchant_commissions_montos/)
  assert.match(await rechazo(fila({ type: 'PERCENTAGE', base: '500', rate: '101', amount: '505' }), sd), /merchant_commissions_montos/)
  assert.match(await rechazo(fila({ type: 'CPA_FIXED', base: '500', rate: '8', amount: '100' }), sd), /merchant_commissions_montos/)
  assert.match(await rechazo(fila({ type: 'CPA_FIXED', base: '500', rate: null, amount: '0' }), sd), /merchant_commissions_montos/)
  assert.match(await rechazo(fila({ type: 'CPA_FIXED', base: '-1', rate: null, amount: '10' }), sd), /merchant_commissions_montos/)
})

test('19 · la reversión de una comisión exige el pedido REFUNDED y el asiento contrario exacto; lo revertido no vuelve', async () => {
  const e = E.d
  const p = await pedidoCompletado({ empresa: e })
  const c = await comisionDe(p.pedidoId)
  assert.ok(c)
  const ultimo = () => prisma.merchantLedgerEntry.findFirstOrThrow({ where: { companyId: e.id }, orderBy: { seq: 'desc' } })
  const reverso = async (tx: Prisma.TransactionClient, o: { amount?: string; type?: string; referenceId?: string }) => {
    const u = await tx.merchantLedgerEntry.findFirstOrThrow({ where: { companyId: e.id }, orderBy: { seq: 'desc' } })
    const monto = o.amount ?? '-100.00'
    const id = await insertarAsiento(tx, e, { seq: u.seq + 1, type: o.type ?? 'REFUND', amount: monto, balance: u.balance.plus(monto).toFixed(2), referenceType: 'COMMISSION', referenceId: o.referenceId ?? c.id, reason: 'prueba' })
    await tx.$executeRaw`UPDATE "merchant_commissions" SET "status" = 'REVERSED', "reversalEntryId" = ${id}, "reversedAt" = now() WHERE "id" = ${c.id}`
  }
  assert.ok(await ultimo())
  assert.match(await rechazo((tx) => reverso(tx, {})), /solo se revierte con el pedido reembolsado/)
  // Con el pedido reembolsado por fuera del servicio (sin disparadores del libro) la regla sigue exigiendo el asiento exacto.
  const conPedidoReembolsado = async (tx: Prisma.TransactionClient, o: { amount?: string; type?: string; referenceId?: string }) => {
    await tx.$executeRaw`UPDATE "membego_orders" SET "status" = 'REFUNDED', "refundedAt" = now(), "refundReason" = 'prueba' WHERE "id" = ${p.pedidoId}`
    await reverso(tx, o)
  }
  await acepta((tx) => conPedidoReembolsado(tx, {}))
  assert.match(await rechazo((tx) => conPedidoReembolsado(tx, { amount: '-99.00' })), /no existe o no es el contrario exacto/)
  assert.match(await rechazo((tx) => conPedidoReembolsado(tx, { type: 'ADJUSTMENT' })), /no existe o no es el contrario exacto/)
  assert.match(await rechazo((tx) => conPedidoReembolsado(tx, { referenceId: randomUUID() })), /no existe o no es el contrario exacto/)
  // Lo revertido no vuelve a CONFIRMED y no cambia de asiento.
  await en(e, (tx) => reembolsarPedidoEnTx(tx, e.id, p.pedidoId, { motivo: 'Devolución' }, empresa(f.usuario), T0))
  assert.match(await rechazo((tx) => tx.$executeRaw`UPDATE "merchant_commissions" SET "status" = 'CONFIRMED', "reversalEntryId" = NULL, "reversedAt" = NULL WHERE "id" = ${c.id}`, { sinDisparadores: false }), /ya está revertida|merchant_commissions_estado_reverso/)
})

// ── Asientos manuales y configuración (superadmin) ───────────────────────────

test('20 · pagos, ajustes y créditos: signo correcto, motivo, referencia, idempotencia y bitácora', async () => {
  const e = E.b
  const s0 = new Prisma.Decimal(await saldo(e))
  const pago = await manual(e, 'PAYMENT', '30.00', { referencia: 'TRF-9981', clave: `pago-${sufijo}` })
  assert.equal(pago.repetido, false)
  assert.equal(pago.balance, s0.minus(30).toFixed(2))
  const asiento = await prisma.merchantLedgerEntry.findUniqueOrThrow({ where: { id: pago.entryId } })
  assert.equal(asiento.type, 'PAYMENT')
  assert.equal(asiento.amount.toFixed(2), '-30.00', 'un pago resta')
  assert.equal(asiento.referenceType, 'PAYMENT')
  assert.equal(asiento.referenceId, 'TRF-9981')
  assert.equal(asiento.actorUserId, f.usuario)

  const credito = await manual(e, 'CREDIT', '5', { motivo: 'Compensación por demora' })
  assert.equal((await prisma.merchantLedgerEntry.findUniqueOrThrow({ where: { id: credito.entryId } })).amount.toFixed(2), '-5.00')
  const promo = await manual(e, 'PROMOTIONAL_CREDIT', '10', { motivo: 'Campaña de lanzamiento' })
  assert.equal((await prisma.merchantLedgerEntry.findUniqueOrThrow({ where: { id: promo.entryId } })).amount.toFixed(2), '-10.00')
  const mas = await manual(e, 'ADJUSTMENT', '7.50', { motivo: 'Cobro olvidado' })
  const menos = await manual(e, 'ADJUSTMENT', '-2.50', { motivo: 'Cobro duplicado' })
  assert.equal((await prisma.merchantLedgerEntry.findUniqueOrThrow({ where: { id: mas.entryId } })).amount.toFixed(2), '7.50')
  assert.equal((await prisma.merchantLedgerEntry.findUniqueOrThrow({ where: { id: menos.entryId } })).amount.toFixed(2), '-2.50')
  assert.equal(await saldo(e), s0.minus(30).minus(5).minus(10).plus(7.5).minus(2.5).toFixed(2))

  // Reintentar el mismo pago no lo duplica; usar la clave para otro monto, tampoco.
  const otra = await manual(e, 'PAYMENT', '30.00', { referencia: 'TRF-9981', clave: `pago-${sufijo}` })
  assert.equal(otra.repetido, true)
  assert.equal(otra.entryId, pago.entryId)
  assert.equal(await codigoDe(manual(e, 'PAYMENT', '31.00', { referencia: 'TRF-9981', clave: `pago-${sufijo}` })), 'CLAVE_REUTILIZADA')

  // Validaciones.
  const sinReferencia = en(e, (tx) => asentarManualEnTx(tx, e.id, { tipo: 'PAYMENT', monto: 10, idempotencyKey: randomUUID() }, superadmin(), T0))
  assert.equal(await codigoDe(sinReferencia), 'REFERENCIA_REQUERIDA')
  assert.equal(await codigoDe(manual(e, 'ADJUSTMENT', '5', { motivo: '  ' })), 'ASIENTO_INVALIDO')
  assert.equal(await codigoDe(manual(e, 'CREDIT', '5', { motivo: '' })), 'ASIENTO_INVALIDO')
  assert.equal(await codigoDe(manual(e, 'ADJUSTMENT', '0', { motivo: 'nada' })), 'ASIENTO_INVALIDO')
  assert.equal(await codigoDe(manual(e, 'PAYMENT', '-5')), 'ASIENTO_INVALIDO')
  assert.equal(await codigoDe(manual(e, 'PAYMENT', '0')), 'ASIENTO_INVALIDO')
  assert.equal(await codigoDe(manual(e, 'PAYMENT', '10.005')), 'ASIENTO_INVALIDO')
  assert.equal(await codigoDe(manual(e, 'PAYMENT', 'abc')), 'ASIENTO_INVALIDO')
  assert.equal(await codigoDe(manual(e, 'ADJUSTMENT', '1', { clave: '   ' })), 'CLAVE_INVALIDA')
  const sinPermiso = en(e, (tx) => asentarManualEnTx(tx, e.id, { tipo: 'PAYMENT', monto: 10, referencia: 'X', idempotencyKey: randomUUID() }, { actor: 'SISTEMA', actorId: null }, T0))
  assert.equal(await codigoDe(sinPermiso), 'SOLO_SUPERADMIN')
  const tipoInvalido = en(e, (tx) => asentarManualEnTx(tx, e.id, { tipo: 'ORDER_FEE' as never, monto: 10, idempotencyKey: randomUUID() }, superadmin(), T0))
  assert.equal(await codigoDe(tipoInvalido), 'TIPO_INVALIDO')

  // Cada asiento manual dejó su rastro; el que se reintentó, uno solo.
  const auditoria = await prisma.auditLog.findMany({ where: { companyId: e.id, accion: 'BILLING_ENTRY_RECORDED', entidadId: pago.entryId } })
  assert.equal(auditoria.length, 1)
  assert.equal(auditoria[0].userId, f.usuario)
  assert.equal((auditoria[0].payload as { tipo: string }).tipo, 'PAYMENT')
})

test('21 · el saldo corrido es la suma de los asientos, en cada fila, con posiciones 1…n sin huecos', async () => {
  for (const e of [E.a, E.b, E.d, E.e]) {
    const asientos = await libro(e)
    assert.ok(asientos.length > 0)
    let acumulado = new Prisma.Decimal(0)
    asientos.forEach((a, i) => {
      assert.equal(a.seq, i + 1, 'posiciones consecutivas')
      acumulado = acumulado.plus(a.amount)
      assert.equal(a.balance.toFixed(2), acumulado.toFixed(2), `saldo de la fila ${a.seq}`)
    })
    assert.equal(await saldo(e), acumulado.toFixed(2))
  }
})

test('22 · cambiar la configuración: valida, rige hacia adelante, deja bitácora y solo la hace el superadmin', async () => {
  const e = E.b
  const antes = await cuenta(e)
  const r = await en(e, (tx) => actualizarConfigEnTx(tx, e.id, { feeModel: 'PERCENTAGE', cpaAmount: '120.50', percentageRate: '7.5', billingCycle: 'WEEKLY' }, superadmin(), T0))
  assert.equal(r.repetido, false)
  assert.deepEqual(Object.keys(r.cambios).sort(), ['billingCycle', 'cpaAmount', 'feeModel', 'percentageRate'])
  const despues = await cuenta(e)
  assert.equal(despues.feeModel, 'PERCENTAGE')
  assert.equal(despues.cpaAmount.toFixed(2), '120.50')
  assert.equal(despues.percentageRate.toFixed(2), '7.50')
  assert.equal(despues.billingCycle, 'WEEKLY')
  assert.equal(despues.creditLimit.toFixed(2), antes.creditLimit.toFixed(2))
  const audit = await prisma.auditLog.findFirstOrThrow({ where: { companyId: e.id, accion: 'BILLING_CONFIG_CHANGED' }, orderBy: { createdAt: 'desc' } })
  assert.equal(audit.userId, f.usuario)
  assert.deepEqual((audit.payload as { cambios: Record<string, { de: string; a: string }> }).cambios.percentageRate, { de: '8.00', a: '7.50' })

  // El mismo cambio otra vez no hace nada ni audita.
  const nAudit = await prisma.auditLog.count({ where: { companyId: e.id, accion: 'BILLING_CONFIG_CHANGED' } })
  assert.equal((await en(e, (tx) => actualizarConfigEnTx(tx, e.id, { feeModel: 'PERCENTAGE', percentageRate: '7.50' }, superadmin(), T0))).repetido, true)
  assert.equal(await prisma.auditLog.count({ where: { companyId: e.id, accion: 'BILLING_CONFIG_CHANGED' } }), nAudit)

  const mal = (c: Parameters<typeof actualizarConfigEnTx>[2]) => codigoDe(en(e, (tx) => actualizarConfigEnTx(tx, e.id, c, superadmin(), T0)))
  assert.equal(await mal({ percentageRate: '100.01' }), 'CONFIG_INVALIDA')
  assert.equal(await mal({ percentageRate: '-1' }), 'CONFIG_INVALIDA')
  assert.equal(await mal({ percentageRate: '7.555' }), 'CONFIG_INVALIDA')
  assert.equal(await mal({ cpaAmount: '-1' }), 'CONFIG_INVALIDA')
  assert.equal(await mal({ cpaAmount: '10.001' }), 'CONFIG_INVALIDA')
  assert.equal(await mal({ creditLimit: '-5' }), 'CONFIG_INVALIDA')
  assert.equal(await mal({ cpaAmount: 'abc' }), 'CONFIG_INVALIDA')
  assert.equal(await mal({ feeModel: 'GRATIS' as never }), 'CONFIG_INVALIDA')
  assert.equal(await mal({ billingCycle: 'DAILY' as never }), 'CONFIG_INVALIDA')
  assert.equal(await codigoDe(en(e, (tx) => actualizarConfigEnTx(tx, e.id, { cpaAmount: '1' }, { actor: 'SISTEMA', actorId: null }, T0))), 'SOLO_SUPERADMIN')

  await en(e, (tx) => actualizarConfigEnTx(tx, e.id, { billingCycle: 'MONTHLY' }, superadmin(), T0))

  // Rige hacia adelante: la comisión nueva usa la tarifa nueva, las viejas no cambian.
  const viejas = await prisma.commission.findMany({ where: { companyId: e.id }, select: { id: true, amount: true } })
  const p = await pedidoCompletado({ empresa: e }) // base 250 al 7.5 % = 18.75
  assert.equal((await comisionDe(p.pedidoId))?.amount.toFixed(2), '18.75')
  for (const v of viejas) assert.equal((await prisma.commission.findUniqueOrThrow({ where: { id: v.id } })).amount.toFixed(2), v.amount.toFixed(2))
})

// ── Límite de crédito ────────────────────────────────────────────────────────

test('23 · pasarse del límite pone la cuenta en gracia (7 días); ponerse al día la reactiva; vencida la gracia, el barrido la suspende', async () => {
  const e = E.d
  await en(e, (tx) => actualizarConfigEnTx(tx, e.id, { creditLimit: '300.00', cpaAmount: '100', feeModel: 'CPA_FIXED' }, superadmin(), T0))
  const s0 = new Prisma.Decimal(await saldo(e))
  // Dejar el saldo justo en el límite no es pasarse: «dentro del límite» es saldo ≤ límite.
  const ajuste = new Prisma.Decimal(300).minus(s0)
  if (!ajuste.isZero()) await manual(e, 'ADJUSTMENT', ajuste.toFixed(2), { motivo: 'Dejar el saldo en el límite', ahora: dias(1) })
  assert.equal(await saldo(e), '300.00')
  assert.equal((await cuenta(e)).status, 'ACTIVE', 'en el límite exacto sigue al día')

  const ahora = dias(2)
  await pedidoCompletado({ empresa: e, ahora }) // +100 → 400 > 300
  assert.equal(await saldo(e), '400.00')
  const g = await cuenta(e)
  assert.equal(g.status, 'GRACE_PERIOD')
  assert.equal(g.graceUntil?.getTime(), ahora.getTime() + DIAS_DE_GRACIA * 86_400_000)
  assert.ok(g.statusReason)
  const cambios = await prisma.auditLog.findMany({ where: { companyId: e.id, accion: 'BILLING_STATUS_CHANGED' }, orderBy: { createdAt: 'asc' } })
  assert.equal(cambios.at(-1)?.userId, null, 'lo hizo el sistema')
  assert.equal((cambios.at(-1)?.payload as { a: string }).a, 'GRACE_PERIOD')

  // Otra comisión estando en gracia no reinicia el plazo.
  await pedidoCompletado({ empresa: e, ahora: dias(3) })
  assert.equal((await cuenta(e)).graceUntil?.getTime(), g.graceUntil?.getTime())

  // Un pago que lo deja dentro del límite la reactiva y borra el plazo.
  const r = await manual(e, 'PAYMENT', '250.00', { referencia: 'DEP-1', ahora: dias(4) }) // 500 − 250 = 250 ≤ 300
  assert.equal(r.status, 'ACTIVE')
  const a = await cuenta(e)
  assert.equal(a.status, 'ACTIVE')
  assert.equal(a.graceUntil, null)

  // Se vuelve a pasar; el plazo corre desde ESTE momento. Vencido, el barrido la suspende.
  await pedidoCompletado({ empresa: e, ahora: dias(5) }) // 350 > 300
  const g2 = await cuenta(e)
  assert.equal(g2.status, 'GRACE_PERIOD')
  assert.equal(g2.graceUntil?.getTime(), dias(5).getTime() + DIAS_DE_GRACIA * 86_400_000)
  await barridoFacturacion(new Date(g2.graceUntil!.getTime() - 60_000), { cortes: false })
  assert.equal((await cuenta(e)).status, 'GRACE_PERIOD', 'antes de que venza no se suspende')
  const resultado = await barridoFacturacion(new Date(g2.graceUntil!.getTime() + 60_000), { cortes: false })
  assert.ok(resultado.suspendidas >= 1)
  const s = await cuenta(e)
  assert.equal(s.status, 'SUSPENDED')
  assert.equal(s.graceUntil, null)

  // Un pago que lo deja dentro del límite reactiva también una cuenta suspendida.
  await manual(e, 'PAYMENT', '100.00', { referencia: 'DEP-2', ahora: dias(20) }) // 250 ≤ 300
  assert.equal((await cuenta(e)).status, 'ACTIVE')
})

test('24 · la cuenta puesta en suspensión a mano no se reactiva sola; solo el superadmin la libera', async () => {
  const e = E.d
  const motivo = 'Disputa abierta con la empresa'
  const r = await en(e, (tx) => fijarEstadoManualEnTx(tx, e.id, { accion: 'SUSPENDER', motivo }, superadmin(), dias(21)))
  assert.equal(r.status, 'SUSPENDED')
  const c = await cuenta(e)
  assert.equal(c.holdManual, true)
  assert.equal(c.statusReason, motivo)
  assert.equal((await en(e, (tx) => fijarEstadoManualEnTx(tx, e.id, { accion: 'SUSPENDER', motivo }, superadmin(), dias(21)))).repetido, true)

  await manual(e, 'PAYMENT', '50.00', { referencia: 'DEP-3', ahora: dias(22) })
  assert.equal((await cuenta(e)).status, 'SUSPENDED', 'un pago no la reactiva')
  await barridoFacturacion(dias(60), { cortes: false })
  assert.equal((await cuenta(e)).status, 'SUSPENDED', 'el barrido tampoco')

  assert.equal(await codigoDe(en(e, (tx) => fijarEstadoManualEnTx(tx, e.id, { accion: 'LIBERAR', motivo: '  ' }, superadmin(), dias(23)))), 'MOTIVO_INVALIDO')
  assert.equal(await codigoDe(en(e, (tx) => fijarEstadoManualEnTx(tx, e.id, { accion: 'LIBERAR', motivo: 'ok' }, { actor: 'SISTEMA', actorId: null }, dias(23)))), 'SOLO_SUPERADMIN')
  const l = await en(e, (tx) => fijarEstadoManualEnTx(tx, e.id, { accion: 'LIBERAR', motivo: 'Disputa resuelta' }, superadmin(), dias(23)))
  assert.equal(l.status, 'ACTIVE', 'al liberarla se evalúa contra el saldo (200 ≤ 300)')
  assert.equal((await cuenta(e)).holdManual, false)
  const audit = (await prisma.auditLog.findMany({ where: { companyId: e.id, accion: 'BILLING_STATUS_CHANGED', userId: f.usuario } })).filter((a) => ['SUSPENDER', 'LIBERAR'].includes((a.payload as { accion?: string }).accion ?? ''))
  assert.equal(audit.length, 2, 'suspender y liberar dejan rastro de quién lo hizo')
})

test('25 · bajar el límite por debajo del saldo pone la cuenta en gracia; subirlo la reactiva', async () => {
  const e = E.b
  const s = new Prisma.Decimal(await saldo(e))
  assert.ok(s.greaterThan(0))
  await en(e, (tx) => actualizarConfigEnTx(tx, e.id, { creditLimit: s.minus(1).toFixed(2) }, superadmin(), dias(30)))
  assert.equal((await cuenta(e)).status, 'GRACE_PERIOD')
  await en(e, (tx) => actualizarConfigEnTx(tx, e.id, { creditLimit: s.plus(1).toFixed(2) }, superadmin(), dias(31)))
  assert.equal((await cuenta(e)).status, 'ACTIVE')
})

// ── Concurrencia ─────────────────────────────────────────────────────────────

test('26 · 20 asientos simultáneos a la misma cuenta dejan posiciones 1…n y el saldo exacto', async () => {
  const e = E.e
  const antes = await libro(e)
  const s0 = new Prisma.Decimal(await saldo(e))
  const tareas = Array.from({ length: 20 }, (_, i) => () => manual(e, i % 2 === 0 ? 'ADJUSTMENT' : 'PAYMENT', i % 2 === 0 ? '3.00' : '1.00', { motivo: 'Concurrencia', referencia: `C-${i}` }))
  const resultados = await Promise.all(tareas.map((t) => t()))
  assert.equal(resultados.length, 20)
  const despues = await libro(e)
  assert.equal(despues.length, antes.length + 20)
  despues.forEach((a, i) => assert.equal(a.seq, i + 1))
  assert.equal(await saldo(e), s0.plus(10 * 3).minus(10 * 1).toFixed(2))
  const posiciones = new Set(resultados.map((r) => r.seq))
  assert.equal(posiciones.size, 20, 'cada escritor tuvo su propia posición')
})

test('27 · cerrar varios pedidos a la vez cobra una comisión por cada uno y el libro cuadra', async () => {
  const e = E.e
  const antes = await libro(e)
  const s0 = new Prisma.Decimal(await saldo(e))
  const hechos = await Promise.all(Array.from({ length: 6 }, () => pedidoCompletado({ empresa: e })))
  assert.equal((await libro(e)).length, antes.length + 6)
  for (const h of hechos) assert.ok(await comisionDe(h.pedidoId))
  const sumaComisiones = (await prisma.commission.findMany({ where: { orderId: { in: hechos.map((h) => h.pedidoId) } } })).reduce((t, c) => t.plus(c.amount), new Prisma.Decimal(0))
  assert.equal(await saldo(e), s0.plus(sumaComisiones).toFixed(2))
})

test('28 · cerrar un pedido y que el barrido lo cobre a la vez deja UNA sola comisión', async () => {
  const e = E.e
  const huerfano = await pedidoHuerfano(e)
  const antes = (await libro(e)).length
  const pedido = await prisma.membegoOrder.findUniqueOrThrow({ where: { id: huerfano } })
  // Como en el cierre real: primero el candado del pedido, luego la cuenta (el orden de candados es único).
  const cobrar = () =>
    en(e, async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "membego_orders" WHERE "id" = ${huerfano} FOR UPDATE`
      return registrarComisionDePedidoEnTx(tx, e.id, pedido, SISTEMA, T0)
    })
  const tareas = [cobrar, cobrar, cobrar, () => barridoFacturacion(T0, { cortes: false }).then(() => ({ resultado: 'BARRIDO' as const }))]
  const r = await Promise.all(tareas.map((t) => t()))
  assert.ok(r.filter((x) => x.resultado === 'CREADA').length <= 1, 'a lo sumo uno la creó')
  assert.equal(await prisma.commission.count({ where: { orderId: huerfano } }), 1)
  assert.equal((await libro(e)).length, antes + 1)
})

// ── Barrido ──────────────────────────────────────────────────────────────────

test('29 · el barrido cobra el pedido completado sin comisión, pero no el reembolsado ni el de hace más de 45 días', async () => {
  const e = E.a
  const reciente = await pedidoHuerfano(e)
  const viejo = await pedidoHuerfano(e)
  await prisma.membegoOrder.update({ where: { id: viejo }, data: { completedAt: new Date(T0.getTime() - 60 * 86_400_000) } })
  const r1 = await barridoFacturacion(T0, { cortes: false })
  assert.ok(r1.comisionesCreadas >= 1)
  const c = await comisionDe(reciente)
  assert.ok(c, 'el pedido reciente recibió su comisión')
  assert.equal(c.type, 'CPA_FIXED')
  assert.equal(await comisionDe(viejo), null, 'lo de hace más de 45 días lo decide una persona')
  await barridoFacturacion(T0, { cortes: false })
  assert.equal(await prisma.commission.count({ where: { orderId: reciente } }), 1, 'correrlo otra vez no cobra de nuevo')
})

// ── Cortes ───────────────────────────────────────────────────────────────────

test('30 · un corte mensual cuadra, no admite UPDATE/DELETE y es único por periodo', async () => {
  const e = E.c
  // Cuenta limpia de C: tres meses de movimiento en fechas de Santo Domingo (UTC−4).
  await manual(e, 'ADJUSTMENT', '100.00', { motivo: 'Saldo inicial', ahora: new Date('2031-01-05T15:00:00Z') })
  await manual(e, 'PAYMENT', '40.00', { referencia: 'DEP-A', ahora: new Date('2031-01-20T15:00:00Z') })
  // 2031-02-01T02:00Z es todavía enero en Santo Domingo (31 de enero, 22:00).
  await manual(e, 'ADJUSTMENT', '5.00', { motivo: 'Cierre de enero', ahora: new Date('2031-02-01T02:00:00Z') })
  await manual(e, 'CREDIT', '10.00', { motivo: 'Crédito de febrero', ahora: new Date('2031-02-10T15:00:00Z') })

  const enero = periodoDe(new Date('2031-01-01T04:00:00Z'), new Date('2031-02-01T04:00:00Z'))
  assert.equal(enero.clave, '2031-01-01/2031-02-01')
  assert.equal(await codigoDe(en(e, (tx) => generarCorteEnTx(tx, e.id, enero, new Date('2031-02-01T04:01:00Z')))), 'PERIODO_ABIERTO', 'con el margen de cortesía no se corta recién terminado')
  const ahora = new Date('2031-03-05T12:00:00Z')
  const r = await en(e, (tx) => generarCorteEnTx(tx, e.id, enero, ahora))
  assert.ok(r)
  assert.equal(r.repetido, false)
  const s = await prisma.merchantStatement.findUniqueOrThrow({ where: { id: r.statementId } })
  assert.equal(s.period, '2031-01-01/2031-02-01')
  assert.equal(s.openingBalance.toFixed(2), '0.00')
  assert.equal(s.adjustments.toFixed(2), '105.00', 'los dos ajustes de enero (el de las 22:00 del 31 incluido)')
  assert.equal(s.payments.toFixed(2), '-40.00')
  assert.equal(s.totalCommissions.toFixed(2), '0.00')
  assert.equal(s.closingBalance.toFixed(2), '65.00')
  assert.equal(s.amountDue.toFixed(2), '65.00')
  assert.equal(s.entryCount, 3)
  assert.equal(s.totalOrders, 0)

  // Idempotente: el segundo intento devuelve el primero.
  const otra = await en(e, (tx) => generarCorteEnTx(tx, e.id, enero, ahora))
  assert.equal(otra?.repetido, true)
  assert.equal(otra?.statementId, r.statementId)
  assert.equal(await prisma.merchantStatement.count({ where: { companyId: e.id } }), 1)

  // Inmutable, y la base exige que cuadre.
  assert.match(await rechazo((tx) => tx.$executeRaw`UPDATE "merchant_statements" SET "amountDue" = 0 WHERE "id" = ${s.id}`), /merchant_inmutable/)
  assert.match(await rechazo((tx) => tx.$executeRaw`DELETE FROM "merchant_statements" WHERE "id" = ${s.id}`), /merchant_inmutable/)
  const roto = (o: { cierre?: string; debido?: string; fin?: Date }) => (tx: Prisma.TransactionClient) =>
    tx.$executeRaw`INSERT INTO "merchant_statements" ("id","companyId","period","periodStart","periodEnd","billingCycle","openingBalance","totalOrders","totalGmv","totalCommissions","reversals","adjustments","credits","payments","closingBalance","amountDue","entryCount")
      VALUES (${randomUUID()}, ${e.id}, 'x/y', ${enero.inicio}, ${o.fin ?? enero.fin}, 'MONTHLY', 0, 0, 0, 0, 0, 0, 0, 0, ${o.cierre ?? '0'}::numeric, ${o.debido ?? '0'}::numeric, 0)`
  await acepta(roto({}))
  assert.match(await rechazo(roto({ cierre: '5', debido: '5' })), /merchant_statements_cuadre/)
  assert.match(await rechazo(roto({ fin: enero.inicio })), /merchant_statements_cuadre/)
  const dup = await rechazo(async (tx) => {
    await roto({})(tx)
    await tx.$executeRaw`INSERT INTO "merchant_statements" ("id","companyId","period","periodStart","periodEnd","billingCycle","openingBalance","totalOrders","totalGmv","totalCommissions","reversals","adjustments","credits","payments","closingBalance","amountDue","entryCount")
      VALUES (${randomUUID()}, ${e.id}, ${enero.clave}, ${enero.inicio}, ${enero.fin}, 'MONTHLY', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)`
  })
  assert.match(dup, /already exists|23505|Unique constraint/i)
})

test('30b · un periodo ya cortado no recibe asientos nuevos: el corte quedaría desactualizado', async () => {
  const e = E.c
  // Enero de 2031 ya tiene su corte (prueba anterior): un asiento fechado dentro de él se rechaza…
  // (El servicio nunca escribe en el pasado —fecha el asiento en el último de la cuenta, prueba 36—; la
  // base lo respalda aunque alguien salte el servicio, y es lo que se comprueba aquí.)
  const ultimo = await prisma.merchantLedgerEntry.findFirstOrThrow({ where: { companyId: e.id }, orderBy: { seq: 'desc' } })
  const msg = await rechazo((tx) => tx.$executeRaw`INSERT INTO "merchant_ledger_entries" ("id","companyId","seq","type","amount","balance","currency","referenceType","referenceId","reason","idempotencyKey","createdAt")
    VALUES (${randomUUID()}, ${e.id}, ${ultimo.seq + 1}, 'ADJUSTMENT', 1, ${ultimo.balance.plus(1).toFixed(2)}::numeric, 'DOP', 'MANUAL', 'r', 'x', ${randomUUID()}, ${new Date('2031-01-15T15:00:00Z')})`)
  assert.match(msg, /merchant_ledger_corte/)
  // …y uno de después del corte, no.
  await acepta((tx) => tx.$executeRaw`INSERT INTO "merchant_ledger_entries" ("id","companyId","seq","type","amount","balance","currency","referenceType","referenceId","reason","idempotencyKey","createdAt")
    VALUES (${randomUUID()}, ${e.id}, ${ultimo.seq + 1}, 'ADJUSTMENT', 1, ${ultimo.balance.plus(1).toFixed(2)}::numeric, 'DOP', 'MANUAL', 'r', 'x', ${randomUUID()}, ${new Date('2031-03-15T15:00:00Z')})`)
})

test('31 · los cortes pendientes salen en orden y sin huecos; el saldo se arrastra; un periodo vacío sin saldo se salta', async () => {
  const e = E.c
  const ahora = new Date('2031-05-10T12:00:00Z')
  const pendientes = await en(e, (tx) => periodosPendientesEnTx(tx, e.id, ahora))
  assert.deepEqual(pendientes.map((p) => p.clave), ['2031-02-01/2031-03-01', '2031-03-01/2031-04-01', '2031-04-01/2031-05-01'])
  const r = await en(e, (tx) => generarCortesPendientesEnTx(tx, e.id, ahora))
  assert.deepEqual(r, { generados: 3, saltados: 0 })
  const cortes = await prisma.merchantStatement.findMany({ where: { companyId: e.id }, orderBy: { periodStart: 'asc' } })
  assert.deepEqual(cortes.map((c) => c.period), ['2031-01-01/2031-02-01', '2031-02-01/2031-03-01', '2031-03-01/2031-04-01', '2031-04-01/2031-05-01'])
  const feb = cortes[1]
  assert.equal(feb.openingBalance.toFixed(2), '65.00', 'abre con lo que cerró enero')
  assert.equal(feb.credits.toFixed(2), '-10.00')
  assert.equal(feb.closingBalance.toFixed(2), '55.00')
  // Marzo y abril no tuvieron movimiento pero arrastran 55.00: llevan su corte.
  assert.equal(cortes[2].openingBalance.toFixed(2), '55.00')
  assert.equal(cortes[2].entryCount, 0)
  assert.equal(cortes[2].closingBalance.toFixed(2), '55.00')
  assert.equal(cortes[3].amountDue.toFixed(2), '55.00')
  cortes.forEach((c, i) => {
    if (i > 0) assert.equal(c.openingBalance.toFixed(2), cortes[i - 1].closingBalance.toFixed(2), 'cada corte abre con el cierre del anterior')
    if (i > 0) assert.equal(c.periodStart.getTime(), cortes[i - 1].periodEnd.getTime(), 'sin huecos ni solapes')
  })
  // Correrlo otra vez no genera nada.
  assert.deepEqual(await en(e, (tx) => generarCortesPendientesEnTx(tx, e.id, ahora)), { generados: 0, saltados: 0 })
})

test('32 · el corte cuenta los pedidos y la base comisionable del periodo, y el reverso va aparte', async () => {
  const e = E.e
  // Pedidos de E en un mes limpio (2032-06): uno con CPA, uno con %, y un tercero que se reembolsa.
  const t = new Date('2032-06-10T15:00:00Z')
  const uno = await pedidoCompletado({ empresa: e, ahora: t, cantidad: 2 })
  const dos = await pedidoCompletado({ empresa: e, ahora: t, cantidad: 4, nivel: 'PAYMENT_VERIFIED' })
  const tres = await pedidoCompletado({ empresa: e, ahora: t })
  await en(e, (tx) => reembolsarPedidoEnTx(tx, e.id, tres.pedidoId, { motivo: 'Devolución' }, empresa(f.usuario), new Date('2032-06-12T15:00:00Z')))
  const junio = periodoDe(new Date('2032-06-01T04:00:00Z'), new Date('2032-07-01T04:00:00Z'))
  const r = await en(e, (tx) => generarCorteEnTx(tx, e.id, junio, new Date('2032-07-05T12:00:00Z')))
  assert.ok(r)
  const s = await prisma.merchantStatement.findUniqueOrThrow({ where: { id: r.statementId } })
  const cu = await comisionDe(uno.pedidoId)
  const cd = await comisionDe(dos.pedidoId)
  const ct = await comisionDe(tres.pedidoId)
  assert.equal(s.totalOrders, 3, 'las tres comisiones se cobraron en el periodo (la reembolsada también)')
  assert.equal(s.totalGmv.toFixed(2), '1750.00', '500 + 1000 + 250')
  assert.equal(s.totalCommissions.toFixed(2), new Prisma.Decimal(cu!.amount).plus(cd!.amount).plus(ct!.amount).toFixed(2))
  assert.equal(s.reversals.toFixed(2), ct!.amount.negated().toFixed(2))
  assert.equal(s.closingBalance.toFixed(2), s.openingBalance.plus(s.totalCommissions).plus(s.reversals).plus(s.adjustments).plus(s.credits).plus(s.payments).toFixed(2))
  assert.equal(s.entryCount, 4)
})

test('33 · el barrido emite los cortes que faltan de todas las empresas y es idempotente', async () => {
  const ahora = new Date('2030-06-10T12:00:00Z')
  const antes = await prisma.merchantStatement.count({ where: { companyId: { in: Object.values(E).map((x) => x.id) } } })
  const r1 = await barridoFacturacion(ahora)
  assert.ok(r1.cortes >= 1)
  const despues = await prisma.merchantStatement.count({ where: { companyId: { in: Object.values(E).map((x) => x.id) } } })
  assert.ok(despues > antes)
  assert.equal(r1.errores, 0)
  await barridoFacturacion(ahora)
  assert.equal(await prisma.merchantStatement.count({ where: { companyId: { in: Object.values(E).map((x) => x.id) } } }), despues, 'la segunda pasada no corta nada')
  // Todos los cortes de las empresas de prueba cuadran con su libro.
  for (const e of Object.values(E)) {
    for (const c of await prisma.merchantStatement.findMany({ where: { companyId: e.id } })) {
      const ultimo = await prisma.merchantLedgerEntry.findFirst({ where: { companyId: e.id, createdAt: { lt: c.periodEnd } }, orderBy: { seq: 'desc' } })
      assert.equal(c.closingBalance.toFixed(2), (ultimo?.balance ?? new Prisma.Decimal(0)).toFixed(2), `corte ${c.period}`)
    }
  }
})

test('34 · cambiar de ciclo no deja huecos: el periodo siguiente empieza donde terminó el anterior', async () => {
  const e = E.c
  await en(e, (tx) => actualizarConfigEnTx(tx, e.id, { billingCycle: 'BIWEEKLY' }, superadmin(), new Date('2031-05-01T12:00:00Z')))
  const ahora = new Date('2031-07-20T12:00:00Z')
  const ultimo = await prisma.merchantStatement.findFirstOrThrow({ where: { companyId: e.id }, orderBy: { periodEnd: 'desc' } })
  const pendientes = await en(e, (tx) => periodosPendientesEnTx(tx, e.id, ahora))
  assert.equal(pendientes[0].inicio.getTime(), ultimo.periodEnd.getTime())
  assert.deepEqual(pendientes.slice(0, 4).map((p) => p.clave), ['2031-05-01/2031-05-16', '2031-05-16/2031-06-01', '2031-06-01/2031-06-16', '2031-06-16/2031-07-01'])
  await en(e, (tx) => generarCortesPendientesEnTx(tx, e.id, ahora))
  const cortes = await prisma.merchantStatement.findMany({ where: { companyId: e.id }, orderBy: { periodStart: 'asc' } })
  cortes.forEach((c, i) => {
    if (i > 0) assert.equal(c.periodStart.getTime(), cortes[i - 1].periodEnd.getTime())
  })
})

// ── Endurecimiento tras la auditoría del 2026-10-07 ──────────────────────────

test('35 · una cuenta es de una sola moneda: la comisión de un pedido en otra moneda no se asienta, el pedido sigue LISTO y la base también lo rechaza', async () => {
  const e = E.g
  const usd = await en(e, (tx) => crearItemEnTx(tx, e.id, { name: `Lavado USD ${sufijo}`, type: 'SERVICE', price: 50, currency: 'USD', sku: `BILL-USD-${sufijo}` }, comoInventario(f.usuario)))
  await en(e, (tx) => cambiarEstadoItemEnTx(tx, e.id, usd.id, 'ACTIVE', comoInventario(f.usuario)))
  const variante = (await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: usd.id }, select: { id: true } })).id
  const r = await en(e, (tx) =>
    crearPedidoEnTx(tx, e.id, { customerId: e.cliente, locationId: e.sucursal, origin: 'MARKETPLACE', atribucion: { channel: 'MARKETPLACE_BROWSE' }, lineas: [{ varianteId: variante, cantidad: 1 }], ahora: T0 }, cliente)
  )
  await en(e, (tx) => aceptarPedidoEnTx(tx, e.id, r.pedidoId, empresa(f.usuario), T0))
  const listo = await en(e, (tx) => marcarListoEnTx(tx, e.id, r.pedidoId, empresa(f.usuario), T0))
  // El cierre falla con un mensaje que la persona del escáner entiende y NO deja nada a medias.
  assert.equal(await codigoDe(en(e, (tx) => completarPorQrEnTx(tx, e.id, listo.qrToken as string, empresa(f.usuario), T0))), 'MONEDA_DISTINTA')
  assert.equal((await prisma.membegoOrder.findUniqueOrThrow({ where: { id: r.pedidoId }, select: { status: true } })).status, 'READY', 'el pedido sigue LISTO')
  assert.equal(await comisionDe(r.pedidoId), null)
  assert.equal(await prisma.merchantLedgerEntry.count({ where: { companyId: e.id } }), 0, 'ningún asiento')

  // El servicio de billing, llamado directo, tampoco la asienta.
  const directo = en(e, (tx) =>
    registrarComisionDePedidoEnTx(tx, e.id, { id: r.pedidoId, code: 'MBG-X', origin: 'MARKETPLACE', sourceType: null, commissionableBase: 50, verificationLevel: 'REDEEMED', currency: 'USD' }, SISTEMA, T0)
  )
  assert.equal(await codigoDe(directo), 'MONEDA_DISTINTA')

  // Y la base: con la cuenta creada, un asiento en otra moneda se rechaza.
  await manual(e, 'ADJUSTMENT', '1', { ahora: T0 })
  const ultimo = await prisma.merchantLedgerEntry.findFirstOrThrow({ where: { companyId: e.id }, orderBy: { seq: 'desc' } })
  assert.match(await rechazo((tx) => insertarAsiento(tx, e, { seq: ultimo.seq + 1, type: 'ADJUSTMENT', amount: '5', balance: ultimo.balance.plus(5).toFixed(2), reason: 'x', moneda: 'USD' })), /merchant_ledger_moneda/)
  await acepta((tx) => insertarAsiento(tx, e, { seq: ultimo.seq + 1, type: 'ADJUSTMENT', amount: '5', balance: ultimo.balance.plus(5).toFixed(2), reason: 'x' }))
})

test('36 · el tiempo del libro no retrocede: un asiento con un «ahora» viejo se escribe con la fecha del último, y la base rechaza una fecha anterior', async () => {
  const e = E.g
  const t1 = new Date('2030-03-10T12:00:00.000Z')
  const a = await manual(e, 'ADJUSTMENT', '2', { ahora: t1 })
  // Un escritor que capturó su «ahora» ANTES de esperar el candado llega con una hora anterior.
  const b = await manual(e, 'ADJUSTMENT', '3', { ahora: new Date('2030-03-10T11:00:00.000Z') })
  const filaA = await prisma.merchantLedgerEntry.findUniqueOrThrow({ where: { id: a.entryId } })
  const filaB = await prisma.merchantLedgerEntry.findUniqueOrThrow({ where: { id: b.entryId } })
  assert.equal(filaB.seq, filaA.seq + 1)
  assert.equal(filaA.createdAt.toISOString(), t1.toISOString())
  assert.equal(filaB.createdAt.toISOString(), t1.toISOString(), 'se escribe con la fecha del último, no con la vieja')
  // Uno posterior conserva su hora.
  const t3 = new Date('2030-03-10T13:00:00.000Z')
  const c = await manual(e, 'ADJUSTMENT', '4', { ahora: t3 })
  assert.equal((await prisma.merchantLedgerEntry.findUniqueOrThrow({ where: { id: c.entryId } })).createdAt.toISOString(), t3.toISOString())
  // Y la base lo exige aunque alguien salte el servicio.
  const ultimo = await prisma.merchantLedgerEntry.findFirstOrThrow({ where: { companyId: e.id }, orderBy: { seq: 'desc' } })
  const sig = { seq: ultimo.seq + 1, type: 'ADJUSTMENT', amount: '1', balance: ultimo.balance.plus(1).toFixed(2), reason: 'x' }
  assert.match(await rechazo((tx) => insertarAsiento(tx, e, { ...sig, cuando: new Date('2030-03-09T00:00:00.000Z') })), /merchant_ledger_orden/)
  await acepta((tx) => insertarAsiento(tx, e, { ...sig, cuando: ultimo.createdAt }))
})

test('37 · las claves de las comisiones son del sistema: una clave manual con ese prefijo se rechaza (servicio y base)', async () => {
  const e = E.g
  assert.equal(await codigoDe(manual(e, 'ADJUSTMENT', '1', { clave: 'commission:cualquiera' })), 'CLAVE_INVALIDA')
  assert.equal(await codigoDe(manual(e, 'PAYMENT', '1', { clave: '  Commission:x:reversal ' })), 'CLAVE_INVALIDA')
  const ultimo = await prisma.merchantLedgerEntry.findFirstOrThrow({ where: { companyId: e.id }, orderBy: { seq: 'desc' } })
  const sig = { seq: ultimo.seq + 1, type: 'ADJUSTMENT', amount: '1', balance: ultimo.balance.plus(1).toFixed(2), reason: 'x' }
  assert.match(await rechazo((tx) => insertarAsiento(tx, e, { ...sig, referenceType: 'MANUAL', key: 'commission:robada' })), /clave_comision/)
  assert.match(await rechazo((tx) => insertarAsiento(tx, e, { ...sig, type: 'REDEMPTION_FEE', referenceType: 'COMMISSION', key: 'otra-clave' })), /clave_comision/)
  await acepta((tx) => insertarAsiento(tx, e, { ...sig, type: 'REDEMPTION_FEE', referenceType: 'COMMISSION', key: 'commission:ok' }))
})

test('38 · el mismo depósito no se acredita dos veces en la misma cuenta; reintentar con la misma clave devuelve el original', async () => {
  const e = E.g
  const referencia = `TRF-DUP-${sufijo}`
  const clave = `pago-dup-${sufijo}`
  const primero = await manual(e, 'PAYMENT', '5', { referencia, clave })
  assert.equal(primero.repetido, false)
  assert.equal(await codigoDe(manual(e, 'PAYMENT', '5', { referencia })), 'PAGO_DUPLICADO')
  const reintento = await manual(e, 'PAYMENT', '5', { referencia, clave })
  assert.equal(reintento.repetido, true)
  assert.equal(reintento.entryId, primero.entryId)
  // Otra cuenta sí puede usar esa referencia (es única por cuenta).
  await manual(E.f, 'PAYMENT', '5', { referencia, ahora: new Date('2033-01-01T12:00:00.000Z') })
  // La base lo respalda.
  const ultimo = await prisma.merchantLedgerEntry.findFirstOrThrow({ where: { companyId: e.id }, orderBy: { seq: 'desc' } })
  const pago = { seq: ultimo.seq + 1, type: 'PAYMENT', amount: '-5', balance: ultimo.balance.minus(5).toFixed(2), referenceType: 'PAYMENT', referenceId: referencia }
  assert.match(await rechazo((tx) => insertarAsiento(tx, e, pago)), /23505|already exists|pago_referencia/i)
  await acepta((tx) => insertarAsiento(tx, e, { ...pago, referenceId: `${referencia}-otro` }))
})

test('39 · la antigüedad de la deuda no cuenta como cargo vivo una comisión ya revertida', async () => {
  const e = E.h
  const base = new Date('2030-06-01T10:00:00.000Z')
  const hoy = new Date(base.getTime() + 86_400_000)
  const antes = await sinEmpresa('prueba: antigüedad antes', (tx) => listarCuentasEnTx(tx, {}, hoy))
  // Un cargo de hace 60 días (sigue debido) y otro de hoy que se revierte hoy.
  await pedidoCompletado({ empresa: e, ahora: new Date(base.getTime() - 60 * 86_400_000) })
  const nuevo = await pedidoCompletado({ empresa: e, ahora: base })
  await en(e, (tx) => reembolsarPedidoEnTx(tx, e.id, nuevo.pedidoId, { motivo: 'El cliente devolvió el servicio' }, empresa(f.usuario), base))
  assert.equal(await saldo(e), '100.00', 'queda debiendo solo el cargo viejo (el otro y su reverso se anulan)')
  const despues = await sinEmpresa('prueba: antigüedad después', (tx) => listarCuentasEnTx(tx, {}, hoy))
  const delta = (t: '0-30' | '31-60' | '61-90' | '90+') => new Prisma.Decimal(despues.antiguedad[t]).minus(antes.antiguedad[t]).toFixed(2)
  assert.equal(delta('61-90'), '100.00', 'los 100 son del cargo de hace 61 días')
  assert.equal(delta('0-30'), '0.00', 'no se atribuyen al cargo revertido de hoy')
  assert.equal(delta('31-60'), '0.00')
  assert.equal(delta('90+'), '0.00')
})

test('40 · dos barridos de cortes a la vez con un cambio de ciclo en medio no emiten cortes solapados ni duplicados', async () => {
  const e = E.g
  const ahora = new Date('2030-08-01T12:00:00.000Z')
  const [r1, r2] = await Promise.all([
    en(e, (tx) => generarCortesPendientesEnTx(tx, e.id, ahora)),
    en(e, (tx) => generarCortesPendientesEnTx(tx, e.id, ahora)),
    en(e, (tx) => actualizarConfigEnTx(tx, e.id, { billingCycle: 'BIWEEKLY' }, superadmin(), ahora)),
  ]).then(([a, b]) => [a, b])
  assert.ok(r1.generados + r2.generados >= 1, 'se emitió al menos un corte')
  const cortes = await prisma.merchantStatement.findMany({ where: { companyId: e.id }, orderBy: { periodStart: 'asc' } })
  cortes.forEach((c, i) => {
    if (i > 0) assert.ok(c.periodStart.getTime() >= cortes[i - 1].periodEnd.getTime(), `el corte ${c.period} se solapa con ${cortes[i - 1].period}`)
  })
  assert.equal(new Set(cortes.map((c) => c.period)).size, cortes.length)
  // La suma de lo debido por cortes consecutivos nunca cuenta dos veces lo mismo: cada corte abre con el cierre del anterior.
  cortes.forEach((c, i) => {
    if (i > 0 && c.periodStart.getTime() === cortes[i - 1].periodEnd.getTime()) assert.equal(c.openingBalance.toFixed(2), cortes[i - 1].closingBalance.toFixed(2))
  })
})

// ── Sprint de cierre (2026-10-08): pago verificado DESPUÉS de cobrar el CPA ───

/** La comisión de un pedido con su ajuste por verificación (si lo tiene). */
const comisionCompleta = (pedidoId: string) =>
  prisma.commission.findUniqueOrThrow({ where: { orderId: pedidoId }, include: { verificationAdjustmentEntry: true, verificationAdjustmentReversalEntry: true } })

const verificar = (e: Empresa, pedidoId: string, ref: string, ahora = T0, ctx: ContextoPedido = sistemaPedido) =>
  en(e, (tx) => verificarPagoExternamenteEnTx(tx, e.id, pedidoId, { source: 'GATEWAY_VERIFIED', verificationRef: ref, method: 'CARD', amount: '5000.00', reference: `AUTH-${ref}` }, ctx, ahora))

test('41 · el escenario del plan: cierra con CPA 100 sobre RD$5,000; CardNET confirma después → VERIFICATION_ADJUSTMENT +300 (8 % = 400), sin editar la comisión', async () => {
  const e = E.i
  const p = await pedidoCompletado({ empresa: e, cantidad: 20, nivel: 'EXTERNAL_PAYMENT_REPORTED' }) // base 5000.00; la empresa reportó una transferencia
  assert.equal(p.nivel, 'EXTERNAL_PAYMENT_REPORTED')
  const antes = await comisionDe(p.pedidoId)
  assert.equal(antes?.type, 'CPA_FIXED')
  assert.equal(antes?.amount.toFixed(2), '100.00', 'lo reportado por el negocio cobra CPA')
  const saldo0 = await saldo(e)

  // Verificar sobre una constancia ya reportada por la empresa: la fuente externa la respalda (misma constancia, otra fuente).
  const v = await verificar(e, p.pedidoId, 'cardnet-41')
  assert.equal(v.nivel, 'PAYMENT_VERIFIED')
  assert.equal(v.comision, 'AJUSTADA')

  const c = await comisionCompleta(p.pedidoId)
  assert.equal(c.amount.toFixed(2), '100.00', 'la comisión original no cambia')
  assert.equal(c.type, 'CPA_FIXED')
  assert.equal(c.verificationLevel, 'EXTERNAL_PAYMENT_REPORTED', 'la foto del nivel al cobrar tampoco')
  assert.equal(c.verificationAdjustmentAmount?.toFixed(2), '300.00')
  assert.equal(c.verificationRef, 'cardnet-41')
  assert.ok(c.verificationAdjustedAt)
  assert.equal(c.verificationAdjustmentEntry?.type, 'VERIFICATION_ADJUSTMENT')
  assert.equal(c.verificationAdjustmentEntry?.amount.toFixed(2), '300.00')
  assert.equal(c.verificationAdjustmentEntry?.referenceType, 'COMMISSION')
  assert.equal(c.verificationAdjustmentEntry?.referenceId, c.id)
  assert.equal(c.verificationAdjustmentEntry?.idempotencyKey, `commission:${p.pedidoId}:verification`)
  assert.match(c.verificationAdjustmentEntry?.reason ?? '', /cardnet-41/)
  assert.equal(await saldo(e), new Prisma.Decimal(saldo0).plus(300).toFixed(2), 'la empresa debe 100 + 300 = 400 por ese pedido')

  // Idempotente: la misma referencia externa no asienta nada más; el ajuste solo se hace una vez.
  const otra = await verificar(e, p.pedidoId, 'cardnet-41')
  assert.equal(otra.repetido, true)
  assert.equal((await en(e, (tx) => ajustarComisionPorVerificacionEnTx(tx, e.id, p.pedidoId, { verificationRef: 'cardnet-41', fuente: 'GATEWAY_VERIFIED' }, SISTEMA, T0))).resultado, 'YA_AJUSTADA')
  assert.equal(await saldo(e), new Prisma.Decimal(saldo0).plus(300).toFixed(2))
  assert.equal((await libro(e)).filter((a) => a.type === 'VERIFICATION_ADJUSTMENT' && a.referenceId === c.id).length, 1)
})

test('42 · CONCURRENCIA: dos confirmaciones del mismo pago a la vez dejan UN ajuste y UN asiento', async () => {
  const e = E.i
  const p = await pedidoCompletado({ empresa: e, cantidad: 20, nivel: 'EXTERNAL_PAYMENT_REPORTED' })
  const saldo0 = await saldo(e)
  const resultados = await Promise.allSettled([verificar(e, p.pedidoId, 'cardnet-42'), verificar(e, p.pedidoId, 'cardnet-42'), verificar(e, p.pedidoId, 'cardnet-42')])
  assert.ok(resultados.every((r) => r.status === 'fulfilled'), 'la misma referencia externa es idempotente, no un error')
  const ajustadas = resultados.filter((r) => r.status === 'fulfilled' && r.value.comision === 'AJUSTADA').length
  assert.equal(ajustadas, 1)
  assert.equal((await libro(e)).filter((a) => a.type === 'VERIFICATION_ADJUSTMENT' && a.idempotencyKey === `commission:${p.pedidoId}:verification`).length, 1)
  assert.equal(await saldo(e), new Prisma.Decimal(saldo0).plus(300).toFixed(2))
  // Otra pasarela, otra referencia, mismo pedido ya verificado: se rechaza, no se ajusta dos veces.
  assert.equal(await codigoDe(verificar(e, p.pedidoId, 'otro-hecho-42')), 'PAGO_YA_VERIFICADO')
})

test('43 · reembolsar después del ajuste revierte la comisión Y el ajuste, cada uno con su asiento contrario; el saldo vuelve', async () => {
  const e = E.i
  const p = await pedidoCompletado({ empresa: e, cantidad: 20, nivel: 'EXTERNAL_PAYMENT_REPORTED' })
  const saldo0 = await saldo(e)
  await verificar(e, p.pedidoId, 'cardnet-43')
  assert.equal(await saldo(e), new Prisma.Decimal(saldo0).plus(300).toFixed(2))
  const r = await en(e, (tx) => reembolsarPedidoEnTx(tx, e.id, p.pedidoId, { motivo: 'Devolución' }, empresa(f.usuario), T0))
  assert.equal(r.repetido, false)
  const c = await comisionCompleta(p.pedidoId)
  assert.equal(c.status, 'REVERSED')
  assert.ok(c.reversalEntryId)
  assert.equal(c.verificationAdjustmentReversalEntry?.type, 'REFUND')
  assert.equal(c.verificationAdjustmentReversalEntry?.amount.toFixed(2), '-300.00')
  assert.equal(c.verificationAdjustmentReversalEntry?.idempotencyKey, `commission:${p.pedidoId}:verification:reversal`)
  assert.equal(await saldo(e), new Prisma.Decimal(saldo0).minus(100).toFixed(2), 'se devolvió 100 + 300 sobre un saldo que ya tenía los 100')
  // Reembolsar otra vez no mueve nada.
  const n = (await libro(e)).length
  await en(e, (tx) => reembolsarPedidoEnTx(tx, e.id, p.pedidoId, { motivo: 'otra vez' }, empresa(f.usuario), T0))
  assert.equal((await libro(e)).length, n)
})

test('44 · si el porcentaje es MENOR que el CPA, el ajuste es negativo (la regla es «porcentaje», no «lo que sea mayor») y el corte lo suma con los ajustes', async () => {
  const e = E.i
  const p = await pedidoCompletado({ empresa: e, cantidad: 2, nivel: 'EXTERNAL_PAYMENT_REPORTED' }) // base 500 → 8 % = 40; cobrados 100
  const saldo0 = await saldo(e)
  const v = await en(e, (tx) => verificarPagoExternamenteEnTx(tx, e.id, p.pedidoId, { source: 'BANK_RECONCILED', verificationRef: `banco-44-${sufijo}`, method: 'TRANSFER', amount: '500.00', reference: 'TRF-44' }, sistemaPedido, T0))
  assert.equal(v.comision, 'AJUSTADA')
  const c = await comisionCompleta(p.pedidoId)
  assert.equal(c.verificationAdjustmentAmount?.toFixed(2), '-60.00')
  assert.equal(await saldo(e), new Prisma.Decimal(saldo0).minus(60).toFixed(2))
})

test('45 · no aplica: modelo CPA_FIXED (el CPA es la regla), modelo PERCENTAGE (ya se cobró el porcentaje), ni un pago que solo reportó el negocio', async () => {
  const e = E.i
  // Un pedido verificado ANTES de cerrar bajo HYBRID ya cobró el porcentaje: nada que ajustar.
  const ya = await pedidoCompletado({ empresa: e, cantidad: 20, nivel: 'PAYMENT_VERIFIED' })
  assert.equal((await comisionDe(ya.pedidoId))?.type, 'PERCENTAGE')
  assert.equal((await en(e, (tx) => ajustarComisionPorVerificacionEnTx(tx, e.id, ya.pedidoId, { verificationRef: 'x', fuente: 'GATEWAY_VERIFIED' }, SISTEMA, T0))).resultado, 'NO_APLICA')
  // Solo reportado: nada que ajustar (y la base tampoco lo admitiría: el pedido no está PAYMENT_VERIFIED).
  const rep = await pedidoCompletado({ empresa: e, cantidad: 20, nivel: 'EXTERNAL_PAYMENT_REPORTED' })
  assert.equal((await en(e, (tx) => ajustarComisionPorVerificacionEnTx(tx, e.id, rep.pedidoId, { verificationRef: 'x', fuente: 'GATEWAY_VERIFIED' }, SISTEMA, T0))).resultado, 'NO_APLICA')
  // Modelo CPA_FIXED: verificar sube el nivel pero no toca la comisión.
  await en(e, (tx) => actualizarConfigEnTx(tx, e.id, { feeModel: 'CPA_FIXED' }, superadmin(), T0))
  const fijo = await pedidoCompletado({ empresa: e, cantidad: 20, nivel: 'EXTERNAL_PAYMENT_REPORTED' })
  const v = await verificar(e, fijo.pedidoId, 'cardnet-45')
  assert.equal(v.nivel, 'PAYMENT_VERIFIED')
  assert.equal(v.comision, 'NO_APLICA')
  assert.equal((await comisionCompleta(fijo.pedidoId)).verificationAdjustmentEntryId, null)
  await en(e, (tx) => actualizarConfigEnTx(tx, e.id, { feeModel: 'HYBRID' }, superadmin(), T0))
})

test('46 · la base vigila el ajuste: solo con su asiento exacto, sobre un pedido verificado, una sola vez, sin editarlo después; y el reverso solo con el pedido reembolsado', async () => {
  const e = E.i
  const p = await pedidoCompletado({ empresa: e, cantidad: 20, nivel: 'EXTERNAL_PAYMENT_REPORTED' })
  const c = await comisionDe(p.pedidoId)
  assert.ok(c)
  // Sin asiento: rechazado. Con un asiento de otro tipo/monto: rechazado. Pedido aún no verificado: rechazado.
  assert.match(await rechazo((tx) => tx.$executeRaw`UPDATE "merchant_commissions" SET "verificationAdjustmentAmount" = 300, "verificationAdjustmentEntryId" = 'no-existe', "verificationAdjustedAt" = now(), "verificationRef" = 'r' WHERE "id" = ${c.id}`), /merchant_comision|foreign key|violates/)
  // Ahora sí: verificado por la pasarela → el servicio asienta el ajuste. Intentar cambiarlo después: rechazado.
  await verificar(e, p.pedidoId, 'cardnet-46')
  const con = await comisionCompleta(p.pedidoId)
  assert.ok(con.verificationAdjustmentEntryId)
  assert.match(await rechazo((tx) => tx.$executeRaw`UPDATE "merchant_commissions" SET "verificationAdjustmentAmount" = 999 WHERE "id" = ${c.id}`), /merchant_inmutable|merchant_commissions_ajuste_verificacion/)
  assert.match(await rechazo((tx) => tx.$executeRaw`UPDATE "merchant_commissions" SET "verificationAdjustmentEntryId" = NULL, "verificationAdjustmentAmount" = NULL, "verificationAdjustedAt" = NULL, "verificationRef" = NULL WHERE "id" = ${c.id}`), /merchant_inmutable/)
  // El reverso del ajuste sin el pedido reembolsado: rechazado.
  const asientoFalso = await en(e, (tx) => tx.merchantLedgerEntry.findFirstOrThrow({ where: { companyId: e.id, type: 'REFUND' }, select: { id: true } })).catch(() => null)
  if (asientoFalso) {
    assert.match(await rechazo((tx) => tx.$executeRaw`UPDATE "merchant_commissions" SET "verificationAdjustmentReversalEntryId" = ${asientoFalso.id} WHERE "id" = ${c.id}`), /merchant_comision|merchant_commissions_verificationAdjustmentReversal/)
  }
  // El libro: VERIFICATION_ADJUSTMENT nunca en cero, siempre con motivo y colgado de una comisión.
  const ultimo = (await libro(e)).at(-1)!
  const sig = ultimo.seq + 1
  const saldoCon = (m: string) => ultimo.balance.plus(m).toFixed(2)
  assert.match(await rechazo((tx) => insertarAsiento(tx, e, { seq: sig, type: 'VERIFICATION_ADJUSTMENT', amount: '0', balance: saldoCon('0'), reason: 'x', referenceType: 'COMMISSION', referenceId: c.id, key: `commission:${p.pedidoId}:v0` })), /merchant_ledger_entries_signo/)
  assert.match(await rechazo((tx) => insertarAsiento(tx, e, { seq: sig, type: 'VERIFICATION_ADJUSTMENT', amount: '10', balance: saldoCon('10'), reason: '', referenceType: 'COMMISSION', referenceId: c.id, key: `commission:${p.pedidoId}:v1` })), /merchant_ledger_entries_motivo/)
  assert.match(await rechazo((tx) => insertarAsiento(tx, e, { seq: sig, type: 'VERIFICATION_ADJUSTMENT', amount: '10', balance: saldoCon('10'), reason: 'x', referenceType: 'MANUAL', referenceId: 'm', key: `manual-v2-${sufijo}` })), /merchant_ledger_entries_referencia/)
})

test('47 · ATRIBUCIÓN ≠ CUMPLIMIENTO: un pedido de origen POS con una promoción de Membego comisiona; la venta espontánea de mostrador (DIRECT) y el QR de membresía, no', async () => {
  const e = E.i
  const cerrar = async (atribucion: { channel: 'PROMOTION_CLAIM' | 'DIRECT' | 'QR_SCAN' | 'REFERRAL'; promotionId?: string; referralCode?: string }) => {
    const r = await en(e, (tx) =>
      crearPedidoEnTx(tx, e.id, { customerId: e.cliente, locationId: e.sucursal, origin: 'POS', atribucion, lineas: [{ varianteId: e.servicio, cantidad: 1 }], ahora: T0 }, empresa(f.usuario))
    )
    const listo = await en(e, (tx) => marcarListoEnTx(tx, e.id, r.pedidoId, empresa(f.usuario), T0))
    await en(e, (tx) => completarPorQrEnTx(tx, e.id, listo.qrToken as string, empresa(f.usuario), T0))
    return comisionDe(r.pedidoId)
  }
  const promo = await cerrar({ channel: 'PROMOTION_CLAIM', promotionId: `promo-${sufijo}` })
  assert.equal(promo?.type, 'CPA_FIXED', 'Membego trajo la venta (promoción): comisiona aunque se cumpla en el POS')
  const referido = await cerrar({ channel: 'REFERRAL', referralCode: `REF-${sufijo}` })
  assert.ok(referido, 'un referido de Membego también')
  assert.equal(await cerrar({ channel: 'DIRECT' }), null, 'entró por su cuenta: no hay nada que cobrar')
  assert.equal(await cerrar({ channel: 'QR_SCAN' }), null, 'identificarse con el QR de membresía no demuestra que Membego trajera la venta')
})

test('48 · CONCURRENCIA: verificar el pago y reembolsar el pedido a la vez, en cualquier orden, nunca deja un ajuste sin su reverso ni un saldo que no cuadre', async () => {
  const e = E.i
  for (let ronda = 0; ronda < 4; ronda++) {
    const p = await pedidoCompletado({ empresa: e, cantidad: 20, nivel: 'EXTERNAL_PAYMENT_REPORTED' })
    const saldo0 = await saldo(e) // ya incluye el CPA de 100 de este pedido
    const resultados = await Promise.allSettled([
      verificar(e, p.pedidoId, `cardnet-48-${ronda}`),
      en(e, (tx) => reembolsarPedidoEnTx(tx, e.id, p.pedidoId, { motivo: `Devolución ${ronda}` }, empresa(f.usuario), T0)),
    ])
    // El reembolso siempre se aplica; la verificación puede llegar antes (ajusta y se revierte) o después (el pedido ya no admite ajuste).
    assert.equal(resultados[1].status, 'fulfilled', `ronda ${ronda}: el reembolso no puede perderse`)
    const c = await comisionCompleta(p.pedidoId)
    assert.equal(c.status, 'REVERSED', `ronda ${ronda}`)
    // Con ajuste → tiene SU reverso. Sin ajuste → no hay nada que revertir.
    assert.equal(c.verificationAdjustmentEntryId === null, c.verificationAdjustmentReversalEntryId === null, `ronda ${ronda}: ajuste y reverso van juntos`)
    // Lo que importa para el dinero: el pedido reembolsado no deja nada a cargo de la empresa.
    assert.equal(await saldo(e), new Prisma.Decimal(saldo0).minus(100).toFixed(2), `ronda ${ronda}: el saldo vuelve a antes del pedido`)
    const delPedido = (await libro(e)).filter((a) => a.referenceId === c.id)
    assert.equal(delPedido.reduce((t, a) => t.plus(a.amount), new Prisma.Decimal(0)).toFixed(2), '0.00', `ronda ${ronda}: los asientos de la comisión suman cero`)
  }
})
