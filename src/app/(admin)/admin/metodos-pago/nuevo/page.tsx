import { requireRole } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { MetodoPagoForm } from '@/components/admin/MetodoPagoForm'

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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Nuevo método de pago</h1>
        <p className="text-muted-foreground">
          Configura las instrucciones que verán los clientes al pagar.
        </p>
      </div>
      <MetodoPagoForm companies={companies} />
    </div>
  )
}
