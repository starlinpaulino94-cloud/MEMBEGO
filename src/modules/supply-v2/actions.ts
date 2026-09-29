'use server'

import type { SupplyV2AgreementType, SupplyV2CatalogItemType, SupplyV2PaymentMode, SupplyV2Unit } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { exigirPermisoSupplyV2 } from './permisos'
import { companyGateway } from './contracts/adapters'
import type { CompanyRef } from './contracts/gateways'
import { comoError, contextoDeAuditoria, entero, fecha, fechaFinDeDia, numero, refrescarSupplyV2, texto, type EstadoAccion } from './actions-util'
import { crearProveedorExternoEnTx, vincularEmpresaComoProveedorEnTx, type ProveedorCreado } from './suppliers/service'
import { crearItemCatalogoEnTx, type ItemCreado } from './catalog/service'
import { activarAcuerdoEnTx, crearAcuerdoEnTx } from './agreements/service'
import { aprobarOrdenEnTx, cancelarOrdenEnTx, crearOrdenEnTx, enviarAprobacionEnTx, rechazarOrdenEnTx, type OrdenCreada } from './procurement/orders'
import { confirmarRecepcionEnTx, type RecepcionConfirmada } from './procurement/receipts'

/**
 * MEMBEGO SUPPLY 2.0 · server actions.
 *
 * Cada una hace tres cosas, en este orden: GUARDIA (quién puede), REGLA (en
 * el módulo, no aquí) y BITÁCORA (dentro de la misma transacción). Devuelven
 * `{ error }` o `{ success }` en vez de lanzar: un `throw` llega al cliente
 * como «algo salió mal» y quien está comprando no sabe si se registró.
 *
 * Las que crean algo devuelven además `data` con lo creado: el wizard lo
 * añade a sus listas sin recargar y sin que nadie escriba un id.
 */

export type { EstadoAccion }

// ── Proveedores ─────────────────────────────────────────────────────────────

export async function buscarEmpresasAction(query: string): Promise<CompanyRef[]> {
  await exigirPermisoSupplyV2('SUPPLY_V2_SUPPLIER_MANAGE')
  return companyGateway.search(query)
}

export interface AcuerdoResumen {
  id: string
  code: string
  version: number
  type: SupplyV2AgreementType
  scope: 'ITEM' | 'CATEGORY' | 'CATALOG'
  status: string
  catalogItemId: string | null
  category: string | null
  negotiatedUnitCost: string | null
  currency: string
  paymentTermsDays: number | null
  startsAt: string
  endsAt: string | null
}

export async function crearProveedorExternoAction(
  _prev: EstadoAccion<ProveedorCreado>,
  fd: FormData
): Promise<EstadoAccion<ProveedorCreado>> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_SUPPLIER_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const creado = await sinEmpresa('Supply 2.0: alta de proveedor externo', (tx) =>
      crearProveedorExternoEnTx(
        tx,
        {
          commercialName: texto(fd, 'commercialName', 160),
          legalName: texto(fd, 'legalName', 200),
          taxId: texto(fd, 'taxId', 40),
          contactName: texto(fd, 'contactName', 120),
          whatsapp: texto(fd, 'whatsapp', 40),
          phone: texto(fd, 'phone', 40),
          email: texto(fd, 'email', 160),
          address: texto(fd, 'address', 300),
          city: texto(fd, 'city', 120),
          countryCode: texto(fd, 'countryCode', 2),
          currency: texto(fd, 'currency', 3),
          paymentTermsDays: entero(fd, 'paymentTermsDays'),
          paymentTermsText: texto(fd, 'paymentTermsText', 500),
          notes: texto(fd, 'notes', 2000),
        },
        ctx
      )
    )
    refrescarSupplyV2('proveedores')
    return { success: `Proveedor ${creado.commercialName} creado.`, id: creado.id, data: creado }
  } catch (e) {
    return comoError(e, 'crearProveedorExterno')
  }
}

export async function vincularEmpresaAction(
  _prev: EstadoAccion<ProveedorCreado>,
  fd: FormData
): Promise<EstadoAccion<ProveedorCreado>> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_SUPPLIER_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const companyId = texto(fd, 'companyId', 60)
    if (!companyId) return { error: 'Elige la empresa de Membego que será proveedora.' }
    const creado = await sinEmpresa('Supply 2.0: vincular empresa como proveedor', (tx) =>
      vincularEmpresaComoProveedorEnTx(
        tx,
        companyId,
        {
          contactName: texto(fd, 'contactName', 120) || null,
          whatsapp: texto(fd, 'whatsapp', 40) || null,
          paymentTermsDays: entero(fd, 'paymentTermsDays'),
          paymentTermsText: texto(fd, 'paymentTermsText', 500) || null,
          notes: texto(fd, 'notes', 2000) || null,
        },
        ctx
      )
    )
    refrescarSupplyV2('proveedores')
    return {
      success: creado.reutilizado ? `${creado.commercialName} ya era proveedor: se usa ese.` : `${creado.commercialName} ahora es proveedor de Membego.`,
      id: creado.id,
      data: creado,
    }
  } catch (e) {
    return comoError(e, 'vincularEmpresa')
  }
}

// ── Catálogo ────────────────────────────────────────────────────────────────

export async function crearProductoAction(
  _prev: EstadoAccion<ItemCreado>,
  fd: FormData
): Promise<EstadoAccion<ItemCreado>> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_SUPPLIER_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const creado = await sinEmpresa('Supply 2.0: alta de producto en el catálogo del proveedor', (tx) =>
      crearItemCatalogoEnTx(
        tx,
        {
          supplierId: texto(fd, 'supplierId', 60),
          type: (texto(fd, 'type', 20) || 'PRODUCT') as SupplyV2CatalogItemType,
          name: texto(fd, 'name', 160),
          description: texto(fd, 'description', 2000),
          sku: texto(fd, 'sku', 60),
          category: texto(fd, 'category', 80),
          publicPrice: texto(fd, 'publicPrice', 20) || null,
          currency: texto(fd, 'currency', 3),
          unit: (texto(fd, 'unit', 20) || 'UNIT') as SupplyV2Unit,
          existingProductId: texto(fd, 'existingProductId', 60) || null,
          existingServiceId: texto(fd, 'existingServiceId', 60) || null,
        },
        ctx
      )
    )
    refrescarSupplyV2('proveedores', `proveedores/${texto(fd, 'supplierId', 60)}`)
    return { success: `Producto ${creado.name} creado.`, id: creado.id, data: creado }
  } catch (e) {
    return comoError(e, 'crearProducto')
  }
}

// ── Acuerdos ────────────────────────────────────────────────────────────────

/** Crea el acuerdo y lo ACTIVA en la misma transacción: nace con versión 1. */
export async function crearAcuerdoAction(
  _prev: EstadoAccion<AcuerdoResumen>,
  fd: FormData
): Promise<EstadoAccion<AcuerdoResumen>> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_AGREEMENT_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const startsAt = fecha(fd, 'startsAt')
    if (!startsAt) return { error: 'Hace falta la fecha de inicio del acuerdo.' }
    const supplierId = texto(fd, 'supplierId', 60)
    const resumen = await sinEmpresa('Supply 2.0: crear y activar un acuerdo', async (tx) => {
      const creado = await crearAcuerdoEnTx(
        tx,
        {
          supplierId,
          type: (texto(fd, 'type', 30) || 'PREPAID_PURCHASE') as SupplyV2AgreementType,
          scope: 'ITEM',
          catalogItemId: texto(fd, 'catalogItemId', 60) || null,
          currency: texto(fd, 'currency', 3) || null,
          negotiatedUnitCost: texto(fd, 'negotiatedUnitCost', 20) || null,
          paymentTermsDays: entero(fd, 'paymentTermsDays'),
          startsAt,
          endsAt: fechaFinDeDia(fd, 'endsAt'),
          notes: texto(fd, 'notes', 2000) || null,
        },
        ctx
      )
      await activarAcuerdoEnTx(tx, creado.id, ctx)
      const a = await tx.supplyV2Agreement.findUniqueOrThrow({ where: { id: creado.id } })
      const r: AcuerdoResumen = {
        id: a.id,
        code: a.code,
        version: a.version,
        type: a.type,
        scope: a.scope,
        status: a.status,
        catalogItemId: a.catalogItemId,
        category: a.category,
        negotiatedUnitCost: a.negotiatedUnitCost?.toFixed(2) ?? null,
        currency: a.currency,
        paymentTermsDays: a.paymentTermsDays,
        startsAt: a.startsAt.toISOString(),
        endsAt: a.endsAt?.toISOString() ?? null,
      }
      return r
    })
    refrescarSupplyV2('proveedores', `proveedores/${supplierId}`)
    return { success: `Acuerdo ${resumen.code} vigente.`, id: resumen.id, data: resumen }
  } catch (e) {
    return comoError(e, 'crearAcuerdo')
  }
}

// ── Órdenes de compra ───────────────────────────────────────────────────────

export async function crearOrdenAction(
  _prev: EstadoAccion<OrdenCreada>,
  fd: FormData
): Promise<EstadoAccion<OrdenCreada>> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_PURCHASE_CREATE')
    const ctx = await contextoDeAuditoria(actor)
    const quantity = entero(fd, 'quantity')
    const unitCost = texto(fd, 'unitCost', 20)
    if (quantity == null || !unitCost) return { error: 'Hace falta la cantidad y el costo unitario.' }
    const creada = await sinEmpresa('Supply 2.0: crear una orden de compra', (tx) =>
      crearOrdenEnTx(
        tx,
        {
          supplierId: texto(fd, 'supplierId', 60),
          agreementId: texto(fd, 'agreementId', 60),
          lines: [{ catalogItemId: texto(fd, 'catalogItemId', 60), quantity, unitCost }],
          taxRate: numero(fd, 'taxRate') ?? 0,
          paymentMode: (texto(fd, 'paymentMode', 20) || 'PREPAID') as SupplyV2PaymentMode,
          notes: texto(fd, 'notes', 2000) || null,
        },
        ctx
      )
    )
    refrescarSupplyV2('compras')
    return { success: `Orden ${creada.number} creada.`, id: creada.id, data: creada }
  } catch (e) {
    return comoError(e, 'crearOrden')
  }
}

export async function enviarAprobacionAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'purchaseOrderId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_PURCHASE_CREATE')
    const ctx = await contextoDeAuditoria(actor)
    await sinEmpresa('Supply 2.0: enviar una orden a aprobación', (tx) => enviarAprobacionEnTx(tx, id, ctx))
    refrescarSupplyV2('compras', `compras/${id}`)
    return { success: 'Orden enviada a aprobación.', id }
  } catch (e) {
    return comoError(e, 'enviarAprobacion')
  }
}

export async function aprobarOrdenAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'purchaseOrderId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_PURCHASE_APPROVE')
    const ctx = await contextoDeAuditoria(actor)
    await sinEmpresa('Supply 2.0: aprobar una orden de compra', (tx) => aprobarOrdenEnTx(tx, id, ctx))
    refrescarSupplyV2('compras', `compras/${id}`)
    return { success: 'Orden aprobada.', id }
  } catch (e) {
    return comoError(e, 'aprobarOrden')
  }
}

export async function rechazarOrdenAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'purchaseOrderId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_PURCHASE_APPROVE')
    const ctx = await contextoDeAuditoria(actor)
    const motivo = texto(fd, 'reason', 1000)
    if (!motivo) return { error: 'Escribe el motivo del rechazo.' }
    await sinEmpresa('Supply 2.0: rechazar una orden de compra', (tx) => rechazarOrdenEnTx(tx, id, motivo, ctx))
    refrescarSupplyV2('compras', `compras/${id}`)
    return { success: 'Orden rechazada: vuelve a borrador con el motivo registrado.', id }
  } catch (e) {
    return comoError(e, 'rechazarOrden')
  }
}

export async function cancelarOrdenAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'purchaseOrderId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_PURCHASE_CREATE')
    const ctx = await contextoDeAuditoria(actor)
    const motivo = texto(fd, 'reason', 1000)
    if (!motivo) return { error: 'Escribe el motivo de la cancelación.' }
    await sinEmpresa('Supply 2.0: cancelar una orden de compra', (tx) => cancelarOrdenEnTx(tx, id, motivo, ctx))
    refrescarSupplyV2('compras', `compras/${id}`)
    return { success: 'Orden cancelada.', id }
  } catch (e) {
    return comoError(e, 'cancelarOrden')
  }
}

// ── Recepción ───────────────────────────────────────────────────────────────

export async function confirmarRecepcionAction(
  _prev: EstadoAccion<RecepcionConfirmada>,
  fd: FormData
): Promise<EstadoAccion<RecepcionConfirmada>> {
  const id = texto(fd, 'purchaseOrderId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_RECEIVE')
    const ctx = await contextoDeAuditoria(actor)
    const lineIds = fd.getAll('lineId').map(String)
    const cantidades = fd.getAll('lineQuantity').map((v) => Math.trunc(Number(String(v).trim())))
    const lines = lineIds
      .map((lineId, i) => ({ purchaseOrderLineId: lineId, quantity: cantidades[i] ?? 0 }))
      .filter((l) => l.purchaseOrderLineId && l.quantity > 0)
    if (lines.length === 0) return { error: 'Indica cuántas unidades se reciben ahora.' }
    const expiresAt = fechaFinDeDia(fd, 'expiresAt')
    const r = await sinEmpresa('Supply 2.0: confirmar una recepción', (tx) =>
      confirmarRecepcionEnTx(
        tx,
        {
          purchaseOrderId: id,
          lines: lines.map((l) => ({ ...l, expiresAt })),
          receivedAt: fecha(fd, 'receivedAt'),
          branchId: texto(fd, 'branchId', 60) || null,
          reference: texto(fd, 'reference', 120) || null,
          notes: texto(fd, 'notes', 2000) || null,
          idempotencyKey: texto(fd, 'idempotencyKey', 80) || null,
        },
        ctx
      )
    )
    refrescarSupplyV2('compras', `compras/${id}`, 'supply')
    const unidades = r.lots.reduce((t, l) => t + l.quantity, 0)
    return {
      success: r.repetida
        ? `Esta recepción ya estaba registrada (${r.number}).`
        : `${unidades.toLocaleString('es-DO')} unidades recibidas en ${r.number}.`,
      id: r.id,
      data: r,
    }
  } catch (e) {
    return comoError(e, 'confirmarRecepcion')
  }
}
