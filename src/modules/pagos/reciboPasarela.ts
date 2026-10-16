import { conEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { registrarVentaConfirmada } from '@/modules/pagos/venta'

/**
 * EL RECIBO DE UN PAGO CON TARJETA (16-10-2026).
 *
 * Cuando el admin confirma una transferencia o un cobro en sucursal, el panel
 * deja la venta oficial (`registrarVentaConfirmada`): ticket, factura, historial
 * en Facturas. Los pagos con tarjeta —CardNET desde la web, desde la app y la
 * renovación automática con tarjeta guardada— activaban la membresía o la
 * compra y NO dejaban nada: el negocio no tenía qué imprimir y el cliente no
 * tenía comprobante. Este helper cierra ese hueco desde el punto de entrega.
 *
 * Idempotente por intento: una notificación repetida de la pasarela (webhook
 * + retorno del navegador) no duplica el recibo. Nunca lanza: el cobro y la
 * activación ya ocurrieron y no se deshacen por un fallo de facturación.
 */
export async function registrarReciboDePasarela(input: {
  companyId: string
  intentoId: string
  clienteId: string | null
  membershipId: string | null
  compraId: string | null
  monto: number
  autorizacion: string | null
  proveedor: string
  /** Lo que se vendió, en las palabras del comprobante: «Plan Oro», «Promoción …», «Renovación · Plan Oro». */
  detalle: string
}): Promise<{ id: string; codigo: string; ticketNumero: string } | null> {
  try {
    if (!(input.monto > 0)) return null
    const datos = await conEmpresa(input.companyId, async (tx) => {
      const yaExiste = await tx.transaction.findFirst({
        where: { companyId: input.companyId, tipo: 'SALE', snapshot: { path: ['intentoId'], equals: input.intentoId } },
        select: { id: true },
      })
      if (yaExiste) return { yaExiste: true as const }
      // El cliente puede no venir en el intento (intentos viejos): se deduce de lo pagado.
      let clienteId = input.clienteId
      if (!clienteId && input.membershipId) {
        clienteId = (await tx.membership.findUnique({ where: { id: input.membershipId }, select: { clienteId: true } }))?.clienteId ?? null
      }
      if (!clienteId && input.compraId) {
        clienteId = (await tx.productoCompra.findUnique({ where: { id: input.compraId }, select: { clienteId: true } }))?.clienteId ?? null
      }
      if (!clienteId) return { yaExiste: false as const, clienteId: null, clienteNombre: null }
      const cliente = await tx.cliente.findUnique({ where: { id: clienteId }, select: { nombre: true } })
      return { yaExiste: false as const, clienteId, clienteNombre: cliente?.nombre ?? null }
    })
    if (datos.yaExiste || !datos.clienteId) return null

    const esCardnet = input.proveedor === 'CARDNET'
    return await registrarVentaConfirmada({
      companyId: input.companyId,
      clienteId: datos.clienteId,
      clienteNombre: datos.clienteNombre ?? 'Cliente',
      empleadoId: null,
      detalle: input.detalle,
      monto: input.monto,
      metodoCobro: 'OTRO',
      metodoCobroLabel: esCardnet ? 'Tarjeta (CardNET)' : 'Tarjeta',
      referenciaPago: input.autorizacion ? `Aut. ${input.autorizacion}` : null,
      membershipId: input.membershipId,
      intentoId: input.intentoId,
    })
  } catch (e) {
    anotarFallo('pagos:reciboPasarela', { intentoId: input.intentoId })(e)
    return null
  }
}
