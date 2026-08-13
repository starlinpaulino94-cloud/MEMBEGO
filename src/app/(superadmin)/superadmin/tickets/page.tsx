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
 * `alcance="plataforma"` es lo que hace que se vean TODAS las empresas. Aquí
 * había un comentario que afirmaba que eso ya pasaba solo; era falso, y por eso
 * la bandeja enseñaba una sola empresa mientras el aviso contaba todas.
 */
export default async function TicketsPlataformaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireRole('SUPERADMIN')
  return <BandejaTickets user={user} searchParams={await searchParams} alcance="plataforma" />
}
