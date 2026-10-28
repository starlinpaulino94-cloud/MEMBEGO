import { requireRole } from '@/lib/auth/guards'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { PostForm } from '@/components/admin/PostForm'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'

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
    <div className="mx-auto w-full max-w-[720px] space-y-6">
      <PageHeader
        variant="formulario"
        className="mb-0 sm:mb-0"
        back={
          <Link href="/admin/publicaciones" className="text-muted-foreground hover:text-foreground">
            ‹ Publicaciones
          </Link>
        }
        title="Nueva publicación"
        description="Se notificará automáticamente a los seguidores de tu empresa."
      />
      <PostForm campanas={campanas} />
    </div>
  )
}

