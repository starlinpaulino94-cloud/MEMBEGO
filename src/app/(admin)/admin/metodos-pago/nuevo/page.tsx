import { requireRole } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { MetodoPagoForm } from '@/components/admin/MetodoPagoForm'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'

export default async function NuevoMetodoPagoPage() {
  const user = await requireRole(ADMIN_ROLES)

  // El superadmin no tiene empresa en la sesión: debe elegir a qué empresa
  // pertenece el método de pago. El admin de empresa usa la suya (sin selector).
  const companies =
    user.metadata.role === 'SUPERADMIN'
      ? await sinEmpresa(
          'metodos-pago · nuevo: el superadmin elige a qué empresa pertenece',
          (tx) => tx.company.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } })
        ).catch(() => [])
      : undefined

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6">
      <PageHeader
        variant="formulario"
        className="mb-0 sm:mb-0"
        back={
          <Link href="/admin/metodos-pago" className="text-muted-foreground hover:text-foreground">
            ‹ Métodos de pago
          </Link>
        }
        title="Nuevo método de pago"
        description="Configura las instrucciones que verán los clientes al pagar."
      />
      <MetodoPagoForm companies={companies} />
    </div>
  )
}
