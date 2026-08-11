export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { sinEmpresa } from '@/lib/tenant'
import { requireRole } from '@/lib/auth/guards'
import { NuevoPlanForm } from '@/components/admin/NuevoPlanForm'

export default async function NuevoPlanPage() {
  await requireRole('SUPERADMIN')

  const companies = await sinEmpresa(
    'planes globales · nuevo: el superadmin elige a qué empresa pertenece',
    (tx) => tx.company.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    })
  )

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
