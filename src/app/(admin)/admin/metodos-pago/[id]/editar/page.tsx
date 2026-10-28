import { notFound } from 'next/navigation'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { MetodoPagoForm } from '@/components/admin/MetodoPagoForm'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'

export default async function EditarMetodoPagoPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const { id } = await params

  const companyId = await requireCompanyContext(user)
  const method = await conEmpresa(companyId,
    (tx) => tx.metodoPago.findUnique({ where: { id } })
  )
  if (!method) return notFound()

  if (companyId && method.companyId !== companyId) return notFound()

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
        title="Editar método de pago"
        description={method.nombre}
      />
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

