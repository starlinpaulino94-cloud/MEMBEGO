import { notFound } from 'next/navigation'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { SucursalForm } from '@/components/admin/SucursalForm'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'

export default async function EditarSucursalPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const { id } = await params

  const companyId = await requireCompanyContext(user)
  const suc = await conEmpresa(companyId,
    (tx) => tx.sucursal.findUnique({ where: { id } })
  )
  if (!suc) return notFound()

  if (companyId && suc.companyId !== companyId) return notFound()

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
        title="Editar sucursal"
        description={suc.nombre}
      />
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

