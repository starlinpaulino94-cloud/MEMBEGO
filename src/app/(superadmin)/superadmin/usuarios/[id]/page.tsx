import Link from 'next/link'
import { sinEmpresa } from '@/lib/tenant'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
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

  const [usuario, companies] = await sinEmpresa(
    'usuarios de la plataforma: la ficha es de cualquier empresa',
    (tx) => Promise.all([
      tx.user.findUnique({
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
      tx.company.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
    ])
  )

  /**
   * LOS CLIENTES NO; LOS SUPERADMIN SÍ.
   *
   * Antes se bloqueaba también a los superadmin, y el efecto era que corregirle
   * una letra al nombre de un superadmin —o cambiarle la contraseña— había que
   * hacerlo en la base de datos. Lo que hay que proteger es el RANGO, no la
   * ficha: el rango se cambia desde la lista, con su confirmación, y el
   * formulario ni siquiera lo ofrece.
   *
   * Los clientes siguen fuera porque su ficha es otra cosa —membresías,
   * vehículos, historial— y vive en el panel de la empresa.
   */
  if (!usuario || usuario.role === 'CLIENTE') {
    notFound()
  }
  const esSuperadmin = usuario.role === 'SUPERADMIN'

  return (
    <div className="space-y-6">
      <Link
        href="/superadmin/usuarios"
        className="inline-flex items-center gap-1.5 text-small text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Usuarios y accesos
      </Link>

      <div>
        <h1 className="text-h1 text-foreground">Editar usuario</h1>
        <p className="text-muted-foreground">
          {esSuperadmin
            ? 'Sus datos y sus empresas. El rango de superadmin se otorga y se retira desde la lista.'
            : 'Controla su rol, sus empresas y su acceso. Los cambios aplican en su próxima navegación.'}
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
        esSuperadmin={esSuperadmin}
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
