import { NextResponse, type NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth/guards'
import { listarOperaciones } from '@/modules/operaciones/lista'
import { leerFiltroOperaciones } from '@/modules/operaciones/filtros'
import { operacionesToCsv } from '@/modules/operaciones/csv'
import { verticalesElegibles } from '@/modules/empresas/verticales'

export const dynamic = 'force-dynamic'

/**
 * CSV de operaciones por empresa, CON EL MISMO FILTRO que hay en pantalla.
 *
 * Un archivo que ignora los filtros no dice de qué es, y quien lo abre da por
 * hecho que es lo que estaba viendo. `todo: true` salta la paginación: el
 * archivo es el conjunto entero de lo filtrado, no la página en la que uno
 * estaba.
 */
export async function GET(request: NextRequest) {
  await requireRole('SUPERADMIN')

  const sp: Record<string, string | undefined> = {}
  request.nextUrl.searchParams.forEach((v, k) => {
    sp[k] = v
  })

  // Los verticales se resuelven ANTES: abren su propia transacción, y pedirlos
  // desde dentro de la del listado tomaría una segunda conexión del pool.
  const verticales = new Map((await verticalesElegibles()).map((v) => [v.codigo, v.nombre]))
  const filtro = leerFiltroOperaciones(sp)
  const datos = await listarOperaciones(filtro, verticales, { todo: true })
  const csv = operacionesToCsv(datos.filas)

  const hoy = new Date().toISOString().slice(0, 10)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="operaciones-${hoy}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
