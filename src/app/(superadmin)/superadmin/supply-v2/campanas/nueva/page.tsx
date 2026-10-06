import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { WizardCampana } from '@/components/supply-v2/wizard-campana'
import { ofertasParaCampana } from '@/modules/supply-v2/campaigns/queries'
import { proveedoresParaFinanzas } from '@/modules/supply-v2/finance/queries'
import { RUTA_CAMPANAS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Crear campaña · Supply 2.0' }

/** MEMBEGO SUPPLY 2.0 · SLICE 7 · asistente de alta de campañas (§5). */
export default async function NuevaCampanaPage() {
  await requireRole('SUPERADMIN')
  const [ofertas, proveedores] = await Promise.all([ofertasParaCampana(null), proveedoresParaFinanzas()])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Crear campaña"
        description="Ocho pasos: objetivo, empresas, productos, tipo de promoción, financiación y presupuesto, público, vigencia y el resumen con la vista previa económica."
        eyebrow="Supply 2.0 · Campañas"
        action={<Button asChild variant="outline"><Link href={RUTA_CAMPANAS}>Volver a campañas</Link></Button>}
      />
      {ofertas.length === 0 ? (
        <EmptyState
          variant="card"
          title="Todavía no hay ofertas que puedan participar"
          description="Una campaña agrupa ofertas que ya existen, con su proveedor y su precio. Publica al menos una oferta primero."
          action={<Button asChild><Link href="/superadmin/supply-v2/ofertas">Ir a ofertas</Link></Button>}
        />
      ) : (
        <WizardCampana ofertas={ofertas} proveedores={proveedores.map((p) => ({ id: p.id, name: p.commercialName }))} />
      )}
    </div>
  )
}
