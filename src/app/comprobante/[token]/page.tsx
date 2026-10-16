import { notFound } from 'next/navigation'
import { verificarEnlaceComprobante } from '@/modules/transacciones/enlaceComprobante'
import { ticketPorEnlaceVerificado } from '@/modules/transacciones/comprobanteCliente'
import { ComprobanteImprimible } from '@/components/cliente/pagos/ComprobanteImprimible'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Comprobante de pago',
  robots: { index: false, follow: false },
}

/**
 * El comprobante que abre la APP en el navegador del teléfono. No hay sesión
 * web: lo que da acceso es el enlace firmado y de vida corta que la app pidió
 * con su propia sesión (`/api/v1/cliente/comprobantes/[id]/enlace`). Caducado
 * o manipulado → 404.
 */
export default async function ComprobantePublicoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const transactionId = verificarEnlaceComprobante(token)
  if (!transactionId) notFound()
  const ticket = await ticketPorEnlaceVerificado(transactionId)
  if (!ticket) notFound()

  return (
    <main className="container max-w-4xl py-6">
      <header className="mb-5">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Comprobante de pago</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {ticket.transaccion.codigo} · Ticket {ticket.transaccion.ticketNumero} · {ticket.empresa.nombre}
        </p>
      </header>
      <ComprobanteImprimible ticket={ticket} />
    </main>
  )
}
