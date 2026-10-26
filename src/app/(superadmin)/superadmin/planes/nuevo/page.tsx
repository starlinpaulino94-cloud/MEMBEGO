export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { sinEmpresa } from '@/lib/tenant'
import { requireRole } from '@/lib/auth/guards'
import { PlanForm } from '@/components/admin/PlanForm'
import { PageHeader } from '@/components/ui/page-header'
import { valoresDePlanNuevo } from '@/modules/planes/formulario'

export default async function NuevoPlanPage() {
  await requireRole('SUPERADMIN')

  const companies = await sinEmpresa(
    'planes globales · nuevo: el superadmin elige a qué empresa pertenece',
    (tx) => tx.company.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    })
  )

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6">
      <PageHeader
        variant="formulario"
        className="mb-0 sm:mb-0"
        back={
          <Link href="/superadmin/planes" className="text-muted-foreground hover:text-foreground">
            ‹ Planes
          </Link>
        }
        title="Nuevo plan"
      />
      <PlanForm modo="crear" inicial={valoresDePlanNuevo()} companies={companies.map((c) => ({ id: c.id, name: c.name }))} />
    </div>
  )
}
