import { NextResponse, type NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth/guards'
import { listarEmpresas } from '@/modules/empresas/lista'
import { leerFiltroEmpresas } from '@/modules/empresas/filtros'
import { empresasToCsv } from '@/modules/empresas/csv'

export const dynamic = 'force-dynamic'

/**
 * CSV del CRM de empresas, CON EL MISMO FILTRO que hay en pantalla.
 *
 * Un export que ignora los filtros y descarga todo es la forma más silenciosa de
 * dar un dato equivocado: el archivo no dice de qué es, y quien lo abre da por
 * hecho que es lo que estaba viendo.
 *
 * Se genera en el servidor y no en el navegador porque el navegador ya no tiene
 * la lista entera: desde el paso a filtrado en servidor solo recibe una página.
 */
export async function GET(request: NextRequest) {
  await requireRole('SUPERADMIN')

  const sp: Record<string, string | undefined> = {}
  request.nextUrl.searchParams.forEach((v, k) => {
    sp[k] = v
  })

  const filtro = leerFiltroEmpresas(sp)
  const datos = await listarEmpresas(filtro, { todo: true })
  const csv = empresasToCsv(datos.filas)

  const hoy = new Date().toISOString().slice(0, 10)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="empresas-${hoy}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
