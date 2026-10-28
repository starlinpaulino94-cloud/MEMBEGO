import Link from 'next/link'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { CrearOfertaForm } from '@/components/ofertas/CrearOfertaForm'
import { PageHeader } from '@/components/ui/page-header'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Crear regalo VIP' }

export default async function NuevaOfertaPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)

  if (!companyId) {
    return <SinEmpresaActiva seccion="tus regalos VIP" />
  }

  const clientes = await conEmpresa(companyId,
    (tx) => tx.cliente.findMany({
      where: { companyId },
      select: { id: true, nombre: true, email: true, telefono: true },
      orderBy: { nombre: 'asc' },
      take: 1000,
    })
  )

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6">
      <PageHeader
        variant="formulario"
        className="mb-0 sm:mb-0"
        back={
          <Link href="/admin/ofertas/vip" className="text-muted-foreground hover:text-foreground">
            ‹ Regalos VIP
          </Link>
        }
        title="Crear regalo VIP"
        description="Define el regalo, su regla de usos y la lista cerrada de clientes. Al crearlo obtendrás el link privado para compartir."
      />

      <CrearOfertaForm clientes={clientes} />
    </div>
  )
}

