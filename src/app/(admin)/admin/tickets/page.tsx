import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { BandejaTickets } from '@/components/soporte/BandejaTickets'

export const dynamic = 'force-dynamic'

/** La bandeja para el administrador de una empresa. La pantalla en sí vive en
 *  `BandejaTickets`, compartida con `/superadmin/tickets`. */
export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const { company } = await searchParams
  return <BandejaTickets user={user} company={company} />
}
