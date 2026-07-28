import { urlAdjuntoTicket } from '@/modules/storage/comprobantes'
import Link from 'next/link'
import { ADMIN_ROLES } from '@/types'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { getTicketDetail } from '@/modules/soporte/queries'
import { TicketDetail } from '@/components/admin/TicketDetail'

export const dynamic = 'force-dynamic'

function fmt(d: Date): string {
  return new Date(d).toLocaleString('es-DO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const { id } = await params

  const ticket = await getTicketDetail(id, true)
  if (!ticket) notFound()

  // Autorización por empresa (superadmin ve todas).
  if (user.metadata.role !== 'SUPERADMIN' && ticket.companyId !== user.metadata.companyId) {
    notFound()
  }

  return (
    <div className="space-y-4">
      <Link
        href="/admin/tickets"
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
