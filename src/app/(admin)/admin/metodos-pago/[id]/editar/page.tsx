import { notFound } from 'next/navigation'
import { conEmpresaOTodas } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { companyFilter } from '@/modules/admin/queries'
import { MetodoPagoForm } from '@/components/admin/MetodoPagoForm'

export default async function EditarMetodoPagoPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const { id } = await params

  const companyId = companyFilter(user)
  const method = await conEmpresaOTodas(
    companyId,
    'metodos-pago · [id] · editar: sin empresa activa es el superadmin, que cruza empresas a propósito',
    (tx) => tx.metodoPago.findUnique({ where: { id } })
  )
  if (!method) return notFound()

  if (companyId && method.companyId !== companyId) return notFound()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Editar método de pago</h1>
        <p className="text-muted-foreground">{method.nombre}</p>
      </div>
      <MetodoPagoForm
        existing={{
          id: method.id,
          tipo: method.tipo,
          nombre: method.nombre,
          titular: method.titular,
          numeroCuenta: method.numeroCuenta,
          tipoCuenta: method.tipoCuenta,
          instrucciones: method.instrucciones,
          activo: method.activo,
        }}
      />
    </div>
  )
}
