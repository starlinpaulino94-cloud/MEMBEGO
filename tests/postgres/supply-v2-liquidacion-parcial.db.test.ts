import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import { prisma } from '../../src/lib/prisma'
import { sinEmpresa } from '../../src/lib/tenant'
import { vincularEmpresaComoProveedorEnTx } from '../../src/modules/supply-v2/suppliers/service'
import { crearItemCatalogoEnTx } from '../../src/modules/supply-v2/catalog/service'
import { activarAcuerdoEnTx, crearAcuerdoEnTx } from '../../src/modules/supply-v2/agreements/service'
import { crearOfertaComisionEnTx, publicarOfertaEnTx } from '../../src/modules/supply-v2/offers/service'
import { abrirOrdenClienteEnTx, confirmarPagoEnTx } from '../../src/modules/supply-v2/commerce/checkout'
import { abrirSesionQrEnTx, confirmarEntregaEnTx, type EmpleadoProveedor } from '../../src/modules/supply-v2/redemption/service'
import { confirmarPagoProveedorEnTx, crearPagoEnTx } from '../../src/modules/supply-v2/finance/payments'
import { aprobarLiquidacionEnTx, generarLiquidacionEnTx, obligacionesLiquidablesEnTx } from '../../src/modules/supply-v2/finance/settlements'

/**
 * CORRECCIÓN PREVIA AL SLICE 7 · UNA OBLIGACIÓN PAGADA A MEDIAS SÍ SE LIQUIDA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL FALLO, QUE AFECTA DINERO REAL
 *
 * `obligacionesLiquidablesEnTx` admite obligaciones `PARTIALLY_PAID` (quien
 * adelantó parte de una entrega tiene que poder liquidar el resto), y la línea
 * de la liquidación se escribe con `supplierNet = outstandingAmount`, que es lo
 * que falta por pagar. Pero el CHECK de la base exigía la IGUALDAD
 * `supplierNet = grossAmount − supplierDiscountAmount − commissionAmount`, que
 * solo se cumple cuando no se ha pagado nada.
 *
 * Resultado: en cuanto un proveedor tenía UNA entrega con un anticipo
 * aplicado, generar su liquidación fallaba con un error crudo de PostgreSQL
 * («violates check constraint») y **todo el periodo quedaba sin liquidar**: ni
 * esa entrega ni las demás. Nadie podía pagarle hasta que alguien mirara los
 * logs. Viene del Slice 5 (el CHECK decía `gross − commission`) y el Slice 6
 * solo le añadió el descuento del proveedor; no lo introdujo, pero tampoco lo
 * vio.
 *
 * LA CORRECCIÓN: la línea y la cabecera guardan lo YA PAGADO
 * (`alreadyPaidAmount` / `alreadyPaidTotal`) y la identidad se cierra EXACTA:
 *
 *   supplierNet = grossAmount − supplierDiscountAmount − commissionAmount − alreadyPaidAmount
 *
 * Así no se relaja el invariante a una desigualdad —que dejaría pasar un neto
 * más bajo por error— y la cifra que falta por pagar queda explicada por una
 * resta auditable. Sin anticipos, `alreadyPaid = 0` y la identidad es la de
 * antes.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const DIA = 86_400_000
const ahora = new Date()
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })

const ctx = {
  compras: '',
  finanzas: '',
  cliente: '',
  sucursal: '',
  empleado: null as unknown as EmpleadoProveedor,
  supplierId: '',
  itemId: '',
  offerId: '',
}
const periodo = { periodStart: new Date(ahora.getTime() - 7 * DIA), periodEnd: new Date(ahora.getTime() + 7 * DIA) }

before(async () => {
  const [compras, finanzas, cliente, pedro] = await Promise.all(
    (
      [
        ['compras', 'SUPERADMIN'],
        ['finanzas', 'SUPERADMIN'],
        ['cliente', 'CLIENTE'],
        ['pedro', 'ADMINISTRADOR'],
      ] as const
    ).map(([k, role]) => prisma.user.create({ data: { supabaseId: `sb-lp-${k}-${sufijo}`, email: `lp-${k}-${sufijo}@prueba.test`, name: `lp ${k}`, role }, select: { id: true } }))
  )
  ctx.compras = compras.id
  ctx.finanzas = finanzas.id
  ctx.cliente = cliente.id
  const empresa = await prisma.company.create({ data: { name: `Tours Parcial ${sufijo}`, slug: `tours-parcial-${sufijo}`, type: 'restaurante', capacidades: { overrides: { MEMBEGO_SUPPLIER: true } } }, select: { id: true } })
  ctx.sucursal = (await prisma.sucursal.create({ data: { companyId: empresa.id, nombre: 'Bávaro' }, select: { id: true } })).id
  await prisma.user.update({ where: { id: pedro.id }, data: { companyId: empresa.id } })

  await sinEmpresa('prueba', async (tx) => {
    const p = await vincularEmpresaComoProveedorEnTx(tx, empresa.id, {}, como(ctx.compras))
    ctx.supplierId = p.id
    ctx.empleado = { userId: pedro.id, companyId: empresa.id, supplierId: p.id }
    ctx.itemId = (await crearItemCatalogoEnTx(tx, { supplierId: p.id, type: 'SERVICE', name: `Excursión Parcial ${sufijo}`, category: 'Tours', publicPrice: 1200 }, como(ctx.compras))).id
    const a = await crearAcuerdoEnTx(tx, { supplierId: p.id, type: 'COMMISSION', scope: 'ITEM', catalogItemId: ctx.itemId, commissionPercentage: 10, startsAt: new Date(ahora.getTime() - DIA) }, como(ctx.compras))
    await activarAcuerdoEnTx(tx, a.id, como(ctx.finanzas))
    const o = await crearOfertaComisionEnTx(
      tx,
      { catalogItemId: ctx.itemId, title: `Parcial ${sufijo}`, publicPrice: 1200, salePrice: 1000, availabilityMode: 'UNLIMITED', perCustomerLimit: 5, startsAt: new Date(ahora.getTime() - 60_000), endsAt: new Date(ahora.getTime() + 30 * DIA) },
      como(ctx.compras)
    )
    await publicarOfertaEnTx(tx, o.id, como(ctx.compras))
    ctx.offerId = o.id
  })
})

/** Vende, cobra y entrega una unidad. Devuelve la obligación con el proveedor (neto 900). */
async function ventaEntregada(): Promise<{ obligationId: string; outstanding: string }> {
  const orden = await sinEmpresa('prueba', (tx) => abrirOrdenClienteEnTx(tx, { customerId: ctx.cliente, offerId: ctx.offerId, quantity: 1 }, como(ctx.cliente)))
  const pago = await sinEmpresa('prueba', (tx) => confirmarPagoEnTx(tx, { orderId: orden.id, amountSeen: orden.total }, como(ctx.finanzas)))
  const s = await sinEmpresa('prueba', (tx) => abrirSesionQrEnTx(tx, { entitlementId: pago.entitlements[0]!.id, customerId: ctx.cliente, branchId: ctx.sucursal }, como(ctx.cliente)))
  const r = await sinEmpresa('prueba', (tx) => confirmarEntregaEnTx(tx, { nonce: s.nonce, empleado: ctx.empleado, branchId: ctx.sucursal }, como(ctx.empleado.userId)))
  const ob = await prisma.supplyV2SupplierObligation.findUniqueOrThrow({ where: { redemptionId: r.id } })
  return { obligationId: ob.id, outstanding: ob.outstandingAmount.toFixed(2) }
}

/** Adelanta `monto` directamente contra una obligación: queda PARTIALLY_PAID. */
async function anticipar(obligationId: string, monto: number, clave: string): Promise<void> {
  const p = await sinEmpresa('prueba', (tx) =>
    crearPagoEnTx(tx, { supplierId: ctx.supplierId, method: 'BANK_TRANSFER', amount: monto, obligationId, reference: clave, idempotencyKey: clave }, como(ctx.compras))
  )
  await sinEmpresa('prueba', (tx) => confirmarPagoProveedorEnTx(tx, p.id, como(ctx.finanzas)))
}

test('una obligación con un anticipo aplicado sigue siendo liquidable, y la liquidación cuadra por su saldo', async () => {
  const v = await ventaEntregada()
  assert.equal(v.outstanding, '900.00', 'la deuda nace por el neto contractual')

  // Anticipo de 400: la obligación queda pagada a medias con 500 pendientes.
  await anticipar(v.obligationId, 400, `ANT-${sufijo}-A`)
  const parcial = await prisma.supplyV2SupplierObligation.findUniqueOrThrow({ where: { id: v.obligationId } })
  assert.deepEqual([parcial.status, parcial.paidAmount.toFixed(2), parcial.outstandingAmount.toFixed(2)], ['PARTIALLY_PAID', '400.00', '500.00'])

  // Sigue siendo liquidable: quien adelantó parte tiene que poder cerrar el resto.
  const liquidables = await sinEmpresa('prueba', (tx) => obligacionesLiquidablesEnTx(tx, ctx.supplierId, periodo.periodStart, periodo.periodEnd, 'DOP'))
  assert.ok(liquidables.some((o) => o.id === v.obligationId), 'una obligación pagada a medias entra en la liquidación')

  // ANTES DE LA CORRECCIÓN esta llamada moría con «violates check constraint
  // supply_v2_settlement_lines_money» y dejaba al proveedor sin poder cobrar.
  const l = await sinEmpresa('prueba', (tx) => generarLiquidacionEnTx(tx, { supplierId: ctx.supplierId, frequency: 'MANUAL', ...periodo }, como(ctx.compras)))
  const liq = await prisma.supplyV2Settlement.findUniqueOrThrow({ where: { id: l.id }, include: { lines: true } })
  const linea = liq.lines.find((x) => x.obligationId === v.obligationId)!
  assert.ok(linea, 'la entrega con anticipo está en la liquidación')

  // La identidad cierra EXACTA, con lo ya pagado explicando la diferencia.
  assert.equal(linea.grossAmount.toFixed(2), '1000.00')
  assert.equal(linea.commissionAmount.toFixed(2), '100.00')
  assert.equal(linea.alreadyPaidAmount.toFixed(2), '400.00')
  assert.equal(linea.supplierNet.toFixed(2), '500.00')
  assert.equal(
    linea.grossAmount.minus(linea.supplierDiscountAmount).minus(linea.commissionAmount).minus(linea.alreadyPaidAmount).toFixed(2),
    linea.supplierNet.toFixed(2),
    'neto = bruto − descuento − comisión − ya pagado'
  )
  // Y la cabecera suma sus líneas, sin recalcular nada.
  assert.equal(liq.alreadyPaidTotal.toFixed(2), liq.lines.reduce((t, x) => t.plus(x.alreadyPaidAmount), new Prisma.Decimal(0)).toFixed(2))
  assert.equal(liq.supplierNet.toFixed(2), liq.grossSales.minus(liq.supplierDiscountTotal).minus(liq.commissionAmount).minus(liq.alreadyPaidTotal).toFixed(2))

  // Lo que queda por pagar es el saldo, no el neto completo: no se sobrepaga.
  await sinEmpresa('prueba', (tx) => aprobarLiquidacionEnTx(tx, l.id, como(ctx.finanzas)))
  // Y nace con CERO pagado contra ella: el anticipo anterior no cuenta como
  // pagado aquí (si contara, al proveedor se le quedarían debiendo los 400).
  const aprobada = await prisma.supplyV2Settlement.findUniqueOrThrow({ where: { id: l.id } })
  assert.deepEqual([aprobada.status, aprobada.paidAmount.toFixed(2), aprobada.supplierNet.toFixed(2)], ['APPROVED', '0.00', '500.00'])
  await assert.rejects(
    sinEmpresa('prueba', (tx) => crearPagoEnTx(tx, { supplierId: ctx.supplierId, method: 'BANK_TRANSFER', amount: 900, settlementId: l.id }, como(ctx.compras))),
    /sobrepagar/,
    'pagar los 900 completos sobre una liquidación de 500 se rechaza'
  )
  const pago = await sinEmpresa('prueba', (tx) => crearPagoEnTx(tx, { supplierId: ctx.supplierId, method: 'BANK_TRANSFER', amount: 500, settlementId: l.id, idempotencyKey: `liq-${sufijo}` }, como(ctx.compras)))
  await sinEmpresa('prueba', (tx) => confirmarPagoProveedorEnTx(tx, pago.id, como(ctx.finanzas)))
  const cerrada = await prisma.supplyV2Settlement.findUniqueOrThrow({ where: { id: l.id } })
  assert.deepEqual([cerrada.status, cerrada.paidAmount.toFixed(2)], ['PAID', '500.00'])
  const saldada = await prisma.supplyV2SupplierObligation.findUniqueOrThrow({ where: { id: v.obligationId } })
  assert.deepEqual([saldada.status, saldada.paidAmount.toFixed(2), saldada.outstandingAmount.toFixed(2)], ['PAID', '900.00', '0.00'], 'entre el anticipo y la liquidación se paga exactamente el neto')
})

test('una liquidación sin anticipos mantiene la identidad de siempre (ya pagado = 0)', async () => {
  const v = await ventaEntregada()
  const l = await sinEmpresa('prueba', (tx) => generarLiquidacionEnTx(tx, { supplierId: ctx.supplierId, frequency: 'MANUAL', ...periodo }, como(ctx.compras)))
  const liq = await prisma.supplyV2Settlement.findUniqueOrThrow({ where: { id: l.id }, include: { lines: true } })
  const linea = liq.lines.find((x) => x.obligationId === v.obligationId)!
  assert.equal(linea.alreadyPaidAmount.toFixed(2), '0.00')
  assert.equal(linea.supplierNet.toFixed(2), '900.00')
  assert.equal(liq.alreadyPaidTotal.toFixed(2), '0.00')
  assert.equal(liq.supplierNet.toFixed(2), liq.grossSales.minus(liq.commissionAmount).toFixed(2), 'sin descuentos ni anticipos, neto = bruto − comisión')
})

test('la base rechaza una línea cuyo neto no cuadre con la resta completa', async () => {
  const l = await prisma.supplyV2SettlementLine.findFirstOrThrow({ orderBy: { createdAt: 'desc' }, select: { id: true } })
  await assert.rejects(
    prisma.$executeRaw`UPDATE "supply_v2_settlement_lines" SET "supplierNet" = "supplierNet" + 1 WHERE "id" = ${l.id}`,
    /supply_v2_settlement_lines_money/,
    'el CHECK sigue siendo una igualdad, no una desigualdad que deje pasar cualquier neto'
  )
})
