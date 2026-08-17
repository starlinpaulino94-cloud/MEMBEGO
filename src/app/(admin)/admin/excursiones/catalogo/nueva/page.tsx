import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { ExcursionForm } from '@/components/excursiones/ExcursionForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Nueva excursión' }

export default async function NuevaExcursionPage() {
  const user = await requireRole(ADMIN_ROLES)
  if (!user.metadata.companyId) return <SinEmpresaActiva seccion="el catálogo de excursiones" />

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link
        href="/admin/excursiones/catalogo"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Catálogo
      </Link>
      <h2 className="text-h2 text-foreground">Nueva excursión</h2>
      <ExcursionForm />
    </div>
  )
}
