import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { requireSection } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { conEmpresa } from '@/lib/tenant'
import { TZ_PLATAFORMA } from '@/lib/format'
import { armarCsvBloques, respuestaCsv } from '@/lib/csv'
import { leerRango } from '@/modules/reportes/rango'
import { getReporteMembresias } from '@/modules/reportes/membresias'

export const dynamic = 'force-dynamic'

/**
 * El ciclo de vida en CSV, con EL MISMO periodo y la misma comparación que la
 * pantalla —los dos viajan en la query string y los lee la misma función—.
 *
 * El archivo abre con su bloque de alcance, y ahí va lo que ninguna otra parte
 * puede decir una vez descargado: hasta dónde llega el dato de primera mano.
 * Un CSV de agosto con las activaciones en cero, sin esa línea, es indistinguible
 * de un agosto en el que no se activó nada.
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
  const r = await getReporteMembresias(companyId, rango, timeZone)

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
          'Historial de primera mano desde',
          r.corte.desdeDia ?? 'sin eventos propios todavia',
        ],
        [
          'Periodo anterior al registro',
          r.corte.rangoIncompleto
            ? 'SI - las activaciones y cambios de plan de ese tramo salen en cero sin haberlo estado'
            : 'No',
        ],
        ['Incluye historial reconstruido', r.corte.hayReconstruidos ? 'Si' : 'No'],
      ],
    },
    {
      titulo: 'Totales',
      encabezados: ['Metrica', 'Periodo', 'Comparacion', 'Variacion %'],
      filas: [
        ['Activaciones', r.activadas.valor, r.activadas.anterior, r.activadas.variacion ?? ''],
        ['Renovaciones', r.renovadas.valor, r.renovadas.anterior, r.renovadas.variacion ?? ''],
        ['Renovaciones automaticas', r.renovadasAutomaticas, '', ''],
        ['Cancelaciones', r.canceladas.valor, r.canceladas.anterior, r.canceladas.variacion ?? ''],
        ['Vencimientos', r.vencidas.valor, r.vencidas.anterior, r.vencidas.variacion ?? ''],
        // El resto del ciclo viaja al archivo IGUAL que a la pantalla: un CSV
        // al que le faltan cifras que la vista sí enseña es otro reporte.
        ['Creadas (pendientes de pago)', r.creadas.valor, r.creadas.anterior, r.creadas.variacion ?? ''],
        ['Pagos rechazados', r.rechazadas.valor, r.rechazadas.anterior, r.rechazadas.variacion ?? ''],
        ['Ajustes manuales', r.ajustadas.valor, r.ajustadas.anterior, r.ajustadas.variacion ?? ''],
        ['Tasa de renovacion %', r.tasaRenovacion ?? 'sin dato', '', ''],
      ],
    },
    {
      titulo: 'Cambios de plan',
      encabezados: ['Clase', 'Total'],
      filas: [
        ['Subieron', r.cambiosDePlan.subida],
        ['Bajaron', r.cambiosDePlan.bajada],
        ['Mismo precio', r.cambiosDePlan.lateral],
        ['Sin precio guardado', r.cambiosDePlan.desconocido],
      ],
    },
    {
      titulo: 'Por plan',
      encabezados: ['Plan', 'Activaciones', 'Renovaciones', 'Bajas'],
      filas: r.porPlan.map((p) => [p.plan, p.activadas, p.renovadas, p.bajas]),
    },
    {
      titulo: 'Motivos de cancelacion',
      encabezados: ['Motivo', 'Veces'],
      filas: r.motivos.map((m) => [m.motivo, m.total]),
    },
    {
      titulo: 'Dia a dia',
      encabezados: ['Dia', 'Activaciones', 'Renovaciones', 'Bajas'],
      filas: r.serie.map((p) => [p.dia, p.activadas, p.renovadas, p.bajas]),
    },
  ])

  return respuestaCsv(csv, `ciclo-vida-membresias-${rango.desdeDia}-a-${rango.hastaDia}`, {
    fechar: false,
  })
}
