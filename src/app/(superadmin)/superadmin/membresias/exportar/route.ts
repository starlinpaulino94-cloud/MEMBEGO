import { NextResponse, type NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth/guards'
import { listarMembresias } from '@/modules/membresias/lista'
import { leerFiltroMembresias } from '@/modules/membresias/filtros'
import { membresiasToCsv } from '@/modules/membresias/csv'

export const dynamic = 'force-dynamic'

/**
 * CSV de membresías, CON EL MISMO FILTRO que hay en pantalla.
 *
 * Un export que ignora los filtros y descarga todo es la forma más silenciosa
 * de dar un dato equivocado: el archivo no dice de qué es, y quien lo abre da
 * por hecho que es lo que estaba viendo.
 *
 * Se genera en el servidor porque el navegador solo tiene una página de la
 * tabla. `todo: true` salta la paginación —el archivo es el conjunto entero de
 * lo filtrado, no la página en la que uno estaba— y por eso mismo el filtro
 * tiene que viajar con él.
 */
export async function GET(request: NextRequest) {
  await requireRole('SUPERADMIN')

  const sp: Record<string, string | undefined> = {}
  request.nextUrl.searchParams.forEach((v, k) => {
    sp[k] = v
  })

  const filtro = leerFiltroMembresias(sp)
  const datos = await listarMembresias(filtro, { saltar: 0, tomar: 0 }, { todo: true })
  const csv = membresiasToCsv(datos.filas)

  const hoy = new Date().toISOString().slice(0, 10)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="membresias-${hoy}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
