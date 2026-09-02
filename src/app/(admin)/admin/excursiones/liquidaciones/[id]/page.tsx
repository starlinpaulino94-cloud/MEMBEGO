import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { liquidacionDetalle } from '@/modules/excursiones/liquidaciones/queries'
import {
  ESTADO_LIQUIDACION_LABEL,
  TONO_LIQUIDACION,
  type EstadoLiquidacion,
} from '@/modules/excursiones/liquidaciones/nucleo'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { LiquidacionAcciones } from '@/components/excursiones/LiquidacionAcciones'
import { StatusChip } from '@/components/ui/status-chip'
import { formatDate, formatDateTime, formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Liquidación' }

export default async function LiquidacionDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="las liquidaciones de excursiones" />

  const { id } = await params
  const detalle = await liquidacionDetalle(companyId, id)
  if (!detalle) notFound()
  const { liquidacion, vendedor, lineas } = detalle

  const moneda = liquidacion.moneda
  const estado = liquidacion.estado as EstadoLiquidacion
  const dinero = (n: number | string) => formatMoney(n, { moneda }, 2)

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/admin/excursiones/liquidaciones"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Liquidaciones
          </Link>
          <h2 className="mt-1 font-mono text-h2 text-foreground">{liquidacion.numero}</h2>
          <p className="text-sm text-muted-foreground">
            {vendedor ? (
              <Link
                href={`/admin/excursiones/vendedores/${vendedor.id}`}
                className="hover:text-primary hover:underline"
              >
                {vendedor.nombre} <span className="font-mono text-caption">{vendedor.codigo}</span>
              </Link>
            ) : (
              'Vendedor'
            )}{' '}
            · {formatDate(liquidacion.periodoDesde)} → {formatDate(liquidacion.periodoHasta)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-h2 text-foreground">{dinero(String(liquidacion.total))}</p>
          <StatusChip tone={TONO_LIQUIDACION[estado] ?? 'neutral'}>
            {ESTADO_LIQUIDACION_LABEL[estado] ?? liquidacion.estado}
          </StatusChip>
        </div>
      </div>

      <LiquidacionAcciones
        liquidacionId={liquidacion.id}
        estado={estado}
        numero={liquidacion.numero}
        total={Number(liquidacion.total)}
        moneda={moneda}
        vendedor={vendedor?.nombre ?? 'Vendedor'}
      />

      {liquidacion.pagadaAt ? (
        <section className="rounded-2xl border border-success/25 bg-success/5 p-4 text-sm">
          <p className="font-semibold text-foreground">
            Pagada el {formatDateTime(liquidacion.pagadaAt)}
          </p>
          <p className="text-muted-foreground">
            {liquidacion.metodo ?? 'Método no registrado'}
            {liquidacion.referencia ? ` · Ref. ${liquidacion.referencia}` : ''}
          </p>
        </section>
      ) : null}

      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-h3 text-foreground">Comisiones incluidas</h2>
        <p className="mt-1 text-caption text-muted-foreground">
          Este es el detalle del pago: cada venta, su cálculo y el neto que se liquida.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-caption uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3">Venta</th>
                <th className="py-2 pr-3">Cálculo</th>
                <th className="py-2 pr-3">Fecha</th>
                <th className="py-2 text-right">Neto</th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l) => (
                <tr key={l.id} className="border-b border-border last:border-0 align-top">
                  <td className="py-2 pr-3 font-mono text-foreground">{l.venta}</td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {l.desglose}
                    {l.ajustes.length > 0 ? (
                      <ul className="mt-1 space-y-0.5">
                        {l.ajustes.map((a, i) => (
                          <li key={i} className="text-caption">
                            Ajuste {a.monto > 0 ? '+' : ''}
                            {dinero(a.monto)} · {a.motivo}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{formatDate(l.createdAt)}</td>
                  <td className="py-2 text-right font-medium text-foreground">{dinero(l.neto)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="pt-3 text-right font-semibold text-foreground">
                  Total a pagar
                </td>
                <td className="pt-3 text-right text-h3 text-foreground">
                  {dinero(String(liquidacion.total))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {liquidacion.notas ? (
        <p className="whitespace-pre-line rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
          {liquidacion.notas}
        </p>
      ) : null}
    </div>
  )
}
