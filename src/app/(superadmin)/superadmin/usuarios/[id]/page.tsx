import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { prisma } from '@/lib/prisma'
import { UsuarioStaffForm } from '@/components/superadmin/UsuarioStaffForm'
import { EliminarCuentaButton } from '@/components/superadmin/EliminarCuentaButton'

export const dynamic = 'force-dynamic'

export default async function EditarUsuarioStaffPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole('SUPERADMIN')
  const { id } = await params

  const [usuario, companies] = await Promise.all([
    prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        companyId: true,
        empresasAcceso: { select: { companyId: true } },
      },
    }),
    prisma.company.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ])

  // Solo staff: las cuentas SUPERADMIN y CLIENTE no se editan desde aquí.
  if (!usuario || usuario.role === 'SUPERADMIN' || usuario.role === 'CLIENTE') {
    notFound()
  }

  return (
    <div className="space-y-6">
      <Link
        href="/superadmin/usuarios"
        className="inline-flex items-center gap-1.5 text-small text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Usuarios de staff
      </Link>

      <div>
        <h1 className="text-h1 text-foreground">Editar usuario</h1>
        <p className="text-muted-foreground">
          Controla su rol, sus empresas y su acceso. Los cambios aplican en su
          próxima navegación.
        </p>
      </div>

      <UsuarioStaffForm
        usuario={{
          id: usuario.id,
          name: usuario.name,
          email: usuario.email,
          role: usuario.role,
          companyId: usuario.companyId,
          accesoIds: usuario.empresasAcceso.map((a) => a.companyId),
        }}
        companies={companies}
      />

      {/* Zona de peligro: eliminación definitiva (solo superadmin) */}
      <div className="rounded-2xl border border-destructive/25 bg-destructive/5 p-5">
        <h2 className="text-sm font-semibold text-foreground">Zona de peligro</h2>
        <p className="mt-1 mb-4 text-small text-muted-foreground">
          Elimina la cuenta y su acceso a la plataforma. Si el usuario abrió
          sesiones de caja, la eliminación se bloquea para proteger los
          registros contables.
        </p>
        <EliminarCuentaButton
          tipo="usuario"
          id={usuario.id}
          nombre={usuario.name}
          redirectTo="/superadmin/usuarios"
        />
      </div>
    </div>
  )
}
