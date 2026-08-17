import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import {
  listadoLiquidaciones,
  vendedoresPorLiquidar,
} from '@/modules/excursiones/liquidaciones/queries'
import {
  ESTADO_LIQUIDACION_LABEL,
  TONO_LIQUIDACION,
  type EstadoLiquidacion,
} from '@/modules/excursiones/liquidaciones/nucleo'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { LiquidacionForm } from '@/components/excursiones/LiquidacionForm'
import { StatusChip } from '@/components/ui/status-chip'
import { formatDate, formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Liquidaciones' }

export default async function LiquidacionesPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="las liquidaciones de excursiones" />

  const [liquidaciones, pendientes] = await Promise.all([
    listadoLiquidaciones(companyId),
    vendedoresPorLiquidar(companyId),
  ])

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <p className="text-sm text-muted-foreground">
        Una liquidación agrupa las comisiones aprobadas de un vendedor en un período y las paga
        de una vez. Una comisión entra en una sola liquidación: nadie cobra dos veces lo mismo.
      </p>

      <LiquidacionForm pendientes={pendientes} />

      {liquidaciones.length > 0 ? (
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-h3 text-foreground">Liquidaciones</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-caption uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">Número</th>
                  <th className="py-2 pr-3">Vendedor</th>
                  <th className="py-2 pr-3">Período</th>
                  <th className="py-2 pr-3">Comisiones</th>
                  <th className="py-2 pr-3">Total</th>
                  <th className="py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {liquidaciones.map((l) => (
                  <tr key={l.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3">
                      <Link
                        href={`/admin/excursiones/liquidaciones/${l.id}`}
                        className="font-mono font-semibold text-foreground hover:text-primary hover:underline"
                      >
                        {l.numero}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-foreground">{l.vendedor}</td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {formatDate(l.periodoDesde)} → {formatDate(l.periodoHasta)}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">{l.comisiones}</td>
                    <td className="py-2 pr-3 text-foreground">
                      {formatMoney(l.total, { moneda: l.moneda }, 2)}
                    </td>
                    <td className="py-2">
                      <StatusChip tone={TONO_LIQUIDACION[l.estado as EstadoLiquidacion] ?? 'neutral'}>
                        {ESTADO_LIQUIDACION_LABEL[l.estado as EstadoLiquidacion] ?? l.estado}
                      </StatusChip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  )
}
