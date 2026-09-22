import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { requireSection, puedeFuncion } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { conEmpresa } from '@/lib/tenant'
import { TZ_PLATAFORMA } from '@/lib/format'
import { armarCsvBloques, respuestaCsv } from '@/lib/csv'
import { armarXlsxBloques, pideXlsx, respuestaXlsx } from '@/lib/xlsx'
import { leerRango } from '@/modules/reportes/rango'
import { getReporte, reporteToBloques } from '@/modules/reportes/queries'

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
  // Descargar es su propio permiso. Ver una cifra en pantalla y llevársela en
  // un archivo que sale de la oficina no son la misma decisión.
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
  // El mismo filtro que la pantalla. Si esto se olvidara, el archivo traería
  // las cifras que la vista oculta — y nadie se enteraría, porque el fallo no
  // se ve: se descarga.
  const verFinancieros = await puedeFuncion('reportes', 'ver_financieros')
  const reporte = await getReporte(companyId, rango, timeZone, { verFinancieros })

  const bloques = reporteToBloques(reporte, {
    empresa: empresa?.name ?? 'Mi negocio',
    desdeDia: rango.desdeDia,
    hastaDia: rango.hastaDia,
    dias: rango.dias,
  })
  const nombre = `reporte-${rango.desdeDia}_${rango.hastaDia}`

  // El MISMO reporte, en un libro de Excel con una hoja por bloque.
  // El CSV no se toca: quien ya automatizó una descarga sigue igual.
  if (pideXlsx(req.nextUrl.searchParams)) {
    return respuestaXlsx(await armarXlsxBloques(bloques), nombre, { fechar: false })
  }

  return respuestaCsv(armarCsvBloques(bloques), nombre, { fechar: false })
}
