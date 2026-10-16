import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { ticketParaCliente } from '@/modules/transacciones/comprobanteCliente'
import { ComprobanteImprimible } from '@/components/cliente/pagos/ComprobanteImprimible'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Comprobante de pago',
  description: 'Tu comprobante de pago, listo para imprimir o guardar en PDF',
}

/**
 * «Mis pagos → comprobante»: la factura de una venta de ESTA persona. Si la
 * transacción no es suya (o no existe), 404: no se distingue para no revelar ids.
 */
export default async function ComprobanteClientePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireRole('CLIENTE')
  const ticket = await ticketParaCliente(id, user.supabaseId)
  if (!ticket) notFound()

  return (
    <div className="container max-w-4xl py-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Finanzas</p>
        <h1 className="mt-1.5 text-h1 tracking-tight text-foreground">Comprobante de pago</h1>
        <p className="mt-1 text-small text-muted-foreground">
          {ticket.transaccion.codigo} · Ticket {ticket.transaccion.ticketNumero} · {ticket.empresa.nombre}
        </p>
      </header>
      <ComprobanteImprimible ticket={ticket} volverHref="/cliente/pagos" />
    </div>
  )
}
