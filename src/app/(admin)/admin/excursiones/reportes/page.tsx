import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { resumenDelPeriodo } from '@/modules/excursiones/metricas/queries'
import { rangoDeParametros } from '@/modules/excursiones/reportes/nucleo'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { ReporteDescarga } from '@/components/excursiones/ReporteDescarga'
import { formatDate, formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reportes' }

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="los reportes de excursiones" />

  const { desde, hasta } = await searchParams
  const rango = rangoDeParametros(desde ?? null, hasta ?? null, new Date())
  const resumen = await resumenDelPeriodo(companyId, rango)
  const dinero = (n: number) => formatMoney(n, { moneda: resumen.moneda }, 2)

  const lineas = [
    ['Clientes captados', String(resumen.registros)],
    ['Reservas', `${resumen.reservas} · ${resumen.pasajerosReservados} pasajeros`],
    ['Ventas confirmadas', `${resumen.ventas} · ${resumen.pasajerosVendidos} pasajeros`],
    ['Ingresos', dinero(resumen.ingresos)],
    ['Ticket promedio', resumen.ticket !== null ? dinero(resumen.ticket) : 'sin ventas'],
    ['Comisiones generadas', dinero(resumen.comisionado)],
  ]

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h2 className="text-h2 text-foreground">Reportes</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Un archivo con el período completo: el resumen, las ventas, las comisiones —con sus
          ajustes— y las liquidaciones con su referencia de pago. Se calcula en el servidor, así
          que trae todo el período, no lo que quepa en una pantalla.
        </p>
      </div>

      <ReporteDescarga
        desde={desde ?? ''}
        hasta={hasta ?? ''}
        etiqueta={`${formatDate(rango.desde)} → ${formatDate(rango.hasta)}`}
      />

      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-h3 text-foreground">Lo que trae este período</h2>
        <dl className="mt-3 divide-y divide-border text-sm">
          {lineas.map(([label, valor]) => (
            <div key={label} className="flex justify-between gap-3 py-2">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-foreground">{valor}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}
