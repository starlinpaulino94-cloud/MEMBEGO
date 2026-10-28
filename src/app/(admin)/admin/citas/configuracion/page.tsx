import Link from 'next/link'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { getAgendaConfig } from '@/modules/citas/queries'
import { PageHeader } from '@/components/ui/page-header'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { AgendaConfigForm } from '@/components/citas/AgendaConfigForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Configuración de citas' }

export default async function ConfiguracionCitasPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)

  if (!companyId) {
    return <SinEmpresaActiva seccion="la agenda de citas" />
  }

  const config = await getAgendaConfig(companyId)

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6">
      <PageHeader
        variant="formulario"
        className="mb-0 sm:mb-0"
        back={
          <Link href="/admin/citas" className="text-muted-foreground hover:text-foreground">
            ‹ Citas
          </Link>
        }
        title="Configuración de la agenda"
        description="Define cuántas citas aceptas por turno y por día, tu horario semanal y las reglas de reserva. Los cambios aplican de inmediato."
      />

      <AgendaConfigForm config={config} />
    </div>
  )
}

