import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/site'
import { requireRole } from '@/lib/auth/guards'
import { campanasPublicas } from '@/modules/supply-v2/campaigns/queries'
import { ListaDeCampanas } from '@/components/supply-v2/ListaDeCampanas'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: `Campañas · ${SITE_NAME}`, robots: { index: false, follow: false } }

/** Las campañas DENTRO DE LA APP: conocen al cliente (qué es «para ti»), y sus ofertas llevan a la ficha donde se compra. */
export default async function CampanasEnLaAppPage() {
  const user = await requireRole('CLIENTE')
  const campanas = await campanasPublicas(user.metadata.dbUserId ?? null)
  return <ListaDeCampanas campanas={campanas} espacio="app" />
}
