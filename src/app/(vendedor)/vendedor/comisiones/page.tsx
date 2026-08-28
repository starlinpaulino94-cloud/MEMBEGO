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
export const metadata = { title: 'Mi dinero · Panel Vendedor' }

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

  return (
    <div className="space-y-6">
      {/* ── HEADER ── */}
      <div className="border-b border-border/60 pb-3">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
          Mi Dinero & Liquidaciones
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
          Consulta las comisiones generadas por tus reservas y el historial de pagos liquidados por la empresa.
        </p>
      </div>

      {/* ── RESUMEN DE SALDOS ── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 shadow-sm">
          <span className="text-xs font-bold uppercase tracking-wider text-primary">Comisión por cobrar</span>
          <p className="mt-1 font-mono text-3xl sm:text-4xl font-extrabold text-foreground">
            {dinero(comisiones.porCobrar, comisiones.moneda)}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Generadas por reservas completadas y listas para liquidación.
          </p>
        </div>

        <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Ya cobrado / liquidado</span>
          <p className="mt-1 font-mono text-3xl sm:text-4xl font-bold text-foreground/90">
            {dinero(comisiones.cobrado, comisiones.moneda)}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Total transferido y entregado a tu cuenta históricamente.
          </p>
        </div>
      </div>

      {comisiones.lineas.length === 0 && liquidaciones.length === 0 ? (
        <EmptyState
          icon={Coins}
          title="Todavía no tienes comisiones generadas"
          description="Tus comisiones se calculan y acreditan cuando una reserva queda cobrada. Aquí verás el detalle de cada cálculo y los recibos de pago."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2 items-start">
          {/* COMISIONES */}
          <section aria-labelledby="comisiones-list-heading" className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm space-y-4">
            <div className="border-b border-border/60 pb-3">
              <h2 id="comisiones-list-heading" className="text-base font-bold text-foreground">
                Tus Comisiones ({comisiones.lineas.length})
              </h2>
            </div>

            {comisiones.lineas.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No hay comisiones recientes.</p>
            ) : (
              <div className="space-y-2.5 max-h-[450px] overflow-y-auto pr-1">
                {comisiones.lineas.map((l) => (
                  <article key={l.id} className="rounded-xl border border-border/60 bg-muted/20 p-3.5 transition-all hover:bg-muted/40">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-xs font-bold text-foreground">{l.desglose}</p>
                        <p className="text-xs text-muted-foreground">
                          Venta <span className="font-mono font-semibold">{l.venta}</span> · {formatDate(l.createdAt)}
                          {l.liquidacion ? (
                            <> · Pago <span className="font-mono font-semibold">{l.liquidacion}</span></>
                          ) : null}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-mono font-bold text-sm text-foreground">{dinero(l.neto, l.moneda)}</p>
                        <div className="mt-1">
                          <StatusChip tone={TONO_COMISION[l.estado as EstadoComision] ?? 'neutral'}>
                            {ESTADO_COMISION_LABEL[l.estado as EstadoComision] ?? l.estado}
                          </StatusChip>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* LIQUIDACIONES / PAGOS */}
          <section aria-labelledby="liquidaciones-heading" className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm space-y-4">
            <div className="border-b border-border/60 pb-3">
              <h2 id="liquidaciones-heading" className="text-base font-bold text-foreground">
                Historial de Pagos & Liquidaciones ({liquidaciones.length})
              </h2>
            </div>

            {liquidaciones.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No hay liquidaciones cerradas aún.</p>
            ) : (
              <div className="space-y-2.5 max-h-[450px] overflow-y-auto pr-1">
                {liquidaciones.map((l) => (
                  <article
                    key={l.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/20 p-3.5 transition-all hover:bg-muted/40"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-mono text-xs font-bold text-foreground">{l.numero}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(l.periodoDesde)} → {formatDate(l.periodoHasta)}
                        {l.pagadaAt ? ` · Pagado ${formatDate(l.pagadaAt)}` : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono font-bold text-sm text-foreground">{dinero(String(l.total), l.moneda)}</p>
                      <div className="mt-1">
                        <StatusChip tone={TONO_LIQUIDACION[l.estado as EstadoLiquidacion] ?? 'neutral'}>
                          {ESTADO_LIQUIDACION_LABEL[l.estado as EstadoLiquidacion] ?? l.estado}
                        </StatusChip>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
