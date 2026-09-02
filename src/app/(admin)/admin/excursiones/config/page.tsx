import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { getExcursionesConfig } from '@/modules/excursiones/config'
import { ExcursionesConfigForm } from '@/components/excursiones/ExcursionesConfigForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Configuración de Excursiones' }

export default async function ExcursionesConfigPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="la configuración de excursiones" />

  const config = await getExcursionesConfig(companyId)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
          Configuración del Módulo
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
          Ajusta las políticas de reserva, cancelación, reembolso y reglas de atribución comercial.
        </p>
      </div>

      <ExcursionesConfigForm config={config} />
    </div>
  )
}
