import Link from 'next/link'
import { Map, Users, Ticket, Coins, Wallet, Target, BarChart3, ArrowRight } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { resumenDelPeriodo, rankingVendedores } from '@/modules/excursiones/metricas/queries'
import { rangoDelPanel, RANGOS_PANEL } from '@/modules/excursiones/metricas/nucleo'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Parques y Tours' }

/**
 * Panel del vertical: primero las cifras del período, después las puertas.
 *
 * Todas las cifras se CALCULAN al abrir la pantalla, sobre las filas reales:
 * no hay contadores guardados que puedan quedar desincronizados. Lo que no se
 * puede calcular todavía no se pinta — nada de métricas de adorno.
 */
const DISPONIBLES = [
  {
    href: '/admin/excursiones/catalogo',
    icon: Map,
    titulo: 'Catálogo',
    detalle: 'Actividades, variantes y horarios de salida.',
  },
  {
    href: '/admin/excursiones/vendedores',
    icon: Users,
    titulo: 'Vendedores',
    detalle: 'Su código, su enlace, su QR y su acceso al panel.',
  },
  {
    href: '/admin/excursiones/reservas',
    icon: Ticket,
    titulo: 'Reservas',
    detalle: 'Pasajeros, pagos parciales y confirmación de venta.',
  },
  {
    href: '/admin/excursiones/comisiones',
    icon: Coins,
    titulo: 'Comisiones',
    detalle: 'Reglas por vendedor y excursión, con su snapshot.',
  },
  {
    href: '/admin/excursiones/liquidaciones',
    icon: Wallet,
    titulo: 'Liquidaciones',
    detalle: 'El pago de las comisiones aprobadas de un período.',
  },
  {
    href: '/admin/excursiones/metas',
    icon: Target,
    titulo: 'Metas',
    detalle: 'Qué se le pide a cada vendedor y cómo va.',
  },
  {
    href: '/admin/excursiones/reportes',
    icon: BarChart3,
    titulo: 'Reportes',
    detalle: 'Ventas, comisiones y liquidaciones del período, en un CSV.',
  },
]

export default async function ExcursionesPanelPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="el panel de excursiones" />

  const { r } = await searchParams
  const clave = r ?? 'MES'
  const { label, rango } = rangoDelPanel(clave, new Date())
  const [resumen, ranking] = await Promise.all([
    resumenDelPeriodo(companyId, rango),
    rankingVendedores(companyId, rango),
  ])

  const dinero = (n: number) => formatMoney(n, { moneda: resumen.moneda }, 2)

  const kpis = [
    { label: 'Clientes captados', valor: String(resumen.registros), pie: 'por el QR de un vendedor' },
    { label: 'Reservas', valor: String(resumen.reservas), pie: `${resumen.pasajerosReservados} pasajeros` },
    { label: 'Ventas', valor: String(resumen.ventas), pie: `${resumen.pasajerosVendidos} pasajeros` },
    { label: 'Ingresos', valor: dinero(resumen.ingresos), pie: 'ventas confirmadas' },
    {
      label: 'Ticket promedio',
      valor: resumen.ticket !== null ? dinero(resumen.ticket) : '—',
      pie: resumen.ticket !== null ? 'por venta' : 'sin ventas todavía',
    },
    { label: 'Comisiones', valor: dinero(resumen.comisionado), pie: 'generadas en el período' },
  ]

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-h3 text-foreground">{label}</h2>
          <nav aria-label="Período" className="flex gap-1">
            {RANGOS_PANEL.map((opcion) => (
              <Link
                key={opcion.clave}
                href={`/admin/excursiones?r=${opcion.clave}`}
                className={
                  opcion.clave === clave
                    ? 'rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground'
                    : 'rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground'
                }
              >
                {opcion.label}
              </Link>
            ))}
          </nav>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {kpis.map((k) => (
            <div key={k.label} className="rounded-2xl border border-border bg-card p-4">
              <dd className="text-h2 text-foreground">{k.valor}</dd>
              <dt className="text-sm font-medium text-foreground">{k.label}</dt>
              <p className="text-caption text-muted-foreground">{k.pie}</p>
            </div>
          ))}
        </dl>

        {resumen.conversionReserva !== null || resumen.conversionVenta !== null ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {resumen.conversionReserva !== null
              ? `${resumen.conversionReserva}% de los captados reservó`
              : null}
            {resumen.conversionReserva !== null && resumen.conversionVenta !== null ? ' · ' : null}
            {resumen.conversionVenta !== null
              ? `${resumen.conversionVenta}% de las reservas se convirtió en venta`
              : null}
          </p>
        ) : null}
      </section>

      {ranking.length > 0 ? (
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-h3 text-foreground">El equipo en este período</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-caption uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">Vendedor</th>
                  <th className="py-2 pr-3">Captados</th>
                  <th className="py-2 pr-3">Ventas</th>
                  <th className="py-2 pr-3">Pasajeros</th>
                  <th className="py-2 text-right">Ingresos</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((v) => (
                  <tr key={v.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3">
                      <Link
                        href={`/admin/excursiones/vendedores/${v.id}`}
                        className="font-medium text-foreground hover:text-primary hover:underline"
                      >
                        {v.nombre}
                      </Link>
                      <span className="ml-1 font-mono text-caption text-muted-foreground">
                        {v.codigo}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">{v.captados}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{v.ventas}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{v.pasajeros}</td>
                    <td className="py-2 text-right font-medium text-foreground">
                      {formatMoney(v.ingresos, { moneda: v.moneda }, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-h3 text-foreground">Módulos</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {DISPONIBLES.map((m) => (
            <Link
              key={m.href}
              href={m.href}
              className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-premium"
            >
              <span className="flex items-start gap-3">
                <m.icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <span>
                  <span className="block font-semibold text-foreground">{m.titulo}</span>
                  <span className="block text-caption text-muted-foreground">{m.detalle}</span>
                </span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </div>
      </section>

    </div>
  )
}
