import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { ADMIN_ROLES } from '@/types'
import { conEmpresa } from '@/lib/tenant'
import { getRegistrosParaExport, registrosToCsv } from '@/modules/registros/queries'

export const dynamic = 'force-dynamic'

/**
 * Exportación CSV de los registros filtrados (Control de comprobantes · Fase 3 ·
 * G10). Respeta los mismos filtros que la vista `/admin/registros` (por query
 * string) y el aislamiento multi-tenant por companyId. Solo roles de admin.
 */
export async function GET(req: NextRequest) {
  const user = await getUser()
  if (!user || !ADMIN_ROLES.includes(user.metadata.role)) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  }
  const companyId = user.metadata.companyId as string | undefined

  const empresa = companyId
    ? await conEmpresa(companyId, (tx) =>
        tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      )
    : null
  const timeZone = empresa?.zonaHoraria || 'America/Santo_Domingo'

  const sp = req.nextUrl.searchParams
  const filtro = {
    q: sp.get('q') ?? undefined,
    tipo: sp.get('tipo') ?? undefined,
    estado: sp.get('estado') ?? undefined,
    metodo: sp.get('metodo') ?? undefined,
    desde: sp.get('desde') ?? undefined,
    hasta: sp.get('hasta') ?? undefined,
  }

  const items = await getRegistrosParaExport(companyId, filtro, timeZone)
  const csv = registrosToCsv(items, timeZone)

  const hoy = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="registros-${hoy}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
