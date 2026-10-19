import 'server-only'

/**
 * EL COMPROBANTE DE PAGO DEL PROPIO CLIENTE (16-10-2026).
 *
 * `obtenerTicket` (actions.ts) es del mostrador: exige rol de escáner/panel.
 * El cliente que pagó también tiene derecho a su recibo —para imprimirlo,
 * guardarlo en PDF o enseñarlo— y hasta hoy no existía ningún camino que se lo
 * diera. Aquí el permiso es la PROPIEDAD: la transacción tiene que ser de una
 * de sus fichas (`misClienteIds`), y solo se sirven ventas aplicadas.
 */

import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { getById } from '@/lib/transactions'
import { misClienteIds } from '@/modules/cliente/afiliacion'
import { construirTicketPayload, type TicketPayload } from '@/modules/transacciones/ticket'

async function cargarTicket(transactionId: string): Promise<TicketPayload | null> {
  const t = await sinEmpresa('comprobante del cliente: buscar transacción por id', (tx) => getById(transactionId, tx))
  if (!t || t.tipo !== 'SALE' || t.estado !== 'APPLIED') return null
  const [company, plantilla] = await conEmpresa(t.companyId, (tx) =>
    Promise.all([
      tx.company.findUnique({
        where: { id: t.companyId },
        select: { name: true, direccion: true, telefono: true, website: true, logoUrl: true, zonaHoraria: true },
      }),
      tx.receiptTemplate.findUnique({ where: { companyId: t.companyId } }),
    ])
  )
  if (!company) return null
  return construirTicketPayload(t, company, plantilla)
}

/** El ticket si la transacción es una venta de ESTA persona; si no, null (ni «no existe» ni «no es tuya»: lo mismo). */
export async function ticketParaCliente(transactionId: string, supabaseId: string): Promise<TicketPayload | null> {
  const t = await sinEmpresa('comprobante del cliente: comprobar propiedad', (tx) =>
    tx.transaction.findUnique({ where: { id: transactionId }, select: { clienteId: true } })
  )
  if (!t?.clienteId) return null
  const mios = await misClienteIds(supabaseId)
  if (!mios.includes(t.clienteId)) return null
  return cargarTicket(transactionId)
}

/** Para el enlace firmado: la firma ya probó que quien lo pidió era el dueño. */
export async function ticketPorEnlaceVerificado(transactionId: string): Promise<TicketPayload | null> {
  return cargarTicket(transactionId)
}
