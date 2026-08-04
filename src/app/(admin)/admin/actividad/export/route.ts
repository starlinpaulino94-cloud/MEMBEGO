import { NextResponse, type NextRequest } from 'next/server'
import { requireSection } from '@/lib/auth/guards'
import { conEmpresa } from '@/lib/tenant'
import { getAuditoria, auditoriaToCsv } from '@/modules/auditoria/queries'

export const dynamic = 'force-dynamic'

/**
 * Export CSV de la bitácora de actividad con los mismos filtros de la
 * pantalla (hasta 5000 acciones). Cada fila lleva la fecha y hora exactas.
 */
export async function GET(request: NextRequest) {
  const user = await requireSection('actividad')
  if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  const companyId = user.metadata.companyId
  if (!companyId) {
    return NextResponse.json({ error: 'Cuenta sin empresa.' }, { status: 400 })
  }

  const sp = request.nextUrl.searchParams
  const items = await getAuditoria(
    companyId,
    {
      accion: sp.get('accion') ?? undefined,
      q: sp.get('q') ?? undefined,
      desde: sp.get('desde') ?? undefined,
      hasta: sp.get('hasta') ?? undefined,
    },
    5000
  )

  const empresa = await conEmpresa(companyId, (tx) =>
    tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
  )
  const csv = auditoriaToCsv(items, empresa?.zonaHoraria || 'America/Santo_Domingo')

  const hoy = new Date().toISOString().slice(0, 10)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="actividad-${hoy}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
