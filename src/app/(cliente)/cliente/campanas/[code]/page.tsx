import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SITE_NAME } from '@/lib/site'
import { requireRole } from '@/lib/auth/guards'
import { campanaPublicaPorCodigo } from '@/modules/supply-v2/campaigns/queries'
import { FichaDeCampana } from '@/components/supply-v2/FichaDeCampana'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params
  const c = await campanaPublicaPorCodigo(code, null)
  return { title: `${c?.name ?? 'Campaña'} · ${SITE_NAME}`, robots: { index: false, follow: false } }
}

/** La ficha de una campaña DENTRO DE LA APP: conoce al cliente (`paraTi`) y enlaza a la compra y a sus cupones. */
export default async function CampanaEnLaAppPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const user = await requireRole('CLIENTE')
  const c = await campanaPublicaPorCodigo(code, user.metadata.dbUserId ?? null)
  if (!c) notFound()
  return <FichaDeCampana c={c} espacio="app" />
}
