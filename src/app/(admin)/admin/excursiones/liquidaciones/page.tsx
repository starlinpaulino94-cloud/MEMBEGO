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

      {/* ── BANNER MONEDA Y TASAS PREDETERMINADAS ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-3 text-xs">
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4 text-primary shrink-0" />
          <span className="font-semibold text-foreground">Moneda de liquidación:</span>
          <span className="font-mono font-bold bg-primary/10 text-primary px-2 py-0.5 rounded">
            {config.monedaDefecto}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
          <span>Tasas predeterminadas:</span>
          {Object.keys(config.tasasCambio).length > 0 ? (
            Object.entries(config.tasasCambio).map(([k, v]) => (
              <span key={k} className="font-mono bg-muted px-1.5 py-0.5 rounded border border-border text-foreground">
                {k.replace('_', ' → ')}: {v}
              </span>
            ))
          ) : (
            <span className="italic">Paridad 1:1 (sin tasas configuradas)</span>
          )}
        </div>
      </div>

      <LiquidacionForm pendientes={pendientes} />

      <LiquidacionesLista
        liquidaciones={liquidaciones}
        vendedores={vendedores}
        monedaDefecto={config.monedaDefecto}
      />
    </div>
  )
}
