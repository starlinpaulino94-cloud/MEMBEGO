import Link from 'next/link'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { getGrowthAdminData } from '@/modules/growth/queries'
import { PageHeader } from '@/components/ui/page-header'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { ReglaRecompensaForm } from '@/components/growth/ReglaRecompensaForm'
import { ArrowLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Nueva regla de recompensa' }

export default async function NuevaReglaPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await resolveCompanyId(user)
  if (!companyId) return <SinEmpresaActiva seccion="tus reglas de recompensa" />

  const { promos, plans } = await getGrowthAdminData(companyId)

  return (
    <div className="space-y-6">
      <Link
        href="/admin/crecimiento/recompensas"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Reglas de recompensa
      </Link>

      <PageHeader
        title="Nueva regla"
        description="Define qué tiene que hacer el invitado y qué recibe a cambio."
      />

      <ReglaRecompensaForm promos={promos} plans={plans} />
    </div>
  )
}
