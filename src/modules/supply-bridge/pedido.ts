import type { MembegoPaymentMethod, SupplyV2PaymentMethod } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { cerrarPedidoExternoEnTx, crearPedidoEnTx, reembolsarPedidoEnTx, type ContextoPedido } from '@/modules/orders/service'
import { casaMembegoEnTx } from './service'

/**
 * SUPPLY BRIDGE · el envoltorio de pedido de una compra de Supply (Fase 3).
 *
 * Una compra de Supply V2 (una oferta de Membego que un cliente pagó) se
 * refleja como un `MembegoOrder` de la empresa de la casa con `origin = SUPPLY`
 * y atribución `SUPPLY_OFFER`. El pedido NO vende nada —la compra ya ocurrió y
 * sigue siendo del checkout de Supply—: es el registro unificado para que los
 * reportes (F6) cuenten Supply y marketplace con la misma vara.
 *
 * Idempotente: el documento de origen (`SUPPLY_V2_CUSTOMER_ORDER:<id>`) es único
 * por empresa, así que envolver dos veces la misma compra devuelve el mismo
 * pedido. Se corre desde el barrido del puente (cron diario y «Sincronizar
 * ahora»), nunca dentro de la transacción de Supply: un fallo aquí no puede
 * tumbar una compra.
 *
 * Todo en la transacción de quien llama, que cruza empresas a propósito
 * (`sinEmpresa`): lee de Supply y escribe en la empresa de la casa.
 */

export const FUENTE_SUPPLY = 'SUPPLY_V2_CUSTOMER_ORDER'

const SISTEMA: ContextoPedido = { actor: 'SISTEMA', actorId: null }

export type ResultadoEnvoltorio = {
  estado: 'CREADO' | 'YA_ENVUELTA' | 'SIN_CASA' | 'SIN_SUCURSAL' | 'SIN_ITEM' | 'NO_APLICA'
  pedidoId: string | null
  /** Por qué no se pudo (o no aplica), para mostrarlo en el panel. */
  detalle?: string
}

/** Cómo se pagó, en el vocabulario de los pedidos. Un depósito es una transferencia a la cuenta de Membego. */
const METODO_DE_PAGO: Record<SupplyV2PaymentMethod, MembegoPaymentMethod> = {
  TRANSFER: 'TRANSFER',
  DEPOSIT: 'TRANSFER',
  CASH: 'CASH',
  MANUAL: 'OTHER',
}

/** La ficha del comprador en la empresa de la casa, creada tal cual (sin seguirla ni darle bienvenidas: no es una afiliación). */
async function fichaEnLaCasa(tx: Tx, casaId: string, comprador: { supabaseId: string; email: string; name: string }): Promise<string> {
  const existente = await tx.cliente.findUnique({ where: { supabaseId_companyId: { supabaseId: comprador.supabaseId, companyId: casaId } }, select: { id: true } })
  if (existente) return existente.id
  const nueva = await tx.cliente.create({
    data: { companyId: casaId, supabaseId: comprador.supabaseId, nombre: comprador.name || comprador.email, email: comprador.email },
    select: { id: true },
  })
  return nueva.id
}

/** Envuelve UNA compra de Supply pagada. No hace nada si la compra no es de una oferta o aún no está pagada. */
export async function envolverCompraEnTx(tx: Tx, supplyOrderId: string): Promise<ResultadoEnvoltorio> {
  const o = await tx.supplyV2CustomerOrder.findUnique({
    where: { id: supplyOrderId },
    include: {
      customer: { select: { supabaseId: true, email: true, name: true } },
      lines: { orderBy: { id: 'asc' } },
    },
  })
  if (!o) return { estado: 'NO_APLICA', pedidoId: null, detalle: 'La compra no existe.' }
  if (o.kind !== 'OFFER' || o.status !== 'PAID' || o.lines.length === 0) {
    return { estado: 'NO_APLICA', pedidoId: null, detalle: 'Solo se envuelven compras de ofertas ya pagadas.' }
  }

  const casa = await casaMembegoEnTx(tx)
  if (!casa) return { estado: 'SIN_CASA', pedidoId: null, detalle: 'No hay empresa de la casa designada.' }

  const yaEnvuelta = await tx.membegoOrder.findFirst({ where: { companyId: casa.id, sourceType: FUENTE_SUPPLY, sourceId: o.id }, select: { id: true } })
  if (yaEnvuelta) return { estado: 'YA_ENVUELTA', pedidoId: yaEnvuelta.id }

  const sucursal = await tx.sucursal.findFirst({ where: { companyId: casa.id, activa: true }, select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
  if (!sucursal) return { estado: 'SIN_SUCURSAL', pedidoId: null, detalle: `«${casa.name}» necesita al menos una sucursal activa para registrar pedidos.` }

  // Cada línea de la compra apunta a su ítem puente (la variante única del ítem de esa oferta).
  const lineas: { varianteId: string; cantidad: number; precioUnitario: string; descuento: string }[] = []
  for (const l of o.lines) {
    const item = await tx.catalogItem.findFirst({
      where: { companyId: casa.id, supplyV2OfferId: l.offerId },
      select: { variants: { select: { id: true }, orderBy: [{ isDefault: 'desc' }, { position: 'asc' }, { id: 'asc' }], take: 1 } },
    })
    const variante = item?.variants[0]
    if (!variante) return { estado: 'SIN_ITEM', pedidoId: null, detalle: 'La oferta de esta compra aún no está en el catálogo de la casa (se reintenta en la próxima sincronización).' }
    // Lo que el cliente PAGÓ por la línea (`total`) frente a lo que valía a precio de venta
    // (`saleUnitPrice × cantidad`): la diferencia es lo que se le rebajó (bono, subsidio, descuento
    // del proveedor). `subtotal` de Supply no sirve de base: puede ir a precio público.
    const bruto = l.saleUnitPrice.times(l.quantity)
    const rebaja = bruto.minus(l.total)
    lineas.push({
      varianteId: variante.id,
      cantidad: l.quantity,
      // Si por algún motivo pagó MÁS que el precio de venta, el precio unitario es lo pagado: nunca un descuento negativo.
      precioUnitario: (rebaja.isNegative() ? l.total.dividedBy(l.quantity) : l.saleUnitPrice).toFixed(2),
      descuento: (rebaja.isNegative() ? 0 : rebaja).toFixed(2),
    })
  }

  const fecha = o.paidAt ?? new Date()
  const customerId = await fichaEnLaCasa(tx, casa.id, o.customer)
  const creado = await crearPedidoEnTx(
    tx,
    casa.id,
    {
      customerId,
      locationId: sucursal.id,
      origin: 'SUPPLY',
      lineas,
      atribucion: { channel: 'SUPPLY_OFFER', supplyV2OfferId: o.lines[0].offerId },
      fuente: { tipo: FUENTE_SUPPLY, id: o.id },
      ahora: fecha,
    },
    SISTEMA
  )

  // La plata la verificó una persona de Membego solo si el pago está CONFIRMADO; una compra cubierta
  // por un beneficio o gratis no tiene pago que verificar.
  const pagoVerificado = o.paymentStatus === 'CONFIRMED' && !o.total.isZero()
  await cerrarPedidoExternoEnTx(
    tx,
    casa.id,
    creado.pedidoId,
    {
      completedAt: fecha,
      // Comprar es aceptar el precio: el cliente vio el total en el checkout.
      confirmadoPorCliente: true,
      pago: pagoVerificado
        ? { method: METODO_DE_PAGO[o.paymentMethod ?? 'MANUAL'], amount: (o.paymentAmountSeen ?? o.total).toFixed(2), reference: o.paymentReference ?? o.number }
        : null,
    },
    SISTEMA
  )
  return { estado: 'CREADO', pedidoId: creado.pedidoId }
}

/** Si la compra de Supply se reembolsó, el pedido que la envuelve también (sin tocar inventario: no lo controla). */
export async function reflejarReembolsoEnTx(tx: Tx, supplyOrderId: string): Promise<boolean> {
  const casa = await casaMembegoEnTx(tx)
  if (!casa) return false
  const o = await tx.supplyV2CustomerOrder.findUnique({ where: { id: supplyOrderId }, select: { status: true } })
  if (!o || o.status !== 'REFUNDED') return false
  const p = await tx.membegoOrder.findFirst({ where: { companyId: casa.id, sourceType: FUENTE_SUPPLY, sourceId: supplyOrderId }, select: { id: true, status: true } })
  if (!p || p.status !== 'COMPLETED') return false
  await reembolsarPedidoEnTx(tx, casa.id, p.id, { motivo: 'La compra de Supply se reembolsó' }, SISTEMA)
  return true
}
