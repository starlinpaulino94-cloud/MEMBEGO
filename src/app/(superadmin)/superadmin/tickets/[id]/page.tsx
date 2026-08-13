import { requireRole } from '@/lib/auth/guards'
import { DetalleTicket } from '@/components/soporte/DetalleTicket'

export const dynamic = 'force-dynamic'

/** El detalle dentro del panel de PLATAFORMA: abrir un ticket desde la bandeja
 *  de plataforma ya no cruza al panel de empresa. La pantalla vive en
 *  `DetalleTicket`, compartida con `/admin/tickets/[id]`. */
export default async function TicketPlataformaPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole('SUPERADMIN')
  const { id } = await params
  return <DetalleTicket user={user} id={id} volverA="/superadmin/tickets" />
}
