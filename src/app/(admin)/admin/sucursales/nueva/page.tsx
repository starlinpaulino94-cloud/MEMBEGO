import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { SucursalForm } from '@/components/admin/SucursalForm'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'

export default async function NuevaSucursalPage() {
  await requireRole(ADMIN_ROLES)
  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6">
      <PageHeader
        variant="formulario"
        className="mb-0 sm:mb-0"
        back={
          <Link href="/admin/sucursales" className="text-muted-foreground hover:text-foreground">
            ‹ Sucursales
          </Link>
        }
        title="Nueva sucursal"
        description="Las sucursales activas aparecen en el escáner del empleado."
      />
      <SucursalForm />
    </div>
  )
}
