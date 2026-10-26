export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { sinEmpresa } from '@/lib/tenant'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { PlanForm } from '@/components/admin/PlanForm'
import { PageHeader } from '@/components/ui/page-header'
import { valoresDePlanGuardado } from '@/modules/planes/formulario'

export default async function EditarPlanPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole('SUPERADMIN')
  const { id } = await params

  const plan = await sinEmpresa(
    'planes globales · editar: el superadmin edita el plan de cualquier empresa',
    (tx) => tx.plan.findUnique({
      where: { id },
      include: { company: true },
    })
  )
  if (!plan) notFound()

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6">
      <PageHeader
        variant="formulario"
        className="mb-0 sm:mb-0"
        back={
          <Link href="/superadmin/planes" className="text-muted-foreground hover:text-foreground">
            ‹ Planes
          </Link>
        }
        title={`Editar plan — ${plan.nombre}`}
      />
      <PlanForm modo="editar" planId={plan.id} inicial={valoresDePlanGuardado(plan)} />
    </div>
  )
}
