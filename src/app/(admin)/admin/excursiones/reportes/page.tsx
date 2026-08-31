import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { resumenDelPeriodo } from '@/modules/excursiones/metricas/queries'
import { rangoDeParametros } from '@/modules/excursiones/reportes/nucleo'
import { vendedoresParaSupervisor } from '@/modules/excursiones/vendedores/queries'
import { listadoExcursiones } from '@/modules/excursiones/catalogo/queries'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { ReporteDescarga } from '@/components/excursiones/ReporteDescarga'
import { formatDate, formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reportes' }

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<{
    desde?: string
    hasta?: string
    vendedorId?: string
    tipoVendedor?: string
    excursionId?: string
    canal?: string
    estado?: string
  }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="los reportes de excursiones" />

  const sp = await searchParams
  const rango = rangoDeParametros(sp.desde ?? null, sp.hasta ?? null, new Date())

  const filtros = {
    vendedorId: sp.vendedorId || null,
    tipoVendedor: sp.tipoVendedor || null,
    excursionId: sp.excursionId || null,
    canal: sp.canal || null,
    estado: sp.estado || null,
  }

  const [resumen, vendedores, excursiones] = await Promise.all([
    resumenDelPeriodo(companyId, rango, filtros),
    vendedoresParaSupervisor(companyId),
    listadoExcursiones(companyId),
  ])

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
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h2 className="text-h2 text-foreground">Reportes</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Un archivo con el período completo y filtros avanzados: el resumen, las ventas, las comisiones —con sus
          ajustes— y las liquidaciones con su referencia de pago. Se calcula en el servidor, garantizando la
          integridad de todos los datos.
        </p>
      </div>

      <ReporteDescarga
        desde={sp.desde ?? ''}
        hasta={sp.hasta ?? ''}
        vendedorId={sp.vendedorId}
        tipoVendedor={sp.tipoVendedor}
        excursionId={sp.excursionId}
        canal={sp.canal}
        estado={sp.estado}
        etiqueta={`${formatDate(rango.desde)} → ${formatDate(rango.hasta)}`}
        vendedores={vendedores.map((v) => ({
          id: v.id,
          nombre: `${v.nombre} ${v.apellido ?? ''}`.trim(),
          codigo: v.codigo,
          tipo: v.tipo ?? null,
        }))}
        excursiones={excursiones.map((e) => ({
          id: e.id,
          nombre: e.nombre,
          tipoItem: e.tipoItem,
        }))}
      />

      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-h3 text-foreground">Lo que trae este período con los filtros aplicados</h2>
        <dl className="mt-3 divide-y divide-border text-sm">
          {lineas.map(([label, valor]) => (
            <div key={label} className="flex justify-between gap-3 py-2">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-foreground font-medium">{valor}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}
