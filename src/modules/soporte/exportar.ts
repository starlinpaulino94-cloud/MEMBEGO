import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'
import { listTicketsAdmin, resolveCompanyContext } from './queries'
import { leerFiltroTickets } from './filtros'
import { ticketsToCsv } from './csv'
import type { SessionUser } from '@/types'

/**
 * El CSV de la bandeja, para las dos rutas.
 *
 * Está aquí y no repetido en cada `route.ts` porque el alcance —quién ve qué—
 * es justo lo que no puede divergir entre los dos paneles: una copia que se
 * quede atrás exportaría de más o de menos sin dar ningún error.
 *
 * Y se lleva EL MISMO FILTRO de la pantalla. Un archivo que ignora los filtros
 * no dice de qué es, y quien lo abre da por hecho que es lo que estaba viendo.
 */
export async function exportarTickets(
  request: NextRequest,
  user: SessionUser,
  alcance: 'plataforma' | 'empresa'
): Promise<NextResponse> {
  const sp: Record<string, string | undefined> = {}
  request.nextUrl.searchParams.forEach((v, k) => {
    sp[k] = v
  })

  const f = leerFiltroTickets(sp)
  const ctx = await resolveCompanyContext(user, f.empresa ?? undefined, {
    ambitoPlataforma: alcance === 'plataforma',
  })
  const d = await listTicketsAdmin(ctx.companyId, ctx.isSuperadmin, f, { todo: true })
  const csv = ticketsToCsv(d.filas)

  const hoy = new Date().toISOString().slice(0, 10)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="tickets-${f.cola}-${hoy}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
