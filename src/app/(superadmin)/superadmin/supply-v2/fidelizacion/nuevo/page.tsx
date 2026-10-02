import { PageHeader } from '@/components/ui/page-header'
import { sinEmpresa } from '@/lib/tenant'
import { exigirPermisoSupplyV2 } from '@/modules/supply-v2/permisos'
import { FormProgramaFidelizacion } from '@/components/supply-v2/form-programa-fidelizacion'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Nuevo programa de fidelización' }

export default async function NuevoProgramaPage() {
  await exigirPermisoSupplyV2('SUPPLY_V2_LOYALTY_PROGRAM_CREATE')
  const proveedores = await sinEmpresa('Supply 2.0: proveedores para un programa', (tx) =>
    tx.supplyV2Supplier.findMany({ where: { status: 'ACTIVE' }, select: { id: true, commercialName: true }, orderBy: { commercialName: 'asc' }, take: 300 })
  )
  return (
    <div className="space-y-6">
      <PageHeader
        title="Nuevo programa de fidelización"
        description="Un programa agrupa las membresías, los puntos, las recompensas y los referidos de un negocio."
        eyebrow="Supply 2.0"
      />
      <FormProgramaFidelizacion proveedores={proveedores.map((p) => ({ id: p.id, nombre: p.commercialName }))} />
    </div>
  )
}
