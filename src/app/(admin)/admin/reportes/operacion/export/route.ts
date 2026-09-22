import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { requireSection, puedeFuncion } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { conEmpresa } from '@/lib/tenant'
import { TZ_PLATAFORMA } from '@/lib/format'
import { armarCsvBloques, respuestaCsv } from '@/lib/csv'
import { armarXlsxBloques, pideXlsx, respuestaXlsx } from '@/lib/xlsx'
import { leerRango } from '@/modules/reportes/rango'
import { getReporteOperacion } from '@/modules/reportes/operacion'

export const dynamic = 'force-dynamic'

/**
 * La operación en CSV, con EL MISMO periodo y la misma comparación que la
 * pantalla —los dos viajan en la query string y los lee la misma función—.
 *
 * El archivo abre con su bloque de alcance, y ahí va lo que ninguna otra parte
 * puede decir una vez descargado: si el relleno de empresas terminó, y si el
 * desglose por empleado salió o se quedó fuera por permiso. Un CSV al que le
 * falta una sección, sin esa línea, es indistinguible de uno donde esa sección
 * estaba vacía.
 */
export async function GET(req: NextRequest) {
  const user = await getUser()
  if (!user || !ADMIN_ROLES.includes(user.metadata.role)) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  }
  if (!(await requireSection('reportes', 'exportar'))) {
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
  // El permiso se vuelve a comprobar AQUÍ. Con solo `exportar`, el desglose por
  // persona que la pantalla esconde se sacaría cambiando de ruta.
  const verEmpleados = await puedeFuncion('reportes', 'ver_empleados')
  // El filtro viaja en la misma query string que el rango, así que el archivo
  // sale con EL MISMO corte que la pantalla. La validación (¿existe?, ¿es de
  // esta empresa?, ¿hay permiso para filtrar por persona?) vive en la
  // consulta, no aquí: esta ruta no puede ser la barrera floja.
  const r = await getReporteOperacion(companyId, rango, timeZone, {
    verEmpleados,
    filtro: {
      sucursalId: sp.sucursal?.trim() || undefined,
      empleadoId: sp.empleado?.trim() || undefined,
    },
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
        ['Filtro por sucursal', r.filtro?.sucursal ? r.filtro.sucursal.nombre : '(todas)'],
        ['Filtro por empleado', r.filtro?.empleado ? r.filtro.empleado.nombre : '(todos)'],
        ['Datos completos', r.incompleto ? 'NO - alguna consulta fallo' : 'Si'],
        [
          'Cobertura de visitas',
          r.cobertura.pendiente
            ? 'PARCIAL - quedan visitas sin empresa asignada; los periodos mas viejos salen por debajo'
            : 'Completa',
        ],
        [
          'Desglose por empleado',
          r.porEmpleado === null ? 'OMITIDO - sin permiso ver_empleados' : 'Incluido',
        ],
      ],
    },
    {
      titulo: 'Totales',
      encabezados: ['Metrica', 'Periodo', 'Comparacion', 'Variacion %'],
      filas: [
        ['Canjes', r.canjes.valor, r.canjes.anterior, r.canjes.variacion ?? ''],
        ['Descontaron un uso', r.descontados.valor, r.descontados.anterior, r.descontados.variacion ?? ''],
        ['Sin descontar', r.sinDescontar, '', ''],
        ['Clientes atendidos', r.clientesAtendidos, '', ''],
        ['Visitas revertidas', r.revertidas, '', ''],
        // Con filtro los QR no van: la bitácora no guarda sucursal ni
        // empleado, y un total de empresa dentro de un archivo filtrado se
        // leería como parte del recorte. La fila lo dice en vez de callar.
        ...(r.filtro
          ? [['QR (generados, usados, compartidos)', 'OMITIDO - no se pueden filtrar', '', '']]
          : [
              ['QR generados', r.qrGenerados, '', ''],
              ['QR usados', r.qrUsados, '', ''],
              ['QR compartidos', r.qrCompartidos, '', ''],
            ]),
      ],
    },
    {
      titulo: 'Por sucursal',
      encabezados: ['Sucursal', 'Canjes', 'Descontaron'],
      filas: r.porSucursal.map((f) => [f.nombre, f.canjes, f.descontados]),
    },
    // Sin el permiso el bloque NO va vacío: no va. Un bloque con encabezados y
    // sin filas se lee como «no hubo», que es una afirmación sobre el negocio y
    // no sobre quien descarga.
    ...(r.porEmpleado
      ? [
          {
            titulo: 'Por empleado',
            encabezados: ['Empleado', 'Canjes', 'Descontaron'],
            filas: r.porEmpleado.map((f) => [f.nombre, f.canjes, f.descontados]),
          },
        ]
      : []),
    {
      titulo: 'Por beneficio',
      encabezados: ['Beneficio', 'Canjes', 'Descontaron'],
      filas: r.porServicio.map((f) => [f.nombre, f.canjes, f.descontados]),
    },
    {
      titulo: 'Dia a dia',
      encabezados: ['Dia', 'Canjes', 'Descontaron'],
      filas: r.serie.map((p) => [p.dia, p.canjes, p.descontados]),
    },
  ]

  // El MISMO reporte, en un libro de Excel con una hoja por bloque.
  // El CSV no se toca: quien ya automatizó una descarga sigue igual.
  if (pideXlsx(req.nextUrl.searchParams)) {
    return respuestaXlsx(await armarXlsxBloques(bloques), `operacion-${rango.desdeDia}-a-${rango.hastaDia}`, { fechar: false })
  }

  const csv = armarCsvBloques(bloques)

  return respuestaCsv(csv, `operacion-${rango.desdeDia}-a-${rango.hastaDia}`, { fechar: false })
}
