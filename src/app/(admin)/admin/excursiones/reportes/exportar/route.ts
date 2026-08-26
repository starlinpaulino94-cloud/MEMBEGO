import { NextResponse, type NextRequest } from 'next/server'
import { requireSection } from '@/lib/auth/guards'
import { conEmpresa } from '@/lib/tenant'
import { armarCsvBloques, respuestaCsv, fechaCsv, TOPE_EXPORTACION } from '@/lib/csv'
import { resumenDelPeriodo } from '@/modules/excursiones/metricas/queries'
import {
  ventasDelPeriodo,
  comisionesDelPeriodo,
  liquidacionesDelPeriodo,
} from '@/modules/excursiones/reportes/queries'
import {
  rangoDeParametros,
  nombreReporte,
  filasDeVentas,
  filasDeComisiones,
  filasDeLiquidaciones,
  avisoDeTope,
  ENCABEZADOS_VENTAS,
  ENCABEZADOS_COMISIONES,
  ENCABEZADOS_LIQUIDACIONES,
} from '@/modules/excursiones/reportes/nucleo'

export const dynamic = 'force-dynamic'

/**
 * GET /admin/excursiones/reportes/exportar?desde=&hasta=
 *
 * El reporte del período en un solo archivo: primero el resumen, después las
 * ventas, las comisiones y las liquidaciones. Un archivo por bloque obligaría
 * a pulsar cuatro botones y las hojas de Excel no caben en un CSV.
 *
 * Se exporta el PERÍODO COMPLETO leído en el servidor, no lo que la pantalla
 * tuviera cargado. Y si no cabe, el aviso viaja dentro del archivo.
 */
export async function GET(req: NextRequest) {
  // requireSection además de la página: defense-in-depth. La page ya validó
  // el rol, pero esta action ejecuta en un route handler separado que podría
  // invocarse directamente (curl, job, etc.).
  const user = await requireSection('excursiones', 'reporte_exportar')
  if (!user) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  }
  const companyId = user.metadata.companyId
  if (!companyId) {
    return NextResponse.json({ error: 'Empresa requerida.' }, { status: 400 })
  }

  const empresa = await conEmpresa(companyId, (tx) =>
    tx.company.findUnique({ where: { id: companyId }, select: { name: true, zonaHoraria: true } })
  )
  const timeZone = empresa?.zonaHoraria || 'America/Santo_Domingo'
  const dia = (d: Date | null) => fechaCsv(d, timeZone)

  const sp = req.nextUrl.searchParams
  const rango = rangoDeParametros(sp.get('desde'), sp.get('hasta'), new Date())

  const filtros = {
    vendedorId: sp.get('vendedorId') || null,
    tipoVendedor: sp.get('tipoVendedor') || null,
    excursionId: sp.get('excursionId') || null,
    canal: sp.get('canal') || null,
    estado: sp.get('estado') || null,
  }

  const [resumen, ventas, comisiones, liquidaciones] = await Promise.all([
    resumenDelPeriodo(companyId, rango, filtros),
    ventasDelPeriodo(companyId, rango, dia, filtros),
    comisionesDelPeriodo(companyId, rango, dia, filtros),
    liquidacionesDelPeriodo(companyId, rango, dia, filtros),
  ])

  const csv = armarCsvBloques([
    {
      titulo: `Excursiones · ${empresa?.name ?? ''} · ${dia(rango.desde)} a ${dia(rango.hasta)}`,
      encabezados: ['Indicador', 'Valor'],
      filas: [
        ['Clientes captados', resumen.registros],
        ['Reservas', resumen.reservas],
        ['Pasajeros reservados', resumen.pasajerosReservados],
        ['Ventas confirmadas', resumen.ventas],
        ['Pasajeros vendidos', resumen.pasajerosVendidos],
        ['Ingresos', resumen.ingresos.toFixed(2)],
        ['Ticket promedio', resumen.ticket !== null ? resumen.ticket.toFixed(2) : 'sin ventas'],
        ['Comisiones generadas', resumen.comisionado.toFixed(2)],
        ['Moneda', resumen.moneda],
      ],
    },
    {
      titulo: 'Ventas',
      encabezados: ENCABEZADOS_VENTAS,
      filas: [...filasDeVentas(ventas.filas), ...avisoDeTope(ventas.total, TOPE_EXPORTACION)],
    },
    {
      titulo: 'Comisiones',
      encabezados: ENCABEZADOS_COMISIONES,
      filas: [
        ...filasDeComisiones(comisiones.filas),
        ...avisoDeTope(comisiones.total, TOPE_EXPORTACION),
      ],
    },
    {
      titulo: 'Liquidaciones',
      encabezados: ENCABEZADOS_LIQUIDACIONES,
      filas: [
        ...filasDeLiquidaciones(liquidaciones.filas),
        ...avisoDeTope(liquidaciones.total, TOPE_EXPORTACION),
      ],
    },
  ])

  return respuestaCsv(csv, nombreReporte(rango), { fechar: false })
}
