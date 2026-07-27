import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import { getCuentaDetalle } from '@/modules/carwash/cuentas'
import { EstadoCuenta } from '@/components/carwash/EstadoCuenta'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { ArrowLeft, Building2 } from 'lucide-react'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Estado de cuenta' }

/** App Car Wash · Fase 2 — estado de cuenta de una flota. */
export default async function CuentaDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId as string | undefined
  const { id } = await params
  if (!companyId) {
    return <p className="text-muted-foreground">Tu cuenta no está vinculada a una empresa.</p>
  }

  const volver = (
    <Link
      href="/admin/app/carwash/cuentas"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> Cuentas corporativas
    </Link>
  )

  if (!(await tieneCapacidad(companyId, 'CUENTAS_CORPORATIVAS'))) {
    return (
      <div className="space-y-6">
        {volver}
        <EmptyState
          icon={<Building2 className="h-7 w-7" />}
          title="Las cuentas corporativas están apagadas"
          description="Este módulo se activa por empresa desde el panel de capacidades (superadmin)."
        />
      </div>
    )
  }

  // getCuentaDetalle ya filtra por companyId: una cuenta de otra empresa da 404.
  const cuenta = await getCuentaDetalle(companyId, id)
  if (!cuenta) notFound()

  return (
    <div className="space-y-6">
      {volver}
      <PageHeader
        title={cuenta.nombre}
        description={
          [
            cuenta.rnc && `RNC ${cuenta.rnc}`,
            cuenta.contacto,
            cuenta.telefono,
            `${cuenta.diasCredito} días de crédito`,
          ]
            .filter(Boolean)
            .join(' · ') || 'Estado de cuenta'
        }
      />
      <EstadoCuenta cuenta={cuenta} />
    </div>
  )
}
