import { notFound } from 'next/navigation'
import { conEmpresa } from '@/lib/tenant'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { CampanaForm } from '@/components/admin/CampanaForm'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'

export const dynamic = 'force-dynamic'

export default async function EditarCampanaPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const { id } = await params

  const campana = await conEmpresa(companyId,
    (tx) => tx.campana.findUnique({ where: { id } })
  )
  if (!campana) notFound()
  if (companyId && campana.companyId !== companyId) notFound()

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6">
      <PageHeader
        variant="formulario"
        className="mb-0 sm:mb-0"
        back={
          <Link href="/admin/campanas" className="text-muted-foreground hover:text-foreground">
            ‹ Campañas
          </Link>
        }
        title="Editar campaña"
        description={campana.nombre}
      />
      <CampanaForm
        existing={{
          id: campana.id,
          nombre: campana.nombre,
          descripcion: campana.descripcion,
          fechaInicio: campana.fechaInicio,
          fechaFin: campana.fechaFin,
          activo: campana.activo,
        }}
      />
    </div>
  )
}

