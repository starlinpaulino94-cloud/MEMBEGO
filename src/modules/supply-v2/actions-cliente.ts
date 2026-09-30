'use server'

import { revalidatePath } from 'next/cache'
import type { SupplyV2PaymentMethod } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { exigirCliente } from './permisos'
import { paymentAccountGateway } from './contracts/adapters'
import { comoError, contextoDeAuditoria, entero, texto, type EstadoAccion } from './actions-util'
import { abrirOrdenClienteEnTx, avisarPagoEnTx, cancelarOrdenClienteEnTx, type OrdenClienteAbierta } from './commerce/checkout'
import { PAYMENT_METHODS_CLIENTE, RUTA_COMPRAS_CLIENTE } from './core/catalogo'

/**
 * MEMBEGO SUPPLY 2.0 · server actions del CLIENTE (§23, §26, §29, §36, §52).
 *
 * La guardia es la sesión con rol CLIENTE; la PROPIEDAD la comprueba el
 * dominio con el `customerId` de esa sesión en cada operación. El cliente
 * nunca manda su id: se toma de la sesión.
 */

function refrescarCliente(id?: string): void {
  revalidatePath(RUTA_COMPRAS_CLIENTE)
  if (id) revalidatePath(`${RUTA_COMPRAS_CLIENTE}/${id}`)
  revalidatePath('/promociones')
}

/** «Comprar»: abre la orden y RESERVA. Idempotente por clave del formulario. */
export async function comprarOfertaAction(_prev: EstadoAccion<OrdenClienteAbierta>, fd: FormData): Promise<EstadoAccion<OrdenClienteAbierta>> {
  try {
    const cliente = await exigirCliente()
    const ctx = await contextoDeAuditoria(cliente)
    const offerId = texto(fd, 'offerId', 60)
    const quantity = entero(fd, 'quantity') ?? 1
    const cuentaId = texto(fd, 'accountId', 60)
    const cuentas = await paymentAccountGateway.activas()
    if (cuentas.length === 0) return { error: 'Membego no puede cobrar en este momento. Inténtalo más tarde.' }
    const cuenta = cuentas.find((c) => c.id === cuentaId) ?? cuentas[0]!
    const r = await sinEmpresa('Supply 2.0: el cliente inicia una compra', (tx) =>
      abrirOrdenClienteEnTx(tx, { customerId: cliente.id, offerId, quantity, idempotencyKey: texto(fd, 'idempotencyKey', 80) || null, cuenta }, ctx)
    )
    refrescarCliente(r.id)
    return { success: r.repetida ? 'Esta compra ya estaba iniciada.' : 'Unidad reservada. Completa el pago para recibir tu beneficio.', id: r.id, data: r }
  } catch (e) {
    return comoError(e, 'comprarOferta')
  }
}

export async function cancelarCompraAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'orderId', 60)
  try {
    const cliente = await exigirCliente()
    const ctx = await contextoDeAuditoria(cliente)
    await sinEmpresa('Supply 2.0: el cliente cancela su compra', (tx) => cancelarOrdenClienteEnTx(tx, id, cliente.id, ctx))
    refrescarCliente(id)
    return { success: 'Compra cancelada. La unidad vuelve a estar disponible para otras personas.', id }
  } catch (e) {
    return comoError(e, 'cancelarCompra')
  }
}

export async function avisarPagoAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'orderId', 60)
  try {
    const cliente = await exigirCliente()
    const ctx = await contextoDeAuditoria(cliente)
    const method = texto(fd, 'method', 20) as SupplyV2PaymentMethod
    if (!PAYMENT_METHODS_CLIENTE.includes(method)) return { error: 'Elige cómo pagaste.' }
    await sinEmpresa('Supply 2.0: el cliente avisa que pagó', (tx) =>
      avisarPagoEnTx(tx, { orderId: id, customerId: cliente.id, method, reference: texto(fd, 'reference', 120) || null }, ctx)
    )
    refrescarCliente(id)
    return { success: 'Aviso recibido. Membego revisará el pago y activará tu beneficio.', id }
  } catch (e) {
    return comoError(e, 'avisarPago')
  }
}
