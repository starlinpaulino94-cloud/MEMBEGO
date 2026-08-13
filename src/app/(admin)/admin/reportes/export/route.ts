import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { ADMIN_ROLES } from '@/types'
import { conEmpresa } from '@/lib/tenant'
import { TZ_PLATAFORMA } from '@/lib/format'
import { respuestaCsv } from '@/lib/csv'
import { leerRango } from '@/modules/reportes/rango'
import { getReporte, reporteToCsv } from '@/modules/reportes/queries'

export const dynamic = 'force-dynamic'

/**
 * CSV del reporte con EL MISMO rango que la pantalla (viaja por query string),
 * y el mismo aislamiento por empresa. Si la exportación usara otro corte de
 * fechas que la vista, el archivo y la pantalla dirían cosas distintas.
 *
 * Desde M129 salen los SEIS bloques del reporte y no solo la serie diaria: el
 * archivo traía una sexta parte de lo que la pantalla enseñaba, sin ninguna
 * señal de que faltara el resto.
 */
export async function GET(req: NextRequest) {
  const user = await getUser()
  if (!user || !ADMIN_ROLES.includes(user.metadata.role)) {
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
  const reporte = await getReporte(companyId, rango, timeZone)

  return respuestaCsv(
    reporteToCsv(reporte, {
      empresa: empresa?.name ?? 'Mi negocio',
      desdeDia: rango.desdeDia,
      hastaDia: rango.hastaDia,
      dias: rango.dias,
    }),
    `reporte-${rango.desdeDia}_${rango.hastaDia}`,
    { fechar: false }
  )
}
