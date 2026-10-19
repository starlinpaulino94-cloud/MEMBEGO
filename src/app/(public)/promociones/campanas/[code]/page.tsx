import { notFound } from 'next/navigation'
import { campanaPublicaPorCodigo } from '@/modules/supply-v2/campaigns/queries'
import { FichaDeCampana } from '@/components/supply-v2/FichaDeCampana'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const c = await campanaPublicaPorCodigo(code, null)
  return { title: c ? `${c.name} · Campaña Membego` : 'Campaña Membego' }
}

/**
 * MEMBEGO SUPPLY · SLICE 7 · ficha pública de una CAMPAÑA (§19): CONSULTA. Las ofertas llevan a su ficha pública,
 * que ofrece el traspaso a la compra en la app. Esta página no lee la sesión.
 */
export default async function CampanaPublicaPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const c = await campanaPublicaPorCodigo(code, null)
  if (!c) notFound()
  return <FichaDeCampana c={c} espacio="publico" />
}
