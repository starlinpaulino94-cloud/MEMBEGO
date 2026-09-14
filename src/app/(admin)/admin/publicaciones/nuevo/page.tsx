import { requireRole } from '@/lib/auth/guards'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { PostForm } from '@/components/admin/PostForm'

export const dynamic = 'force-dynamic'

export default async function NuevaPublicacionPage() {
  const user = await requireRole(ADMIN_ROLES)
  // Empresa activa del selector (respeta la selección del superadmin).
  const companyId = await resolveCompanyId(user)

  const campanas = companyId
    ? await conEmpresa(companyId,
      (tx) => tx.campana.findMany({
          where: { companyId, activo: true },
          select: { id: true, nombre: true },
          orderBy: { createdAt: 'desc' },
        })
    )
    : []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Nueva publicación</h1>
        <p className="text-muted-foreground">
          Se notificará automáticamente a los seguidores de tu empresa.
        </p>
      </div>
      <PostForm campanas={campanas} />
    </div>
  )
}

