import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { requireSection } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { conEmpresa } from '@/lib/tenant'
import { TZ_PLATAFORMA } from '@/lib/format'
import { armarCsvBloques, respuestaCsv } from '@/lib/csv'
import { armarXlsxBloques, pideXlsx, respuestaXlsx } from '@/lib/xlsx'
import { leerRango } from '@/modules/reportes/rango'
import { getReporteFinanzas } from '@/modules/reportes/finanzas'

export const dynamic = 'force-dynamic'

/**
 * Finanzas en CSV. Exige LOS DOS permisos: exportar y ver las cifras de dinero.
 * Un archivo entero de importes no se puede descargar con el permiso de
 * exportar a secas — si no, el filtro financiero de la pantalla se saltaría
 * cambiando de ruta.
 */
export async function GET(req: NextRequest) {
  const user = await getUser()
  if (!user || !ADMIN_ROLES.includes(user.metadata.role)) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  }
  if (!(await requireSection('reportes', 'exportar'))) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  }
  if (!(await requireSection('reportes', 'ver_financieros'))) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  }
  const companyId = user.metadata.companyId as string | undefined
  if (!companyId) {
    return NextResponse.json({ error: 'Tu cuenta no está vinculada a una empresa.' }, { status: 400 })
  }

  const empresa = await conEmpresa(companyId, (tx) =>
    tx.company.findUnique({ where: { id: companyId }, select: { name: true, zonaHoraria: true } })
  ).catch(() => null)
  const timeZone = empresa?.zonaHoraria || TZ_PLATAFORMA

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries())
  const rango = leerRango(sp, timeZone)
  // El filtro viaja en la misma query string que el rango: el archivo sale con
  // EL MISMO corte que la pantalla. La validación del id vive en la consulta.
  const r = await getReporteFinanzas(companyId, rango, timeZone, new Date(), {
    filtro: { sucursalId: sp.sucursal?.trim() || undefined },
  })

  const bloques = [
    {
      titulo: 'Alcance del reporte',
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ['Empresa', empresa?.name ?? ''],
        ['Periodo', `${rango.desdeDia} a ${rango.hastaDia}`],
        ['Dias', rango.dias],
        ['Comparado contra', rango.etiquetaComparacion],
        // El filtro APLICADO, con nombre: un CSV filtrado sin esta línea es
        // indistinguible del reporte completo una vez descargado.
        ['Filtro por sucursal', r.filtro ? r.filtro.sucursal.nombre : '(todas)'],
        ['Datos completos', r.incompleto ? 'NO - alguna consulta fallo' : 'Si'],
        [
          'Cobrado sin entregar',
          r.filtro
            ? 'No depende del periodo NI del filtro: cubre toda la empresa'
            : 'No depende del periodo: cubre todo lo que siga abierto',
        ],
        [
          'Recurrente estimado',
          'ESTIMACION, no dinero cobrado. Ver su bloque',
        ],
      ],
    },
    {
      titulo: 'Lo que entro',
      encabezados: ['Metrica', 'Periodo', 'Comparacion', 'Variacion %'],
      filas: [
        ['Ingreso de caja', r.ingresosCaja.valor.toFixed(2), r.ingresosCaja.anterior.toFixed(2), r.ingresosCaja.variacion ?? ''],
        ['Cobros de membresias', r.cobrosMembresias.valor.toFixed(2), r.cobrosMembresias.anterior.toFixed(2), r.cobrosMembresias.variacion ?? ''],
        ['Total cobrado', r.ingresoTotal.valor.toFixed(2), r.ingresoTotal.anterior.toFixed(2), r.ingresoTotal.variacion ?? ''],
        ['Operaciones', r.operacionesCobradas.valor, r.operacionesCobradas.anterior, r.operacionesCobradas.variacion ?? ''],
        ['Descuentos aplicados', r.descuentos.toFixed(2), '', ''],
      ],
    },
    {
      titulo: 'Como pagaron',
      encabezados: ['Metodo', 'Operaciones', 'Monto'],
      filas: r.porMetodo.map((m) => [m.metodo, m.operaciones, m.monto.toFixed(2)]),
    },
    // Con filtro la pasarela NO va vacía: no va, con su porqué en una fila.
    // Un bloque con encabezados y sin filas se leería como «no hubo intentos»,
    // que es una afirmación sobre la pasarela y no sobre el filtro.
    {
      titulo: 'Intentos de pago en linea',
      encabezados: ['Estado', 'Intentos', 'Monto'],
      filas: r.filtro
        ? [['OMITIDO - un pago en linea no pertenece a ninguna sucursal', '', '']]
        : [
            ...r.intentos.map((i) => [i.estado, i.total, i.monto.toFixed(2)]),
            ['TASA DE APROBACION %', r.tasaAprobacion ?? 'sin dato', ''],
          ],
    },
    ...(r.filtro
      ? []
      : [
          {
            titulo: 'Motivos de rechazo',
            encabezados: ['Motivo', 'Veces'],
            filas: r.motivosRechazo.map((m) => [m.motivo, m.total] as (string | number)[]),
          },
        ]),
    {
      titulo: 'Pendientes y deshechas',
      encabezados: ['Concepto', 'Operaciones', 'Monto'],
      filas: [
        ['Cobrado sin entregar', r.cobradoSinEntregar.total, r.cobradoSinEntregar.monto.toFixed(2)],
        ['Anuladas o revertidas', r.deshechas.total, r.deshechas.monto.toFixed(2)],
      ],
    },
    {
      // SOLO la caja: los cobros de membresia tienen otro reloj y mezclarlos
      // en una serie daria una columna que no corresponde a ningun hecho. El
      // titulo lo dice para que el archivo se defienda solo una vez bajado.
      titulo: 'Ingreso de caja dia a dia (NO incluye cobros de membresia)',
      encabezados: ['Dia', 'Operaciones', 'Ingreso de caja'],
      filas: r.serie.map((p) => [p.dia, p.operaciones, p.monto.toFixed(2)]),
    },
    {
      titulo: 'Recurrente estimado (NO es dinero cobrado)',
      encabezados: ['Concepto', 'Valor'],
      filas: r.filtro
        ? [['OMITIDO - la estimacion es de la empresa entera, no de una sucursal', '']]
        : [
            ['Estimacion a 30 dias', r.recurrenteEstimado.monto.toFixed(2)],
            ['Membresias vigentes', r.recurrenteEstimado.membresias],
          ],
    },
  ]

  // El MISMO reporte, en un libro de Excel con una hoja por bloque.
  // El CSV no se toca: quien ya automatizó una descarga sigue igual.
  if (pideXlsx(req.nextUrl.searchParams)) {
    return respuestaXlsx(await armarXlsxBloques(bloques), `finanzas-${rango.desdeDia}-a-${rango.hastaDia}`, { fechar: false })
  }

  const csv = armarCsvBloques(bloques)

  return respuestaCsv(csv, `finanzas-${rango.desdeDia}-a-${rango.hastaDia}`, { fechar: false })
}
