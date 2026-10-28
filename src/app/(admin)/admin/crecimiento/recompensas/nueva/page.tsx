import Link from 'next/link'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { getGrowthAdminData } from '@/modules/growth/queries'
import { PageHeader } from '@/components/ui/page-header'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { ReglaRecompensaForm } from '@/components/growth/ReglaRecompensaForm'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Nueva regla de recompensa' }

export default async function NuevaReglaPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await resolveCompanyId(user)
  if (!companyId) return <SinEmpresaActiva seccion="tus reglas de recompensa" />

  const { promos, plans } = await getGrowthAdminData(companyId)

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6">
      <PageHeader
        variant="formulario"
        className="mb-0 sm:mb-0"
        back={
          <Link href="/admin/crecimiento/recompensas" className="text-muted-foreground hover:text-foreground">
            ‹ Reglas de recompensa
          </Link>
        }
        title="Nueva regla"
        description="Define qué tiene que hacer el invitado y qué recibe a cambio."
      />

      <ReglaRecompensaForm promos={promos} plans={plans} />
    </div>
  )
}
