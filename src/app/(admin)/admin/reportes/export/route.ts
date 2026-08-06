import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { ADMIN_ROLES } from '@/types'
import { conEmpresa } from '@/lib/tenant'
import { leerRango } from '@/modules/reportes/rango'
import { getReporte, reporteToCsv } from '@/modules/reportes/queries'

export const dynamic = 'force-dynamic'

/**
 * CSV del reporte con EL MISMO rango que la pantalla (viaja por query string),
 * y el mismo aislamiento por empresa. Si la exportación usara otro corte de
 * fechas que la vista, el archivo y la pantalla dirían cosas distintas.
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
    tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
  ).catch(() => null)
  const timeZone = empresa?.zonaHoraria || 'America/Santo_Domingo'

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries())
  const rango = leerRango(sp, timeZone)
  const reporte = await getReporte(companyId, rango, timeZone)

  // BOM al inicio: sin él, Excel abre los acentos rotos («Día» → «DÃ­a»).
  const csv = `﻿${reporteToCsv(reporte.serie)}`

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="reporte-${rango.desdeDia}_${rango.hastaDia}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
