import { NextResponse, type NextRequest } from 'next/server'
import { requireSection } from '@/lib/auth/guards'
import { conEmpresa } from '@/lib/tenant'
import { getReporteOperativo, reporteToCsv } from '@/modules/apps/reportes'

export const dynamic = 'force-dynamic'

/**
 * Export CSV del reporte operativo, con el mismo rango de la pantalla.
 * El detalle por día más la fila de totales, listo para Excel.
 */
export async function GET(request: NextRequest) {
  const user = await requireSection('app')
  if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  const companyId = user.metadata.companyId
  if (!companyId) {
    return NextResponse.json({ error: 'Cuenta sin empresa.' }, { status: 400 })
  }

  const sp = request.nextUrl.searchParams
  const empresa = await conEmpresa(companyId, (tx) =>
    tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
  )
  const reporte = await getReporteOperativo(
    companyId,
    { desde: sp.get('desde') ?? undefined, hasta: sp.get('hasta') ?? undefined },
    empresa?.zonaHoraria || 'America/Santo_Domingo'
  )

  return new NextResponse(reporteToCsv(reporte), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="reporte-operativo-${reporte.rango.desde}_${reporte.rango.hasta}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
