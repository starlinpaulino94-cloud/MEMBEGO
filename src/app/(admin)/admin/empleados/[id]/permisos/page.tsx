import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { prisma } from '@/lib/prisma'
import {
  ROLES_EXENTOS_PERMISOS,
  resolverPermisosUsuario,
} from '@/lib/auth/permissions'
import { PermisosEmpleadoForm } from '@/components/admin/PermisosEmpleadoForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Permisos del empleado' }

/**
 * Módulo de PERMISOS: qué puede abrir y hacer ESTE empleado, módulo por
 * módulo y función por función. El rol da el punto de partida; aquí se
 * concede o se niega encima, y solo se guardan las diferencias.
 */
export default async function PermisosEmpleadoPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole(['SUPERADMIN', 'ADMINISTRADOR', 'ADMIN_EMPRESA'])
  const { id } = await params

  const empleado = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, companyId: true, permisos: true },
  })
  if (!empleado) notFound()
  if (
    user.metadata.role !== 'SUPERADMIN' &&
    (!empleado.companyId || empleado.companyId !== user.metadata.companyId)
  ) {
    notFound()
  }
  // Los administradores no se restringen (y nadie edita sus propios permisos).
  if (ROLES_EXENTOS_PERMISOS.includes(empleado.role) || empleado.id === user.metadata.dbUserId) {
    redirect(`/admin/empleados/${empleado.id}`)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link
          href={`/admin/empleados/${empleado.id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {empleado.name}
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-h1 text-foreground">
          <ShieldCheck className="h-6 w-6 text-primary" /> Permisos
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Su rol ({empleado.role}) da el punto de partida. Aquí concedes o quitas módulos
          completos, y dentro de los módulos con funciones controlables, cada función. Los
          cambios aplican de inmediato en las acciones; la navegación del empleado se
          actualiza al instante y la barrera de vista del sistema, con su próxima sesión.
        </p>
      </div>

      <PermisosEmpleadoForm
        userId={empleado.id}
        rol={empleado.role}
        permisosActuales={resolverPermisosUsuario(empleado.permisos)}
      />
    </div>
  )
}
