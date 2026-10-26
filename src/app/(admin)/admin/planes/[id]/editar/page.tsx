import Link from 'next/link'
import { conEmpresa } from '@/lib/tenant'
import { notFound } from 'next/navigation'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { PlanForm } from '@/components/admin/PlanForm'
import { PageHeader } from '@/components/ui/page-header'
import { valoresDePlanGuardado } from '@/modules/planes/formulario'

export const dynamic = 'force-dynamic'

export default async function EditarPlanEmpresaPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const { id } = await params

  const plan = await conEmpresa(companyId,
    (tx) => tx.plan.findUnique({ where: { id } })
  )
  if (!plan) notFound()
  // Aislamiento: solo los planes de la propia empresa (o superadmin).
  if (companyId && plan.companyId !== companyId) notFound()

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6">
      <PageHeader
        variant="formulario"
        className="mb-0 sm:mb-0"
        back={
          <Link href="/admin/planes" className="text-muted-foreground hover:text-foreground">
            ‹ Planes
          </Link>
        }
        title={`Editar plan — ${plan.nombre}`}
      />
      <PlanForm modo="editar" planId={plan.id} inicial={valoresDePlanGuardado(plan)} redirectTo="/admin/planes" />
    </div>
  )
}

