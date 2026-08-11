import { notFound } from 'next/navigation'
import { conEmpresaOTodas } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { companyFilter } from '@/modules/admin/queries'
import { SucursalForm } from '@/components/admin/SucursalForm'

export default async function EditarSucursalPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const { id } = await params

  const companyId = companyFilter(user)
  const suc = await conEmpresaOTodas(
    companyId,
    'sucursales · [id] · editar: sin empresa activa es el superadmin, que cruza empresas a propósito',
    (tx) => tx.sucursal.findUnique({ where: { id } })
  )
  if (!suc) return notFound()

  if (companyId && suc.companyId !== companyId) return notFound()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Editar sucursal</h1>
        <p className="text-sm text-muted-foreground">{suc.nombre}</p>
      </div>
      <SucursalForm
        existing={{
          id: suc.id,
          nombre: suc.nombre,
          direccion: suc.direccion,
          telefono: suc.telefono,
          activa: suc.activa,
        }}
      />
    </div>
  )
}
