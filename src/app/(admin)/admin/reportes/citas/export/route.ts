import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { requireSection, puedeFuncion } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { conEmpresa } from '@/lib/tenant'
import { TZ_PLATAFORMA } from '@/lib/format'
import { armarCsvBloques, respuestaCsv } from '@/lib/csv'
import { leerRango } from '@/modules/reportes/rango'
import { getReporteCitas } from '@/modules/reportes/citas'

export const dynamic = 'force-dynamic'

/**
 * La agenda en CSV, con EL MISMO periodo y el mismo filtro que la pantalla
 * —los dos viajan en la query string y los lee la misma función—.
 *
 * El archivo abre con su bloque de alcance, y ahí va lo que ninguna otra parte
 * puede decir una vez descargado: que el estado es el de HOY y no el del día de
 * la cita. Una hoja con «canceladas: 14» y sin esa línea se lee como si dijera
 * que se cancelaron esa semana, que es justo lo que no se puede saber.
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
  const r = await getReporteCitas(companyId, rango, timeZone, {
    verEmpleados,
    filtro: { servicio: sp.servicio?.trim() || undefined },
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
        ['Filtro por servicio', r.filtro ? r.filtro.servicio : '(todos)'],
        ['Datos completos', r.incompleto ? 'NO - alguna consulta fallo' : 'Si'],
        // LA LÍNEA que hace que este archivo se pueda leer dentro de un mes.
        [
          'Estado de cada cita',
          'ES EL DE HOY, no el del dia de la cita: la tabla no guarda cuando cambio. Una cita de marzo cancelada en abril sale como cancelada en marzo',
        ],
        [
          'Citas contadas por',
          'El dia en que ESTABAN AGENDADAS. "Reservadas en el periodo" va por la fecha de reserva y es otra pregunta',
        ],
        ['Desglose por sucursal', 'NO DISPONIBLE - la reserva todavia no guarda en que sucursal se hace'],
        [
          'Desglose por persona',
          r.porEmpleado === null ? 'OMITIDO - sin permiso ver_empleados' : 'Incluido',
        ],
      ],
    },
    {
      titulo: 'Totales',
      encabezados: ['Metrica', 'Periodo', 'Comparacion', 'Variacion %'],
      filas: [
        ['Citas agendadas', r.agendadas.valor, r.agendadas.anterior, r.agendadas.variacion ?? ''],
        ['Completadas', r.completadas.valor, r.completadas.anterior, r.completadas.variacion ?? ''],
        ['Canceladas', r.canceladas.valor, r.canceladas.anterior, r.canceladas.variacion ?? ''],
        ['No asistio', r.noAsistio.valor, r.noAsistio.anterior, r.noAsistio.variacion ?? ''],
        ['Todavia abiertas', r.abiertas, '', ''],
        ['Reservadas en el periodo', r.reservadas.valor, r.reservadas.anterior, r.reservadas.variacion ?? ''],
        ['Ya pasaron sin cerrar', r.sinCerrar, '', ''],
        ['Pendientes de confirmar (no depende del periodo)', r.porConfirmar, '', ''],
        ['Tasa de asistencia %', r.tasaAsistencia ?? 'sin dato', '', ''],
        ['Tasa de cancelacion %', r.tasaCancelacion ?? 'sin dato', '', ''],
      ],
    },
    {
      titulo: 'Quien cancela',
      encabezados: ['Quien', 'Citas'],
      filas: [
        ['El cliente', r.quienCancela.cliente],
        ['El negocio', r.quienCancela.negocio],
        ['Sin registrar', r.quienCancela.sinRegistrar],
      ],
    },
    {
      titulo: 'Motivos de cancelacion',
      encabezados: ['Motivo', 'Veces'],
      filas: r.motivosCancelacion.map((m) => [m.motivo, m.total]),
    },
    {
      titulo: 'Por servicio',
      encabezados: ['Servicio', 'Agendadas', 'Completadas', 'Canceladas', 'No asistio'],
      filas: r.porServicio.map((f) => [
        f.nombre,
        f.agendadas,
        f.completadas,
        f.canceladas,
        f.noAsistio,
      ]),
    },
    // Sin el permiso el bloque NO va vacío: no va. Un bloque con encabezados y
    // sin filas se lee como «no hubo», que es una afirmación sobre el negocio y
    // no sobre quien descarga.
    ...(r.porEmpleado
      ? [
          {
            titulo: 'Quien atendio',
            encabezados: ['Persona', 'Agendadas', 'Completadas', 'Canceladas', 'No asistio'],
            filas: r.porEmpleado.map((f) => [
              f.nombre,
              f.agendadas,
              f.completadas,
              f.canceladas,
              f.noAsistio,
            ]),
          },
        ]
      : []),
    {
      titulo: 'Dia a dia',
      encabezados: ['Dia', 'Agendadas', 'Completadas', 'Canceladas', 'No asistio'],
      filas: r.serie.map((p) => [p.dia, p.agendadas, p.completadas, p.canceladas, p.noAsistio]),
    },
  ])

  return respuestaCsv(csv, `citas-${rango.desdeDia}-a-${rango.hastaDia}`, { fechar: false })
}
