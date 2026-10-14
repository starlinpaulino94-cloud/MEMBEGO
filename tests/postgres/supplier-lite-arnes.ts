import { prisma } from '../../src/lib/prisma'
import { sinEmpresa } from '../../src/lib/tenant'
import { crearProveedorExternoEnTx } from '../../src/modules/supply-v2/suppliers/service'
import { crearItemCatalogoEnTx } from '../../src/modules/supply-v2/catalog/service'
import { activarAcuerdoEnTx, crearAcuerdoEnTx } from '../../src/modules/supply-v2/agreements/service'
import { aprobarOrdenEnTx, crearOrdenEnTx, enviarAprobacionEnTx } from '../../src/modules/supply-v2/procurement/orders'
import { confirmarRecepcionEnTx } from '../../src/modules/supply-v2/procurement/receipts'
import { crearOfertaEnTx, publicarOfertaEnTx } from '../../src/modules/supply-v2/offers/service'
import { abrirOrdenClienteEnTx, avisarPagoEnTx, confirmarPagoEnTx } from '../../src/modules/supply-v2/commerce/checkout'
import {
  aceptarContratoDeProveedorEnTx,
  alAceptarInvitacionDeProveedorEnTx,
  codigoDePruebaEnTx,
  invitarDuenoDeProveedorEnTx,
  registrarPruebaDeEscanerEnTx,
} from '../../src/modules/supply-v2/suppliers/acceso'
import type { EmpleadoProveedor } from '../../src/modules/supply-v2/redemption/service'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · arnés compartido de las pruebas contra
 * PostgreSQL: el recorrido del criterio de éxito (§86) hasta «Membego compra
 * 1.000 unidades y publica una oferta; el cliente compra».
 *
 *   superadmin crea el proveedor (Café Central, EXTERNO)
 *   → lo invita (nace su empresa Supplier Lite, sin vitrina)
 *   → el dueño acepta y completa la activación (contrato + prueba de QR)
 *   → ítem «Cappuccino grande» + acuerdo PREPAID activo
 *   → compra de N unidades recibida (lote)
 *   → oferta publicada → cliente compra `unidades` y paga → derechos ACTIVE
 */

export const DIA = 86_400_000
export const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })

export interface ArnesSupplierLite {
  sufijo: string
  admin: string
  aprobador: string
  cliente: string
  supplierId: string
  companyId: string
  duenoId: string
  sucursalId: string
  itemId: string
  agreementId: string
  lotId: string
  offerId: string
  orderId: string
  entitlements: string[]
  empleado: EmpleadoProveedor
}

export async function montarSupplierLite(opts: {
  prefijo: string
  unidadesCompradas?: number
  unidadesCliente?: number
  precioPublico?: number
  precioMembego?: number
  costo?: number
  /** Capacidad diaria del ítem (§10). */
  capacidadDiaria?: number | null
}): Promise<ArnesSupplierLite> {
  const sufijo = `${opts.prefijo}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const ahora = new Date()
  const unidades = opts.unidadesCompradas ?? 1000
  const compradas = opts.unidadesCliente ?? 2
  const precioPublico = opts.precioPublico ?? 250
  const precioMembego = opts.precioMembego ?? 150
  const costo = opts.costo ?? 120

  const [admin, aprobador, cliente] = await Promise.all(
    (
      [
        ['admin', 'SUPERADMIN'],
        ['aprob', 'SUPERADMIN'],
        ['cli', 'CLIENTE'],
      ] as const
    ).map(([k, role]) => prisma.user.create({ data: { supabaseId: `sb-${sufijo}-${k}`, email: `${sufijo}-${k}@prueba.test`, name: k === 'cli' ? 'Juan Pérez' : k, role }, select: { id: true } }))
  )

  // Proveedor EXTERNO → invitación → empresa Supplier Lite.
  const { supplierId, companyId } = await sinEmpresa('arnés', async (tx) => {
    const p = await crearProveedorExternoEnTx(tx, { commercialName: `Café Central ${sufijo}`, email: `${sufijo}-cafe@prueba.test`, city: 'Higüey', phone: '809-000-0000' }, como(admin.id))
    const inv = await invitarDuenoDeProveedorEnTx(tx, { supplierId: p.id, email: `${sufijo}-dueno@prueba.test` }, como(admin.id))
    return { supplierId: p.id, companyId: inv.companyId }
  })
  const dueno = await prisma.user.create({ data: { supabaseId: `sb-${sufijo}-dueno`, email: `${sufijo}-dueno@prueba.test`, name: 'Dueña', role: 'ADMINISTRADOR', companyId }, select: { id: true } })
  await prisma.invitacion.updateMany({ where: { companyId, estado: 'PENDIENTE' }, data: { estado: 'ACEPTADA', aceptadaEn: ahora } })
  const sucursal = await prisma.sucursal.findFirstOrThrow({ where: { companyId }, select: { id: true } })
  await sinEmpresa('arnés', async (tx) => {
    await alAceptarInvitacionDeProveedorEnTx(tx, companyId, como(dueno.id))
    await aceptarContratoDeProveedorEnTx(tx, { supplierId, userId: dueno.id }, como(dueno.id))
    const codigo = await codigoDePruebaEnTx(tx, supplierId)
    await registrarPruebaDeEscanerEnTx(tx, { supplierId, userId: dueno.id, codigo }, como(dueno.id))
  })

  // Ítem, acuerdo, compra, recepción, oferta, compra del cliente.
  const r = await sinEmpresa('arnés', async (tx) => {
    const item = await crearItemCatalogoEnTx(tx, { supplierId, type: 'PRODUCT', name: 'Cappuccino grande', publicPrice: precioPublico }, como(admin.id))
    if (opts.capacidadDiaria) await tx.supplyV2CatalogItem.update({ where: { id: item.id }, data: { dailyCapacity: opts.capacidadDiaria, fulfillmentBacking: 'SERVICE_CAPACITY' } })
    const a = await crearAcuerdoEnTx(tx, { supplierId, type: 'PREPAID_PURCHASE', catalogItemId: item.id, negotiatedUnitCost: costo, startsAt: new Date(ahora.getTime() - DIA), endsAt: new Date(ahora.getTime() + 365 * DIA) }, como(admin.id))
    await activarAcuerdoEnTx(tx, a.id, como(admin.id))
    const po = await crearOrdenEnTx(tx, { supplierId, agreementId: a.id, lines: [{ catalogItemId: item.id, quantity: unidades, unitCost: costo }] }, como(admin.id))
    await enviarAprobacionEnTx(tx, po.id, como(admin.id))
    await aprobarOrdenEnTx(tx, po.id, como(aprobador.id))
    const linea = await tx.supplyV2PurchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: po.id }, select: { id: true } })
    const rec = await confirmarRecepcionEnTx(tx, { purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: linea.id, quantity: unidades, expiresAt: new Date(ahora.getTime() + 60 * DIA) }] }, como(aprobador.id))
    const o = await crearOfertaEnTx(tx, { catalogItemId: item.id, title: `Cappuccino grande · ${sufijo}`, publicPrice: precioPublico, salePrice: precioMembego, quantity: Math.min(100, unidades), perCustomerLimit: 5, startsAt: new Date(ahora.getTime() - 60_000), endsAt: new Date(ahora.getTime() + 30 * DIA) }, como(admin.id))
    await publicarOfertaEnTx(tx, o.id, como(admin.id))
    const orden = await abrirOrdenClienteEnTx(tx, { customerId: cliente.id, offerId: o.id, quantity: compradas }, como(cliente.id))
    await avisarPagoEnTx(tx, { orderId: orden.id, customerId: cliente.id, method: 'TRANSFER', reference: `REF-${sufijo}` }, como(cliente.id))
    const pago = await confirmarPagoEnTx(tx, { orderId: orden.id, amountSeen: (precioMembego * compradas).toFixed(2) }, como(admin.id))
    return { itemId: item.id, agreementId: a.id, lotId: rec.lots[0]!.id, offerId: o.id, orderId: orden.id, entitlements: pago.entitlements.map((e) => e.id) }
  })

  return {
    sufijo,
    admin: admin.id,
    aprobador: aprobador.id,
    cliente: cliente.id,
    supplierId,
    companyId,
    duenoId: dueno.id,
    sucursalId: sucursal.id,
    ...r,
    empleado: { userId: dueno.id, companyId, supplierId },
  }
}
