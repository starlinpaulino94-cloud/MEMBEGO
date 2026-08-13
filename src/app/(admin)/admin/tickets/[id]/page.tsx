import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { DetalleTicket } from '@/components/soporte/DetalleTicket'

export const dynamic = 'force-dynamic'

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const { id } = await params
  return <DetalleTicket user={user} id={id} volverA="/admin/tickets" />
}
