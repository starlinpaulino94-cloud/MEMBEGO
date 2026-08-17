import { requireRole } from '@/lib/auth/guards'
import { conEmpresaOTodas } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { PageHeader } from '@/components/ui/page-header'
import { CampanaInvitacionForm } from '@/components/invitaciones/CampanaInvitacionForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Nueva campaña de invitación' }

export default async function NuevaCampanaInvitacionPage() {
  const user = await requireRole(ADMIN_ROLES)
  // Empresa activa del selector (respeta la selección del superadmin), para que
  // las promociones (candidatas a beneficio digital) sean las de esa empresa.
  const companyId = await resolveCompanyId(user)

  // Promociones vigentes de la empresa: candidatas a beneficio digital (E8).
  const promociones = companyId
    ? await conEmpresaOTodas(
      companyId,
      'invitaciones · nueva: sin empresa activa es el superadmin, que cruza empresas a propósito',
      (tx) => tx.promocion.findMany({
          where: { companyId, activo: true, archivada: false },
          select: { id: true, titulo: true },
          orderBy: { titulo: 'asc' },
        })
    )
    : []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nueva campaña"
        description="Configura una campaña 'Invita y Gana' para que tus clientes traigan amigos."
      />
      <CampanaInvitacionForm promociones={promociones} companyId={companyId} />
    </div>
  )
}
