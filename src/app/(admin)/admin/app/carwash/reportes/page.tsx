import Link from 'next/link'
import { conEmpresaOTodas } from '@/lib/tenant'
import Form from 'next/form'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { getReporteOperativo } from '@/modules/apps/reportes'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ArrowLeft, BarChart3, Download } from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Reportes operativos' }

function fmtRD(n: number) {
  return new Intl.NumberFormat('es-DO', {
    style: 'currency',
    currency: 'DOP',
    maximumFractionDigits: 0,
  }).format(n)
}

/** "1 h 25 min" a partir de minutos; null → guion. */
function fmtDuracion(min: number | null) {
  if (min == null) return '—'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** Fecha 'YYYY-MM-DD' → "lun 10 mar" (sin depender de la zona del servidor). */
function fmtDia(ymd: string) {
  const [a, m, d] = ymd.split('-').map(Number)
  return new Intl.DateTimeFormat('es-DO', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(Date.UTC(a, m - 1, d)))
}

/**
 * REPORTES OPERATIVOS de la app Car Wash (F3).
 * Responde "¿cómo nos fue?": cuántos vehículos, cuánto tardamos, qué se pidió
 * más y qué insumos se consumieron, en el rango que elija el encargado.
 */
export default async function ReportesOperativosPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId as string | undefined
  const { desde, hasta } = await searchParams
  if (!companyId) {
    return <p className="text-muted-foreground">Tu cuenta no está vinculada a una empresa.</p>
  }

  const empresa = await conEmpresaOTodas(
    companyId,
    'app · carwash · reportes: sin empresa activa es el superadmin',
    (tx) => tx.company
      .findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      .catch(() => null)
  )
  const tz = empresa?.zonaHoraria || 'America/Santo_Domingo'

  let reporte: Awaited<ReturnType<typeof getReporteOperativo>> | null = null
  try {
    reporte = await getReporteOperativo(companyId, { desde, hasta }, tz)
  } catch (e) {
    console.error('[reportes operativos]', e)
  }

  const volver = (
    <Link
      href="/admin/app/carwash"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> Car Wash
    </Link>
  )

  if (!reporte) {
    return (
      <div className="space-y-6">
        {volver}
        <EmptyState
          icon={<BarChart3 className="h-7 w-7" />}
          title="No se pudo cargar el reporte"
          description="Intenta de nuevo en unos momentos."
        />
      </div>
    )
  }

  const exportQs = new URLSearchParams({
    desde: reporte.rango.desde,
    hasta: reporte.rango.hasta,
  }).toString()
  const conMovimiento = reporte.dias.filter(
    (d) => d.vehiculos > 0 || d.canjes > 0 || d.ventas > 0
  )

  const kpis = [
    { label: 'Vehículos atendidos', valor: String(reporte.totalVehiculos) },
    { label: 'Tiempo promedio', valor: fmtDuracion(reporte.minutosPromedio) },
    { label: 'Canjes', valor: String(reporte.totalCanjes) },
    { label: 'Vendido', valor: fmtRD(reporte.montoTotal) },
  ]

  return (
    <div className="space-y-6">
      {volver}
      <PageHeader
        title="Reportes operativos"
        description="Cómo nos fue: vehículos atendidos, tiempo de servicio, canjes y consumo de insumos."
      />

      <Form
        action="/admin/app/carwash/reportes"
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-border/70 bg-card p-4"
      >
        <label className="text-xs text-muted-foreground">
          Desde
          <Input type="date" name="desde" defaultValue={reporte.rango.desde} className="mt-1" />
        </label>
        <label className="text-xs text-muted-foreground">
          Hasta
          <Input type="date" name="hasta" defaultValue={reporte.rango.hasta} className="mt-1" />
        </label>
        <Button type="submit" variant="secondary">Ver</Button>
        <Button asChild variant="ghost" className="gap-1.5">
          <Link href={`/admin/app/carwash/reportes/export?${exportQs}`}>
            <Download className="h-4 w-4" /> CSV
          </Link>
        </Button>
      </Form>

      {reporte.recortado && (
        <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          El rango pedido era muy amplio; se muestran los primeros 92 días.
        </p>
      )}

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-2xl border border-border/70 bg-card p-4">
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{k.label}</dt>
            <dd className="mt-1 truncate text-lg font-bold tabular-nums text-foreground">
              {k.valor}
            </dd>
          </div>
        ))}
      </dl>

      {reporte.minutosPromedio != null && (
        <p className="text-xs text-muted-foreground">
          El tiempo promedio se calcula sobre {reporte.entregasMedidas} entrega
          {reporte.entregasMedidas !== 1 ? 's' : ''} con hora de entrada y salida registrada.
        </p>
      )}

      {conMovimiento.length === 0 ? (
        <EmptyState
          icon={<BarChart3 className="h-7 w-7" />}
          title="Sin movimiento en este rango"
          description="Elige otras fechas, o registra vehículos en la cola para que aparezcan aquí."
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Día</th>
                <th className="px-4 py-3 text-right font-semibold">Vehículos</th>
                <th className="px-4 py-3 text-right font-semibold">Canjes</th>
                <th className="px-4 py-3 text-right font-semibold">Ventas</th>
                <th className="px-4 py-3 text-right font-semibold">Monto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {conMovimiento.map((d) => (
                <tr key={d.fecha}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-foreground">{fmtDia(d.fecha)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{d.vehiculos}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{d.canjes}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{d.ventas}</td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums text-foreground">
                    {d.montoVentas > 0 ? fmtRD(d.montoVentas) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border/60 bg-muted/30 font-bold">
                <td className="px-4 py-2.5 text-foreground">Total</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{reporte.totalVehiculos}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{reporte.totalCanjes}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{reporte.totalVentas}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{fmtRD(reporte.montoTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-border/70 bg-card p-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Servicios más pedidos
          </h2>
          {reporte.serviciosTop.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin datos: escribe el servicio al registrar el vehículo en la cola.
            </p>
          ) : (
            <ul className="divide-y divide-border/50">
              {reporte.serviciosTop.map((s) => (
                <li key={s.servicio} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="truncate text-foreground">{s.servicio}</span>
                  <span className="shrink-0 font-bold tabular-nums text-foreground">{s.veces}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-border/70 bg-card p-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Consumo de insumos
          </h2>
          {reporte.consumo.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin salidas de inventario registradas en este rango.
            </p>
          ) : (
            <ul className="divide-y divide-border/50">
              {reporte.consumo.map((c) => (
                <li key={c.producto} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="truncate text-foreground">{c.producto}</span>
                  <span className="shrink-0 font-bold tabular-nums text-foreground">
                    {c.cantidad} <span className="text-xs font-normal text-muted-foreground">{c.unidad}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
