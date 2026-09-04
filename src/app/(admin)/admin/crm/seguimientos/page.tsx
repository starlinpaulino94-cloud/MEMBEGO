import { redirect } from 'next/navigation'
import { requireSection } from '@/lib/auth/guards'
import { companyFilter } from '@/modules/admin/queries'
import { getActividades, getLeadsParaSelect } from '@/modules/crm/seguimientos-queries'
import { SeguimientosPanel } from './seguimientos-panel'

export const dynamic = 'force-dynamic'

export default async function SeguimientosPage() {
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

  const [actividades, leads] = await Promise.all([
    getActividades(companyId),
    getLeadsParaSelect(companyId),
  ])

  return (
    <div className="space-y-5">
      <SeguimientosPanel actividadesIniciales={actividades} leads={leads} />
    </div>
  )
}
