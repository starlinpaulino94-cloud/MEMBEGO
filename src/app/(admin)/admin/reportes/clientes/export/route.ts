import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { requireSection, puedeFuncion } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { conEmpresa } from '@/lib/tenant'
import { TZ_PLATAFORMA } from '@/lib/format'
import { armarCsvBloques, respuestaCsv } from '@/lib/csv'
import { leerRango } from '@/modules/reportes/rango'
import { getReporteClientes } from '@/modules/reportes/clientes'

export const dynamic = 'force-dynamic'

/**
 * Los clientes en CSV, con EL MISMO periodo que la pantalla —viaja en la query
 * string y lo lee la misma función—.
 *
 * Los permisos se vuelven a comprobar AQUÍ. Con solo `exportar`, el dinero y
 * los nombres que la pantalla esconde se sacarían cambiando de ruta; y el
 * bloque de alcance dice si salieron o se quedaron fuera, porque un archivo al
 * que le falta una sección, sin esa línea, es indistinguible de uno donde esa
 * sección estaba vacía.
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
  const verFinancieros = await puedeFuncion('reportes', 'ver_financieros')
  const verDatosPersonales = await puedeFuncion('reportes', 'ver_datos_personales')
  const r = await getReporteClientes(companyId, rango, timeZone, {
    verFinancieros,
    verDatosPersonales,
  })

  const csv = armarCsvBloques([
    {
      titulo: 'Alcance del reporte',
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ['Empresa', empresa?.name ?? ''],
        ['Periodo', `${rango.desdeDia} a ${rango.hastaDia}`],
        ['Dias', rango.dias],
        ['Comparado contra', rango.etiquetaComparacion],
        ['Datos completos', r.incompleto ? 'NO - alguna consulta fallo' : 'Si'],
        [
          'Alcance de los datos',
          'SOLO la relacion de esta empresa con cada cliente. Lo que hiciera en otro negocio no esta aqui ni se puede deducir',
        ],
        ['Valor generado', r.valorGenerado ? 'Incluido' : 'OMITIDO - sin permiso ver_financieros'],
        [
          'Clientes que mas dejaron',
          r.topClientes === null
            ? 'OMITIDO - hacen falta ver_financieros Y ver_datos_personales'
            : 'Incluido',
        ],
        [
          'Foto de hoy',
          'Las cifras del bloque "Foto de hoy" NO dependen del periodo elegido',
        ],
      ],
    },
    {
      titulo: 'Lo que paso en el periodo',
      encabezados: ['Metrica', 'Periodo', 'Comparacion', 'Variacion %'],
      filas: [
        ['Clientes nuevos', r.nuevos.valor, r.nuevos.anterior, r.nuevos.variacion ?? ''],
        ['Con actividad', r.conActividad.valor, r.conActividad.anterior, r.conActividad.variacion ?? ''],
        ['Con algun cobro', r.quePagaron.valor, r.quePagaron.anterior, r.quePagaron.variacion ?? ''],
        ...(r.valorGenerado
          ? [
              [
                'Valor generado',
                r.valorGenerado.valor.toFixed(2),
                r.valorGenerado.anterior.toFixed(2),
                r.valorGenerado.variacion ?? '',
              ],
            ]
          : [['Valor generado', 'OMITIDO - sin permiso', '', '']]),
      ],
    },
    {
      titulo: 'Los nuevos volvieron',
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ['Altas del periodo', r.nuevos.valor],
        ['De esos, vinieron alguna vez', r.nuevosQueVolvieron],
        ['Tasa de activacion %', r.tasaActivacion ?? 'sin dato'],
      ],
    },
    {
      titulo: 'Foto de hoy (NO depende del periodo)',
      encabezados: ['Concepto', 'Clientes'],
      filas: [
        ['Clientes en total', r.base],
        ['Con membresia vigente', r.conMembresiaVigente],
        ['Nunca tuvieron membresia', r.sinMembresiaNunca],
        ['Aceptan promociones', r.consentimiento.promos],
        ['Aceptan recordatorios', r.consentimiento.recordatorios],
      ],
    },
    {
      titulo: 'Por donde llegaron',
      encabezados: ['Canal', 'Altas'],
      filas: r.porCanal.map((f) => [f.nombre, f.clientes]),
    },
    {
      titulo: 'De donde son',
      encabezados: ['Ciudad', 'Altas'],
      filas: r.porCiudad.map((f) => [f.nombre, f.clientes]),
    },
    // Sin los permisos el bloque NO va vacío: no va. Un bloque con encabezados
    // y sin filas se lee como «no hubo», que es una afirmación sobre el negocio
    // y no sobre quien descarga.
    ...(r.topClientes
      ? [
          {
            titulo: 'Los que mas dejaron en el periodo (cobros de membresia)',
            encabezados: ['Cliente', 'Monto'],
            filas: r.topClientes.map((c) => [c.nombre, c.monto.toFixed(2)]),
          },
        ]
      : []),
    {
      titulo: 'Altas dia a dia',
      encabezados: ['Dia', 'Altas'],
      filas: r.serie.map((p) => [p.dia, p.nuevos]),
    },
  ])

  return respuestaCsv(csv, `clientes-${rango.desdeDia}-a-${rango.hastaDia}`, { fechar: false })
}
