import { requireRole } from '@/lib/auth/guards'
import { BandejaTickets } from '@/components/soporte/BandejaTickets'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Tickets de soporte' }

/**
 * La misma bandeja que `/admin/tickets`, pero dentro del panel de PLATAFORMA.
 *
 * Existe para que el aviso «Tickets abiertos» del Centro de control no saque al
 * superadmin de su panel: la barra lateral tiene dos pestañas —Plataforma y
 * Panel de empresa— y cruzar de una a otra al pulsar un aviso contradice lo que
 * esa navegación promete.
 *
 * `resolveCompanyContext` ya sabe que un superadmin sin empresa elegida ve las de
 * todas, así que aquí no hace falta nada más.
 */
export default async function TicketsPlataformaPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>
}) {
  const user = await requireRole('SUPERADMIN')
  const { company } = await searchParams
  return <BandejaTickets user={user} company={company} />
}
