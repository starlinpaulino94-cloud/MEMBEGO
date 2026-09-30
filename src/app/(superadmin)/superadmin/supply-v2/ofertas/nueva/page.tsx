import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { WizardOferta } from '@/components/supply-v2/wizard-oferta'
import { productosParaOferta } from '@/modules/supply-v2/offers/queries'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Crear oferta · Supply 2.0' }

export default async function NuevaOfertaPage({ searchParams }: { searchParams: Promise<{ producto?: string }> }) {
  await requireRole('SUPERADMIN')
  const { producto } = await searchParams
  const productos = await productosParaOferta()
  return (
    <div className="space-y-6">
      <PageHeader
        title="Crear oferta"
        description="Producto → cantidad → precio → vigencia → reglas → publicar. Las unidades se apartan al publicar."
        eyebrow={<Link href="/superadmin/supply-v2/ofertas" className="hover:underline">Ofertas</Link>}
        nav={<NavSupplyV2 activa="ofertas" />}
      />
      <WizardOferta productos={productos} productoInicial={producto} />
    </div>
  )
}
