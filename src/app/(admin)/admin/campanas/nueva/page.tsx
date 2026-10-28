import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { CampanaForm } from '@/components/admin/CampanaForm'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'

export default async function NuevaCampanaPage() {
  await requireRole(ADMIN_ROLES)
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
        title="Nueva campaña"
        description="Después de crearla podrás asignarle promociones y publicaciones desde sus formularios."
      />
      <CampanaForm />
    </div>
  )
}
