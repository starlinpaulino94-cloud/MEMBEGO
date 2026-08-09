export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { prisma } from '@/lib/prisma'
import { NuevoPlanForm } from '@/components/admin/NuevoPlanForm'

export default async function NuevoPlanPage() {
  await requireRole('SUPERADMIN')

  const companies = await prisma.company.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  })

  return (
    <div className="max-w-xl space-y-6">
      <Link href="/superadmin/planes" className="text-sm text-primary hover:underline">
        ← Volver a planes
      </Link>
      <h1 className="text-h1 text-foreground">Nuevo plan</h1>
      <NuevoPlanForm companies={companies} />
    </div>
  )
}
