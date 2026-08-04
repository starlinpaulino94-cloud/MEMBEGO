import { NextResponse, type NextRequest } from 'next/server'
import { requireSection } from '@/lib/auth/guards'
import { conEmpresa } from '@/lib/tenant'
import { getSeguimiento, SEGUIMIENTO_ESTADO_LABEL } from '@/modules/seguimiento/queries'
import { getSeguimientoConfig } from '@/modules/seguimiento/config'

export const dynamic = 'force-dynamic'

/**
 * Seguimiento · Fase S3: export CSV del inventario de recompensas gratis,
 * respetando los mismos filtros de la pantalla (hasta 5000 filas). Con BOM
 * para que Excel abra los acentos bien.
 */
export async function GET(request: NextRequest) {
  const user = await requireSection('seguimiento')
  if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  const companyId = user.metadata.companyId
  if (!companyId) {
    return NextResponse.json({ error: 'Cuenta sin empresa.' }, { status: 400 })
  }

  const sp = request.nextUrl.searchParams
  const config = await getSeguimientoConfig(companyId)
  const { items } = await getSeguimiento(
    companyId,
    {
      estado: sp.get('estado') ?? undefined,
      promocionId: sp.get('promo') ?? undefined,
      q: sp.get('q') ?? undefined,
      desde: sp.get('desde') ?? undefined,
      hasta: sp.get('hasta') ?? undefined,
    },
    config,
    5000
  )

  const empresa = await conEmpresa(companyId, (tx) =>
    tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
  )
  const timeZone = empresa?.zonaHoraria || 'America/Santo_Domingo'
  const fecha = (d: Date | null) =>
    d ? new Intl.DateTimeFormat('es-DO', { timeZone, dateStyle: 'short' }).format(d) : ''
  const fechaHora = (d: Date | null) =>
    d
      ? new Intl.DateTimeFormat('es-DO', { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(d)
      : ''
  const celda = (v: string | number | null) => {
    const s = String(v ?? '')
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  const cabecera = [
    'Cliente',
    'Teléfono',
    'Correo',
    'Recompensa',
    'Estado',
    'Usos incluidos',
    'Usos restantes',
    'Otorgado',
    'Vence',
    'Usado',
    'Usado por',
    'Canje interno',
    'Días desde otorgado',
  ]
  const filas = items.map((r) =>
    [
      celda(r.cliente),
      celda(r.telefono),
      celda(r.email),
      celda(r.promocion),
      celda(SEGUIMIENTO_ESTADO_LABEL[r.estado]),
      r.usosIncluidos,
      r.usosRestantes,
      celda(fecha(r.otorgadoAt)),
      celda(fecha(r.venceAt)),
      celda(fechaHora(r.usadoAt)),
      celda(r.usadoPor),
      r.canjeInterno ? 'Sí' : '',
      r.diasDesdeOtorgado,
    ].join(',')
  )
  const csv = '\uFEFF' + [cabecera.join(','), ...filas].join('\r\n')

  const hoy = new Date().toISOString().slice(0, 10)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="seguimiento-recompensas-${hoy}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
