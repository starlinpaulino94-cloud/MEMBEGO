import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { sinEmpresa } from '../../src/lib/tenant'
import { abrirSesionQrEnTx, confirmarEntregaEnTx } from '../../src/modules/supply-v2/redemption/service'
import {
  abrirVisitaDeRedencionEnTx,
  cerrarVisitaEnTx,
  cerrarVisitasVencidasEnTx,
  confirmarVisitaComoClienteEnTx,
  disputarVisitaComoClienteEnTx,
  registrarVentaAdicionalEnTx,
  resolverDisputaEnTx,
  reversarVentaAdicionalEnTx,
  verificarPagoDeVentaAdicionalEnTx,
} from '../../src/modules/visitas-membego/service'
import { guardarExtraEnTx } from '../../src/modules/visitas-membego/extras'
import { miVisita, resumenDeExtrasDeLaEmpresa, visitaDeLaEmpresa } from '../../src/modules/visitas-membego/queries'
import { saldoEnTx } from '../../src/modules/billing/service'
import { como, montarSupplierLite, type ArnesSupplierLite } from './supplier-lite-arnes'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · Slices 5–8 contra PostgreSQL (E2E 2, 3, 4, 7 y 8 del documento).
 *
 *   Membego compró 1.000 cappuccinos a RD$120; Juan compró 2 a RD$150 (Precio Membego).
 *   1  Juan llega; el operador escanea → la entrega abre la visita (origen Supply, política 8 %, ventana 120 min).
 *      Dos escáneres con la misma entrega → UNA visita. Supply: 1 redimida.
 *   2  Registra Refresco RD$150 + Postre RD$250 (precios releídos) → venta 400; comisión 8 % = RD$32 asentada
 *      en el libro de Merchant Billing de la empresa (ANCILLARY_FEE). Supply Economics no se toca.
 *      La misma venta mandada dos veces → un registro, un asiento. La pizza (unidad de Membego) no es base.
 *   3  Cierra la visita → el cliente confirma RD$400 → CUSTOMER_CONFIRMED (no PAYMENT_VERIFIED). Idempotente.
 *   4  Otra visita: reporta RD$400, el cliente dice «solo compré RD$150» → disputa → superadmin resuelve a favor
 *      del cliente → ajuste −RD$20 en el libro; nada se edita ni se borra.
 *   5  Reversa de una venta → REFUND de su comisión; ventana vencida → la visita se cierra sola y no admite más.
 *   6  Seguridad: otro proveedor no abre, no registra ni ve esta visita; el cliente ajeno no confirma.
 *
 * `npm run test:db`.
 */

let a: ArnesSupplierLite
let visitId = ''
let ventaId = ''
let redencionId = ''
let refrescoId = ''
let postreId = ''

const libro = (companyId: string) => prisma.merchantLedgerEntry.findMany({ where: { companyId }, orderBy: { seq: 'asc' } })

before(async () => {
  a = await montarSupplierLite({ prefijo: 'vis', unidadesCompradas: 1000, unidadesCliente: 2, precioMembego: 150, costo: 120 })
  // El mini catálogo del proveedor (§26): Refresco y Postre; la pizza no es un extra.
  await sinEmpresa('prueba', async (tx) => {
    refrescoId = (await guardarExtraEnTx(tx, { supplierId: a.supplierId, companyId: a.companyId, name: 'Refresco', price: 150, activo: true }, como(a.duenoId))).id
    postreId = (await guardarExtraEnTx(tx, { supplierId: a.supplierId, companyId: a.companyId, name: 'Postre', price: '250.00', activo: true }, como(a.duenoId))).id
  })
})

async function entregar(entitlementId: string, clave: string) {
  const qr = await sinEmpresa('prueba', (tx) => abrirSesionQrEnTx(tx, { entitlementId, customerId: a.cliente, branchId: a.sucursalId }, como(a.cliente)))
  return sinEmpresa('prueba', (tx) => confirmarEntregaEnTx(tx, { nonce: qr.nonce, empleado: a.empleado, branchId: a.sucursalId, idempotencyKey: clave }, como(a.duenoId)))
}

test('1 · la entrega abre la visita (origen Supply, política congelada) y dos escáneres no abren dos', async () => {
  const r = await entregar(a.entitlements[0]!, `vis-1-${a.sufijo}`)
  redencionId = r.id
  const [v1, v2] = await Promise.all([
    sinEmpresa('prueba', (tx) => abrirVisitaDeRedencionEnTx(tx, { redemptionId: r.id, operador: a.empleado, branchId: a.sucursalId }, como(a.duenoId))),
    sinEmpresa('prueba', (tx) => abrirVisitaDeRedencionEnTx(tx, { redemptionId: r.id, operador: a.empleado, branchId: a.sucursalId }, como(a.duenoId))),
  ])
  assert.equal(v1.id, v2.id, 'una visita por redención')
  visitId = v1.id
  assert.match(v1.number, /^MBG-VI-\d{4}-\d{6}$/)
  assert.equal(v1.status, 'OPEN')
  assert.equal(v1.customerName, 'Juan Pérez')
  assert.deepEqual(v1.incluido, { producto: 'Cappuccino grande', cantidad: 1 })
  assert.equal(v1.politica.ancillaryCommissionRate, '8.00', 'sin tasa contractual, la de plataforma')
  assert.equal(v1.politica.attributionWindowMinutes, 120)
  assert.equal(await prisma.membegoVisit.count({ where: { redemptionId: r.id } }), 1)
  const fila = await prisma.membegoVisit.findUniqueOrThrow({ where: { id: v1.id } })
  assert.equal(fila.origin, 'MEMBEGO_SUPPLY')
  assert.equal(fila.attributionChannel, 'SUPPLY_OFFER')
  assert.equal(fila.sourceType, 'ENTITLEMENT')
  assert.equal(fila.locationId, a.sucursalId)
  assert.equal(fila.companyId, a.companyId)
  // Supply: una unidad redimida; nada de comisión por ella.
  const lote = await prisma.supplyV2Lot.findUniqueOrThrow({ where: { id: a.lotId } })
  assert.equal(lote.quantityRedeemed, 1)
  assert.equal(await prisma.supplyV2OutboxEvent.count({ where: { eventType: 'visit.opened', aggregateId: v1.id } }), 1)
})

test('2 · extras RD$150 + RD$250 (precios del servidor) → venta 400, comisión 8 % = 32 en el libro; dos envíos = un asiento; Supply intacto', async () => {
  const clave = `venta-${a.sufijo}`
  const lineas = [
    { supplyCatalogItemId: refrescoId, quantity: 1, unitPrice: '1.00' },
    { supplyCatalogItemId: postreId, quantity: 1, unitPrice: '9999.00' },
  ]
  const [r1, r2] = await Promise.all([
    sinEmpresa('prueba', (tx) => registrarVentaAdicionalEnTx(tx, { visitId, operador: a.empleado, lineas, idempotencyKey: clave }, como(a.duenoId))),
    sinEmpresa('prueba', (tx) => registrarVentaAdicionalEnTx(tx, { visitId, operador: a.empleado, lineas, idempotencyKey: clave }, como(a.duenoId))),
  ])
  assert.equal(r1.id, r2.id, 'la misma venta dos veces es un registro (§56)')
  ventaId = r1.id
  assert.equal(r1.subtotal, '400.00', 'los precios del navegador (1 y 9999) se ignoran')
  assert.equal(r1.commissionBase, '400.00')
  assert.equal(r1.commissionRate, '8.00')
  assert.equal(r1.commissionAmount, '32.00')
  assert.equal(r1.commissionStatus, 'POSTED', 'sin confirmación obligatoria, se asienta al reportar')
  assert.equal(r1.visita.ancillaryTotal, '400.00')
  assert.equal(r1.visita.commissionTotal, '32.00')

  const asientos = await libro(a.companyId)
  const cargos = asientos.filter((e) => e.type === 'ANCILLARY_FEE')
  assert.equal(cargos.length, 1, 'un solo asiento de comisión (§63)')
  assert.equal(cargos[0]!.amount.toFixed(2), '32.00')
  assert.equal(cargos[0]!.referenceType, 'ANCILLARY_SALE')
  assert.equal(cargos[0]!.referenceId, ventaId)
  assert.equal(cargos[0]!.idempotencyKey, `ancillary:${ventaId}`)
  assert.equal(asientos.filter((e) => e.referenceType === 'COMMISSION').length, 0, 'la unidad de Membego NO genera comisión Merchant (§63, §72)')
  assert.equal((await sinEmpresa('prueba', (tx) => saldoEnTx(tx, a.companyId))).toFixed(2), '32.00')
  // Supply Economics y Merchant Billing separados: la obligación/ledger de Supply no cambió por la venta adicional.
  assert.equal(await prisma.supplyV2LedgerEntry.count({ where: { lotId: a.lotId, type: 'REDEMPTION' } }), 1)
  assert.equal(await prisma.supplyV2EconomicEvent.count({ where: { referenceType: 'REDEMPTION', referenceId: redencionId, type: 'COMMISSION_REVENUE' } }), 0)
  const venta = await prisma.ancillarySale.findUniqueOrThrow({ where: { id: ventaId }, include: { lines: true } })
  assert.equal(venta.evidenceLevel, 'MERCHANT_REPORTED')
  assert.equal(venta.lines.length, 2)
  assert.deepEqual(venta.lines.map((l) => l.priceSource), ['CATALOG', 'CATALOG'])
  assert.ok(venta.ledgerEntryId)
  // Las líneas son inmutables.
  await assert.rejects(prisma.ancillarySaleLine.update({ where: { id: venta.lines[0]!.id }, data: { unitPrice: 1 } }), /no se edita/)
  // Una línea personalizada queda marcada y auditada (§55).
  const custom = await sinEmpresa('prueba', (tx) => registrarVentaAdicionalEnTx(tx, { visitId, operador: a.empleado, lineas: [{ description: 'Servilletas bordadas', quantity: 2, unitPrice: '25.50' }], idempotencyKey: `custom-${a.sufijo}` }, como(a.duenoId)))
  assert.equal(custom.hasCustomLines, true)
  assert.equal(custom.subtotal, '51.00')
  assert.equal(custom.commissionAmount, '4.08')
  const auditoria = await prisma.auditLog.findFirst({ where: { accion: 'ANCILLARY_SALE_RECORDED', entidadId: custom.id } })
  assert.ok(auditoria && JSON.stringify(auditoria.payload).includes('Servilletas bordadas'))
  await sinEmpresa('prueba', (tx) => reversarVentaAdicionalEnTx(tx, { saleId: custom.id, operador: a.empleado, motivo: 'Se registró por error' }, como(a.duenoId)))
  const totalesVisita = await prisma.membegoVisit.findUniqueOrThrow({ where: { id: visitId } })
  assert.equal(totalesVisita.ancillaryTotal.toFixed(2), '400.00')
})

test('3 · cerrar la visita y la confirmación del cliente: MERCHANT_REPORTED → CUSTOMER_CONFIRMED, nunca PAYMENT_VERIFIED; idempotente', async () => {
  const cierre = await sinEmpresa('prueba', (tx) => cerrarVisitaEnTx(tx, { visitId, operador: a.empleado }, como(a.duenoId)))
  assert.equal(cierre.ancillaryTotal, '400.00')
  assert.equal((await sinEmpresa('prueba', (tx) => cerrarVisitaEnTx(tx, { visitId, operador: a.empleado }, como(a.duenoId)))).repetida, true)
  assert.equal(await prisma.supplyV2OutboxEvent.count({ where: { eventType: 'visit.closed', aggregateId: visitId } }), 1)
  // Cerrada: no admite más compras.
  await assert.rejects(sinEmpresa('prueba', (tx) => registrarVentaAdicionalEnTx(tx, { visitId, operador: a.empleado, lineas: [{ supplyCatalogItemId: refrescoId, quantity: 1 }], idempotencyKey: `tarde-${a.sufijo}` }, como(a.duenoId))), /cerrada/)

  await assert.rejects(sinEmpresa('prueba', (tx) => confirmarVisitaComoClienteEnTx(tx, { visitId, customerUserId: a.cliente, totalVisto: '399.00' }, como(a.cliente))), /total/)
  const [c1, c2] = await Promise.all([
    sinEmpresa('prueba', (tx) => confirmarVisitaComoClienteEnTx(tx, { visitId, customerUserId: a.cliente, totalVisto: '400.00' }, como(a.cliente))),
    sinEmpresa('prueba', (tx) => confirmarVisitaComoClienteEnTx(tx, { visitId, customerUserId: a.cliente, totalVisto: 400 }, como(a.cliente))),
  ])
  assert.equal(c1.confirmadas + c2.confirmadas, 1, 'una sola confirmación cuenta')
  const venta = await prisma.ancillarySale.findUniqueOrThrow({ where: { id: ventaId } })
  assert.equal(venta.status, 'CONFIRMED')
  assert.equal(venta.evidenceLevel, 'CUSTOMER_CONFIRMED')
  assert.equal(venta.paymentVerifiedAt, null, 'la confirmación del cliente NO es pago verificado (§33)')
  assert.equal((await prisma.membegoVisit.findUniqueOrThrow({ where: { id: visitId } })).customerConfirmedTotal?.toFixed(2), '400.00')
  assert.equal((await libro(a.companyId)).filter((e) => e.type === 'ANCILLARY_FEE' && e.referenceId === ventaId).length, 1, 'confirmar no duplica la comisión')
  // La evidencia externa solo con referencia (sistema/superadmin), y sube a PAYMENT_VERIFIED.
  await assert.rejects(sinEmpresa('prueba', (tx) => verificarPagoDeVentaAdicionalEnTx(tx, { saleId: ventaId, referencia: ' ' }, como(a.admin))), /referencia/)
  await sinEmpresa('prueba', (tx) => verificarPagoDeVentaAdicionalEnTx(tx, { saleId: ventaId, referencia: 'POS-0001' }, como(a.admin)))
  assert.equal((await prisma.ancillarySale.findUniqueOrThrow({ where: { id: ventaId } })).evidenceLevel, 'PAYMENT_VERIFIED')
  // Lo que ven el cliente y el proveedor.
  const mia = await miVisita(a.cliente, visitId)
  assert.equal(mia?.ventas.length, 2)
  assert.equal(mia?.ancillaryTotal, '400.00')
  const suya = await visitaDeLaEmpresa(a.companyId, visitId)
  assert.equal(suya?.commissionTotal, '32.00')
})

test('4 · disputa: reportan 400, el cliente reconoce 150 → a favor del cliente → ajuste −20; comisión original intacta; nada se borra', async () => {
  const r = await entregar(a.entitlements[1]!, `vis-4-${a.sufijo}`)
  const v = await sinEmpresa('prueba', (tx) => abrirVisitaDeRedencionEnTx(tx, { redemptionId: r.id, operador: a.empleado }, como(a.duenoId)))
  const venta = await sinEmpresa('prueba', (tx) => registrarVentaAdicionalEnTx(tx, { visitId: v.id, operador: a.empleado, lineas: [{ supplyCatalogItemId: refrescoId, quantity: 1 }, { supplyCatalogItemId: postreId, quantity: 1 }], idempotencyKey: `venta4-${a.sufijo}` }, como(a.duenoId)))
  await sinEmpresa('prueba', (tx) => cerrarVisitaEnTx(tx, { visitId: v.id, operador: a.empleado }, como(a.duenoId)))

  const d = await sinEmpresa('prueba', (tx) => disputarVisitaComoClienteEnTx(tx, { visitId: v.id, customerUserId: a.cliente, saleId: venta.id, claim: 'Solo compré el refresco', claimedTotal: '150' }, como(a.cliente)))
  assert.equal(d.repetida, false)
  assert.equal((await sinEmpresa('prueba', (tx) => disputarVisitaComoClienteEnTx(tx, { visitId: v.id, customerUserId: a.cliente, saleId: venta.id, claim: 'Solo compré el refresco', claimedTotal: '150' }, como(a.cliente)))).repetida, true, 'una disputa viva por venta')
  assert.equal((await prisma.ancillarySale.findUniqueOrThrow({ where: { id: venta.id } })).status, 'DISPUTED')
  assert.equal(await prisma.supplyV2OutboxEvent.count({ where: { eventType: 'visit.disputed', aggregateId: v.id } }), 1)

  const res = await sinEmpresa('prueba', (tx) => resolverDisputaEnTx(tx, { disputeId: d.id, resolucion: 'RESOLVED_CUSTOMER', notas: 'El ticket muestra solo el refresco.' }, como(a.admin)))
  assert.equal(res.resultado, 'AJUSTE')
  assert.equal(res.delta, '-20.00', '8 % de (400 − 150)')
  assert.equal((await sinEmpresa('prueba', (tx) => resolverDisputaEnTx(tx, { disputeId: d.id, resolucion: 'RESOLVED_CUSTOMER', notas: 'otra vez' }, como(a.admin)))).repetida, true)
  const final = await prisma.ancillarySale.findUniqueOrThrow({ where: { id: venta.id } })
  assert.equal(final.status, 'ADJUSTED')
  assert.equal(final.commissionAmount.toFixed(2), '32.00', 'la comisión histórica no se edita (§35)')
  assert.ok(final.adjustmentEntryId)
  const asientos = await libro(a.companyId)
  const ajuste = asientos.find((e) => e.id === final.adjustmentEntryId)!
  assert.equal(ajuste.type, 'ADJUSTMENT')
  assert.equal(ajuste.amount.toFixed(2), '-20.00')
  assert.equal(ajuste.referenceType, 'ANCILLARY_SALE')
  assert.equal(ajuste.idempotencyKey, `ancillary:${venta.id}:dispute:${d.id}`)
  const disputa = await prisma.visitDispute.findUniqueOrThrow({ where: { id: d.id } })
  assert.equal(disputa.status, 'RESOLVED_CUSTOMER')
  assert.equal(disputa.resolvedBase?.toFixed(2), '150.00')
  assert.equal((await prisma.membegoVisit.findUniqueOrThrow({ where: { id: v.id } })).commissionTotal.toFixed(2), '32.00', 'el caché muestra lo asentado como cargo; el saldo real del libro lleva el ajuste')
  assert.equal((await sinEmpresa('prueba', (tx) => saldoEnTx(tx, a.companyId))).toFixed(2), '44.00', '32 + 32 − 20')
  // Nada se borra.
  await assert.rejects(prisma.ancillarySale.delete({ where: { id: venta.id } }), /no se borra/)
  await assert.rejects(prisma.visitDispute.delete({ where: { id: d.id } }), /no se borra/)
})

test('5 · reversa total → REFUND de la comisión; ventana vencida → la visita se cierra sola y no admite más compras', async () => {
  const saldoAntes = await sinEmpresa('prueba', (tx) => saldoEnTx(tx, a.companyId))
  // Reversa de la venta confirmada de la visita 1 (p. ej. devolución en caja).
  await sinEmpresa('prueba', (tx) => reversarVentaAdicionalEnTx(tx, { saleId: ventaId, operador: a.empleado, motivo: 'Devolución en caja' }, como(a.duenoId)))
  const venta = await prisma.ancillarySale.findUniqueOrThrow({ where: { id: ventaId } })
  assert.equal(venta.status, 'REVERSED')
  assert.equal(venta.commissionStatus, 'REVERSED')
  assert.ok(venta.reversalEntryId)
  const reverso = await prisma.merchantLedgerEntry.findUniqueOrThrow({ where: { id: venta.reversalEntryId! } })
  assert.equal(reverso.type, 'REFUND')
  assert.equal(reverso.amount.toFixed(2), '-32.00')
  assert.equal((await sinEmpresa('prueba', (tx) => saldoEnTx(tx, a.companyId))).toFixed(2), saldoAntes.minus(32).toFixed(2))
  assert.equal((await prisma.membegoVisit.findUniqueOrThrow({ where: { id: visitId } })).ancillaryTotal.toFixed(2), '0.00')

  // Ventana (§38): una visita abierta hace 3 horas se cierra sola y no atribuye compras.
  const otra = await montarSupplierLite({ prefijo: 'vis5', unidadesCompradas: 5, unidadesCliente: 1 })
  const r = await (async () => {
    const qr = await sinEmpresa('prueba', (tx) => abrirSesionQrEnTx(tx, { entitlementId: otra.entitlements[0]!, customerId: otra.cliente, branchId: otra.sucursalId }, como(otra.cliente)))
    return sinEmpresa('prueba', (tx) => confirmarEntregaEnTx(tx, { nonce: qr.nonce, empleado: otra.empleado, branchId: otra.sucursalId, idempotencyKey: `vis5-${otra.sufijo}` }, como(otra.duenoId)))
  })()
  const hace3h = new Date(Date.now() - 3 * 3_600_000)
  const v = await sinEmpresa('prueba', (tx) => abrirVisitaDeRedencionEnTx(tx, { redemptionId: r.id, operador: otra.empleado }, como(otra.duenoId), hace3h))
  await assert.rejects(sinEmpresa('prueba', (tx) => registrarVentaAdicionalEnTx(tx, { visitId: v.id, operador: otra.empleado, lineas: [{ description: 'Café', quantity: 1, unitPrice: 120 }], idempotencyKey: `tarde5-${otra.sufijo}` }, como(otra.duenoId))), /ventana/)
  assert.equal(await sinEmpresa('prueba', (tx) => cerrarVisitasVencidasEnTx(tx, como(null))), 1)
  assert.equal((await prisma.membegoVisit.findUniqueOrThrow({ where: { id: v.id } })).status, 'CLOSED')
  assert.equal(await sinEmpresa('prueba', (tx) => cerrarVisitasVencidasEnTx(tx, como(null))), 0, 'idempotente')
})

test('6 · seguridad (§53): otro proveedor no abre, no registra ni ve; el cliente ajeno no confirma ni disputa', async () => {
  const ajeno = await montarSupplierLite({ prefijo: 'vis6', unidadesCompradas: 5, unidadesCliente: 1 })
  await assert.rejects(sinEmpresa('prueba', (tx) => abrirVisitaDeRedencionEnTx(tx, { redemptionId: redencionId, operador: ajeno.empleado }, como(ajeno.duenoId))), /no es de tu empresa/)
  await assert.rejects(sinEmpresa('prueba', (tx) => registrarVentaAdicionalEnTx(tx, { visitId, operador: ajeno.empleado, lineas: [{ description: 'x', quantity: 1, unitPrice: 10 }], idempotencyKey: `ajeno-${ajeno.sufijo}` }, como(ajeno.duenoId))), /no es de tu empresa/)
  assert.equal(await visitaDeLaEmpresa(ajeno.companyId, visitId), null)
  assert.equal(await miVisita(ajeno.cliente, visitId), null)
  await assert.rejects(sinEmpresa('prueba', (tx) => confirmarVisitaComoClienteEnTx(tx, { visitId, customerUserId: ajeno.cliente, totalVisto: '0.00' }, como(ajeno.cliente))), /no es tuya/)
  await assert.rejects(sinEmpresa('prueba', (tx) => disputarVisitaComoClienteEnTx(tx, { visitId, customerUserId: ajeno.cliente, claim: 'No fui yo' }, como(ajeno.cliente))), /no es tuya/)
  // El resumen del portal solo ve lo suyo.
  const resumen = await resumenDeExtrasDeLaEmpresa(a.companyId)
  assert.ok(resumen.visitas >= 2)
  assert.equal((await resumenDeExtrasDeLaEmpresa(ajeno.companyId)).ventas, 0)
})
