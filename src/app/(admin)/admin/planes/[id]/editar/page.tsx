import Link from 'next/link'
import { conEmpresa } from '@/lib/tenant'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { EditarPlanForm } from '@/components/admin/EditarPlanForm'

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
    <div className="max-w-xl space-y-6">
      <Link
        href="/admin/planes"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Volver a planes
      </Link>
      <h1 className="text-2xl font-bold text-foreground">
        Editar plan — {plan.nombre}
      </h1>
      <EditarPlanForm plan={plan} redirectTo="/admin/planes" />
    </div>
  )
}

