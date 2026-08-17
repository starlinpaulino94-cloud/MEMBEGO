import { redirect } from 'next/navigation'
import { Coins } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import {
  vendedorDeUsuario,
  misComisiones,
  misLiquidaciones,
} from '@/modules/excursiones/panel/queries'
import {
  ESTADO_COMISION_LABEL,
  TONO_COMISION,
  type EstadoComision,
} from '@/modules/excursiones/comisiones/nucleo'
import {
  ESTADO_LIQUIDACION_LABEL,
  TONO_LIQUIDACION,
  type EstadoLiquidacion,
} from '@/modules/excursiones/liquidaciones/nucleo'
import { StatusChip } from '@/components/ui/status-chip'
import { EmptyState } from '@/components/system/EmptyState'
import { formatDate, formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mi dinero' }

export default async function MiDineroPage() {
  const user = await requireRole(['VENDEDOR'])
  const vendedor = user.metadata.dbUserId
    ? await vendedorDeUsuario(user.metadata.dbUserId)
    : null
  if (!vendedor) redirect('/login')

  const [comisiones, liquidaciones] = await Promise.all([
    misComisiones(vendedor.companyId, vendedor.id),
    misLiquidaciones(vendedor.companyId, vendedor.id),
  ])
  const dinero = (n: number | string, moneda: string) => formatMoney(n, { moneda }, 2)

  if (comisiones.lineas.length === 0 && liquidaciones.length === 0) {
    return (
      <EmptyState
        icon={Coins}
        title="Todavía no tienes comisiones"
        description="Tu comisión se genera cuando una reserva tuya queda cobrada por completo. Aquí verás cada una con su cálculo y cuándo te la pagaron."
      />
    )
  }

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4 text-center">
          <dd className="text-h2 text-foreground">
            {dinero(comisiones.porCobrar, comisiones.moneda)}
          </dd>
          <dt className="text-caption text-muted-foreground">Por cobrar</dt>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 text-center">
          <dd className="text-h2 text-foreground">
            {dinero(comisiones.cobrado, comisiones.moneda)}
          </dd>
          <dt className="text-caption text-muted-foreground">Ya cobrado</dt>
        </div>
      </dl>

      {comisiones.lineas.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-h3 text-foreground">Tus comisiones</h2>
          {comisiones.lineas.map((l) => (
            <article key={l.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-foreground">{l.desglose}</p>
                  <p className="text-caption text-muted-foreground">
                    Venta <span className="font-mono">{l.venta}</span> · {formatDate(l.createdAt)}
                    {l.liquidacion ? (
                      <> · pago <span className="font-mono">{l.liquidacion}</span></>
                    ) : null}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-foreground">{dinero(l.neto, l.moneda)}</p>
                  <StatusChip tone={TONO_COMISION[l.estado as EstadoComision] ?? 'neutral'}>
                    {ESTADO_COMISION_LABEL[l.estado as EstadoComision] ?? l.estado}
                  </StatusChip>
                </div>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {liquidaciones.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-h3 text-foreground">Tus pagos</h2>
          {liquidaciones.map((l) => (
            <article
              key={l.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-card p-4"
            >
              <div className="min-w-0">
                <p className="font-mono font-semibold text-foreground">{l.numero}</p>
                <p className="text-caption text-muted-foreground">
                  {formatDate(l.periodoDesde)} → {formatDate(l.periodoHasta)}
                  {l.pagadaAt ? ` · pagado el ${formatDate(l.pagadaAt)}` : ''}
                </p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-foreground">{dinero(String(l.total), l.moneda)}</p>
                <StatusChip tone={TONO_LIQUIDACION[l.estado as EstadoLiquidacion] ?? 'neutral'}>
                  {ESTADO_LIQUIDACION_LABEL[l.estado as EstadoLiquidacion] ?? l.estado}
                </StatusChip>
              </div>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  )
}
