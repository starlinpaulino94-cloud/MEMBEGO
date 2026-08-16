import Link from 'next/link'
import { conEmpresaOTodas } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { companyFilter } from '@/modules/admin/queries'
import { prisma } from '@/lib/prisma'
import { formatDateTime } from '@/lib/format'
import { EliminarEmpleadoForm } from '@/components/admin/EmpleadoForms'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

function fmtDate(d: Date) {
  // La creación de la cuenta es una acción: se muestra con su hora.
  return formatDateTime(d)
}

export default async function EmpleadoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const { id } = await params
  const companyId = companyFilter(user)

  let empleado: Awaited<ReturnType<typeof prisma.user.findUnique>> = null
  try {
    empleado = await conEmpresaOTodas(
      companyId,
      'empleados · [id]: sin empresa activa es el superadmin, que cruza empresas a propósito',
      (tx) => tx.user.findUnique({ where: { id } })
    )
  } catch (e) {
    console.error('[admin-empleado-detail]', e)
    return (
      <p className="text-muted-foreground">
        No pudimos cargar este empleado en este momento. Intenta de nuevo más
        tarde.
      </p>
    )
  }

  if (!empleado || empleado.role !== 'EMPLEADO') notFound()
  if (companyId && empleado.companyId !== companyId) notFound()

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <Link
        href="/admin/empleados"
        className="text-sm text-primary hover:underline"
      >
        ← Volver a empleados
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>{empleado.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Info label="Correo" value={empleado.email} />
            <Info label="Rol" value="Empleado" />
            <Info label="Creado" value={fmtDate(empleado.createdAt)} />
          </div>
          <div className="border-t pt-4">
            <Link
              href={`/admin/empleados/${empleado.id}/permisos`}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
            >
              🛡️ Permisos: qué módulos y funciones puede usar
            </Link>
          </div>
          <div className="border-t pt-4">
            <EliminarEmpleadoForm empleadoId={empleado.id} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="font-medium text-foreground">{value}</p>
    </div>
  )
}
