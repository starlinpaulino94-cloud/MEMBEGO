export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { prisma } from '@/lib/prisma'
import { EditarPlanForm } from '@/components/admin/EditarPlanForm'

export default async function EditarPlanPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole('SUPERADMIN')
  const { id } = await params

  const plan = await prisma.plan.findUnique({
    where: { id },
    include: { company: true },
  })
  if (!plan) notFound()

  return (
    <div className="max-w-xl space-y-6">
      <Link href="/superadmin/planes" className="text-sm text-primary hover:underline">
        ← Volver a planes
      </Link>
      <h1 className="text-h1 text-foreground">Editar plan — {plan.nombre}</h1>
      <EditarPlanForm plan={plan} />
    </div>
  )
}
