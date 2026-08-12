import { AdjuntoTicketLink } from '@/components/pagos/ComprobanteLink'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { getTicketDetail } from '@/modules/soporte/queries'
import { misClienteIds } from '@/modules/cliente/afiliacion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { estadoLabel, estadoBadgeClass, categoriaLabel } from '@/lib/soporte'
import { ClienteTicketConversacion } from '@/components/cliente/ClienteTicketConversacion'

export const dynamic = 'force-dynamic'

function fmt(d: Date): string {
  return new Date(d).toLocaleString('es-DO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function ClienteTicketPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole('CLIENTE')
  const { id } = await params

  // includeInternal=false: el cliente nunca ve notas internas.
  const ticket = await getTicketDetail(id, false)

  /**
   * DUEÑO = CUALQUIERA DE SUS FICHAS.
   *
   * El listado enseña los hilos de todos sus negocios; comprobando aquí la
   * ficha ACTIVA, tocar uno de otro negocio devolvía un 404 sobre una
   * conversación suya. Es el mismo fallo que ya apareció al hacer global «Mis
   * beneficios» y las citas: migrar el listado sin migrar su camino.
   *
   * Sigue siendo una comprobación de propiedad, no un pase: el ticket tiene
   * que pertenecer a una ficha de ESTA persona.
   */
  const misFichas = await misClienteIds(user.supabaseId)
  if (!ticket || !misFichas.includes(ticket.cliente.id)) notFound()

  return (
    <div className="space-y-4 animate-fade-up">
      <Link
        href="/cliente/ayuda"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Volver al Centro de Ayuda
      </Link>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-lg">{ticket.asunto}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{categoriaLabel(ticket.categoria)}</Badge>
              <Badge className={estadoBadgeClass(ticket.estado)}>
                {estadoLabel(ticket.estado)}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <AdjuntoTicketLink ticketId={ticket.id} valor={ticket.adjuntoUrl} />
          <ClienteTicketConversacion
            ticketId={ticket.id}
            cerrado={ticket.estado === 'CERRADO'}
            mensajes={ticket.mensajes.map((m) => ({
              id: m.id,
              autorTipo: m.autorTipo,
              autorNombre: m.autorNombre,
              cuerpo: m.cuerpo,
              createdAt: fmt(m.createdAt),
            }))}
          />
        </CardContent>
      </Card>
    </div>
  )
}
