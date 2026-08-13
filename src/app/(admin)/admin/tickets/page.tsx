import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { BandejaTickets } from '@/components/soporte/BandejaTickets'

export const dynamic = 'force-dynamic'

/** La bandeja para el administrador de una empresa. La pantalla en sí vive en
 *  `BandejaTickets`, compartida con `/superadmin/tickets`. */
export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireRole(ADMIN_ROLES)
  return <BandejaTickets user={user} searchParams={await searchParams} alcance="empresa" />
}
