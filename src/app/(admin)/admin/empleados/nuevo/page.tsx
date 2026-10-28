import Link from 'next/link'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { NuevoEmpleadoForm } from '@/components/admin/EmpleadoForms'
import { PageHeader } from '@/components/ui/page-header'

export const dynamic = 'force-dynamic'

export default async function NuevoEmpleadoPage() {
  await requireRole(ADMIN_ROLES)

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6">
      <PageHeader
        variant="formulario"
        className="mb-0 sm:mb-0"
        back={
          <Link href="/admin/empleados" className="text-muted-foreground hover:text-foreground">
            ‹ Equipo
          </Link>
        }
        title="Nuevo empleado"
        description="Crea su acceso con correo y contraseña. Para que la elija la persona, invítala por correo desde «Equipo»."
      />
      <NuevoEmpleadoForm />
    </div>
  )
}
