import { requireRole } from '@/lib/auth/guards'
import { TZ_PLATAFORMA } from '@/lib/format'
import { respuestaCsv } from '@/lib/csv'
import { leerRango } from '@/modules/reportes/rango'
import { leerFiltroGlobal } from '@/modules/reportes/filtrosGlobales'
import { getReporteGlobal } from '@/modules/reportes/globales'
import { reporteGlobalToCsv } from '@/modules/reportes/csvGlobal'
import type { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * CSV del reporte de plataforma, CON EL MISMO PERIODO Y EL MISMO ALCANCE que
 * la pantalla: ambos viajan por query string y se leen con las mismas
 * funciones (`leerRango`, `leerFiltroGlobal`).
 *
 * Convive con `[id]` en el mismo nivel de rutas y gana esta: Next resuelve
 * primero los segmentos estáticos y solo después los dinámicos. Ninguna empresa
 * puede quedar tapada porque los ids son cuid, nunca la palabra «exportar».
 *
 * Si la exportación usara otro corte o incluyera las empresas de práctica
 * cuando la pantalla las excluye, el archivo y la pantalla dirían cosas
 * distintas y nadie se enteraría: un CSV descargado no lleva encima las
 * condiciones con las que se generó. Por eso el propio archivo abre con un
 * bloque «Alcance del reporte» que las escribe.
 */
export async function GET(request: NextRequest) {
  await requireRole('SUPERADMIN')

  const sp: Record<string, string> = {}
  request.nextUrl.searchParams.forEach((v, k) => {
    sp[k] = v
  })

  const rango = leerRango(sp, TZ_PLATAFORMA)
  const filtro = leerFiltroGlobal(sp)
  const reporte = await getReporteGlobal(rango, filtro)

  return respuestaCsv(
    reporteGlobalToCsv(reporte, rango, filtro.incluirDemo),
    `reportes-plataforma-${rango.desdeDia}_${rango.hastaDia}`,
    // El nombre ya lleva el periodo: añadirle la fecha de descarga daría un
    // archivo con tres fechas donde solo una significa algo.
    { fechar: false }
  )
}
