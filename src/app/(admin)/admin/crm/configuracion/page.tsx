import { redirect } from 'next/navigation'
import { requireSection } from '@/lib/auth/guards'
import { companyFilter } from '@/modules/admin/queries'
import { getOrCreatePipelineConfig } from '@/modules/crm/queries'
import { StagesSection } from './stages-section'
import { CampoSection } from './campo-section'
import { AutomatizacionSection } from './automatizacion-section'

export const dynamic = 'force-dynamic'

export default async function ConfiguracionPage() {
  const user = await requireSection('leads')
  if (!user) redirect('/login')

  const companyId = companyFilter(user)
  if (!companyId) {
    return (
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Selecciona una empresa desde el panel de superadmin para usar el CRM.
        </p>
      </div>
    )
  }

  const config = await getOrCreatePipelineConfig(companyId)

  return (
    <div className="space-y-5">
      <StagesSection
        companyId={companyId}
        initialStages={config.stages}
      />
      <CampoSection
        companyId={companyId}
        initialCampos={config.camposCustom}
      />
      <AutomatizacionSection
        companyId={companyId}
        initialAutomatizaciones={config.automatizaciones}
      />
    </div>
  )
}
