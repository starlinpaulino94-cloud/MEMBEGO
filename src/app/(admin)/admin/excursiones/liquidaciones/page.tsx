import { ArrowLeftRight } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import {
  listadoLiquidaciones,
  vendedoresPorLiquidar,
} from '@/modules/excursiones/liquidaciones/queries'
import { vendedoresParaFiltro } from '@/modules/excursiones/comisiones/queries'
import { getExcursionesConfig } from '@/modules/excursiones/config'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { LiquidacionForm } from '@/components/excursiones/LiquidacionForm'
import { LiquidacionesLista } from '@/components/excursiones/LiquidacionesLista'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Liquidaciones' }

export default async function LiquidacionesPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="las liquidaciones de excursiones" />

  const [liquidaciones, pendientes, config, vendedores] = await Promise.all([
    listadoLiquidaciones(companyId),
    vendedoresPorLiquidar(companyId),
    getExcursionesConfig(companyId),
    vendedoresParaFiltro(companyId),
  ])

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <p className="text-sm text-muted-foreground">
        Una liquidación agrupa las comisiones aprobadas de un vendedor en un período y las paga
        de una vez. Una comisión entra en una sola liquidación: nadie cobra dos veces lo mismo.
      </p>

      <LiquidacionForm pendientes={pendientes} />

      <LiquidacionesLista
        liquidaciones={liquidaciones}
        vendedores={vendedores}
        monedaDefecto={config.monedaDefecto}
      />
    </div>
  )
}
