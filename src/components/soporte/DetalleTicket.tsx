import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { urlAdjuntoTicket } from '@/modules/storage/comprobantes'
import { getTicketDetail } from '@/modules/soporte/queries'
import { TicketDetail } from '@/components/admin/TicketDetail'
import type { SessionUser } from '@/types'

/**
 * El detalle de un ticket, una sola vez.
 *
 * Igual que la bandeja: la pantalla vive aquí y se monta en dos rutas,
 * `/admin/tickets/[id]` y `/superadmin/tickets/[id]`.
 *
 * POR QUÉ HACÍA FALTA LA GEMELA. La bandeja de plataforma ya existía para no
 * sacar al superadmin de su panel… y las filas enlazaban a `/admin/tickets/{id}`,
 * así que el primer clic hacía justo lo que la ruta gemela venía a evitar: la
 * barra lateral cambiaba entera y «volver» dejaba de ser obvio. Media solución
 * es peor que ninguna, porque parece resuelta.
 */
export async function DetalleTicket({
  user,
  id,
  volverA,
}: {
  user: SessionUser
  id: string
  /** A qué bandeja se vuelve: la del panel desde el que se entró. */
  volverA: string
}) {
  const ticket = await getTicketDetail(id, true)
  if (!ticket) notFound()

  // Autorización por empresa (superadmin ve todas).
  if (user.metadata.role !== 'SUPERADMIN' && ticket.companyId !== user.metadata.companyId) {
    notFound()
  }

  const fmt = (d: Date): string =>
    new Date(d).toLocaleString('es-DO', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })

  return (
    <div className="space-y-4">
      <Link
        href={volverA}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Volver a tickets
      </Link>

      <TicketDetail
        ticket={{
          id: ticket.id,
          asunto: ticket.asunto,
          estado: ticket.estado,
          categoria: ticket.categoria,
          clienteNombre: ticket.cliente.nombre,
          clienteEmail: ticket.cliente.email,
          empresaNombre: ticket.company.name,
          // URL firmada de 5 minutos: el bucket es privado (auditoría · C-01)
          // y el permiso se comprueba antes de firmar. El componente de
          // cliente recibe un enlace ya autorizado, no una ruta.
          adjuntoUrl: await urlAdjuntoTicket(ticket.id, ticket.adjuntoUrl),
          creado: fmt(ticket.createdAt),
        }}
        mensajes={ticket.mensajes.map((m) => ({
          id: m.id,
          autorTipo: m.autorTipo,
          autorNombre: m.autorNombre,
          cuerpo: m.cuerpo,
          esNotaInterna: m.esNotaInterna,
          createdAt: fmt(m.createdAt),
        }))}
      />
    </div>
  )
}
