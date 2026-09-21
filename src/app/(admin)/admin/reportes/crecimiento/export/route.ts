import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { requireSection, puedeFuncion } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { conEmpresa } from '@/lib/tenant'
import { TZ_PLATAFORMA } from '@/lib/format'
import { armarCsvBloques, respuestaCsv } from '@/lib/csv'
import { leerRango } from '@/modules/reportes/rango'
import { FUERA_DEL_EMBUDO, getReporteCrecimiento } from '@/modules/reportes/crecimiento'

export const dynamic = 'force-dynamic'

/**
 * Crecimiento en CSV, con EL MISMO periodo que la pantalla.
 *
 * El permiso de datos personales se vuelve a comprobar AQUÍ: con solo
 * `exportar`, los nombres que la pantalla esconde se sacarían cambiando de
 * ruta. Y los avisos de la pantalla viajan DENTRO del archivo: descargado, un
 * embudo sin la nota de que es un suelo es indistinguible de un conteo exacto.
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
  const verDatosPersonales = await puedeFuncion('reportes', 'ver_datos_personales')
  const r = await getReporteCrecimiento(companyId, rango, timeZone, { verDatosPersonales })

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
          'Como leer el embudo',
          'ES UN SUELO, no un conteo exacto: la bitacora se escribe sin bloquear el registro ni el pago, y un fallo de escritura pierde el evento en silencio',
        ],
        [
          'Clics',
          'Ya vienen depurados: no cuentan bots ni el propio dueno del enlace abriendolo',
        ],
        [
          'Dos embudos',
          'Las campanas "Invita y Gana" son un embudo APARTE y sus cifras NO se suman a las del programa de referidos',
        ],
        [
          'Quien trae mas gente',
          r.topReferentes === null ? 'OMITIDO - sin permiso ver_datos_personales' : 'Incluido',
        ],
        ['Enlaces vigentes', 'Es una foto de HOY y no depende del periodo elegido'],
      ],
    },
    {
      titulo: 'Resumen del periodo',
      encabezados: ['Metrica', 'Periodo', 'Comparacion', 'Variacion %'],
      filas: [
        ['Clics en invitaciones', r.clics.valor, r.clics.anterior, r.clics.variacion ?? ''],
        ['Registros atribuidos', r.registros.valor, r.registros.anterior, r.registros.variacion ?? ''],
        ['Referidos completados', r.completados.valor, r.completados.anterior, r.completados.variacion ?? ''],
        ['Invitados con membresia', r.membresias.valor, r.membresias.anterior, r.membresias.variacion ?? ''],
      ],
    },
    {
      titulo: 'Conversion',
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ['De clic a registro %', r.tasaRegistro ?? 'sin dato'],
        ['De registro a membresia %', r.tasaMembresia ?? 'sin dato'],
        ['Visitas unicas', r.visitas.unicas],
        ['Clics sin cookie (no agrupables por persona)', r.visitas.sinIdentificar],
      ],
    },
    {
      titulo: 'El embudo paso a paso',
      encabezados: ['Paso', 'Eventos', 'Referentes distintos'],
      filas: r.embudo.map((e) => [e.nombre, e.eventos, e.referentes]),
    },
    {
      titulo: 'Lo que este reporte NO cuenta',
      encabezados: ['Etapa', 'Por que'],
      filas: FUERA_DEL_EMBUDO.map((f) => [f.clave, f.razon]),
    },
    {
      titulo: 'Por donde entra la gente',
      encabezados: ['Canal', 'Compartidos', 'Clics'],
      filas: r.porCanal.map((f) => [f.nombre, f.compartidos, f.clics]),
    },
    {
      titulo: 'Clics y registros dia a dia',
      encabezados: ['Dia', 'Clics', 'Registros'],
      filas: r.serie.map((p) => [p.dia, p.clics, p.registros]),
    },
    // Sin el permiso el bloque NO va vacío: no va. Un bloque con encabezados y
    // sin filas se lee como «nadie trajo a nadie».
    ...(r.topReferentes
      ? [
          {
            titulo: 'Quien trae mas gente (referidos completados)',
            encabezados: ['Cliente', 'Completados'],
            filas: r.topReferentes.map((t) => [t.nombre, t.completados]),
          },
        ]
      : []),
    {
      titulo: 'Enlaces de invitacion',
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ['Creados en el periodo', r.enlaces.creados],
        ['Vigentes ahora mismo (foto de hoy)', r.enlaces.vigentesHoy],
      ],
    },
    {
      titulo: 'Lo que el antifraude aparto',
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ['Referidos marcados sospechosos', r.bloqueados.referidosSospechosos],
        ['Intentos bloqueados', r.bloqueados.eventosFraude],
      ],
    },
    {
      titulo: 'Recompensas otorgadas (dos motores, NO se suman)',
      encabezados: ['Motor', 'Pendientes', 'Entregadas', 'Rechazadas'],
      filas: [
        [
          'Programa de referidos',
          r.recompensas.referidos.pendientes,
          r.recompensas.referidos.entregadas,
          r.recompensas.referidos.rechazadas,
        ],
        [
          'Reglas de crecimiento',
          r.recompensas.growth.pendientes,
          r.recompensas.growth.entregadas,
          r.recompensas.growth.rechazadas,
        ],
      ],
    },
    {
      titulo: 'Se fueron a otro negocio de la plataforma',
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ['Registros en otra empresa', r.fueraDeLaEmpresa.registros],
        ['Membresias en otra empresa', r.fueraDeLaEmpresa.membresias],
      ],
    },
    {
      titulo: 'Campanas "Invita y Gana" (embudo APARTE)',
      encabezados: ['Campana', 'Enlaces abiertos', 'Registros', 'Premios reclamados'],
      filas: r.campanas.map((c) => [c.nombre, c.clics, c.registros, c.premios]),
    },
  ])

  return respuestaCsv(csv, `crecimiento-${rango.desdeDia}-a-${rango.hastaDia}`, { fechar: false })
}
