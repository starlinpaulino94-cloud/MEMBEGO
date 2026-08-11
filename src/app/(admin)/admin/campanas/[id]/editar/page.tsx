import { notFound } from 'next/navigation'
import { conEmpresaOTodas } from '@/lib/tenant'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { companyFilter } from '@/modules/admin/queries'
import { CampanaForm } from '@/components/admin/CampanaForm'

export const dynamic = 'force-dynamic'

export default async function EditarCampanaPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = companyFilter(user)
  const { id } = await params

  const campana = await conEmpresaOTodas(
    companyId,
    'campanas · [id] · editar: sin empresa activa es el superadmin, que cruza empresas a propósito',
    (tx) => tx.campana.findUnique({ where: { id } })
  )
  if (!campana) notFound()
  if (companyId && campana.companyId !== companyId) notFound()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Editar campaña</h1>
        <p className="text-muted-foreground">{campana.nombre}</p>
      </div>
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
