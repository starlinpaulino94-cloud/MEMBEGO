import { requireRole } from '@/lib/auth/guards'
import { TZ_PLATAFORMA } from '@/lib/format'
import { respuestaCsv } from '@/lib/csv'
import { getAuditoria, auditoriaToCsv } from '@/modules/auditoria/queries'
import type { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

/** Tope de filas. El mismo que la exportación de actividad de cada empresa. */
const TOPE = 5000

/**
 * CSV de la bitácora de la plataforma, con los mismos filtros de la pantalla.
 *
 * La función que serializa ya existía y la usaba `/admin/actividad/export`: era
 * la bitácora de UNA empresa la que se podía guardar, y la de la plataforma
 * entera —la que de verdad hace falta archivar cuando alguien pregunta quién
 * hizo qué— la única sin botón.
 *
 * La pantalla enseña 200 acciones y aquí se bajan hasta 5000. No es una
 * discrepancia: en pantalla 200 es todo lo que se puede leer de corrido, y el
 * archivo se abre precisamente para lo que no cabe. Si se llega al tope, la
 * última fila lo dice — un recorte callado en un registro de auditoría es peor
 * que no exportarlo.
 */
export async function GET(request: NextRequest) {
  await requireRole('SUPERADMIN')

  const sp = request.nextUrl.searchParams
  const items = await getAuditoria(
    null,
    {
      accion: sp.get('accion') ?? undefined,
      empresa: sp.get('empresa') ?? undefined,
      q: sp.get('q') ?? undefined,
      desde: sp.get('desde') ?? undefined,
      hasta: sp.get('hasta') ?? undefined,
    },
    TOPE
  )

  const csv = auditoriaToCsv(items, TZ_PLATAFORMA)
  const aviso =
    items.length >= TOPE
      ? `\n"AVISO: se alcanzó el tope de ${TOPE} acciones. Acota el periodo o los filtros para ver el resto."`
      : ''

  return respuestaCsv(csv + aviso, 'auditoria-plataforma')
}
